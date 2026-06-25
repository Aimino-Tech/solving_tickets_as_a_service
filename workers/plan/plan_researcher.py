"""
Plan researcher --- integrate codebase and web research into structured plans.

Takes an issue description, runs codebase and web research via ``researcher``,
and produces an enriched plan where each step is annotated with relevant
research context.

Usage::

    from workers.plan.plan_researcher import (
        generate_research_augmented_plan,
        ResearchAugmentedPlan,
    )

    result = generate_research_augmented_plan(
        issue_id="issue-42",
        title="Login returns 500 for plus signs",
        body="Email addresses with + cause a crash.",
        workspace_path="/path/to/repo",
    )

    for step in result.steps:
        print(step["task"], step.get("research_context"))
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from workers.plan.researcher import (
    ResearchFinding,
    ResearchResult,
    research_all,
    research_codebase,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

_RESEARCH_STEP_TEMPLATES: dict[str, list[str]] = {
    "triage": [
        "Review codebase context to understand the affected area",
        "Analyze reported error patterns against similar code paths",
    ],
    "investigate": [
        "Examine relevant files for root cause analysis",
        "Reproduce the issue with provided context",
    ],
    "fix": [
        "Apply fix to the identified code paths",
        "Ensure consistency with surrounding code patterns",
    ],
    "test": [
        "Add regression test covering the reported scenario",
        "Verify existing tests still pass with the change",
    ],
    "verify": [
        "Run full test suite and validate no regressions",
        "Cross-check with research findings for completeness",
    ],
}

_DEFAULT_STEP_TEMPLATE = "Review research findings and implement the necessary changes"


@dataclass
class ResearchAugmentedPlan:
    """A plan enriched with research context.

    Attributes
    ----------
    issue_id
        Issue or ticket identifier.
    steps
        List of plan step dicts, each with ``task``, ``done``, and
        optionally ``research_context`` (str).
    research
        The underlying research result used for augmentation.
    summary
        Human-readable summary of what the plan covers.
    """

    issue_id: str
    steps: list[dict[str, Any]] = field(default_factory=list)
    research: ResearchResult | None = None
    summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-safe dict."""
        return {
            "issue_id": self.issue_id,
            "steps": [
                {
                    "task": s.get("task", ""),
                    "done": s.get("done", False),
                    "research_context": s.get("research_context", ""),
                }
                for s in self.steps
            ],
            "summary": self.summary,
            "research_confidence": self.research.confidence if self.research else 0.0,
            "finding_count": len(self.research.findings) if self.research else 0,
        }


# ---------------------------------------------------------------------------
# Research integration
# ---------------------------------------------------------------------------


def _select_step_templates(research: ResearchResult) -> list[str]:
    """Select plan step templates based on research findings and confidence."""
    has_content = any(f.kind == "codebase_content" for f in research.findings)
    has_web = any(f.kind.startswith("web_") for f in research.findings)
    confidence = research.confidence

    templates: list[str] = []

    if confidence < 0.3:
        # Low confidence --- start with investigation
        templates.extend(_RESEARCH_STEP_TEMPLATES["investigate"])
        templates.append(_DEFAULT_STEP_TEMPLATE)
    elif has_content:
        # High-quality codebase matches --- short-circuit to fix
        templates.extend(_RESEARCH_STEP_TEMPLATES["investigate"])
        templates.extend(_RESEARCH_STEP_TEMPLATES["fix"])
        templates.extend(_RESEARCH_STEP_TEMPLATES["test"])
    else:
        # Moderate confidence or file-only matches --- full pipeline
        templates.extend(_RESEARCH_STEP_TEMPLATES["investigate"])
        templates.extend(_RESEARCH_STEP_TEMPLATES["fix"])
        templates.extend(_RESEARCH_STEP_TEMPLATES["test"])

    if has_web:
        templates.append("Validate fix against external references")

    templates.append(_RESEARCH_STEP_TEMPLATES["verify"][0])

    return templates


