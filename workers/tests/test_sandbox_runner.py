"""Tests for workers.sandbox.runner."""

import os
import tempfile
from unittest.mock import patch, MagicMock

from workers.sandbox.runner import (
    SandboxRunner,
    SandboxError,
    SandboxTimeoutError,
    detect_language,
    detect_test_command,
    _docker_available,
    _find_docker_image,
    _build_run_command,
)


def _create_workspace(files: list[str]) -> str:
    tmpdir = tempfile.mkdtemp()
    for path in files:
        full_path = os.path.join(tmpdir, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write("")
    return tmpdir


class TestDetectLanguage:
    def test_python_requirements(self):
        ws = _create_workspace(["requirements.txt"])
        try:
            assert detect_language(ws) == "python"
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_python_pyproject(self):
        ws = _create_workspace(["pyproject.toml"])
        try:
            assert detect_language(ws) == "python"
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_node(self):
        ws = _create_workspace(["package.json"])
        try:
            assert detect_language(ws) == "node"
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_go(self):
        ws = _create_workspace(["go.mod"])
        try:
            assert detect_language(ws) == "go"
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_node_with_go(self):
        ws = _create_workspace(["package.json", "go.mod"])
        try:
            assert detect_language(ws) == "go"
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_rust(self):
        ws = _create_workspace(["Cargo.toml"])
        try:
            assert detect_language(ws) == "rust"
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_generic(self):
        ws = _create_workspace(["README.md"])
        try:
            assert detect_language(ws) == "generic"
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)


class TestDetectTestCommand:
    def test_python(self):
        ws = _create_workspace(["requirements.txt"])
        try:
            cmd = detect_test_command(ws)
            assert "pytest" in cmd
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_node(self):
        ws = _create_workspace(["package.json"])
        try:
            cmd = detect_test_command(ws)
            assert "npm test" in cmd
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_go(self):
        ws = _create_workspace(["go.mod"])
        try:
            cmd = detect_test_command(ws)
            assert "go test" in cmd
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)

    def test_rust(self):
        ws = _create_workspace(["Cargo.toml"])
        try:
            cmd = detect_test_command(ws)
            assert "cargo test" in cmd
        finally:
            import shutil; shutil.rmtree(ws, ignore_errors=True)


class TestDockerAvailable:
    @patch("workers.sandbox.runner.subprocess.run")
    def test_available(self, mock_run):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "24.0.0"
        assert _docker_available() is True

    @patch("workers.sandbox.runner.subprocess.run")
    def test_not_available(self, mock_run):
        mock_run.return_value.returncode = 1
        assert _docker_available() is False

    @patch("workers.sandbox.runner.subprocess.run", side_effect=FileNotFoundError)
    def test_not_installed(self, mock_run):
        assert _docker_available() is False


class TestFindDockerImage:
    def test_python(self):
        assert "python" in _find_docker_image("python")

    def test_node(self):
        assert "node" in _find_docker_image("node")

    def test_go(self):
        assert "golang" in _find_docker_image("go")

    def test_rust(self):
        assert "rust" in _find_docker_image("rust")

    def test_unknown(self):
        assert "python" in _find_docker_image("unknown")


class TestBuildRunCommand:
    def test_basic(self):
        cmd = _build_run_command(image="python:3.12-slim", workspace_path="/tmp/ws", test_command="pytest -v")
        cmd_str = " ".join(cmd)
        assert "docker" in cmd_str
        assert "--rm" in cmd_str
        assert "--init" in cmd_str
        assert "python:3.12-slim" in cmd_str
        assert "/tmp/ws:/workspace" in cmd_str
        assert "pytest -v" in cmd_str

    def test_resource_limits(self):
        cmd = _build_run_command(image="node:22-slim", workspace_path="/tmp/ws", test_command="npm test", memory_limit="512m", cpu_limit=0.5)
        cmd_str = " ".join(cmd)
        assert "--memory 512m" in cmd_str
        assert "--cpus 0.5" in cmd_str

    def test_container_name(self):
        cmd = _build_run_command(image="python:3.12-slim", workspace_path="/tmp/ws", test_command="pytest", container_name="test-runner")
        assert "--name test-runner" in " ".join(cmd)

    def test_security(self):
        cmd = _build_run_command(
            image="python:3.12-slim", workspace_path="/tmp/ws", test_command="pytest",
            seccomp_profile="/etc/docker/seccomp/sandbox.json", apparmor_profile="stas-sandbox",
            read_only=True, network_disabled=True,
        )
        cmd_str = " ".join(cmd)
        assert "seccomp=/etc/docker/seccomp/sandbox.json" in cmd_str
        assert "apparmor=stas-sandbox" in cmd_str
        assert "--read-only" in cmd_str
        assert "--network none" in cmd_str

    def test_env_vars(self):
        cmd = _build_run_command(image="python:3.12-slim", workspace_path="/tmp/ws", test_command="pytest", env_vars={"CI": "true", "STAS_VERIFY": "1"})
        cmd_str = " ".join(cmd)
        assert "--env CI=true" in cmd_str
        assert "--env STAS_VERIFY=1" in cmd_str


