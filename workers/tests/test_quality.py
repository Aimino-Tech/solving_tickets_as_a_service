"""Tests for the workers/quality/ anti-fake quality gates."""

import os
import tempfile

from workers.celery_app import app


def test_tasks_registered():
    import workers.quality.analyzer  # noqa: F401
    import workers.quality.anti_mockup_scan  # noqa: F401
    import workers.tasks.self_audit  # noqa: F401

    assert "workers.quality.analyzer.quality_analyze" in app.tasks
    assert "workers.quality.anti_mockup_scan.anti_mockup_scan" in app.tasks
    assert "workers.tasks.self_audit.run_self_audit" in app.tasks
    assert "workers.tasks.self_audit.orchestrate_pipeline" in app.tasks
    assert "workers.tasks.self_audit.review_decision" in app.tasks


# ── Quality Analyzer (AC1, AC8) ────────────────────────────────────────


def _well_written_description() -> str:
    return (
        "## Problem\n"
        "The login endpoint returns a 500 error when users include special characters "
        "in their email address. This breaks the registration flow for enterprise clients "
        "who use email aliases with + signs.\n\n"
        "## What we need\n"
        "We must sanitize email input before passing it to the database query. "
        "The fix should be minimal and only affect the input validation layer."
    )


def _vague_description() -> str:
    return "Fix things"


def _good_acs() -> str:
    return (
        "- Given a user with email containing '+' sign, When they POST /login, Then return 200\n"
        "- Given a user with email containing '&' character, When they POST /login, Then return 200\n"
        "- Given an empty email field, When they POST /login, Then return 400 with validation error\n"
        "- All existing tests must pass\n"
        "- The fix must not introduce new dependencies"
    )


def _empty_acs() -> str:
    return ""


def test_quality_analyze_excellent_issue_scores_above_0_8():
    from workers.quality.analyzer import quality_analyze

    desc = (
        "## Problem\nThe login endpoint breaks on special characters in email. "
        "This blocks enterprise clients who use email aliases.\n\n"
        "## What we need\nWe must sanitize email input before DB query. "
        "The fix should be minimal and only affect input validation layer. "
        "Because this is a security-sensitive change, we need careful review "
        "and must not introduce regressions."
    )
    acs = (
        "- Given a user with email containing '+' sign, When they POST /login, Then return 200\n"
        "- Given a user with email containing '&' character, When they POST /login, Then return 200\n"
        "- Given an empty email field, When they POST /login, Then return 400 with validation error\n"
        "- All existing tests must pass\n"
        "- The fix must not introduce new dependencies\n"
        "- Edge case: very long email (254 chars) must not crash\n"
        "- Edge case: email with multiple @ signs must be rejected"
    )
    result = quality_analyze.run(
        issue_id="test-001",
        description=desc,
        acceptance_criteria=acs,
    )
    assert result["score"] >= 0.8, f"Expected >= 0.8, got {result['score']}"
    assert result["auto_healed"] is False
    assert result["needs_review"] is False


def test_quality_analyze_vague_issue_scores_below_0_3():
    from workers.quality.analyzer import quality_analyze

    result = quality_analyze.run(
        issue_id="test-002",
        description=_vague_description(),
        acceptance_criteria=_empty_acs(),
    )
    assert result["score"] < 0.3, f"Expected < 0.3, got {result['score']}"
    assert result["auto_healed"] is True
    assert result["needs_review"] is True


def test_quality_analyze_empty_description_returns_low_score():
    from workers.quality.analyzer import quality_analyze

    result = quality_analyze.run(
        issue_id="test-003",
        description="",
        acceptance_criteria="",
    )
    assert result["score"] < 0.3
    assert result["auto_healed"] is True


def test_quality_analyze_auto_heal_respects_flag():
    from workers.quality.analyzer import quality_analyze

    result = quality_analyze.run(
        issue_id="test-004",
        description="short",
        acceptance_criteria="",
        auto_heal=False,
    )
    assert result["auto_healed"] is False
    assert result["needs_review"] is False
    assert result["score"] < 0.6


def test_get_e2e_spec_template():
    from workers.quality.analyzer import get_e2e_spec_template

    template = get_e2e_spec_template()
    assert "E2E Spec Template" in template
    assert "Preconditions" in template
    assert "Test Steps" in template
    assert "Expected Results" in template
    assert "Verification Criteria" in template


def test_quality_analyze_mixed_quality():
    from workers.quality.analyzer import quality_analyze

    med_description = "## Summary\nThe system should handle concurrent requests properly."
    med_acs = "- Should handle 1000 concurrent users\n- Should not drop requests under load"

    result = quality_analyze.run(
        issue_id="test-005",
        description=med_description,
        acceptance_criteria=med_acs,
    )
    assert 0.3 <= result["score"] <= 0.8


