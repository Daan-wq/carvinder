"""Dutch vehicle tax calculator (BPM, MRB, Milieuzone)."""
import logging
import re
from datetime import date, datetime
from typing import Any

logger = logging.getLogger(__name__)

# --- BPM (Registration Tax) 2026 Tariff ---
# Progressive CO2-based brackets for 2026
BPM_BASE_2026 = 687  # Base amount for all vehicles

BPM_CO2_BRACKETS_PETROL_2026 = [
    # (max_co2_gkm, rate_per_gkm)
    (79, 0),  # 0-79: included in base
    (106, 69.72),  # 80-106
    (148, 149.21),  # 107-148
    (170, 261.68),  # 149-170
    (195, 398.14),  # 171-195
    (float("inf"), 515.56),  # 196+
]

# Diesel surcharge: additional per-gram charge above 69 g/km
BPM_DIESEL_SURCHARGE_THRESHOLD = 69  # g/km
BPM_DIESEL_SURCHARGE_PER_GRAM = 114.83  # €/g/km above threshold

# EV flat BPM (from 2025 onward)
BPM_EV_FLAT = 687

# BPM depreciation schedule (forfaitaire afschrijvingstabel)
# (max_months, cumulative_depreciation_pct)
BPM_DEPRECIATION_TABLE = [
    (1, 0.02),
    (3, 0.08),
    (6, 0.24),
    (12, 0.35),
    (24, 0.47),
    (36, 0.58),
    (48, 0.66),
    (60, 0.73),
    (72, 0.78),
    (84, 0.82),
    (96, 0.85),
    (108, 0.88),
    (120, 0.90),
    (132, 0.91),
    (144, 0.92),
    (156, 0.93),
    (168, 0.94),
    (180, 0.95),
    (192, 0.96),
    (240, 0.97),  # 20+ years: max 97% depreciation (3% always remains)
]

# --- MRB (Road Tax) 2026 Rates ---
# Base quarterly rates by weight bracket and fuel type (approximate, for estimation)
# Source: belastingdienst.nl MRB tables
# Format: (max_weight_kg, quarterly_petrol, quarterly_diesel)
MRB_WEIGHT_BRACKETS = [
    (500, 20, 29),
    (600, 26, 37),
    (700, 32, 45),
    (800, 40, 56),
    (900, 55, 77),
    (1000, 78, 109),
    (1100, 107, 149),
    (1200, 142, 199),
    (1300, 175, 245),
    (1400, 203, 284),
    (1500, 231, 323),
    (1600, 258, 361),
    (1700, 286, 400),
    (1800, 313, 438),
    (1900, 341, 477),
    (2000, 369, 516),
    (2100, 396, 554),
    (2200, 424, 593),
    (2300, 451, 631),
    (2400, 479, 670),
    (2500, 506, 708),
    (2600, 534, 747),
    (2700, 562, 787),
    (2800, 589, 824),
    (2900, 617, 863),
    (3000, 644, 901),
    (3500, 780, 1092),
]

# Provincial opcenten multiplier (2026 estimates)
# Base rate × (1 + opcenten/100)
PROVINCE_OPCENTEN = {
    "noord-holland": 82.1,
    "flevoland": 89.0,
    "friesland": 92.7,
    "groningen": 95.5,
    "drenthe": 96.0,
    "overijssel": 97.8,
    "utrecht": 98.0,
    "gelderland": 98.5,
    "zeeland": 99.2,
    "noord-brabant": 100.3,
    "limburg": 101.5,
    "zuid-holland": 104.4,
}
DEFAULT_OPCENTEN = 97.0  # National average

# EV MRB trajectory (% of petrol rate)
EV_MRB_RATES = {
    2024: 0.00,  # Free
    2025: 0.25,  # 25% of petrol rate
    2026: 0.70,  # 70% of petrol rate
    2027: 0.70,
    2028: 0.70,
    2029: 0.85,
    2030: 1.00,  # Full rate
}

# Fijnstoftoeslag (particulate surcharge) for pre-2009 diesel without DPF
FIJNSTOF_SURCHARGE_PCT = 0.19  # 19% additional

# --- Milieuzone ---
# Minimum Euro class for diesel access to environmental zones
MILIEUZONE_MIN_EURO = 4  # Euro 4 minimum for Amsterdam, Den Haag, Utrecht, etc.


def calculate_bpm(
    co2_gkm: int | None,
    fuel_type: str | None,
    registration_year: int | None = None,
) -> int | None:
    """Calculate original BPM amount based on CO2 and fuel type.

    Returns estimated BPM in euros, or None if insufficient data.
    """
    if co2_gkm is None or fuel_type is None:
        return None

    fuel_lower = fuel_type.lower()

    # EVs pay flat rate
    if fuel_lower in ("elektrisch", "electric", "ev", "battery electric"):
        return BPM_EV_FLAT

    # Calculate CO2-based BPM
    bpm = BPM_BASE_2026
    remaining_co2 = co2_gkm
    prev_threshold = 0

    for max_co2, rate in BPM_CO2_BRACKETS_PETROL_2026:
        if remaining_co2 <= 0:
            break
        bracket_co2 = min(remaining_co2, max_co2 - prev_threshold)
        if bracket_co2 > 0 and rate > 0:
            bpm += bracket_co2 * rate
        remaining_co2 -= bracket_co2
        prev_threshold = max_co2

    # Diesel surcharge
    if fuel_lower in ("diesel",) and co2_gkm > BPM_DIESEL_SURCHARGE_THRESHOLD:
        surcharge_grams = co2_gkm - BPM_DIESEL_SURCHARGE_THRESHOLD
        bpm += surcharge_grams * BPM_DIESEL_SURCHARGE_PER_GRAM

    return round(bpm)


