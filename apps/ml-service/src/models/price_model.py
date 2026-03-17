"""LightGBM quantile regression model for car price prediction."""
import logging
from pathlib import Path
from typing import Any

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)

# Default hyperparameters
DEFAULT_PARAMS = {
    "objective": "quantile",
    "metric": "quantile",
    "num_leaves": 63,
    "min_data_in_leaf": 20,
    "learning_rate": 0.05,
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "num_iterations": 1000,
    "early_stopping_rounds": 50,
    "verbose": -1,
}


class QuantilePriceModel:
    """Three LightGBM quantile models (p10, p50, p90) for car price prediction.

    Prices are log-transformed for training and back-transformed for prediction.
    """

    def __init__(self):
        self.model_p10: lgb.Booster | None = None
        self.model_p50: lgb.Booster | None = None
        self.model_p90: lgb.Booster | None = None
        self.feature_names: list[str] = []
        self.is_fitted = False
        self.version: str = ""
        self.metadata: dict[str, Any] = {}

    def train(
        self,
        X_train: pd.DataFrame,
        y_train: pd.Series,
        X_val: pd.DataFrame | None = None,
        y_val: pd.Series | None = None,
        params: dict[str, Any] | None = None,
        sample_weight: pd.Series | None = None,
    ) -> dict[str, Any]:
        """Train all three quantile models.

        y_train/y_val should be log-transformed prices.
        Returns dict with training metrics.
        """
        base_params = {**DEFAULT_PARAMS, **(params or {})}
        self.feature_names = list(X_train.columns)

        metrics = {}

        # Create LightGBM datasets
        train_data = lgb.Dataset(X_train, label=y_train, weight=sample_weight)
        val_data = lgb.Dataset(X_val, label=y_val, reference=train_data) if X_val is not None else None
        valid_sets = [train_data] + ([val_data] if val_data else [])
        valid_names = ["train"] + (["val"] if val_data else [])

        # Train p10 model (10th percentile — floor price)
        logger.info("Training p10 model (tau=0.10)...")
        p10_params = {**base_params, "alpha": 0.10}
        callbacks = [lgb.log_evaluation(100)]
        self.model_p10 = lgb.train(
            p10_params,
            train_data,
            valid_sets=valid_sets,
            valid_names=valid_names,
            callbacks=callbacks,
        )

        # Train p50 model (median — fair market value)
        logger.info("Training p50 model (tau=0.50)...")
        p50_params = {**base_params, "alpha": 0.50}
        self.model_p50 = lgb.train(
            p50_params,
            train_data,
            valid_sets=valid_sets,
            valid_names=valid_names,
            callbacks=callbacks,
        )

        # Train p90 model (90th percentile — ceiling price)
        logger.info("Training p90 model (tau=0.90)...")
        p90_params = {**base_params, "alpha": 0.90}
        self.model_p90 = lgb.train(
            p90_params,
            train_data,
            valid_sets=valid_sets,
            valid_names=valid_names,
            callbacks=callbacks,
        )

        self.is_fitted = True

        # Compute validation metrics
        if X_val is not None and y_val is not None:
            metrics = self._compute_metrics(X_val, y_val)

        self.metadata = {
            "n_train": len(X_train),
            "n_val": len(X_val) if X_val is not None else 0,
            "n_features": len(self.feature_names),
            "feature_names": self.feature_names,
            "metrics": metrics,
        }

        logger.info(f"Training complete. Metrics: {metrics}")
        return metrics

    def predict(self, X: pd.DataFrame) -> dict[str, np.ndarray]:
        """Predict p10, p50, p90 for input features.

        Returns dict with arrays of predictions in original price space (euros).
        """
        if not self.is_fitted:
            raise RuntimeError("Model not trained. Call train() or load() first.")

        # Ensure correct column order
        X_ordered = X[self.feature_names] if set(self.feature_names).issubset(X.columns) else X

        # Predict in log-space
        log_p10 = self.model_p10.predict(X_ordered)
        log_p50 = self.model_p50.predict(X_ordered)
        log_p90 = self.model_p90.predict(X_ordered)

        # Back-transform to euro prices
        p10 = np.exp(log_p10).astype(int)
        p50 = np.exp(log_p50).astype(int)
        p90 = np.exp(log_p90).astype(int)

        # Ensure monotonicity: p10 <= p50 <= p90
        p50 = np.maximum(p50, p10)
        p90 = np.maximum(p90, p50)

        return {"p10": p10, "p50": p50, "p90": p90}

    def get_feature_importance(self, importance_type: str = "gain") -> dict[str, float]:
        """Get feature importance from the p50 model."""
        if not self.is_fitted or self.model_p50 is None:
            return {}

        importance = self.model_p50.feature_importance(importance_type=importance_type)
        return dict(sorted(
            zip(self.feature_names, importance),
            key=lambda x: x[1],
            reverse=True,
        ))

    def save(self, path: str | Path):
        """Save all three models + metadata to disk."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)

        joblib.dump({
            "model_p10": self.model_p10,
            "model_p50": self.model_p50,
            "model_p90": self.model_p90,
            "feature_names": self.feature_names,
            "metadata": self.metadata,
            "version": self.version,
        }, path / "model.pkl")

        logger.info(f"Model saved to {path / 'model.pkl'}")

    def load(self, path: str | Path):
        """Load models from disk."""
        path = Path(path)
        model_file = path / "model.pkl" if path.is_dir() else path

        data = joblib.load(model_file)
        self.model_p10 = data["model_p10"]
        self.model_p50 = data["model_p50"]
        self.model_p90 = data["model_p90"]
        self.feature_names = data["feature_names"]
        self.metadata = data.get("metadata", {})
        self.version = data.get("version", "unknown")
        self.is_fitted = True

        logger.info(f"Model loaded from {model_file} (version: {self.version})")

    def _compute_metrics(self, X_val: pd.DataFrame, y_val: pd.Series) -> dict[str, float]:
        """Compute validation metrics."""
        preds = self.predict(X_val)
        y_actual = np.exp(y_val.values)  # Back to euro prices

        # RMSE for p50
        rmse_p50 = float(np.sqrt(np.mean((preds["p50"] - y_actual) ** 2)))

        # MAPE for p50
        nonzero = y_actual > 0
        mape_p50 = float(np.mean(np.abs(preds["p50"][nonzero] - y_actual[nonzero]) / y_actual[nonzero]) * 100)

        # Coverage: % of actual prices within [p10, p90]
        within_interval = (y_actual >= preds["p10"]) & (y_actual <= preds["p90"])
        coverage = float(np.mean(within_interval))

        # R² for p50
        ss_res = np.sum((y_actual - preds["p50"]) ** 2)
        ss_tot = np.sum((y_actual - np.mean(y_actual)) ** 2)
        r2 = float(1 - ss_res / ss_tot) if ss_tot > 0 else 0.0

        # RMSE for p10 and p90 (quantile-specific)
        rmse_p10 = float(np.sqrt(np.mean((preds["p10"] - y_actual) ** 2)))
        rmse_p90 = float(np.sqrt(np.mean((preds["p90"] - y_actual) ** 2)))

        return {
            "rmse_p50": round(rmse_p50, 2),
            "rmse_p10": round(rmse_p10, 2),
            "rmse_p90": round(rmse_p90, 2),
            "mape_p50": round(mape_p50, 2),
            "coverage_p10_p90": round(coverage, 4),
            "r2_score": round(r2, 4),
        }
