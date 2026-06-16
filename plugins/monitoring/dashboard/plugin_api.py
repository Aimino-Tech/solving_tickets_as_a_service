from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query

from plugins.monitoring.monitor_store import MetricsStore

log = logging.getLogger(__name__)

router = APIRouter()


def _store() -> MetricsStore:
    return MetricsStore()


@router.get("/status")
def get_status():
    store = _store()
    names = store.list_metric_names()
    return {"status": "ok", "metric_count": len(names), "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}


@router.get("/metrics/names")
def get_metric_names():
    store = _store()
    return {"names": store.list_metric_names()}


@router.get("/metrics")
def get_metrics(
    name: str = Query(""),
    since: str = Query(""),
    until: str = Query(""),
    agg: str = Query(""),
    limit: int = Query(1000),
):
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    store = _store()
    if agg and agg in ("avg", "min", "max", "sum", "count"):
        if not since:
            raise HTTPException(status_code=400, detail="since required for aggregation")
        result = store.query_aggregate(name, since, agg=agg)
        if result is None:
            raise HTTPException(status_code=404)
        return result
    return {"name": name, "values": store.query(name, since=since or None, until=until or None, limit=limit)}


@router.get("/metrics/latest")
def get_metric_latest(name: str = Query("")):
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    store = _store()
    result = store.query_latest(name)
    if result is None:
        raise HTTPException(status_code=404)
    return {"name": name, **result}


@router.get("/summary")
def get_summary():
    store = _store()
    names = store.list_metric_names()
    latest: dict[str, Any] = {}
    for n in names:
        try:
            v = store.query_latest(n)
            if v:
                latest[n] = v
        except Exception:
            pass
    return {"metric_names": names, "latest_values": latest, "metric_count": len(names)}
