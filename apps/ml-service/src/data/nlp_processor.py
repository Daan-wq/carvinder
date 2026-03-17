"""Dutch-language NLP feature extraction for car listing descriptions."""
import re
from dataclasses import dataclass

# Red-flag keywords with severity weights (0-1)
RED_FLAG_KEYWORDS: dict[str, float] = {
    # Damage
    "schade": 0.8,
    "schadeauto": 0.9,
    "schadeverleden": 0.7,
    "ongeval": 0.9,
    "aanrijding": 0.9,
    "total loss": 1.0,
    "beschadigd": 0.7,
    "roest": 0.6,
    "roestvrij": -0.3,  # negative = cancel out if "roestvrij" (rust-free)
    "deuk": 0.5,
    "deuken": 0.5,
    "kras": 0.4,
    "krassen": 0.4,
    "lakschade": 0.5,
    # Non-running
    "niet rijdend": 0.9,
    "defect": 0.7,
    "motor kapot": 0.9,
    "versnellingsbak kapot": 0.9,
    "turbo kapot": 0.8,
    "voor onderdelen": 1.0,
    "voor de onderdelen": 1.0,
    "sloop": 0.9,
    "sloperij": 0.9,
    # No APK
    "geen apk": 0.8,
    "apk verlopen": 0.7,
    "zonder apk": 0.8,
    "apk tot": -0.1,  # neutral - just stating expiry
    # Export / deregistered
    "export": 0.6,
    "geëxporteerd": 0.8,
    "uitgeschreven": 0.7,
    "uitgeschreven bij rdw": 0.8,
    # Project cars
    "project": 0.5,
    "hobbyist": 0.4,
    "restauratie": 0.5,
    "opknapper": 0.6,
    "opknappertje": 0.6,
}

# Premium keywords with value weights (0-1)
PREMIUM_KEYWORDS: dict[str, float] = {
    "leder": 0.7,
    "lederen": 0.7,
    "leer": 0.6,
    "panoramadak": 0.8,
    "panorama": 0.6,
    "schuifdak": 0.5,
    "navigatie": 0.5,
    "navi": 0.4,
    "trekhaak": 0.4,
    "winterbanden": 0.3,
    "keyless": 0.5,
    "keyless entry": 0.5,
    "sportpakket": 0.7,
    "s-line": 0.6,
    "m-pakket": 0.7,
    "amg": 0.8,
    "r-line": 0.6,
    "head-up": 0.6,
    "head up display": 0.6,
    "stoelverwarming": 0.4,
    "achteruitrijcamera": 0.4,
    "camera": 0.3,
    "360 camera": 0.5,
    "harman kardon": 0.5,
    "bose": 0.4,
    "bang olufsen": 0.5,
    "b&o": 0.5,
    "volledig onderhouden": 0.5,
    "dealer onderhouden": 0.6,
    "1e eigenaar": 0.5,
    "eerste eigenaar": 0.5,
    "nieuwstaat": 0.6,
    "als nieuw": 0.5,
    "adaptive cruise": 0.5,
    "acc": 0.3,
    "lane assist": 0.4,
    "led koplampen": 0.3,
    "matrix led": 0.5,
    "xenon": 0.3,
    "elektrische stoelen": 0.4,
}

# Placeholder price patterns
PLACEHOLDER_PRICES = {0, 1, 2, 99, 100, 111, 123, 999, 1234, 9999, 99999, 12345}

PLACEHOLDER_RANGES = [
    (0, 10),  # €0-10: likely placeholder
    (99998, 100001),  # Around €99999/€100000
]


@dataclass
class NLPFeatures:
    """Extracted NLP features from a listing."""

    has_damage_keywords: bool
    has_non_running_keywords: bool
    has_no_apk_keywords: bool
    has_export_keywords: bool
    has_project_keywords: bool
    has_premium_keywords: bool
    red_flag_count: int
    red_flag_score: float
    premium_flag_count: int
    premium_flag_score: float
    description_length: int
    description_quality: float  # 0-1
    photo_count: int
    is_placeholder_price: bool


