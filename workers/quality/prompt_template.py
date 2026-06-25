def inject_anti_stub_prompt(base_prompt: str, ac_list: list[str]) -> str:
    ac_lines = "\n".join(f"- [ ] {ac}" for ac in ac_list)
    return f"""{base_prompt}

## Anti-Fake Enforcement (MANDATORY)

ZERO TOLERANCE for mockups, stubs, and fake data.
- Every function MUST have a real implementation body.
- No `TODO`, `FIXME`, `placeholder`, or `pass` stubs.
- Every acceptance criterion MUST be verified against REAL execution.
- Test files MUST test real code paths, not mocked infrastructure.
- Hardcoded return values are forbidden unless they are literal constants.
- TypeScript: no `@ts-expect-error`, `@ts-ignore`, or `as any` escapes.

## Acceptance Criteria
{ac_lines}

You will be audited by a separate agent session that verifies ALL of the above.
"""
