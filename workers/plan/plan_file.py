"""
Plan-as-file --- persist and load an editable plan.md in the workspace.

A plan is a list of steps, each represented as a dict with keys:
    ``task`` (str) -- human-readable step description
    ``done`` (bool) -- whether the step is marked complete

The on-disk format is markdown with checkboxes::

    # Plan

    - [ ] Triage issue
    - [x] Create workspace
    - [ ] Dispatch agent

This file is intentionally kept free of Celery or framework imports so it
can be used from orchestration, CLI, or dashboard code alike.
"""

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

PLAN_FILENAME = "plan.md"

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def save_plan(
    issue_id: str,
    steps: list[dict[str, Any]],
    ctx: dict[str, Any] | None = None,
) -> str:
    """Write a structured plan as ``plan.md`` inside the workspace.

    Parameters
    ----------
    issue_id
        Issue or ticket identifier (used in the heading).
    steps
        List of step dicts.  Each must contain ``task`` (str) and may
        contain ``done`` (bool, default ``False``).
    ctx
        Context dict.  Must contain ``workspace_path`` when available;
        falls back to the current working directory.

    Returns
    -------
    str
        Absolute path to the written ``plan.md``.

    Raises
    ------
    OSError
        If the target directory is not writable.
    """
    if ctx and ctx.get("workspace_path"):
        workspace_path: str = ctx["workspace_path"]
    else:
        workspace_path = os.getcwd()

    plan_path = os.path.join(workspace_path, PLAN_FILENAME)

    lines: list[str] = [
        f"# Plan for {issue_id}",
        "",
    ]

    for step in steps:
        task = step.get("task", "Unknown step")
        done = step.get("done", False)
        checkbox = "x" if done else " "
        lines.append(f"- [{checkbox}] {task}")

    lines.append("")

    content = "\n".join(lines)

    try:
        with open(plan_path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError:
        logger.exception("Failed to write plan to %s", plan_path)
        raise

    logger.info("Plan saved to %s (%d steps)", plan_path, len(steps))
    return plan_path


def read_plan(workspace_path: str) -> list[dict[str, Any]]:
    """Parse ``plan.md`` from *workspace_path* back into structured steps.

    Parameters
    ----------
    workspace_path
        Root directory that should contain ``plan.md``.

    Returns
    -------
    list[dict]
        List of step dicts with ``task`` and ``done`` keys.
        Returns an empty list when the file does not exist or is empty.
    """
    plan_path = os.path.join(workspace_path, PLAN_FILENAME)

    if not os.path.isfile(plan_path):
        logger.info("No plan file found at %s", plan_path)
        return []

    try:
        with open(plan_path, "r", encoding="utf-8") as f:
            content = f.read()
    except OSError:
        logger.exception("Failed to read plan from %s", plan_path)
        return []

    steps: list[dict[str, Any]] = []

    for line in content.splitlines():
        stripped = line.strip()
        # Match "- [ ] Task name" or "- [x] Task name"
        if not stripped.startswith("- [") or len(stripped) < 6:
            continue
        if stripped[5] != " ":  # must be "- [ ] ..." or "- [x] ..."
            continue

        marker = stripped[3]  # ' ' or 'x'
        task = stripped[6:]  # everything after "- [ ] "

        steps.append({
            "task": task.strip(),
            "done": marker == "x",
        })

    return steps
