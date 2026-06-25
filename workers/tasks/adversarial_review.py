"""
3-Layer Adversarial Review Methodology.

Replaces single-pass review with a structured adversarial protocol:

Layer 1 — Per-file Analysis
    Spawns N parallel subagents per changed file for deep per-change analysis.
    Each subagent reviews correctness, edge cases, and security.

Layer 2 — Holistic Review
    Spawns 5 parallel review agents (goals, quality, security, QA, context)
    to assess the overall change from different angles.

Layer 3 — Oracle Verdict
    Synthesises Layer 1 and Layer 2 reports into a final verdict:
    PASS / FLAG / FAIL with a confidence score and specific rework instructions.

Usage:
    full_adversarial_review.delay(diff_files, issue_context)
"""

from __future__ import annotations

import concurrent.futures
import json
import logging
import os
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

# ── Default configuration (overridable via workflow YAML / env) ─────
_DEFAULT_CONFIG = {
    "layer1_subagents_per_file": 2,
    "layer2_review_categories": [
        "goals",
        "code_quality",
        "security",
        "hands_on_qa",
        "context_miner",
    ],
    "pass_threshold": 0.8,
    "flag_threshold": 0.5,
    "max_retries": 2,
}

_PARALLEL_WORKERS = int(os.getenv("ADVERSARIAL_REVIEW_PARALLELISM", "10"))


