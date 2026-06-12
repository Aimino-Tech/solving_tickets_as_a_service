"""Content humanization verification gate.

Detects all 12 AI tells from ``knowledge/humanize-prompt.md`` as scored
quantitative checks. Pure stdlib — no external dependencies.

Usage::

    gate = HumanizationGate()
    result = gate.check("Your text here...")
    if result["pass"]:
        print("Looks human enough!")
    else:
        print(f"Score: {result['score']:.1f}/100")
        for f in result["failures"]:
            print(f"  - {f['check']}: {f['reasons']}")
"""

from __future__ import annotations

import math
import re
import statistics
from typing import Any

# ---------------------------------------------------------------------------
# Word lists & patterns — all sourced from knowledge/humanize-prompt.md
# ---------------------------------------------------------------------------

# Tier 1 — immediate flag when 2+ appear together
_TIER_1_WORDS: frozenset[str] = frozenset({
    "delve", "tapestry", "realm", "landscape", "journey",
    "pivotal", "underscore", "foster", "testament", "enhance",
})

# Tier 2 — suspicious in clusters of 3+
_TIER_2_WORDS: frozenset[str] = frozenset({
    "leverage", "robust", "seamless", "holistic", "streamline",
    "utilize", "facilitate", "navigate", "ecosystem", "transformative",
    "multifaceted", "paramount", "cutting-edge", "innovative",
})

# #1 single-word tell
_SINGLE_TELL_ENSURE: re.Pattern[str] = re.compile(r"\bensuring\b", re.IGNORECASE)
# #1 multi-word tell
_TELL_RATHER_THAN: re.Pattern[str] = re.compile(r"\brather than\b", re.IGNORECASE)

# Formulaic openers (check 7 in the doc, check 5 here)
_FORMULAIC_OPENER_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bin recent years\b", re.IGNORECASE),
    re.compile(r"\bin today's\b", re.IGNORECASE),
    re.compile(r"\bthere are several\b", re.IGNORECASE),
    re.compile(r"\bit is important to\b", re.IGNORECASE),
    re.compile(r"\bone of the most\b", re.IGNORECASE),
    re.compile(r"\bin the world of\b", re.IGNORECASE),
    re.compile(r"\bwhen it comes to\b", re.IGNORECASE),
    re.compile(r"\bthe landscape of\b", re.IGNORECASE),
]

# Hedging verbs — AI hedges comparisons; humans make direct statements
_HEDGING_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bensuring\b", re.IGNORECASE),
    re.compile(r"\bhighlights\b", re.IGNORECASE),
    re.compile(r"\bsupports\b", re.IGNORECASE),
    re.compile(r"\breflects\b", re.IGNORECASE),
    re.compile(r"\bsuggests\b", re.IGNORECASE),
    re.compile(r"\bindicates\b", re.IGNORECASE),
    re.compile(r"\bappears\b", re.IGNORECASE),
    re.compile(r"\bseems\b", re.IGNORECASE),
    re.compile(r"\btends to\b", re.IGNORECASE),
    re.compile(r"\bmay be\b", re.IGNORECASE),
    re.compile(r"\bcould be\b", re.IGNORECASE),
    re.compile(r"\bwould be\b", re.IGNORECASE),
]

# Intensifier adverbs — empty calories
_INTENSIFIER_WORDS: frozenset[str] = frozenset({
    "significantly", "effectively", "increasingly", "extremely",
    "highly", "notably", "remarkably", "substantially",
    "tremendously", "vastly",
})

# Wrapped-conclusion starters
_WRAPPED_CONCLUSION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"^in conclusion\b", re.IGNORECASE),
    re.compile(r"^to summarize\b", re.IGNORECASE),
    re.compile(r"^overall[,\s]", re.IGNORECASE),
    re.compile(r"^in summary\b", re.IGNORECASE),
]

# "Plays a crucial role" sentence shape
_CRUCIAL_ROLE_PATTERN: re.Pattern[str] = re.compile(
    r"plays?\s+(?:a\s+)?(?:crucial|critical|important|vital)\s+role",
    re.IGNORECASE,
)

