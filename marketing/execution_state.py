"""Wave state machine for multi-wave guerrilla campaigns.

Tracks the lifecycle of each wave in a campaign through five states:

    PLANNED → RUNNING → COMPLETED
                       → FAILED
                       → PARTIAL

Persisted as JSON under ``<HERMES_HOME>/marketing/execution_state.json``.
Thread-safe — all mutations acquire a reentrant lock.
"""

from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home
from marketing.store import CampaignStore

logger = logging.getLogger(__name__)

# ─── ExecutionState ───────────────────────────────────────────────────────────


class ExecutionState(Enum):
    """Lifecycle states for a single campaign wave."""

    PLANNED = "planned"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PARTIAL = "partial"


# ─── WaveState dataclass ──────────────────────────────────────────────────────


@dataclass
class WaveState:
    """Mutable state for one wave of a campaign.

    Attributes:
        campaign_id: Foreign key to the campaign.
        wave_number: Zero-indexed wave number.
        status: Current :class:`ExecutionState`.
        started_at: ISO-8601 timestamp when the wave began executing.
        completed_at: ISO-8601 timestamp when execution finished.
        accounts_used: Account names that participated in this wave.
        actions_logged: Total actions (comments/posts) produced.
        errors: Human-readable error messages accumulated.
        summary: Optional free-text summary set on completion.
    """

    campaign_id: str
    wave_number: int
    status: ExecutionState = ExecutionState.PLANNED
    started_at: str | None = None
    completed_at: str | None = None
    accounts_used: list[str] = field(default_factory=list)
    actions_logged: int = 0
    errors: list[str] = field(default_factory=list)
    summary: str | None = None


def _wavestate_to_dict(ws: WaveState) -> dict[str, Any]:
    """Serialize a WaveState to a JSON-safe dict."""
    d = asdict(ws)
    d["status"] = ws.status.value
    return d


