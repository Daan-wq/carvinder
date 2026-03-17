import asyncio
import logging
import ssl
from typing import AsyncGenerator

from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from src.config import settings

logger = logging.getLogger(__name__)

# Convert psycopg2 URL to async PostgreSQL URL
DATABASE_URL = settings.database_url
if DATABASE_URL.startswith("postgresql://"):
    ASYNC_DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
else:
    ASYNC_DATABASE_URL = DATABASE_URL

# SSL context: require SSL but skip cert verification (Railway proxy uses self-signed)
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

# Async engine for async operations
async_engine = create_async_engine(
    ASYNC_DATABASE_URL,
    echo=False,
    pool_size=5,
    max_overflow=5,
    connect_args={"ssl": _ssl_ctx},
)

# Synchronous engine for migrations and sync operations
sync_engine = create_engine(
    settings.database_url,
    echo=False,
    pool_size=5,
    max_overflow=5,
    connect_args={"sslmode": "require"},
)

# Session factories
AsyncSessionLocal = sessionmaker(
    async_engine, class_=AsyncSession, expire_on_commit=False
)

SyncSessionLocal = sessionmaker(bind=sync_engine)


async def get_async_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for async database sessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception as e:
            await session.rollback()
            logger.error(f"Database error: {e}")
            raise
        finally:
            await session.close()


def get_db() -> AsyncGenerator[Session, None]:
    """Dependency for sync database sessions."""
    db = SyncSessionLocal()
    try:
        yield db
    except Exception as e:
        db.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        db.close()


async def check_db_connection() -> bool:
    """Check if database is reachable."""
    async def _check() -> bool:
        async with async_engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        return True

    try:
        return await asyncio.wait_for(_check(), timeout=5.0)
    except asyncio.TimeoutError:
        logger.error("Database connection check timed out after 5s")
        return False
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        return False