# "Not just X but Y" / "Not only X but Y"
_NOT_JUST_X_BUT_Y_PATTERN: re.Pattern[str] = re.compile(
    r"\bnot\s+just\s+\S+(?:\s+\S+){0,4}\s+but\b|\bnot\s+only\s+\S+(?:\s+\S+){0,4}\s+but\b",
    re.IGNORECASE,
)

# Negative emotion word list for neutrality-bias check
_NEGATIVE_EMOTION_WORDS: frozenset[str] = frozenset({
    "bad", "wrong", "terrible", "awful", "hate", "hated", "hateful",
    "angry", "furious", "annoyed", "frustrated", "frustrating",
    "stupid", "dumb", "ridiculous", "absurd", "horrible", "painful",
    "ugly", "waste", "useless", "broken", "disaster", "horrific",
    "disgusting", "terrified", "terrifying", "pathetic", "miserable",
    "sucks", "suck", "crap", "trash", "garbage",
    "disappointed", "annoying", "fed up", "sick of", "tired of",
})

# Em-dash pattern (Unicode em-dash or spaced/sectioned double-hyphen)
_EM_DASH_PATTERN: re.Pattern[str] = re.compile(r"[\u2014\u2015]|---")

# Tricolon pattern: "X, Y, and Z" or "X, Y, or Z"
_TRICOLON_PATTERN: re.Pattern[str] = re.compile(
    r"\b(\w+(?:\s+\w+)?),\s+(\w+(?:\s+\w+)?),\s+(?:and|or)\s+(\w+(?:\s+\w+)?)\b",
    re.IGNORECASE,
)

# ---------------------------------------------------------------------------
# Thresholds & weights
# ---------------------------------------------------------------------------

_PLATFORM_THRESHOLDS: dict[str, float] = {
    "reddit": 70.0,
    "hn": 80.0,
    "twitter": 60.0,
}

_CHECK_WEIGHTS: list[tuple[str, float]] = [
    ("banned_words", 0.30),
    ("burstiness", 0.15),
    ("tricolons", 0.08),
    ("em_dashes", 0.03),
    ("formulaic_openers", 0.10),
    ("hedging_verbs", 0.10),
    ("intensifier_adverbs", 0.08),
    ("paragraph_uniformity", 0.08),
    ("wrapped_conclusions", 0.08),
    ("neutrality_bias", 0.08),
    ("crucial_role", 0.03),
    ("not_just_x_but_y", 0.03),
]

_TOTAL_WEIGHT: float = sum(w for _, w in _CHECK_WEIGHTS)


# ===================================================================
# HumanizationGate
# ===================================================================