def _dict_to_wavestate(d: dict[str, Any]) -> WaveState:
    """Deserialize a dict back to a WaveState."""
    raw = dict(d)
    raw["status"] = ExecutionState(raw["status"])
    return WaveState(**raw)


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _now() -> str:
    """Return current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _default_state_path() -> Path:
    """Return the path for the execution-state JSON file."""
    return get_hermes_home() / "marketing" / "execution_state.json"


# ─── CampaignStateManager ─────────────────────────────────────────────────────


class CampaignStateManager:
    """Manages wave-level state for campaigns.

    State is persisted as JSON to ``<HERMES_HOME>/marketing/execution_state.json``
    so it survives process restarts.

    Thread-safe — public methods acquire ``_lock`` before reading or mutating
    the in-memory state dict.
    """

    def __init__(
        self,
        store: CampaignStore,
        state_path: str | Path | None = None,
    ) -> None:
        """Initialise the state manager.

        Args:
            store: A connected :class:`CampaignStore` instance (used for
                campaign lookups during progress reporting).
            state_path: Override path for the state JSON file.  Defaults to
                ``<HERMES_HOME>/marketing/execution_state.json``.
        """
        self._store = store
        self._lock = threading.Lock()
        self._state_path = Path(state_path) if state_path else _default_state_path()
        self._state: dict[str, Any] = self._load()

    # ── Persistence ───────────────────────────────────────────────────────

    def _load(self) -> dict[str, Any]:
        """Load state from disk, returning an empty skeleton on miss."""
        path = self._state_path
        if path.exists():
            try:
                raw = path.read_text(encoding="utf-8")
                return dict(json.loads(raw))
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning("Failed to load execution state: %s", exc)
        return {"campaigns": {}, "version": 1}

    def _save(self) -> None:
        """Atomically write current state to disk."""
        path = self._state_path
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps(self._state, indent=2, sort_keys=True, default=str),
            encoding="utf-8",
        )
        tmp.replace(path)

    # ── Campaign-level operations ─────────────────────────────────────────

    def init_campaign_waves(
        self,
        campaign_id: str,
        wave_count: int,
    ) -> list[WaveState]:
        """Create *wave_count* initialised WaveState entries for a campaign.

        All waves start in ``PLANNED`` state.  If the campaign already has
        wave state persisted, this method is a no-op (does **not** reset).

        Args:
            campaign_id: The campaign identifier.
            wave_count: Number of waves to create.

        Returns:
            The list of :class:`WaveState` objects now associated with the
            campaign (newly created or pre-existing).
        """
        with self._lock:
            campaigns = self._state.setdefault("campaigns", {})

            # Don't re-initialise if state already exists
            if campaign_id in campaigns:
                existing = campaigns[campaign_id]
                if existing:
                    return [_dict_to_wavestate(w) for w in existing]

            waves: list[WaveState] = []
            for i in range(wave_count):
                waves.append(
                    WaveState(
                        campaign_id=campaign_id,
                        wave_number=i,
                        status=ExecutionState.PLANNED,
                    )
                )

            campaigns[campaign_id] = [_wavestate_to_dict(w) for w in waves]
            self._save()

        logger.info(
            "Initialised %d waves for campaign %s",
            wave_count,
            campaign_id,
        )
        return waves

    def get_current_wave(self, campaign_id: str) -> WaveState | None:
        """Return the first non-completed wave for *campaign_id*.

        "Non-completed" means status is ``PLANNED`` or ``RUNNING``.
        Returns ``None`` if every wave is done or the campaign has no waves.
        """
        with self._lock:
            campaigns = self._state.get("campaigns", {})
            raw_waves = campaigns.get(campaign_id, [])
            for raw in raw_waves:
                status = raw.get("status", "planned")
                if status in ("planned", "running"):
                    return _dict_to_wavestate(raw)
            return None

    def get_wave(self, campaign_id: str, wave_number: int) -> WaveState | None:
        """Return a specific wave by number, or ``None``."""
        with self._lock:
            campaigns = self._state.get("campaigns", {})
            for raw in campaigns.get(campaign_id, []):
                if raw["wave_number"] == wave_number:
                    return _dict_to_wavestate(raw)
            return None

    def list_waves(self, campaign_id: str) -> list[WaveState]:
        """Return all waves for *campaign_id* (empty list if none)."""
        with self._lock:
            campaigns = self._state.get("campaigns", {})
            raw_waves = campaigns.get(campaign_id, [])
            return [_dict_to_wavestate(w) for w in raw_waves]

    # ── State transitions ─────────────────────────────────────────────────

    def start_wave(self, campaign_id: str, wave_number: int) -> WaveState:
        """Mark a wave as ``RUNNING`` and record the start timestamp.

        Args:
            campaign_id: The campaign identifier.
            wave_number: Zero-indexed wave number.

        Returns:
            The updated :class:`WaveState`.

        Raises:
            ValueError: If the wave does not exist.
            RuntimeError: If the wave is not in ``PLANNED`` state.
        """
        with self._lock:
            campaigns = self._state.setdefault("campaigns", {})
            raw_waves = campaigns.get(campaign_id, [])
            for raw in raw_waves:
                if raw["wave_number"] == wave_number:
                    if raw["status"] != ExecutionState.PLANNED.value:
                        raise RuntimeError(
                            f"Cannot start wave {wave_number} — "
                            f"current status is {raw['status']!r} "
                            f"(expected 'planned')"
                        )
                    raw["status"] = ExecutionState.RUNNING.value
                    raw["started_at"] = _now()
                    self._save()
                    logger.info(
                        "Wave %d/%s started",
                        wave_number,
                        campaign_id,
                    )
                    return _dict_to_wavestate(raw)

        raise ValueError(
            f"Wave {wave_number} not found for campaign {campaign_id!r}"
        )

    def _update_wave(
        self,
        campaign_id: str,
        wave_number: int,
        **updates: Any,
    ) -> WaveState:
        """Low-level wave state mutation (caller MUST hold ``_lock``)."""
        campaigns = self._state.setdefault("campaigns", {})
        raw_waves = campaigns.get(campaign_id, [])
        for raw in raw_waves:
            if raw["wave_number"] == wave_number:
                raw.update(updates)
                self._save()
                return _dict_to_wavestate(raw)

        raise ValueError(
            f"Wave {wave_number} not found for campaign {campaign_id!r}"
        )

    def complete_wave(
        self,
        campaign_id: str,
        wave_number: int,
        summary: str,
    ) -> WaveState:
        """Mark a wave as ``COMPLETED``.

        Args:
            campaign_id: The campaign identifier.
            wave_number: Zero-indexed wave number.
            summary: Free-text summary of what was accomplished.
        """
        with self._lock:
            ws = self._update_wave(
                campaign_id,
                wave_number,
                status=ExecutionState.COMPLETED.value,
                completed_at=_now(),
                summary=summary,
            )
            logger.info(
                "Wave %d/%s completed: %s",
                wave_number,
                campaign_id,
                summary,
            )
            return ws

    def fail_wave(
        self,
        campaign_id: str,
        wave_number: int,
        errors: list[str],
    ) -> WaveState:
        """Mark a wave as ``FAILED``.

        Args:
            campaign_id: The campaign identifier.
            wave_number: Zero-indexed wave number.
            errors: Human-readable error descriptions.
        """
        with self._lock:
            ws = self._update_wave(
                campaign_id,
                wave_number,
                status=ExecutionState.FAILED.value,
                completed_at=_now(),
                errors=errors,
            )
            logger.error(
                "Wave %d/%s failed: %s",
                wave_number,
                campaign_id,
                "; ".join(errors),
            )
            return ws

    def partial_wave(
        self,
        campaign_id: str,
        wave_number: int,
        summary: str,
        errors: list[str],
    ) -> WaveState:
        """Mark a wave as ``PARTIAL`` — some actions succeeded, some failed.

        Args:
            campaign_id: The campaign identifier.
            wave_number: Zero-indexed wave number.
            summary: Summary of what was accomplished.
            errors: Errors that occurred.
        """
        with self._lock:
            ws = self._update_wave(
                campaign_id,
                wave_number,
                status=ExecutionState.PARTIAL.value,
                completed_at=_now(),
                summary=summary,
                errors=errors,
            )
            logger.warning(
                "Wave %d/%s partial: %s  errors: %s",
                wave_number,
                campaign_id,
                summary,
                "; ".join(errors),
            )
            return ws

    # ── Queries ───────────────────────────────────────────────────────────

    def is_campaign_complete(self, campaign_id: str) -> bool:
        """Return ``True`` when all waves for *campaign_id* are done.

        "Done" means every wave is in ``COMPLETED``, ``FAILED``, or
        ``PARTIAL`` state.
        """
        with self._lock:
            campaigns = self._state.get("campaigns", {})
            raw_waves = campaigns.get(campaign_id, [])
            if not raw_waves:
                return False
            terminal = {
                ExecutionState.COMPLETED.value,
                ExecutionState.FAILED.value,
                ExecutionState.PARTIAL.value,
            }
            return all(raw["status"] in terminal for raw in raw_waves)

    def get_campaign_progress(self, campaign_id: str) -> dict[str, Any]:
        """Return aggregate progress stats for *campaign_id*.

        Returns:
            A dict with keys:

            **campaign_id** (*str*)
            **total_waves** (*int*)
            **completed** (*int*)
            **failed** (*int*)
            **partial** (*int*)
            **running** (*int*)
            **planned** (*int*)
            **total_actions_logged** (*int*)
            **all_done** (*bool*)
                Convenience: ``True`` when every wave has reached a terminal
                state.
        """
        with self._lock:
            campaigns = self._state.get("campaigns", {})
            raw_waves = campaigns.get(campaign_id, [])

        counts: dict[str, int] = {
            "completed": 0,
            "failed": 0,
            "partial": 0,
            "running": 0,
            "planned": 0,
        }
        total_actions = 0

        for raw in raw_waves:
            status = raw.get("status", "planned")
            if status in counts:
                counts[status] += 1
            total_actions += raw.get("actions_logged", 0)

        total = len(raw_waves)
        all_done = counts["completed"] + counts["failed"] + counts["partial"] == total

        return {
            "campaign_id": campaign_id,
            "total_waves": total,
            **counts,
            "total_actions_logged": total_actions,
            "all_done": all_done,
        }

    # ── Action-log mirroring (called by engine after each action) ─────────

    def record_action(
        self,
        campaign_id: str,
        wave_number: int,
        account: str,
    ) -> None:
        """Increment the action counter and record the account for a wave.

        Called by the execution engine after each successful action so the
        state manager stays in sync.
        """
        with self._lock:
            campaigns = self._state.setdefault("campaigns", {})
            for raw in campaigns.get(campaign_id, []):
                if raw["wave_number"] == wave_number:
                    raw["actions_logged"] = raw.get("actions_logged", 0) + 1
                    used = raw.setdefault("accounts_used", [])
                    if account not in used:
                        used.append(account)
                    self._save()
                    return
