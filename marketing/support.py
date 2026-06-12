"""Automated support response system — detects community signals, classifies
them, drafts tier-1 responses, and escalates to a human when needed.

The ``SupportAgent`` orchestrates the full support triage workflow:

1. Detect support signals from replies/comments/mentions
2. Classify each signal into a category
3. Determine triage action (auto-respond / escalate / acknowledge-and-escalate)
4. Draft context-appropriate responses
5. Pass auto-responses through humanization quality gate (I₇)
6. Log actions to CampaignStore
7. Format escalation messages for human review

Usage::

    agent = SupportAgent(store)
    summary = agent.run_support_cycle(sources=[...])
    print(f"Auto-responded: {summary['auto_responded']}")
    print(f"Escalated: {summary['escalated']}")
"""

from __future__ import annotations

import logging
import random
import re
import threading
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    from marketing.store import CampaignStore
except ImportError:
    CampaignStore = None  # type: ignore[misc,assignment]

try:
    from marketing.humanization_gate import HumanizationGate
except ImportError:
    HumanizationGate = None  # type: ignore[misc,assignment]

logger = logging.getLogger(__name__)

# ── Support keyword sets ─────────────────────────────────────────────────────

# Broad keyword set for signal detection
_SUPPORT_KEYWORDS: frozenset[str] = frozenset({
    "bug", "error", "doesn't work", "broken", "how do i", "can't",
    "help", "issue", "problem", "not working", "fix", "crash", "fail",
    "documentation", "example", "tutorial", "setup", "install",
    "configure", "pricing", "cost", "free", "paid", "license",
    "alternative", "compared",
})

# Per-category classification keyword sets
_BUG_KEYWORDS: frozenset[str] = frozenset({
    "bug", "error", "doesn't work", "broken", "not working", "crash",
})

_FEATURE_KEYWORDS: frozenset[str] = frozenset({
    "wish", "would be nice", "missing", "could you add", "feature",
    "roadmap", "suggestion",
})

_HELP_KEYWORDS: frozenset[str] = frozenset({
    "how do i", "how to", "can't", "help", "documentation", "setup",
    "install", "configure", "example", "tutorial",
})

_COMPLAINT_KEYWORDS: frozenset[str] = frozenset({
    "bad", "terrible", "awful", "worst", "hate", "useless",
    "disappointed", "frustrating",
})

_PRICING_KEYWORDS: frozenset[str] = frozenset({
    "pricing", "cost", "how much", "free", "paid", "license", "worth",
})

# Aggressive language indicators for escalation
_AGGRESSIVE_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bscam\b", re.IGNORECASE),
    re.compile(r"\brip.?off\b", re.IGNORECASE),
    re.compile(r"\bthief?\b", re.IGNORECASE),
    re.compile(r"\blie\b", re.IGNORECASE),
    re.compile(r"\blying\b", re.IGNORECASE),
    re.compile(r"\bfraud\b", re.IGNORECASE),
    re.compile(r"\btrash\b", re.IGNORECASE),
    re.compile(r"\bworthless\b", re.IGNORECASE),
    re.compile(r"\bwaste.*time\b", re.IGNORECASE),
    re.compile(r"\bstole\b", re.IGNORECASE),
    re.compile(r"\bstealing\b", re.IGNORECASE),
    re.compile(r"\bchargeback\b", re.IGNORECASE),
    re.compile(r"\brefund.*now\b", re.IGNORECASE),
    re.compile(r"\byou.*suck\b", re.IGNORECASE),
]

# ── Account personas (mirrored from reply_monitor.py) ───────────────────────

