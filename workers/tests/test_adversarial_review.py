"""
Tests for the 3-Layer Adversarial Review Methodology (AIM-1989).

Tests cover:
  - Layer 1: per-file analysis with subagents
  - Layer 2: 5 parallel holistic reviews
  - Layer 3: oracle verdict synthesis
  - Full pipeline integration
  - Configuration handling
  - Acceptance criteria (AC1–AC7)
"""

import json
import os
import tempfile

import pytest

from workers.tasks.adversarial_review import (
    _aggregate_file_reports,
    _load_config,
    _simulate_category_review,
    _simulate_per_file_analysis,
    full_adversarial_review,
    layer1_analysis,
    layer2_holistic,
    layer3_oracle,
)


# ═══════════════════════════════════════════════════════════════════════
# Fixtures
# ═══════════════════════════════════════════════════════════════════════


@pytest.fixture
def sample_diff_files():
    """Create temporary files for analysis."""
    tmpdir = tempfile.mkdtemp()
    files = {}

    # A clean Python file
    py_path = os.path.join(tmpdir, "fix_login.py")
    with open(py_path, "w") as f:
        f.write("""
def login(username: str, password: str) -> bool:
    \"\"\"Authenticate a user.\"\"\"
    if not username or not password:
        return False
    # TODO: add rate limiting
    return _verify_credentials(username, password)
""")
    files["fix_login.py"] = py_path

    # A file with security issues
    unsafe_path = os.path.join(tmpdir, "unsafe_config.yaml")
    with open(unsafe_path, "w") as f:
        f.write("""
database:
  host: localhost
  password: super_secret_123
  user: admin
""")
    files["unsafe_config.yaml"] = unsafe_path

    # A JS file with eval
    js_path = os.path.join(tmpdir, "script.js")
    with open(js_path, "w") as f:
        f.write("""
function process(input) {
    return eval(input);
}
""")
    files["script.js"] = js_path

    return files


@pytest.fixture
def sample_issue_context():
    return {
        "issue_id": "AIM-1989",
        "title": "Fix login authentication bug",
        "body": "Users cannot log in with valid credentials. The login endpoint returns 500 for valid users.",
        "acceptance_criteria": [
            "Users can log in with valid credentials",
            "Invalid credentials are rejected with 401",
            "Rate limiting is applied after 5 failed attempts",
        ],
    }


# ═══════════════════════════════════════════════════════════════════════
# AC1: Layer 1 runs per-file analysis
# ═══════════════════════════════════════════════════════════════════════


class TestLayer1PerFileAnalysis:
    """AC1: Layer 1 runs per-file analysis."""

    def test_layer1_returns_reports_per_file(self, sample_diff_files, sample_issue_context):
        """Each diff file should have a report entry."""
        diff_file_paths = list(sample_diff_files.values())
        result = layer1_analysis(diff_file_paths, sample_issue_context)

        assert result["layer"] == 1
        assert result["status"] == "completed"
        assert "reports" in result
        assert len(result["reports"]) == len(diff_file_paths)

        for file_path in diff_file_paths:
            assert file_path in result["reports"]
            report = result["reports"][file_path]
            assert "score" in report
            assert "correctness_flags" in report
            assert "edge_cases" in report
            assert "security_flags" in report

    def test_layer1_empty_files_list(self, sample_issue_context):
        """Empty diff_files should produce empty reports."""
        result = layer1_analysis([], sample_issue_context)
        assert result["layer"] == 1
        assert result["status"] == "completed"
        assert result["reports"] == {}

    def test_layer1_subagents_multiple(self, sample_diff_files, sample_issue_context):
        """Multiple subagents per file should be reflected in aggregated report."""
        diff_file_paths = list(sample_diff_files.values())
        result = layer1_analysis(diff_file_paths, sample_issue_context)

        for file_path in diff_file_paths:
            report = result["reports"][file_path]
            assert report["subagent_count"] == 2  # default config
            assert len(report["scores"]) == 2

    def test_layer1_security_detection(self, sample_diff_files, sample_issue_context):
        """Files with security issues should have security_flags."""
        diff_file_paths = list(sample_diff_files.values())
        result = layer1_analysis(diff_file_paths, sample_issue_context)

        # The unsafe_config.yaml should have a secrets flag
        yaml_report = None
        for fp, report in result["reports"].items():
            if "unsafe_config" in fp:
                yaml_report = report
                break

        assert yaml_report is not None
        assert len(yaml_report["security_flags"]) > 0

        # The JS file with eval should have security flags
        js_report = None
        for fp, report in result["reports"].items():
            if "script.js" in fp:
                js_report = report
                break

        assert js_report is not None
        assert any("eval" in f.lower() for f in js_report["security_flags"])


