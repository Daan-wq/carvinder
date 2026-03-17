"""Champion-challenger model deployment management."""
import logging
from typing import Any

from sqlalchemy import create_engine, text

from src.config import settings

logger = logging.getLogger(__name__)


class ModelDeploymentManager:
    """Manages champion/challenger model lifecycle."""

    def __init__(self):
        self.engine = create_engine(settings.database_url)

    def register_model(
        self,
        version: str,
        metrics: dict[str, float],
        dataset_size: int,
        feature_count: int,
        training_window_start: str,
        training_window_end: str,
        model_path: str,
    ) -> str | None:
        """Register a newly trained model in the database."""
        with self.engine.connect() as conn:
            result = conn.execute(
                text("""
                    INSERT INTO ml_model_versions (
                        id, version, status, "modelType",
                        "trainingWindowStart", "trainingWindowEnd",
                        "trainingDatasetSize", "featureCount",
                        "rmseP50", "rmseP10", "rmseP90",
                        "mapeP50", "coverageP10P90", "r2Score",
                        "modelPath", "createdAt", "updatedAt"
                    ) VALUES (
                        gen_random_uuid(), :version, 'VALIDATION', 'lightgbm_quantile_v1',
                        :window_start, :window_end,
                        :dataset_size, :feature_count,
                        :rmse_p50, :rmse_p10, :rmse_p90,
                        :mape_p50, :coverage, :r2,
                        :model_path, NOW(), NOW()
                    )
                    RETURNING id
                """),
                {
                    "version": version,
                    "window_start": training_window_start,
                    "window_end": training_window_end,
                    "dataset_size": dataset_size,
                    "feature_count": feature_count,
                    "rmse_p50": metrics.get("rmse_p50"),
                    "rmse_p10": metrics.get("rmse_p10"),
                    "rmse_p90": metrics.get("rmse_p90"),
                    "mape_p50": metrics.get("mape_p50"),
                    "coverage": metrics.get("coverage_p10_p90"),
                    "r2": metrics.get("r2_score"),
                    "model_path": model_path,
                },
            )
            conn.commit()
            row = result.fetchone()
            model_id = row[0] if row else None
            logger.info(f"Registered model {version} with id {model_id}")
            return model_id

    def promote_to_champion(self, version: str) -> bool:
        """Promote a model to champion status, demoting the current champion."""
        with self.engine.connect() as conn:
            # Demote current champion
            conn.execute(
                text("""
                    UPDATE ml_model_versions
                    SET status = 'ARCHIVED',
                        "isChampion" = false,
                        "archivedAt" = NOW(),
                        "updatedAt" = NOW()
                    WHERE "isChampion" = true
                """)
            )

            # Promote new champion
            result = conn.execute(
                text("""
                    UPDATE ml_model_versions
                    SET status = 'CHAMPION',
                        "isChampion" = true,
                        "promotedAt" = NOW(),
                        "updatedAt" = NOW()
                    WHERE version = :version
                """),
                {"version": version},
            )

            conn.commit()

            if result.rowcount > 0:
                logger.info(f"Promoted {version} to champion")
                return True

            logger.warning(f"Could not promote {version} — not found")
            return False

    def should_promote(
        self,
        new_metrics: dict[str, float],
        champion_metrics: dict[str, float] | None,
    ) -> tuple[bool, str]:
        """Decide if a new model should replace the current champion.

        Returns (should_promote, reason).
        """
        # No champion exists — always promote
        if champion_metrics is None:
            return True, "No existing champion — promoting first model"

        # Check coverage threshold
        new_coverage = new_metrics.get("coverage_p10_p90", 0)
        if new_coverage < settings.champion_min_coverage:
            return False, f"Coverage {new_coverage:.2%} below minimum {settings.champion_min_coverage:.2%}"

        # Compare RMSE (lower is better)
        new_rmse = new_metrics.get("rmse_p50", float("inf"))
        old_rmse = champion_metrics.get("rmse_p50", float("inf"))

        if new_rmse > old_rmse * 1.02:  # Allow 2% tolerance
            return False, f"RMSE {new_rmse:.0f} worse than champion {old_rmse:.0f}"

        # Compare R² (higher is better)
        new_r2 = new_metrics.get("r2_score", 0)
        old_r2 = champion_metrics.get("r2_score", 0)

        if new_r2 < old_r2 - 0.01:  # Allow 0.01 tolerance
            return False, f"R² {new_r2:.4f} worse than champion {old_r2:.4f}"

        return True, f"New model metrics acceptable (RMSE: {new_rmse:.0f}, R²: {new_r2:.4f})"

    def get_champion_info(self) -> dict[str, Any] | None:
        """Get current champion model info."""
        with self.engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT version, status, "trainingDatasetSize",
                           "rmseP50", "coverageP10P90", "r2Score",
                           "psiScore", "modelPath", "promotedAt", "createdAt"
                    FROM ml_model_versions
                    WHERE "isChampion" = true
                    LIMIT 1
                """)
            )
            row = result.fetchone()
            if not row:
                return None

            return {
                "version": row[0],
                "status": row[1],
                "dataset_size": row[2],
                "rmse_p50": row[3],
                "coverage_p10_p90": row[4],
                "r2_score": row[5],
                "psi_score": row[6],
                "model_path": row[7],
                "promoted_at": row[8].isoformat() if row[8] else None,
                "created_at": row[9].isoformat() if row[9] else None,
            }

    def get_challenger_info(self) -> dict[str, Any] | None:
        """Get current challenger model info (most recent VALIDATION model)."""
        with self.engine.connect() as conn:
            result = conn.execute(
                text("""
                    SELECT version, status, "trainingDatasetSize",
                           "rmseP50", "coverageP10P90", "r2Score",
                           "createdAt"
                    FROM ml_model_versions
                    WHERE status = 'VALIDATION'
                    ORDER BY "createdAt" DESC
                    LIMIT 1
                """)
            )
            row = result.fetchone()
            if not row:
                return None

            return {
                "version": row[0],
                "status": row[1],
                "dataset_size": row[2],
                "rmse_p50": row[3],
                "coverage_p10_p90": row[4],
                "r2_score": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
            }
