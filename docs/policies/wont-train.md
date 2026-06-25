# Won't Train Guarantee — STAS

> Effective: 2026-06-25

## Our Commitment

STAS does not train AI models on customer code, issue content, or repository data.

When you submit an issue to STAS for automated fixing, the data processed during the fix run is used exclusively to:
1. Investigate the reported issue
2. Generate and validate a fix
3. Open a pull request

None of this data is used to train, fine-tune, or improve any AI model.

## Scope
| Data Type | Covered | Notes |
|---|---|---|
| Issue title and body | Yes | Read-only, not stored after run |
| Issue comments | Yes | Truncated to 15 per run |
| Repository code | Yes | Read-only, not stored after run |
| PR diffs | Yes | Auto-cleaned after PR creation |
| GitHub metadata | Yes | Repo names, issue numbers only |
| Sandbox logs | Yes | Ephemeral per sandbox |

## Legal Basis
- Contractual commitment in DPA
- Technical enforcement via ephemeral sandbox architecture
- Architectural design: fix data exists only within sandbox lifetime

## Exceptions
Retained data (never used for training):
- Aggregate metrics: fix counts, pass rates (no identifying info)
- Security scan results: SARIF output for code quality
- Audit logs: timestamps, event types (no code content)

## Enterprise
Custom DPA available for enterprise customers including:
- Specific data handling commitments
- Right to audit data processing
- Custom retention schedules
- Contact: security@aimino.com
