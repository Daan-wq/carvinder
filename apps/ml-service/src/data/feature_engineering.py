"""Feature engineering pipeline for car price prediction."""
import logging
import math
from datetime import date, datetime
from typing import Any

import pandas as pd

from src.data.tax_calculator import calculate_bpm, calculate_bpm_remaining, calculate_mrb_annual

logger = logging.getLogger(__name__)

# Average annual mileage by fuel type (Dutch market)
AVG_ANNUAL_KM = {
    "petrol": 11_100,
    "diesel": 17_600,
    "electric": 18_100,
    "hybrid": 15_000,
    "lpg": 14_000,
    "default": 12_300,
}

# Round mileage thresholds for left-digit bias
ROUND_MILEAGE_THRESHOLDS = [50_000, 100_000, 150_000, 200_000]
ROUND_MILEAGE_WINDOW = 2_000  # km within threshold

# Target encoding globals (set during training, used during prediction)
_brand_encoding: dict[str, float] = {}
_model_encoding: dict[str, float] = {}
_global_mean_log_price: float = 0.0


def set_target_encodings(
    brand_enc: dict[str, float],
    model_enc: dict[str, float],
    global_mean: float,
) -> None:
    """Set target encodings (called after training)."""
    global _brand_encoding, _model_encoding, _global_mean_log_price
    _brand_encoding = brand_enc
    _model_encoding = model_enc
    _global_mean_log_price = global_mean


def compute_target_encoding(
    df: pd.DataFrame,
    column: str,
    target: str = "log_price",
    k: int = 30,
) -> dict[str, float]:
    """Compute Bayesian-smoothed target encoding for a categorical column.

    encoded = (n * group_mean + k * global_mean) / (n + k)
    """
    global_mean = df[target].mean()
    stats = df.groupby(column)[target].agg(["mean", "count"]).reset_index()
    stats.columns = [column, "group_mean", "n"]
    stats["encoded"] = (
        stats["n"] * stats["group_mean"] + k * global_mean
    ) / (stats["n"] + k)
    return dict(zip(stats[column], stats["encoded"], strict=True))


