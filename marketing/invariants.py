"""Runtime quality audit system — invariant gates I₁–I₇.

Enforces marketing execution invariants at both the tool handler level and
execution engine level (dual gate enforcement).  Each check returns a
structured verdict with ``pass``, ``reason``, and ``details``.

Usage::

    engine = InvariantEngine()
    verdict = engine.check_all(
        account_name="CommentAwkward3993",
        content="Great post! I tried a similar approach last month…",
        platform="reddit",
        campaign_id="abc12345",
    )
    if verdict["pass"]:
        # proceed with execution
    else:
        logger.warning("Invariant check failed: %s", verdict["reason"])
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Graceful imports — each dependency can be missing without crashing the module
# ---------------------------------------------------------------------------

try:
    from marketing.store import CampaignStore
except ImportError:
    CampaignStore = None  # type: ignore[assignment,misc]

try:
    from marketing.warmup import WarmupEngine
except ImportError:
    WarmupEngine = None  # type: ignore[assignment,misc]

try:
    from marketing.humanization_gate import HumanizationGate
except ImportError:
    HumanizationGate = None  # type: ignore[assignment,misc]

try:
    from hermes_constants import get_hermes_home
except ImportError:

    def get_hermes_home() -> Path:
        return Path.home() / ".hermes"


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# I₁ — Comment Pacing
I1_MAX_COMMENTS_PER_DAY: int = 3
I1_MIN_GAP_HOURS: float = 4.0
I1_OVERLAP_THRESHOLD: float = 0.50

# I₂ — Promo Ratio
I2_MAX_PROMO_RATIO: float = 0.10
I2_LOOKBACK_ACTIONS: int = 50

# I₄ — Warmup
I4_MIN_PHASE: int = 9

# I₆ — Cron Non-Overlap
I6_DEFAULT_TIMEOUT_MIN: int = 30
I6_STALE_THRESHOLD_MIN: int = 30

# I₇ — Humanization Quality
I7_PLATFORM_THRESHOLDS: dict[str, float] = {
    "reddit": 70.0,
    "hn": 80.0,
    "twitter": 60.0,
    "linkedin": 65.0,
}

# ── Promo / bridge detection for I₂ ───────────────────────────────────

_PROMO_PATTERNS: list[re.Pattern] = [
    re.compile(r"\bcheck out\b", re.IGNORECASE),
    re.compile(r"\btry\b", re.IGNORECASE),
    re.compile(r"\bwe built\b", re.IGNORECASE),
    re.compile(r"\bmy project\b", re.IGNORECASE),
    re.compile(r"\bopen source tool\b", re.IGNORECASE),
]

_PRODUCT_URL_REGEX: re.Pattern = re.compile(
    r"(?:https?://)?"
    r"(?:github\.com|npmjs\.com|pypi\.org|hub\.docker\.com|"
    r"pypi\.python\.org|crates\.io|rubygems\.org)/"
    r"\S+",
    re.IGNORECASE,
)


def _is_promo_content(content: str | None) -> bool:
    """Return ``True`` if *content* looks like a promotional or bridge action."""
    if not content:
        return False
    for pat in _PROMO_PATTERNS:
        if pat.search(content):
            return True
    if _PRODUCT_URL_REGEX.search(content):
        return True
    return False


def _content_overlap_ratio(a: str, b: str) -> float:
    """Jaccard similarity (0.0–1.0) of two strings' whitespace-delimited words."""
    words_a = set(a.lower().split())
    words_b = set(b.lower().split())
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)


# ── Sentinel for distinguishing "not provided" from "explicit None" ──

_UNSET: dict = {}  # unique sentinel object (module-level)


# ===================================================================
# InvariantEngine
# ===================================================================