def _build_research_context(
    step_task: str,
    findings: list[ResearchFinding],
) -> str:
    """Build a short research context string for a given step."""
    relevant: list[str] = []
    for finding in findings:
        if finding.kind == "codebase_content":
            loc = f"{finding.source}:{finding.line_number}" if finding.line_number else finding.source
            relevant.append(f"[{loc}] {finding.snippet[:120]}")
        elif finding.kind == "codebase_file":
            relevant.append(f"[file:{finding.source}]")
        elif finding.kind.startswith("web_"):
            relevant.append(f"[web:{finding.source}]")

    if not relevant:
        return ""

    # Limit context to 3 most relevant items
    selected = relevant[:3]
    return "; ".join(selected)


def _build_summary(research: ResearchResult, step_count: int) -> str:
    """Build a human-readable plan summary."""
    parts: list[str] = []
    if research.codebase_summary:
        parts.append(research.codebase_summary)
    if research.web_summary:
        parts.append(research.web_summary)

    base = f"Research-augmented plan with {step_count} step(s)"
    if parts:
        base += f" --- {'; '.join(parts)}"
    return base


def generate_research_augmented_plan(
    issue_id: str,
    title: str,
    body: str,
    workspace_path: str = "",
    include_web: bool = True,
) -> ResearchAugmentedPlan:
    """Generate a plan augmented with codebase and web research.

    The function:
    1. Runs codebase research (and optionally web research)
    2. Selects appropriate plan step templates based on research quality
    3. Annotates each step with relevant research context

    Parameters
    ----------
    issue_id
        Issue or ticket identifier (used in plan heading).
    title
        Issue title.
    body
        Issue body / description.
    workspace_path
        Path to the repository root.
    include_web
        Whether to also run web research.

    Returns
    -------
    ResearchAugmentedPlan
        Plan with research-enriched steps.
    """
    if not title and not body:
        logger.warning("generate_research_augmented_plan called with empty title and body")
        return ResearchAugmentedPlan(
            issue_id=issue_id,
            steps=[],
            summary="No issue content provided --- cannot generate plan",
        )

    logger.info(
        "Generating research-augmented plan --- issue=%s title=%s",
        issue_id, title[:60],
    )

    # Step 1: Run research
    if include_web:
        research = research_all(title, body, workspace_path)
    else:
        research = research_codebase(title, body, workspace_path)

    # Step 2: Select step templates
    templates = _select_step_templates(research)

    # Step 3: Build steps with research context
    steps: list[dict[str, Any]] = []
    for i, template in enumerate(templates):
        context = _build_research_context(template, research.findings)
        step: dict[str, Any] = {
            "task": template,
            "done": False,
        }
        if context:
            step["research_context"] = context
        steps.append(step)

    # Step 4: Build summary
    summary = _build_summary(research, len(steps))

    logger.info(
        "Plan generated --- issue=%s steps=%d research_findings=%d confidence=%.2f",
        issue_id, len(steps), len(research.findings), research.confidence,
    )

    return ResearchAugmentedPlan(
        issue_id=issue_id,
        steps=steps,
        research=research,
        summary=summary,
    )


def enrich_existing_plan(
    issue_id: str,
    existing_steps: list[dict[str, Any]],
    research: ResearchResult,
) -> list[dict[str, Any]]:
    """Augment an existing plan with research context.

    Adds ``research_context`` to each step where relevant findings exist.
    Existing step data is preserved.

    Parameters
    ----------
    issue_id
        Issue identifier (used for logging).
    existing_steps
        Existing plan steps (list of dicts with ``task`` key).
    research
        Research result to draw context from.

    Returns
    -------
    list[dict[str, Any]]
        Enriched steps with research context attached where relevant.
    """
    if not existing_steps:
        return []

    enriched: list[dict[str, Any]] = []
    for step in existing_steps:
        task = step.get("task", "")
        context = _build_research_context(task, research.findings)

        enriched_step = dict(step)
        if context:
            enriched_step["research_context"] = context
        enriched.append(enriched_step)

    logger.info(
        "Enriched %d existing step(s) for issue=%s",
        len(enriched), issue_id,
    )

    return enriched
