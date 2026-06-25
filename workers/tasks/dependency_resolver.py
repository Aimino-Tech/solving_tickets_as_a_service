"""
Dependency resolution task for the STAS pipeline.

Checks a Linear issue's ``blockedBy`` relationships before dispatching
agents.  If the issue is blocked by unresolved tickets (Todo, In Progress,
etc.), the pipeline returns a ``"skip"`` decision so the issue can be
revisited later.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from celery import shared_task

from workers.linear_client import TERMINAL_STATES, LinearClient

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.dependency_resolver.resolve_dependencies",
    autoretry_for=(Exception,),
)
def resolve_dependencies(
    self,
    issue_id: str,
    **kwargs: Any,
) -> dict[str, Any]:
    """
    Check if a Linear issue is blocked by unresolved dependencies.

    Queries Linear GraphQL for the issue's ``blockedBy`` relations and
    returns a structured decision dict.

    Returns
    -------
    dict
        ``issue_id`` (str)
            The queried issue identifier.
        ``blocked`` (bool)
            Whether the issue is blocked by unresolved blockers.
        ``blockers`` (list[dict])
            List of blocker dicts, each with ``id``, ``status``, ``title``.
        ``decision`` (str)
            One of ``"skip"``, ``"dispatch"``.

    Behavior
    --------
    - **All blockers in terminal state** (Done/Verified/Canceled):
      ``blocked=False``, ``decision="dispatch"``
    - **No blockers**: ``blocked=False``, ``decision="dispatch"``
    - **Any unresolved blockers** (Todo/In Progress/Backlog/In Review):
      ``blocked=True``, ``decision="skip"`` -- and a comment is posted on
      the blocked issue.
    - **Linear API error**: ``blocked=False``, ``decision="dispatch"``
      (fail-open, warning logged).
    """
    logger.info(
        json.dumps({
            "event": "dependency_resolve.start",
            "issue_id": issue_id,
        })
    )

    try:
        client = LinearClient()
        blockers = client.get_blockers(issue_id)

        if not blockers:
            logger.info(
                json.dumps({
                    "event": "dependency_resolve.no_blockers",
                    "issue_id": issue_id,
                    "decision": "dispatch",
                })
            )
            return {
                "issue_id": issue_id,
                "blocked": False,
                "blockers": [],
                "decision": "dispatch",
            }

        # Separate resolved vs. unresolved blockers
        unresolved = [
            b
            for b in blockers
            if b["status"] not in TERMINAL_STATES
        ]

        if not unresolved:
            # All blockers are in terminal states -> can proceed
            logger.info(
                json.dumps({
                    "event": "dependency_resolve.blockers_resolved",
                    "issue_id": issue_id,
                    "blockers": blockers,
                    "decision": "dispatch",
                })
            )
            return {
                "issue_id": issue_id,
                "blocked": False,
                "blockers": blockers,
                "decision": "dispatch",
            }

        # Some blockers are still active -> post comments and skip
        for blocker in unresolved:
            _post_blocked_comment(client, issue_id, blocker)

        logger.warning(
            json.dumps({
                "event": "dependency_resolve.blocked",
                "issue_id": issue_id,
                "unresolved_blockers": [
                    {"id": b["id"], "status": b["status"]}
                    for b in unresolved
                ],
                "decision": "skip",
            })
        )

        return {
            "issue_id": issue_id,
            "blocked": True,
            "blockers": unresolved,
            "decision": "skip",
        }

    except Exception as exc:
        # Fail-open: if we can't check dependencies, dispatch anyway
        logger.warning(
            json.dumps({
                "event": "dependency_resolve.error",
                "issue_id": issue_id,
                "error": str(exc),
                "decision": "dispatch",
            }),
            exc_info=True,
        )
        return {
            "issue_id": issue_id,
            "blocked": False,
            "blockers": [],
            "decision": "dispatch",
        }


def _post_blocked_comment(
    client: LinearClient,
    issue_id: str,
    blocker: dict[str, Any],
) -> None:
    """
    Post a "Blocked by" comment on the issue for the given blocker.

    Failures are logged but not propagated -- a comment failure must
    never change the skip/dispatch decision.
    """
    try:
        comment = f"Blocked by {blocker['id']} ({blocker['status']})"
        client.post_comment(issue_id, comment)
    except Exception as exc:
        logger.warning(
            "Failed to post blocked-by comment for blocker %s: %s",
            blocker.get("id", "unknown"),
            exc,
        )
