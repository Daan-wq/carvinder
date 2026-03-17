import asyncio
import logging
import shutil
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import get_db, get_model_state, set_model_loaded
from src.api.schemas import (
    HealthResponse,
    ModelStatusResponse,
    PredictionResult,
    ScoringRequest,
    ScoringResponse,
    TrainRequest,
    TrainResponse,
)
from src.config import settings
from src.data.feature_engineering import (
    compute_feature_completeness,
    engineer_features,
    get_numeric_feature_names,
    set_target_encodings,
)
from src.database import check_db_connection
from src.models.confidence import (
    apply_safety_caps,
    classify_deal_tier,
    compute_confidence,
    compute_deal_score,
)
from src.models.price_model import QuantilePriceModel
from src.models.training_pipeline import run_training_pipeline

logger = logging.getLogger(__name__)
router = APIRouter()

_startup_time: datetime | None = None
_training_jobs: dict[str, dict[str, Any]] = {}
_executor = ThreadPoolExecutor(max_workers=1)


def set_startup_time(t: datetime) -> None:
    global _startup_time
    _startup_time = t


@router.get("/health", response_model=HealthResponse, tags=["health"])
async def health_check(db: AsyncSession = Depends(get_db)) -> HealthResponse:
    try:
        db_status = await check_db_connection()
        model_version = None
        model_loaded = False

        try:
            state = get_model_state()
            model_version = state.get("version")
            model_loaded = True
        except HTTPException:
            pass

        uptime = 0.0
        if _startup_time:
            uptime = (datetime.now() - _startup_time).total_seconds()

        return HealthResponse(
            status="healthy" if db_status else "unhealthy",
            model_loaded=model_loaded,
            model_version=model_version,
            database="connected" if db_status else "disconnected",
            uptime_seconds=uptime,
        )
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return HealthResponse(
            status="unhealthy",
            model_loaded=False,
            model_version=None,
            database="error",
            uptime_seconds=0.0,
        )


@router.post("/api/score", response_model=ScoringResponse, tags=["scoring"])
async def score_listings(
    request: ScoringRequest,
    model_state: dict[str, Any] = Depends(get_model_state),
) -> ScoringResponse:
    model: QuantilePriceModel = model_state["model"]
    model_version: str = model_state.get("version", "unknown")

    numeric_cols = get_numeric_feature_names()
    predictions: list[PredictionResult] = []

    for listing in request.listings:
        try:
            listing_dict = listing.model_dump()

            features = engineer_features(listing_dict)
            df = pd.DataFrame([features])
            for col in numeric_cols:
                if col not in df.columns:
                    df[col] = 0
            X = df[numeric_cols].fillna(0)

            preds = model.predict(X)
            p10 = int(preds["p10"][0])
            p50 = int(preds["p50"][0])
            p90 = int(preds["p90"][0])

            red_flag = float(listing.red_flag_score or 0.0)
            feature_completeness = compute_feature_completeness(listing_dict)
            conf_scores = compute_confidence(p10, p50, p90, n_comparables=30, feature_completeness=feature_completeness)
            overall_confidence = conf_scores["overall_confidence"]

            raw_score = compute_deal_score(listing.price, p10, p50)
            # Normalize raw score (-inf..+inf) to 0-100 for schema
            deal_score_100 = float(max(0.0, min(100.0, (raw_score + 1.0) * 50.0)))

            deal_tier = classify_deal_tier(listing.price, p10, p50, p90)
            effective_tier, has_cap, cap_reason = apply_safety_caps(
                deal_tier, raw_score, red_flag, overall_confidence
            )

            suspicion_flag = raw_score > 2.5 or red_flag >= 0.5
            coverage_level = min(100, int(feature_completeness * 100))

            predictions.append(PredictionResult(
                listing_id=listing.listing_id,
                model_version=model_version,
                predicted_p10=p10,
                predicted_p50=p50,
                predicted_p90=p90,
                deal_score=deal_score_100,
                deal_tier=deal_tier,
                confidence=overall_confidence,
                suspicion_flag=suspicion_flag,
                coverage_level=coverage_level,
                has_safety_cap=has_cap,
                safety_cap_reason=cap_reason,
                effective_deal_tier=effective_tier,
            ))
        except Exception as e:
            logger.error(f"Error scoring listing {listing.listing_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to score listing {listing.listing_id}: {e}",
            )

    return ScoringResponse(
        predictions=predictions,
        timestamp=datetime.now().isoformat(),
        model_version=model_version,
    )


@router.post("/api/train", response_model=TrainResponse, tags=["training"])
async def trigger_training(
    request: TrainRequest,
    background_tasks: BackgroundTasks,
) -> TrainResponse:
    job_id = str(uuid.uuid4())
    _training_jobs[job_id] = {"status": "queued", "started_at": datetime.now().isoformat()}
    background_tasks.add_task(_run_training, job_id, request.force)

    return TrainResponse(
        job_id=job_id,
        status="queued",
        message=f"Training job {job_id} queued. Requires >= {settings.min_training_samples} samples.",
    )


async def _run_training(job_id: str, force: bool) -> None:
    _training_jobs[job_id]["status"] = "running"
    logger.info(f"Training job {job_id} starting...")

    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(_executor, run_training_pipeline, force)

        _training_jobs[job_id]["result"] = result

        if result["status"] == "COMPLETED":
            save_dir = Path(result["save_path"])
            model_dir = Path(settings.ml_model_dir)

            # Load new model
            new_model = QuantilePriceModel()
            new_model.load(save_dir)

            # Load and apply target encodings
            encodings = joblib.load(save_dir / "encodings.pkl")
            set_target_encodings(
                encodings["brand_encoding"],
                encodings["model_encoding"],
                encodings["global_mean_log_price"],
            )

            # Promote to champion
            shutil.copy(save_dir / "model.pkl", model_dir / "champion.pkl")
            joblib.dump(encodings, model_dir / "champion_encodings.pkl")

            # Hot-reload model in service
            set_model_loaded(new_model, new_model.version)

            _training_jobs[job_id]["status"] = "completed"
            logger.info(f"Training job {job_id} completed. Model version: {new_model.version}")
        else:
            _training_jobs[job_id]["status"] = "skipped"
            logger.warning(f"Training job {job_id} skipped: {result.get('message')}")

    except Exception as e:
        _training_jobs[job_id]["status"] = "failed"
        _training_jobs[job_id]["error"] = str(e)
        logger.error(f"Training job {job_id} failed: {e}", exc_info=True)


@router.get("/api/train/{job_id}", tags=["training"])
async def get_training_status(job_id: str) -> dict[str, Any]:
    job = _training_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Training job {job_id} not found")
    return {"job_id": job_id, **job}


@router.get("/api/model/status", response_model=ModelStatusResponse, tags=["model"])
async def get_model_status(
    db: AsyncSession = Depends(get_db),
) -> ModelStatusResponse:
    return ModelStatusResponse(
        champion=None,
        challenger=None,
        total_predictions=0,
        service_health="initializing",
    )
