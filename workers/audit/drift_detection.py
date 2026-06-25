from __future__ import annotations

import logging
from typing import Any

from workers.audit.models import EventSeverity, EventType, ScopeScore
from workers.audit.scoring import ComplianceScorer
from workers.audit.trail import AuditTrail

logger = logging.getLogger(__name__)

DEFAULT_FAIL_RATE_THRESHOLD = 0.1
DEFAULT_SCORE_DROP_THRESHOLD = 0.05


class DriftDetector:
    def __init__(self) -> None:
        self._scorer = ComplianceScorer()
        self._trail = AuditTrail()

    def check_drift(
        self,
        scope: str = "",
        fail_rate_threshold: float = DEFAULT_FAIL_RATE_THRESHOLD,
        score_drop_threshold: float = DEFAULT_SCORE_DROP_THRESHOLD,
    ) -> dict[str, Any]:
        current_score = self._scorer.compute_score(scope, window_hours=1)
        daily_score = self._scorer.compute_score(scope, window_hours=24)

        drifts: list[dict[str, Any]] = []

        fail_rate = 1.0 - current_score.score if current_score.total_count > 0 else 0.0
        if fail_rate > fail_rate_threshold:
            drifts.append({
                "type": "high_fail_rate",
                "value": fail_rate,
                "threshold": fail_rate_threshold,
                "scope": scope,
            })
            logger.warning(
                "Drift detected: high fail rate %.2f (threshold: %.2f) for scope=%s",
                fail_rate,
                fail_rate_threshold,
                scope,
            )

        score_drop = daily_score.score - current_score.score
        if score_drop < -score_drop_threshold:
            drifts.append({
                "type": "score_drop",
                "value": score_drop,
                "threshold": score_drop_threshold,
                "scope": scope,
                "previous_score": daily_score.score,
                "current_score": current_score.score,
            })
            logger.warning(
                "Drift detected: score dropped %.4f (threshold: %.4f) for scope=%s",
                score_drop,
                score_drop_threshold,
                scope,
            )

        if drifts:
            self._trail.append_event(
                EventType.PIPELINE_STAGE,
                EventSeverity.WARNING,
                {
                    "drifts": drifts,
                    "current_score": current_score.score,
                    "daily_score": daily_score.score,
                },
                scope,
            )

        return {
            "drifts": drifts,
            "current_score": current_score.score,
            "daily_score": daily_score.score,
            "scope": scope or "global",
        }
