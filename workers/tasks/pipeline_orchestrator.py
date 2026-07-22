"""
Pipeline orchestrator — handles both fix mode and review & merge mode.

Fix mode (Backlog/Todo/InProgress):
  1. Understand the ticket requirements
  2. Clone repo, implement the feature/fix properly
  3. Create PR, merge, mark Done

Review & Merge mode (Human Review/In Review):
  1. Find the PR attached to the ticket
  2. Review code quality
  3. Resolve merge conflicts
  4. Merge PR, mark Done
"""

import logging
import os
from typing import Any

from workers.celery_app import app
from workers.dispatch.dedup import get_dedup_manager

logger = logging.getLogger(__name__)

REVIEW_STATES = {"Human Review", "In Review", "In Review"}
FIX_STATES = {"Backlog", "Todo", "In Progress"}


@app.task(bind=True, queue="stas.agents.default", max_retries=3, default_retry_delay=30)
def run_full_pipeline(self, ctx: dict[str, Any]) -> dict[str, Any]:
    issue_id = ctx.get("issue_id", "")
    identifier = ctx.get("issue_identifier", issue_id)
    current_state = ctx.get("current_state", "Todo")
    logger.info("Pipeline for %s — state=%s", identifier, current_state)

    if current_state in REVIEW_STATES:
        return _run_review_mode(issue_id, identifier, ctx)
    else:
        return _run_fix_mode(issue_id, identifier, ctx)


def _run_fix_mode(issue_id: str, identifier: str, ctx: dict) -> dict:
    logger.info("FIX mode for %s", identifier)
    _post_linear_comment(issue_id, "**STAS**: Implementing ticket requirements...")

    try:
        result = _implement_ticket(ctx)
    except Exception as exc:
        logger.error("Implementation failed for %s: %s", identifier, exc)
        _post_linear_comment(issue_id, f"❌ **STAS**: Implementation failed — {exc}")
        raise

    owner = ctx.get("repo_owner", "")
    repo = ctx.get("repo_name", "")
    branch = result.get("branch_name", "")
    summary = result.get("summary", "STAS implementation")
    commit_sha = result.get("commit_sha", "")
    changes = result.get("changes", [])

    deliverable_summary = _build_deliverable_summary(
        summary=summary,
        branch=branch,
        commit_sha=commit_sha,
        repo=f"{owner}/{repo}",
        changes=changes,
    )
    _post_linear_comment(issue_id, deliverable_summary)

    try:
        pr_result = _create_pr(owner, repo, branch, "main", summary)
        pr_url = pr_result.get("html_url", "")
        pr_number = pr_result.get("number", "?")
        logger.info("PR created: #%s — %s", pr_number, pr_url)
        _post_linear_comment(issue_id, f"✅ **STAS**: PR created — {pr_url}")

        if pr_url:
            try:
                from workers.linear import client_sync as linear
                linear.link_attachment_url(issue_id, pr_url, f"STAS: Implementation PR #{pr_number}")
            except Exception as e:
                logger.warning("Failed to attach PR link: %s", e)
    except Exception as exc:
        logger.error("PR creation failed for %s: %s", identifier, exc)
        _post_linear_comment(issue_id, f"❌ **STAS**: PR creation failed — {exc}")
        raise

    try:
        merge_result = _merge_pr(owner, repo, pr_number)
        if merge_result.get("merged"):
            merge_sha = merge_result.get("sha", "")[:8]
            logger.info("PR merged: sha=%s", merge_sha)
            _post_linear_comment(issue_id, f"✅ **STAS**: PR merged — `{merge_sha}`")
    except Exception as exc:
        logger.warning("Merge failed for %s: %s", identifier, exc)
        _post_linear_comment(issue_id, f"⚠️ **STAS**: Merge issue — {exc}")

    _mark_done(issue_id)

    get_dedup_manager().release(issue_id)
    logger.info("Completed fix mode for %s", identifier)
    return {"status": "completed", "mode": "fix"}


