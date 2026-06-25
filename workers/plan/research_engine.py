"""
Research engine --- search the codebase and web.
"""

from __future__ import annotations

import logging
import os
import subprocess
import urllib.parse
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_MAX_RESULTS = 20
DEFAULT_WEB_TIMEOUT = 10.0
DEFAULT_WEB_SEARCH_URL_TEMPLATE = (
    "https://api.duckduckgo.com/?q={query}&format=json&no_html=1&skip_disambig=1"
)
USER_AGENT = "STAS-ResearchEngine/1.0"
CONTEXT_LINES = 2


def search_codebase(
    query: str,
    repo_path: str | None = None,
    max_results: int = DEFAULT_MAX_RESULTS,
    include_content: bool = True,
) -> list[dict[str, Any]]:
    if repo_path is None:
        repo_path = os.getcwd()
    repo_path = os.path.abspath(repo_path)
    if not os.path.isdir(repo_path):
        logger.warning("search_codebase: %s is not a directory", repo_path)
        return []

    use_git = _is_git_repo(repo_path)
    try:
        if use_git:
            raw = _run_git_grep(query, repo_path, max_results)
        else:
            raw = _run_fallback_grep(query, repo_path, max_results)
    except (subprocess.CalledProcessError, OSError) as exc:
        logger.exception("search_codebase failed: %s", exc)
        return []

    results: list[dict[str, Any]] = []
    for filepath, line_num, text in raw:
        abs_filepath = filepath if os.path.isabs(filepath) else os.path.join(repo_path, filepath)
        result: dict[str, Any] = {
            "file": os.path.relpath(abs_filepath, repo_path),
            "line": line_num,
        }
        if include_content:
            result["content"] = text
            result["context"] = _extract_context(filepath, line_num, repo_path)
        results.append(result)
    return results


def search_web(
    query: str,
    max_results: int = 5,
    timeout: float = DEFAULT_WEB_TIMEOUT,
) -> list[dict[str, Any]]:
    url_template = os.getenv("STAS_WEB_SEARCH_URL", DEFAULT_WEB_SEARCH_URL_TEMPLATE)
    url = url_template.format(query=urllib.parse.quote_plus(query))
    headers = {"User-Agent": USER_AGENT}
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("search_web request failed: %s", exc)
        return []

    results: list[dict[str, Any]] = []
    abstract = data.get("AbstractText")
    if abstract:
        results.append({
            "title": data.get("Heading", "Abstract"),
            "url": data.get("AbstractURL", ""),
            "snippet": abstract,
        })
    for topic in data.get("RelatedTopics", []):
        if len(results) >= max_results:
            break
        if "Text" in topic:
            results.append({
                "title": topic.get("Text", "").split(" - ")[0],
                "url": topic.get("FirstURL", ""),
                "snippet": topic.get("Text", ""),
            })
    return results[:max_results]


def _is_git_repo(path: str) -> bool:
    try:
        result = subprocess.run(
            ["git", "-C", path, "rev-parse", "--is-inside-work-tree"],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


def _run_git_grep(query: str, repo_path: str, max_results: int) -> list[tuple[str, int, str]]:
    result = subprocess.run(
        ["git", "-C", repo_path, "grep", "-n", "--", query],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode not in (0, 1):
        raise subprocess.CalledProcessError(result.returncode, result.args, output=result.stdout, stderr=result.stderr)
    raw: list[tuple[str, int, str]] = []
    for line in result.stdout.splitlines():
        if len(raw) >= max_results:
            break
        try:
            filepath, rest = line.split(":", 1)
            line_str, text = rest.split(":", 1)
            raw.append((filepath, int(line_str), text))
        except ValueError:
            continue
    return raw


def _run_fallback_grep(query: str, repo_path: str, max_results: int) -> list[tuple[str, int, str]]:
    result = subprocess.run(
        ["grep", "-rn", "--", query, repo_path],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode not in (0, 1, 2):
        raise subprocess.CalledProcessError(result.returncode, result.args, output=result.stdout, stderr=result.stderr)
    raw: list[tuple[str, int, str]] = []
    for line in result.stdout.splitlines():
        if len(raw) >= max_results:
            break
        try:
            filepath, rest = line.split(":", 1)
            line_str, text = rest.split(":", 1)
            raw.append((filepath, int(line_str), text))
        except ValueError:
            continue
    return raw


def _extract_context(filepath: str, line_num: int, repo_path: str) -> str | None:
    full_path = (
        os.path.join(repo_path, filepath) if not os.path.isabs(filepath) else filepath
    )
    try:
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError:
        return None
    start = max(0, line_num - 1 - CONTEXT_LINES)
    end = min(len(lines), line_num + CONTEXT_LINES)
    return "".join(lines[start:end]).rstrip("\n")
