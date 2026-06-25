from typing import Any

PIPELINES: dict[str, list[str]] = {
    "stas:fix": [
        "triage",
        "agent",
        "verify",
        "self_audit",
        "adversarial_review",
        "review",
        "pr",
    ],
    "stas:feature": [
        "triage",
        "agent",
        "verify",
        "self_audit",
        "adversarial_review",
        "review",
        "pr",
    ],
    "stas:research": [
        "agent",
    ],
}

STAGE_TASKS: dict[str, str] = {
    "triage": "workers.tasks.linear_poll.triage",
    "agent": "workers.tasks.agent.dispatch_opencode",
    "verify": "workers.tasks.verification.run_verification",
    "self_audit": "workers.tasks.self_audit.run_self_audit",
    "adversarial_review": "workers.tasks.adversarial_review.full_adversarial_review",
    "review": "workers.tasks.self_audit.review_decision",
    "pr": "workers.tasks.pr_creation.create_pull_request",
}


def get_pipeline(name: str) -> list[str]:
    return PIPELINES.get(name, PIPELINES["stas:fix"])


def get_stage_task(stage: str) -> str:
    return STAGE_TASKS.get(stage, stage)
