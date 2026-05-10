"""Responses for Meta WhatsApp Business Account pricing analytics (Graph API)."""

from pydantic import BaseModel, Field


class MetaPricingDataPoint(BaseModel):
    start: int
    end: int
    cost: float | None = None
    volume: int | None = None
    country: str | None = None
    pricing_category: str | None = None
    pricing_type: str | None = None
    tier: str | None = None
    phone_number: str | None = None


class MetaPricingAnalyticsResponse(BaseModel):
    waba_id: str
    connection_id: str | None = None
    connection_label: str | None = None
    disclaimer: str = Field(
        default=(
            "Approximate charges from Meta pricing analytics in your WABA billing currency (often INR for India). "
            "Not a tax invoice—reconcile with Meta Billing Hub. "
            "COST may be omitted for some partner-billed WABAs."
        )
    )
    fetched_at: str
    start_ts: int
    end_ts: int
    granularity: str
    summary_total_cost: float = Field(description="Sum of cost across returned data points (Meta buckets).")
    summary_total_volume: int = Field(default=0, description="Sum of volume across returned data points.")
    data_points: list[MetaPricingDataPoint]
