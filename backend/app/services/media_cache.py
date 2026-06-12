"""Cache downloaded WhatsApp media on disk for reliable inbox viewing."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import UUID

from app.core.config import get_settings

_logger = logging.getLogger("uvicorn.error")

_MIME_EXT: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "application/pdf": ".pdf",
}


def _tenant_dir(tenant_id: UUID | str) -> Path:
    root = Path(get_settings().media_cache_dir or "/app/media_cache")
    path = root / str(tenant_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _meta_file(tenant_id: UUID | str, message_id: UUID | str) -> Path:
    return _tenant_dir(tenant_id) / f"{message_id}.json"


def read_cached_media(*, tenant_id: UUID | str, message_id: UUID | str) -> tuple[bytes, str] | None:
    meta_path = _meta_file(tenant_id, message_id)
    if not meta_path.is_file():
        return None
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        data_path = Path(meta["file"])
        mime = meta.get("mime") or "application/octet-stream"
        if not data_path.is_file():
            return None
        return data_path.read_bytes(), mime
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        _logger.warning("Media cache read failed for %s: %s", message_id, exc)
        return None


def write_cached_media(*, tenant_id: UUID | str, message_id: UUID | str, content: bytes, mime: str) -> None:
    ext = _MIME_EXT.get(mime.split(";")[0].strip().lower(), ".bin")
    data_path = _tenant_dir(tenant_id) / f"{message_id}{ext}"
    meta_path = _meta_file(tenant_id, message_id)
    data_path.write_bytes(content)
    meta_path.write_text(
        json.dumps({"file": str(data_path), "mime": mime, "bytes": len(content)}),
        encoding="utf-8",
    )


def prefetch_message_media_sync(*, message_id: UUID | str, tenant_id: UUID | str, connection_id: UUID | str | None = None) -> None:
    """Download from Meta and cache (background-safe; uses own DB session)."""
    from app.core.secrets import decrypt_secret
    from app.db.session import SessionLocal
    from app.models.message import Message
    from app.models.whatsapp_connection import WhatsAppConnection
    from app.services.meta_client import MetaClient

    from app.utils.whatsapp_media import extract_waba_media_id

    if read_cached_media(tenant_id=tenant_id, message_id=message_id):
        return

    with SessionLocal() as db:
        msg = (
            db.query(Message)
            .filter(Message.id == message_id, Message.tenant_id == tenant_id)
            .first()
        )
        if not msg:
            return
        media_id = extract_waba_media_id(msg.type, dict(msg.payload) if msg.payload else None)
        if not media_id:
            return

        query = db.query(WhatsAppConnection).filter(
            WhatsAppConnection.tenant_id == tenant_id,
            WhatsAppConnection.is_active.is_(True),
        )
        connection = None
        if connection_id:
            connection = query.filter(WhatsAppConnection.id == connection_id).first()
        if not connection:
            connection = query.filter(WhatsAppConnection.is_default.is_(True)).first()
        if not connection:
            connection = query.order_by(WhatsAppConnection.created_at.asc()).first()
        if not connection:
            return

        token = decrypt_secret(connection.access_token) or ""
        if not token:
            return

    try:
        import asyncio

        content, mime = asyncio.run(MetaClient.download_media(media_id=media_id, access_token=token))
        write_cached_media(tenant_id=tenant_id, message_id=message_id, content=content, mime=mime)
    except Exception as exc:
        _logger.info("Media prefetch skipped for message %s: %s", message_id, exc)
