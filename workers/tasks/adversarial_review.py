"""
3-Layer Adversarial Review Pipeline.

Layer 1: Per-file analysis (parallel subagents per changed file)
Layer 2: 5 holistic review agents (goals, quality, security, QA, context)
Layer 3: Oracle synthesis verdict (PASS/FLAG/FAIL)
"""
import json
import logging
import os
import subprocess
import tempfile
from typing import Any

from celery import shared_task

logger = logging.getLogger(__name__)

OPENCODE_BIN = os.getenv("OPENCODE_BIN", "/home/xdn/.opencode/bin/opencode")


def _run_opencode(prompt: str, timeout_s: int = 120) -> str:
    cmd = [OPENCODE_BIN, "run", prompt, "--model", os.getenv("OPENCODE_MODEL", "deepseek-v4-flash"), "--print-logs"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s)
        return result.stdout or ""
    except subprocess.TimeoutExpired:
        return "TIMEOUT"


@shared_task(
    bind=True,
    max_retries=0,
    default_retry_delay=30,
    name="workers.tasks.adversarial_review.layer1_per_file_analysis",
)
def layer1_per_file_analysis(self, changed_files: list[str], diff_content: str) -> dict:
    logger.info("Layer 1: Analyzing %d changed files", len(changed_files))
    analyses: list[dict] = []
    for file_path in changed_files:
        prompt = (
            f"Analyze this file change for correctness, edge cases, and security issues:\n"
            f"File: {file_path}\n"
            f"Diff:\n{diff_content[:4000]}\n\n"
            f"Respond with JSON: {{\"file\": \"{file_path}\", "
            f"\"issues\": [{{\"severity\": \"critical|major|minor\", "
            f"\"description\": \"...\", \"line\": N}}], "
            f"\"summary\": \"...\", \"score\": 0-1}}"
        )
        output = _run_opencode(prompt)
        try:
            report = json.loads(output)
        except (json.JSONDecodeError, Exception):
            report = {"file": file_path, "issues": [], "summary": "Analysis unavailable", "score": 0.5}
        analyses.append(report)
    return {"layer": 1, "analyses": analyses, "files_analyzed": len(changed_files)}


@shared_task(
    bind=True,
    max_retries=0,
    default_retry_delay=30,
    name="workers.tasks.adversarial_review.layer2_holistic_review",
)
def layer2_holistic_review(self, perspective: str, issue_context: dict, layer1_results: dict, diff_content: str) -> dict:
    logger.info("Layer 2: %s review", perspective)
    prompts = {
        "goals": f"Does this change actually fix the issue? Issue: {json.dumps(issue_context)}. Diff: {diff_content[:3000]}",
        "quality": f"Is this code maintainable? Follows codebase patterns? Diff: {diff_content[:3000]}",
        "security": f"Any injection, XSS, auth bypass, dependency risks? Diff: {diff_content[:3000]}",
        "qa": f"Does this actually work? Verify acceptance criteria. ACs: {json.dumps(issue_context.get('acceptance_criteria', []))}",
        "context": f"Does the PR match the issue + codebase context? Issue: {json.dumps(issue_context)}. Diff: {diff_content[:3000]}",
    }
    prompt = prompts.get(perspective, prompts["goals"])
    output = _run_opencode(prompt)
    try:
        report = json.loads(output)
    except (json.JSONDecodeError, Exception):
        report = {"perspective": perspective, "verdict": "unable_to_analyze", "details": output[:500]}
    report["perspective"] = perspective
    return {"layer": 2, "perspective": perspective, "report": report}


@shared_task(
    bind=True,
    max_retries=0,
    default_retry_delay=30,
    name="workers.tasks.adversarial_review.layer3_oracle_synthesis",
)
def layer3_oracle_synthesis(self, layer1_results: dict, layer2_results: list[dict], issue_context: dict) -> dict:
    logger.info("Layer 3: Oracle synthesis of %d layer-2 reviews", len(layer2_results))
    combined = json.dumps({"layer1": layer1_results, "layer2": layer2_results, "issue": issue_context})
    prompt = (
        f"Synthesize these review results into a final verdict. "
        f"Respond with JSON: {{\"verdict\": \"PASS|FLAG|FAIL\", "
        f"\"confidence\": 0-1, \"summary\": \"...\", "
        f"\"rework_instructions\": [\"...\"]}}\n\n{combined[:4000]}"
    )
    output = _run_opencode(prompt, timeout_s=180)
    try:
        verdict = json.loads(output)
    except (json.JSONDecodeError, Exception):
        verdict = {"verdict": "FLAG", "confidence": 0.5, "summary": "Could not synthesize", "rework_instructions": []}

    passed = verdict.get("verdict") == "PASS"
    return {
        "layer": 3,
        "verdict": verdict,
        "passed": passed,
        "all_reports": {"layer1": layer1_results, "layer2": layer2_results},
    }
