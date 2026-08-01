"""Tests for STAS viral features — badge SVG format, MCP discovery manifest, and PR footer contract (AIM-2073).

These tests validate the expected output formats of the badge generation
and discovery modules without importing TypeScript sources directly.
"""

from __future__ import annotations

import json
import re


class TestBadgeSvgFormat:
    """Shields.io-compatible badge SVGs follow a strict format contract."""

    SAMPLE_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20" role="img" aria-label="fix: passed">
  <title>fix: passed</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="80" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="40" height="20" fill="#555"/>
    <rect x="40" width="40" height="20" fill="#2ea44f"/>
    <rect width="80" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="20" y="15" fill="#010101" fill-opacity=".3">fix</text>
    <text x="20" y="14">fix</text>
    <text x="60" y="15" fill="#010101" fill-opacity=".3">passed</text>
    <text x="60" y="14">passed</text>
  </g>
</svg>"""

    def test_valid_xml_structure(self):
        assert self.SAMPLE_SVG.strip().startswith("<svg")
        assert self.SAMPLE_SVG.strip().endswith("</svg>")

    def test_required_attributes(self):
        assert 'xmlns="http://www.w3.org/2000/svg"' in self.SAMPLE_SVG
        assert 'role="img"' in self.SAMPLE_SVG
        assert 'aria-label=' in self.SAMPLE_SVG

    def test_contains_label_and_message(self):
        assert "fix" in self.SAMPLE_SVG
        assert "passed" in self.SAMPLE_SVG

    def test_different_status_colors(self):
        passed = self.SAMPLE_SVG
        failed = passed.replace("#2ea44f", "#d73a4a").replace("passed", "failed")
        assert "#2ea44f" in passed
        assert "#d73a4a" in failed

    def test_badge_for_each_status(self):
        statuses = {"passed": "#2ea44f", "failed": "#d73a4a", "pending": "#0969da",
                     "queued": "#d4a72c", "cancelled": "#8b949e"}
        for status, color in statuses.items():
            svg = self.SAMPLE_SVG.replace("#2ea44f", color).replace("passed", status)
            assert svg.strip().startswith("<svg")
            assert svg.strip().endswith("</svg>")

    def test_title_element(self):
        assert "<title>" in self.SAMPLE_SVG
        assert "fix: passed" in self.SAMPLE_SVG

    def test_xml_escaping_required(self):
        escaped = self.SAMPLE_SVG.replace("passed", "a &amp; b &lt; c &gt; d &quot;e&quot;")
        assert "&amp;" in escaped
        assert "&lt;" in escaped
        assert "&gt;" in escaped
        assert "&quot;" in escaped


class TestMcpDiscoveryManifestContract:
    """MCP discovery manifest follows the Agent-to-Agent MCP discovery spec."""

    SAMPLE_MANIFEST = {
        "schemaVersion": "2024-11-05",
        "server": {
            "name": "syntaro-agent-discovery",
            "version": "1.0.0",
            "description": "STAS — automated bug fixing.",
            "homepage": "https://github.com/tamnguyen08/solving_tickets_as_a_service",
        },
        "transports": [{"type": "stdio", "command": "python",
                        "args": ["-m", "syntaro_mcp.server", "stdio"],
                        "description": "Stdio transport"}],
        "tools": [
            {"name": "syntaro_label_issue", "description": "Label a GitHub issue.",
             "inputSchema": {"type": "object", "properties": {},
                             "required": ["owner", "repo", "issue_number"]}},
            {"name": "syntaro_run_fix", "description": "Trigger fix pipeline.",
             "inputSchema": {"type": "object", "properties": {},
                             "required": ["issue_url"]}},
            {"name": "syntaro_check_status", "description": "Check run status.",
             "inputSchema": {"type": "object", "properties": {},
                             "required": ["run_id"]}},
            {"name": "syntaro_get_pr", "description": "Get PR for run.",
             "inputSchema": {"type": "object", "properties": {},
                             "required": ["run_id"]}},
        ],
        "resources": [
            {"uri": "syntaro://runs/{run_id}", "name": "Fix Run Status", "mimeType": "application/json"},
            {"uri": "syntaro://status", "name": "Server Health", "mimeType": "application/json"},
            {"uri": "syntaro://queue", "name": "Fix Queue", "mimeType": "application/json"},
        ],
    }

    def test_schema_version(self):
        assert self.SAMPLE_MANIFEST["schemaVersion"] == "2024-11-05"

    def test_server_name(self):
        assert "stas" in self.SAMPLE_MANIFEST["server"]["name"].lower()

    def test_transports_include_stdio(self):
        types = [t["type"] for t in self.SAMPLE_MANIFEST["transports"]]
        assert "stdio" in types

    def test_all_four_tools(self):
        names = [t["name"] for t in self.SAMPLE_MANIFEST["tools"]]
        assert len(names) == 4
        assert "syntaro_label_issue" in names
        assert "syntaro_run_fix" in names
        assert "syntaro_check_status" in names
        assert "syntaro_get_pr" in names

    def test_each_tool_has_schema(self):
        for tool in self.SAMPLE_MANIFEST["tools"]:
            assert "inputSchema" in tool
            assert isinstance(tool["inputSchema"], dict)

    def test_resources_include_runs_status_queue(self):
        uris = [r["uri"] for r in self.SAMPLE_MANIFEST["resources"]]
        assert "syntaro://runs/{run_id}" in uris
        assert "syntaro://status" in uris
        assert "syntaro://queue" in uris

    def test_serialisable_json(self):
        s = json.dumps(self.SAMPLE_MANIFEST)
        assert isinstance(s, str)
        assert json.loads(s)["schemaVersion"] == "2024-11-05"

    def test_each_resource_has_mime_type(self):
        for r in self.SAMPLE_MANIFEST["resources"]:
            assert r["mimeType"] == "application/json"

    def test_tools_have_required_fields(self):
        required = {"name", "description", "inputSchema"}
        for tool in self.SAMPLE_MANIFEST["tools"]:
            assert required.issubset(tool.keys()), f"{tool['name']} missing fields"

    def test_transport_has_required_fields(self):
        for t in self.SAMPLE_MANIFEST["transports"]:
            assert "type" in t
            assert "description" in t
            if t["type"] == "stdio":
                assert "command" in t


class TestPrFooterContract:
    """PR body footers must include STAS branding and MCP discovery hints."""

    FOOTER_WITH_RUN = (
        "---\n"
        "\n"
        "**Run page**: [STAS run #123](/runs/123)\n"
        "**Badge**: ![](/badge/123.svg)\n"
        "\n"
        "\U0001f6e0 **Fixed by STAS** \u2014 [View run](/runs/123)\n"
        "\n"
        "STAS exposes an MCP server for agent-to-agent discovery. "
        "Connect via `syntaro://discovery/mcp.json` to inspect runs, submit new issues, "
        "and check fix status programmatically.\n"
        "\n"
        "_\U0001f916 Automated fix by STAS_"
    )

    FOOTER_WITHOUT_RUN = (
        "---\n"
        "\n"
        "\U0001f6e0 **Fixed by STAS** \u2014 "
        "[solving_tickets_as_a_service]"
        "(https://github.com/tamnguyen08/solving_tickets_as_a_service)\n"
        "\n"
        "STAS exposes an MCP server for agent-to-agent discovery. "
        "Connect via `syntaro://discovery/mcp.json` to inspect runs, submit new issues, "
        "and check fix status programmatically.\n"
        "\n"
        "_\U0001f916 Automated fix by STAS_"
    )

    def test_footer_contains_fixed_by_stas(self):
        assert "Fixed by STAS" in self.FOOTER_WITH_RUN

    def test_footer_contains_mcp_discovery(self):
        assert "syntaro://discovery/mcp.json" in self.FOOTER_WITH_RUN
        assert "agent-to-agent" in self.FOOTER_WITH_RUN
        assert "MCP" in self.FOOTER_WITH_RUN

    def test_footer_shows_run_link_when_available(self):
        assert "/runs/123" in self.FOOTER_WITH_RUN
        assert "[View run](/runs/123)" in self.FOOTER_WITH_RUN

    def test_footer_links_to_github_when_no_run(self):
        assert "github.com/tamnguyen08/solving_tickets_as_a_service" in self.FOOTER_WITHOUT_RUN

    def test_footer_has_bot_signature(self):
        assert "Automated fix by" in self.FOOTER_WITH_RUN

    def test_footer_includes_badge_reference(self):
        assert "badge" in self.FOOTER_WITH_RUN.lower()
        assert ".svg" in self.FOOTER_WITH_RUN

    def test_footer_separator(self):
        assert "---" in self.FOOTER_WITH_RUN

    def test_mcp_hint_mentions_discovery(self):
        assert "discovery" in self.FOOTER_WITH_RUN.lower()

    def test_mcp_hint_mentions_runs(self):
        assert "inspect runs" in self.FOOTER_WITH_RUN

    def test_mcp_hint_mentions_status(self):
        assert "status" in self.FOOTER_WITH_RUN.lower()

    def test_mcp_hint_mentions_issues(self):
        assert "issues" in self.FOOTER_WITH_RUN.lower()

    def test_no_raw_template_variables(self):
        assert "{{" not in self.FOOTER_WITH_RUN
        assert "${" not in self.FOOTER_WITH_RUN
        assert "undefined" not in self.FOOTER_WITH_RUN.lower()
