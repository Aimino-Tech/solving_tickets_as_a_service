"""
Research module --- search codebase and web to augment plan generation.

Provides structured codebase and web research capabilities that feed into
the plan generation pipeline. Each finding includes a source, snippet,
relevance score, and type classification.

Usage::

    from workers.plan.researcher import (
        research_codebase,
        research_web,
        ResearchResult,
    )

    result = research_codebase(
        issue_title="Login returns 500 for special chars",
        issue_body="The login endpoint crashes when email has + or &.",
        workspace_path="/path/to/repo",
    )
    for finding in result.findings:
        print(finding.file_path, finding.snippet)

    web_result = research_web(
        issue_title="Login returns 500 for special chars",
        issue_body="Email validation with special characters in Python",
    )
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

RESEARCH_FINDING_KINDS = frozenset({
    "codebase_file",
    "codebase_content",
    "web_reference",
    "web_documentation",
    "web_issue",
})


@dataclass
class ResearchFinding:
    """A single research finding from codebase or web search.

    Attributes
    ----------
    kind
        One of ``RESEARCH_FINDING_KINDS``.
    source
        Human-readable source description (e.g. file path, URL).
    snippet
        Contextual snippet of the finding.
    relevance
        Relevance score between 0.0 and 1.0.
    file_path
        Absolute file path (only for codebase findings).
    line_number
        Line number in the file (only for codebase findings).
    """

    kind: str
    source: str
    snippet: str
    relevance: float = 0.5
    file_path: str | None = None
    line_number: int | None = None

    def __post_init__(self) -> None:
        """Validate kind and clamp relevance."""
        if self.kind not in RESEARCH_FINDING_KINDS:
            raise ValueError(
                f"Unknown finding kind: {self.kind!r}. "
                f"Must be one of {sorted(RESEARCH_FINDING_KINDS)}"
            )
        self.relevance = max(0.0, min(1.0, self.relevance))


@dataclass
class ResearchResult:
    """Aggregated research output.

    Attributes
    ----------
    findings
        All individual research findings.
    codebase_summary
        Concise summary of what was found in the codebase.
    web_summary
        Concise summary of what was found on the web.
    confidence
        Overall confidence in the research (0.0 to 1.0).
    """

    findings: list[ResearchFinding] = field(default_factory=list)
    codebase_summary: str = ""
    web_summary: str = ""
    confidence: float = 0.0

    @classmethod
    def empty(cls) -> ResearchResult:
        """Return an empty research result (no findings, 0.0 confidence)."""
        return cls(findings=[], codebase_summary="", web_summary="", confidence=0.0)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a dict (JSON-safe)."""
        return {
            "findings": [
                {
                    "kind": f.kind,
                    "source": f.source,
                    "snippet": f.snippet[:500],
                    "relevance": f.relevance,
                    "file_path": f.file_path,
                    "line_number": f.line_number,
                }
                for f in self.findings
            ],
            "codebase_summary": self.codebase_summary,
            "web_summary": self.web_summary,
            "confidence": self.confidence,
            "finding_count": len(self.findings),
        }


# ---------------------------------------------------------------------------
# Codebase research
# ---------------------------------------------------------------------------

_MAX_CODEBASE_FINDINGS = 15
_MAX_SNIPPET_LINES = 8
_CONTENT_SEARCH_MAX_FILES = 8


def _extract_keywords(text: str) -> list[str]:
    """Extract meaningful search keywords from issue text.

    Strips common stop words and returns lowercase tokens that are likely
    to correspond to code symbols (function names, error messages, etc.).
    """
    combined = text.lower()
    # Split on non-alphanumeric characters (except underscore)
    tokens = re.split(r"[^a-z0-9_]+", combined)
    # Filter out short/common words
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


def _search_codebase_files(
    keywords: list[str],
    workspace_path: str,
) -> list[ResearchFinding]:
    """Find relevant source files by matching keywords against file names."""
    findings: list[ResearchFinding] = []
    seen_paths: set[str] = set()

    if not os.path.isdir(workspace_path):
        return findings

    for root, dirs, files in os.walk(workspace_path):
        # Skip hidden directories and common noise
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in {
            "__pycache__", "node_modules", ".git", ".venv", "venv",
            "dist", "build", ".ruff_cache", ".pytest_cache",
        }]

        for fname in files:
            if not fname.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".md")):
                continue

            fname_lower = fname.lower()
            rel_path = os.path.relpath(os.path.join(root, fname), workspace_path)

            # Check if any keyword matches the file name
            matched_keywords = [kw for kw in keywords if kw in fname_lower]
            if not matched_keywords:
                continue

            if rel_path in seen_paths:
                continue
            seen_paths.add(rel_path)

            findings.append(ResearchFinding(
                kind="codebase_file",
                source=rel_path,
                snippet=f"File name matches: {', '.join(matched_keywords)}",
                relevance=0.6,
                file_path=os.path.join(root, fname),
            ))

            if len(findings) >= _MAX_CODEBASE_FINDINGS:
                break
        if len(findings) >= _MAX_CODEBASE_FINDINGS:
            break

    return findings


