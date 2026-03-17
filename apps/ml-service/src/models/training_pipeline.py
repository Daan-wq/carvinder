"""End-to-end model training pipeline."""
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sqlalchemy import create_engine, text

from src.config import settings
from src.data.feature_engineering import (
    compute_target_encoding,
    engineer_features,
    get_numeric_feature_names,
    prepare_dataframe,
    set_target_encodings,
)
from src.models.price_model import QuantilePriceModel

logger = logging.getLogger(__name__)

# Training window: 12 months with exponential decay
TRAINING_WINDOW_MONTHS = 12
DECAY_WEIGHTS = {
    # (months_ago_min, months_ago_max): weight
    (0, 3): 1.0,
    (3, 6): 0.5,
    (6, 9): 0.35,
    (9, 12): 0.25,
}


def run_training_pipeline(
    force: bool = False,
) -> dict[str, Any]:
    """Execute the full training pipeline.

    Steps:
    1. Load historical listings from database
    2. Apply temporal decay weights
    3. Engineer features
    4. Compute target encodings
    5. Split train/validation (80/20 temporal)
    6. Train quantile models
    7. Evaluate and save

    Returns dict with version, metrics, and save path.
    """
    version = f"v{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    logger.info(f"Starting training pipeline: {version}")

    # Step 1: Load data
    engine = create_engine(settings.database_url, connect_args={"sslmode": "disable"})

    window_start = datetime.now() - timedelta(days=TRAINING_WINDOW_MONTHS * 30)

    query = text("""
        SELECT
            cl.id as listing_id,
            cl.make as brand,
            cl.model,
            cl.year,
            cl.mileage,
            cl.price,
            cl."fuelType" as fuel_type,
            cl.transmission,
            cl.condition,
            cl.city,
            cl.source as platform,
            cl.description,
            cl.kenteken,
            cl."createdAt" as created_at,
            cl."imageUrls" as image_urls,
            nlp."hasDamageKeywords" as has_damage_keywords,
            nlp."hasNoApkKeywords" as has_no_apk_keywords,
            nlp."hasExportKeywords" as has_export_keywords,
            nlp."hasPremiumKeywords" as has_premium_keywords,
            nlp."redFlagScore" as red_flag_score,
            nlp."premiumFlagScore" as premium_flag_score,
            nlp."descriptionLength" as description_length,
            nlp."photoCount" as photo_count,
            rdw."catalogusprijs",
            rdw."gewicht" as weight_kg,
            rdw."co2Uitstoot" as co2_gkm,
            rdw."euroKlasse" as emission_class,
            rdw."vermogenKw" as power_kw,
            rdw."eersteToelating" as eerste_toelating,
            rdw."eersteTenaamstellingNl" as eerste_tenaamstelling_nl,
            rdw."apkVervaldatum" as apk_vervaldatum,
            rdw."eersteKleur" as eerste_kleur
        FROM car_listings cl
        LEFT JOIN listing_nlp_features nlp ON nlp."listingId" = cl.id
        LEFT JOIN listing_tax_data tax ON tax."listingId" = cl.id
        LEFT JOIN rdw_vehicle_data rdw ON rdw.kenteken = cl.kenteken
        WHERE cl."isActive" = true
            AND cl.condition != 'DAMAGED'
            AND cl.price >= 500
            AND cl.price <= 500000
            AND cl."createdAt" >= :window_start
            AND cl.year IS NOT NULL
            AND cl.mileage IS NOT NULL
    """)

    with engine.connect() as conn:
        df_raw = pd.read_sql(query, conn, params={"window_start": window_start})

    logger.info(f"Loaded {len(df_raw)} listings from database")

    if len(df_raw) < settings.min_training_samples:
        msg = f"Insufficient data: {len(df_raw)} < {settings.min_training_samples} minimum"
        logger.warning(msg)
        if not force:
            return {"status": "SKIPPED", "message": msg, "version": version}

    # Step 2: Apply temporal decay weights
    df_raw["created_at"] = pd.to_datetime(df_raw["created_at"])
    now = pd.Timestamp.now()
    df_raw["months_ago"] = ((now - df_raw["created_at"]).dt.days / 30).clip(lower=0)

    df_raw["sample_weight"] = 0.25  # default for oldest
    for (min_m, max_m), weight in DECAY_WEIGHTS.items():
        mask = (df_raw["months_ago"] >= min_m) & (df_raw["months_ago"] < max_m)
        df_raw.loc[mask, "sample_weight"] = weight

    # Step 3: Engineer features
    listings_dicts = df_raw.to_dict("records")

    # Step 4: Compute target encodings
    df_raw["log_price"] = np.log(df_raw["price"].clip(lower=1))
    global_mean = float(df_raw["log_price"].mean())

    df_raw["brand_lower"] = df_raw["brand"].str.lower().str.strip()
    df_raw["model_key"] = df_raw["brand_lower"] + "_" + df_raw["model"].str.lower().str.strip()

    brand_enc = compute_target_encoding(df_raw.rename(columns={"brand_lower": "brand_col"}), "brand_col", "log_price", k=30)
    # Remap keys back
    brand_enc = {k: v for k, v in brand_enc.items()}

    model_enc = compute_target_encoding(df_raw, "model_key", "log_price", k=30)

    set_target_encodings(brand_enc, model_enc, global_mean)

    # Transform all listings to features
    feature_rows = [engineer_features(row) for row in listings_dicts]
    df_features = pd.DataFrame(feature_rows)

    numeric_cols = get_numeric_feature_names()
    for col in numeric_cols:
        if col not in df_features.columns:
            df_features[col] = 0

    X = df_features[numeric_cols].fillna(0)
    y = df_raw["log_price"]
    weights = df_raw["sample_weight"]

    # Step 5: Temporal train/validation split (80/20)
    split_idx = int(len(X) * 0.8)
    sorted_indices = df_raw["created_at"].argsort()

    train_idx = sorted_indices[:split_idx]
    val_idx = sorted_indices[split_idx:]

    X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
    y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]

    logger.info(f"Train: {len(X_train)}, Validation: {len(X_val)}")

    # Step 6: Train model
    model = QuantilePriceModel()
    model.version = version
    metrics = model.train(X_train, y_train, X_val, y_val)

    # Step 7: Save model
    save_dir = Path(settings.ml_model_dir) / version
    model.save(save_dir)

    # Also save target encodings
    joblib.dump({
        "brand_encoding": brand_enc,
        "model_encoding": model_enc,
        "global_mean_log_price": global_mean,
    }, save_dir / "encodings.pkl")

    logger.info(f"Training complete. Version: {version}, Metrics: {metrics}")

    return {
        "status": "COMPLETED",
        "version": version,
        "metrics": metrics,
        "dataset_size": len(df_raw),
        "feature_count": len(numeric_cols),
        "save_path": str(save_dir),
        "training_window": {
            "start": window_start.isoformat(),
            "end": datetime.now().isoformat(),
        },
    }
