import logging
import os
import subprocess
from string import Template
from typing import Any

from celery import shared_task

from workers.github.client import GitHubClient
from workers.linear_client import LinearClient

logger = logging.getLogger(__name__)

_TEMPLATE_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..",
    "pr_creation",
    "template.md",
)


def _load_template() -> str:
    with open(_TEMPLATE_PATH) as f:
        return f.read()


def _extract_issue_number(issue_id: str) -> str:
    parts = issue_id.split("-", 1)
    return parts[-1] if len(parts) > 1 else issue_id


def _get_changed_files_summary(
    workspace_path: str,
    base_branch: str = "main",
) -> str:
    try:
        result = subprocess.run(
            ["git", "diff", "--stat", f"origin/{base_branch}..."],
            cwd=workspace_path,
            capture_output=True,
            text=True,
            check=True,
            timeout=30,
        )
        output = result.stdout.strip()
        return output if output else "No file changes detected."
    except (subprocess.CalledProcessError, FileNotFoundError, TimeoutError) as e:
        logger.warning("Failed to get changed files summary: %s", e)
        return "Could not generate file change summary."


def _build_pr_body(
    issue_body: str,
    issue_id: str,
    workspace_path: str,
    verification_result: dict[str, Any] | None,
    base_branch: str,
) -> str:
    template_str = _load_template()
    issue_number = _extract_issue_number(issue_id)
    changed_files = _get_changed_files_summary(workspace_path, base_branch)
    test_rate = "N/A"
    if verification_result:
        score = verification_result.get("score", 0) or 0
        test_rate = str(int(score * 100))
    template = Template(template_str)
    return template.safe_substitute(
        issue_description=issue_body or "No description provided.",
        issue_number=issue_number,
        changed_files_summary=changed_files,
        test_pass_rate=test_rate,
    )


@shared_task(
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    name="workers.tasks.pr_creation.create_pull_request",
    autoretry_for=(Exception,),
)
def create_pull_request(
    self,
    issue_id: str,
    workspace_path: str,
    issue_title: str,
    issue_body: str,
    repo_owner: str,
    repo_name: str,
    branch_name: str,
    base_branch: str = "main",
    verification_result: dict[str, Any] | None = None,
    audit_result: dict[str, Any] | None = None,
    labels: list[str] | None = None,
    installation_id: int | None = None,
) -> dict[str, Any]:
    logger.info(
        "Creating PR — %s/%s %s->%s for issue %s",
        repo_owner,
        repo_name,
        branch_name,
        base_branch,
        issue_id,
    )

    try:
        gh = GitHubClient(installation_id=installation_id)

        try:
            gh.push_branch(workspace_path, branch_name)
        except subprocess.CalledProcessError as exc:
            logger.warning("Branch push failed (may already exist): %s", exc)

        repo_full = f"{repo_owner}/{repo_name}"
        existing_pr = gh.find_existing_pr(repo_full, branch_name)

        if existing_pr:
            logger.info(
                "PR already exists for branch %s — #%s, updating",
                branch_name,
                existing_pr["pr_number"],
            )
            pr_body = _build_pr_body(
                issue_body,
                issue_id,
                workspace_path,
                verification_result,
                base_branch,
            )
            result = gh.update_pr(
                repo_full,
                existing_pr["pr_number"],
                title=f"[STAS] {issue_title}",
                body=pr_body,
            )
            mergeable_info = gh.check_mergeable(
                repo_full,
                existing_pr["pr_number"],
            )
            result.update(mergeable_info)
            result["branch"] = branch_name
            result["base_branch"] = base_branch
        else:
            pr_body = _build_pr_body(
                issue_body,
                issue_id,
                workspace_path,
                verification_result,
                base_branch,
            )
            result = gh.create_pr(
                repo_full,
                branch_name,
                base_branch,
                f"[STAS] {issue_title}",
                pr_body,
                labels=labels,
            )
            mergeable_info = gh.check_mergeable(
                repo_full,
                result["pr_number"],
            )
            result.update(mergeable_info)
            result["branch"] = branch_name
            result["base_branch"] = base_branch

        try:
            linear = LinearClient()
            score_str = ""
            if verification_result:
                score = verification_result.get("score", 0) or 0
                score_str = f"Test score: {score * 100:.0f}%"
            parts = [f"PR created: {result['pr_url']}", f"Branch: `{branch_name}`"]
            if score_str:
                parts.append(score_str)
            comment_text = "\n\n".join(parts)
            comment = linear.post_comment(issue_id, comment_text)
            result["linear_comment_id"] = comment["id"]
        except ValueError as e:
            logger.warning("Linear integration skipped (no API key): %s", e)
            result["linear_comment_id"] = None
        except Exception as e:
            logger.warning("Failed to post Linear comment: %s", e)
            result["linear_comment_id"] = None

        return result

    except Exception as exc:
        logger.error("PR creation failed — %s", exc, exc_info=True)
        raise self.retry(exc=exc)