# ═══════════════════════════════════════════════════════════════════════
# AC2: Layer 2 runs 5 holistic reviews
# ═══════════════════════════════════════════════════════════════════════


class TestLayer2HolisticReview:
    """AC2: Layer 2 runs 5 holistic reviews."""

    def test_layer2_returns_all_five_categories(self, sample_diff_files, sample_issue_context):
        """All 5 default categories should be present."""
        diff_file_paths = list(sample_diff_files.values())
        l1_result = layer1_analysis(diff_file_paths, sample_issue_context)
        l1_reports = l1_result["reports"]

        result = layer2_holistic(l1_reports, sample_issue_context)

        assert result["layer"] == 2
        assert result["status"] == "completed"
        assert "reviews" in result

        expected_categories = {"goals", "code_quality", "security", "hands_on_qa", "context_miner"}
        assert set(result["reviews"].keys()) == expected_categories

    def test_layer2_each_review_has_required_fields(self, sample_diff_files, sample_issue_context):
        """Each category review should have score, findings, recommendation."""
        diff_file_paths = list(sample_diff_files.values())
        l1_result = layer1_analysis(diff_file_paths, sample_issue_context)
        l1_reports = l1_result["reports"]

        result = layer2_holistic(l1_reports, sample_issue_context)

        for category, review in result["reviews"].items():
            assert "score" in review
            assert "findings" in review
            assert "recommendation" in review
            assert isinstance(review["score"], float)
            assert 0.0 <= review["score"] <= 1.0
            assert isinstance(review["findings"], list)

    def test_layer2_security_category_flags_issues(self, sample_diff_files, sample_issue_context):
        """Security category should flag files with security issues."""
        diff_file_paths = list(sample_diff_files.values())
        l1_result = layer1_analysis(diff_file_paths, sample_issue_context)
        l1_reports = l1_result["reports"]

        result = layer2_holistic(l1_reports, sample_issue_context)
        security_review = result["reviews"]["security"]

        # Should have findings (secrets in yaml, eval in js)
        assert len(security_review["findings"]) > 0
        # Security score should be penalised
        assert security_review["score"] < 1.0


# ═══════════════════════════════════════════════════════════════════════
# AC3: Layer 3 oracle synthesises final verdict
# ═══════════════════════════════════════════════════════════════════════


class TestLayer3Oracle:
    """AC3: Layer 3 oracle synthesises final verdict."""

    def test_layer3_returns_verdict(self, sample_diff_files, sample_issue_context):
        """Layer 3 should return a verdict string."""
        diff_file_paths = list(sample_diff_files.values())
        l1_result = layer1_analysis(diff_file_paths, sample_issue_context)
        l2_result = layer2_holistic(l1_result["reports"], sample_issue_context)

        result = layer3_oracle(l1_result["reports"], l2_result, sample_issue_context)

        assert result["layer"] == 3
        assert result["status"] == "completed"
        assert "verdict" in result
        assert result["verdict"] in ("PASS", "FLAG", "FAIL")

    def test_layer3_has_confidence_score(self, sample_diff_files, sample_issue_context):
        """Verdict should include a 0-1 confidence score."""
        diff_file_paths = list(sample_diff_files.values())
        l1_result = layer1_analysis(diff_file_paths, sample_issue_context)
        l2_result = layer2_holistic(l1_result["reports"], sample_issue_context)

        result = layer3_oracle(l1_result["reports"], l2_result, sample_issue_context)

        assert "confidence" in result
        assert isinstance(result["confidence"], float)
        assert 0.0 <= result["confidence"] <= 1.0

    def test_layer3_returns_rework_instructions_for_flags(self, sample_diff_files, sample_issue_context):
        """FAIL/FLAG verdicts should include rework_instructions."""
        diff_file_paths = list(sample_diff_files.values())
        l1_result = layer1_analysis(diff_file_paths, sample_issue_context)
        l2_result = layer2_holistic(l1_result["reports"], sample_issue_context)

        result = layer3_oracle(l1_result["reports"], l2_result, sample_issue_context)

        if result["verdict"] in ("FAIL", "FLAG"):
            assert "rework_instructions" in result
            assert len(result["rework_instructions"]) > 0

    def test_layer3_aggregates_layer1_and_layer2(self, sample_diff_files, sample_issue_context):
        """Verdict should reference both layer averages."""
        diff_file_paths = list(sample_diff_files.values())
        l1_result = layer1_analysis(diff_file_paths, sample_issue_context)
        l2_result = layer2_holistic(l1_result["reports"], sample_issue_context)

        result = layer3_oracle(l1_result["reports"], l2_result, sample_issue_context)

        assert "avg_layer1_score" in result
        assert "avg_layer2_score" in result
        assert "category_recommendations" in result


