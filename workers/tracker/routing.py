"""
Label-based pipeline routing for Linear issues.

Maps Linear issue labels to SYNTARO pipeline names.  When a polled issue
has one of the defined labels, it is dispatched to the corresponding
pipeline.

Extend ``PIPELINE_ROUTES`` to register new label-to-pipeline mappings.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Pipeline route definition
#
# Key = Linear label name (matched case-insensitively against issue labels).
# Value = pipeline name (used for routing to the correct Celery task chain).
#
# To add a new pipeline:
#   1. Define the label in your Linear team.
#   2. Add an entry to PIPELINE_ROUTES below.
#   3. Create the corresponding task chain (if needed).
# ---------------------------------------------------------------------------

PIPELINE_ROUTES: dict[str, str] = {
    "syntaro:fix": "default",
    "syntaro:feature": "feature",
    "syntaro:research": "research",
}

# ---- Pipeline metadata --------------------------------------------------
# Each pipeline can optionally declare a display name and a processing hint.

PIPELINE_META: dict[str, dict[str, str]] = {
    "default": {
        "display_name": "Bug Fix",
        "description": "Analyze root cause and produce a fix PR",
    },
    "feature": {
        "display_name": "Feature",
        "description": "Implement a new feature based on the issue description",
    },
    "research": {
        "display_name": "Research",
        "description": "Investigate and report findings without code changes",
    },
}

# ---- Resolver -----------------------------------------------------------


PipelineType = str


def classify_pipeline(labels: list[str]) -> PipelineType:
    return resolve_pipeline(labels)


def resolve_pipeline(labels: list[str]) -> str:
    """
    Return the pipeline name for the first matching label in *labels*.

    Labels are matched case-insensitively.  If no label matches,
    ``"default"`` is returned.
    """
    label_lower = {lbl.strip().lower() for lbl in labels}

    for route_label, pipeline in PIPELINE_ROUTES.items():
        if route_label.lower() in label_lower:
            return pipeline

    return "default"


def get_pipeline_meta(pipeline: str) -> dict[str, str] | None:
    """Return metadata dict for *pipeline*, or ``None`` if unknown."""
    return PIPELINE_META.get(pipeline)


def register_route(label: str, pipeline: str) -> None:
    """Add a new label-to-pipeline mapping at runtime."""
    PIPELINE_ROUTES[label] = pipeline
    if pipeline not in PIPELINE_META:
        PIPELINE_META[pipeline] = {
            "display_name": pipeline.replace("_", " ").title(),
            "description": "",
        }