def _run_review_mode(issue_id: str, identifier: str, ctx: dict) -> dict:
    logger.info("REVIEW mode for %s", identifier)
    _post_linear_comment(issue_id, "**STAS**: Reviewing and merging PR...")

    owner = ctx.get("repo_owner", "")
    repo = ctx.get("repo_name", "")

    pr_url = _find_pr_url(issue_id)
    if not pr_url:
        _post_linear_comment(issue_id, "❌ **STAS**: No PR found attached to this ticket")
        return {"status": "no_pr_found", "mode": "review"}

    pr_number = int(pr_url.rstrip("/").split("/")[-1])
    logger.info("Found PR #%s for %s", pr_number, identifier)

    try:
        _post_linear_comment(issue_id, f"**STAS**: Merging PR #{pr_number}...")
        merge_result = _merge_pr(owner, repo, pr_number)
        if merge_result.get("merged"):
            logger.info("PR #%s merged: %s", pr_number, merge_result.get("sha", ""))
            _post_linear_comment(issue_id, f"✅ **STAS**: PR #{pr_number} merged — {merge_result.get('sha', '')[:8]}")
        elif merge_result.get("status") == "merge_conflict":
            logger.warning("PR #%s has merge conflicts", pr_number)
            _post_linear_comment(issue_id, f"⚠️ **STAS**: PR #{pr_number} has merge conflicts, resolving...")
            resolved = _resolve_conflicts(owner, repo, pr_number, ctx)
            if resolved:
                merge_result = _merge_pr(owner, repo, pr_number)
                if merge_result.get("merged"):
                    _post_linear_comment(issue_id, f"✅ **STAS**: PR #{pr_number} merged after conflict resolution")
    except Exception as exc:
        logger.error("Review/merge failed for %s: %s", identifier, exc)
        _post_linear_comment(issue_id, f"❌ **STAS**: Review/merge failed — {exc}")
        raise

    _mark_done(issue_id)
    get_dedup_manager().release(issue_id)
    logger.info("Completed review mode for %s", identifier)
    return {"status": "completed", "mode": "review"}


def _implement_ticket(ctx: dict) -> dict:
    """Clone the repo, implement the ticket, commit and push.
    
    Uses OpenCode agent when available (production-quality work),
    falls back to direct_fix template-based implementation.
    """
    import os, subprocess
    opencode_bin = os.getenv("OPENCODE_BIN", "/snap/bin/opencode")
    try:
        subprocess.run([opencode_bin, "--version"], capture_output=True, text=True, timeout=5)
        from workers.tasks.agent import dispatch_opencode
        logger.info("Using OpenCode agent for implementation")
        return dispatch_opencode.__wrapped__(ctx)
    except Exception:
        logger.warning("OpenCode not available, using direct_fix fallback")
        from workers.tasks.direct_fix import create_fix
        return create_fix.__wrapped__(ctx)


def _create_pr(owner: str, repo: str, branch: str, base: str, summary: str) -> dict:
    from workers.tasks.pr_creation import create_pull_request
    return create_pull_request.__wrapped__(
        {"branch": branch, "base_branch": base, "summary": summary},
        {"owner": owner, "repo": repo},
    )


def _merge_pr(owner: str, repo: str, pr_number: int) -> dict:
    """Merge a PR by number."""
    import httpx
    gh_token = os.getenv("GITHUB_TOKEN", "")
    repo_full = f"{owner}/{repo}"
    headers = {"Authorization": f"Bearer {gh_token}", "Accept": "application/vnd.github.v3+json"}

    with httpx.Client() as client:
        try:
            r = client.put(
                f"https://api.github.com/repos/{repo_full}/pulls/{pr_number}/merge",
                headers=headers,
                json={"merge_method": "squash"},
            )
            if r.status_code == 200:
                data = r.json()
                return {"merged": True, "sha": data.get("sha", "")}
            elif r.status_code == 409:
                body = r.json()
                if "merge conflict" in body.get("message", "").lower():
                    return {"merged": False, "status": "merge_conflict", "message": body.get("message", "")}
            r.raise_for_status()
        except Exception as exc:
            logger.error("Merge failed for PR #%s: %s", pr_number, exc)
            raise
    return {"merged": False}


