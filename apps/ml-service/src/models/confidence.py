"""Confidence scoring for price predictions."""
from typing import Any


def compute_confidence(
    predicted_p10: int,
    predicted_p50: int,
    predicted_p90: int,
    n_comparables: int,
    feature_completeness: float,
) -> dict[str, float]:
    """Compute 3-component confidence score.

    Args:
        predicted_p10: 10th percentile prediction (euros)
        predicted_p50: 50th percentile prediction (euros)
        predicted_p90: 90th percentile prediction (euros)
        n_comparables: number of similar vehicles in training data
        feature_completeness: proportion of key features available (0-1)

    Returns:
        Dict with sample_confidence, model_confidence, feature_confidence, overall_confidence
    """
    # Sample confidence: based on number of comparables
    # min(n / 30, 1.0) — need at least 30 comparables for full confidence
    sample_conf = min(n_comparables / 30.0, 1.0)

    # Model confidence: based on prediction interval width relative to median
    # Narrow intervals = high confidence
    if predicted_p50 > 0:
        interval_width = predicted_p90 - predicted_p10
        relative_width = interval_width / predicted_p50
        # Map relative width to confidence: 0.1 width → 0.95, 0.5 width → 0.5, 1.0+ → 0.1
        model_conf = max(0.05, min(1.0, 1.0 - relative_width))
    else:
        model_conf = 0.1

    # Feature confidence: proportion of key features available
    feature_conf = max(0.1, min(1.0, feature_completeness))

    # Overall: geometric mean of all three (balances all factors)
    overall = (sample_conf * model_conf * feature_conf) ** (1.0 / 3.0)
    overall = round(max(0.0, min(1.0, overall)), 3)

    return {
        "sample_confidence": round(sample_conf, 3),
        "model_confidence": round(model_conf, 3),
        "feature_confidence": round(feature_conf, 3),
        "overall_confidence": overall,
    }


def compute_feature_completeness(listing: dict[str, Any]) -> float:
    """Compute what proportion of key features are available.

    Key features (highest predictive value):
    - year, mileage, brand, model, power_kw (primary)
    - fuel_type, transmission, catalogusprijs (secondary)
    - co2_gkm, weight_kg, description (tertiary)
    """
    key_features = {
        # (field_name, weight) — weights sum to 1.0
        "year": 0.15,
        "mileage": 0.15,
        "brand": 0.10,
        "model": 0.10,
        "power_kw": 0.10,
        "fuel_type": 0.08,
        "transmission": 0.05,
        "catalogusprijs": 0.10,
        "co2_gkm": 0.05,
        "weight_kg": 0.05,
        "description": 0.04,
        "photo_count": 0.03,
    }

    available_weight = 0.0
    for field, weight in key_features.items():
        value = listing.get(field)
        if value is not None and value != "" and value != 0:
            available_weight += weight

    return round(min(1.0, available_weight / sum(key_features.values())), 3)


def compute_deal_score(
    actual_price: int,
    predicted_p10: int,
    predicted_p50: int,
) -> float:
    """Compute deal score.

    Formula: (predicted_median - actual_price) / (predicted_median - predicted_p10)

    Score interpretation:
    - 0.0 = priced at median (fair)
    - 1.0 = priced at p10 (good deal)
    - 2.0+ = extremely low (potential issue)
    - negative = above median (overpriced)
    """
    denominator = predicted_p50 - predicted_p10
    if denominator <= 0:
        # Edge case: p10 >= p50 (very tight distribution)
        if actual_price < predicted_p50:
            return 1.0
        elif actual_price > predicted_p50:
            return -1.0
        return 0.0

    score = (predicted_p50 - actual_price) / denominator
    return round(score, 3)


def classify_deal_tier(
    actual_price: int,
    predicted_p10: int,
    predicted_p50: int,
    predicted_p90: int,
) -> str:
    """Classify listing into 5-tier deal rating.

    Returns one of: OUTSTANDING, GREAT, FAIR, HIGH, OVERPRICED
    """
    # Compute approximate p05 and p15 from p10 and p50
    # p05 ≈ p10 - 0.5 * (p50 - p10)
    # p15 ≈ p10 + 0.5 * (p50 - p10)
    p05_approx = predicted_p10 - int(0.5 * (predicted_p50 - predicted_p10))
    p15_approx = predicted_p10 + int(0.5 * (predicted_p50 - predicted_p10))

    # p75 ≈ p50 + 0.5 * (p90 - p50)
    p75_approx = predicted_p50 + int(0.5 * (predicted_p90 - predicted_p50))

    if actual_price < p05_approx:
        return "OUTSTANDING"
    elif actual_price < p15_approx:
        return "GREAT"
    elif actual_price <= p75_approx:
        return "FAIR"
    elif actual_price <= predicted_p90:
        return "HIGH"
    else:
        return "OVERPRICED"


def apply_safety_caps(
    deal_tier: str,
    deal_score: float,
    red_flag_score: float = 0.0,
    confidence: float = 1.0,
) -> tuple[str, bool, str | None]:
    """Apply safety caps to deal tier based on red flags and confidence.

    Returns (effective_tier, has_safety_cap, safety_cap_reason)
    """
    effective_tier = deal_tier
    has_cap = False
    reason = None

    # Red flag cap: if significant red flags, cap at FAIR
    if red_flag_score >= 0.5:
        if deal_tier in ("OUTSTANDING", "GREAT"):
            effective_tier = "FAIR"
            has_cap = True
            reason = f"Red flag score {red_flag_score:.1f} — listing may have issues"

    # Low confidence cap: never claim great deal with low confidence
    if confidence < 0.5:
        if deal_tier in ("OUTSTANDING", "GREAT"):
            effective_tier = "FAIR"
            has_cap = True
            reason = (reason or "") + f"Low confidence ({confidence:.1%}) — insufficient data"

    # Suspicion check: deal_score > 2.5 is too good to be true
    if deal_score > 2.5:
        if deal_tier in ("OUTSTANDING", "GREAT"):
            effective_tier = "FAIR"
            has_cap = True
            reason = (reason or "") + f"Suspiciously low price (score {deal_score:.1f})"

    return effective_tier, has_cap, reason
