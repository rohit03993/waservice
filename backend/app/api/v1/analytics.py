"""In-app analytics backed by Meta WhatsApp Business Account APIs where applicable."""

from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_admin_membership
from app.api.v1.whatsapp import _resolve_connection
from app.core.secrets import decrypt_secret
from app.db.session import get_db
from app.models.membership import Membership
from app.schemas.meta_analytics import MetaPricingAnalyticsResponse, MetaPricingDataPoint
from app.services.meta_client import MetaClient

router = APIRouter(prefix="/analytics", tags=["analytics"])

_MAX_RANGE_SECONDS = 90 * 24 * 3600


def _flatten_pricing_data_points(graph_payload: dict) -> list[dict]:
    out: list[dict] = []
    pa = graph_payload.get("pricing_analytics") or {}
    for block in pa.get("data") or []:
        if not isinstance(block, dict):
            continue
        for dp in block.get("data_points") or []:
            if isinstance(dp, dict):
                out.append(dp)
    return out


def _num(v: object) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int_or_none(v: object) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _point_from_raw(raw: dict) -> MetaPricingDataPoint:
    return MetaPricingDataPoint(
        start=int(raw["start"]),
        end=int(raw["end"]),
        cost=_num(raw.get("cost")),
        volume=_int_or_none(raw.get("volume")),
        country=(str(raw["country"]).strip() if raw.get("country") else None),
        pricing_category=(str(raw["pricing_category"]).strip() if raw.get("pricing_category") else None),
        pricing_type=(str(raw["pricing_type"]).strip() if raw.get("pricing_type") else None),
        tier=(str(raw["tier"]).strip() if raw.get("tier") else None),
        phone_number=(str(raw["phone_number"]).strip() if raw.get("phone_number") else None),
    )


@router.get("/meta-pricing", response_model=MetaPricingAnalyticsResponse)
async def get_meta_pricing_analytics(
    start_ts: int = Query(..., description="Unix timestamp (seconds), range start"),
    end_ts: int = Query(..., description="Unix timestamp (seconds), range end"),
    granularity: Literal["DAILY", "HALF_HOUR", "MONTHLY"] = Query(default="DAILY"),
    connection_id: UUID | None = Query(default=None, description="WhatsApp connection id; default connection if omitted"),
    country_codes: str | None = Query(
        default=None,
        description="Optional comma-separated ISO 3166-1 alpha-2 codes (e.g. US,IN)",
    ),
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> MetaPricingAnalyticsResponse:
    if start_ts >= end_ts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start_ts must be before end_ts")
    if end_ts - start_ts > _MAX_RANGE_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Date range too large (max 90 days for this endpoint).",
        )

    connection = _resolve_connection(
        db=db,
        tenant_id=membership.tenant_id,
        connection_id=str(connection_id) if connection_id else None,
        require_waba=True,
    )
    waba_id = (connection.waba_id or "").strip()
    if not waba_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Connection has no WABA ID. Add it in WhatsApp Settings.",
        )

    token = decrypt_secret(connection.access_token) or ""
    if not token.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Access token is missing for this connection")

    cc_list: list[str] | None = None
    if country_codes and country_codes.strip():
        cc_list = [c.strip().upper() for c in country_codes.split(",") if c.strip()]

    try:
        raw = await MetaClient.fetch_waba_pricing_analytics(
            waba_id=waba_id,
            access_token=token,
            start_ts=start_ts,
            end_ts=end_ts,
            granularity=granularity,
            country_codes=cc_list,
        )
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Meta pricing analytics failed: {exc}",
        ) from exc

    flat = _flatten_pricing_data_points(raw if isinstance(raw, dict) else {})
    points: list[MetaPricingDataPoint] = []
    for item in flat:
        try:
            points.append(_point_from_raw(item))
        except (KeyError, TypeError, ValueError):
            continue

    total_cost = sum((p.cost or 0.0) for p in points)
    total_volume = sum((p.volume or 0) for p in points)

    return MetaPricingAnalyticsResponse(
        waba_id=waba_id,
        connection_id=str(connection.id),
        connection_label=connection.label,
        fetched_at=datetime.now(timezone.utc).isoformat(),
        start_ts=start_ts,
        end_ts=end_ts,
        granularity=granularity,
        summary_total_cost=round(total_cost, 6),
        summary_total_volume=total_volume,
        data_points=points,
    )