def engineer_features(listing: dict[str, Any]) -> dict[str, Any]:
    """Transform a single listing into the full feature vector.

    Input: dict with listing data, RDW enrichment, NLP features.
    Output: dict with ~35 engineered features ready for model input.
    """
    features: dict[str, Any] = {}

    now = datetime.now()

    # --- From listing data ---
    features["brand"] = (listing.get("brand") or "unknown").lower().strip()
    features["model_name"] = (listing.get("model") or "unknown").lower().strip()
    features["fuel_type"] = _normalize_fuel(listing.get("fuel_type"))
    features["transmission"] = _normalize_transmission(listing.get("transmission"))
    features["body_type"] = (listing.get("body_type") or "unknown").lower().strip()
    features["power_kw"] = listing.get("power_kw") or 0
    features["mileage_km"] = listing.get("mileage") or 0
    features["seller_type"] = (
        1 if (listing.get("seller_type") or "").lower() in ("dealer", "DEALER") else 0
    )
    features["platform"] = (listing.get("platform") or "unknown").lower().strip()
    features["photo_count"] = listing.get("photo_count") or 0
    features["province"] = (listing.get("province") or "unknown").lower().strip()

    # Extended listing fields
    features["doors"] = listing.get("doors") or 0
    features["previous_owners"] = listing.get("previous_owners") or listing.get("previousOwners") or -1
    features["has_nap"] = int(listing.get("has_nap") or listing.get("hasNap") or 0)
    features["warranty_months"] = listing.get("warranty_months") or listing.get("warrantyMonths") or 0
    features["engine_cc_listing"] = listing.get("engine_cc") or listing.get("engineCc") or 0
    features["body_type"] = (listing.get("body_type") or listing.get("bodyType") or "unknown").lower().strip()
    features["color_group"] = _normalize_color(listing.get("color"))

    options = listing.get("options") or []
    if isinstance(options, str):
        options = [options]
    features["has_tow_hook"] = int("tow_hook" in options)
    features["has_air_conditioning"] = int("air_conditioning" in options)
    features["has_navigation"] = int("navigation" in options)
    features["has_leather_seats"] = int("leather_seats" in options)
    features["has_panoramic_roof"] = int("panoramic_roof" in options)
    features["has_parking_sensors"] = int("parking_sensors" in options)

    # --- Age calculation ---
    year = listing.get("year")
    eerste_toelating = listing.get("eerste_toelating")

    if eerste_toelating and isinstance(eerste_toelating, (datetime, date)):
        age_days = (
            now.date()
            - (
                eerste_toelating.date()
                if isinstance(eerste_toelating, datetime)
                else eerste_toelating
            )
        ).days
        features["age_years"] = max(0, age_days / 365.25)
    elif year and isinstance(year, (int, float)):
        features["age_years"] = max(0, now.year - int(year) + (now.month - 6) / 12)
    else:
        features["age_years"] = 0

    # --- From RDW enrichment ---
    features["catalogusprijs"] = listing.get("catalogusprijs") or 0
    features["weight_kg"] = listing.get("weight_kg") or 0
    features["co2_gkm"] = listing.get("co2_gkm") or 0
    features["emission_class"] = _parse_euro_num(listing.get("emission_class"))
    features["engine_cc"] = listing.get("cilinderinhoud") or 0

    # APK days remaining
    apk_date = listing.get("apk_vervaldatum")
    if apk_date and isinstance(apk_date, (datetime, date)):
        apk_dt = apk_date if isinstance(apk_date, date) else apk_date.date()
        features["apk_days_remaining"] = max(0, (apk_dt - now.date()).days)
    else:
        features["apk_days_remaining"] = listing.get("apk_days_remaining") or -1

    # Import flag
    eerste_toelating_val = listing.get("eerste_toelating")
    eerste_nl = listing.get("eerste_tenaamstelling_nl")
    if eerste_toelating_val and eerste_nl:
        features["is_import"] = 1 if eerste_toelating_val != eerste_nl else 0
    else:
        features["is_import"] = int(listing.get("is_import") or 0)

    features["eerste_kleur"] = (listing.get("eerste_kleur") or "unknown").lower().strip()

    # --- Derived features ---
    price = listing.get("price") or 0
    features["log_price"] = math.log(max(price, 1))
    features["log_mileage"] = math.log(max(features["mileage_km"], 1))

    age = features["age_years"]
    if age > 0:
        features["km_per_year"] = features["mileage_km"] / age
    else:
        features["km_per_year"] = 0

    if features["catalogusprijs"] > 0:
        features["depreciation_ratio"] = price / features["catalogusprijs"]
    else:
        features["depreciation_ratio"] = 0

    if features["power_kw"] > 0:
        features["price_per_kw"] = price / features["power_kw"]
    else:
        features["price_per_kw"] = 0

    features["age_squared"] = age**2

    # Mileage deviation from expected
    fuel_key = (
        features["fuel_type"]
        if features["fuel_type"] in AVG_ANNUAL_KM
        else "default"
    )
    expected_km = AVG_ANNUAL_KM[fuel_key] * max(age, 0.5)
    features["mileage_deviation"] = features["mileage_km"] - expected_km

    # Left-digit mileage bias
    km = features["mileage_km"]
    features["is_round_mileage_50k"] = int(
        any(
            abs(km - threshold) <= ROUND_MILEAGE_WINDOW
            for threshold in ROUND_MILEAGE_THRESHOLDS
        )
    )

    # Tax features
    bpm = calculate_bpm(
        listing.get("co2_gkm"),
        listing.get("fuel_type"),
    )
    bpm_remaining = calculate_bpm_remaining(
        bpm,
        eerste_toelating_val,
    )
    features["bpm_remaining"] = bpm_remaining["bpm_remaining"] if bpm_remaining else 0

    mrb = calculate_mrb_annual(
        listing.get("weight_kg"),
        listing.get("fuel_type"),
        listing.get("province"),
    )
    features["annual_mrb_estimate"] = mrb or 0

    # Listing age (days on market) — longer-listed cars tend to be overpriced
    listed_at = listing.get("listed_at") or listing.get("listedAt")
    if listed_at and isinstance(listed_at, (datetime, date)):
        listed_dt = listed_at.date() if isinstance(listed_at, datetime) else listed_at
        features["listing_age_days"] = max(0, (now.date() - listed_dt).days)
    else:
        features["listing_age_days"] = -1  # unknown

    # Seasonal
    features["quarter_listed"] = (now.month - 1) // 3 + 1
    features["month_sin"] = math.sin(2 * math.pi * now.month / 12)
    features["month_cos"] = math.cos(2 * math.pi * now.month / 12)

    # Platform bias factor (Marktplaats tends lower)
    platform_bias = {
        "marktplaats": -0.05,
        "autoscout": 0.0,
        "autotrack": 0.0,
        "facebook": -0.08,
    }
    features["platform_bias_factor"] = platform_bias.get(features["platform"], 0.0)

    # --- NLP features ---
    features["has_damage_keywords"] = int(listing.get("has_damage_keywords") or 0)
    features["has_no_apk_keywords"] = int(listing.get("has_no_apk_keywords") or 0)
    features["has_export_keywords"] = int(listing.get("has_export_keywords") or 0)
    features["has_premium_keywords"] = int(listing.get("has_premium_keywords") or 0)
    features["red_flag_score"] = listing.get("red_flag_score") or 0.0
    features["premium_flag_score"] = listing.get("premium_flag_score") or 0.0
    features["description_length"] = listing.get("description_length") or 0

    # --- Target encoding ---
    brand = features["brand"]
    model_name = features["model_name"]
    features["brand_target_enc"] = _brand_encoding.get(brand, _global_mean_log_price)
    features["model_target_enc"] = _model_encoding.get(
        f"{brand}_{model_name}", _global_mean_log_price
    )

    return features


