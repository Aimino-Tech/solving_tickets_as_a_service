"""Drift detection for compliance audit trails.

Detects statistically significant changes in compliance metrics between
two time windows: fail rate changes, score changes, and anomalous event
patterns.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from workers.audit.models import AuditEvent, ComplianceScore, DriftReport

logger = logging.getLogger(__name__)


class DriftDetector:
    def __init__(
        self,
        fail_rate_threshold: float = 0.10,
        score_change_threshold: float = 0.10,
        min_event_count: int = 5,
    ) -> None:
        self.fail_rate_threshold = fail_rate_threshold
        self.score_change_threshold = score_change_threshold
        self.min_event_count = min_event_count

    def compare(
        self,
        previous_events: list[AuditEvent],
        current_events: list[AuditEvent],
        previous_score: ComplianceScore | None = None,
        current_score: ComplianceScore | None = None,
    ) -> DriftReport:
        from workers.audit.scoring import compute_score

        prev_score_obj = previous_score or compute_score(previous_events)
        curr_score_obj = current_score or compute_score(current_events)

        prev_fail_rate = (
            prev_score_obj.failed_events / prev_score_obj.total_events
            if prev_score_obj.total_events > 0
            else 0.0
        )
        curr_fail_rate = (
            curr_score_obj.failed_events / curr_score_obj.total_events
            if curr_score_obj.total_events > 0
            else 0.0
        )

        score_change = curr_score_obj.score - prev_score_obj.score
        fail_rate_change = abs(curr_fail_rate - prev_fail_rate)

        anomaly_detected, anomaly_reason = self._check_anomaly(
            prev_score_obj, curr_score_obj,
            prev_fail_rate, curr_fail_rate,
            fail_rate_change, score_change,
        )

        return DriftReport(
            previous_score=prev_score_obj.score,
            current_score=curr_score_obj.score,
            score_change=round(score_change, 6),
            fail_rate_previous=round(prev_fail_rate, 6),
            fail_rate_current=round(curr_fail_rate, 6),
            anomaly_detected=anomaly_detected,
            anomaly_reason=anomaly_reason,
        )

    def compare_time_windows(
        self,
        all_events: list[AuditEvent],
        window_minutes: int = 60,
        *,
        now: datetime | None = None,
    ) -> DriftReport:
        ref = now or datetime.now(timezone.utc)
        cutoff = ref - timedelta(minutes=2 * window_minutes)

        if all_events and len(all_events) > 1:
            first_ts = all_events[0].created_at
            last_ts = all_events[-1].created_at
            if first_ts > last_ts:
                all_events = list(reversed(all_events))

        mid = ref - timedelta(minutes=window_minutes)
        previous = [e for e in all_events if cutoff <= e.created_at < mid]
        current = [e for e in all_events if mid <= e.created_at <= ref]

        if len(previous) < self.min_event_count:
            logger.info(
                "Previous window has %d events (min %d) — skipping drift comparison",
                len(previous),
                self.min_event_count,
            )
            return DriftReport(
                previous_score=1.0,
                current_score=1.0,
                score_change=0.0,
                fail_rate_previous=0.0,
                fail_rate_current=0.0,
                anomaly_detected=False,
                anomaly_reason="Insufficient events in previous window",
            )

        return self.compare(previous, current)

    def _check_anomaly(
        self,
        prev_score: ComplianceScore,
        curr_score: ComplianceScore,
        prev_fail_rate: float,
        curr_fail_rate: float,
        fail_rate_change: float,
        score_change: float,
    ) -> tuple[bool, str]:
        reasons: list[str] = []

        if fail_rate_change >= self.fail_rate_threshold:
            reasons.append(
                f"Fail rate changed by {fail_rate_change:.1%} "
                f"({prev_fail_rate:.1%} → {curr_fail_rate:.1%})"
            )

        if abs(score_change) >= self.score_change_threshold:
            direction = "decrease" if score_change < 0 else "increase"
            reasons.append(
                f"Compliance score {direction} by {abs(score_change):.3f} "
                f"({prev_score.score:.3f} → {curr_score.score:.3f})"
            )

        vol_change = self._volume_change(prev_score, curr_score)
        if vol_change and abs(vol_change) > 0.5:
            reasons.append(f"Event volume changed by {vol_change:.1%}")

        if not reasons:
            return False, ""

        return True, "; ".join(reasons)

    @staticmethod
    def _volume_change(
        prev: ComplianceScore, curr: ComplianceScore,
    ) -> float:
        if prev.total_events == 0:
            return 0.0
        return (curr.total_events - prev.total_events) / prev.total_events