# ═══════════════════════════════════════════════════════════════════════
# AC4: PASS → PR proceeds to merge queue
# AC5: FAIL → return rework instructions
# AC6: Reports stored in output
# ═══════════════════════════════════════════════════════════════════════


class TestFullAdversarialReview:
    """AC4, AC5, AC6: Full pipeline integration."""

    def test_full_review_completes_all_layers(self, sample_diff_files, sample_issue_context):
        """Full review should execute all 3 layers."""
        diff_file_paths = list(sample_diff_files.values())
        result = full_adversarial_review(diff_file_paths, sample_issue_context)

        assert result["status"] == "completed"
        assert "layer1" in result
        assert "layer2" in result
        assert "layer3" in result

        assert result["layer1"]["layer"] == 1
        assert result["layer2"]["layer"] == 2
        assert result["layer3"]["layer"] == 3

    def test_full_review_passed_field(self, sample_diff_files, sample_issue_context):
        """PASS verdict -> passed=True; FAIL -> passed=False."""
        diff_file_paths = list(sample_diff_files.values())
        result = full_adversarial_review(diff_file_paths, sample_issue_context)

        assert "passed" in result
        assert isinstance(result["passed"], bool)
        assert result["passed"] == (result["verdict"] == "PASS")

    def test_full_review_reports_in_output(self, sample_diff_files, sample_issue_context):
        """AC6: All layer reports should be present in output."""
        diff_file_paths = list(sample_diff_files.values())
        result = full_adversarial_review(diff_file_paths, sample_issue_context)

        # Layer 1 reports
        assert "reports" in result["layer1"]
        assert len(result["layer1"]["reports"]) > 0

        # Layer 2 reviews
        assert "reviews" in result["layer2"]
        assert len(result["layer2"]["reviews"]) > 0

        # Layer 3 verdict
        assert "verdict" in result["layer3"]
        assert "confidence" in result["layer3"]

    def test_full_review_empty_diff(self, sample_issue_context):
        """Empty diff should not crash -- returns verdict."""
        result = full_adversarial_review([], sample_issue_context)
        assert result["status"] == "completed"
        assert result["verdict"] in ("PASS", "FLAG", "FAIL")

    def test_full_review_fail_has_rework(self, sample_issue_context):
        """AC5: FAIL verdicts should include rework instructions."""
        # Use a diff with known-bad files to force a fail
        tmpdir = tempfile.mkdtemp()
        bad_path = os.path.join(tmpdir, "bad_file.py")
        with open(bad_path, "w") as f:
            f.write("""
import subprocess
import pickle
import sqlite3

def run(cmd):
    return subprocess.check_output(cmd, shell=True)

def load(data):
    return pickle.loads(data)

def query(user_input):
    conn = sqlite3.connect("test.db")
    return conn.execute(f"SELECT * FROM users WHERE name = '{user_input}'")
""")

        result = full_adversarial_review([bad_path], sample_issue_context)

        if result["verdict"] == "FAIL":
            assert len(result["layer3"]["rework_instructions"]) > 0
        elif result["verdict"] == "FLAG":
            # Still should have rework instructions
            assert len(result["layer3"]["rework_instructions"]) > 0


# ═══════════════════════════════════════════════════════════════════════
# AC7: Configurable via workflow YAML stub
# ═══════════════════════════════════════════════════════════════════════