def prepare_dataframe(listings: list[dict[str, Any]]) -> pd.DataFrame:
    """Transform a list of listings into a feature DataFrame ready for model input."""
    feature_rows = [engineer_features(listing) for listing in listings]
    df = pd.DataFrame(feature_rows)

    # Define column order for model input
    numeric_cols = get_numeric_feature_names()

    # Ensure all columns exist
    for col in numeric_cols:
        if col not in df.columns:
            df[col] = 0

    return df[numeric_cols]


def get_numeric_feature_names() -> list[str]:
    """Return ordered list of numeric feature names for model input."""
    return [
        "age_years",
        "mileage_km",
        "power_kw",
        "photo_count",
        "catalogusprijs",
        "weight_kg",
        "co2_gkm",
        "emission_class",
        "engine_cc",
        "apk_days_remaining",
        "is_import",
        "log_mileage",
        "km_per_year",
        "depreciation_ratio",
        "price_per_kw",
        "age_squared",
        "mileage_deviation",
        "is_round_mileage_50k",
        "bpm_remaining",
        "annual_mrb_estimate",
        "listing_age_days",
        "quarter_listed",
        "month_sin",
        "month_cos",
        "platform_bias_factor",
        "seller_type",
        "doors",
        "previous_owners",
        "has_nap",
        "warranty_months",
        "engine_cc_listing",
        "has_tow_hook",
        "has_air_conditioning",
        "has_navigation",
        "has_leather_seats",
        "has_panoramic_roof",
        "has_parking_sensors",
        "has_damage_keywords",
        "has_no_apk_keywords",
        "has_export_keywords",
        "has_premium_keywords",
        "red_flag_score",
        "premium_flag_score",
        "description_length",
        "brand_target_enc",
        "model_target_enc",
    ]


def _normalize_color(color: str | None) -> str:
    """Group Dutch/English color names into 6 buckets."""
    if not color:
        return "unknown"
    c = color.lower().strip()
    if any(x in c for x in ["zwart", "black"]):
        return "black"
    if any(x in c for x in ["wit", "white", "creme", "cream", "beige"]):
        return "white"
    if any(x in c for x in ["grijs", "grey", "gray", "zilver", "silver"]):
        return "grey"
    if any(x in c for x in ["rood", "red", "bordeaux", "burgundy"]):
        return "red"
    if any(x in c for x in ["blauw", "blue", "navy"]):
        return "blue"
    if any(x in c for x in ["groen", "green"]):
        return "green"
    return "other"


def _normalize_fuel(fuel: str | None) -> str:
    """Normalize fuel type string."""
    if not fuel:
        return "unknown"
    fuel = fuel.lower().strip()
    mapping = {
        "benzine": "petrol",
        "petrol": "petrol",
        "diesel": "diesel",
        "elektrisch": "electric",
        "electric": "electric",
        "ev": "electric",
        "hybride": "hybrid",
        "hybrid": "hybrid",
        "plug-in hybride": "hybrid",
        "phev": "hybrid",
        "lpg": "lpg",
    }
    return mapping.get(fuel, "other")


def _normalize_transmission(trans: str | None) -> str:
    """Normalize transmission string."""
    if not trans:
        return "unknown"
    trans = trans.lower().strip()
    if "auto" in trans:
        return "automatic"
    if "hand" in trans or "manual" in trans:
        return "manual"
    return "other"


def _parse_euro_num(euro_class: str | None) -> int:
    """Parse Euro emission class to numeric."""
    if not euro_class:
        return 0
    import re

    match = re.search(r"(\d)", str(euro_class))
    return int(match.group(1)) if match else 0
