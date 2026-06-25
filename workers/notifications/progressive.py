"""Progressive pipeline-status comment builder."""

from __future__ import annotations

from typing import Any

STAGE_ORDER: list[str] = [
    "triage",
    "research",
    "agent",
    "verify",
    "self_audit",
    "review",
    "pr",
]


def _progress_bar(fraction: float, width: int = 20) -> str:
    filled = max(0, min(width, int(fraction * width)))
    return "\u2588" * filled + "\u2591" * (width - filled)


def _build_collapsible_section(
    summary: str,
    body_lines: list[str],
    *,
    open: bool = False,
) -> str:
    lines: list[str] = []
    lines.append("<details open>" if open else "<details>")
    lines.append(f"<summary>{summary}</summary>")
    if body_lines:
        lines.append("")
        lines.extend(body_lines)
    lines.append("</details>")
    lines.append("")
    return "\n".join(lines)


def build_progressive_comment(
    issue_id: str,
    stages: dict[str, dict[str, Any]],
) -> str:
    from workers.notifications.status_comments import STAGE_EMOJI, STAGE_LABELS

    sections: list[str] = [
        f"## Pipeline Progress -- {issue_id}",
        "",
    ]

    for stage_name in STAGE_ORDER:
        s = stages.get(stage_name)
        emoji = STAGE_EMOJI.get(stage_name, "\u2022")
        label = STAGE_LABELS.get(stage_name, stage_name.title())

        if s is None:
            sections.append(
                _build_collapsible_section(
                    f"pending: {emoji} {label}", [],
                ),
            )
        elif s["status"] == "completed":
            sections.append(
                _build_collapsible_section(
                    f"done: {emoji} {label} - {s.get('message', '')}",
                    _detail_lines(s),
                ),
            )
        elif s["status"] == "started":
            progress = s.get("progress", 0.0)
            bar = _progress_bar(progress)
            body: list[str] = [
                "```",
                f"Progress: {bar} {int(progress * 100)}%",
                "```",
            ]
            body.extend(_detail_lines(s))
            sections.append(
                _build_collapsible_section(
                    f"running: {emoji} {label} - {s.get('message', '')}",
                    body, open=True,
                ),
            )
        elif s["status"] == "failed":
            sections.append(
                _build_collapsible_section(
                    f"failed: {emoji} {label} - {s.get('message', '')}",
                    _detail_lines(s, prefix="> "),
                ),
            )
        else:
            sections.append(
                _build_collapsible_section(
                    f"other: {emoji} {label} - {s.get('message', '')}", [],
                ),
            )

    return "\n".join(sections)


def _detail_lines(
    s: dict[str, Any],
    *,
    prefix: str = "",
) -> list[str]:
    detail = s.get("detail", "")
    return [f"{prefix}{detail}"] if detail else []