class TestConfigurability:
    """AC7: Configurable via workflow YAML / env vars."""

    def test_config_from_issue_context(self):
        """Config can be overridden via issue_context."""
        ctx = {
            "adversarial_review_config": {
                "layer1_subagents_per_file": 3,
                "pass_threshold": 0.9,
                "flag_threshold": 0.6,
            }
        }
        config = _load_config(ctx)
        assert config["layer1_subagents_per_file"] == 3
        assert config["pass_threshold"] == 0.9
        assert config["flag_threshold"] == 0.6

    def test_config_from_env_var(self):
        """Config can be overridden via ADVERSARIAL_REVIEW_CONFIG env var."""
        env_config = json.dumps({
            "layer1_subagents_per_file": 5,
            "pass_threshold": 0.95,
        })
        os.environ["ADVERSARIAL_REVIEW_CONFIG"] = env_config
        try:
            config = _load_config({})
            assert config["layer1_subagents_per_file"] == 5
            assert config["pass_threshold"] == 0.95
            # Defaults should still apply for unspecified keys
            assert config["flag_threshold"] == 0.5
        finally:
            del os.environ["ADVERSARIAL_REVIEW_CONFIG"]

    def test_config_defaults(self):
        """Default config should have reasonable values."""
        config = _load_config(None)
        assert config["layer1_subagents_per_file"] == 2
        assert config["pass_threshold"] == 0.8
        assert config["flag_threshold"] == 0.5
        assert "goals" in config["layer2_review_categories"]
        assert "security" in config["layer2_review_categories"]

    def test_config_invalid_env_falls_back(self):
        """Invalid JSON in env var should fall back to defaults."""
        os.environ["ADVERSARIAL_REVIEW_CONFIG"] = "not json"
        try:
            config = _load_config({})
            assert config["layer1_subagents_per_file"] == 2
        finally:
            del os.environ["ADVERSARIAL_REVIEW_CONFIG"]


# ═══════════════════════════════════════════════════════════════════════
# Unit tests for internal helpers
# ═══════════════════════════════════════════════════════════════════════


class TestHelpers:
    """Tests for internal helper functions."""

    def test_aggregate_file_reports_empty(self):
        result = _aggregate_file_reports([])
        assert result["score"] == 0.0
        assert result["subagent_count"] == 0

    def test_aggregate_file_reports_single(self):
        reports = [
            {
                "score": 0.8,
                "correctness_flags": ["flag1"],
                "edge_cases": ["edge1"],
                "security_flags": ["sec1"],
            }
        ]
        result = _aggregate_file_reports(reports)
        assert result["score"] == 0.8
        assert result["correctness_flags"] == ["flag1"]
        assert result["edge_cases"] == ["edge1"]
        assert result["security_flags"] == ["sec1"]
        assert result["subagent_count"] == 1

    def test_aggregate_file_reports_dedup(self):
        reports = [
            {
                "score": 0.8,
                "correctness_flags": ["same_flag"],
                "edge_cases": ["same_edge"],
                "security_flags": ["same_sec"],
            },
            {
                "score": 0.9,
                "correctness_flags": ["same_flag", "new_flag"],
                "edge_cases": ["same_edge", "new_edge"],
                "security_flags": ["same_sec", "new_sec"],
            },
        ]
        result = _aggregate_file_reports(reports)
        assert len(result["correctness_flags"]) == 2  # deduped
        assert len(result["edge_cases"]) == 2
        assert len(result["security_flags"]) == 2

    def test_simulate_per_file_analysis_flags(self):
        """Per-file analysis should detect known patterns."""
        tmpdir = tempfile.mkdtemp()
        path = os.path.join(tmpdir, "vuln.py")
        with open(path, "w") as f:
            f.write("import subprocess\nsubprocess.call('rm -rf /', shell=True)\n")

        content = open(path).read()
        result = _simulate_per_file_analysis(path, content, 0, {})
        assert result["score"] < 1.0
        assert len(result["security_flags"]) > 0
        assert any("shell" in f.lower() for f in result["security_flags"])

    def test_load_config_priority(self):
        """Env var should take priority over defaults."""
        ctx = {
            "adversarial_review_config": {
                "layer1_subagents_per_file": 4,
            }
        }
        config = _load_config(ctx)
        assert config["layer1_subagents_per_file"] == 4
        # Still has defaults for other keys
        assert config["pass_threshold"] == 0.8
