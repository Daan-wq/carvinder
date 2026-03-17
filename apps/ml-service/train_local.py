#!/usr/bin/env python3
"""
Local training script — trains on your machine, uploads champion to Railway.

Setup (one-time):
    cd apps/ml-service
    pip install -r requirements.txt

Usage:
    cd apps/ml-service
    python train_local.py

Environment variables (from monorepo .env):
    DATABASE_URL        — Railway PostgreSQL public URL
    ML_SERVICE_URL      — Railway ML service URL
    ML_UPLOAD_SECRET    — Shared secret for upload endpoint
"""
import io
import os
import sys
import time
from pathlib import Path

# Force UTF-8 output on Windows to avoid cp1252 emoji encoding errors
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

# Load .env from monorepo root (two levels up from apps/ml-service)
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent.parent / ".env")

# Ensure src/ is on the path
sys.path.insert(0, str(Path(__file__).parent))

import requests

from src.models.training_pipeline import run_training_pipeline

ML_SERVICE_URL = os.getenv("ML_SERVICE_URL", "https://ml-service-production-8d26.up.railway.app")
UPLOAD_SECRET = os.getenv("ML_UPLOAD_SECRET", "")


def main() -> None:
    print("=" * 60)
    print("  Autarb Local Training Pipeline")
    print("=" * 60)

    t0 = time.time()
    print("\n[1/2] Training models locally...")
    result = run_training_pipeline(force=True)

    if result["status"] != "COMPLETED":
        print(f"\n❌ Training failed: {result.get('message', result)}")
        sys.exit(1)

    elapsed = time.time() - t0
    print(f"\n✅ Training complete in {elapsed:.0f}s")
    print(f"   Version  : {result['version']}")
    print(f"   Dataset  : {result['dataset_size']:,} listings")
    print(f"   Features : {result['feature_count']}")
    metrics = result.get("metrics", {})
    if metrics:
        print(f"   RMSE p50 : €{metrics.get('rmse_p50', '?'):,.0f}")
        print(f"   MAPE p50 : {metrics.get('mape_p50', '?'):.1f}%")
        print(f"   Coverage : {metrics.get('coverage_p10_p90', '?'):.1%}")
        print(f"   R²       : {metrics.get('r2_score', '?'):.4f}")

    # Upload to Railway
    save_path = Path(result["save_path"])
    model_file = save_path / "model.pkl"
    encodings_file = save_path / "encodings.pkl"

    print(f"\n[2/2] Uploading to {ML_SERVICE_URL} ...")

    with open(model_file, "rb") as mf, open(encodings_file, "rb") as ef:
        resp = requests.post(
            f"{ML_SERVICE_URL}/api/model/upload",
            files={
                "model_file": ("model.pkl", mf, "application/octet-stream"),
                "encodings_file": ("encodings.pkl", ef, "application/octet-stream"),
            },
            data={"version": result["version"], "secret": UPLOAD_SECRET},
            timeout=120,
        )

    if resp.status_code == 200:
        data = resp.json()
        print(f"\n✅ Model live on Railway: version={data['version']}")
        print(f"\nVerify: curl {ML_SERVICE_URL}/health")
    else:
        print(f"\n❌ Upload failed: HTTP {resp.status_code}")
        print(resp.text)
        sys.exit(1)


if __name__ == "__main__":
    main()
