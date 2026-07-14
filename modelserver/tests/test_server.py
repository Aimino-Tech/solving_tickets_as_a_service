"""Tests for the TabICL Model Server."""

import pytest
from httpx import ASGITransport, AsyncClient

from server import PredictRequest, create_app, load_default_model

app = create_app()
load_default_model()
transport = ASGITransport(app=app)


@pytest.mark.asyncio
async def test_health_returns_healthy() -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "healthy"


@pytest.mark.asyncio
async def test_predict_returns_predictions() -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = PredictRequest(
            csv_data="a,b\n1,2\n3,4",
            target_column="b",
            task_type="regression",
        )
        resp = await client.post("/predict", json=payload.model_dump())
    assert resp.status_code == 200
    data = resp.json()
    assert "predictions" in data
    assert data["model_used"] == "default"


@pytest.mark.asyncio
async def test_predict_empty_csv() -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = PredictRequest(csv_data="", target_column="b")
        resp = await client.post("/predict", json=payload.model_dump())
    assert resp.status_code == 200
    data = resp.json()
    assert data["predictions"] == []


@pytest.mark.asyncio
async def test_health_version() -> None:
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
    data = resp.json()
    assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_create_app_is_fastapi() -> None:
    from fastapi import FastAPI
    assert isinstance(app, FastAPI)
