import json
import logging
import os
import subprocess
import tempfile

from celery import shared_task

logger = logging.getLogger(__name__)

OPENCODE_BIN = os.getenv("OPENCODE_BIN", "/snap/bin/opencode")
OPENCODE_MODEL = os.getenv("OPENCODE_MODEL", "opencode-go/deepseek-v4-flash")


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=120,
    name="workers.tasks.agent.dispatch_opencode",
    autoretry_for=(subprocess.TimeoutExpired,),
    soft_time_limit=1200,
    time_limit=1800,
)
def dispatch_opencode(self, ctx: dict) -> dict:
    """
    Dispatch a fix implementation to OpenCode CLI.

    Clones the repo, runs opencode with a prompt based on the ticket,
    lets the agent implement, and pushes a branch with the changes.

    Context (ctx) expects:
        - repo_owner, repo_name: target repo
        - issue_title, issue_description: the ticket
        - repo_branch: base branch (default: main)
    """
    owner = ctx.get("repo_owner", "")
    repo = ctx.get("repo_name", "")
    branch = ctx.get("repo_branch", "main")
    title = ctx.get("issue_title", "")
    desc = ctx.get("issue_description", "")
    issue_id = ctx.get("issue_identifier", "unknown")

    if not owner or not repo:
        raise ValueError(f"Missing repo_owner/repo_name in ctx")

    repo_full = f"{owner}/{repo}"
    branch_name = f"stas/fix-{issue_id.lower().replace('_', '-')[:40]}"

    logger.info("OpenCode implementing %s — repo=%s model=%s", issue_id, repo_full, OPENCODE_MODEL)

    prompt = (
        f"Implement the following ticket in the {repo_full} repository.\n\n"
        f"Ticket: {issue_id}\n"
        f"Title: {title}\n"
        f"Description: {desc}\n\n"
        f"Instructions:\n"
        f"1. Clone the repo and understand the codebase\n"
        f"2. Read existing source files to understand the project's patterns and conventions\n"
        f"3. Follow existing patterns exactly (file naming, module exports, type definitions)\n"
        f"4. Implement the ticket requirements in production quality\n"
        f"5. If the ticket asks for tests: create individual test files per module, not monolithic files\n"
        f"6. Wire new code into existing module exports (index.ts files)\n"
        f"7. Push the branch to origin/{branch_name}\n"
        f"8. Tell me the commit SHA and branch name when done"
    )

    with tempfile.TemporaryDirectory(prefix="stas-opencode-") as tmpdir:
        clone_url = f"https://x-access-token:{os.environ['GH_TOKEN']}@github.com/{repo_full}.git"
        subprocess.run(["git", "clone", clone_url, tmpdir], check=True, capture_output=True, text=True, cwd="/tmp")
        subprocess.run(["git", "checkout", "-b", branch_name], check=True, capture_output=True, text=True, cwd=tmpdir)

        cmd = [
            OPENCODE_BIN, "run", prompt,
            "--model", OPENCODE_MODEL,
            "--print-logs",
        ]
        logger.info("Running OpenCode: %s", " ".join(cmd))

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=int(os.getenv("OPENCODE_TIMEOUT", "600")),
                cwd=tmpdir,
            )
        except subprocess.TimeoutExpired:
            logger.error("OpenCode timed out after %ss", os.getenv("OPENCODE_TIMEOUT", "600"))
            raise

        stdout = result.stdout or ""
        stderr = result.stderr or ""

        if result.returncode != 0:
            logger.error("OpenCode failed (rc=%d): %s", result.returncode, stderr[:500])
            raise RuntimeError(f"OpenCode exited {result.returncode}")

        subprocess.run(["git", "push", "--force", "origin", branch_name], check=True, capture_output=True, text=True, cwd=tmpdir)
        sha_result = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True, cwd=tmpdir)
        commit_sha = sha_result.stdout.strip()

        logger.info("OpenCode implemented %s — branch=%s sha=%s", issue_id, branch_name, commit_sha)

    return {
        "repo_owner": owner,
        "repo_name": repo,
        "repo_full_name": repo_full,
        "branch_name": branch_name,
        "base_branch": branch,
        "commit_sha": commit_sha,
        "issue_id": issue_id,
        "issue_title": title,
        "summary": f"OpenCode implementation for {issue_id}: {title[:80]}",
    }
