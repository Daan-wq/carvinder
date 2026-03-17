import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api.dependencies import set_model_loaded
from src.api.routes import router, set_startup_time
from src.config import settings

# Configure logging
logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle startup and shutdown events."""
    # Startup
    logger.info("Starting ML service...")
    set_startup_time(datetime.now())

    try:
        import joblib
        from pathlib import Path

        from src.data.feature_engineering import set_target_encodings
        from src.models.price_model import QuantilePriceModel

        model_dir = Path(settings.ml_model_dir)
        champion_path = model_dir / "champion.pkl"
        encodings_path = model_dir / "champion_encodings.pkl"

        if champion_path.exists():
            logger.info(f"Loading champion model from {champion_path}")
            model = QuantilePriceModel()
            model.load(champion_path)

            if encodings_path.exists():
                encodings = joblib.load(encodings_path)
                set_target_encodings(
                    encodings["brand_encoding"],
                    encodings["model_encoding"],
                    encodings["global_mean_log_price"],
                )
                logger.info("Target encodings loaded")

            set_model_loaded(model, version=model.version)
            logger.info(f"Champion model loaded: version={model.version}")
        else:
            logger.warning(f"No champion model found at {champion_path}")
            logger.info("Service running in model-less mode — trigger POST /api/train to train")

    except Exception as e:
        logger.error(f"Failed to load champion model: {e}")
        logger.warning("Service starting without model")

    yield

    # Shutdown
    logger.info("Shutting down ML service...")


# Create FastAPI application
app = FastAPI(
    title="Autarb ML Service",
    description="Car price prediction microservice",
    version="0.1.0",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Exception handlers
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Handle uncaught exceptions."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )


# Include routers
app.include_router(router)


# Root endpoint
@app.get("/", tags=["info"])
async def root():
    """Service info endpoint."""
    return {
        "service": "autarb-ml-service",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "src.main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        log_level=settings.log_level.lower(),
    )
