"""Resolve live API campaigns from AiSensy-style campaignName values."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models.campaign import Campaign


def resolve_live_api_campaign(
    *,
    db: Session,
    tenant_id: UUID,
    campaign_name: str,
) -> Campaign | None:
    """
    Match a live API campaign by dashboard name, then by linked template_name.

    Attendance CRMs often send Meta template names (e.g. parent_attendance_auto_in_agra)
    as campaignName when migrating from AiSensy.
    """
    key = campaign_name.strip()
    if not key:
        return None

    base = and_(
        Campaign.tenant_id == tenant_id,
        Campaign.campaign_type == "api",
        Campaign.status == "live",
    )

    by_name = db.query(Campaign).filter(base, Campaign.name == key).first()
    if by_name:
        return by_name

    return db.query(Campaign).filter(base, Campaign.template_name == key).first()


def template_params_to_body_parameters(template_params: list | None) -> list[dict] | None:
    if not template_params:
        return None
    out: list[dict] = []
    for item in template_params:
        if item is None:
            continue
        text = str(item).strip()
        if text:
            out.append({"type": "text", "text": text})
    return out or None