def calculate_bpm_remaining(
    original_bpm: int | None,
    first_registration: datetime | date | None,
    reference_date: datetime | date | None = None,
) -> dict[str, Any] | None:
    """Calculate remaining BPM based on depreciation schedule.

    Returns dict with bpm_remaining, depreciation_pct, age_months.
    """
    if original_bpm is None or first_registration is None:
        return None

    ref = reference_date or date.today()
    if isinstance(first_registration, datetime):
        first_registration = first_registration.date()
    if isinstance(ref, datetime):
        ref = ref.date()

    age_months = (ref.year - first_registration.year) * 12 + (
        ref.month - first_registration.month
    )
    age_months = max(0, age_months)

    # Find depreciation percentage
    depreciation_pct = 0.97  # Maximum (3% always remains)
    for max_months, pct in BPM_DEPRECIATION_TABLE:
        if age_months <= max_months:
            depreciation_pct = pct
            break

    remaining = round(original_bpm * (1 - depreciation_pct))

    return {
        "bpm_remaining": max(0, remaining),
        "depreciation_pct": depreciation_pct,
        "age_months": age_months,
    }


def calculate_mrb_annual(
    weight_kg: int | None,
    fuel_type: str | None,
    province: str | None = None,
    year: int = 2026,
) -> int | None:
    """Calculate estimated annual MRB (road tax).

    Returns annual MRB in euros, or None if insufficient data.
    """
    if weight_kg is None or fuel_type is None:
        return None

    fuel_lower = fuel_type.lower()

    # Find weight bracket
    quarterly_petrol: int = 0
    quarterly_diesel: int = 0
    for max_weight, q_petrol, q_diesel in MRB_WEIGHT_BRACKETS:
        if weight_kg <= max_weight:
            quarterly_petrol = int(q_petrol)
            quarterly_diesel = int(q_diesel)
            break
    else:
        # Above max bracket, extrapolate
        quarterly_petrol = int(MRB_WEIGHT_BRACKETS[-1][1])
        quarterly_diesel = int(MRB_WEIGHT_BRACKETS[-1][2])

    # Select base rate by fuel type
    if fuel_lower in ("diesel",):
        quarterly = quarterly_diesel
    elif fuel_lower in ("elektrisch", "electric", "ev", "battery electric"):
        ev_rate = EV_MRB_RATES.get(year, 1.0)
        quarterly = round(quarterly_petrol * ev_rate)
    elif fuel_lower in ("hybride", "hybrid", "plug-in hybride", "phev"):
        # Hybrids pay petrol rate (PHEV discount removed from 2026)
        quarterly = quarterly_petrol
    elif fuel_lower in ("lpg",):
        quarterly = round(quarterly_diesel * 1.1)  # LPG slightly above diesel
    else:
        quarterly = quarterly_petrol

    # Apply provincial opcenten
    province_lower = (province or "").lower().strip()
    opcenten = PROVINCE_OPCENTEN.get(province_lower, DEFAULT_OPCENTEN)
    quarterly_with_opcenten = round(quarterly * (1 + opcenten / 100))

    # Fijnstoftoeslag for old diesels (pre-2009, no DPF) — simplified check
    # In practice this requires Euro class check; we'll handle it if euro_klasse is available

    annual = quarterly_with_opcenten * 4
    return annual


def check_milieuzone_compliance(
    fuel_type: str | None,
    euro_class: str | None,
) -> dict[str, Any]:
    """Check if vehicle can enter Dutch environmental zones.

    Returns dict with is_compliant, warning_message.
    """
    if fuel_type is None:
        return {"is_compliant": None, "warning": None}

    fuel_lower = fuel_type.lower()

    # Only diesel is restricted in passenger car milieuzones
    if fuel_lower not in ("diesel",):
        return {"is_compliant": True, "warning": None}

    if euro_class is None:
        return {
            "is_compliant": None,
            "warning": "Euro class unknown — milieuzone access uncertain",
        }

    # Parse euro class number
    euro_num = _parse_euro_class(euro_class)

    if euro_num is None:
        return {
            "is_compliant": None,
            "warning": f"Cannot parse euro class: {euro_class}",
        }

    if euro_num < MILIEUZONE_MIN_EURO:
        return {
            "is_compliant": False,
            "warning": f"Euro {euro_num} diesel — banned from milieuzones (Amsterdam, Den Haag, Utrecht, Arnhem). Minimum Euro {MILIEUZONE_MIN_EURO} required.",
        }

    return {"is_compliant": True, "warning": None}


def _parse_euro_class(euro_class: str) -> int | None:
    """Parse Euro emission class string to numeric value."""
    if not euro_class:
        return None

    # Match patterns like "Euro 4", "Euro 6", "6d", "6d-temp", "EURO4"
    match = re.search(r"(\d)", str(euro_class))
    if match:
        return int(match.group(1))
    return None
