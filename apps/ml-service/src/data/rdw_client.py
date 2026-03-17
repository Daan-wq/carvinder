"""RDW Open Data client for Dutch vehicle registry lookups."""
import logging
import time
from datetime import datetime
from typing import Any

import requests

from src.config import settings

logger = logging.getLogger(__name__)

# RDW SODA API endpoints (no authentication needed)
VEHICLES_URL = f"{settings.rdw_api_base}/{settings.rdw_vehicles_resource}.json"
FUEL_URL = f"{settings.rdw_api_base}/{settings.rdw_fuel_resource}.json"


class RDWClient:
    """Client for querying RDW open data (opendata.rdw.nl)."""

    def __init__(self) -> None:
        self._last_request_time = 0.0
        self._min_interval = 60.0 / settings.rdw_rate_limit  # seconds between requests

    def _rate_limit(self) -> None:
        """Enforce rate limiting."""
        now = time.time()
        elapsed = now - self._last_request_time
        if elapsed < self._min_interval:
            time.sleep(self._min_interval - elapsed)
        self._last_request_time = time.time()

    def lookup_vehicle(self, kenteken: str) -> dict[str, Any] | None:
        """Look up vehicle data by kenteken (license plate).

        Returns dict with keys: merk, handelsbenaming, catalogusprijs, gewicht,
        cilinderinhoud, vermogen_kw, co2_uitstoot, euro_klasse, energielabel,
        eerste_kleur, eerste_toelating, eerste_tenaamstelling_nl, apk_vervaldatum,
        is_geexporteerd, brandstof (from fuel table)
        """
        kenteken = kenteken.upper().replace("-", "").strip()
        if not kenteken or len(kenteken) < 4 or len(kenteken) > 8:
            return None

        self._rate_limit()

        try:
            # Query main vehicle table
            resp = requests.get(
                VEHICLES_URL,
                params={"kenteken": kenteken},
                timeout=10,
            )
            resp.raise_for_status()
            vehicles = resp.json()

            if not vehicles:
                logger.debug(f"No RDW data for kenteken {kenteken}")
                return None

            vehicle = vehicles[0]

            # Query fuel table for brandstof info
            fuel_data = self._lookup_fuel(kenteken)

            # Parse and normalize
            result = {
                "kenteken": kenteken,
                "merk": vehicle.get("merk"),
                "handelsbenaming": vehicle.get("handelsbenaming"),
                "type_goedkeuring": vehicle.get("typegoedkeuringsnummer"),
                "catalogusprijs": self._parse_int(vehicle.get("catalogusprijs")),
                "gewicht": self._parse_int(vehicle.get("massa_ledig_voertuig")),
                "cilinderinhoud": self._parse_int(vehicle.get("cilinderinhoud")),
                "vermogen_kw": self._parse_int(vehicle.get("vermogen_massarijklaar")),
                "co2_uitstoot": self._parse_int(vehicle.get("co2_uitstoot_gecombineerd")),
                "zuinigheidslabel": vehicle.get("zuinigheidslabel"),
                "eerste_kleur": vehicle.get("eerste_kleur"),
                "eerste_toelating": self._parse_date(vehicle.get("datum_eerste_toelating")),
                "eerste_tenaamstelling_nl": self._parse_date(vehicle.get("datum_eerste_tenaamstelling_in_nederland")),
                "apk_vervaldatum": self._parse_date(vehicle.get("vervaldatum_apk")),
                "is_geexporteerd": vehicle.get("export_indicator", "Nee") == "Ja",
                "voertuigsoort": vehicle.get("voertuigsoort"),
                "brandstof": fuel_data.get("brandstof") if fuel_data else None,
                "brandstof_volgnr": fuel_data.get("brandstof_volgnr") if fuel_data else None,
                "emissieklasse": fuel_data.get("emissieklasse") if fuel_data else None,
                "raw_vehicle": vehicle,
                "raw_fuel": fuel_data,
            }

            return result

        except requests.exceptions.RequestException as e:
            logger.error(f"RDW API error for {kenteken}: {e}")
            return None

    def _lookup_fuel(self, kenteken: str) -> dict[str, Any] | None:
        """Look up fuel data from separate resource."""
        self._rate_limit()
        try:
            resp = requests.get(
                FUEL_URL,
                params={"kenteken": kenteken},
                timeout=10,
            )
            resp.raise_for_status()
            fuels = resp.json()
            if fuels:
                fuel = fuels[0]
                return {
                    "brandstof": fuel.get("brandstof_omschrijving"),
                    "brandstof_volgnr": fuel.get("brandstof_volgnummer"),
                    "emissieklasse": fuel.get("emissieklasse_eg_goedkeuring_zwaar"),
                    "emissiecode": fuel.get("emissie_co2_gecombineerd_wltp"),
                }
            return None
        except requests.exceptions.RequestException as e:
            logger.warning(f"RDW fuel lookup failed for {kenteken}: {e}")
            return None

    def lookup_batch(self, kentekens: list[str]) -> dict[str, dict[str, Any]]:
        """Look up multiple kentekens. Returns dict keyed by kenteken."""
        results = {}
        for kt in kentekens:
            data = self.lookup_vehicle(kt)
            if data:
                results[kt.upper().replace("-", "")] = data
        return results

    @staticmethod
    def _parse_int(value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(float(str(value)))
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_date(value: Any) -> datetime | None:
        if not value:
            return None
        try:
            # RDW dates come as YYYYMMDD strings
            date_str = str(value).strip()
            if len(date_str) == 8:
                return datetime.strptime(date_str, "%Y%m%d")
            return None
        except ValueError:
            return None


# Singleton
rdw_client = RDWClient()
