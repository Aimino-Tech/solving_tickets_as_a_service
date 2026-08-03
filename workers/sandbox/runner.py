"""SandboxRunner — runs test suites inside Docker containers.

This module maintains backward compatibility. New code should prefer the
fallback-chain API in ``workers.sandbox.fallback`` which provides automatic
provider selection (E2B -> Docker -> Noop) with circuit-breaker support.
"""

from __future__ import annotations

import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from .parsers import (
    SandboxResult,
    TestSummary,
    detect_framework,
    parse_test_output,
)

logger = logging.getLogger(__name__)


class SandboxError(Exception):
    """Base error for sandbox operations."""


class SandboxTimeoutError(SandboxError):
    """Timed out waiting for sandbox command to complete."""


class SandboxBuildError(SandboxError):
    """Failed to build or pull the sandbox image."""


# ── Helpers ─────────────────────────────────────────────────────────────────


def _docker_available() -> bool:
    """Check if the Docker CLI is available."""
    try:
        proc = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return proc.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _find_docker_image(language: str) -> str:
    """Map a project language to a default Docker image."""
    image_map: dict[str, str] = {
        "python": "python:3.12-slim",
        "typescript": "node:22-slim",
        "javascript": "node:22-slim",
        "node": "node:22-slim",
        "go": "golang:1.23-alpine",
        "rust": "rust:1.78-slim",
        "ruby": "ruby:3.3-slim",
        "java": "eclipse-temurin:21-jdk",
        "generic": "python:3.12-slim",
    }
    return image_map.get(language, image_map["generic"])


def _build_run_command(
    image: str,
    workspace_path: str,
    test_command: str,
    *,
    container_name: str = "",
    memory_limit: str = "2g",
    cpu_limit: float = 1.0,
    env_vars: dict[str, str] | None = None,
    extra_mounts: list[dict[str, str]] | None = None,
    workdir: str = "/workspace",
    seccomp_profile: str | None = None,
    apparmor_profile: str | None = None,
    read_only: bool = False,
    network_disabled: bool = False,
) -> list[str]:
    """Build the ``docker run`` command for the sandbox container."""
    cmd = [
        "docker", "run",
        "--rm",
        "--init",
        "--attach", "stdout",
        "--attach", "stderr",
    ]

    if container_name:
        cmd.extend(["--name", container_name])

    cmd.extend(["--memory", memory_limit])
    cmd.extend(["--cpus", str(cpu_limit)])

    if seccomp_profile:
        cmd.extend(["--security-opt", f"seccomp={seccomp_profile}"])
    if apparmor_profile:
        cmd.extend(["--security-opt", f"apparmor={apparmor_profile}"])
    if read_only:
        cmd.append("--read-only")
    if network_disabled:
        cmd.extend(["--network", "none"])

    cmd.extend(["--volume", f"{workspace_path}:{workdir}"])
    if extra_mounts:
        for mnt in extra_mounts:
            cmd.extend(["--volume", f"{mnt['host']}:{mnt['container']}"])

    cmd.extend(["--workdir", workdir])

    if env_vars:
        for key, val in env_vars.items():
            cmd.extend(["--env", f"{key}={val}"])

    cmd.append(image)
    cmd.extend(["sh", "-c", test_command])

    return cmd


# ── Language detection ──────────────────────────────────────────────────────


def detect_language(workspace_path: str) -> str:
    """Detect the project language from config files in the workspace."""
    ws = Path(workspace_path)

    if (ws / "pyproject.toml").exists() or (ws / "setup.py").exists() or (ws / "requirements.txt").exists():
        return "python"
    if (ws / "package.json").exists():
        if (ws / "go.mod").exists():
            return "go"
        return "node"
    if (ws / "go.mod").exists():
        return "go"
    if (ws / "Cargo.toml").exists():
        return "rust"
    if (ws / "Gemfile").exists() or list(ws.glob("*.gemspec")):
        return "ruby"
    if (ws / "pom.xml").exists() or (ws / "build.gradle").exists():
        return "java"
    return "generic"