class InvariantEngine:
    """Runtime quality audit engine enforcing invariants I₁–I₇.

    Each ``check_*`` method returns a verdict dict with at least:
        ``pass`` (*bool*)
            Whether the invariant passed.
        ``reason`` (*str*)
            Human-readable summary of the verdict.
        ``details`` (*dict*)
            Check-specific structured data.

    Thread-safe — uses an internal ``threading.Lock`` for shared state
    (IP tracking, lock files).  Dependencies (CampaignStore, WarmupEngine,
    HumanizationGate) are resolved via constructor injection with graceful
    fallback to defaults.

    All timestamps are UTC.
    """

    # ── lifecycle ──────────────────────────────────────────────────────────

    def __init__(
        self,
        store: Any = _UNSET,
        warmup_engine: Any = _UNSET,
        humanization_gate: Any = _UNSET,
    ) -> None:
        """Initialise the invariant engine.

        Args:
            store: A ``CampaignStore`` instance.  If not provided, one is
                created from the default path on first use.  Pass
                ``None`` explicitly to disable store-dependent checks.
            warmup_engine: A ``WarmupEngine`` instance.  If not provided,
                one is created on first use.  Pass ``None`` explicitly to
                disable warmup checks.
            humanization_gate: A ``HumanizationGate`` instance.  If not
                provided, one is created on first use.  Pass ``None``
                explicitly to disable quality checks.
        """
        self._lock = threading.RLock()

        # Sentinel: if the caller passed a value (including None) we
        # respect it; if they omitted it we lazy-init on first access.
        self._store = store
        self._warmup = warmup_engine
        self._humanization_gate = humanization_gate

        self._store_initialised = store is not _UNSET
        self._warmup_initialised = warmup_engine is not _UNSET
        self._humanization_gate_initialised = humanization_gate is not _UNSET

        # IP tracking store (file-backed, soft check for I₃)
        self._known_ips: dict[str, dict] = {}
        self._ips_loaded = False

    # ── property-based lazy init ───────────────────────────────────────────

    @property
    def store(self) -> Any:
        """Lazy-initialised ``CampaignStore`` instance."""
        if not self._store_initialised:
            if CampaignStore is not None:
                self._store = CampaignStore()
            self._store_initialised = True
        return self._store

    @property
    def warmup(self) -> Any:
        """Lazy-initialised ``WarmupEngine`` instance."""
        if not self._warmup_initialised:
            if WarmupEngine is not None:
                self._warmup = WarmupEngine()
            self._warmup_initialised = True
        return self._warmup

    @property
    def humanization_gate(self) -> Any:
        """Lazy-initialised ``HumanizationGate`` instance."""
        if not self._humanization_gate_initialised:
            if HumanizationGate is not None:
                self._humanization_gate = HumanizationGate()
            self._humanization_gate_initialised = True
        return self._humanization_gate

    # ── internal helpers ───────────────────────────────────────────────────

    def _marketing_dir(self) -> Path:
        """Return the marketing data directory under HERMES_HOME."""
        d = get_hermes_home() / "marketing"
        d.mkdir(parents=True, exist_ok=True)
        return d

    @staticmethod
    def _now_utc() -> datetime:
        """Return the current UTC datetime."""
        return datetime.now(timezone.utc)

    def _since_hours_ago(self, hours: int) -> str:
        """Return ISO-8601 string for *hours* ago in UTC."""
        return (self._now_utc() - timedelta(hours=hours)).isoformat()

    def _get_actions_for_account(
        self,
        account_name: str,
        since: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        """Return actions matching *account_name* across all campaigns.

        Results are sorted by ``timestamp`` DESC.  Returns an empty list
        when the store is unavailable.
        """
        if self.store is None:
            logger.warning("CampaignStore not available — cannot query actions")
            return []

        campaigns = self.store.list_campaigns()
        matched: list[dict[str, Any]] = []

        for camp in campaigns:
            camp_actions = self.store.get_actions(camp["id"], since=since)
            for a in camp_actions:
                if a.get("profile_name") == account_name:
                    matched.append(a)

        matched.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

        if limit is not None:
            matched = matched[:limit]

        return matched

    def _load_known_ips(self) -> None:
        """Load known IPs from ``known_ips.json`` under the marketing dir."""
        ip_file = self._marketing_dir() / "known_ips.json"
        with self._lock:
            if ip_file.exists():
                try:
                    raw = ip_file.read_text(encoding="utf-8")
                    self._known_ips = dict(json.loads(raw))
                except (json.JSONDecodeError, OSError):
                    self._known_ips = {}
            else:
                self._known_ips = {}
            self._ips_loaded = True

    def _save_known_ips(self) -> None:
        """Persist known IPs to disk atomically."""
        ip_file = self._marketing_dir() / "known_ips.json"
        with self._lock:
            tmp = ip_file.with_suffix(".tmp")
            tmp.write_text(
                json.dumps(self._known_ips, indent=2, sort_keys=True, default=str),
                encoding="utf-8",
            )
            tmp.replace(ip_file)

    def update_known_ip(self, account_name: str, ip_address: str) -> None:
        """Record an IP address for *account_name*.

        Populates the IP tracker used by :meth:`check_account_isolation`.
        Thread-safe.
        """
        with self._lock:
            if not self._ips_loaded:
                self._load_known_ips()
            self._known_ips[account_name] = {
                "ip": ip_address,
                "updated_at": self._now_utc().isoformat(),
            }
            self._save_known_ips()

    def _is_promo(self, action: dict[str, Any]) -> bool:
        """Return ``True`` if *action* is promotional or bridge-type content."""
        return _is_promo_content(action.get("content_preview"))

    # ══════════════════════════════════════════════════════════════════════
    # I₁ — Comment Pacing
    # ══════════════════════════════════════════════════════════════════════

    def check_pacing(
        self,
        account_name: str,
        platform: str = "reddit",
        dry_run: bool = False,
    ) -> dict[str, Any]:
        """Enforce comment / action pacing for *account_name*.

        Gates enforced:
            1. **Daily limit** — at most ``I1_MAX_COMMENTS_PER_DAY`` (3)
               actions in the last 24 hours.
            2. **Gap** — at least ``I1_MIN_GAP_HOURS`` (4) hours since the
               last action from this account.
            3. **Content overlap** — if the gap is < 4h, the last action's
               content must differ from the one before it by
               > ``I1_OVERLAP_THRESHOLD`` (50%) set-overlap Jaccard
               distance.

        Args:
            account_name: The account (profile) to check.
            platform: Target platform identifier (included in details for
                forward compatibility).
            dry_run: If ``True``, violations are reported in ``details``
                but the overall verdict is always ``pass=True`` (advisory
                mode).

        Returns:
            Verdict dict with ``pass``, ``reason``, ``details``.
        """
        since = self._since_hours_ago(24)
        actions = self._get_actions_for_account(account_name, since=since)
        violations: list[str] = []
        now = self._now_utc()

        # ── Check 1: daily count ───────────────────────────────────────
        count_24h = len(actions)
        if count_24h > I1_MAX_COMMENTS_PER_DAY:
            violations.append(
                f"Action limit exceeded: {count_24h} in the last 24h "
                f"(max {I1_MAX_COMMENTS_PER_DAY})"
            )

        # ── Check 2: time gap from last action ─────────────────────────
        last_action_time: datetime | None = None
        gap_hours: float | None = None
        overlap_ratio: float | None = None

        if actions:
            last_ts = actions[0].get("timestamp")
            if last_ts:
                try:
                    last_action_time = datetime.fromisoformat(last_ts)
                    gap_hours = (now - last_action_time).total_seconds() / 3600.0

                    if gap_hours < I1_MIN_GAP_HOURS:
                        violations.append(
                            f"Last action was {gap_hours:.1f}h ago "
                            f"(minimum gap: {I1_MIN_GAP_HOURS}h)"
                        )

                        # ── Check 3: content overlap ──────────────────
                        if len(actions) >= 2:
                            last_content = actions[0].get("content_preview", "")
                            prev_content = actions[1].get("content_preview", "")
                            if last_content and prev_content:
                                overlap_ratio = _content_overlap_ratio(
                                    last_content, prev_content,
                                )
                                if overlap_ratio > I1_OVERLAP_THRESHOLD:
                                    violations.append(
                                        f"Content overlap with previous action "
                                        f"is {overlap_ratio:.1%} "
                                        f"(threshold: {I1_OVERLAP_THRESHOLD:.0%})"
                                    )
                except (ValueError, TypeError):
                    pass

        passed = len(violations) == 0

        # Dry-run override: always pass, report issues advisory
        if dry_run and not passed:
            logger.warning(
                "[DRY_RUN] Pacing check would fail for %s: %s",
                account_name,
                "; ".join(violations),
            )
            passed = True

        details: dict[str, Any] = {
            "actions_last_24h": count_24h,
            "max_allowed_per_day": I1_MAX_COMMENTS_PER_DAY,
            "last_action_time": last_action_time.isoformat()
            if last_action_time
            else None,
            "gap_hours_since_last": round(gap_hours, 2)
            if gap_hours is not None
            else None,
            "min_gap_hours": I1_MIN_GAP_HOURS,
            "content_overlap_ratio": round(overlap_ratio, 4)
            if overlap_ratio is not None
            else None,
            "overlap_threshold": I1_OVERLAP_THRESHOLD,
            "violations": violations,
            "dry_run": dry_run,
        }

        if passed:
            reason = (
                "Pacing check passed"
                if not dry_run
                else (
                    f"[DRY_RUN] Pacing check passed with "
                    f"{len(violations)} advisory issue(s)"
                )
            )
        else:
            reason = f"Pacing check failed: {'; '.join(violations)}"

        return {"pass": passed, "reason": reason, "details": details}

    # ══════════════════════════════════════════════════════════════════════
    # I₂ — Promo Ratio
    # ══════════════════════════════════════════════════════════════════════

    def check_promo_ratio(
        self,
        account_name: str,
        campaign_id: str = "",
    ) -> dict[str, Any]:
        """Enforce promotional content ≤ 10% of recent actions.

        Scans the last ``I2_LOOKBACK_ACTIONS`` (50) actions for this
        account across *all* campaigns and counts promotional / bridge-type
        content (detected via :func:`_is_promo_content`).

        Args:
            account_name: The account (profile) to check.
            campaign_id: Optional campaign ID for traceability in
                ``details``.

        Returns:
            Verdict dict with ``pass``, ``reason``, ``details``.
        """
        if self.store is None:
            return {
                "pass": True,
                "reason": "CampaignStore not available — skipping promo ratio check",
                "details": {
                    "warning": "Store unavailable",
                    "campaign_id": campaign_id,
                },
            }

        actions = self._get_actions_for_account(
            account_name,
            limit=I2_LOOKBACK_ACTIONS,
        )
        total = len(actions)
        promo_count = sum(1 for a in actions if self._is_promo(a))
        promo_ratio = promo_count / total if total > 0 else 0.0
        passed = promo_ratio <= I2_MAX_PROMO_RATIO

        details: dict[str, Any] = {
            "total_actions_checked": total,
            "lookback_limit": I2_LOOKBACK_ACTIONS,
            "promo_actions": promo_count,
            "promo_ratio": round(promo_ratio, 4),
            "max_ratio": I2_MAX_PROMO_RATIO,
            "campaign_id": campaign_id,
        }

        if not passed:
            reason = (
                f"Promo ratio {promo_ratio:.1%} exceeds max "
                f"{I2_MAX_PROMO_RATIO:.0%} "
                f"({promo_count}/{total} actions are promotional)"
            )
        elif total == 0:
            reason = (
                "No recent actions to evaluate — "
                "promo ratio check passes vacuously"
            )
        else:
            reason = (
                f"Promo ratio {promo_ratio:.1%} is within limit "
                f"({promo_count}/{total} actions are promotional)"
            )

        return {"pass": passed, "reason": reason, "details": details}

    # ══════════════════════════════════════════════════════════════════════
    # I₃ — Account Isolation
    # ══════════════════════════════════════════════════════════════════════

    def check_account_isolation(
        self,
        account_name: str,
        ip_address: str | None = None,
    ) -> dict[str, Any]:
        """Verify *account_name* does not share IP or threads with other
        accounts.

        This is a **soft check** — if IP tracking data doesn't exist yet
        (no calls to :meth:`update_known_ip`), the check passes with a
        warning.  Cross-account thread detection uses the ``target_url``
        field as a thread proxy and is best-effort.

        Gates enforced:
            1. **IP isolation** — no two accounts share the same IP
               (within the known-IP store).
            2. **No cross-account voting** — last 50 actions for each
               account are scanned for shared ``target_url`` values.

        Args:
            account_name: The account to verify.
            ip_address: Optional IP address to check.  When provided,
                verifies no *other* account has recently used this IP.

        Returns:
            Verdict dict with ``pass``, ``reason``, ``details``.
        """
        with self._lock:
            if not self._ips_loaded:
                self._load_known_ips()

        warnings: list[str] = []
        conflicts: list[str] = []

        # ── IP conflict check ──────────────────────────────────────────
        ip_tracking_available = bool(self._known_ips)
        if ip_address:
            for acct, data in self._known_ips.items():
                if acct == account_name:
                    continue
                if data.get("ip") == ip_address:
                    conflicts.append(
                        f"IP {ip_address} also used by account {acct!r} "
                        f"(last seen: {data.get('updated_at', 'unknown')})"
                    )

        if not ip_tracking_available:
            warnings.append(
                "No IP tracking data available.  Call update_known_ip() to "
                "populate.  This check is advisory."
            )

        # ── Cross-account thread detection ─────────────────────────────
        if self.store is not None:
            all_accounts = self.store.list_accounts()
            # Build a map of target_url → list of accounts that interacted
            thread_accounts: dict[str, set[str]] = {}

            for acct in all_accounts:
                name = acct["name"]
                if name == account_name:
                    continue
                recent = self._get_actions_for_account(
                    name, limit=I2_LOOKBACK_ACTIONS,
                )
                for action in recent:
                    url = (
                        action.get("target_url")
                        or action.get("content_preview", "")
                    )
                    if url:
                        thread_accounts.setdefault(url, set()).add(name)

            # Check current account's actions against the map
            current_actions = self._get_actions_for_account(
                account_name, limit=I2_LOOKBACK_ACTIONS,
            )
            for action in current_actions:
                url = (
                    action.get("target_url")
                    or action.get("content_preview", "")
                )
                if url and url in thread_accounts:
                    others = thread_accounts[url]
                    if others:
                        conflicts.append(
                            f"Cross-account activity on same target "
                            f"with {', '.join(sorted(others))}"
                        )
                        break  # One conflict report is sufficient

        passed = len(conflicts) == 0

        details: dict[str, Any] = {
            "ip_tracking_available": ip_tracking_available,
            "ip_address_provided": ip_address is not None,
            "ip_address": ip_address,
            "ip_conflicts": conflicts,
            "thread_conflicts": conflicts,
            "warnings": warnings,
        }

        if not passed:
            reason = (
                f"Account isolation check failed: {'; '.join(conflicts)}"
            )
        elif warnings:
            reason = (
                f"Account isolation check passed with warnings: "
                f"{'; '.join(warnings)}"
            )
        else:
            reason = "Account isolation check passed — no conflicts detected"

        return {"pass": passed, "reason": reason, "details": details}

    # ══════════════════════════════════════════════════════════════════════
    # I₄ — Warmup
    # ══════════════════════════════════════════════════════════════════════

    def check_warmup(self, account_name: str) -> dict[str, Any]:
        """Enforce that *account_name* has completed warmup.

        Delegates to ``WarmupEngine.is_account_ready()`` which requires
        the account's warmup phase to be >= ``I4_MIN_PHASE`` (9 = Week 10+).

        Args:
            account_name: The account to verify.

        Returns:
            Verdict dict with ``pass``, ``reason``, ``details``.
        """
        if self.warmup is None:
            return {
                "pass": True,
                "reason": "WarmupEngine not available — skipping warmup check",
                "details": {"warning": "WarmupEngine unavailable"},
            }

        try:
            is_ready = self.warmup.is_account_ready(account_name)
            try:
                phase_info = self.warmup.get_current_phase(account_name)
            except (KeyError, Exception):
                phase_info = {
                    "phase_number": None,
                    "phase_name": "Unknown",
                }

            current_phase = phase_info.get("phase_number")
            phase_name = phase_info.get("phase_name", "Unknown")

            details: dict[str, Any] = {
                "is_ready": is_ready,
                "current_phase": current_phase,
                "phase_name": phase_name,
                "required_phase": I4_MIN_PHASE,
            }

            if is_ready:
                reason = (
                    f"Account {account_name!r} is fully warmed up "
                    f"(phase {current_phase}: {phase_name})"
                )
            elif current_phase is None:
                reason = (
                    f"Account {account_name!r} has no warmup record — "
                    f"not ready for marketing actions"
                )
            else:
                reason = (
                    f"Account {account_name!r} is not ready for marketing "
                    f"(phase {current_phase}: {phase_name}, "
                    f"requires phase >= {I4_MIN_PHASE})"
                )

            return {"pass": is_ready, "reason": reason, "details": details}

        except Exception as exc:
            logger.exception("Warmup check failed for %s", account_name)
            return {
                "pass": False,
                "reason": f"Warmup check error: {exc}",
                "details": {"error": str(exc)},
            }

    # ══════════════════════════════════════════════════════════════════════
    # I₆ — Cron Non-Overlap
    # ══════════════════════════════════════════════════════════════════════

    def check_cron_non_overlap(
        self,
        lock_name: str = "marketing_execution",
    ) -> dict[str, Any]:
        """Prevent concurrent marketing cron jobs from overlapping.

        Uses a file-based lock under the marketing directory:
            * Lock exists and is **fresh** (< 30 min) → reject (another
              job running).
            * Lock exists and is **stale** (≥ 30 min) → acquire and warn.
            * No lock → acquire and pass.

        The underlying :meth:`acquire_lock` is used for the actual
        acquisition; this method adds structured reporting.

        Args:
            lock_name: Name of the lock file (default
                ``"marketing_execution"``).

        Returns:
            Verdict dict with ``pass``, ``reason``, ``details``.
        """
        lock_dir = self._marketing_dir()
        lock_path = lock_dir / f".{lock_name}.lock"

        # ── Snapshot pre-acquisition state ─────────────────────────────
        lock_exists = lock_path.exists()
        lock_age_min: float | None = None
        is_stale: bool | None = None
        lock_pid: int | None = None
        lock_hostname: str | None = None

        if lock_exists:
            try:
                raw = lock_path.read_text(encoding="utf-8")
                data = json.loads(raw)
                lock_pid = data.get("pid")
                lock_hostname = data.get("hostname")
            except (json.JSONDecodeError, OSError):
                pass
            age = self._now_utc() - datetime.fromtimestamp(
                lock_path.stat().st_mtime, tz=timezone.utc,
            )
            lock_age_min = age.total_seconds() / 60.0
            is_stale = lock_age_min >= I6_STALE_THRESHOLD_MIN

        # ── Try to acquire ─────────────────────────────────────────────
        if lock_exists and not is_stale:
            # Fresh lock — cannot proceed
            passed = False
            reason = (
                f"Lock {lock_name!r} held by PID {lock_pid} "
                f"({lock_age_min:.1f} min old)"
            )
            acquired = False
        else:
            acquired = self.acquire_lock(
                lock_name, timeout_min=I6_STALE_THRESHOLD_MIN,
            )
            passed = acquired
            if acquired:
                if is_stale:
                    reason = (
                        f"Stale lock acquired for {lock_name!r} "
                        f"(was {lock_age_min:.1f} min old, threshold: "
                        f"{I6_STALE_THRESHOLD_MIN} min)"
                    )
                else:
                    reason = f"Lock acquired for {lock_name!r}"
            else:
                reason = f"Failed to acquire lock {lock_name!r}"

        details: dict[str, Any] = {
            "lock_name": lock_name,
            "lock_path": str(lock_path),
            "lock_exists": lock_exists,
            "lock_age_minutes": round(lock_age_min, 2)
            if lock_age_min is not None
            else None,
            "is_stale": is_stale,
            "timeout_minutes": I6_STALE_THRESHOLD_MIN,
            "lock_pid": lock_pid,
            "lock_hostname": lock_hostname,
            "acquired": acquired,
        }

        return {"pass": passed, "reason": reason, "details": details}

    # ══════════════════════════════════════════════════════════════════════
    # I₇ — Humanization Quality
    # ══════════════════════════════════════════════════════════════════════

    def check_humanization(
        self,
        content: str,
        platform: str = "reddit",
    ) -> dict[str, Any]:
        """Verify *content* meets the humanization quality threshold for
        *platform*.

        Delegates to ``HumanizationGate.check()`` and enforces the
        platform-specific threshold:

        ========= ===========
        Platform  Threshold
        ========= ===========
        reddit    70
        hn        80
        twitter   60
        linkedin  65
        other     70 (default)
        ========= ===========

        Args:
            content: The text to evaluate.
            platform: Target platform key.

        Returns:
            Verdict dict with ``pass``, ``reason``, ``details``.
        """
        threshold = I7_PLATFORM_THRESHOLDS.get(platform, 70.0)

        if self.humanization_gate is None:
            return {
                "pass": True,
                "reason": "HumanizationGate not available — skipping quality check",
                "details": {
                    "warning": "HumanizationGate unavailable",
                    "platform": platform,
                    "threshold": threshold,
                },
            }

        try:
            result = self.humanization_gate.check(content, platform=platform)
        except Exception as exc:
            logger.exception("Humanization check failed")
            return {
                "pass": False,
                "reason": f"Humanization check error: {exc}",
                "details": {"error": str(exc), "platform": platform},
            }

        score = result.get("score", 0.0)
        gate_pass = result.get("pass", False)
        failures = result.get("failures", [])
        passed = score >= threshold

        details: dict[str, Any] = {
            "platform": platform,
            "threshold": threshold,
            "score": score,
            "gate_pass": gate_pass,
            "failures": failures,
            "all_details": result.get("details", {}),
        }

        if passed:
            reason = (
                f"Humanization score {score:.1f} meets {platform} "
                f"threshold of {threshold}"
            )
        else:
            failure_reasons = [
                f"{f['check']}: {'; '.join(f.get('reasons', []))}"
                for f in failures
            ]
            reason = (
                f"Humanization score {score:.1f} below {platform} "
                f"threshold of {threshold}.  "
                f"Failing checks: {'; '.join(failure_reasons)}"
            )

        return {"pass": passed, "reason": reason, "details": details}

    # ══════════════════════════════════════════════════════════════════════
    # check_all — combined invariant verdict
    # ══════════════════════════════════════════════════════════════════════

    def check_all(
        self,
        account_name: str,
        content: str,
        platform: str = "reddit",
        campaign_id: str = "",
    ) -> dict[str, Any]:
        """Run all 6 runtime invariants (I₁–I₄, I₆, I₇) and return a
        combined verdict.

        Note: I₅ is runtime config enforcement — not an invariant check,
        so it is excluded from this method.

        Args:
            account_name: The account to check.
            content: The content text to evaluate (for I₇).
            platform: Target platform (default ``"reddit"``).
            campaign_id: Context campaign ID (for I₂ traceability).

        Returns:
            Combined verdict:
                ``pass`` — ``True`` only if ALL 6 invariants pass.
                ``reason`` — Summary string.
                ``details`` — Per-invariant breakdown keyed by label.
        """
        results: dict[str, Any] = {}

        results["I₁ (Pacing)"] = self.check_pacing(account_name, platform)
        results["I₂ (Promo Ratio)"] = self.check_promo_ratio(
            account_name, campaign_id,
        )
        results["I₃ (Account Isolation)"] = self.check_account_isolation(
            account_name,
        )
        results["I₄ (Warmup)"] = self.check_warmup(account_name)
        results["I₆ (Cron Non-Overlap)"] = self.check_cron_non_overlap()
        results["I₇ (Humanization)"] = self.check_humanization(
            content, platform,
        )

        passed_count = sum(1 for r in results.values() if r["pass"])
        failed_count = len(results) - passed_count
        all_pass = passed_count == len(results)

        if all_pass:
            reason = f"All {len(results)} invariants passed"
        else:
            failed_lines = [
                f"  ✗ {l}: {v['reason']}"
                for l, v in results.items()
                if not v["pass"]
            ]
            reason = (
                f"{failed_count}/{len(results)} invariant(s) failed:\n"
                + "\n".join(failed_lines)
            )

        details: dict[str, Any] = {
            "results": results,
            "passed_count": passed_count,
            "failed_count": failed_count,
            "total_checks": len(results),
        }

        return {"pass": all_pass, "reason": reason, "details": details}

    # ══════════════════════════════════════════════════════════════════════
    # Lock management (I₆ helpers)
    # ══════════════════════════════════════════════════════════════════════

    def acquire_lock(
        self,
        lock_name: str = "marketing_execution",
        timeout_min: int = 30,
    ) -> bool:
        """Acquire a file-based lock for *lock_name*.

        Args:
            lock_name: Name of the lock (used as ``.<name>.lock``).
            timeout_min: Minutes after which an existing lock is
                considered stale (default 30).

        Returns:
            ``True`` if the lock was acquired (or re-acquired after
            staleness).  ``False`` if a fresh lock from another process
            is still held.
        """
        lock_dir = self._marketing_dir()
        lock_path = lock_dir / f".{lock_name}.lock"

        if lock_path.exists():
            age = self._now_utc() - datetime.fromtimestamp(
                lock_path.stat().st_mtime, tz=timezone.utc,
            )
            age_min = age.total_seconds() / 60.0

            if age_min < timeout_min:
                # Fresh lock — another process holds it
                return False

            # Stale lock — warn and overwrite
            logger.warning(
                "Stale lock %r (%.1f min old, threshold %d min) — overwriting",
                lock_name,
                age_min,
                timeout_min,
            )

        # Acquire (or re-acquire)
        lock_data = {
            "pid": os.getpid(),
            "hostname": os.uname().nodename,
            "acquired_at": self._now_utc().isoformat(),
        }
        lock_path.write_text(
            json.dumps(lock_data, indent=2, default=str),
            encoding="utf-8",
        )
        return True

    def release_lock(self, lock_name: str = "marketing_execution") -> None:
        """Release a file-based lock.

        Only removes the lock file if the current PID matches the
        lock's recorded PID.  This prevents accidental cross-process
        lock removal.
        """
        lock_dir = self._marketing_dir()
        lock_path = lock_dir / f".{lock_name}.lock"

        if not lock_path.exists():
            logger.debug("Lock %r does not exist — nothing to release", lock_name)
            return

        try:
            raw = lock_path.read_text(encoding="utf-8")
            data = json.loads(raw)
            pid = data.get("pid")
            if pid is not None and pid != os.getpid():
                logger.warning(
                    "Not releasing lock %r: owned by PID %d (current PID %d)",
                    lock_name,
                    pid,
                    os.getpid(),
                )
                return
        except (json.JSONDecodeError, OSError):
            pass

        lock_path.unlink(missing_ok=True)
        logger.debug("Released lock %r", lock_name)
