import pytest
from httpx import AsyncClient

from src.api.dependencies import set_model_loaded
from src.api.schemas import ListingFeatures


class TestHealth:
    """Tests for health endpoint."""

    async def test_health_endpoint_returns_ok(self, client: AsyncClient) -> None:
        """Test that health endpoint returns 200 status."""
        response = await client.get("/health")
        assert response.status_code == 200

    async def test_health_response_structure(self, client: AsyncClient) -> None:
        """Test health response has required fields."""
        response = await client.get("/health")
        data = response.json()

        assert "status" in data
        assert "model_loaded" in data
        assert "database" in data
        assert "uptime_seconds" in data


class TestScoring:
    """Tests for scoring endpoint."""

    async def test_score_no_model_returns_503(self, client: AsyncClient) -> None:
        """Test that scoring fails gracefully when no model is loaded."""
        payload = {
            "listings": [
                {
                    "listing_id": "test-1",
                    "price": 15000,
                    "brand": "Toyota",
                    "model": "Corolla",
                }
            ]
        }

        response = await client.post("/api/score", json=payload)
        assert response.status_code == 503
        assert "model not loaded" in response.json()["detail"].lower()

    async def test_score_with_model_loaded(
        self, client: AsyncClient, mock_model: dict
    ) -> None:
        """Test successful scoring when model is loaded."""
        set_model_loaded(mock_model, "v1.0.0")

        payload = {
            "listings": [
                {
                    "listing_id": "test-1",
                    "price": 15000,
                    "brand": "Toyota",
                    "model": "Corolla",
                }
            ]
        }

        response = await client.post("/api/score", json=payload)
        assert response.status_code == 200

        data = response.json()
        assert "predictions" in data
        assert len(data["predictions"]) == 1
        assert data["predictions"][0]["listing_id"] == "test-1"

    async def test_score_response_structure(
        self, client: AsyncClient, mock_model: dict
    ) -> None:
        """Test scoring response has all required fields."""
        set_model_loaded(mock_model, "v1.0.0")

        payload = {
            "listings": [
                {
                    "listing_id": "test-1",
                    "price": 20000,
                    "brand": "BMW",
                    "model": "3 Series",
                }
            ]
        }

        response = await client.post("/api/score", json=payload)
        data = response.json()
        pred = data["predictions"][0]

        required_fields = [
            "listing_id",
            "model_version",
            "predicted_p10",
            "predicted_p50",
            "predicted_p90",
            "deal_score",
            "deal_tier",
            "confidence",
            "suspicion_flag",
            "coverage_level",
            "effective_deal_tier",
        ]
        for field in required_fields:
            assert field in pred, f"Missing field: {field}"

    async def test_score_batch_multiple_listings(
        self, client: AsyncClient, mock_model: dict
    ) -> None:
        """Test scoring multiple listings in batch."""
        set_model_loaded(mock_model, "v1.0.0")

        payload = {
            "listings": [
                {
                    "listing_id": f"test-{i}",
                    "price": 10000 + i * 1000,
                    "brand": "Toyota",
                    "model": "Corolla",
                }
                for i in range(5)
            ]
        }

        response = await client.post("/api/score", json=payload)
        data = response.json()

        assert len(data["predictions"]) == 5
        assert data["timestamp"] is not None
        assert data["model_version"] == "v1.0.0"

    async def test_score_validation_missing_required_field(
        self, client: AsyncClient, mock_model: dict
    ) -> None:
        """Test that missing required fields are caught."""
        set_model_loaded(mock_model, "v1.0.0")

        payload = {
            "listings": [
                {
                    "listing_id": "test-1",
                    # Missing price and brand
                }
            ]
        }

        response = await client.post("/api/score", json=payload)
        assert response.status_code == 422  # Validation error


class TestTraining:
    """Tests for training endpoint."""

    async def test_train_trigger_returns_job_id(self, client: AsyncClient) -> None:
        """Test that training endpoint returns a job ID."""
        payload = {"force": False}
        response = await client.post("/api/train", json=payload)

        assert response.status_code == 200
        data = response.json()
        assert "job_id" in data
        assert data["job_id"]
        assert data["status"] == "queued"

    async def test_train_response_structure(self, client: AsyncClient) -> None:
        """Test training response structure."""
        payload = {"force": True}
        response = await client.post("/api/train", json=payload)
        data = response.json()

        required_fields = ["job_id", "status", "message"]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"


class TestModelStatus:
    """Tests for model status endpoint."""

    async def test_model_status_returns_ok(self, client: AsyncClient) -> None:
        """Test that model status endpoint returns 200."""
        response = await client.get("/api/model/status")
        assert response.status_code == 200

    async def test_model_status_response_structure(
        self, client: AsyncClient
    ) -> None:
        """Test model status response structure."""
        response = await client.get("/api/model/status")
        data = response.json()

        assert "champion" in data
        assert "challenger" in data
        assert "total_predictions" in data
        assert "service_health" in data


class TestRoot:
    """Tests for root endpoint."""

    async def test_root_endpoint(self, client: AsyncClient) -> None:
        """Test root endpoint returns service info."""
        response = await client.get("/")
        assert response.status_code == 200

        data = response.json()
        assert "service" in data
        assert data["service"] == "autarb-ml-service"
        assert "version" in data
