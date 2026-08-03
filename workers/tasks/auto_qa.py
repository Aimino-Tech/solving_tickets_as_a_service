"""
Auto-QA Batching — sample every Nth fix for deep adversarial QA.

Tracks fix_count in a simple JSON file (Postgres would be used in production).
On every Nth fix, triggers full adversarial review pipeline and tracks quality trends.
"""
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

QUALITY_AUDIT_DIR = os.getenv("QUALITY_AUDIT_DIR", "/tmp/syntaro-quality-audit")
FIX_COUNTER_FILE = os.path.join(QUALITY_AUDIT_DIR, "fix_counter.json")
AUDIT_HISTORY_FILE = os.path.join(QUALITY_AUDIT_DIR, "audit_history.json")
DEFAULT_EVERY_N = int(os.getenv("AUTO_QA_EVERY_N_FIXES", "10"))
ALERT_DROP_THRESHOLD = float(os.getenv("AUTO_QA_ALERT_DROP_THRESHOLD", "0.15"))
ALERT_CONSECUTIVE_FAILURES = int(os.getenv("AUTO_QA_CONSECUTIVE_FAILURES", "3"))
TREND_WINDOW = int(os.getenv("AUTO_QA_TREND_WINDOW", "5"))


def _ensure_dir():
    Path(QUALITY_AUDIT_DIR).mkdir(parents=True, exist_ok=True)


def _read_counter() -> int:
    _ensure_dir()
    try:
        with open(FIX_COUNTER_FILE) as f:
            return json.load(f).get("fix_count", 0)
    except (FileNotFoundError, json.JSONDecodeError):
        return 0


def _write_counter(count: int):
    _ensure_dir()
    with open(FIX_COUNTER_FILE, "w") as f:
        json.dump({"fix_count": count, "updated_at": datetime.now(timezone.utc).isoformat()}, f)


def _read_history() -> list[dict]:
    _ensure_dir()
    try:
        with open(AUDIT_HISTORY_FILE) as f:
            return json.load(f).get("audits", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _write_history(audits: list[dict]):
    _ensure_dir()
    with open(AUDIT_HISTORY_FILE, "w") as f:
        json.dump({"audits": audits, "updated_at": datetime.now(timezone.utc).isoformat()}, f)


def _run_adversarial_review(fix_data: dict) -> dict:
    from workers.tasks.adversarial_review import layer1_per_file_analysis, layer2_holistic_review, layer3_oracle_synthesis
    changed_files = fix_data.get("changed_files", [])
    diff_content = fix_data.get("diff_content", "")
    try:
        l1 = layer1_per_file_analysis(changed_files, diff_content)
        perspectives = ["goals", "quality", "security", "qa", "context"]
        l2_results = []
        for p in perspectives:
            result = layer2_holistic_review(p, fix_data, l1, diff_content)
            l2_results.append(result)
        l3 = layer3_oracle_synthesis(l1, l2_results, fix_data)
        return l3
    except Exception as exc:
        logger.error("Adversarial review failed — %s", exc, exc_info=True)
        return {"layer": 3, "verdict": {"verdict": "FAIL"}, "passed": False, "error": str(exc)}


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name="workers.tasks.auto_qa.auto_qa_sample",
)
def auto_qa_sample(self, fix_data: dict, every_n: int | None = None) -> dict:
    every_n = every_n or DEFAULT_EVERY_N
    current_count = _read_counter() + 1
    _write_counter(current_count)

    result = {"sampled": False, "fix_number": current_count, "every_n": every_n}

    if current_count % every_n != 0:
        logger.info("Fix #%d — not sampled (every %d)", current_count, every_n)
        result["sampled"] = False
        return result

    logger.info("Fix #%d — SAMPLED for deep adversarial QA", current_count)
    review_result = _run_adversarial_review(fix_data)
    quality_score = 1.0 if review_result.get("passed") else 0.0

    audit_entry = {
        "fix_number": current_count,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "quality_score": quality_score,
        "verdict": review_result.get("verdict", {}),
        "fix_data": {
            "issue_id": fix_data.get("issue_id", ""),
            "changed_files": fix_data.get("changed_files", []),
        },
    }

    history = _read_history()
    history.append(audit_entry)
    _write_history(history)

    recent = [h for h in history if h.get("fix_number", 0) > current_count - TREND_WINDOW]
    recent_scores = [h.get("quality_score", 0) for h in recent]
    trend_declining = False
    consecutive_failures = 0
    if len(recent_scores) >= TREND_WINDOW:
        if sum(recent_scores) / len(recent_scores) < (1.0 - ALERT_DROP_THRESHOLD):
            trend_declining = True
    for h in reversed(history[-10:]):
        if not h.get("quality_score", 1.0):
            consecutive_failures += 1
        else:
            break

    alerts = []
    if trend_declining:
        alerts.append(f"Quality score declining over last {TREND_WINDOW} samples")
    if consecutive_failures >= ALERT_CONSECUTIVE_FAILURES:
        alerts.append(f"{consecutive_failures} consecutive QA failures — pipeline pause recommended")

    result.update({
        "sampled": True,
        "quality_score": quality_score,
        "review_result": review_result,
        "trend_declining": trend_declining,
        "consecutive_failures": consecutive_failures,
        "alerts": alerts,
        "total_audits": len(history),
    })

    if alerts:
        logger.warning("Auto-QA alerts: %s", "; ".join(alerts))

    return result