def _search_codebase_content(
    keywords: list[str],
    workspace_path: str,
) -> list[ResearchFinding]:
    """Grep for keywords in source files and return matching snippets."""
    findings: list[ResearchFinding] = []
    seen_snippets: set[str] = set()

    if not os.path.isdir(workspace_path):
        return findings

    for keyword in keywords:
        try:
            result = subprocess.run(
                ["grep", "-r", "-n", "-i", "--include", "*.py",
                 "--include", "*.ts", "--include", "*.tsx",
                 "--include", "*.go", "--include", "*.rs",
                 "-l", keyword, workspace_path],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

        matching_files = result.stdout.strip().split("\n") if result.stdout.strip() else []
        for file_path in matching_files[:_CONTENT_SEARCH_MAX_FILES]:
            if not os.path.isfile(file_path):
                continue

            # Get a snippet from the first matching line
            try:
                grep_line = subprocess.run(
                    ["grep", "-n", "-i", keyword, file_path],
                    capture_output=True, text=True, timeout=5,
                )
            except (subprocess.TimeoutExpired, FileNotFoundError):
                continue

            first_match = grep_line.stdout.strip().split("\n")[0] if grep_line.stdout.strip() else ""
            if not first_match:
                continue

            line_num_str, _, line_content = first_match.partition(":")
            try:
                line_num = int(line_num_str)
            except ValueError:
                line_num = 0

            snippet = line_content.strip()
            # Deduplicate by snippet text
            dedup_key = f"{os.path.relpath(file_path, workspace_path)}:{snippet[:80]}"
            if dedup_key in seen_snippets:
                continue
            seen_snippets.add(dedup_key)

            rel_path = os.path.relpath(file_path, workspace_path)
            findings.append(ResearchFinding(
                kind="codebase_content",
                source=rel_path,
                snippet=snippet,
                relevance=0.75,
                file_path=file_path,
                line_number=line_num,
            ))

            if len(findings) >= _MAX_CODEBASE_FINDINGS:
                break
        if len(findings) >= _MAX_CODEBASE_FINDINGS:
            break

    return findings


def research_codebase(
    issue_title: str,
    issue_body: str,
    workspace_path: str = "",
) -> ResearchResult:
    """Search the codebase for files and content relevant to the issue.

    Parameters
    ----------
    issue_title
        Issue title (used for keyword extraction).
    issue_body
        Issue body / description.
    workspace_path
        Path to the repository root. Falls back to CWD if empty.

    Returns
    -------
    ResearchResult
        Aggregated findings with codebase context.
    """
    if not workspace_path:
        workspace_path = os.getcwd()

    if not issue_title and not issue_body:
        logger.warning("research_codebase called with empty title and body")
        return ResearchResult.empty()

    text = f"{issue_title} {issue_body}"
    keywords = _extract_keywords(text)
    logger.info(
        "Researching codebase --- title=%s keywords=%s path=%s",
        issue_title[:60], keywords, workspace_path,
    )

    if not keywords:
        logger.info("No meaningful keywords extracted --- returning empty result")
        return ResearchResult.empty()

    # Search by file name and file content
    file_findings = _search_codebase_files(keywords, workspace_path)
    content_findings = _search_codebase_content(keywords, workspace_path)

    all_findings = file_findings + content_findings

    if not all_findings:
        logger.info("No codebase findings for keywords=%s", keywords)
        return ResearchResult.empty()

    # Build a summary
    unique_files = sorted({f.source for f in all_findings})
    codebase_summary = (
        f"Found {len(all_findings)} relevant matches across "
        f"{len(unique_files)} file(s): {', '.join(unique_files[:8])}"
    )
    if len(unique_files) > 8:
        codebase_summary += f" and {len(unique_files) - 8} more"

    # Confidence based on number and type of findings
    confidence = min(0.3 + 0.05 * len(all_findings), 0.95)
    # Boost if we have content-level matches (more relevant than file name)
    if content_findings:
        confidence = min(confidence + 0.1, 0.95)

    logger.info(
        "Codebase research complete --- %d findings, confidence=%.2f",
        len(all_findings), confidence,
    )

    return ResearchResult(
        findings=all_findings,
        codebase_summary=codebase_summary,
        web_summary="",
        confidence=confidence,
    )


# ---------------------------------------------------------------------------
# Web research
# ---------------------------------------------------------------------------

_WEB_SEARCH_MAX_RESULTS = 6


def _build_web_search_queries(title: str, body: str) -> list[str]:
    """Build targeted web search queries from issue text."""
    text = f"{title} {body}"
    keywords = _extract_keywords(text)

    if not keywords:
        return []

    queries = []
    # Primary query: first 5 significant terms
    primary_terms = keywords[:5]
    queries.append(" ".join(primary_terms))

    # Secondary: if the issue mentions an error, search with "fix" prefix
    if any(kw in text.lower() for kw in ("error", "exception", "fail", "crash")):
        queries.append(f"how to fix {' '.join(keywords[:4])}")

    # Tertiary: library-specific query (if Python or JS terms present)
    if any(kw in text.lower() for kw in ("python", "django", "flask", "fastapi")):
        queries.append(f"python {' '.join(keywords[:3])} solution")
    if any(kw in text.lower() for kw in ("react", "typescript", "node", "next")):
        queries.append(f"typescript {' '.join(keywords[:3])} fix")

    return queries


def _run_web_search(query: str) -> list[ResearchFinding]:
    """Execute a web search for the given query.

    Uses a subprocess call to a configurable search tool (default: ``curl``
    with a search API endpoint). Falls back gracefully on failure.
    """
    findings: list[ResearchFinding] = []

    search_cmd = os.getenv("RESEARCH_SEARCH_CMD", "")
    if not search_cmd:
        logger.debug("No RESEARCH_SEARCH_CMD configured --- skipping web search")
        return findings

    try:
        cmd = search_cmd.format(query=query)
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=30,
        )
        output = result.stdout.strip()
        if not output:
            return findings

        # Parse each line as a result entry (expects URL | title | snippet)
        for line in output.split("\n")[:_WEB_SEARCH_MAX_RESULTS]:
            parts = line.split("|", 2)
            if len(parts) < 2:
                continue
            url = parts[0].strip()
            title = parts[1].strip()
            snippet = parts[2].strip() if len(parts) > 2 else ""

            findings.append(ResearchFinding(
                kind="web_reference",
                source=url,
                snippet=f"{title}: {snippet}" if snippet else title,
                relevance=0.5,
            ))
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("Web search command failed: %s", exc)

    return findings


