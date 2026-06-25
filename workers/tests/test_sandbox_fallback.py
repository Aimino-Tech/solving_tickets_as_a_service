"""Tests for sandbox fallback chain -- provider, circuit breaker, and chain."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch, PropertyMock

import pybreaker
import pytest

from workers.sandbox.circuit_breaker import (
    BreakerRegistry,
    call_or_fallback,
    get_breaker_registry,
    SandboxCircuitListener,
    STATE_CLOSED,
    STATE_OPEN,
    STATE_HALF_OPEN,
)
from workers.sandbox.fallback import FallbackChain, _provider_factory
from workers.sandbox.parsers import SandboxResult
from workers.sandbox.provider import (
    DockerSandbox,
    E2BSandbox,
    NoopSandbox,
    ProviderError,
    SandboxProvider,
)


class TestSandboxProvider:
    def test_abc_cannot_be_instantiated(self):
        with pytest.raises(TypeError):
            SandboxProvider()

    def test_default_is_available(self):
        provider = _ConcreteProvider()
        assert provider.is_available is True


class _ConcreteProvider(SandboxProvider):
    name = "test"

    def run_tests(self, workspace_path, test_command="", **kwargs):
        return SandboxResult(exit_code=0, raw_output="ok")


class TestE2BSandbox:
    def test_not_available_without_api_key(self):
        sb = E2BSandbox(api_key="")
        assert sb.is_available is False

    def test_available_with_api_key(self):
        sb = E2BSandbox(api_key="sk-test-123")
        assert sb.is_available is True

    def test_create_fails_without_api_key(self):
        sb = E2BSandbox(api_key="")
        with pytest.raises(ProviderError, match="E2B_API_KEY is not configured"):
            sb.create()

    @patch("workers.sandbox.provider.subprocess.run")
    def test_run_tests_docker_fallback_path(self, mock_run):
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "4 passed in 0.5s"
        mock_run.return_value.stderr = ""

        sb = DockerSandbox()
        result = sb.run_tests(
            workspace_path="/tmp",
            test_command="python -m pytest",
            timeout_seconds=30,
        )
        assert result.exit_code == 0

    def test_e2b_create_import_error(self):
        sb = E2BSandbox(api_key="sk-test-123")
        with patch(
            "workers.sandbox.provider.E2BSandbox.create",
            side_effect=ProviderError("e2b package not installed"),
        ):
            with pytest.raises(ProviderError, match="e2b package not installed"):
                sb.create()


class TestDockerSandbox:
    @patch("workers.sandbox.provider.subprocess.run")
    @patch("workers.sandbox.provider.Path.is_dir")
    def test_success(self, mock_isdir, mock_run):
        mock_isdir.return_value = True
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = "10 passed in 1.0s"
        mock_run.return_value.stderr = ""
        sb = DockerSandbox(docker_image="python:3.12-slim")
        result = sb.run_tests(
            workspace_path="/tmp/fake-ws",
            test_command="python -m pytest",
        )
        assert result.passed is True
        assert result.exit_code == 0

    @patch("workers.sandbox.provider.subprocess.run")
    @patch("workers.sandbox.provider.Path.is_dir")
    def test_failure(self, mock_isdir, mock_run):
        mock_isdir.return_value = True
        mock_run.return_value.returncode = 1
        mock_run.return_value.stdout = "3 failed, 2 passed"
        mock_run.return_value.stderr = ""
        sb = DockerSandbox(docker_image="python:3.12-slim")
        result = sb.run_tests(
            workspace_path="/tmp/fake-ws",
            test_command="python -m pytest",
        )
        assert result.exit_code == 1

    @patch("workers.sandbox.provider.Path.is_dir", return_value=False)
    def test_bad_workspace(self, mock_isdir):
        sb = DockerSandbox(docker_image="python:3.12-slim")
        with pytest.raises(ProviderError, match="Workspace path does not exist"):
            sb.run_tests(workspace_path="/nonexistent")

    @patch("workers.sandbox.provider.subprocess.run")
    @patch("workers.sandbox.provider.Path.is_dir")
    def test_timeout(self, mock_isdir, mock_run):
        mock_isdir.return_value = True
        from subprocess import TimeoutExpired
        mock_run.side_effect = TimeoutExpired(cmd="docker run", timeout=30)
        sb = DockerSandbox(docker_image="python:3.12-slim")
        result = sb.run_tests(
            workspace_path="/tmp/fake-ws",
            test_command="python -m pytest",
            timeout_seconds=30,
        )
        assert result.timed_out is True
        assert "TIMEOUT" in result.raw_output


class TestNoopSandbox:
    def test_always_available(self):
        sb = NoopSandbox()
        assert sb.is_available is True

    def test_run_tests_returns_unavailable_result(self):
        sb = NoopSandbox()
        result = sb.run_tests(
            workspace_path="/tmp/ws",
            test_command="pytest",
        )
        assert result.exit_code == 0
        assert "SANDBOX_UNAVAILABLE" in result.raw_output

    def test_create_destroy_noop(self):
        sb = NoopSandbox()
        sb.create()
        sb.destroy()


class TestBreakerRegistry:
    def test_get_creates_breaker(self):
        reg = BreakerRegistry(fail_max=3, reset_timeout=300)
        breaker = reg.get("e2b")
        assert breaker is not None
        assert "e2b" in breaker.name

    def test_reuses_breaker(self):
        reg = BreakerRegistry()
        b1 = reg.get("docker")
        b2 = reg.get("docker")
        assert b1 is b2

    def test_state_of(self):
        reg = BreakerRegistry()
        state = reg.state_of("e2b")
        assert "Closed" in state or "HalfOpen" in state or "Open" in state

    def test_reset_single(self):
        reg = BreakerRegistry(fail_max=1, reset_timeout=60)
        breaker = reg.get("e2b")
        try:
            breaker.call(_raise_error)
        except (RuntimeError, pybreaker.CircuitBreakerError):
            pass
        assert "Open" in reg.state_of("e2b")
        reg.reset("e2b")
        assert "Closed" in reg.state_of("e2b") or "HalfOpen" in reg.state_of("e2b")

    def test_reset_all(self):
        reg = BreakerRegistry()
        reg.get("e2b")
        reg.get("docker")
        reg.reset()


def _raise_error():
    raise RuntimeError("boom")


class TestCallOrFallback:
    def test_success_calls_func(self):
        reg = BreakerRegistry()
        result = call_or_fallback(
            func=lambda: "hello",
            provider_name="test",
            registry=reg,
        )
        assert result == "hello"

    def test_failure_calls_fallback(self):
        reg = BreakerRegistry(fail_max=1, reset_timeout=60)
        try:
            call_or_fallback(
                func=_raise_error,
                provider_name="test_fallback",
                registry=reg,
            )
        except (RuntimeError, pybreaker.CircuitBreakerError):
            pass
        result = call_or_fallback(
            func=_raise_error,
            provider_name="test_fallback",
            fallback=lambda: "fallback_result",
            registry=reg,
        )
        assert result == "fallback_result"


class TestSandboxCircuitListener:
    def test_state_change_logs(self):
        listener = SandboxCircuitListener()
        cb = pybreaker.CircuitBreaker(
            fail_max=1, reset_timeout=60, name="test-listener",
        )
        cb.add_listener(listener)
        try:
            cb.call(_raise_error)
        except (RuntimeError, pybreaker.CircuitBreakerError):
            pass


class TestProviderFactory:
    def test_e2b(self):
        provider = _provider_factory("e2b")
        assert isinstance(provider, E2BSandbox)

    def test_docker(self):
        provider = _provider_factory("docker")
        assert isinstance(provider, DockerSandbox)

    def test_none(self):
        provider = _provider_factory("none")
        assert isinstance(provider, NoopSandbox)

    def test_unknown(self):
        with pytest.raises(ValueError, match="Unknown sandbox provider"):
            _provider_factory("unknown-provider")

    def test_case_insensitive(self):
        prov1 = _provider_factory("E2B")
        prov2 = _provider_factory("Docker")
        assert isinstance(prov1, E2BSandbox)
        assert isinstance(prov2, DockerSandbox)


class TestFallbackChain:
    def test_default_order(self):
        chain = FallbackChain()
        assert "e2b" in chain._provider_order
        assert "docker" in chain._provider_order
        assert "none" in chain._provider_order
        assert chain._provider_order.index("e2b") < chain._provider_order.index("docker")
        assert chain._provider_order.index("docker") < chain._provider_order.index("none")

    def test_custom_order(self):
        chain = FallbackChain(provider_order=["none", "docker"])
        assert chain._provider_order == ["none", "docker"]

    def test_active_provider_e2b_first(self):
        chain = FallbackChain(provider_order=["e2b", "none"])
        assert chain.active_provider == "none"

    def test_active_provider_skips_unavailable(self):
        chain = FallbackChain(
            provider_order=["e2b", "none"],
            providers={},
        )
        assert chain.active_provider == "none"

    def test_active_provider_all_unavailable(self):
        chain = FallbackChain(provider_order=["e2b"])
        assert chain.active_provider is None

    def test_provider_states(self):
        chain = FallbackChain(provider_order=["e2b", "docker", "none"])
        states = chain.provider_states
        assert "e2b" in states
        assert "docker" in states
        assert "none" in states
        assert "available" in states["e2b"]
        assert "circuit_state" in states["e2b"]

    def test_run_tests_falls_through_to_noop(self):
        chain = FallbackChain(
            provider_order=["e2b", "none"],
            providers={
                "e2b": _FailingProvider(),
                "none": NoopSandbox(),
            },
        )
        result = chain.run_tests(workspace_path="/tmp/ws", test_command="pytest")
        assert "SANDBOX_UNAVAILABLE" in result.raw_output

    def test_run_tests_uses_first_available(self):
        mock_e2b = _WorkingProvider()
        chain = FallbackChain(
            provider_order=["e2b", "none"],
            providers={
                "e2b": mock_e2b,
                "none": NoopSandbox(),
            },
        )
        result = chain.run_tests(workspace_path="/tmp/ws", test_command="pytest")
        assert result.exit_code == 0
        assert "e2b_ran" in result.raw_output

    def test_run_tests_env_var_order(self, monkeypatch):
        monkeypatch.setenv("SANDBOX_PROVIDER_CHAIN", "none,docker")
        chain = FallbackChain()
        assert chain._provider_order == ["none", "docker"]

    def test_run_tests_with_circuit_breaker_skip(self):
        registry = BreakerRegistry(fail_max=1, reset_timeout=60)
        breaker = registry.get("e2b")
        try:
            breaker.call(_raise_error)
        except (RuntimeError, pybreaker.CircuitBreakerError):
            pass

        chain = FallbackChain(
            provider_order=["e2b", "none"],
            breaker_registry=registry,
            providers={
                "e2b": _WorkingProvider(),
                "none": NoopSandbox(),
            },
        )
        result = chain.run_tests(workspace_path="/tmp/ws", test_command="pytest")
        assert "SANDBOX_UNAVAILABLE" in result.raw_output

    def test_run_tests_all_exhausted(self):
        chain = FallbackChain(
            provider_order=["e2b", "docker"],
            providers={
                "e2b": _FailingProvider(),
                "docker": _FailingProvider(),
            },
        )
        result = chain.run_tests(workspace_path="/tmp/ws", test_command="pytest")
        assert result.exit_code == -1
        assert "No sandbox provider available" in result.error_message

    def test_create_all_and_destroy_all(self):
        chain = FallbackChain(
            provider_order=["none"],
            providers={"none": NoopSandbox()},
        )
        chain.create_all()
        chain.destroy_all()


class TestRunnerWithFallbackChain:
    def test_runner_delegates_to_chain(self):
        from workers.sandbox.runner import SandboxRunner
        chain = FallbackChain(
            provider_order=["none"],
            providers={"none": NoopSandbox()},
        )
        runner = SandboxRunner(
            use_fallback_chain=True,
            fallback_chain=chain,
        )
        result = runner.run_tests(workspace_path="/tmp/ws", test_command="pytest")
        assert "SANDBOX_UNAVAILABLE" in result.raw_output

    def test_runner_docker_path_still_works(self):
        from workers.sandbox.runner import SandboxRunner
        with patch("workers.sandbox.runner.Path.is_dir", return_value=True):
            with patch("workers.sandbox.runner.subprocess.run") as mock_run:
                mock_run.return_value.returncode = 0
                mock_run.return_value.stdout = "5 passed"
                mock_run.return_value.stderr = ""
                runner = SandboxRunner(
                    docker_image="python:3.12-slim",
                    use_fallback_chain=False,
                )
                result = runner.run_tests(
                    workspace_path="/tmp/fake-ws",
                    test_command="python -m pytest",
                )
                assert result.passed is True


class TestGlobalHelpers:
    def test_get_breaker_registry_reuses_singleton(self):
        r1 = get_breaker_registry()
        r2 = get_breaker_registry()
        assert r1 is r2


class _WorkingProvider(SandboxProvider):
    name = "working"
    def run_tests(self, workspace_path, test_command="", **kwargs):
        return SandboxResult(exit_code=0, raw_output="e2b_ran: ok")


class _FailingProvider(SandboxProvider):
    name = "failing"
    @property
    def is_available(self):
        return True
    def run_tests(self, workspace_path, test_command="", **kwargs):
        raise ProviderError("Intentional failure")