# ── Anti-Mockup Scan (AC2, AC3, AC4) ──────────────────────────────────


def _create_temp_workspace(files: dict[str, str]) -> str:
    tmpdir = tempfile.mkdtemp()
    os.system(f"cd {tmpdir} && git init -b main && git config user.email test@test.com && git config user.name test")
    for path, content in files.items():
        full_path = os.path.join(tmpdir, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
    os.system(f"cd {tmpdir} && git add -A && git commit -m 'initial'")
    return tmpdir


def _add_files_and_commit(workspace: str, files: dict[str, str]) -> None:
    for path, content in files.items():
        full_path = os.path.join(workspace, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
    os.system(f"cd {workspace} && git add -A && git commit -m 'add files' --allow-empty")


def test_anti_mockup_scan_catches_todo_comment():
    from workers.quality.anti_mockup_scan import anti_mockup_scan

    workspace = _create_temp_workspace({
        "src/main.py": "def existing_function():\n    return 42\n",
    })
    prod_file = "src/handler.py"
    _add_files_and_commit(workspace, {
        prod_file: "def handle_request():\n    # TODO: implement this\n    pass\n",
    })
    result = anti_mockup_scan.run(workspace_path=workspace)
    assert result["passed"] is False, f"Expected blocked, got findings={result['findings']}"
    todo_findings = [f for f in result["findings"] if f["file"].endswith(prod_file)]
    assert len(todo_findings) > 0, f"Expected TODO finding in {prod_file}"
    blocking_findings = [f for f in todo_findings if f["severity"] == "blocking"]
    assert len(blocking_findings) > 0, "Expected at least one blocking finding"


def test_anti_mockup_scan_catches_return_none_stub():
    from workers.quality.anti_mockup_scan import anti_mockup_scan

    workspace = _create_temp_workspace({
        "src/main.py": "x = 1\n",
    })
    _add_files_and_commit(workspace, {
        "src/compute.py": "def compute_value():\n    return None\n",
    })
    result = anti_mockup_scan.run(workspace_path=workspace)
    blocking = [f for f in result["findings"] if f["severity"] in ("critical", "blocking")]
    return_none_findings = [f for f in blocking if "return None" in f["pattern"] or "Stub" in f["pattern"]]
    assert len(return_none_findings) > 0, f"Expected return None finding, got {result['findings']}"
    assert result["passed"] is False


def test_anti_mockup_scan_passes_clean_code():
    from workers.quality.anti_mockup_scan import anti_mockup_scan

    workspace = _create_temp_workspace({
        "src/main.py": "def existing():\n    return 42\n",
    })
    _add_files_and_commit(workspace, {
        "src/real_impl.py": (
            "def compute(x: int) -> int:\n"
            "    result = x * 2 + 1\n"
            "    return result\n"
        ),
    })
    result = anti_mockup_scan.run(workspace_path=workspace)
    if not result["passed"]:
        print(f"Unexpected findings: {result['findings']}")
    assert result["passed"] is True, f"Expected clean pass, got {result['findings']}"


def test_anti_mockup_scan_ignores_test_files():
    from workers.quality.anti_mockup_scan import anti_mockup_scan

    workspace = _create_temp_workspace({
        "src/main.py": "def existing():\n    return True\n",
    })
    _add_files_and_commit(workspace, {
        "tests/test_handler.py": (
            "def test_handler():\n"
            "    # TODO: add real assertions later\n"
            "    pass\n"
        ),
    })
    result = anti_mockup_scan.run(workspace_path=workspace)
    test_findings = [f for f in result["findings"] if "test_handler" in f["file"]]
    assert len(test_findings) == 0, f"Test file TODO should be ignored, got {test_findings}"


def test_anti_mockup_scan_catches_as_any():
    from workers.quality.anti_mockup_scan import anti_mockup_scan

    workspace = _create_temp_workspace({
        "src/main.py": "const x: number = 1;\n",
    })
    _add_files_and_commit(workspace, {
        "src/untyped.ts": "const result = getData() as any;\n",
    })
    result = anti_mockup_scan.run(workspace_path=workspace)
    as_any = [f for f in result["findings"] if "as any" in f["pattern"] or "TypeScript as any" in f["pattern"]]
    assert len(as_any) > 0, f"Expected as any finding, got {result['findings']}"


def test_anti_mockup_scan_catches_empty_body():
    from workers.quality.anti_mockup_scan import anti_mockup_scan

    workspace = _create_temp_workspace({
        "src/main.py": "x = 1\n",
    })
    _add_files_and_commit(workspace, {
        "src/empty.py": "def do_nothing():\n    {}\n",
    })
    result = anti_mockup_scan.run(workspace_path=workspace)
    empty_body = [f for f in result["findings"] if "Empty function body" in f["pattern"]]
    assert len(empty_body) > 0, f"Expected empty body finding, got {result['findings']}"


# ── Prompt Template (AC5) ─────────────────────────────────────────────


def test_inject_anti_stub_prompt():
    from workers.quality.prompt_template import inject_anti_stub_prompt

    base = "Fix the login bug"
    acs = ["Return 200 for valid login", "Return 401 for invalid password"]
    result = inject_anti_stub_prompt(base, acs)

    assert "ZERO TOLERANCE" in result
    assert "Every function MUST have a real implementation body" in result
    assert "No `TODO`, `FIXME`, `placeholder`, or `pass` stubs" in result
    assert "you will be audited" in result.lower()
    assert "- [ ] Return 200 for valid login" in result
    assert "- [ ] Return 401 for invalid password" in result
    assert result.startswith(base)


def test_inject_anti_stub_prompt_empty_acs():
    from workers.quality.prompt_template import inject_anti_stub_prompt

    result = inject_anti_stub_prompt("Do something", [])
    assert "Anti-Fake Enforcement" in result
    assert "Acceptance Criteria" in result


# ── Self-Audit (AC5, AC7) ─────────────────────────────────────────────


def test_run_self_audit_with_acs():
    from workers.tasks.self_audit import run_self_audit

    issue_context = {
        "issue_id": "test-001",
        "acceptance_criteria": ["AC1: login works", "AC2: validation works"],
    }
    verification_result = {"passed": True, "anti_mockup_findings": []}
    result = run_self_audit.run(
        issue_context=issue_context,
        verification_result=verification_result,
    )
    assert "checklist" in result
    assert "missing_items" in result
    assert len(result["checklist"]) == 2
    assert len(result["missing_items"]) == 2  # both start unmet (pending re-verification)
    assert result["passed"] is False  # fails because no ACs have been met yet


def test_run_self_audit_with_missing_acs():
    from workers.tasks.self_audit import run_self_audit

    issue_context = {
        "issue_id": "test-002",
        "acceptance_criteria": ["AC1: something"],
    }
    verification_result = {"passed": False, "anti_mockup_findings": []}
    result = run_self_audit.run(
        issue_context=issue_context,
        verification_result=verification_result,
    )
    assert result["passed"] is False  # AC not met, so audit fails
    assert len(result["missing_items"]) == 1


def test_run_self_audit_anti_mockup_findings():
    from workers.tasks.self_audit import run_self_audit

    issue_context = {"issue_id": "test-003", "acceptance_criteria": []}
    verification_result = {
        "passed": False,
        "anti_mockup_findings": [
            {"file": "src/handler.py", "line": 5, "pattern": "TODO comment", "severity": "blocking", "snippet": "// TODO fix"},
        ],
    }
    result = run_self_audit.run(
        issue_context=issue_context,
        verification_result=verification_result,
    )
    assert len(result["anti_mockup_findings"]) == 1
    assert result["passed"] is False


def test_orchestrate_pipeline():
    from workers.tasks.self_audit import orchestrate_pipeline

    issue_data = {"issue_id": "test-001"}
    result = orchestrate_pipeline.run(issue_data=issue_data)
    assert result["pipeline_status"] == "completed"
    assert len(result["pipeline_steps"]) == 7
    assert result["pipeline_steps"] == [
        "quality_analyze",
        "agent_dispatch",
        "verification",
        "self_audit",
        "anti_mockup_scan",
        "pr_creation",
        "review",
    ]


def test_orchestrate_pipeline_skip_quality():
    from workers.tasks.self_audit import orchestrate_pipeline

    issue_data = {"issue_id": "test-002", "skip_quality_analyze": True}
    result = orchestrate_pipeline.run(issue_data=issue_data)
    assert len(result["pipeline_steps"]) == 6
    assert "quality_analyze" not in result["pipeline_steps"]


def test_review_decision_all_pass():
    from workers.tasks.self_audit import review_decision

    pipeline_results = {
        "quality_analyze": {"status": "completed"},
        "agent_dispatch": {"status": "completed"},
        "verification": {"status": "completed"},
        "self_audit": {"passed": True, "status": "completed"},
        "anti_mockup_scan": {"passed": True, "status": "completed"},
        "pr_creation": {"status": "completed"},
    }
    result = review_decision.run(pipeline_results=pipeline_results)
    assert result["decision"] == "pass"
    assert result["passed"] is True


def test_review_decision_blocked():
    from workers.tasks.self_audit import review_decision

    pipeline_results = {
        "self_audit": {"passed": False, "status": "completed"},
        "anti_mockup_scan": {"passed": False, "status": "completed"},
    }
    result = review_decision.run(pipeline_results=pipeline_results)
    assert result["decision"] == "rework"
    assert result["passed"] is False
    assert len(result["failures"]) >= 2
