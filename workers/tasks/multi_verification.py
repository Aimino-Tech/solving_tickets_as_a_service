"""
Multi-Round Verification — runs verification 3 times with prompt variations.

Each round is a fresh verification with a different prompt designed to catch
inconsistencies and prevent the agent from gaming a single fixed prompt.
All 3 rounds must pass for the overall verification to succeed.
"""

import json
import logging
import os
import subprocess

from celery import shared_task

logger = logging.getLogger(__name__)

_COMMAND_TIMEOUT_S = 300

# -- Prompt Variations ---------------------------------------------------------
# Each round uses a different phrasing to prevent the agent from
# crafting a response that passes a single, predictable check.

ROUND_LABELS = [
    "Verify ALL acceptance criteria are met",
    "Check if every AC is demonstrably satisfied",
    "Prove each acceptance criterion is met with evidence",
]

ROUND_PROMPT_TEMPLATES = [
    "Verify ALL acceptance criteria are met:\n{ac_list}\nRun: {test_command}",
    "Check if every AC is demonstrably satisfied:\n{ac_list}\nTest command: {test_command}",
    "Prove each acceptance criterion is met with evidence:\n{ac_list}\nExecute: {test_command}",
]


def _build_round_prompt(template: str, ac_list: list[str], test_command: str) -> str:
    """Interpolate a round prompt template with the actual AC list and test command."""
    formatted_ac = "\n".join(f"  - {ac}" for ac in ac_list) if ac_list else "  (none)"
    return template.format(ac_list=formatted_ac, test_command=test_command)


def _resolve_workspace_path(workspace_path: str) -> str:
    """Resolve the workspace path, handling tilde and relative paths."""
    if workspace_path.startswith("~"):
        workspace_path = os.path.expanduser(workspace_path)
    return os.path.abspath(workspace_path)


def _run_test_command(test_command: str, cwd: str) -> dict:
    """
    Run the test command in the given working directory.

    Returns {passed, output, exit_code}.
    """
    logger.info(
        json.dumps({
            "event": "multi_verification.run_command",
            "command": test_command,
            "cwd": cwd,
        })
    )

    try:
        proc = subprocess.run(
            test_command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=_COMMAND_TIMEOUT_S,
            cwd=cwd,
        )
    except subprocess.TimeoutExpired:
        logger.error(
            json.dumps({
                "event": "multi_verification.timeout",
                "timeout_s": _COMMAND_TIMEOUT_S,
            })
        )
        return {
            "passed": False,
            "output": f"TIMEOUT: command exceeded {_COMMAND_TIMEOUT_S}s",
            "exit_code": -1,
        }

    output = proc.stdout or ""
    if proc.stderr:
        if output:
            output += "\n"
        output += proc.stderr

    passed = proc.returncode == 0

    logger.info(
        json.dumps({
            "event": "multi_verification.command_result",
            "exit_code": proc.returncode,
            "passed": passed,
            "output_length": len(output),
        })
    )

    return {"passed": passed, "output": output, "exit_code": proc.returncode}


def _check_ac_in_output(ac: str, output: str) -> tuple[bool, str]:
    """
    Check if an acceptance criterion is mentioned or evidenced in command output.

    Uses keyword matching -- looks for significant words from the AC
    appearing in the test output.
    """
    ac_lower = ac.lower()
    output_lower = output.lower()

    # Extract significant keywords (words longer than 3 characters)
    keywords = [w for w in ac_lower.split() if len(w) > 3]

    if not keywords:
        # If AC is very short, check for exact phrase match
        return ac_lower in output_lower, ""

    matches = sum(1 for kw in keywords if kw in output_lower)
    ratio = matches / len(keywords) if keywords else 0.0

    if ratio >= 0.6:
        evidence = f"Found {matches}/{len(keywords)} keywords in output"
        return True, evidence
    elif ratio >= 0.3:
        evidence = f"Only {matches}/{len(keywords)} keywords found in output (partial match)"
        return False, evidence
    else:
        evidence = f"No significant evidence -- {matches}/{len(keywords)} keywords matched"
        return False, evidence


