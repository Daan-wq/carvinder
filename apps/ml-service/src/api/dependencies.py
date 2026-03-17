import logging
from typing import Any, AsyncGenerator

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.database import get_async_db

logger = logging.getLogger(__name__)

# Global model state storage
model_state: dict[str, Any] = {
    "model": None,
    "version": None,
    "load_time": None,
}


def get_model_state() -> dict[str, Any]:
    """Get current model state dict."""
    if model_state["model"] is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="ML model not loaded. Service initializing or model training in progress.",
        )
    return model_state


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Get database session dependency."""
    async for session in get_async_db():
        yield session


def set_model_loaded(model: Any, version: str) -> None:
    """Set loaded model in global state."""
    from datetime import datetime

    model_state["model"] = model
    model_state["version"] = version
    model_state["load_time"] = datetime.now()
    logger.info(f"Model loaded: version={version}")


def clear_model_state() -> None:
    """Clear model state."""
    model_state["model"] = None
    model_state["version"] = None
    model_state["load_time"] = None
    logger.info("Model unloaded")
