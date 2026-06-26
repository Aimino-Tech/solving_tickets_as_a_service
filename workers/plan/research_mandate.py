"""
Research mandate --- pre-implementation search across GitHub and OSS.

Before an agent starts implementing a fix, this module gathers context from
external sources: similar GitHub issues / PRs, OSS library docs, and known
solutions. The resulting ``ResearchMandate`` is a structured artifact that
guides the implementation phase.

Usage::

    from workers.plan.research_mandate import execute_mandate, ResearchMandate

    mandate = execute_mandate(
        issue_title="Login crashes on plus sign in email",
        issue_body="The login endpoint returns 500 when email has + or &.",
        repo="owner/repo",
    )
    for src in mandate.sources:
        print(src.url, src.summary)
    print(mandate.summary)
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

GITHUB_API_BASE = "https://api.github.com"
GITHUB_API_TIMEOUT = 15.0
OSS_SEARCH_TIMEOUT = 10.0
MAX_GITHUB_RESULTS = 10
MAX_OSS_RESULTS = 6
USER_AGENT = "STAS-ResearchMandate/1.0"

SOURCE_KINDS = frozenset({
    "github_issue",
    "github_pr",
    "github_code",
    "oss_documentation",
    "oss_repo",
    "web_reference",
})

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class ResearchSource:
    """A single external source found during research.

    Attributes
    ----------
    kind
        One of ``SOURCE_KINDS``.
    url
        URL to the source.
    title
        Title / headline of the source.
    summary
        Short summary of what the source contains.
    relevance
        Relevance score between 0.0 and 1.0.
    """

    kind: str
    url: str
    title: str
    summary: str = ""
    relevance: float = 0.5

    def __post_init__(self) -> None:
        if self.kind not in SOURCE_KINDS:
            raise ValueError(
                f"Unknown source kind: {self.kind!r}. "
                f"Must be one of {sorted(SOURCE_KINDS)}"
            )
        self.relevance = max(0.0, min(1.0, self.relevance))

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "url": self.url,
            "title": self.title,
            "summary": self.summary[:300],
            "relevance": self.relevance,
        }


@dataclass
class ResearchMandate:
    """Aggregated pre-implementation research output.

    Attributes
    ----------
    issue_title
        The original issue title.
    sources
        All external sources gathered.
    summary
        Concise human-readable summary of findings.
    confidence
        Overall confidence in the research (0.0 to 1.0).
    created_at
        ISO-8601 timestamp of when the mandate was created.
    """

    issue_title: str
    sources: list[ResearchSource] = field(default_factory=list)
    summary: str = ""
    confidence: float = 0.0
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    @classmethod
    def empty(cls, issue_title: str = "") -> ResearchMandate:
        return cls(
            issue_title=issue_title,
            sources=[],
            summary="",
            confidence=0.0,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "issue_title": self.issue_title,
            "sources": [s.to_dict() for s in self.sources],
            "summary": self.summary,
            "confidence": self.confidence,
            "created_at": self.created_at,
            "source_count": len(self.sources),
        }


# ---------------------------------------------------------------------------
# Keyword extraction
# ---------------------------------------------------------------------------


def _extract_keywords(text: str) -> list[str]:
    """Extract meaningful search keywords from issue text."""
    combined = text.lower()
    tokens = re.split(r"[^a-z0-9_]+", combined)
    stop_words = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been",
        "being", "have", "has", "had", "do", "does", "did", "will",
        "would", "can", "could", "shall", "should", "may", "might",
        "must", "to", "of", "in", "for", "on", "with", "at", "by",
        "from", "as", "into", "through", "during", "before", "after",
        "above", "below", "between", "out", "off", "over", "under",
        "again", "further", "then", "once", "here", "there", "when",
        "where", "why", "how", "all", "each", "every", "both", "few",
        "more", "most", "other", "some", "such", "no", "nor", "not",
        "only", "own", "same", "so", "than", "too", "very", "just",
        "also", "and", "but", "or", "if", "because", "about", "up",
        "it", "its", "that", "this", "these", "those", "what", "which",
        "who", "whom", "i", "me", "my", "we", "our", "you", "your",
        "he", "him", "his", "she", "her", "they", "them", "their",
        "please", "fix", "bug", "error", "issue", "problem",
    }
    return [t for t in tokens if len(t) > 2 and t not in stop_words][:10]


def _build_search_queries(title: str, body: str) -> list[str]:
    """Build search queries from issue text."""
    text = f"{title} {body}"
    keywords = _extract_keywords(text)
    if not keywords:
        return []

    queries: list[str] = []

    # Primary: extract as terms
    primary = " ".join(keywords[:5])
    queries.append(primary)

    # Error-specific query
    if any(kw in text.lower() for kw in ("error", "exception", "fail", "crash", "broken")):
        queries.append(f"fix {' '.join(keywords[:4])}")
        queries.append(f"how to fix {' '.join(keywords[:3])}")

    # Library-specific query
    if any(kw in text.lower() for kw in ("python", "django", "flask", "fastapi", "pydantic")):
        queries.append(f"python {' '.join(keywords[:3])}")
    if any(kw in text.lower() for kw in ("typescript", "react", "node", "next")):
        queries.append(f"typescript {' '.join(keywords[:3])}")
    if any(kw in text.lower() for kw in ("go", "golang", "gin")):
        queries.append(f"golang {' '.join(keywords[:3])}")
    if any(kw in text.lower() for kw in ("rust", "cargo")):
        queries.append(f"rust {' '.join(keywords[:3])}")

    return queries


# ---------------------------------------------------------------------------
# GitHub search
# ---------------------------------------------------------------------------


def _get_github_token() -> str:
    """Return the GitHub token from environment, or empty string."""
    return os.getenv("GITHUB_TOKEN", "")


def _github_api_headers() -> dict[str, str]:
    """Build headers for GitHub API requests."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": USER_AGENT,
    }
    token = _get_github_token()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def search_github_issues(
    query: str,
    repo: str = "",
    max_results: int = MAX_GITHUB_RESULTS,
) -> list[ResearchSource]:
    """Search GitHub issues and pull requests matching *query*.

    Parameters
    ----------
    query
        Search terms.
    repo
        Optional ``owner/repo`` to scope the search.
    max_results
        Maximum results to return.

    Returns
    -------
    list[ResearchSource]
        Matching issues and PRs.
    """
    q = quote_plus(query)
    if repo:
        q += f"+repo:{quote_plus(repo)}"
    url = f"{GITHUB_API_BASE}/search/issues?q={q}&per_page={max_results}&sort=updated"

    headers = _github_api_headers()
    try:
        async with httpx.AsyncClient(timeout=GITHUB_API_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("GitHub issues search failed: %s", exc)
        return []

    sources: list[ResearchSource] = []
    for item in data.get("items", []):
        kind = "github_pr" if "/pull/" in item.get("html_url", "") else "github_issue"
        sources.append(ResearchSource(
            kind=kind,
            url=item.get("html_url", ""),
            title=item.get("title", ""),
            summary=item.get("body", "")[:200] if item.get("body") else "",
            relevance=0.6,
        ))

    return sources[:max_results]


async def search_github_code(
    query: str,
    repo: str = "",
    max_results: int = 5,
) -> list[ResearchSource]:
    """Search GitHub code matching *query*.

    Notes
    -----
    GitHub's code search API requires authentication. Returns an empty
    list when unauthenticated.
    """
    token = _get_github_token()
    if not token:
        logger.debug("GITHUB_TOKEN not set --- skipping code search")
        return []

    q = quote_plus(query)
    if repo:
        q += f"+repo:{quote_plus(repo)}"
    url = f"{GITHUB_API_BASE}/search/code?q={q}&per_page={max_results}"

    headers = _github_api_headers()
    try:
        async with httpx.AsyncClient(timeout=GITHUB_API_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("GitHub code search failed: %s", exc)
        return []

    sources: list[ResearchSource] = []
    for item in data.get("items", []):
        path = item.get("path", "")
        repo_name = item.get("repository", {}).get("full_name", "")
        sources.append(ResearchSource(
            kind="github_code",
            url=item.get("html_url", ""),
            title=path,
            summary=f"{repo_name}: {path}",
            relevance=0.5,
        ))

    return sources[:max_results]


# ---------------------------------------------------------------------------
# OSS / web search
# ---------------------------------------------------------------------------


async def search_oss_documentation(
    query: str,
    max_results: int = MAX_OSS_RESULTS,
) -> list[ResearchSource]:
    """Search OSS documentation and known reference sites.

    Uses a configurable search URL template (``STAS_OSS_SEARCH_URL`` env
    var, defaulting to a DuckDuckGo-based lookup for documentation sites).
    """
    url_template = os.getenv(
        "STAS_OSS_SEARCH_URL",
        "https://api.duckduckgo.com/?q={query}+documentation&format=json&no_html=1&skip_disambig=1",
    )
    url = url_template.format(query=quote_plus(query))

    try:
        async with httpx.AsyncClient(timeout=OSS_SEARCH_TIMEOUT) as client:
            resp = await client.get(url, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("OSS documentation search failed: %s", exc)
        return []

    sources: list[ResearchSource] = []
    seen_urls: set[str] = set()

    abstract = data.get("AbstractText", "")
    abstract_url = data.get("AbstractURL", "")
    if abstract and abstract_url:
        sources.append(ResearchSource(
            kind="oss_documentation",
            url=abstract_url,
            title=data.get("Heading", "Abstract"),
            summary=abstract[:200],
            relevance=0.7,
        ))
        seen_urls.add(abstract_url)

    for topic in data.get("RelatedTopics", []):
        if len(sources) >= max_results:
            break
        text = topic.get("Text", "")
        first_url = topic.get("FirstURL", "")
        if text and first_url and first_url not in seen_urls:
            sources.append(ResearchSource(
                kind="oss_documentation",
                url=first_url,
                title=text.split(" - ")[0][:150],
                summary=text[:200],
                relevance=0.5,
            ))
            seen_urls.add(first_url)

    return sources[:max_results]


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


async def execute_mandate_async(
    issue_title: str,
    issue_body: str,
    repo: str = "",
    include_code_search: bool = True,
    include_oss: bool = True,
) -> ResearchMandate:
    """Execute a pre-implementation research mandate (async).

    Parameters
    ----------
    issue_title
        Issue title.
    issue_body
        Issue body / description.
    repo
        Optional ``owner/repo`` to scope GitHub searches.
    include_code_search
        Whether to include GitHub code search (requires GITHUB_TOKEN).
    include_oss
        Whether to include OSS documentation search.

    Returns
    -------
    ResearchMandate
        Aggregated research findings.
    """
    if not issue_title and not issue_body:
        logger.warning("execute_mandate called with empty title and body")
        return ResearchMandate.empty()

    queries = _build_search_queries(issue_title, issue_body)
    if not queries:
        logger.info("No search queries could be built --- returning empty mandate")
        return ResearchMandate.empty()

    logger.info(
        "Executing research mandate --- title=%s repo=%s queries=%d",
        issue_title[:60], repo or "(none)", len(queries),
    )

    all_sources: list[ResearchSource] = []

    # GitHub issues search with primary query
    sources_issues = await search_github_issues(queries[0], repo=repo)
    all_sources.extend(sources_issues)

    # Additional queries for GitHub issues
    if len(queries) > 1:
        add_sources = await search_github_issues(queries[1], repo=repo)
        all_sources.extend(add_sources)

    # GitHub code search
    if include_code_search:
        code_sources = await search_github_code(queries[0], repo=repo)
        all_sources.extend(code_sources)

    # OSS documentation search
    if include_oss:
        oss_sources = await search_oss_documentation(queries[0])
        all_sources.extend(oss_sources)

    # Deduplicate by URL
    seen_urls: set[str] = set()
    unique_sources: list[ResearchSource] = []
    for src in all_sources:
        if src.url and src.url not in seen_urls:
            seen_urls.add(src.url)
            unique_sources.append(src)

    # Build summary
    by_kind: dict[str, list[ResearchSource]] = {}
    for src in unique_sources:
        by_kind.setdefault(src.kind, []).append(src)

    summary_parts: list[str] = []
    for kind, items in sorted(by_kind.items()):
        summary_parts.append(f"{len(items)} {kind}")
    summary = f"Found {len(unique_sources)} source(s): {', '.join(summary_parts)}" if summary_parts else ""

    # Confidence: scale with number and variety of sources
    confidence = min(0.2 + 0.08 * len(unique_sources), 0.95)
    kind_diversity = len(by_kind)
    if kind_diversity >= 2:
        confidence = min(confidence + 0.1, 0.95)

    logger.info(
        "Research mandate complete --- %d sources, confidence=%.2f",
        len(unique_sources), confidence,
    )

    return ResearchMandate(
        issue_title=issue_title,
        sources=unique_sources,
        summary=summary,
        confidence=confidence,
    )


def execute_mandate(
    issue_title: str,
    issue_body: str,
    repo: str = "",
    include_code_search: bool = True,
    include_oss: bool = True,
) -> ResearchMandate:
    """Execute a pre-implementation research mandate (sync wrapper).

    This is a convenience wrapper around :func:`execute_mandate_async`
    for use in synchronous contexts.
    """
    import asyncio

    return asyncio.run(
        execute_mandate_async(
            issue_title=issue_title,
            issue_body=issue_body,
            repo=repo,
            include_code_search=include_code_search,
            include_oss=include_oss,
        )
    )