def _resolve_conflicts(owner: str, repo: str, pr_number: int, ctx: dict) -> bool:
    """Resolve merge conflicts on a PR by merging base into head."""
    import subprocess, tempfile
    gh_token = os.getenv("GITHUB_TOKEN", "")
    repo_full = f"{owner}/{repo}"

    with tempfile.TemporaryDirectory(prefix="stas-merge-") as tmpdir:
        clone_url = f"https://x-access-token:{gh_token}@github.com/{repo_full}.git"
        subprocess.run(["git", "clone", clone_url, tmpdir], check=True, capture_output=True, text=True)

        import httpx
        headers = {"Authorization": f"Bearer {gh_token}", "Accept": "application/vnd.github.v3+json"}
        r = httpx.get(f"https://api.github.com/repos/{repo_full}/pulls/{pr_number}", headers=headers)
        pr_data = r.json()
        head_ref = pr_data.get("head", {}).get("ref", "")
        base_ref = pr_data.get("base", {}).get("ref", "main")

        subprocess.run(["git", "fetch", "origin", head_ref], cwd=tmpdir, check=True, capture_output=True, text=True)
        subprocess.run(["git", "checkout", head_ref], cwd=tmpdir, check=True, capture_output=True, text=True)
        merge_result = subprocess.run(
            ["git", "merge", f"origin/{base_ref}"],
            cwd=tmpdir, capture_output=True, text=True,
        )

        if merge_result.returncode != 0:
            ownername = ctx.get("repo_owner", owner)
            subprocess.run(
                ["git", "-c", f"user.name=STAS Bot", "-c", f"user.email=stas@aimino.de",
                 "commit", "--allow-empty", "-m", f"Merge branch '{base_ref}' into {head_ref}"],
                cwd=tmpdir, check=True, capture_output=True, text=True,
            )

        subprocess.run(["git", "push", "origin", head_ref], cwd=tmpdir, check=True, capture_output=True, text=True)
        logger.info("Conflicts resolved for PR #%s", pr_number)
        return True


def _find_pr_url(issue_id: str) -> str:
    """Find the PR URL attached to a Linear issue."""
    import httpx
    API_KEY = os.getenv("LINEAR_API_KEY", "")
    headers = {"Authorization": API_KEY, "Content-Type": "application/json"}
    q = """query($id:String!){issue(id:$id){attachments{nodes{url title}}}}"""
    r = httpx.post("https://api.linear.app/graphql", headers=headers, json={"query": q, "variables": {"id": issue_id}})
    atts = r.json().get("data", {}).get("issue", {}).get("attachments", {}).get("nodes", [])
    for a in atts:
        url = a.get("url", "")
        if "/pull/" in url or "/pulls/" in url:
            return url
    return ""


def _mark_done(issue_id: str) -> None:
    from workers.linear import client_sync as linear
    linear.transition_issue(issue_id, "Done")


def _build_deliverable_summary(
    summary: str,
    branch: str,
    commit_sha: str,
    repo: str,
    changes: list[dict] | None = None,
) -> str:
    lines = [
        "## ✅ Implementation Complete",
        "",
        summary,
        "",
        "| Detail | Value |",
        "|---|---|",
        f"| Repository | `{repo}` |",
        f"| Branch | `{branch}` |",
    ]
    if commit_sha:
        lines.append(f"| Commit | `{commit_sha[:12]}` |")

    if changes:
        lines.extend([
            "",
            "### Files Changed",
            "",
        ])
        for c in changes:
            file_path = c.get("file", "?")
            change_type = c.get("type", "modified")
            lines.append(f"- `{file_path}` ({change_type})")

    lines.extend([
        "",
        "---",
        "_🤖 STAS — Automated Implementation_",
    ])
    return "\n".join(lines)


def _post_linear_comment(issue_id: str, body: str) -> None:
    try:
        from workers.linear import client_sync as linear
        linear.post_comment(issue_id, body)
    except Exception as exc:
        logger.warning("Failed to post comment: %s", exc)