def detect_test_command(workspace_path: str) -> str:
    """Auto-detect the test command for a project."""
    lang = detect_language(workspace_path)

    commands: dict[str, str] = {
        "python": "python -m pytest -v --tb=short 2>&1 || python -m unittest discover -v 2>&1",
        "node": "npm test 2>&1 || npx vitest run --reporter=verbose 2>&1 || npx jest --verbose 2>&1",
        "go": "go test ./... -v 2>&1",
        "rust": "cargo test 2>&1",
        "ruby": "bundle exec rspec 2>&1",
        "java": "mvn test 2>&1 || gradle test 2>&1",
    }
    return commands.get(lang, "python -m pytest -v --tb=short 2>&1")


# ── SandboxRunner ───────────────────────────────────────────────────────────


class SandboxRunner:
    """Run test suites inside Docker containers with resource isolation.

    When *use_fallback_chain* is True (or a FallbackChain is passed) the
    runner delegates to the fallback chain instead of using Docker directly.
    """

    def __init__(
        self,
        docker_image: str | None = None,
        timeout_seconds: int = 300,
        memory_limit: str = "2g",
        cpu_limit: float = 1.0,
        seccomp_profile: str | None = None,
        apparmor_profile: str | None = None,
        read_only_rootfs: bool = True,
        network_disabled: bool = False,
        env_vars: dict[str, str] | None = None,
        *,
        use_fallback_chain: bool = False,
        fallback_chain: Any = None,
    ) -> None:
        self.docker_image = docker_image
        self.timeout_seconds = timeout_seconds
        self.memory_limit = memory_limit
        self.cpu_limit = cpu_limit
        self.seccomp_profile = seccomp_profile
        self.apparmor_profile = apparmor_profile
        self.read_only_rootfs = read_only_rootfs
        self.network_disabled = network_disabled
        self.env_vars = env_vars or {}
        self.use_fallback_chain = use_fallback_chain
        self._fallback_chain = fallback_chain

    def run_tests(
        self,
        workspace_path: str,
        test_command: str = "",
        *,
        capture_json: bool = False,
        capture_xml: bool = False,
        container_name: str = "",
    ) -> SandboxResult:
        """Run the test suite in a Docker container.

        When *use_fallback_chain* was set on the constructor this delegates
        to the fallback chain (E2B -> Docker -> Noop) instead.
        """
        if self.use_fallback_chain:
            from .fallback import FallbackChain
            chain = self._fallback_chain or FallbackChain()
            return chain.run_tests(
                workspace_path=workspace_path,
                test_command=test_command,
                capture_json=capture_json,
                capture_xml=capture_xml,
                timeout_seconds=self.timeout_seconds,
                env_vars=self.env_vars,
            )

        ws = Path(workspace_path)
        if not ws.is_dir():
            raise SandboxError(f"Workspace path does not exist: {workspace_path}")

        if not test_command:
            test_command = detect_test_command(workspace_path)
            logger.info("Auto-detected test command: %s", test_command)

        image = self.docker_image
        if not image:
            lang = detect_language(workspace_path)
            image = _find_docker_image(lang)
            logger.info("Auto-selected Docker image %s for language %s", image, lang)

        json_output: str | None = None
        xml_content: str | None = None

        if capture_json or capture_xml:
            test_command = self._inject_capture_flags(
                test_command, capture_json=capture_json, capture_xml=capture_xml,
                workspace_path=workspace_path,
            )

        cmd = _build_run_command(
            image=image,
            workspace_path=workspace_path,
            test_command=test_command,
            container_name=container_name,
            memory_limit=self.memory_limit,
            cpu_limit=self.cpu_limit,
            seccomp_profile=self.seccomp_profile,
            apparmor_profile=self.apparmor_profile,
            read_only=self.read_only_rootfs,
            network_disabled=self.network_disabled,
            env_vars=self.env_vars,
        )

        logger.info(
            "Running sandbox: image=%s memory=%s cpu=%.1f timeout=%ds",
            image, self.memory_limit, self.cpu_limit, self.timeout_seconds,
        )

        start = time.monotonic()
        result = self._run_docker(cmd)
        elapsed_ms = int((time.monotonic() - start) * 1000)
        result.duration_ms = elapsed_ms

        if capture_xml and result.exit_code in (0, 1):
            xml_content = self._read_captured_xml(workspace_path)
        if capture_json and result.exit_code in (0, 1):
            json_output = self._read_captured_json(workspace_path)

        summary = parse_test_output(
            exit_code=result.exit_code,
            output=result.raw_output,
            command=test_command,
            json_output=json_output,
            xml_content=xml_content,
        )
        summary.output = result.raw_output
        result.summary = summary

        self._cleanup_captured(workspace_path)

        logger.info(
            "Sandbox result: %s (exit=%d, tests=%d, time=%dms)",
            "PASS" if result.passed else "FAIL",
            result.exit_code,
            summary.total,
            elapsed_ms,
        )

        return result

    def _run_docker(self, cmd: list[str]) -> SandboxResult:
        """Execute the ``docker run`` command and collect output."""
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            logger.error("Sandbox command timed out after %ds", self.timeout_seconds)
            return SandboxResult(
                exit_code=-1,
                timed_out=True,
                raw_output=f"TIMEOUT: test command exceeded {self.timeout_seconds}s",
                error_message=f"Timed out after {self.timeout_seconds}s",
            )

        if proc.returncode != 0:
            logger.warning(
                "Sandbox command failed (exit=%d): %s",
                proc.returncode,
                proc.stderr[:500] if proc.stderr else "(no stderr)",
            )

        output = proc.stdout or ""
        if proc.stderr:
            if output:
                output += "\n"
            output += proc.stderr

        return SandboxResult(
            exit_code=proc.returncode,
            raw_output=output,
        )

    def _inject_capture_flags(
        self,
        command: str,
        *,
        capture_json: bool,
        capture_xml: bool,
        workspace_path: str,
    ) -> str:
        """Inject ``--json`` / ``--junitxml`` flags for better parsing."""
        framework = detect_framework(command)

        if framework == "pytest" and capture_xml:
            xml_path = os.path.join(workspace_path, ".syntaro-test-report.xml")
            command = f"{command} --junitxml={xml_path} 2>&1; echo __SYNTARO_XML_DONE__"

        elif framework in ("vitest", "jest") and capture_json:
            json_path = os.path.join(workspace_path, ".syntaro-test-results.json")
            if framework == "vitest":
                command = f"{command} --reporter=json --outputFile={json_path} 2>&1; echo __SYNTARO_JSON_DONE__"
            else:
                command = f"{command} --json --outputFile={json_path} 2>&1; echo __SYNTARO_JSON_DONE__"

        elif framework == "go" and capture_json:
            command = f"cd '{os.path.dirname(workspace_path)}' && go test -json ./... 2>&1"

        return command

    def _read_captured_xml(self, workspace_path: str) -> str | None:
        """Read JUnit XML captured from the test run."""
        xml_path = Path(workspace_path) / ".syntaro-test-report.xml"
        if xml_path.exists():
            try:
                return xml_path.read_text()
            except OSError:
                pass
        return None

    def _read_captured_json(self, workspace_path: str) -> str | None:
        """Read JSON output captured from the test run."""
        json_path = Path(workspace_path) / ".syntaro-test-results.json"
        if json_path.exists():
            try:
                return json_path.read_text()
            except OSError:
                pass
        return None

    def _cleanup_captured(self, workspace_path: str) -> None:
        """Remove temporary capture files from the workspace."""
        for name in (".syntaro-test-report.xml", ".syntaro-test-results.json"):
            p = Path(workspace_path) / name
            if p.exists():
                try:
                    p.unlink()
                except OSError:
                    pass


def create_runner(**kwargs: Any) -> SandboxRunner:
    """Factory: create a ``SandboxRunner`` from keyword args.

    Pass ``use_fallback_chain=True`` to enable the fallback chain
    (E2B -> Docker -> Noop) instead of direct Docker execution.
    """
    return SandboxRunner(**kwargs)
