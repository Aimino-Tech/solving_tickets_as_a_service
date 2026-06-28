"""Quality score card — tracks test pass rate, AC coverage, and code style."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class DimensionScore:
    score: float
    raw: dict[str, Any] = field(default_factory=dict)
    details: str = ""


@dataclass
class QualityScoreCard:
    test_pass_rate: DimensionScore
    ac_coverage: DimensionScore
    code_style: DimensionScore
    overall: float
    weights: dict[str, float] = field(default_factory=lambda: {
        "test_pass_rate": 0.4,
        "ac_coverage": 0.35,
        "code_style": 0.25,
    })


_STOP_WORDS: frozenset[str] = frozenset({
    "this", "that", "with", "from", "have", "been", "were", "they",
    "will", "into", "also", "than", "then", "each", "can", "after",
    "more", "some", "their", "about", "other", "would", "could",
    "should", "what", "when", "where", "which", "there", "does",
    "just", "very", "before", "after", "over", "such", "only",
    "user", "users", "must", "not",
})


def _extract_keywords(text: str) -> set[str]:
    words = {w.lower() for w in re.findall(r"\b([a-zA-Z]\w{3,})\b", text)}
    return words - _STOP_WORDS


def _extract_ac_statements(ac_text: str) -> list[str]:
    lines = [ln.strip() for ln in ac_text.strip().split("\n") if ln.strip()]
    bullets = [ln for ln in lines if ln.startswith("-") or ln.startswith("*") or re.match(r"^\d+[.)]", ln)]
    return bullets or lines


def _extract_test_names(test_output: str) -> set[str]:
    names: set[str] = set()
    for m in re.finditer(r"(\S+\.py::\w+(?:::\w+)?)", test_output):
        names.add(m.group(1))
    for m in re.finditer(r"--- (PASS|FAIL): (Test\w+)", test_output):
        names.add(m.group(2))
    for m in re.finditer(r"\btest_\w+\b", test_output):
        names.add(m.group(0))
    return names


def score_test_pass_rate(
    passed: int,
    total: int,
    failed_tests: list[str] | None = None,
) -> DimensionScore:
    if total <= 0:
        return DimensionScore(
            score=0.0,
            raw={"passed": 0, "total": 0, "failed": 0},
            details="No tests were executed.",
        )

    failed = total - passed
    rate = passed / total

    if rate >= 0.95:
        final = 1.0
    elif rate >= 0.8:
        final = 0.5 + 0.5 * ((rate - 0.8) / 0.15)
    elif rate >= 0.5:
        final = 0.25 + 0.25 * ((rate - 0.5) / 0.3)
    else:
        final = max(rate * 0.5, 0.0)

    failed_list = failed_tests or []
    detail_parts: list[str] = [f"{passed}/{total} tests passed ({rate:.1%})"]
    if failed_list:
        detail_parts.append(f"Failures: {', '.join(failed_list[:10])}")
        if len(failed_list) > 10:
            detail_parts.append(f"... and {len(failed_list) - 10} more")

    return DimensionScore(
        score=round(final, 4),
        raw={"passed": passed, "total": total, "failed": failed, "rate": rate},
        details=" | ".join(detail_parts),
    )


def score_ac_coverage(
    acceptance_criteria: str,
    test_output: str,
    test_names: list[str] | None = None,
) -> DimensionScore:
    ac_statements = _extract_ac_statements(acceptance_criteria)
    if not ac_statements:
        return DimensionScore(
            score=1.0,
            raw={"ac_count": 0, "covered": 0},
            details="No acceptance criteria to cover — vacuously passing.",
        )

    tnames = set(test_names) if test_names else _extract_test_names(test_output)
    total = len(ac_statements)
    covered = 0
    coverage_map: list[dict[str, Any]] = []

    for ac in ac_statements:
        keywords = _extract_keywords(ac)
        if not keywords:
            keywords = {w.lower() for w in re.findall(r"\b\w{4,}\b", ac)} - _STOP_WORDS
        if not keywords:
            keywords = {w.lower() for w in ac.split() if len(w) > 2}

        best_overlap = 0
        matching_test: str | None = None
        for tn in tnames:
            tn_lower = tn.lower()
            overlap = sum(1 for kw in keywords if kw in tn_lower)
            if overlap > best_overlap:
                best_overlap = overlap
                matching_test = tn
            if best_overlap >= len(keywords):
                break

        is_covered = best_overlap >= max(len(keywords) * 0.4, 1) if keywords else False
        if is_covered:
            covered += 1

        coverage_map.append({
            "ac": ac,
            "covered": is_covered,
            "matched_keywords": best_overlap,
            "total_keywords": len(keywords),
            "closest_test": matching_test or None,
        })

    ratio = covered / total if total > 0 else 1.0

    return DimensionScore(
        score=round(ratio, 4),
        raw={
            "ac_count": total,
            "covered": covered,
            "ratio": ratio,
            "coverage_map": coverage_map,
        },
        details=f"{covered}/{total} AC statements covered by tests ({ratio:.1%})",
    )


def score_code_style(
    lint_errors: int = 0,
    lint_warnings: int = 0,
    format_issues: int = 0,
    total_files: int = 1,
) -> DimensionScore:
    if total_files <= 0:
        total_files = 1

    error_penalty = min(lint_errors / max(total_files, 1), 1.0) * 0.6
    warning_penalty = min(lint_warnings / max(total_files * 3, 1), 1.0) * 0.25
    format_penalty = min(format_issues / max(total_files * 2, 1), 1.0) * 0.15

    total_penalty = error_penalty + warning_penalty + format_penalty
    score = max(1.0 - total_penalty, 0.0)

    issues = lint_errors + lint_warnings + format_issues
    detail_parts: list[str] = []
    if lint_errors:
        detail_parts.append(f"{lint_errors} error(s)")
    if lint_warnings:
        detail_parts.append(f"{lint_warnings} warning(s)")
    if format_issues:
        detail_parts.append(f"{format_issues} format issue(s)")
    if not detail_parts:
        detail_parts.append("No issues found")

    return DimensionScore(
        score=round(score, 4),
        raw={
            "lint_errors": lint_errors,
            "lint_warnings": lint_warnings,
            "format_issues": format_issues,
            "total_files": total_files,
        },
        details=f"{', '.join(detail_parts)} across {total_files} file(s) — score {score:.2f}",
    )


def build_score_card(
    test_pass_rate: DimensionScore,
    ac_coverage: DimensionScore,
    code_style: DimensionScore,
    weights: dict[str, float] | None = None,
) -> QualityScoreCard:
    w = weights or {}
    w_test = w.get("test_pass_rate", 0.4)
    w_ac = w.get("ac_coverage", 0.35)
    w_style = w.get("code_style", 0.25)

    overall = (
        test_pass_rate.score * w_test
        + ac_coverage.score * w_ac
        + code_style.score * w_style
    )

    return QualityScoreCard(
        test_pass_rate=test_pass_rate,
        ac_coverage=ac_coverage,
        code_style=code_style,
        overall=round(min(overall, 1.0), 4),
        weights={"test_pass_rate": w_test, "ac_coverage": w_ac, "code_style": w_style},
    )


def score_card_to_dict(card: QualityScoreCard) -> dict[str, Any]:
    return {
        "overall": card.overall,
        "weights": dict(card.weights),
        "dimensions": {
            "test_pass_rate": {
                "score": card.test_pass_rate.score,
                "raw": dict(card.test_pass_rate.raw),
                "details": card.test_pass_rate.details,
            },
            "ac_coverage": {
                "score": card.ac_coverage.score,
                "raw": dict(card.ac_coverage.raw),
                "details": card.ac_coverage.details,
            },
            "code_style": {
                "score": card.code_style.score,
                "raw": dict(card.code_style.raw),
                "details": card.code_style.details,
            },
        },
    }
