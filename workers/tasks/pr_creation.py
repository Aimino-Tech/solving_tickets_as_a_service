import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=30,
    name="workers.tasks.pr_creation.create_pull_request",
)
def create_pull_request(self, fix_result: dict, repo_info: dict) -> dict:
    logger.info(
        "Creating PR — repo=%s/%s branch=%s",
        repo_info.get("owner", "?"),
        repo_info.get("repo", "?"),
        fix_result.get("branch", "?"),
    )
    try:
        # TODO: Use GitHub API to create a PR when integration is live
        logger.info("PR creation placeholder — would create PR now")
        return {
            "repo_info": repo_info,
            "fix_result": fix_result,
            "pr_url": None,
            "status": "placeholder",
        }
    except Exception as exc:
        logger.error("PR creation failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
