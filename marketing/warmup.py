"""Reddit account warmup engine — 30-60 day organic reputation builder.

The ``WarmupEngine`` schedules and tracks a progressive 10-phase warmup for
Reddit accounts, slowly building karma, recognition, and subreddit standing
before any marketing activity begins.  It is a **scheduler**, not an executor
— all phases define *what* and *when*, not *how*.

Phase progression is day-count-based.  Each phase has a fixed duration in
days; ``tick_daily()`` auto-advances accounts whose current phase has
elapsed.  Manual override via ``advance_phase()`` is available.

Usage::

    engine = WarmupEngine()
    engine.get_warmup_plan("CommentAwkward3993", start_date="2026-06-12")
    engine.tick_daily()  # called by cron
    next_action = engine.get_next_action("CommentAwkward3993")
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field, asdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home


# ─── Phase Definitions ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class WarmupPhase:
    """Definition of a single warmup phase.

    Attributes:
        number: Zero-based phase index (0-9).
        name: Human-readable phase name.
        days_total: Duration in days (0 = ongoing/indefinite).
        daily_actions_max: Maximum actions (comments/posts) per day.
        min_gap_hours: Minimum hours between consecutive actions.
        description: Short prose describing the phase goal.
        goals: Concrete objectives to achieve during this phase.
        action_type: Preferred action type (``"observe"``, ``"comment"``,
            ``"post"``, ``"reply"``, or ``"mixed"``).
    """

    number: int
    name: str
    days_total: int
    daily_actions_max: int
    min_gap_hours: float
    description: str
    goals: list[str] = field(default_factory=list)
    action_type: str = "mixed"


# 10-phase schedule matching the 30-Day Foundation Protocol from
# knowledge/humanize-prompt.md.
PHASES: tuple[WarmupPhase, ...] = (
    WarmupPhase(
        number=0,
        name="Week 1: Observe Only",
        days_total=7,
        daily_actions_max=0,
        min_gap_hours=0.0,
        description="Zero activity. Join target subreddits, read rules, "
        "absorb community culture.",
        action_type="observe",
        goals=[
            "Join 5-10 target subreddits + 3-5 hobby subs",
            "Read sidebar rules & pinned posts for each subreddit",
            "Read top 20 threads of all time in each target subreddit",
            "Sort by 'new' — note what gets removed vs upvoted",
            "Understand community tone and moderation style",
        ],
    ),
    WarmupPhase(
        number=1,
        name="Week 2: Low-Stakes Comments",
        days_total=7,
        daily_actions_max=2,
        min_gap_hours=4.0,
        description="2 comments/day max, 4+ hours apart. 100-200 word "
        "responses answering questions in your area of expertise.",
        action_type="comment",
        goals=[
            "Find 10 threads where you can be genuinely helpful",
            "100-200 word responses with specific details",
            "2 comments/day max, 4+ hours apart",
            "Target: 50-100 karma by end of week 2",
            "Answer questions about area of expertise, NOT product",
        ],
    ),
    WarmupPhase(
        number=2,
        name="Week 3: Build Recognition",
        days_total=7,
        daily_actions_max=2,
        min_gap_hours=4.0,
        description="1-2 detailed responses/day (200+ words) in target "
        "subreddits. Participate in recurring threads.",
        action_type="comment",
        goals=[
            "1-2 detailed responses/day (200+ words) in target subreddits",
            "Participate in recurring threads (weekly Q&A, daily discussions)",
            "Reply to responses on your own comments for conversation depth",
            "Target: 500+ karma, posting restrictions cleared",
        ],
    ),
    WarmupPhase(
        number=3,
        name="Week 4: First Value Post (No Product)",
        days_total=7,
        daily_actions_max=1,
        min_gap_hours=0.0,
        description="1 high-effort text post teaching something you "
        "learned. No link in body. Reply to every comment first 2-4 hours.",
        action_type="post",
        goals=[
            "1 high-effort text post teaching something you learned",
            "No link in the body of the post",
            "Reply to every comment for the first 2-4 hours",
            "Target: 1,000+ karma, recognizable username",
        ],
    ),
    WarmupPhase(
        number=4,
        name="Week 5: Educational Content",
        days_total=7,
        daily_actions_max=3,
        min_gap_hours=3.0,
        description="Share resources, frameworks, data, insights about "
        "your topic area. Recommend OTHER people's tools.",
        action_type="mixed",
        goals=[
            "Share educational resources and frameworks",
            "Recommend other people's tools genuinely",
            "2-3 daily comments max",
            "Focus on value, not promotion",
        ],
    ),
    WarmupPhase(
        number=5,
        name="Week 6: Educational Content",
        days_total=7,
        daily_actions_max=3,
        min_gap_hours=3.0,
        description="Continue daily commenting. Deepen engagement with "
        "reply chains and follow-up conversations.",
        action_type="mixed",
        goals=[
            "Continue daily commenting (2-3 per day)",
            "Engage in reply chains and follow-up conversations",
            "Share personal experiences and lessons learned",
            "Build thread depth rather than breadth",
        ],
    ),
    WarmupPhase(
        number=6,
        name="Week 7: Community Engagement",
        days_total=7,
        daily_actions_max=3,
        min_gap_hours=3.0,
        description="Deeper conversations. Reply chains, cross-thread "
        "engagement. Become a recognized regular.",
        action_type="reply",
        goals=[
            "Participate in deeper reply chains (3+ replies deep)",
            "Cross-thread engagement — carry reputation across subreddits",
            "Become a recognized regular in 2-3 communities",
            "Help others by linking to your previous quality comments",
        ],
    ),
    WarmupPhase(
        number=7,
        name="Week 8: Authority Building",
        days_total=7,
        daily_actions_max=2,
        min_gap_hours=4.0,
        description="Detailed guides and comparison posts. Demonstrate "
        "expertise without mentioning your product.",
        action_type="post",
        goals=[
            "Write detailed guides or comparison posts",
            "Frame as 'here's what I learned after X years'",
            "Do not mention your own product yet",
            "Let your expertise speak for itself",
        ],
    ),
    WarmupPhase(
        number=8,
        name="Week 9: Occasional Product Mention",
        days_total=7,
        daily_actions_max=3,
        min_gap_hours=3.0,
        description="1 out of every 5-6 posts may mention your product "
        "as a case study. Frame as a lesson learned, not a pitch.",
        action_type="mixed",
        goals=[
            "1 out of every 5-6 posts can mention your product subtly",
            "Frame as case study, lesson learned, or tool you built",
            "Never link directly in post body — let people ask",
            "70% of mentions should come from others asking",
        ],
    ),
    WarmupPhase(
        number=9,
        name="Week 10+: Full Readiness",
        days_total=0,
        daily_actions_max=3,
        min_gap_hours=2.0,
        description="Account is marketing-ready. Maintain 9:1 "
        "helpful-to-promotional ratio. Continue organic engagement.",
        action_type="mixed",
        goals=[
            "Account is fully warmed up and marketing-ready",
            "Maintain 9:1 helpful-to-promotional ratio",
            "Continue daily organic engagement (2-3 actions/day)",
            "Monitor replies and engage genuinely",
            "Track everything for analytics",
        ],
    ),
)


def _phase_by_number(n: int) -> WarmupPhase | None:
    """Return the phase definition for *n*, or ``None`` if out of range."""
    if 0 <= n < len(PHASES):
        return PHASES[n]
    return None


# ─── Warmup State Persistence ──────────────────────────────────────────────────


def _state_path() -> Path:
    """Return the path to the warmup state JSON file under HERMES_HOME."""
    return get_hermes_home() / "marketing" / "warmup_state.json"


# ─── Engine ─────────────────────────────────────────────────────────────────────


class WarmupEngine:
    """Progressive Reddit account warmup scheduler.

    Manages a collection of accounts through a 10-phase warmup protocol.
    State is persisted as JSON under ``~/.hermes/marketing/warmup_state.json``.

    Thread-safe: all public methods acquire ``_lock`` before mutating state.
    """

    def __init__(self, state_path: str | Path | None = None) -> None:
        """Initialize the engine with an optional custom state path.

        Args:
            state_path: Override path for the warmup state file.  Defaults
                to ``~/.hermes/marketing/warmup_state.json``.
        """
        self._lock = threading.Lock()
        self._state_path = Path(state_path) if state_path else _state_path()
        self._state: dict[str, Any] = self._load()

    # ── Internal helpers ──────────────────────────────────────────────────

    def _load(self) -> dict[str, Any]:
        """Load warmup state from disk, returning an empty skeleton on miss."""
        path = self._state_path
        if path.exists():
            try:
                raw = path.read_text(encoding="utf-8")
                return dict(json.loads(raw))
            except (json.JSONDecodeError, OSError):
                pass
        return {"accounts": {}}

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

    def _ensure_account(self, account_name: str) -> dict[str, Any]:
        """Return the account entry, creating a default one if missing.

        The caller MUST hold ``_lock``.
        """
        accounts = self._state.setdefault("accounts", {})
        if account_name not in accounts:
            today = date.today().isoformat()
            accounts[account_name] = {
                "current_phase": 0,
                "phase_start_date": today,
                "start_date": today,
                "last_action_date": None,
                "actions_today": 0,
                "last_action_time": None,
                "daily_log": [],
            }
        return accounts[account_name]

    @staticmethod
    def _today() -> date:
        """Return today's local date (overridable in tests via mocking)."""
        return date.today()

    def _get_account_phase(self, account: dict[str, Any]) -> WarmupPhase | None:
        """Resolve the phase definition for an account's current phase number."""
        return _phase_by_number(account.get("current_phase", 0))

    def _reset_daily_counter(self, account: dict[str, Any]) -> None:
        """Reset action counters if the last action was on a previous day."""
        today = self._today().isoformat()
        if account.get("last_action_date") != today:
            account["actions_today"] = 0
            account["last_action_date"] = today

    # ── Public API ────────────────────────────────────────────────────────

    def get_warmup_plan(
        self, account_name: str, start_date: str | None = None
    ) -> dict:
        """Return the full 10-phase warmup schedule with daily goals.

        Args:
            account_name: Display name of the Reddit account.
            start_date: ISO-format start date (e.g. ``"2026-06-12"``).
                Defaults to today.

        Returns:
            A dict with keys ``account_name``, ``start_date``,
            ``current_phase``, and ``phases`` (list of phase dicts).
        """
        if start_date is None:
            start_date = self._today().isoformat()

        with self._lock:
            account = self._ensure_account(account_name)

        phases_out: list[dict] = []
        for phase in PHASES:
            phases_out.append({
                "number": phase.number,
                "name": phase.name,
                "days_total": phase.days_total,
                "daily_actions_max": phase.daily_actions_max,
                "min_gap_hours": phase.min_gap_hours,
                "description": phase.description,
                "goals": list(phase.goals),
                "action_type": phase.action_type,
            })

        return {
            "account_name": account_name,
            "start_date": start_date,
            "current_phase": account.get("current_phase", 0),
            "phases": phases_out,
        }

    def get_current_phase(self, account_name: str) -> dict:
        """Return current phase info for an account.

        Args:
            account_name: Reddit account name.

        Returns:
            Dict with ``phase_number``, ``phase_name``, ``days_completed``,
            ``days_total``, ``description``, ``goals``, ``action_type``,
            ``daily_actions_max``, ``min_gap_hours``, and
            ``is_ready``.

        Raises:
            KeyError: If the account has not been initialised.
        """
        with self._lock:
            accounts = self._state.get("accounts", {})
            if account_name not in accounts:
                raise KeyError(
                    f"Account {account_name!r} not found. "
                    "Call get_warmup_plan() or tick_daily() to initialise it."
                )
            account = dict(accounts[account_name])  # shallow copy

        phase = _phase_by_number(account["current_phase"])
        if phase is None:
            return {
                "phase_number": account["current_phase"],
                "phase_name": "Unknown",
                "days_completed": 0,
                "days_total": 0,
                "description": "",
                "goals": [],
                "action_type": "mixed",
                "daily_actions_max": 0,
                "min_gap_hours": 0,
                "is_ready": False,
            }

        # Calculate days completed in this phase
        phase_start = date.fromisoformat(account["phase_start_date"])
        delta = self._today() - phase_start
        days_completed = max(0, delta.days)

        return {
            "phase_number": phase.number,
            "phase_name": phase.name,
            "days_completed": days_completed,
            "days_total": phase.days_total,
            "description": phase.description,
            "goals": list(phase.goals),
            "action_type": phase.action_type,
            "daily_actions_max": phase.daily_actions_max,
            "min_gap_hours": phase.min_gap_hours,
            "is_ready": phase.number >= 9,
        }

    def get_next_action(
        self, account_name: str, phase: int | None = None
    ) -> dict | None:
        """Return the next suggested action for *account_name*.

        Args:
            account_name: Reddit account name.
            phase: Override phase number.  Defaults to the account's current
                phase.

        Returns:
            A dict with keys ``type`` (``"comment"`` | ``"post"`` |
            ``"reply"`` | ``"observe"``), ``phase``, ``suggested_topic``,
            ``max_per_day``, ``min_gap_hours``, and ``description``.
            Returns ``None`` if the account is unknown.
        """
        with self._lock:
            accounts = self._state.get("accounts", {})
            if account_name not in accounts:
                return None
            account = dict(accounts[account_name])  # shallow copy

        phase_num = phase if phase is not None else account.get("current_phase", 0)
        phase_def = _phase_by_number(phase_num)

        if phase_def is None:
            return None

        # Reset daily counter if needed (local copy only)
        if account.get("last_action_date") != self._today().isoformat():
            actions_today = 0
        else:
            actions_today = account.get("actions_today", 0)

        # Check if we've hit the daily limit
        if (
            phase_def.daily_actions_max > 0
            and actions_today >= phase_def.daily_actions_max
        ):
            return {
                "type": "wait",
                "phase": phase_num,
                "phase_name": phase_def.name,
                "suggested_topic": (
                    "Daily action limit reached. Wait for tomorrow or "
                    "continue observing/planning."
                ),
                "max_per_day": phase_def.daily_actions_max,
                "min_gap_hours": phase_def.min_gap_hours,
                "description": "Daily cap hit — no more actions today.",
            }

        # Pick a suggested topic based on phase
        suggested_topic = self._suggest_topic(phase_def, account)

        return {
            "type": phase_def.action_type,
            "phase": phase_num,
            "phase_name": phase_def.name,
            "suggested_topic": suggested_topic,
            "max_per_day": phase_def.daily_actions_max,
            "min_gap_hours": phase_def.min_gap_hours,
            "description": phase_def.description,
        }

    def _suggest_topic(
        self, phase_def: WarmupPhase, account: dict[str, Any]
    ) -> str:
        """Generate a phase-appropriate suggested action topic."""
        phase_num = phase_def.number
        if phase_num == 0:
            return (
                "Join 3 target subreddits and read their sidebar rules + "
                "top 20 all-time posts. Sort by 'new' to observe what "
                "gets removed vs upvoted."
            )
        if phase_num == 1:
            return (
                "Find a thread asking about a problem you know well. "
                "Write a 100-200 word response answering from personal "
                "experience."
            )
        if phase_num == 2:
            return (
                "Find a weekly Q&A or recurring discussion thread in "
                "one of your target subreddits. Write a 200+ word "
                "detailed response."
            )
        if phase_num == 3:
            return (
                "Draft a high-effort text post teaching something you "
                "learned recently. No link in body. Make it genuinely "
                "valuable — this is your first post on this account."
            )
        if phase_num in (4, 5):
            return (
                "Share an educational resource, framework, or lesson "
                "you've learned. Recommend another tool (NOT your own) "
                "if relevant."
            )
        if phase_num == 6:
            return (
                "Find a thread you already commented on. Reply to "
                "someone else's reply to deepen the conversation. "
                "Engage in a 3+ reply deep chain."
            )
        if phase_num == 7:
            return (
                "Write a detailed guide or comparison post. Frame it "
                "as 'what I learned after X years doing Y'. No product "
                "mention."
            )
        if phase_num == 8:
            return (
                "Write a post or comment. If this is 1 in 5-6 "
                "promotional posts, it's OK to subtly mention your "
                "product as a case study. Otherwise keep it "
                "educational."
            )
        # phase 9 or fallback
        return (
            "Continue daily engagement. Maintain the 9:1 "
            "helpful-to-promotional ratio. Monitor replies and "
            "engage genuinely."
        )

    def log_warmup_action(
        self,
        account_name: str,
        phase: int,
        action: str,
        result: str | None = None,
    ) -> None:
        """Record an action taken during warmup.

        Args:
            account_name: Reddit account name.
            phase: Phase number this action belongs to.
            action: Description of the action (e.g. ``"commented on "
                "r/selfhosted thread about NAS setup"``).
            result: Optional outcome (e.g. ``"5 upvotes, 2 replies"``).
        """
        now = datetime.now()
        today = now.isoformat()

        with self._lock:
            account = self._ensure_account(account_name)
            self._reset_daily_counter(account)

            entry = {
                "timestamp": today,
                "phase": phase,
                "action": action,
                "result": result,
            }
            account.setdefault("daily_log", []).append(entry)
            account["actions_today"] = account.get("actions_today", 0) + 1
            account["last_action_time"] = now.isoformat()
            account["last_action_date"] = self._today().isoformat()

            self._save()

    def advance_phase(self, account_name: str) -> dict:
        """Manually advance *account_name* to the next warmup phase.

        Args:
            account_name: Reddit account name.

        Returns:
            Dict with ``account_name``, ``previous_phase``, ``new_phase``,
            ``phase_name``, and ``message`` for the transition.

        Raises:
            KeyError: If the account is unknown.
            ValueError: If the account is already at the final phase.
        """
        with self._lock:
            accounts = self._state.setdefault("accounts", {})
            if account_name not in accounts:
                raise KeyError(
                    f"Account {account_name!r} not found. "
                    "Initialise it with get_warmup_plan() first."
                )

            account = accounts[account_name]
            prev_phase = account["current_phase"]

            if prev_phase >= len(PHASES) - 1:
                raise ValueError(
                    f"Account {account_name!r} is already at the final "
                    f"phase ({prev_phase}: {PHASES[-1].name})."
                )

            new_phase = prev_phase + 1
            account["current_phase"] = new_phase
            account["phase_start_date"] = self._today().isoformat()
            account["actions_today"] = 0
            account["last_action_time"] = None

            # Phase 8 → 9 special message
            new_phase_def = _phase_by_number(new_phase)
            phase_name = new_phase_def.name if new_phase_def else "Unknown"

            self._save()

        # Build transition message
        if new_phase == 9:
            message = (
                f"Account {account_name!r} is now FULLY WARMED UP and "
                f"marketing-ready! Maintain the 9:1 "
                f"helpful-to-promotional ratio."
            )
        else:
            message = (
                f"Account {account_name!r} advanced to phase {new_phase} "
                f"({phase_name})."
            )

        return {
            "account_name": account_name,
            "previous_phase": prev_phase,
            "new_phase": new_phase,
            "phase_name": phase_name,
            "message": message,
        }

    def is_account_ready(self, account_name: str) -> bool:
        """Return ``True`` if *account_name* has reached marketing readiness.

        Readiness is defined as having a current phase >= 9 (Week 10+).

        Args:
            account_name: Reddit account name.

        Returns:
            ``True`` if the account is warmed up and marketing-ready.
        """
        with self._lock:
            accounts = self._state.get("accounts", {})
            if account_name not in accounts:
                return False
            return accounts[account_name].get("current_phase", 0) >= 9

    def list_accounts(self) -> list[dict]:
        """List all warmup-tracked accounts with their current phase info.

        Returns:
            A list of dicts, one per account, with keys ``account_name``,
            ``current_phase``, ``phase_name``, ``days_in_phase``,
            ``phase_days_total``, ``start_date``, ``actions_today``,
            ``is_ready``.
        """
        today = self._today()
        results: list[dict] = []

        with self._lock:
            accounts = dict(self._state.get("accounts", {}))

        for name, account in sorted(accounts.items()):
            phase_num = account.get("current_phase", 0)
            phase_def = _phase_by_number(phase_num)
            phase_start = date.fromisoformat(
                account.get("phase_start_date", today.isoformat())
            )
            days_in_phase = max(0, (today - phase_start).days)

            results.append({
                "account_name": name,
                "current_phase": phase_num,
                "phase_name": phase_def.name if phase_def else "Unknown",
                "days_in_phase": days_in_phase,
                "phase_days_total": phase_def.days_total if phase_def else 0,
                "start_date": account.get("start_date", ""),
                "actions_today": account.get("actions_today", 0),
                "is_ready": phase_num >= 9,
            })

        return results

    def tick_daily(self) -> list[str]:
        """Advance phases for accounts whose current phase has elapsed.

        Called by cron (daily).  Checks each tracked account: if the number
        of days spent in the current phase >= the phase's ``days_total``
        (and ``days_total > 0``), advances to the next phase.

        Returns:
            A list of human-readable status messages describing what
            happened (e.g. ``"CommentAwkward3993 advanced from phase 0 "
            "(Week 1: Observe Only) to phase 1 (Week 2: Low-Stakes "
            "Comments)"``).
        """
        messages: list[str] = []
        today = self._today()

        with self._lock:
            accounts = self._state.setdefault("accounts", {})
            modified = False

            for account_name, account in list(accounts.items()):
                phase_num = account.get("current_phase", 0)
                phase_def = _phase_by_number(phase_num)

                if phase_def is None or phase_def.days_total == 0:
                    # Final phase (ongoing) — nothing to advance
                    continue

                phase_start = date.fromisoformat(
                    account.get("phase_start_date", today.isoformat())
                )
                days_in_phase = max(0, (today - phase_start).days)

                if days_in_phase >= phase_def.days_total:
                    prev = phase_num
                    new_phase = phase_num + 1

                    if new_phase >= len(PHASES):
                        # Cap at final phase
                        new_phase = len(PHASES) - 1
                        account["current_phase"] = new_phase
                        account["phase_start_date"] = today.isoformat()
                    else:
                        account["current_phase"] = new_phase
                        account["phase_start_date"] = today.isoformat()

                    account["actions_today"] = 0
                    account["last_action_time"] = None
                    modified = True

                    new_def = _phase_by_number(new_phase)
                    new_name = new_def.name if new_def else "Unknown"
                    prev_def = _phase_by_number(prev)
                    prev_name = prev_def.name if prev_def else "Unknown"

                    if new_phase >= 9:
                        messages.append(
                            f"{account_name} advanced from phase {prev} "
                            f"({prev_name}) to phase {new_phase} "
                            f"({new_name}). Account is now FULLY WARMED UP!"
                        )
                    else:
                        messages.append(
                            f"{account_name} advanced from phase {prev} "
                            f"({prev_name}) to phase {new_phase} "
                            f"({new_name})."
                        )

                else:
                    # Reset daily counters for fresh day
                    self._reset_daily_counter(account)

            if not messages:
                messages.append("No accounts needed phase advancement today.")

            if modified:
                self._save()

        return messages
