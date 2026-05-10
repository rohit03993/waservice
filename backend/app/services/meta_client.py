import httpx

# Newer analytics fields (e.g. pricing_analytics) require a recent Graph version.
GRAPH_ANALYTICS_BASE = "https://graph.facebook.com/v22.0"

# Inbound media is fetched via Graph then CDN; cap size to protect the API worker.
_MAX_MEDIA_DOWNLOAD_BYTES = 50 * 1024 * 1024


def _meta_response_dict(response: httpx.Response) -> dict:
    """Parse Meta JSON or raise RuntimeError (avoids JSONDecodeError → FastAPI 500)."""
    try:
        data = response.json()
    except ValueError:
        raise RuntimeError(
            f"Meta non-JSON response (HTTP {response.status_code}): {(response.text or '')[:800]}"
        ) from None
    if not isinstance(data, dict):
        raise RuntimeError(str(data)[:800])
    return data


class MetaClient:
    BASE_URL = "https://graph.facebook.com/v20.0"

    @staticmethod
    async def send_template_message(
        *,
        phone_number_id: str,
        access_token: str,
        to_phone_e164: str,
        template_name: str,
        language_code: str,
        template_components: list[dict] | None = None,
    ) -> dict:
        url = f"{MetaClient.BASE_URL}/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        template_block: dict = {
            "name": template_name,
            "language": {"code": language_code},
        }
        if template_components:
            template_block["components"] = template_components
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone_e164,
            "type": "template",
            "template": template_block,
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=headers, json=payload)
            data = response.json()
            if response.status_code >= 400:
                raise RuntimeError(str(data))
            return data

    @staticmethod
    async def send_text_message(
        *,
        phone_number_id: str,
        access_token: str,
        to_phone_e164: str,
        text: str,
    ) -> dict:
        url = f"{MetaClient.BASE_URL}/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone_e164,
            "type": "text",
            "text": {"body": text},
        }

        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(url, headers=headers, json=payload)
            data = response.json()
            if response.status_code >= 400:
                raise RuntimeError(str(data))
            return data

    @staticmethod
    async def upload_media(
        *,
        phone_number_id: str,
        access_token: str,
        file_bytes: bytes,
        mime_type: str,
        filename: str,
    ) -> str:
        """POST multipart upload to Cloud API; returns Meta-hosted media id."""
        url = f"{MetaClient.BASE_URL}/{phone_number_id}/media"
        headers = {"Authorization": f"Bearer {access_token}"}
        files = {"file": (filename, file_bytes, mime_type)}
        data = {"messaging_product": "whatsapp", "type": mime_type}
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(url, headers=headers, files=files, data=data)
            body = _meta_response_dict(response)
            if response.status_code >= 400:
                raise RuntimeError(str(body))
            mid = body.get("id")
            if not mid:
                raise RuntimeError(str(body))
            return str(mid)

    @staticmethod
    async def send_image_message(
        *,
        phone_number_id: str,
        access_token: str,
        to_phone_e164: str,
        media_id: str,
        caption: str | None = None,
    ) -> dict:
        url = f"{MetaClient.BASE_URL}/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        image_block: dict = {"id": media_id}
        if caption and caption.strip():
            image_block["caption"] = caption.strip()[:1024]
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone_e164,
            "type": "image",
            "image": image_block,
        }
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, headers=headers, json=payload)
            data = response.json()
            if response.status_code >= 400:
                raise RuntimeError(str(data))
            return data

    @staticmethod
    async def send_document_message(
        *,
        phone_number_id: str,
        access_token: str,
        to_phone_e164: str,
        media_id: str,
        caption: str | None = None,
        filename: str | None = None,
    ) -> dict:
        url = f"{MetaClient.BASE_URL}/{phone_number_id}/messages"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        document_block: dict = {"id": media_id}
        if caption and caption.strip():
            document_block["caption"] = caption.strip()[:1024]
        if filename and filename.strip():
            document_block["filename"] = filename.strip()[:255]
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone_e164,
            "type": "document",
            "document": document_block,
        }
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, headers=headers, json=payload)
            data = response.json()
            if response.status_code >= 400:
                raise RuntimeError(str(data))
            return data

    @staticmethod
    async def list_templates(
        *,
        waba_id: str,
        access_token: str,
    ) -> dict:
        url = f"{MetaClient.BASE_URL}/{waba_id}/message_templates"
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(url, headers=headers)
            data = response.json()
            if response.status_code >= 400:
                raise RuntimeError(str(data))
            return data

    @staticmethod
    async def create_message_template(
        *,
        waba_id: str,
        access_token: str,
        body: dict,
    ) -> dict:
        """Create a WhatsApp message template on the WABA (Business Management API)."""
        url = f"{MetaClient.BASE_URL}/{waba_id}/message_templates"
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(url, headers=headers, json=body)
            data = response.json()
            if response.status_code >= 400:
                raise RuntimeError(str(data))
            return data

    @staticmethod
    async def verify_phone_number_access(*, phone_number_id: str, access_token: str) -> tuple[bool, str | None]:
        """Lightweight GET to confirm token can access this phone number."""
        url = f"{MetaClient.BASE_URL}/{phone_number_id}"
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, headers=headers, params={"fields": "id"})
            data = response.json()
            if response.status_code >= 400:
                err = data.get("error") if isinstance(data, dict) else None
                msg = err.get("message") if isinstance(err, dict) else str(data)
                return False, msg
            return True, None

    @staticmethod
    async def download_media(*, media_id: str, access_token: str) -> tuple[bytes, str]:
        """
        Resolve a WABA media id to a CDN URL via Graph, then download bytes.
        Returns (content, mime_type).
        """
        headers = {"Authorization": f"Bearer {access_token}"}
        meta_url = f"{MetaClient.BASE_URL}/{media_id}"
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.get(meta_url, headers=headers)
            info = _meta_response_dict(r)
            if r.status_code >= 400:
                raise RuntimeError(str(info))
            download_url = info.get("url")
            mime = info.get("mime_type") or "application/octet-stream"
            if not download_url or not isinstance(download_url, str):
                raise RuntimeError("Meta media response missing url")
            r2 = await client.get(download_url, headers=headers)
            if r2.status_code >= 400:
                raise RuntimeError(r2.text or str(r2.status_code))
            content = r2.content
            if len(content) > _MAX_MEDIA_DOWNLOAD_BYTES:
                raise RuntimeError("Media exceeds size limit")
            return content, mime

    @staticmethod
    async def fetch_waba_pricing_analytics(
        *,
        waba_id: str,
        access_token: str,
        start_ts: int,
        end_ts: int,
        granularity: str = "DAILY",
        dimensions: list[str] | None = None,
        country_codes: list[str] | None = None,
        metric_types: list[str] | None = None,
    ) -> dict:
        """
        GET /<WABA_ID>?fields=pricing_analytics.start(...).end(...)... — Business Management API.
        See: https://developers.facebook.com/docs/whatsapp/business-management-api/analytics/
        """
        dims = dimensions or ["PRICING_CATEGORY", "PRICING_TYPE", "TIER", "COUNTRY"]
        metrics = metric_types or ["COST", "VOLUME"]
        dim_str = ",".join(dims)
        metric_str = ",".join(metrics)
        parts = [
            f"pricing_analytics.start({start_ts})",
            f".end({end_ts})",
            f".granularity({granularity})",
            f".metric_types({metric_str})",
            f".dimensions({dim_str})",
        ]
        if country_codes:
            parts.append(f".country_codes({','.join(country_codes)})")
        fields = "".join(parts)

        url = f"{GRAPH_ANALYTICS_BASE}/{waba_id}"
        headers = {"Authorization": f"Bearer {access_token}"}
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(url, headers=headers, params={"fields": fields})
            data = response.json()
            if response.status_code >= 400:
                raise RuntimeError(str(data))
            return data