def _ac_evidence_in_workspace(ac: str, workspace_path: str) -> tuple[bool, str]:
    """
    Check for evidence of an AC being implemented in the workspace.

    Searches for related files and code patterns.
    """
    ac_lower = ac.lower()
    keywords = [w for w in ac_lower.split() if len(w) > 3]

    if not keywords:
        return False, "No searchable keywords in acceptance criterion"

    try:
        findings = []
        src_dirs = _find_source_dirs(workspace_path)
        for src_dir in src_dirs:
            full_dir = os.path.join(workspace_path, src_dir)
            if not os.path.isdir(full_dir):
                continue
            kw_pattern = "|".join(keywords)
            result = subprocess.run(
                f"grep -rl --include='*.py' --include='*.ts' --include='*.tsx' "
                f"--include='*.js' --include='*.jsx' -i -E '{kw_pattern}' "
                f"{full_dir} 2>/dev/null | head -5",
                shell=True,
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.stdout.strip():
                findings.extend(result.stdout.strip().split("\n"))

        if findings:
            evidence = f"Found evidence in {len(findings)} file(s): {', '.join(findings[:3])}"
            return True, evidence
        else:
            return False, "No files found containing AC-related keywords"
    except Exception as exc:
        return False, f"Error scanning workspace: {exc}"


def _find_source_dirs(workspace_path: str) -> list[str]:
    """Find likely source directories in a workspace."""
    candidates = ["src", "lib", "app", "packages", "workers", "tests", "."]
    existing = []
    for d in candidates:
        full = os.path.join(workspace_path, d)
        if os.path.isdir(full):
            existing.append(d)
    return existing if existing else ["."]


def _check_ac_with_prompt_variation(
    ac: str,
    round_index: int,
    test_output: str,
    workspace_path: str,
) -> dict:
    """
    Check a single AC using the round-specific prompt variation strategy.

    Each round uses a different methodology:
      Round 0: Keyword-match AC in test output
      Round 1: Search workspace for evidence of implementation
      Round 2: Combined approach -- output match + workspace evidence
    """
    label = ROUND_LABELS[round_index]

    if round_index == 0:
        # "Verify ALL acceptance criteria are met"
        # Strategy: Check if test output references the AC
        met, evidence = _check_ac_in_output(ac, test_output)
        return {
            "ac": ac,
            "met": met,
            "evidence": evidence,
            "prompt": label,
            "strategy": "output_keyword_check",
        }

    elif round_index == 1:
        # "Check if every AC is demonstrably satisfied"
        # Strategy: Search workspace files for evidence of implementation
        met, evidence = _ac_evidence_in_workspace(ac, workspace_path)
        return {
            "ac": ac,
            "met": met,
            "evidence": evidence,
            "prompt": label,
            "strategy": "workspace_evidence_check",
        }

    else:
        # "Prove each acceptance criterion is met with evidence"
        # Strategy: Combined approach
        output_met, output_evidence = _check_ac_in_output(ac, test_output)
        ws_met, ws_evidence = _ac_evidence_in_workspace(ac, workspace_path)

        met = output_met and ws_met
        evidence_parts = []
        if output_met:
            evidence_parts.append(f"[output] {output_evidence}")
        if ws_met:
            evidence_parts.append(f"[workspace] {ws_evidence}")
        if not met:
            evidence_parts.append("Missing evidence from both output and workspace")

        return {
            "ac": ac,
            "met": met,
            "evidence": "; ".join(evidence_parts),
            "prompt": label,
            "strategy": "combined_evidence_check",
        }


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.multi_verification.multi_round_verify",
    autoretry_for=(Exception,),
)
def multi_round_verify(
    self,
    workspace_path: str,
    ac_list: list[str],
    test_command: str,
) -> dict:
    """
    Run verification 3 times with different prompt variations.

    All 3 rounds must pass. Each round is a fresh verification with no
    shared context. Fail-fast: if any round fails, return immediately.

    Args:
        workspace_path: Path to the workspace/repo root.
        ac_list: List of acceptance criteria strings.
        test_command: Shell command to run tests.

    Returns:
        dict: {
            "passed": bool,
            "rounds": [
                {"round": 1, "verdict": "passed"|"failed", "details": dict},
                ...
            ],
            "score": float  (rounds_passed / 3)
        }
    """
    workspace_path = _resolve_workspace_path(workspace_path)

    logger.info(
        json.dumps({
            "event": "multi_verification.start",
            "workspace_path": workspace_path,
            "ac_count": len(ac_list),
            "test_command": test_command,
        })
    )

    rounds: list[dict] = []
    rounds_passed = 0

    try:
        for i, label in enumerate(ROUND_LABELS):
            round_number = i + 1
            logger.info(
                json.dumps({
                    "event": "multi_verification.round_start",
                    "round": round_number,
                    "prompt": label,
                })
            )

            # Run the test command for this round (fresh each time)
            test_result = _run_test_command(test_command, workspace_path)

            # Verify each AC using the round's strategy
            ac_results: list[dict] = []
            for ac in ac_list:
                ac_result = _check_ac_with_prompt_variation(
                    ac=ac,
                    round_index=i,
                    test_output=test_result["output"],
                    workspace_path=workspace_path,
                )
                ac_results.append(ac_result)

            # Determine round verdict
            passed_acs = [r for r in ac_results if r["met"]]
            failed_acs = [r for r in ac_results if not r["met"]]

            tests_passed = test_result["passed"]
            all_acs_met = len(failed_acs) == 0

            round_passed = tests_passed and all_acs_met

            round_detail = {
                "verdict": "passed" if round_passed else "failed",
                "prompt": label,
                "tests_passed": tests_passed,
                "test_output_preview": test_result["output"][:2000],
                "ac_results": ac_results,
                "ac_passed": len(passed_acs),
                "ac_failed": len(failed_acs),
                "failed_acs": [r["ac"] for r in failed_acs],
            }

            if round_passed:
                rounds_passed += 1

            rounds.append({
                "round": round_number,
                "verdict": "passed" if round_passed else "failed",
                "details": round_detail,
            })

            logger.info(
                json.dumps({
                    "event": "multi_verification.round_end",
                    "round": round_number,
                    "verdict": "passed" if round_passed else "failed",
                })
            )

            # Fail-fast: return immediately on failure
            if not round_passed:
                logger.warning(
                    json.dumps({
                        "event": "multi_verification.fail_fast",
                        "failed_round": round_number,
                        "reason": "Tests or AC verification failed",
                    })
                )
                return {
                    "passed": False,
                    "rounds": rounds,
                    "score": rounds_passed / 3,
                }

        # All rounds passed
        logger.info(
            json.dumps({
                "event": "multi_verification.complete",
                "rounds_passed": rounds_passed,
                "total_rounds": 3,
            })
        )

        return {
            "passed": True,
            "rounds": rounds,
            "score": 1.0,
        }

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "multi_verification.error",
                "error": str(exc),
            }),
            exc_info=True,
        )
        return {
            "passed": False,
            "rounds": rounds,
            "score": rounds_passed / 3 if rounds else 0.0,
        }