class TestSandboxRunnerRunTests:
    @patch("workers.sandbox.runner.subprocess.run")
    @patch("workers.sandbox.runner.Path.is_dir")
    def test_success(self, mock_isdir, mock_run):
        mock_isdir.return_value = True
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "5 passed in 0.5s"
        mock_run.return_value.stderr = ""
        runner = SandboxRunner(docker_image="python:3.12-slim", timeout_seconds=30)
        result = runner.run_tests(workspace_path="/tmp/fake-ws", test_command="python -m pytest")
        assert result.passed is True
        assert result.exit_code == 0
        assert result.summary.passed == 5
        assert result.duration_ms >= 0

    @patch("workers.sandbox.runner.subprocess.run")
    @patch("workers.sandbox.runner.Path.is_dir")
    def test_failure(self, mock_isdir, mock_run):
        mock_isdir.return_value = True
        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = "3 passed, 2 failed in 0.5s"
        mock_run.return_value.stderr = ""
        runner = SandboxRunner(docker_image="python:3.12-slim", timeout_seconds=30)
        result = runner.run_tests(workspace_path="/tmp/fake-ws", test_command="python -m pytest")
        assert result.passed is False
        assert result.exit_code == 1
        assert result.summary.passed == 3
        assert result.summary.failed == 2

    @patch("workers.sandbox.runner.subprocess.run")
    @patch("workers.sandbox.runner.Path.is_dir")
    def test_timeout(self, mock_isdir, mock_run):
        mock_isdir.return_value = True
        from subprocess import TimeoutExpired
        mock_run.side_effect = TimeoutExpired(cmd="docker run", timeout=30)
        runner = SandboxRunner(docker_image="python:3.12-slim", timeout_seconds=30)
        result = runner.run_tests(workspace_path="/tmp/fake-ws", test_command="python -m pytest")
        assert result.passed is False
        assert result.timed_out is True
        assert "TIMEOUT" in result.raw_output

    @patch("workers.sandbox.runner.Path.is_dir")
    def test_bad_workspace(self, mock_isdir):
        mock_isdir.return_value = False
        runner = SandboxRunner(docker_image="python:3.12-slim")
        try:
            runner.run_tests(workspace_path="/nonexistent")
            assert False, "Expected SandboxError"
        except SandboxError:
            pass

    @patch("workers.sandbox.runner.detect_test_command")
    @patch("workers.sandbox.runner.subprocess.run")
    @patch("workers.sandbox.runner.Path.is_dir")
    def test_auto_detect_command(self, mock_isdir, mock_run, mock_detect):
        mock_isdir.return_value = True
        mock_detect.return_value = "npm test"
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "Tests: 10 passed, 10 total"
        mock_run.return_value.stderr = ""
        runner = SandboxRunner(docker_image="node:22-slim", timeout_seconds=30)
        result = runner.run_tests(workspace_path="/tmp/fake-ws")
        assert result.passed is True
        mock_detect.assert_called_once()

    @patch("workers.sandbox.runner.detect_language")
    @patch("workers.sandbox.runner.subprocess.run")
    @patch("workers.sandbox.runner.Path.is_dir")
    def test_auto_detect_image(self, mock_isdir, mock_run, mock_lang):
        mock_isdir.return_value = True
        mock_lang.return_value = "rust"
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "test result: ok. 42 passed; 0 failed"
        mock_run.return_value.stderr = ""
        runner = SandboxRunner(timeout_seconds=30)
        result = runner.run_tests(workspace_path="/tmp/fake-ws", test_command="cargo test")
        assert result.passed is True
        assert result.summary.passed == 42
        cmd_str = " ".join(mock_run.call_args[0][0])
        assert "rust" in cmd_str


class TestSandboxErrors:
    def test_sandbox_error_is_exception(self):
        assert issubclass(SandboxError, Exception)

    def test_sandbox_timeout_error_is_sandbox_error(self):
        assert issubclass(SandboxTimeoutError, SandboxError)
