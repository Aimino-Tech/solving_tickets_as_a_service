import json
import logging
import os
import time
import uuid

from celery import shared_task
from celery.result import AsyncResult

logger = logging.getLogger(__name__)

OPENCODE_BIN = os.getenv("OPENCODE_BIN", "/home/xdn/.opencode/bin/opencode")
SESSION_TIMEOUT = int(os.getenv("AGENT_SESSION_TIMEOUT", "300"))
MAX_RETRIES = int(os.getenv("AGENT_SESSION_MAX_RETRIES", "3"))
RETRY_DELAY = int(os.getenv("AGENT_SESSION_RETRY_DELAY", "10"))


@shared_task(
    bind=True,
    max_retries=MAX_RETRIES,
    default_retry_delay=RETRY_DELAY,
    autoretry_for=(Exception,),
    name="workers.tasks.agent_session.execute_agent_session",
    soft_time_limit=SESSION_TIMEOUT,
    hard_time_limit=SESSION_TIMEOUT + 60,
)
def execute_agent_session(
    self,
    session_id: str,
    config: dict | None = None,
    prompt: str = "",
) -> dict:
    logger.info(
        "Executing agent session — session_id=%s prompt_len=%d",
        session_id,
        len(prompt),
    )

    config = config or {}
    model = config.get("model", os.getenv("OPENCODE_MODEL", "deepseek-v4-flash"))
    max_iterations = config.get("max_iterations", 40)
    workspace = config.get("workspace", "")
    repo_url = config.get("repo_url", "")

    try:
        self.update_state(
            state="RUNNING",
            meta={
                "session_id": session_id,
                "status": "running",
                "progress": 0.0,
                "output": "",
                "timestamp": time.time(),
            },
        )
    except Exception as exc:
        logger.warning("Failed to update state to RUNNING — %s", exc)

    cmd_parts = [
        OPENCODE_BIN,
        "run",
        prompt,
        "--model", model,
        "--max-iterations", str(max_iterations),
        "--json",
    ]
    if workspace:
        cmd_parts.extend(["--workspace", workspace])
    if repo_url:
        cmd_parts.extend(["--repo", repo_url])

    import subprocess

    try:
        logger.info("Running: %s", " ".join(cmd_parts))

        process = subprocess.Popen(
            cmd_parts,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []

        for line in iter(process.stdout.readline, ""):
            stdout_lines.append(line)
            try:
                progress_data = json.loads(line.strip())
                if isinstance(progress_data, dict) and "progress" in progress_data:
                    self.update_state(
                        state="PROGRESS",
                        meta={
                            "session_id": session_id,
                            "status": "running",
                            "progress": progress_data.get("progress", 0.0),
                            "output": json.dumps(progress_data),
                            "timestamp": time.time(),
                        },
                    )
            except (json.JSONDecodeError, ValueError):
                pass

        process.wait(timeout=SESSION_TIMEOUT)
        stdout = "".join(stdout_lines)
        stderr = "".join(stderr_lines)

        if process.returncode != 0:
            error_msg = stderr[:2000] if stderr else f"Exit code {process.returncode}"
            logger.error(
                "Agent session failed — session_id=%s rc=%d error=%s",
                session_id,
                process.returncode,
                error_msg,
            )
            raise self.retry(exc=RuntimeError(error_msg))

        logger.info(
            "Agent session completed — session_id=%s stdout_len=%d",
            session_id,
            len(stdout),
        )

        result_payload = {
            "session_id": session_id,
            "status": "completed",
            "output": stdout[:50000],
            "stderr": stderr[:10000],
            "timestamp": time.time(),
        }

        try:
            self.update_state(
                state="SUCCESS",
                meta={
                    "session_id": session_id,
                    "status": "completed",
                    "progress": 1.0,
                    "output": stdout[:50000],
                    "timestamp": time.time(),
                },
            )
        except Exception as exc:
            logger.warning("Failed to update final state — %s", exc)

        return result_payload

    except subprocess.TimeoutExpired:
        logger.error("Agent session timed out — session_id=%s", session_id)
        raise self.retry(exc=TimeoutError(f"Agent session {session_id} timed out"))

    except FileNotFoundError:
        logger.error(
            "OpenCode binary not found at %s — session_id=%s",
            OPENCODE_BIN,
            session_id,
        )
        raise self.retry(exc=FileNotFoundError(
            f"OpenCode not found at {OPENCODE_BIN}"
        ))

    except Exception as exc:
        logger.error(
            "Agent session failed unexpectedly — session_id=%s error=%s",
            session_id,
            exc,
        )
        raise self.retry(exc=exc)
