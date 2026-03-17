from datetime import datetime

from pydantic import BaseModel, Field


class ListingFeatures(BaseModel):
    """Input features for a car listing."""

    listing_id: str
    price: int
    year: int | None = None
    mileage: int | None = None
    fuel_type: str | None = None
    brand: str
    model: str
    transmission: str | None = None
    body_type: str | None = None
    power_kw: float | None = None
    description: str | None = None
    photo_count: int | None = None
    seller_type: str | None = None
    platform: str | None = None
    city: str | None = None
    province: str | None = None
    kenteken: str | None = None

    # RDW enrichment (optional)
    catalogusprijs: int | None = None
    weight_kg: int | None = None
    co2_gkm: int | None = None
    emission_class: str | None = None
    apk_days_remaining: int | None = None
    is_import: bool | None = None

    # NLP features (optional)
    has_damage_keywords: bool | None = None
    has_no_apk_keywords: bool | None = None
    has_export_keywords: bool | None = None
    has_premium_keywords: bool | None = None
    red_flag_score: float | None = None
    premium_flag_score: float | None = None
    description_length: int | None = None


class ScoringRequest(BaseModel):
    """Request to score multiple listings."""

    listings: list[ListingFeatures]


class PredictionResult(BaseModel):
    """Prediction result for a single listing."""

    listing_id: str
    model_version: str
    predicted_p10: int
    predicted_p50: int
    predicted_p90: int
    deal_score: float = Field(..., ge=0, le=100)
    deal_tier: str
    confidence: float = Field(..., ge=0, le=1)
    suspicion_flag: bool
    coverage_level: int = Field(..., ge=0, le=100)
    has_safety_cap: bool
    safety_cap_reason: str | None = None
    effective_deal_tier: str


class ScoringResponse(BaseModel):
    """Response with predictions for multiple listings."""

    predictions: list[PredictionResult]
    timestamp: str
    model_version: str


class TrainRequest(BaseModel):
    """Request to trigger model training."""

    force: bool = False


class TrainResponse(BaseModel):
    """Response after training trigger."""

    job_id: str
    status: str
    message: str


class ModelStatus(BaseModel):
    """Status of a single model version."""

    version: str
    status: str
    training_date: str
    dataset_size: int
    rmse_p50: float | None = None
    coverage_p10_p90: float | None = None
    r2_score: float | None = None
    psi_score: float | None = None


class ModelStatusResponse(BaseModel):
    """Status of champion and challenger models."""

    champion: ModelStatus | None = None
    challenger: ModelStatus | None = None
    total_predictions: int
    service_health: str


class HealthResponse(BaseModel):
    """Health status of the service."""

    status: str
    model_loaded: bool
    model_version: str | None = None
    database: str
    uptime_seconds: float