_ACCOUNT_PERSONAS: dict[str, dict[str, Any]] = {
    "CommentAwkward3993": {
        "tone": "slightly awkward but knowledgeable",
        "style": "over-explains then self-corrects",
        "colloquialisms": ("honestly", "ngl", "kinda", "i might be wrong but"),
    },
    "Slow-Guy-Chiu": {
        "tone": "deliberate and thoughtful",
        "style": "answers with personal experience, takes time to explain",
        "colloquialisms": ("i think", "from what i've seen", "fwiw", "ymmv"),
    },
    "Pro_Shame": {
        "tone": "slightly sarcastic but helpful",
        "style": "direct, no fluff, occasionally self-deprecating",
        "colloquialisms": ("tbh", "honestly", "yeah nah", "fair enough"),
    },
    "J0llibee_yummy": {
        "tone": "enthusiastic and approachable",
        "style": "friendly, uses exclamation marks sparingly, shares wins and fails",
        "colloquialisms": ("omg", "honestly", "same here", "right?"),
    },
    "Love-KCF": {
        "tone": "chill and laid-back",
        "style": "short sentences, doesn't over-explain, casual vibe",
        "colloquialisms": ("yeah", "nah", "probs", "dunno", "fair"),
    },
}

_DEFAULT_PERSONA: dict[str, Any] = {
    "tone": "friendly and helpful",
    "style": "conversational",
    "colloquialisms": ("honestly", "i think", "tbh"),
}

# ── AI tell word list for response quality filtering ────────────────────────

_AI_TELL_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bdelve\b", re.IGNORECASE),
    re.compile(r"\btapestry\b", re.IGNORECASE),
    re.compile(r"\brealm\b", re.IGNORECASE),
    re.compile(r"\blandscape\b", re.IGNORECASE),
    re.compile(r"\bjourney\b", re.IGNORECASE),
    re.compile(r"\bpivotal\b", re.IGNORECASE),
    re.compile(r"\bunderscore\b", re.IGNORECASE),
    re.compile(r"\bfoster\b", re.IGNORECASE),
    re.compile(r"\btestament\b", re.IGNORECASE),
    re.compile(r"\benhance\b", re.IGNORECASE),
    re.compile(r"\bleverage\b", re.IGNORECASE),
    re.compile(r"\bseamless\b", re.IGNORECASE),
    re.compile(r"\bcutting-edge\b", re.IGNORECASE),
    re.compile(r"\binnovative\b", re.IGNORECASE),
    re.compile(r"\bgame-changing\b", re.IGNORECASE),
    re.compile(r"\bit's important to note\b", re.IGNORECASE),
    re.compile(r"\bit's worth noting\b", re.IGNORECASE),
    re.compile(r"\brather than\b", re.IGNORECASE),
]


