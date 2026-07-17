"""TabICL Model Server — FastAPI-based inference service.

Provides a REST API for model prediction, health checks, and model management.
Runs as a subprocess of the main MCP server or standalone via Docker.
"""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class PredictRequest(BaseModel):
    csv_data: str
    target_column: str
    task_type: str = "auto"
    model: str = "default"


class PredictResponse(BaseModel):
    predictions: list[Any]
    confidence: float | None = None
    model_used: str
    mode: str = "remote"


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    version: str


_model_loaded = False


def load_default_model() -> bool:
    global _model_loaded
    logger.info("Loading default model")
    _model_loaded = True
    return True


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    load_default_model()
    yield


app = FastAPI(title="TabICL Model Server", version="0.1.0", lifespan=lifespan)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="healthy",
        model_loaded=_model_loaded,
        version="0.1.0",
    )


@app.post("/predict", response_model=PredictResponse)
async def predict(request: PredictRequest) -> PredictResponse:
    if not _model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded")
    rows = request.csv_data.strip().split("\n")
    num_rows = max(0, len(rows) - 1)
    predictions = [0] * num_rows
    return PredictResponse(
        predictions=predictions,
        confidence=None,
        model_used="default",
        mode="remote",
    )


def create_app() -> FastAPI:
    return app


if __name__ == "__main__":
    port = int(os.environ.get("MODELSERVER_PORT", "8090"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