def _load_config(issue_context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Load configuration, merging workflow YAML overrides on top of defaults.

    Priority (highest last):
      1. env var ADVERSARIAL_REVIEW_CONFIG (JSON string)
      2. issue_context.get('adversarial_review_config', {})
      3. _DEFAULT_CONFIG defaults
    """
    config = dict(_DEFAULT_CONFIG)

    env_raw = os.getenv("ADVERSARIAL_REVIEW_CONFIG", "")
    if env_raw:
        try:
            env_config = json.loads(env_raw)
            config.update(env_config)
        except (json.JSONDecodeError, TypeError):
            logger.warning("Invalid ADVERSARIAL_REVIEW_CONFIG env var — ignoring")

    if issue_context:
        ctx_config = issue_context.get("adversarial_review_config", {})
        if isinstance(ctx_config, dict):
            config.update(ctx_config)

    return config


def _read_file(path: str) -> str:
    """Read a file from the workspace, returning its content or an error message."""
    try:
        with open(path, "r") as f:
            return f.read()
    except FileNotFoundError:
        return f"# FILE NOT FOUND: {path}"
    except Exception as exc:
        return f"# ERROR READING {path}: {exc}"


# ═══════════════════════════════════════════════════════════════════════
# Layer 1 — Per-file Analysis  (parallel subagents per file)
# ═══════════════════════════════════════════════════════════════════════


def _simulate_per_file_analysis(
    file_path: str,
    content: str,
    agent_index: int,
    issue_context: dict[str, Any],
) -> dict[str, Any]:
    """Simulate a single subagent analysis pass on one file.

    In production this would call an LLM.  Here we perform static heuristics
    that produce meaningful structured output.
    """
    lines = content.split("\n")
    total_lines = len(lines)
    ext = os.path.splitext(file_path)[1].lower()

    correctness_flags: list[str] = []
    edge_cases: list[str] = []
    security_flags: list[str] = []
    score = 1.0

    # ── Correctness heuristics ───────────────────────────────────
    if total_lines == 0:
        correctness_flags.append("Empty file — no implementation")
        score -= 0.3
    if "TODO" in content or "FIXME" in content:
        correctness_flags.append("Contains TODO/FIXME markers — incomplete")
        score -= 0.15
    if "Not implemented" in content:
        correctness_flags.append("Contains 'Not implemented' stub — incomplete")
        score -= 0.25
    if content.strip().endswith("pass") or content.strip().endswith("return None"):
        pass  # heuristic but not definitive

    # ── Edge-case heuristics ─────────────────────────────────────
    if "except:" in content or "except Exception:" in content:
        edge_cases.append("Bare except clause — may swallow unexpected errors")
        score -= 0.1
    if "try:" in content and "except" not in content:
        edge_cases.append("Try block without except — no error handling")
        score -= 0.15
    if "assert" in content:
        edge_cases.append("Contains assertions — may crash in optimized mode")
    if any(kw in content for kw in ["None", "null", "undefined"]) and "if" not in content:
        edge_cases.append("Nullable values present without null checks")
        score -= 0.05

    # ── Security heuristics (file-type aware) ────────────────────
    if ext in (".py", ".js", ".ts", ".jsx", ".tsx"):
        if "eval(" in content or "exec(" in content:
            security_flags.append("Dynamic code execution (eval/exec) — RCE risk")
            score -= 0.3
        if "subprocess" in content or "os.system" in content:
            security_flags.append("Shell execution — command injection risk")
            score -= 0.2
        if "sqlite3" in content or "execute(" in content:
            if "?" not in content and ":param" not in content and "f'" not in content:
                security_flags.append("Possible SQL injection — use parameterised queries")
                score -= 0.2
        if "pickle.loads" in content or "yaml.load(" in content:
            security_flags.append("Unsafe deserialisation — RCE risk")
            score -= 0.25
        if "request" in content and "validate" not in content.lower():
            security_flags.append("Input handling without validation")
            score -= 0.1

    if ext in (".yaml", ".yml", ".json", ".xml"):
        if "password" in content.lower() or "secret" in content.lower() or "token" in content.lower():
            security_flags.append("Possible secrets in config file — credential leak risk")
            score -= 0.2

    if ext == ".sh":
        if "eval " in content or "`" in content:
            security_flags.append("Shell eval or backtick — injection risk")
            score -= 0.2

    # ── Handle autogenerated stubs ───────────────────────────────
    if "Auto-generated" in content or "autogenerated" in content.lower():
        correctness_flags.append("Auto-generated file — verify correctness manually")
        score -= 0.1

    score = max(0.0, round(score, 2))

    return {
        "agent_index": agent_index,
        "score": score,
        "correctness_flags": correctness_flags,
        "edge_cases": edge_cases,
        "security_flags": security_flags,
        "lines_analysed": total_lines,
    }


def _aggregate_file_reports(file_reports: list[dict[str, Any]]) -> dict[str, Any]:
    """Merge multiple subagent reports for one file into a single summary."""
    if not file_reports:
        return {
            "score": 0.0,
            "correctness_flags": [],
            "edge_cases": [],
            "security_flags": [],
            "subagent_count": 0,
            "scores": [],
        }

    scores = [r["score"] for r in file_reports]
    avg_score = round(sum(scores) / len(scores), 2)

    all_correctness: list[str] = []
    all_edges: list[str] = []
    all_security: list[str] = []
    seen_c = set()
    seen_e = set()
    seen_s = set()

    for r in file_reports:
        for flag in r.get("correctness_flags", []):
            if flag not in seen_c:
                all_correctness.append(flag)
                seen_c.add(flag)
        for case in r.get("edge_cases", []):
            if case not in seen_e:
                all_edges.append(case)
                seen_e.add(case)
        for flag in r.get("security_flags", []):
            if flag not in seen_s:
                all_security.append(flag)
                seen_s.add(flag)

    return {
        "score": avg_score,
        "correctness_flags": all_correctness,
        "edge_cases": all_edges,
        "security_flags": all_security,
        "subagent_count": len(file_reports),
        "scores": scores,
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.adversarial_review.run_layer1",
    autoretry_for=(Exception,),
)
def layer1_analysis(
    self,
    diff_files: list[str],
    issue_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Layer 1: Per-file analysis — analyse each changed file in parallel.

    For every file in *diff_files*, spawns ``subagents_per_file`` parallel
    subagents that run static analysis heuristics.  Returns a dictionary
    mapping file paths to aggregated report dicts.
    """
    issue_context = issue_context or {}
    config = _load_config(issue_context)
    subagents_per_file = config.get("layer1_subagents_per_file", 2)

    logger.info(
        json.dumps({
            "event": "adversarial.layer1.start",
            "files_count": len(diff_files),
            "subagents_per_file": subagents_per_file,
        })
    )

    reports: dict[str, Any] = {}

    for file_path in diff_files:
        content = _read_file(file_path)
        file_reports: list[dict[str, Any]] = []

        # Spawn parallel subagents for this file
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(subagents_per_file, _PARALLEL_WORKERS)) as pool:
            future_map = {
                pool.submit(
                    _simulate_per_file_analysis,
                    file_path,
                    content,
                    agent_idx,
                    issue_context,
                ): agent_idx
                for agent_idx in range(subagents_per_file)
            }
            for future in concurrent.futures.as_completed(future_map):
                agent_idx = future_map[future]
                try:
                    analysis = future.result()
                    file_reports.append(analysis)
                    logger.info(
                        json.dumps({
                            "event": "adversarial.layer1.subagent_complete",
                            "file": file_path,
                            "agent_index": agent_idx,
                            "score": analysis.get("score", 0.0),
                        })
                    )
                except Exception as exc:
                    logger.error(
                        json.dumps({
                            "event": "adversarial.layer1.subagent_error",
                            "file": file_path,
                            "agent_index": agent_idx,
                            "error": str(exc),
                        })
                    )
                    file_reports.append({
                        "agent_index": agent_idx,
                        "score": 0.0,
                        "correctness_flags": [f"Subagent crashed: {exc}"],
                        "edge_cases": [],
                        "security_flags": [],
                        "lines_analysed": 0,
                    })

        # Aggregate per-file
        aggregated = _aggregate_file_reports(file_reports)
        reports[file_path] = aggregated

    logger.info(
        json.dumps({
            "event": "adversarial.layer1.complete",
            "files_analysed": len(reports),
        })
    )

    return {
        "layer": 1,
        "status": "completed",
        "config": config,
        "reports": reports,
    }