def extract_nlp_features(
    description: str | None,
    title: str | None = None,
    price: int | None = None,
    photo_count: int = 0,
) -> NLPFeatures:
    """Extract NLP features from listing text."""
    text = ""
    if title:
        text += title.lower() + " "
    if description:
        text += description.lower()

    text = text.strip()

    # Check red flags by category
    damage_found = _check_keywords(
        text,
        {
            k: v
            for k, v in RED_FLAG_KEYWORDS.items()
            if k
            in (
                "schade",
                "schadeauto",
                "schadeverleden",
                "ongeval",
                "aanrijding",
                "total loss",
                "beschadigd",
                "roest",
                "deuk",
                "deuken",
                "kras",
                "krassen",
                "lakschade",
            )
        },
    )

    non_running_found = _check_keywords(
        text,
        {
            k: v
            for k, v in RED_FLAG_KEYWORDS.items()
            if k
            in (
                "niet rijdend",
                "defect",
                "motor kapot",
                "versnellingsbak kapot",
                "turbo kapot",
                "voor onderdelen",
                "voor de onderdelen",
                "sloop",
                "sloperij",
            )
        },
    )

    no_apk_found = _check_keywords(
        text,
        {
            k: v
            for k, v in RED_FLAG_KEYWORDS.items()
            if k in ("geen apk", "apk verlopen", "zonder apk")
        },
    )

    export_found = _check_keywords(
        text,
        {
            k: v
            for k, v in RED_FLAG_KEYWORDS.items()
            if k
            in ("export", "geëxporteerd", "uitgeschreven", "uitgeschreven bij rdw")
        },
    )

    project_found = _check_keywords(
        text,
        {
            k: v
            for k, v in RED_FLAG_KEYWORDS.items()
            if k in ("project", "hobbyist", "restauratie", "opknapper", "opknappertje")
        },
    )

    # All red flags combined
    all_red = _check_keywords(text, RED_FLAG_KEYWORDS)

    # Premium keywords
    premium = _check_keywords(text, PREMIUM_KEYWORDS)

    # Description quality score (0-1)
    desc_len = len(description) if description else 0
    if desc_len == 0:
        desc_quality = 0.0
    elif desc_len < 50:
        desc_quality = 0.1
    elif desc_len < 200:
        desc_quality = 0.3
    elif desc_len < 500:
        desc_quality = 0.5
    elif desc_len < 1000:
        desc_quality = 0.7
    elif desc_len < 2000:
        desc_quality = 0.85
    else:
        desc_quality = 1.0

    # Photo count affects quality
    if photo_count >= 15:
        desc_quality = min(1.0, desc_quality + 0.1)
    elif photo_count <= 2:
        desc_quality = max(0.0, desc_quality - 0.1)

    # Placeholder price detection
    is_placeholder = False
    if price is not None:
        if price in PLACEHOLDER_PRICES:
            is_placeholder = True
        for low, high in PLACEHOLDER_RANGES:
            if low <= price <= high:
                is_placeholder = True
                break
        # Round prices that are suspiciously exact
        if price > 100 and price % 1000 == 0 and desc_len < 50:
            is_placeholder = True  # e.g., €5000 with no description

    return NLPFeatures(
        has_damage_keywords=damage_found["count"] > 0,
        has_non_running_keywords=non_running_found["count"] > 0,
        has_no_apk_keywords=no_apk_found["count"] > 0,
        has_export_keywords=export_found["count"] > 0,
        has_project_keywords=project_found["count"] > 0,
        has_premium_keywords=premium["count"] > 0,
        red_flag_count=int(all_red["count"]),
        red_flag_score=min(1.0, all_red["score"]),
        premium_flag_count=int(premium["count"]),
        premium_flag_score=min(1.0, premium["score"]),
        description_length=desc_len,
        description_quality=round(desc_quality, 2),
        photo_count=photo_count,
        is_placeholder_price=is_placeholder,
    )


def _check_keywords(text: str, keywords: dict[str, float]) -> dict[str, int | float]:
    """Check text for keywords and compute aggregate score."""
    count = 0
    total_score = 0.0

    for keyword, weight in keywords.items():
        # Use word boundary matching to avoid partial matches
        pattern = re.compile(r"\b" + re.escape(keyword) + r"\b", re.IGNORECASE)
        if pattern.search(text):
            if weight > 0:
                count += 1
                total_score += weight
            elif weight < 0:
                # Negative weights reduce score (e.g., "roestvrij" cancels "roest")
                total_score += weight

    return {"count": max(0, count), "score": max(0.0, total_score)}
