"""Tests for onboarding documentation integrity and accuracy.

Validates that:
1. docs/onboarding/ files exist and are non-empty
2. Cross-references between documents are valid
3. Code examples in docs are syntactically sensible
4. No placeholder/stub content remains in onboarding docs
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ONBOARDING_DIR = Path(__file__).resolve().parents[2] / "docs" / "onboarding"

REQUIRED_FILES = [
    "SETUP.md",
    "FAQ.md",
    "API_REFERENCE.md",
]

# Cross-references that should be resolvable between onboarding docs
INTERNAL_REFERENCES: dict[str, list[str]] = {
    "FAQ.md": ["SETUP.md"],
    "SETUP.md": ["FAQ.md"],
    "API_REFERENCE.md": [],
}


def _read_doc(filename: str) -> str:
    path = ONBOARDING_DIR / filename
    if not path.exists():
        raise FileNotFoundError(f"Missing required doc: {filename}")
    return path.read_text(encoding="utf-8")


class TestDocsExist:
    """All required onboarding documentation files exist."""

    def test_all_required_files_present(self):
        for filename in REQUIRED_FILES:
            path = ONBOARDING_DIR / filename
            assert path.exists(), f"Missing required file: {filename}"
            assert path.is_file(), f"Not a file: {filename}"

    def test_no_empty_files(self):
        for filename in REQUIRED_FILES:
            content = _read_doc(filename)
            assert len(content.strip()) > 0, f"{filename} is empty"
            assert len(content.splitlines()) >= 10, f"{filename} has fewer than 10 lines"


class TestDocContent:
    """Onboarding docs have meaningful content, no stubs or placeholders."""

    FORBIDDEN_PATTERNS = [
        r"TODO",
        r"FIXME",
        r"XXX",
        r"\[placeholder\]",
        r"\[insert.*\]",
        r"lorem ipsum",
        r"Lorem ipsum",
    ]

    def test_no_placeholder_content(self):
        for filename in REQUIRED_FILES:
            content = _read_doc(filename)
            for pattern in self.FORBIDDEN_PATTERNS:
                matches = re.findall(pattern, content)
                assert not matches, (
                    f"{filename} contains forbidden pattern {pattern!r}: {matches}"
                )

    def test_has_table_of_contents(self):
        for filename in REQUIRED_FILES:
            content = _read_doc(filename)
            assert "- [" in content or "Table of Contents" in content, (
                f"{filename} is missing a table of contents"
            )

    def test_has_code_examples(self):
        """Docs should contain at least one code block."""
        for filename in REQUIRED_FILES:
            content = _read_doc(filename)
            assert "```" in content, f"{filename} has no code examples"


class TestCrossReferences:
    """Internal cross-references between onboarding docs are valid."""

    def test_internal_references_point_to_existing_files(self):
        for source, targets in INTERNAL_REFERENCES.items():
            for target in targets:
                path = ONBOARDING_DIR / target
                assert path.exists(), (
                    f"{source} references {target} but it does not exist"
                )

    def test_reference_patterns_in_source_files(self):
        for source, targets in INTERNAL_REFERENCES.items():
            content = _read_doc(source)
            for target in targets:
                assert target in content, (
                    f"{source} should reference {target} but it was not found in the content"
                )


class TestAPIRefIntegrity:
    """API_REFERENCE.md has correct structure."""

    def test_has_all_sections(self):
        content = _read_doc("API_REFERENCE.md")
        required_sections = [
            "## Health",
            "## Webhooks",
            "## Fixes",
            "## Runs",
            "## Onboarding",
            "## Billing",
            "## Authentication",
        ]
        for section in required_sections:
            assert section in content, (
                f"API_REFERENCE.md missing required section: {section}"
            )

    def test_endpoints_have_methods(self):
        content = _read_doc("API_REFERENCE.md")
        endpoint_methods = re.findall(r"### `(GET|POST|PUT|DELETE) ", content)
        assert len(endpoint_methods) >= 10, (
            f"API_REFERENCE.md has only {len(endpoint_methods)} documented endpoints, expected >= 10"
        )

    def test_response_examples_are_json(self):
        content = _read_doc("API_REFERENCE.md")
        json_blocks = content.count("```json\n")
        assert json_blocks >= 5, (
            f"API_REFERENCE.md has only {json_blocks} JSON response examples, expected >= 5"
        )


class TestSetupGuideIntegrity:
    """SETUP.md has correct structure."""

    def test_has_prerequisites_table(self):
        content = _read_doc("SETUP.md")
        assert "| **Node.js**" in content, "SETUP.md missing Node.js prerequisite"

    def test_has_step_by_step_sections(self):
        content = _read_doc("SETUP.md")
        required_steps = [
            "### 1. Create a GitHub App",
            "### 2. Configure Environment",
            "### 3. Start the Backend Services",
            "### 4. Verify Everything Works",
        ]
        for step in required_steps:
            assert step in content, f"SETUP.md missing step: {step}"

    def test_has_env_variable_table(self):
        content = _read_doc("SETUP.md")
        assert "`GITHUB_APP_ID`" in content, "SETUP.md missing GITHUB_APP_ID documentation"
        assert "`OPENCODE_URL`" in content, "SETUP.md missing OPENCODE_URL documentation"


class TestFAQIntegrity:
    """FAQ.md has correct structure."""

    def test_has_question_sections(self):
        content = _read_doc("FAQ.md")
        question_count = len(re.findall(r"^### ", content, re.MULTILINE))
        assert question_count >= 10, (
            f"FAQ.md has only {question_count} questions, expected >= 10"
        )

    def test_has_categories(self):
        content = _read_doc("FAQ.md")
        categories = [
            "## General",
            "## Setup",
            "## Configuration",
            "## Troubleshooting",
        ]
        for cat in categories:
            assert cat in content, f"FAQ.md missing category: {cat}"


class TestMarkdownFormatting:
    """All onboarding docs follow consistent Markdown formatting."""

    def test_headings_use_proper_format(self):
        for filename in REQUIRED_FILES:
            content = _read_doc(filename)
            lines = content.splitlines()
            for i, line in enumerate(lines, 1):
                stripped = line.strip()
                if stripped.startswith("##") and not stripped.startswith("###"):
                    assert re.match(r"^#{2,3} ", stripped), (
                        f"{filename}:{i} — malformed heading: {stripped!r}"
                    )

    def test_no_trailing_whitespace(self):
        for filename in REQUIRED_FILES:
            content = _read_doc(filename)
            lines = content.splitlines()
            for i, line in enumerate(lines, 1):
                if line != line.rstrip():
                    pytest.fail(f"{filename}:{i} has trailing whitespace: {line!r}")