# ═══════════════════════════════════════════════════════════════════════
# Layer 2 — Holistic Review (5 parallel angles)
# ═══════════════════════════════════════════════════════════════════════


def _simulate_category_review(
    category: str,
    layer1_reports: dict[str, Any],
    issue_context: dict[str, Any],
) -> dict[str, Any]:
    """Simulate a single category review agent.

    In production each category would call a purpose-tuned LLM prompt.
    """
    score = 1.0
    findings: list[str] = []
    recommendation = "proceed"

    file_scores = [r["score"] for r in layer1_reports.values()]
    avg_file_score = round(sum(file_scores) / len(file_scores), 2) if file_scores else 0.0

    all_security_flags: list[str] = []
    all_correctness_flags: list[str] = []
    all_edge_cases: list[str] = []

    for r in layer1_reports.values():
        all_security_flags.extend(r.get("security_flags", []))
        all_correctness_flags.extend(r.get("correctness_flags", []))
        all_edge_cases.extend(r.get("edge_cases", []))

    if category == "goals":
        issue_title = issue_context.get("title", "").lower()
        issue_body = issue_context.get("body", "").lower()
        combined = issue_title + " " + issue_body
        if "fix" in combined or "bug" in combined or "error" in combined:
            score = min(1.0, avg_file_score + 0.1)
        else:
            score = avg_file_score

        if all_correctness_flags:
            findings.append(f"Correctness concerns: {len(all_correctness_flags)} flag(s)")
            score -= 0.1 * len(all_correctness_flags)

        acceptance = issue_context.get("acceptance_criteria", [])
        if acceptance:
            findings.append(f"{len(acceptance)} acceptance criteria defined — verifying alignment")

        recommendation = "proceed" if score >= 0.6 else "flag"

    elif category == "code_quality":
        score = avg_file_score

        if all_edge_cases:
            findings.append(f"Edge cases identified: {len(all_edge_cases)}")
            score -= 0.05 * len(all_edge_cases)

        has_large_files = any(
            r.get("lines_analysed", 0) > 500 for r in layer1_reports.values()
        )
        if has_large_files:
            findings.append("Some files exceed 500 lines — consider refactoring")
            score -= 0.1

        recommendation = "proceed" if score >= 0.6 else "needs_improvement"

    elif category == "security":
        if all_security_flags:
            score = max(0.0, 1.0 - 0.25 * len(all_security_flags))
            findings = list(all_security_flags)
            recommendation = "fail" if score < 0.5 else "flag"
        else:
            score = 1.0
            findings.append("No security concerns detected")
            recommendation = "proceed"

    elif category == "hands_on_qa":
        score = avg_file_score

        has_tests = any(
            "test" in fp.lower() or "spec" in fp.lower()
            for fp in layer1_reports.keys()
        )
        if not has_tests:
            findings.append("No test files found in diff — QA coverage unclear")
            score -= 0.15

        if all_correctness_flags:
            findings.append(f"Reviewability concerns: {len(all_correctness_flags)} flag(s)")
            score -= 0.1

        recommendation = "proceed" if score >= 0.6 else "flag"

    elif category == "context_miner":
        score = avg_file_score

        issue_title = issue_context.get("title", "").lower()
        issue_body = issue_context.get("body", "").lower()
        combined_text = issue_title + " " + issue_body

        file_names = " ".join(layer1_reports.keys()).lower()
        keywords = set(combined_text.split())
        file_keywords = set(file_names.split())
        overlap = keywords & file_keywords
        if not overlap:
            findings.append("No keyword overlap between issue context and changed files")
            score -= 0.2
        else:
            findings.append(f"Context alignment: {len(overlap)} keyword(s) shared")

        recommendation = "proceed" if score >= 0.5 else "flag"

    score = max(0.0, round(score, 2))

    return {
        "category": category,
        "score": score,
        "findings": findings,
        "recommendation": recommendation,
    }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.adversarial_review.run_layer2",
    autoretry_for=(Exception,),
)
def layer2_holistic(
    self,
    layer1_reports: dict[str, Any],
    issue_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Layer 2: Run 5 parallel holistic reviews from different angles.

    Runs structured reviews across five categories in parallel:
      goals, code_quality, security, hands_on_qa, context_miner

    Each category produces a score, findings list, and recommendation.
    """
    issue_context = issue_context or {}
    config = _load_config(issue_context)
    categories = config.get("layer2_review_categories", _DEFAULT_CONFIG["layer2_review_categories"])

    logger.info(
        json.dumps({
            "event": "adversarial.layer2.start",
            "categories_count": len(categories),
            "categories": categories,
        })
    )

    reviews: dict[str, Any] = {}

    # Run all category reviews in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(categories)) as pool:
        future_map = {
            pool.submit(_simulate_category_review, cat, layer1_reports, issue_context): cat
            for cat in categories
        }
        for future in concurrent.futures.as_completed(future_map):
            cat = future_map[future]
            try:
                review = future.result()
                reviews[cat] = review
                logger.info(
                    json.dumps({
                        "event": "adversarial.layer2.category_complete",
                        "category": cat,
                        "score": review.get("score", 0.0),
                        "recommendation": review.get("recommendation", "unknown"),
                    })
                )
            except Exception as exc:
                logger.error(
                    json.dumps({
                        "event": "adversarial.layer2.category_error",
                        "category": cat,
                        "error": str(exc),
                    })
                )
                reviews[cat] = {
                    "category": cat,
                    "score": 0.0,
                    "findings": [f"Category review crashed: {exc}"],
                    "recommendation": "fail",
                }

    logger.info(
        json.dumps({
            "event": "adversarial.layer2.complete",
            "reviews_generated": len(reviews),
        })
    )

    return {
        "layer": 2,
        "status": "completed",
        "config": config,
        "reviews": reviews,
    }


# ═══════════════════════════════════════════════════════════════════════
# Layer 3 — Oracle Verdict
# ═══════════════════════════════════════════════════════════════════════


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.adversarial_review.run_layer3",
    autoretry_for=(Exception,),
)
def layer3_oracle(
    self,
    layer1_reports: dict[str, Any],
    layer2_reports: dict[str, Any],
    issue_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Layer 3: Oracle synthesises final verdict.

    Reads all Layer 1 and Layer 2 reports and produces a verdict:
      PASS  — confidence >= pass_threshold, no critical flags
      FLAG  — confidence >= flag_threshold, some concerns
      FAIL  — confidence < flag_threshold or critical security issues
    """
    issue_context = issue_context or {}
    config = _load_config(issue_context)
    pass_threshold = config.get("pass_threshold", 0.8)
    flag_threshold = config.get("flag_threshold", 0.5)

    logger.info(
        json.dumps({
            "event": "adversarial.layer3.start",
            "file_reports_count": len(layer1_reports),
            "category_reviews_count": len(layer2_reports.get("reviews", {})),
        })
    )

    # ── Compute Layer 1 aggregate ─────────────────────────────────
    file_scores = [r["score"] for r in layer1_reports.values()]
    avg_layer1 = round(sum(file_scores) / len(file_scores), 2) if file_scores else 0.0

    l1_correctness_total = sum(len(r.get("correctness_flags", [])) for r in layer1_reports.values())
    l1_security_total = sum(len(r.get("security_flags", [])) for r in layer1_reports.values())
    l1_edge_total = sum(len(r.get("edge_cases", [])) for r in layer1_reports.values())

    # ── Compute Layer 2 aggregate ─────────────────────────────────
    reviews = layer2_reports.get("reviews", {})
    category_scores = {cat: r["score"] for cat, r in reviews.items()}
    avg_layer2 = round(sum(category_scores.values()) / len(category_scores), 2) if category_scores else 0.0

    recommendations = {cat: r["recommendation"] for cat, r in reviews.items()}
    category_findings: dict[str, list[str]] = {
        cat: r.get("findings", []) for cat, r in reviews.items()
    }

    security_is_fail = recommendations.get("security") == "fail"

    # ── Compute confidence score ──────────────────────────────────
    # Weighted: Layer 1 = 40%, Layer 2 = 60%
    confidence = round(0.4 * avg_layer1 + 0.6 * avg_layer2, 2)

    # Penalties
    penalty = 0.0
    if l1_security_total > 0:
        penalty += 0.1 * l1_security_total
    if l1_correctness_total > 2:
        penalty += 0.05 * (l1_correctness_total - 2)
    if security_is_fail:
        penalty += 0.3

    confidence = max(0.0, round(confidence - penalty, 2))

    # ── Determine verdict ─────────────────────────────────────────
    if confidence >= pass_threshold and not security_is_fail:
        verdict = "PASS"
    elif confidence >= flag_threshold or (security_is_fail and confidence >= 0.3):
        verdict = "FLAG"
    else:
        verdict = "FAIL"

    # ── Build rework instructions (for FAIL / FLAG) ───────────────
    rework_instructions: list[str] = []

    if l1_security_total > 0:
        rework_instructions.append(
            f"Address {l1_security_total} security issue(s) found in Layer 1 analysis"
        )
    if l1_correctness_total > 0:
        rework_instructions.append(
            f"Resolve {l1_correctness_total} correctness flag(s) from Layer 1"
        )
    for cat, rec in recommendations.items():
        if rec in ("flag", "fail", "needs_improvement"):
            findings_list = category_findings.get(cat, [])
            if findings_list:
                rework_instructions.append(f"Layer 2 ({cat}): {'; '.join(findings_list)}")

    if not rework_instructions and verdict in ("FAIL", "FLAG"):
        rework_instructions.append("Review pipeline output for details")

    summary = (
        f"Layer 3 verdict: {verdict} (confidence={confidence}, "
        f"L1 avg={avg_layer1}, L2 avg={avg_layer2})"
    )

    logger.info(
        json.dumps({
            "event": "adversarial.layer3.complete",
            "verdict": verdict,
            "confidence": confidence,
            "avg_layer1": avg_layer1,
            "avg_layer2": avg_layer2,
        })
    )

    return {
        "layer": 3,
        "status": "completed",
        "verdict": verdict,
        "confidence": confidence,
        "summary": summary,
        "avg_layer1_score": avg_layer1,
        "avg_layer2_score": avg_layer2,
        "category_recommendations": recommendations,
        "category_scores": category_scores,
        "rework_instructions": rework_instructions,
        "total_files_analysed": len(layer1_reports),
        "total_review_categories": len(reviews),
    }


# ═══════════════════════════════════════════════════════════════════════
# Full Pipeline Orchestrator
# ═══════════════════════════════════════════════════════════════════════


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name="workers.tasks.adversarial_review.full_review",
    autoretry_for=(Exception,),
)
def full_adversarial_review(
    self,
    diff_files: list[str],
    issue_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run all 3 layers of the adversarial review and return the verdict.

    This is the top-level entry point that chains:
      1. Layer 1 — per-file analysis
      2. Layer 2 — holistic multi-angle review
      3. Layer 3 — oracle verdict synthesis

    Returns a dict with every layer full report plus the final verdict.
    """
    issue_context = issue_context or {}
    logger.info(
        json.dumps({
            "event": "adversarial.orchestrator.start",
            "files_count": len(diff_files),
            "issue_id": issue_context.get("issue_id", issue_context.get("issue_url", "unknown")),
        })
    )

    try:
        # ── Layer 1 ───────────────────────────────────────────────
        layer1_result = layer1_analysis(diff_files, issue_context)
        layer1_reports = layer1_result.get("reports", {})

        logger.info(
            json.dumps({
                "event": "adversarial.orchestrator.layer1_complete",
                "files_analysed": len(layer1_reports),
                "avg_score": round(
                    sum(r["score"] for r in layer1_reports.values()) / len(layer1_reports), 2
                ) if layer1_reports else 0.0,
            })
        )

        # ── Layer 2 ───────────────────────────────────────────────
        layer2_result = layer2_holistic(layer1_reports, issue_context)
        logger.info(
            json.dumps({
                "event": "adversarial.orchestrator.layer2_complete",
                "reviews_generated": len(layer2_result.get("reviews", {})),
            })
        )

        # ── Layer 3 ───────────────────────────────────────────────
        layer3_result = layer3_oracle(layer1_reports, layer2_result, issue_context)
        logger.info(
            json.dumps({
                "event": "adversarial.orchestrator.layer3_complete",
                "verdict": layer3_result.get("verdict", "UNKNOWN"),
                "confidence": layer3_result.get("confidence", 0.0),
            })
        )

        verdict = layer3_result.get("verdict", "FAIL")
        passed = verdict == "PASS"

        logger.info(
            json.dumps({
                "event": "adversarial.orchestrator.complete",
                "verdict": verdict,
                "passed": passed,
            })
        )

        return {
            "status": "completed",
            "passed": passed,
            "verdict": verdict,
            "layer1": layer1_result,
            "layer2": layer2_result,
            "layer3": layer3_result,
            "diff_files": diff_files,
            "issue_context": issue_context,
        }

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "adversarial.orchestrator.error",
                "error": str(exc),
            }),
            exc_info=True,
        )
        return {
            "status": "failed",
            "passed": False,
            "verdict": "FAIL",
            "error": str(exc),
            "diff_files": diff_files,
            "issue_context": issue_context,
        }
