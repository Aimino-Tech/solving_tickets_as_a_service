"""Adversarial review agent — simulates a hostile senior engineer code review."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

ADVERSARIAL_PROMPT = """\
You are a HOSTILE CODE REVIEWER. Your job is to DESTROY this implementation.
Find every possible flaw:
- Logic errors and edge cases
- Security vulnerabilities (XSS, injection, auth bypass)
- Performance issues (N+1 queries, memory leaks)
- Test coverage gaps
- Deviation from repo patterns

Implementation changes: {diff}
Acceptance criteria: {ac_list}
Verification results: {verification}

Output JSON:
{{
  "verdict": "approve" | "changes_requested",
  "severity": "low" | "medium" | "high" | "critical",
  "findings": [{{"category": "bug", "severity": "high", "file": "src/api.ts", "line": 42, "description": "..."}}],
  "score": 0.0-1.0
}}
"""


def _get_llm_client():
    try:
        from openai import OpenAI
        key = os.getenv("OPENAI_API_KEY", "")
        if not key:
            return None
        return OpenAI(api_key=key)
    except ImportError:
        return None


def run_adversarial_review(
    issue_id: str,
    workspace_path: str,
    self_audit_result: dict[str, Any] | None = None,
    verification_result: dict[str, Any] | None = None,
    diff: str | None = None,
    ac_list: list[str] | None = None,
) -> dict[str, Any]:
    logger.info("Running adversarial review for %s", issue_id)
    findings: list[dict[str, Any]] = []

    if self_audit_result:
        if self_audit_result.get("verdict") == "fail":
            findings.append({
                "category": "self_audit",
                "severity": "high",
                "file": "",
                "line": 0,
                "description": "Self-audit failed: " + str(self_audit_result.get("reason", "unknown")),
            })
        mockup_findings = self_audit_result.get("anti_mockup_findings", [])
        for mf in mockup_findings:
            findings.append({
                "category": "mockup",
                "severity": "high",
                "file": mf.get("file", ""),
                "line": mf.get("line", 0),
                "description": mf.get("description", "Potential mock/stub detected"),
            })

    if verification_result:
        if not verification_result.get("passed", False):
            findings.append({
                "category": "verification",
                "severity": "critical" if verification_result.get("score", 1) == 0 else "high",
                "file": "",
                "line": 0,
                "description": "Tests failed: " + verification_result.get("output", "no output")[:200],
            })

    if diff:
        _check_security_patterns(diff, findings)
        _check_performance_patterns(diff, findings)

    if not findings:
        verdict = "approve"
        severity = "low"
        score = 1.0
    else:
        severities = [f.get("severity", "low") for f in findings]
        if "critical" in severities:
            verdict = "changes_requested"
            severity = "critical"
            score = 0.0
        elif "high" in severities:
            verdict = "changes_requested"
            severity = "high"
            score = 0.3
        else:
            verdict = "changes_requested"
            severity = "medium"
            score = 0.6

    result = {
        "verdict": verdict,
        "severity": severity,
        "findings": findings,
        "score": score,
        "issue_id": issue_id,
    }
    logger.info("Review verdict for %s: %s (severity=%s, %d findings)", issue_id, verdict, severity, len(findings))
    return result


def _check_security_patterns(diff: str, findings: list[dict[str, Any]]) -> None:
    security_patterns = [
        ("eval(", "code_injection", "critical", "Use of eval() — potential code injection risk"),
        ("exec(", "code_injection", "critical", "Use of exec() — potential code injection risk"),
        ("innerHTML", "xss", "high", "Use of innerHTML — potential XSS vulnerability"),
        ("dangerouslySetInnerHTML", "xss", "high", "Use of dangerouslySetInnerHTML — potential XSS vulnerability"),
        ("shell=True", "injection", "critical", "shell=True in subprocess — command injection risk"),
        ("pickle.loads", "deserialization", "critical", "Pickle deserialization — remote code execution risk"),
        ("yaml.load(", "deserialization", "high", "Unsafe YAML load — use yaml.safe_load()"),
    ]
    for pattern, category, severity, description in security_patterns:
        if pattern.lower() in diff.lower():
            findings.append({
                "category": category,
                "severity": severity,
                "file": "",
                "line": 0,
                "description": description,
            })


def _check_performance_patterns(diff: str, findings: list[dict[str, Any]]) -> None:
    perf_patterns = [
        ("for ", "performance", "low", "Potential N+1 query pattern — check for loop queries"),
        (".append(", "performance", "low", "Inefficient list building — consider list comprehension"),
        ("time.sleep", "performance", "medium", "Sleep in code path — verify it's intentional"),
    ]
    for pattern, category, severity, description in perf_patterns:
        if pattern.lower() in diff.lower():
            findings.append({
                "category": category,
                "severity": severity,
                "file": "",
                "line": 0,
                "description": description,
            })


def run_llm_review(
    diff: str,
    ac_list: list[str] | None = None,
    verification: dict[str, Any] | None = None,
) -> dict[str, Any]:
    client = _get_llm_client()
    if not client:
        logger.warning("No LLM client — falling back to pattern-based review")
        return run_adversarial_review(issue_id="", workspace_path="", diff=diff, ac_list=ac_list, verification_result=verification)
    prompt = ADVERSARIAL_PROMPT.format(diff=diff[:8000], ac_list=json.dumps(ac_list or []), verification=json.dumps(verification or {}))
    try:
        response = client.chat.completions.create(
            model=os.getenv("OPENAI_REVIEW_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            response_format={"type": "json_object"},
        )
        result_text = response.choices[0].message.content or "{}"
        result = json.loads(result_text)
        return {
            "verdict": result.get("verdict", "changes_requested"),
            "severity": result.get("severity", "medium"),
            "findings": result.get("findings", []),
            "score": result.get("score", 0.5),
            "llm_review": True,
        }
    except Exception as exc:
        logger.error("LLM review failed: %s", exc, exc_info=True)
        return run_adversarial_review(issue_id="", workspace_path="", diff=diff, ac_list=ac_list, verification_result=verification)