def research_web(issue_title: str, issue_body: str) -> ResearchResult:
    """Search the web for context related to the issue.

    Requires the ``RESEARCH_SEARCH_CMD`` environment variable to be set.
    The command uses ``{query}`` as a placeholder for the search terms.
    Each output line should be ``URL | Title | Snippet``.

    Parameters
    ----------
    issue_title
        Issue title.
    issue_body
        Issue body / description.

    Returns
    -------
    ResearchResult
        Aggregated findings with web context.
    """
    if not issue_title and not issue_body:
        logger.warning("research_web called with empty title and body")
        return ResearchResult.empty()

    queries = _build_web_search_queries(issue_title, issue_body)
    if not queries:
        logger.info("No search queries could be built from issue text")
        return ResearchResult.empty()

    logger.info(
        "Researching web --- title=%s queries=%d",
        issue_title[:60], len(queries),
    )

    all_findings: list[ResearchFinding] = []
    for query in queries:
        findings = _run_web_search(query)
        all_findings.extend(findings)

    if not all_findings:
        logger.info("No web findings returned")
        return ResearchResult.empty()

    # Build summary
    unique_sources = sorted({f.source for f in all_findings})
    web_summary = (
        f"Found {len(all_findings)} relevant web result(s) "
        f"from {len(unique_sources)} source(s)"
    )

    confidence = min(0.3 + 0.1 * len(all_findings), 0.9)

    logger.info(
        "Web research complete --- %d findings, confidence=%.2f",
        len(all_findings), confidence,
    )

    return ResearchResult(
        findings=all_findings,
        codebase_summary="",
        web_summary=web_summary,
        confidence=confidence,
    )


def research_all(
    issue_title: str,
    issue_body: str,
    workspace_path: str = "",
) -> ResearchResult:
    """Run both codebase and web research, merging results.

    Parameters
    ----------
    issue_title
        Issue title.
    issue_body
        Issue body / description.
    workspace_path
        Path to the repository root.

    Returns
    -------
    ResearchResult
        Merged research result combining codebase and web findings.
    """
    codebase_result = research_codebase(issue_title, issue_body, workspace_path)
    web_result = research_web(issue_title, issue_body)

    merged_findings = codebase_result.findings + web_result.findings

    codebase_summary = codebase_result.codebase_summary
    web_summary = web_result.web_summary

    # Merge summaries
    parts = []
    if codebase_summary:
        parts.append(codebase_summary)
    if web_summary:
        parts.append(web_summary)
    merged_summary = "; ".join(parts) if parts else ""

    # Combined confidence: if codebase found nothing but web did, use web
    if codebase_result.confidence > 0 and web_result.confidence > 0:
        combined_conf = (codebase_result.confidence + web_result.confidence) / 2
    elif codebase_result.confidence > 0:
        combined_conf = codebase_result.confidence
    elif web_result.confidence > 0:
        combined_conf = web_result.confidence
    else:
        combined_conf = 0.0

    logger.info(
        "Combined research --- %d total findings, confidence=%.2f",
        len(merged_findings), combined_conf,
    )

    return ResearchResult(
        findings=merged_findings,
        codebase_summary=codebase_summary,
        web_summary=web_summary,
        confidence=combined_conf,
    )
