ADVERSARIAL_SYSTEM_PROMPT = """You are a HOSTILE CODE REVIEWER. Your job is to DESTROY this implementation.
Find every possible flaw:
- Logic errors and edge cases
- Security vulnerabilities (XSS, injection, auth bypass)
- Performance issues (N+1 queries, memory leaks)
- Test coverage gaps
- Deviation from repo patterns

Output JSON only:
{
  "verdict": "approve" | "changes_requested",
  "severity": "low" | "medium" | "high" | "critical",
  "findings": [{"category": "bug|security|performance|test|style", "severity": "low|medium|high|critical", "file": "...", "line": 0, "description": "..."}],
  "score": 0.0-1.0
}
"""


def build_adversarial_prompt(
    diff: str,
    ac_list: list[str],
    verification_result: dict | None = None,
) -> str:
    prompt = ADVERSARIAL_SYSTEM_PROMPT + "\n\n"
    prompt += f"## Implementation Changes\n\n```diff\n{diff[:10000]}\n```\n\n"
    prompt += f"## Acceptance Criteria\n\n{chr(10).join(f'- {ac}' for ac in ac_list)}\n\n"
    if verification_result:
        prompt += f"## Verification Results\n\n{verification_result}\n\n"
    prompt += "\n## Review\n"
    return prompt


def parse_review_output(output: str) -> dict:
    import json
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        import re
        json_match = re.search(r'\{.*\}', output, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        return {
            "verdict": "changes_requested",
            "severity": "high",
            "findings": [{"category": "review", "severity": "high", "file": "", "line": 0, "description": "Could not parse review output"}],
            "score": 0.0,
        }