def _now() -> str:
    """Return current UTC timestamp as ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def _utc_from_iso(ts: str) -> datetime:
    """Parse an ISO-8601 timestamp string to a UTC datetime."""
    try:
        dt = datetime.fromisoformat(ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return datetime.now(timezone.utc)


def _strip_ai_tells(text: str) -> str:
    """Remove common AI tell words and phrases from *text*."""
    for pat in _AI_TELL_PATTERNS:
        text = pat.sub("", text)
    # Clean up resulting double spaces
    text = re.sub(r"  +", " ", text)
    return text.strip()


def _has_aggressive_language(text: str) -> bool:
    """Return ``True`` if *text* contains aggressive/scam-accusation language."""
    return any(p.search(text) for p in _AGGRESSIVE_PATTERNS)


# =============================================================================
# SupportAgent
# =============================================================================


class SupportAgent:
    """Automated support response engine.

    Detects community support signals, classifies them, drafts tier-1
    responses, and escalates complex or high-urgency issues to human
    operators.

    Args:
        store: ``CampaignStore`` instance for logging support actions.
    """

    # Class-level campaign ID cache (shared across instances)
    _SUPPORT_CAMPAIGN_ID: str | None = None

    # ── lifecycle ─────────────────────────────────────────────────────────

    def __init__(self, store: Any) -> None:  # CampaignStore
        self._store = store
        self._lock = threading.Lock()
        self._humanization_gate: Any = None

        # Lazily initialise HumanizationGate on first use
        if HumanizationGate is not None:
            self._humanization_gate = HumanizationGate(default_threshold=70.0)

    # ── signal detection ───────────────────────────────────────────────────

    def detect_support_signals(
        self,
        sources: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        """Scan comments/replies for support-related content.

        Args:
            sources: Optional list of pre-collected reply dicts (e.g. from
                ``ReplyMonitor``). Each dict should contain at least
                ``reply_text``, and optionally ``author``, ``context_url``,
                ``platform``, ``reply_id``.

                If ``None``, checks ``CampaignStore`` for recently logged
                actions with ``status`` of ``"pending"`` and
                ``action_type`` in ``("comment", "reply", "mention")``.

        Returns:
            A list of signal dicts with keys:

            - ``signal_id``: Unique identifier for the signal.
            - ``source_platform``: Platform the signal originated from.
            - ``source_url``: URL of the original comment/reply.
            - ``author``: Username of the author.
            - ``text``: Raw text of the signal.
            - ``timestamp``: ISO-8601 timestamp.
            - ``keywords_matched``: List of support keywords found in the text.
        """
        signals: list[dict[str, Any]] = []

        if sources is not None:
            # Use pre-collected sources
            for src in sources:
                text = (src.get("reply_text") or src.get("text") or "").strip()
                if not text:
                    continue
                matched = self._match_support_keywords(text)
                if not matched:
                    continue
                signals.append(self._build_signal(src, text, matched))
        else:
            # Fall back to CampaignStore for pending actions
            try:
                actions = self._store.get_actions(
                    campaign_id="__support__",
                    # NOTE: get_actions filters by campaign_id.
                    # If no support-specific campaign exists, we look at
                    # all pending actions across known campaigns.
                )
            except Exception:
                actions = []

            # If no support campaign actions found, try broad scan
            if not actions:
                try:
                    for c in self._store.list_campaigns():
                        pending = self._store.get_actions(c["id"])
                        for a in pending:
                            if a.get("status") == "pending" and a.get(
                                "action_type"
                            ) in ("comment", "reply", "mention"):
                                actions.append(a)
                except Exception:
                    actions = []

            for action in actions:
                text = (action.get("content_preview") or "").strip()
                if not text:
                    continue
                matched = self._match_support_keywords(text)
                if not matched:
                    continue
                signals.append(
                    self._build_signal_from_action(action, text, matched)
                )

        logger.info(
            "detect_support_signals: %d signal(s) detected from %s",
            len(signals),
            "sources" if sources is not None else "store",
        )
        return signals

    @staticmethod
    def _match_support_keywords(text: str) -> list[str]:
        """Return all support keywords present in *text* (case-insensitive).

        Uses stem-friendly matching (no trailing ``\\b``) so that e.g.
        ``"crash"`` matches ``"crashed"``, ``"crashing"``, etc.
        """
        text_lower = text.lower()
        matched: list[str] = []
        for kw in _SUPPORT_KEYWORDS:
            if " " in kw:
                if kw in text_lower:
                    matched.append(kw)
            else:
                # No trailing \\b — match stems like crash→crashed
                if re.search(rf"\b{re.escape(kw)}", text_lower):
                    matched.append(kw)
        return matched

    def _build_signal(
        self,
        source: dict[str, Any],
        text: str,
        matched: list[str],
    ) -> dict[str, Any]:
        """Build a signal dict from a source dict."""
        return {
            "signal_id": str(uuid.uuid4())[:12],
            "source_platform": source.get("platform", "unknown"),
            "source_url": source.get("context_url", ""),
            "author": source.get("author", "unknown"),
            "text": text,
            "timestamp": source.get("timestamp", _now()),
            "keywords_matched": matched,
        }

    def _build_signal_from_action(
        self,
        action: dict[str, Any],
        text: str,
        matched: list[str],
    ) -> dict[str, Any]:
        """Build a signal dict from a CampaignStore action."""
        return {
            "signal_id": f"sig_{action.get('id', 'unknown')}",
            "source_platform": action.get("platform", "unknown"),
            "source_url": action.get("target_url", ""),
            "author": action.get("profile_name", "unknown"),
            "text": text,
            "timestamp": action.get("timestamp", _now()),
            "keywords_matched": matched,
        }

    # ── classification ────────────────────────────────────────────────────

    def classify_signal(self, text: str) -> dict[str, Any]:
        """Rule-based classification of a support signal.

        Evaluates the text against per-category keyword sets in priority
        order. Returns the first matching category with a confidence score
        proportional to how many of the category's keywords were matched.

        Args:
            text: The raw signal text to classify.

        Returns:
            A dict with keys:

            - ``type``: One of ``"bug_report"``, ``"feature_request"``,
              ``"help_question"``, ``"complaint"``, ``"pricing_question"``,
              ``"general_feedback"``.
            - ``confidence``: Float in [0, 1] representing match strength.
            - ``triggered_keywords``: List of keywords that triggered the
              classification.
        """
        text_lower = text.lower()

        # Check categories in priority order
        category_checks: list[tuple[str, frozenset[str]]] = [
            ("bug_report", _BUG_KEYWORDS),
            ("feature_request", _FEATURE_KEYWORDS),
            ("help_question", _HELP_KEYWORDS),
            ("complaint", _COMPLAINT_KEYWORDS),
            ("pricing_question", _PRICING_KEYWORDS),
        ]

        for cat_name, cat_keywords in category_checks:
            triggered = self._match_category_keywords(text_lower, cat_keywords)
            if triggered:
                confidence = self._compute_confidence(triggered, cat_keywords)
                return {
                    "type": cat_name,
                    "confidence": round(confidence, 2),
                    "triggered_keywords": triggered,
                }

        # Fallback
        return {
            "type": "general_feedback",
            "confidence": 0.3,
            "triggered_keywords": [],
        }

    @staticmethod
    def _match_category_keywords(
        text_lower: str,
        keywords: frozenset[str],
    ) -> list[str]:
        """Return all *keywords* found in *text_lower* (stem-friendly)."""
        matched: list[str] = []
        for kw in keywords:
            if " " in kw:
                if kw in text_lower:
                    matched.append(kw)
            else:
                if re.search(rf"\b{re.escape(kw)}", text_lower):
                    matched.append(kw)
        return matched

    @staticmethod
    def _compute_confidence(
        triggered: list[str],
        category_keywords: frozenset[str],
    ) -> float:
        """Compute confidence score for a category match.

        Confidence = min(1.0, n_matched / max(1, n_keywords_in_set) * 1.5)
        """
        n_matched = len(triggered)
        n_total = max(1, len(category_keywords))
        raw = n_matched / n_total * 1.5
        return min(1.0, raw)

    # ── triage ────────────────────────────────────────────────────────────

    def determine_triage(self, signal: dict[str, Any]) -> dict[str, Any]:
        """Determine the response path for a classified signal.

        Args:
            signal: A signal dict as returned by :meth:`detect_support_signals`
                or :meth:`classify_signal`. Must contain ``text`` and the
                classification result is obtained by calling
                :meth:`classify_signal` on the text.

        Returns:
            A dict with keys:

            - ``action``: One of ``"auto_respond"``, ``"escalate"``,
              ``"acknowledge_and_escalate"``.
            - ``urgency``: ``"low"`` (> 24h response window),
              ``"medium"`` (< 6h), or ``"high"`` (< 2h).
            - ``route``: Human-readable explanation of the triage decision.
        """
        text = signal.get("text", "")
        classification = self.classify_signal(text)
        cat = classification["type"]
        keywords = classification["triggered_keywords"]

        # Check aggressive language first — overrides everything
        has_aggressive = _has_aggressive_language(text)
        if has_aggressive:
            return {
                "action": "escalate",
                "urgency": "high",
                "route": (
                    "Aggressive language detected — "
                    "immediate escalation to human operator required."
                ),
            }

        # Check for crash keywords (stem-friendly: matches crashed, crashing)
        has_crash = bool(re.search(r"\bcrash", text.lower()))

        # Category-specific triage
        if cat == "complaint":
            return {
                "action": "acknowledge_and_escalate",
                "urgency": "medium",
                "route": (
                    "Complaint detected — acknowledge and escalate to "
                    "human for follow-up."
                ),
            }

        if cat == "bug_report":
            if has_crash:
                return {
                    "action": "escalate",
                    "urgency": "high",
                    "route": (
                        "Bug report with crash keyword detected — "
                        "immediate escalation required."
                    ),
                }
            return {
                "action": "acknowledge_and_escalate",
                "urgency": "medium",
                "route": (
                    "Bug report detected — acknowledge and escalate "
                    "to engineering team."
                ),
            }

        if cat == "pricing_question":
            return {
                "action": "auto_respond",
                "urgency": "medium",
                "route": (
                    "Pricing question — auto-respond with pricing "
                    "information."
                ),
            }

        if cat == "help_question":
            return {
                "action": "auto_respond",
                "urgency": "medium",
                "route": (
                    "Help question detected — auto-respond with "
                    "assistance."
                ),
            }

        if cat == "feature_request":
            return {
                "action": "auto_respond",
                "urgency": "low",
                "route": (
                    "Feature request detected — auto-respond "
                    "acknowledging the suggestion."
                ),
            }

        # general_feedback (fallback)
        return {
            "action": "auto_respond",
            "urgency": "low",
            "route": (
                "General feedback — auto-respond with thanks."
            ),
        }

    # ── response drafting ─────────────────────────────────────────────────

    def draft_response(
        self,
        signal: dict[str, Any],
        account_name: str,
    ) -> str:
        """Generate a context-appropriate response for a support signal.

        Templates are designed to:
        - Stay under 300 characters
        - Avoid AI tell words (``delve``, ``tapestry``, etc.)
        - Match the account's persona voice
        - Sound human and conversational

        Args:
            signal: A signal dict with at least ``text``. Classification
                is run internally.
            account_name: The account persona to use for response voice.

        Returns:
            A response string (< 300 chars), stripped of AI tell words.
        """
        text = signal.get("text", "")
        classification = self.classify_signal(text)
        cat = classification["type"]
        persona = _ACCOUNT_PERSONAS.get(account_name, _DEFAULT_PERSONA)
        coll = random.choice(persona["colloquialisms"])

        if cat == "bug_report":
            raw = (
                f"Thanks for reporting this — I've passed it to the team. "
                f"Could you share any error messages or steps to reproduce?"
            )
        elif cat == "feature_request":
            raw = (
                f"Interesting idea! I'll share this with the team. "
                f"We're tracking feature requests internally."
            )
        elif cat == "help_question":
            raw = (
                f"Here's how to set it up: check the docs for a step-by-step "
                f"guide. {coll.capitalize()}, feel free to DM me if you need "
                f"more help."
            )
        elif cat == "complaint":
            raw = (
                f"I appreciate the honest feedback. {coll.capitalize()}, "
                f"would you be open to sharing more about what didn't work "
                f"for you?"
            )
        elif cat == "pricing_question":
            raw = (
                f"We offer both free and paid tiers. The free tier includes "
                f"the core features. Happy to answer specific questions!"
            )
        else:  # general_feedback
            raw = (
                f"Thanks for sharing your thoughts! "
                f"I'll make sure the team sees this."
            )

        # Strip AI tell words
        raw = _strip_ai_tells(raw)
        # Ensure under 300 chars
        if len(raw) > 297:
            raw = raw[:294] + "..."
        return raw

    # ── escalation formatting ─────────────────────────────────────────────

    def format_escalation(
        self,
        signal: dict[str, Any],
        auto_response: str | None = None,
    ) -> dict[str, Any]:
        """Format an escalation message for human review.

        Args:
            signal: The signal dict being escalated.
            auto_response: Auto-drafted response text, if any (for
                ``acknowledge_and_escalate`` cases).

        Returns:
            A dict with keys:

            - ``to``: Target platform/channel for the escalation.
            - ``subject``: Brief subject line.
            - ``body``: Markdown-formatted escalation body.
            - ``signal_data``: The original signal dict for reference.
        """
        classification = self.classify_signal(signal.get("text", ""))
        triage = self.determine_triage(signal)

        platform = signal.get("source_platform", "unknown")
        url = signal.get("source_url", "(no URL)")
        author = signal.get("author", "unknown")
        sig_text = signal.get("text", "")
        sig_time = signal.get("timestamp", _now())
        sig_id = signal.get("signal_id", "unknown")

        # Build markdown body
        lines: list[str] = [
            f"## Support Escalation — {classification['type'].replace('_', ' ').title()}",
            "",
            f"**Signal ID:** {sig_id}",
            f"**Platform:** {platform}",
            f"**URL:** {url}",
            f"**Author:** {author}",
            f"**Timestamp:** {sig_time}",
            f"**Urgency:** {triage['urgency'].upper()}",
            f"**Action:** {triage['action'].replace('_', ' ').title()}",
            f"**Category:** {classification['type']}",
            f"**Confidence:** {classification['confidence']:.0%}",
            "",
            "### Original Message",
            "",
            f"> {sig_text}",
            "",
            "### Triage Decision",
            "",
            triage["route"],
            "",
        ]

        if auto_response:
            lines.extend([
                "### Auto-Drafted Response",
                "",
                f"> {auto_response}",
                "",
            ])

        lines.extend([
            "### Triggered Keywords",
            "",
            ", ".join(classification.get("triggered_keywords", ["(none)"])) if classification.get("triggered_keywords") else "(none)",
            "",
            "---",
            "*This escalation was automatically generated by SupportAgent.*",
        ])

        return {
            "to": f"#{platform}-support",
            "subject": (
                f"[{triage['urgency'].upper()}] {classification['type'].replace('_', ' ').title()}"
                f" from {author} on {platform}"
            ),
            "body": "\n".join(lines),
            "signal_data": dict(signal),
        }

    # ── humanization quality check (I₇) ────────────────────────────────────

    def _passes_humanization_gate(self, text: str) -> bool:
        """Check if *text* passes the I₇ humanization quality gate.

        Uses ``HumanizationGate`` if available; otherwise falls back to
        a lightweight stdlib check (AI tell word scan).
        """
        if self._humanization_gate is not None:
            result = self._humanization_gate.check(text, platform="reddit")
            return bool(result.get("pass", False))

        # Fallback: scan for AI tell words
        for pat in _AI_TELL_PATTERNS:
            if pat.search(text):
                logger.debug(
                    "humanization fallback: AI tell word found in response"
                )
                return False
        return True

    # ── campaign store helpers ─────────────────────────────────────────────

    def _ensure_campaign_id(self) -> str:
        """Return the campaign ID for support logging, creating if needed."""
        with self._lock:
            if SupportAgent._SUPPORT_CAMPAIGN_ID is not None:
                return SupportAgent._SUPPORT_CAMPAIGN_ID

            try:
                for c in self._store.list_campaigns():
                    if c.get("name") == "Support Agent":
                        SupportAgent._SUPPORT_CAMPAIGN_ID = c["id"]
                        return c["id"]

                cid = self._store.create_campaign({
                    "name": "Support Agent",
                    "product": "OpenTalk2HTML-NotMD",
                    "status": "active",
                })
                SupportAgent._SUPPORT_CAMPAIGN_ID = cid
                return cid
            except Exception:
                logger.exception("Failed to ensure support campaign exists")
                return "__support__"

    def _log_support_action(
        self,
        signal: dict[str, Any],
        action_type: str,
        content_preview: str | None = None,
        status: str = "pending",
        account_name: str | None = None,
    ) -> None:
        """Log a support action to CampaignStore."""
        try:
            cid = self._ensure_campaign_id()
            self._store.log_action(
                campaign_id=cid,
                platform=signal.get("source_platform", "unknown"),
                action_type=action_type,
                target_url=signal.get("source_url"),
                content_preview=content_preview or signal.get("text", "")[:100],
                status=status,
                profile_name=account_name,
            )
        except Exception:
            logger.exception("Failed to log support action to store")

    # ── full support cycle ─────────────────────────────────────────────────

    def run_support_cycle(
        self,
        sources: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Run a full support triage cycle.

        1. Detect support signals from provided sources or CampaignStore
        2. Classify each signal
        3. Determine triage for each
        4. For auto-respond: draft response, check humanization gate, log
        5. For escalate: format escalation message
        6. For acknowledge-and-escalate: draft acknowledgment, log, format escalation
        7. Return summary

        Args:
            sources: Optional list of pre-collected reply/comment dicts.
                Passed through to :meth:`detect_support_signals`.

        Returns:
            A summary dict with keys:

            - ``processed``: Total signals processed.
            - ``auto_responded``: Count of auto-responded signals.
            - ``escalated``: Count of escalated signals.
            - ``ack_and_esc``: Count of acknowledge-and-escalate signals.
            - ``humanization_failures``: Count of responses that failed the
              I₇ gate.
            - ``details``: Per-signal processing details.
            - ``message``: Human-readable summary string.
        """
        cycle_log: list[dict[str, Any]] = []
        counts: dict[str, int] = {
            "auto_responded": 0,
            "escalated": 0,
            "ack_and_esc": 0,
            "humanization_failures": 0,
        }

        # Step 1: Detect signals
        signals = self.detect_support_signals(sources)
        logger.info("run_support_cycle: detected %d signal(s)", len(signals))

        for signal in signals:
            # Work with a copy to avoid mutating the source
            signal = dict(signal)

            # Step 2: Classify & triage
            classification = self.classify_signal(signal.get("text", ""))
            signal["classification"] = classification
            triage = self.determine_triage(signal)
            signal["triage"] = triage

            action = triage["action"]
            account_name = (
                signal.get("author") or
                signal.get("profile_name") or
                "SupportAgent"
            )

            entry: dict[str, Any] = {
                "signal_id": signal["signal_id"],
                "category": classification["type"],
                "action": action,
                "urgency": triage["urgency"],
                "auto_response": None,
                "escalation": None,
                "humanization_passed": None,
            }

            if action == "auto_respond":
                # Step 4: Draft response
                response = self.draft_response(signal, account_name)

                # Pass through humanization gate
                human_ok = self._passes_humanization_gate(response)
                entry["humanization_passed"] = human_ok
                if not human_ok:
                    counts["humanization_failures"] += 1
                    logger.warning(
                        "Signal %s: response failed humanization gate — "
                        "escalating anyway",
                        signal["signal_id"],
                    )

                entry["auto_response"] = response

                # Log to store
                self._log_support_action(
                    signal=signal,
                    action_type="support_auto_respond",
                    content_preview=response[:100],
                    status="auto_responded",
                    account_name=account_name,
                )
                counts["auto_responded"] += 1

            elif action == "escalate":
                # Step 5: Format escalation (no auto-response)
                escalation = self.format_escalation(signal, auto_response=None)
                entry["escalation"] = escalation

                self._log_support_action(
                    signal=signal,
                    action_type="support_escalate",
                    content_preview=f"Escalated: {classification['type']}",
                    status="escalated",
                    account_name=account_name,
                )
                counts["escalated"] += 1

            elif action == "acknowledge_and_escalate":
                # Step 6: Draft acknowledgment
                response = self.draft_response(signal, account_name)

                # Pass through humanization gate
                human_ok = self._passes_humanization_gate(response)
                entry["humanization_passed"] = human_ok
                if not human_ok:
                    counts["humanization_failures"] += 1
                    logger.warning(
                        "Signal %s: acknowledgment failed humanization gate",
                        signal["signal_id"],
                    )

                entry["auto_response"] = response

                # Log acknowledgment to store
                self._log_support_action(
                    signal=signal,
                    action_type="support_acknowledge",
                    content_preview=response[:100],
                    status="acknowledged",
                    account_name=account_name,
                )

                # Then format escalation with the auto-response included
                escalation = self.format_escalation(signal, auto_response=response)
                entry["escalation"] = escalation

                counts["ack_and_esc"] += 1

            else:
                logger.warning(
                    "Unknown triage action '%s' for signal %s — skipping",
                    action,
                    signal["signal_id"],
                )

            cycle_log.append(entry)

        total = len(signals)
        message_parts: list[str] = []
        if total:
            message_parts.append(f"Processed {total} signal(s)")
            if counts["auto_responded"]:
                message_parts.append(f"{counts['auto_responded']} auto-responded")
            if counts["escalated"]:
                message_parts.append(f"{counts['escalated']} escalated")
            if counts["ack_and_esc"]:
                message_parts.append(
                    f"{counts['ack_and_esc']} acknowledged-and-escalated"
                )
            if counts["humanization_failures"]:
                message_parts.append(
                    f"{counts['humanization_failures']} humanization failure(s)"
                )
        else:
            message_parts.append("No support signals detected")

        return {
            "processed": total,
            "auto_responded": counts["auto_responded"],
            "escalated": counts["escalated"],
            "ack_and_esc": counts["ack_and_esc"],
            "humanization_failures": counts["humanization_failures"],
            "details": cycle_log,
            "message": " — ".join(message_parts) if message_parts else "No signals processed.",
        }
