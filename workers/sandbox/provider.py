"""
Sandbox providers -- abstract interface + E2B / Docker / Noop implementations.

Each provider implements the ``SandboxProvider`` ABC so the fallback chain can
swap between them transparently.
"""

from __future__ import annotations

import logging
import os
import subprocess
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from .parsers import SandboxResult
from .runner import detect_test_command

logger = logging.getLogger(__name__)

__all__ = [
    "SandboxProvider",
    "E2BSandbox",
    "DockerSandbox",
    "NoopSandbox",
    "ProviderError",
]


class ProviderError(Exception):
    """Base error for sandbox provider failures."""


class SandboxProvider(ABC):
    """Abstract sandbox provider.

    Every provider must be able to run a test command inside an isolated
    execution environment and report the result.
    """

    name: str = "abstract"

    @abstractmethod
    def run_tests(
        self,
        workspace_path: str,
        test_command: str = "",
        *,
        capture_json: bool = False,
        capture_xml: bool = False,
        timeout_seconds: int = 300,
        env_vars: dict[str, str] | None = None,
    ) -> SandboxResult:
        ...

    def create(self) -> None:
        """Provision the sandbox environment.

        Called once before the first ``run_tests`` call for a given session.
        Default implementation is a no-op.
        """

    def destroy(self) -> None:
        """Tear down the sandbox environment.

        Called after the session completes to release resources.
        Default implementation is a no-op.
        """

    @property
    def is_available(self) -> bool:
        """Whether this provider can be used right now."""
        return True


# -- E2B provider (primary) ------------------------------------------------


class E2BSandbox(SandboxProvider):
    """E2B cloud sandbox -- primary execution provider.

    Runs code inside an E2B Sandbox (https://e2b.dev). Requires the
    ``E2B_API_KEY`` environment variable.
    """

    name = "e2b"

    def __init__(
        self,
        template_id: str | None = None,
        timeout_ms: int = 300_000,
        api_key: str | None = None,
    ) -> None:
        self.template_id = template_id or os.getenv("E2B_TEMPLATE_ID", "default")
        self.timeout_ms = timeout_ms
        self.api_key = api_key or os.getenv("E2B_API_KEY", "")
        self._sandbox: Any = None

    @property
    def is_available(self) -> bool:
        return bool(self.api_key)

    def create(self) -> None:
        if not self.is_available:
            raise ProviderError("E2B_API_KEY is not configured")
        try:
            from e2b import Sandbox as E2BSandboxClient

            logger.info(
                "Creating E2B sandbox -- template=%s timeout=%dms",
                self.template_id,
                self.timeout_ms,
            )
            self._sandbox = E2BSandboxClient(
                template=self.template_id,
                api_key=self.api_key,
                timeout_ms=self.timeout_ms,
            )
            logger.info("E2B sandbox created -- id=%s", self._sandbox.id)
        except ImportError:
            raise ProviderError(
                "e2b package not installed. Install with: pip install e2b"
            ) from None
        except Exception as exc:
            raise ProviderError(f"Failed to create E2B sandbox: {exc}") from exc

    def destroy(self) -> None:
        if self._sandbox is not None:
            try:
                sandbox_id = getattr(self._sandbox, "id", "unknown")
                self._sandbox.kill()
                logger.info("E2B sandbox destroyed -- id=%s", sandbox_id)
            except Exception as exc:
                logger.warning("Failed to destroy E2B sandbox: %s", exc)
            finally:
                self._sandbox = None

    def run_tests(
        self,
        workspace_path: str,
        test_command: str = "",
        *,
        capture_json: bool = False,
        capture_xml: bool = False,
        timeout_seconds: int = 300,
        env_vars: dict[str, str] | None = None,
    ) -> SandboxResult:
        if not test_command:
            test_command = detect_test_command(workspace_path)
            logger.info("E2B: auto-detected test command: %s", test_command)

        if self._sandbox is None:
            self.create()

        if self._sandbox is None:
            raise ProviderError("E2B sandbox not initialized")

        start = time.monotonic()
        try:
            result = self._sandbox.run_command(
                cmd=test_command,
                timeout=timeout_seconds * 1000,
                env=env_vars or {},
            )
            elapsed_ms = int((time.monotonic() - start) * 1000)

            sandbox_result = SandboxResult(
                exit_code=result.exit_code if hasattr(result, "exit_code") else 0,
                raw_output=result.stdout if hasattr(result, "stdout") else str(result),
                error_message=result.stderr if hasattr(result, "stderr") else "",
            )
            sandbox_result.duration_ms = elapsed_ms
            return sandbox_result

        except Exception as exc:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            err_msg = str(exc)
            logger.error("E2B run_tests failed: %s", err_msg)
            return SandboxResult(
                exit_code=-1,
                raw_output="",
                error_message=err_msg,
                duration_ms=elapsed_ms,
            )


