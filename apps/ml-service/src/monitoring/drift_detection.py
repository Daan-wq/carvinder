"""Model drift detection using Population Stability Index (PSI)."""
import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# PSI thresholds
PSI_OK = 0.10          # No significant drift
PSI_WARNING = 0.20     # Moderate drift — investigate
PSI_CRITICAL = 0.25    # Severe drift — retrain immediately


def compute_psi(
    expected: np.ndarray,
    actual: np.ndarray,
    bins: int = 10,
) -> float:
    """Compute Population Stability Index between two distributions.

    PSI = Σ (actual_pct - expected_pct) * ln(actual_pct / expected_pct)

    Args:
        expected: baseline distribution (from training data)
        actual: current distribution (from recent predictions)
        bins: number of bins for histogram comparison

    Returns:
        PSI value. < 0.10 = stable, 0.10-0.25 = moderate drift, > 0.25 = significant
    """
    if len(expected) == 0 or len(actual) == 0:
        return 0.0

    # Create bins from expected distribution
    breakpoints = np.percentile(expected, np.linspace(0, 100, bins + 1))
    breakpoints[0] = -np.inf
    breakpoints[-1] = np.inf

    # Remove duplicate breakpoints
    breakpoints = np.unique(breakpoints)

    # Compute histograms
    expected_hist = np.histogram(expected, bins=breakpoints)[0]
    actual_hist = np.histogram(actual, bins=breakpoints)[0]

    # Convert to percentages (add small epsilon to avoid division by zero)
    eps = 1e-6
    expected_pct = (expected_hist + eps) / (expected_hist.sum() + eps * len(expected_hist))
    actual_pct = (actual_hist + eps) / (actual_hist.sum() + eps * len(actual_hist))

    # PSI formula
    psi = float(np.sum((actual_pct - expected_pct) * np.log(actual_pct / expected_pct)))

    return round(max(0.0, psi), 4)


def assess_drift(psi_score: float) -> dict[str, Any]:
    """Assess drift severity and recommended action."""
    if psi_score < PSI_OK:
        return {
            "severity": "OK",
            "action": "none",
            "message": f"PSI {psi_score:.4f} — no significant drift detected",
        }
    elif psi_score < PSI_WARNING:
        return {
            "severity": "WARNING",
            "action": "investigate",
            "message": f"PSI {psi_score:.4f} — moderate drift detected, investigate feature distributions",
        }
    elif psi_score < PSI_CRITICAL:
        return {
            "severity": "HIGH",
            "action": "retrain_soon",
            "message": f"PSI {psi_score:.4f} — significant drift, schedule retraining",
        }
    else:
        return {
            "severity": "CRITICAL",
            "action": "retrain_now",
            "message": f"PSI {psi_score:.4f} — severe drift, immediate retraining required",
        }


def compute_feature_drift(
    expected_features: dict[str, np.ndarray],
    actual_features: dict[str, np.ndarray],
) -> dict[str, dict[str, Any]]:
    """Compute PSI for each feature independently.

    Returns dict keyed by feature name with PSI scores and drift assessments.
    """
    results = {}
    for feature_name in expected_features:
        if feature_name not in actual_features:
            continue

        psi = compute_psi(expected_features[feature_name], actual_features[feature_name])
        assessment = assess_drift(psi)

        results[feature_name] = {
            "psi": psi,
            **assessment,
        }

    return results
