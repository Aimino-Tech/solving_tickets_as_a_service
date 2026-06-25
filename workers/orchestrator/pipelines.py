from celery import chain

PIPELINES = {
    "stas:fix": {
        "label": "stas:fix",
        "description": "Default fix pipeline: triage -> agent -> verify -> audit -> review -> pr",
        "stages": [
            "quality_analyze",
            "agent_dispatch",
            "verification",
            "self_audit",
            "anti_mockup_scan",
            "review",
            "pr_creation",
        ],
        "max_attempts": 3,
        "concurrency_limit": 3,
    },
    "stas:feature": {
        "label": "stas:feature",
        "description": "Feature pipeline: triage -> agent -> verify -> audit -> review -> pr",
        "stages": [
            "quality_analyze",
            "agent_dispatch",
            "verification",
            "self_audit",
            "anti_mockup_scan",
            "review",
            "pr_creation",
        ],
        "max_attempts": 3,
        "concurrency_limit": 3,
    },
    "stas:research": {
        "label": "stas:research",
        "description": "Research pipeline: agent -> report (no verification/audit)",
        "stages": [
            "agent_dispatch",
        ],
        "max_attempts": 1,
        "concurrency_limit": 5,
    },
}

TASK_MAP = {
    "quality_analyze": "workers.quality.analyzer.quality_analyze",
    "agent_dispatch": "workers.tasks.agent.dispatch_opencode",
    "verification": "workers.tasks.verification.run_verification",
    "self_audit": "workers.tasks.self_audit.run_self_audit",
    "anti_mockup_scan": "workers.quality.anti_mockup_scan.anti_mockup_scan",
    "review": "workers.tasks.self_audit.review_decision",
    "pr_creation": "workers.tasks.pr_creation.create_pull_request",
}


def get_pipeline(label: str) -> dict | None:
    return PIPELINES.get(label)


def get_task_name(stage: str) -> str | None:
    return TASK_MAP.get(stage)


def build_canvas(pipeline_cfg: dict, ctx: dict):
    stages = pipeline_cfg["stages"]
    task_list = []
    for stage in stages:
        task_name = get_task_name(stage)
        if task_name:
            from celery import signature
            task_list.append(signature(task_name, kwargs=ctx))
    return chain(*task_list)