# -- Docker provider (secondary) --------------------------------------------


class DockerSandbox(SandboxProvider):
    """Docker-local sandbox -- secondary execution provider.

    Runs tests inside a local Docker container with resource isolation.
    Reuses the existing ``_build_run_command`` helper from the runner module.
    """

    name = "docker"

    def __init__(
        self,
        docker_image: str | None = None,
        memory_limit: str = "2g",
        cpu_limit: float = 1.0,
        seccomp_profile: str | None = None,
        apparmor_profile: str | None = None,
        read_only_rootfs: bool = True,
        network_disabled: bool = False,
    ) -> None:
        self.docker_image = docker_image
        self.memory_limit = memory_limit
        self.cpu_limit = cpu_limit
        self.seccomp_profile = seccomp_profile
        self.apparmor_profile = apparmor_profile
        self.read_only_rootfs = read_only_rootfs
        self.network_disabled = network_disabled

    @property
    def is_available(self) -> bool:
        return _docker_available()

    def run_tests(
        self,
        workspace_path: str,
        test_command: str = "",
        *,
        capture_json: bool = False,
        capture_xml: bool = False,
        timeout_seconds: int = 300,
        env_vars: dict[str, str] | None = None,
    ) -> SandboxResult:
        from .runner import (
            _build_run_command,
            _find_docker_image,
            detect_language,
            detect_test_command as detect_cmd,
        )

        ws = Path(workspace_path)
        if not ws.is_dir():
            raise ProviderError(f"Workspace path does not exist: {workspace_path}")

        if not test_command:
            test_command = detect_cmd(workspace_path)
            logger.info("Docker: auto-detected test command: %s", test_command)

        image = self.docker_image
        if not image:
            lang = detect_language(workspace_path)
            image = _find_docker_image(lang)
            logger.info("Docker: auto-selected image %s for language %s", image, lang)

        cmd = _build_run_command(
            image=image,
            workspace_path=workspace_path,
            test_command=test_command,
            memory_limit=self.memory_limit,
            cpu_limit=self.cpu_limit,
            seccomp_profile=self.seccomp_profile,
            apparmor_profile=self.apparmor_profile,
            read_only=self.read_only_rootfs,
            network_disabled=self.network_disabled,
            env_vars=env_vars,
        )

        logger.info(
            "Docker sandbox: image=%s memory=%s cpu=%.1f timeout=%ds",
            image, self.memory_limit, self.cpu_limit, timeout_seconds,
        )

        start = time.monotonic()
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
            )
        except subprocess.TimeoutExpired:
            elapsed_ms = int((time.monotonic() - start) * 1000)
            logger.error("Docker sandbox timed out after %ds", timeout_seconds)
            return SandboxResult(
                exit_code=-1,
                timed_out=True,
                raw_output=f"TIMEOUT: test command exceeded {timeout_seconds}s",
                error_message=f"Timed out after {timeout_seconds}s",
                duration_ms=elapsed_ms,
            )

        elapsed_ms = int((time.monotonic() - start) * 1000)

        if proc.returncode != 0:
            logger.warning(
                "Docker sandbox failed (exit=%d): %s",
                proc.returncode,
                proc.stderr[:500] if proc.stderr else "(no stderr)",
            )

        output = proc.stdout or ""
        if proc.stderr:
            if output:
                output += "\n"
            output += proc.stderr

        result = SandboxResult(
            exit_code=proc.returncode,
            raw_output=output,
            duration_ms=elapsed_ms,
        )
        return result


# -- Noop provider (fallback, analysis-only) -------------------------------


class NoopSandbox(SandboxProvider):
    """No-operation sandbox -- analysis-only fallback.

    When neither E2B nor Docker is available this provider logs what *would*
    have run and returns a ``SandboxResult`` that signals the sandbox was
    skipped. Callers can still analyse the request payload / workspace but
    cannot execute code.
    """

    name = "none"

    def run_tests(
        self,
        workspace_path: str,
        test_command: str = "",
        *,
        capture_json: bool = False,
        capture_xml: bool = False,
        timeout_seconds: int = 300,
        env_vars: dict[str, str] | None = None,
    ) -> SandboxResult:
        logger.warning(
            "NoopSandbox: skipping test execution -- workspace=%s command=%s "
            "(no sandbox provider available)",
            workspace_path,
            test_command or "(auto)",
        )

        result = SandboxResult(
            exit_code=0,
            raw_output=(
                "SANDBOX_UNAVAILABLE: No sandbox provider could execute tests. "
                "This is an analysis-only run.\n"
            ),
            error_message="No sandbox provider available",
        )
        result.duration_ms = 0
        return result


# -- Internal helpers ------------------------------------------------------


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