class HumanizationGate:
    """Content humanization verification gate.

    Scores text on all 12 AI-tell dimensions from the Hermes humanization
    knowledge base and produces a pass/fail verdict with a weighted overall
    score (0–100). Pure stdlib — no external dependencies.

    The pass threshold is platform-aware:

    ========= ===========
    Platform  Threshold
    ========= ===========
    reddit    70
    hn        80
    twitter   60
    default   70 (configurable)
    ========= ===========

    Usage::

        gate = HumanizationGate()
        result = gate.check("Your text here...", platform="reddit")
        if result["pass"]:
            print("Content passes humanization gate.")
        else:
            print(f"Failures: {result['failures']}")
    """

    # ── lifecycle ─────────────────────────────────────────────────────

    def __init__(self, default_threshold: float = 70.0) -> None:
        """Initialise the gate.

        Args:
            default_threshold: Score (0–100) above which text is considered
                human enough when no platform override applies.
        """
        self._default_threshold = default_threshold

    # ── public API ────────────────────────────────────────────────────

    def check(self, content: str, platform: str = "reddit") -> dict[str, Any]:
        """Run all 12 AI-tell checks on *content*.

        Args:
            content: The text to evaluate.
            platform: Target platform for threshold lookup
                (``"reddit"``, ``"hn"``, ``"twitter"``). Falls back to
                ``default_threshold`` for unknown platforms.

        Returns:
            A dict with the following keys:

            **pass** (*bool*)
                ``True`` when the weighted score meets or exceeds the
                platform threshold.
            **score** (*float*)
                Weighted overall score (0–100).
            **failures** (*list[dict]*)
                Every check that scored below 60, each with ``check``
                (name), ``score`` (numeric), and ``reasons`` (list of
                human-readable failure descriptions).
            **details** (*dict*)
                Per-check breakdown keyed by check name. Each value is a
                dict ``{"score": float, "details": str, "failures": list[str]}``.
        """
        threshold = _PLATFORM_THRESHOLDS.get(platform, self._default_threshold)

        details: dict[str, dict[str, Any]] = {}
        weighted_sum = 0.0

        for name, weight in _CHECK_WEIGHTS:
            method = getattr(self, f"_check_{name}")
            result: dict[str, Any] = method(content)
            details[name] = result
            weighted_sum += result["score"] * weight

        overall = weighted_sum / _TOTAL_WEIGHT

        failures: list[dict[str, Any]] = [
            {
                "check": name,
                "score": details[name]["score"],
                "reasons": details[name]["failures"],
            }
            for name, _ in _CHECK_WEIGHTS
            if details[name]["score"] < 60.0
        ]

        return {
            "pass": overall >= threshold,
            "score": round(overall, 1),
            "failures": failures,
            "details": details,
        }

    def summarize(self, content: str) -> dict[str, Any]:
        """Return a concise pass/fail summary for LLM consumption.

        Unlike :meth:`check` which returns a full breakdown,
        ``summarize`` produces a terse verdict with only the
        under-performing checks listed.

        Args:
            content: The text to evaluate.

        Returns:
            A dict with ``"pass"`` (bool), ``"score"`` (float),
            ``"verdict"`` (str, human-readable one-liner), and
            ``"weaknesses"`` (list of strings).
        """
        result = self.check(content)
        weaknesses = [
            f"{f['check']} ({f['score']:.0f}/100): {'; '.join(f['reasons'])}"
            for f in result["failures"]
        ]

        if result["pass"]:
            verdict = (
                f"Score {result['score']}/100 — passes humanization gate."
            )
        else:
            n = len(result["failures"])
            verdict = (
                f"Score {result['score']}/100 — FAILS humanization gate. "
                f"{n} check(s) below threshold."
            )

        return {
            "pass": result["pass"],
            "score": result["score"],
            "verdict": verdict,
            "weaknesses": weaknesses,
        }

    # ── internal helpers ──────────────────────────────────────────────

    @staticmethod
    def _word_count(text: str) -> int:
        """Return the number of whitespace-delimited words in *text*."""
        return len(text.split())

    @staticmethod
    def _sentences(text: str) -> list[str]:
        """Split *text* into sentences using a basic heuristic.

        Splits on sentence-ending punctuation (``.``, ``!``, ``?``)
        followed by whitespace.
        """
        raw = re.split(r"(?<=[.!?])\s+", text.strip())
        return [s.strip() for s in raw if s.strip()]

    @staticmethod
    def _paragraphs(text: str) -> list[str]:
        """Split *text* into paragraphs (separated by blank lines)."""
        raw = re.split(r"\n\s*\n", text.strip())
        return [p.strip() for p in raw if p.strip()]

    # ── check 1: banned words (weight 15%) ────────────────────────────

    def _check_banned_words(self, content: str) -> dict[str, Any]:
        """Check for Tier-1 word clusters, Tier-2 word clusters, and key tells.

        Scoring (per-word subtractive, base 100):
            - Each Tier-1 word: −20 points
            - Each Tier-2 word in clusters of 3+: −5 points (per word)
            - ``ensuring`` present: −15 points
            - ``rather than`` present: −10 points
            - Floor: 0.

        Per-word deduction is stricter than cluster-based — e.g. 4 Tier-1
        words cost −80, pushing the text well below the PASS threshold.

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        words_lower = content.lower().split()
        text_lower = content.lower()

        # Count Tier 1 occurrences (per word, each counts)
        tier1_hits = [
            w.strip(".,!?;:()\"'-") for w in words_lower
            if w.strip(".,!?;:()\"'-") in _TIER_1_WORDS
        ]
        tier1_unique = sorted(set(tier1_hits))

        # Count Tier 2 occurrences — deduct per word in clusters of 3+
        tier2_hits = [
            w.strip(".,!?;:()\"'-") for w in words_lower
            if w.strip(".,!?;:()\"'-") in _TIER_2_WORDS
        ]
        tier2_unique = sorted(set(tier2_hits))
        has_tier2_cluster = len(tier2_unique) >= 3

        has_ensuring = bool(_SINGLE_TELL_ENSURE.search(text_lower))
        has_rather_than = bool(_TELL_RATHER_THAN.search(text_lower))

        score = 100.0
        failures: list[str] = []

        # Per-word Tier-1 deduction
        if tier1_hits:
            deduction = len(tier1_hits) * 20
            score -= deduction
            failures.append(
                f"{len(tier1_hits)} Tier-1 banned word(s) found "
                f"({', '.join(tier1_unique)}) — "
                f"−{int(deduction)} pts"
            )

        # Per-word Tier-2 deduction only when clustered (3+ unique)
        if has_tier2_cluster:
            deduction = len(tier2_hits) * 5
            score -= deduction
            failures.append(
                f"{len(tier2_hits)} Tier-2 banned word(s) found "
                f"({', '.join(tier2_unique)}) — "
                f"−{int(deduction)} pts"
            )
        if has_ensuring:
            score -= 15.0
            failures.append('"ensuring" detected — strongest single-word AI tell')
        if has_rather_than:
            score -= 10.0
            failures.append('"rather than" detected — AI hedges comparisons')

        # Tier-1 density multiplier: if >15% of words are Tier-1, multiply
        # the Tier-1 penalty by the density factor. Catches short texts
        # where almost every noun is a banned AI tell.
        if tier1_hits and len(words_lower) > 0:
            tier1_density = len(tier1_hits) / len(words_lower)
            if tier1_density > 0.15:
                density_mult = 1.0 + (tier1_density - 0.15) * 4.0  # e.g. 28% → 1.52x
                tier1_penalty = len(tier1_hits) * 20 * density_mult
                score = 100.0 - tier1_penalty
                failures.append(
                    f"Tier-1 density {tier1_density:.0%} triggers {density_mult:.1f}x multiplier"
                )

        score = max(0.0, score)

        parts: list[str] = []
        if tier1_hits:
            parts.append(f"Tier-1 ({len(tier1_hits)} word(s))")
        if has_tier2_cluster:
            parts.append(f"Tier-2 cluster ({len(tier2_hits)} words)")
        if has_ensuring:
            parts.append("'ensuring' found")
        if has_rather_than:
            parts.append("'rather than' found")
        details = "; ".join(parts) if parts else "No banned word issues"

        return {"score": score, "details": details, "failures": failures}

    # ── check 2: burstiness — sentence-length std dev (weight 15%) ────

    def _check_burstiness(self, content: str) -> dict[str, Any]:
        """Measure sentence-length burstiness via standard deviation.

        Scoring (std dev of sentence word-counts):
            >= 6.0 → 100
            >= 4.0 →  70
            >= 2.0 →  40
            <  2.0 →   0

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        sents = self._sentences(content)
        if len(sents) < 3:
            return {
                "score": 0.0,
                "details": "Too few sentences (< 3) to measure burstiness",
                "failures": ["Too few sentences to measure burstiness"],
            }

        lengths = [len(s.split()) for s in sents]
        std_dev = statistics.stdev(lengths)

        if std_dev >= 6.0:
            score = 100.0
        elif std_dev >= 4.0:
            score = 70.0
        elif std_dev >= 2.0:
            score = 40.0
        else:
            score = 0.0

        failures: list[str] = []
        if score < 60.0:
            failures.append(
                f"Sentence-length std dev is {std_dev:.1f} "
                f"(target >= 6.0 for natural burstiness)"
            )

        return {
            "score": score,
            "details": f"Sentence-length std dev = {std_dev:.2f}",
            "failures": failures,
        }

    # ── check 3: tricolons (weight 8%) ────────────────────────────────

    def _check_tricolons(self, content: str) -> dict[str, Any]:
        """Detect rule-of-three patterns (tricolons).

        Uses a regex for ``"X, Y, and Z"`` / ``"X, Y, or Z"`` patterns.
        Also counts triples in bullet lists.

        Scoring:
            0 tricolons → 100
            each tricolon loses 33 points, floor at 0.

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        count = len(_TRICOLON_PATTERN.findall(content))

        # Also check for 3-item bullet lists
        bullet_items = re.findall(r"^\s*[-*]\s*(.+)$", content, re.MULTILINE)
        bullet_tricolons = 0
        for i in range(len(bullet_items) - 2):
            if (
                bullet_items[i].strip()
                and bullet_items[i + 1].strip()
                and bullet_items[i + 2].strip()
            ):
                # Check if these 3 consecutive bullets form a tricolon-like structure
                bullet_tricolons += 1

        total = count + bullet_tricolons
        score = max(0.0, 100.0 - total * 33.0)

        failures: list[str] = []
        if total > 0:
            failures.append(
                f"{total} tricolon(s) detected — use 2 or 4 items instead of 3"
            )

        return {
            "score": score,
            "details": f"{total} tricolon(s) found",
            "failures": failures,
        }

    # ── check 4: em-dash overuse (weight 5%) ──────────────────────────

    def _check_em_dashes(self, content: str) -> dict[str, Any]:
        """Check em-dash density.

        Scoring (per 200 words):
            <= 1.0 → 100
            <= 2.0 →  60
            >  2.0 →   0

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        wc = self._word_count(content)
        if wc == 0:
            return {"score": 100.0, "details": "No content", "failures": []}

        count = len(_EM_DASH_PATTERN.findall(content))
        per_200w = (count / wc) * 200.0

        if per_200w <= 1.0:
            score = 100.0
        elif per_200w <= 2.0:
            score = 60.0
        else:
            score = 0.0

        failures: list[str] = []
        if score < 60.0:
            failures.append(
                f"{count} em-dash(es) ({per_200w:.1f} per 200 words, "
                f"max recommended: 1)"
            )

        return {
            "score": score,
            "details": (
                f"{count} em-dash(es), {per_200w:.1f}/200w"
            ),
            "failures": failures,
        }

    # ── check 5: formulaic openers (weight 10%) ───────────────────────

    def _check_formulaic_openers(self, content: str) -> dict[str, Any]:
        """Detect formulaic sentence openers.

        Patterns matched: ``in recent years``, ``in today's``,
        ``there are several``, ``it is important to``, ``one of the most``,
        ``in the world of``, ``when it comes to``, ``the landscape of``.

        Scoring:
            0 openers → 100
            each opener costs 20 points, floor at 0.

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        text_lower = content.lower()
        count = sum(1 for pat in _FORMULAIC_OPENER_PATTERNS if pat.search(text_lower))

        score = max(0.0, 100.0 - count * 20.0)

        failures: list[str] = []
        if count > 0:
            failures.append(
                f"{count} formulaic opener(s) detected"
            )

        return {
            "score": score,
            "details": f"{count} formulaic opener(s) found",
            "failures": failures,
        }

    # ── check 6: hedging verbs (weight 10%) ───────────────────────────

    def _check_hedging_verbs(self, content: str) -> dict[str, Any]:
        """Detect hedging verb usage.

        Words: ``ensuring``, ``highlights``, ``supports``, ``reflects``,
        ``suggests``, ``indicates``, ``appears``, ``seems``, ``tends to``,
        ``may be``, ``could be``, ``would be``.

        Scoring:
            0 hedging verbs → 100
            each costs 15 points, floor at 0.

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        text_lower = content.lower()
        count = sum(1 for pat in _HEDGING_PATTERNS if pat.search(text_lower))

        score = max(0.0, 100.0 - count * 15.0)

        failures: list[str] = []
        if count > 0:
            failures.append(
                f"{count} hedging verb(s) detected — use direct statements"
            )

        return {
            "score": score,
            "details": f"{count} hedging verb(s) found",
            "failures": failures,
        }

    # ── check 7: intensifier adverbs (weight 8%) ──────────────────────

    def _check_intensifier_adverbs(self, content: str) -> dict[str, Any]:
        """Detect intensifier adverb overuse.

        Words: ``significantly``, ``effectively``, ``increasingly``,
        ``extremely``, ``highly``, ``notably``, ``remarkably``,
        ``substantially``, ``tremendously``, ``vastly``.

        Scoring:
            0 intensifiers → 100
            each costs 12 points, floor at 0.

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        words_lower = content.lower().split()
        clean_words = [w.strip(".,!?;:()\"'-") for w in words_lower]

        count = sum(1 for w in clean_words if w in _INTENSIFIER_WORDS)

        score = max(0.0, 100.0 - count * 12.0)

        failures: list[str] = []
        if count > 0:
            failures.append(
                f"{count} intensifier adverb(s) — replace with specifics/numbers"
            )

        return {
            "score": score,
            "details": f"{count} intensifier adverb(s) found",
            "failures": failures,
        }

    # ── check 8: paragraph uniformity (weight 8%) ─────────────────────

    def _check_paragraph_uniformity(self, content: str) -> dict[str, Any]:
        """Check paragraph-length uniformity via std dev of sentence counts.

        AI-written text tends to have uniformly sized paragraphs (3-4
        sentences). Humans vary paragraph depth more widely.

        Scoring (std dev of sentences per paragraph):
            >= 2.0 → 100
            >= 1.0 →  60
            <  1.0 →  20

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        paragraphs = self._paragraphs(content)
        if len(paragraphs) < 2:
            return {
                "score": 100.0,
                "details": "Single paragraph — uniformity not applicable",
                "failures": [],
            }

        sent_counts = [len(self._sentences(p)) for p in paragraphs]
        std_dev = statistics.stdev(sent_counts)

        if std_dev >= 2.0:
            score = 100.0
        elif std_dev >= 1.0:
            score = 60.0
        else:
            score = 20.0

        failures: list[str] = []
        if score < 60.0:
            failures.append(
                f"Paragraph sentence-count std dev is {std_dev:.1f} "
                f"(target >= 2.0 for natural variation)"
            )

        return {
            "score": score,
            "details": f"Paragraph sentence-count std dev = {std_dev:.2f}",
            "failures": failures,
        }

    # ── check 9: wrapped conclusions (weight 8%) ──────────────────────

    def _check_wrapped_conclusions(self, content: str) -> dict[str, Any]:
        """Detect wrapped-up (summarised) conclusions.

        Looks for conclusion-signal phrases at the start of the final
        paragraph: ``in conclusion``, ``to summarize``, ``overall``,
        ``in summary``.

        Also flags if the last paragraph is unusually short (< 2 sentences)
        and starts with a restatement signal.

        Scoring:
            No wrap detected → 100
            Wrap detected    →   0 (binary)

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        paragraphs = self._paragraphs(content)
        if not paragraphs:
            return {"score": 100.0, "details": "No paragraphs", "failures": []}

        last_para = paragraphs[-1].strip()
        last_para_lower = last_para.lower()

        wrapped = any(
            pat.match(last_para_lower) for pat in _WRAPPED_CONCLUSION_PATTERNS
        )

        if wrapped:
            return {
                "score": 0.0,
                "details": "Final paragraph starts with a conclusion signal",
                "failures": ["Wrapped-up conclusion detected — delete or rephrase"],
            }

        return {
            "score": 100.0,
            "details": "No wrapped conclusion detected",
            "failures": [],
        }

    # ── check 10: neutrality bias (weight 8%) ─────────────────────────

    def _check_neutrality_bias(self, content: str) -> dict[str, Any]:
        """Check for opinion/personality markers — ``I`` statements and
        negative emotion.

        Human writing, especially on Reddit, contains significantly more
        first-person statements and negative emotion than AI-generated text.

        Scoring (average of ``I``-statement + negative-word density per
        100 words):
            avg < 1 per 100w → 30
            avg 1–2          → 60
            avg 2–3          → 80
            avg 3+           → 100

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        wc = self._word_count(content)
        if wc == 0:
            return {"score": 30.0, "details": "No content", "failures": []}

        text_lower = content.lower()

        # Count "I" statements: "i", "i'm", "i've", "i'd"
        i_statements = len(re.findall(
            r"\bi\b|\bi'm\b|\bi've\b|\bi'd\b|\bi'll\b",
            text_lower,
        ))

        # Count negative emotion words
        words_lower = text_lower.split()
        clean_words = [w.strip(".,!?;:()\"'-") for w in words_lower]
        neg_count = sum(1 for w in clean_words if w in _NEGATIVE_EMOTION_WORDS)

        i_per_100w = (i_statements / wc) * 100.0
        neg_per_100w = (neg_count / wc) * 100.0
        combined_avg = (i_per_100w + neg_per_100w) / 2.0

        if combined_avg >= 3.0:
            score = 100.0
        elif combined_avg >= 2.0:
            score = 80.0
        elif combined_avg >= 1.0:
            score = 60.0
        else:
            score = 30.0

        failures: list[str] = []
        if score < 60.0:
            failures.append(
                f"Low expression density — {combined_avg:.1f}/100w "
                f"(target >= 1.0). Add more \"I\" statements and opinions."
            )

        return {
            "score": score,
            "details": (
                f"I-statements: {i_statements} ({i_per_100w:.1f}/100w), "
                f"negative words: {neg_count} ({neg_per_100w:.1f}/100w), "
                f"combined avg: {combined_avg:.1f}/100w"
            ),
            "failures": failures,
        }

    # ── check 11: "plays a crucial role" (weight 5%) ──────────────────

    def _check_crucial_role(self, content: str) -> dict[str, Any]:
        """Detect the ``"plays a crucial/critical/important/vital role"``
        sentence shape — the most formulaic AI construction.

        Scoring:
            Not present → 100 (binary)
            Present     →   0

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        text_lower = content.lower()
        found = bool(_CRUCIAL_ROLE_PATTERN.search(text_lower))

        if found:
            return {
                "score": 0.0,
                "details": "\"plays a crucial/critical/important/vital role\" detected",
                "failures": [
                    "\"X plays a crucial role in Y\" — most formulaic AI construction"
                ],
            }

        return {
            "score": 100.0,
            "details": "No \"crucial role\" construction found",
            "failures": [],
        }

    # ── check 12: "not just X but Y" (weight 5%) ──────────────────────

    def _check_not_just_x_but_y(self, content: str) -> dict[str, Any]:
        """Detect the ``"not just X but Y"`` / ``"not only X but Y"``
        construction — a hallmark AI rhetorical device.

        Scoring:
            Not present → 100 (binary)
            Present     →   0

        Returns:
            dict with ``score``, ``details``, ``failures``.
        """
        text_lower = content.lower()
        found = bool(_NOT_JUST_X_BUT_Y_PATTERN.search(text_lower))

        if found:
            return {
                "score": 0.0,
                "details": "\"not just/only X but Y\" construction detected",
                "failures": [
                    "\"not just X but Y\" clause detected — one instance is too many"
                ],
            }

        return {
            "score": 100.0,
            "details": "No \"not just/only X but Y\" construction found",
            "failures": [],
        }
