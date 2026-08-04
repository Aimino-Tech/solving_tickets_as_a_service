"""
Linear issue state machine -- maps pipeline states to Linear workflow states.

Each pipeline task returns a ``next_state`` string that is used to transition
the Linear issue.  On failure, the issue is moved to a ``Rework`` state
(if available on the team) or back to ``Todo``.

Usage::

    from workers.tracker.state_machine import resolve_state, STATUS_MAP

    next_state = resolve_state(
        current_state="In Progress", task_outcome="success",
    )
    # Returns "Human Review"

    next_state = resolve_state(
        current_state="Agent Working", task_outcome="failure",
    )
    # Returns "Rework"
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Status transition map
#
# Key = current Linear state name, Value = next state on success.
# The state machine follows the SYNTARO pipeline lifecycle:
#
#   Backlog -> Todo -> In Progress -> Agent Working -> Human Review -> Done
#                                                    | (failure)
#                                                Rework -> In Progress
# ---------------------------------------------------------------------------

STATUS_MAP: dict[str, str] = {
    # Initial pipeline
    "Backlog": "Todo",
    "Todo": "In Progress",
    "In Progress": "Agent Working",
    "Agent Working": "Human Review",
    "Human Review": "Done",
    # Rework cycle
    "Rework": "In Progress",
    # Already-terminal states stay put
    "Done": "Done",
    "Canceled": "Canceled",
}

# The state to transition to when a task fails.
FAILURE_STATE = "Rework"

# States considered "active" (polled by the beat task).
ACTIVE_POLL_STATES = [
    "Todo",
    "In Progress",
    "Agent Working",
    "Human Review",
    "Rework",
]


def resolve_state(
    current_state: str,
    task_outcome: str = "success",
) -> str | None:
    """
    Determine the next Linear state given *current_state* and *task_outcome*.

    Parameters
    ----------
    current_state:
        The name of the issue's current workflow state.
    task_outcome:
        Either ``"success"`` (default) or ``"failure"``.

    Returns
    -------
    The target state name, or ``None`` if the transition is unknown or the
    state is already terminal.
    """
    normalized = _normalize(current_state)

    if task_outcome == "failure":
        # If already in a terminal / unknown state, stay put
        if normalized in ("done", "canceled"):
            logger.info(
                "Issue is in terminal state %s -- not transitioning on failure",
                current_state,
            )
            return None
        return FAILURE_STATE

    # Success path
    if normalized in ("done", "canceled"):
        return None

    next_state = STATUS_MAP.get(normalized)
    if next_state is None:
        logger.warning(
            "Unknown current state %r -- no transition defined",
            current_state,
        )
        return None

    logger.debug(
        "State transition: %s -> %s (outcome=%s)",
        current_state,
        next_state,
        task_outcome,
    )
    return next_state


def _normalize(state: str) -> str:
    """Remove leading/trailing whitespace for map lookup."""
    return state.strip()


def get_active_states() -> list[str]:
    """Return the list of states that should be polled for new work."""
    return list(ACTIVE_POLL_STATES)


def is_terminal(state: str) -> bool:
    """Return ``True`` if *state* is a terminal (end) state."""
    normalized = _normalize(state).lower()
    return normalized in ("done", "canceled")
