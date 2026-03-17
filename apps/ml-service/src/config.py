import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    database_url: str
    ml_model_dir: str = "trained_models"
    rdw_api_base: str = "https://opendata.rdw.nl/resource"
    rdw_vehicles_resource: str = "m9d7-ebf2"
    rdw_fuel_resource: str = "8ys7-d773"
    rdw_rate_limit: int = 60
    model_retrain_cron: str = "0 3 * * 2"
    min_training_samples: int = 500
    ml_upload_secret: str = ""
    champion_min_coverage: float = 0.75
    champion_max_psi: float = 0.25
    log_level: str = "INFO"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False


settings = Settings()

# Ensure model directory exists
os.makedirs(settings.ml_model_dir, exist_ok=True)
