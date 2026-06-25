"""
Fallback chain -- tries providers in priority order, skipping those whose
circuit breaker is open.

Configuration
------------
The provider order and availability are controlled by environment variables
and/or constructor arguments::

    SANDBOX_PROVIDER_CHAIN = "e2b,docker,none"

Each name maps to a ``SandboxProvider`` implementation.
"""

from __future__ import annotations

import logging
import os
from typing import Any

from .circuit_breaker import (
    BreakerRegistry,
    call_or_fallback,
    get_breaker_registry,
)
from .parsers import SandboxResult
from .provider import (
    DockerSandbox,
    E2BSandbox,
    NoopSandbox,
    ProviderError,
    SandboxProvider,
)

logger = logging.getLogger(__name__)


def _provider_factory(name: str) -> SandboxProvider:
    """Create a provider instance by short name."""
    mapping: dict[str, type[SandboxProvider]] = {
        "e2b": E2BSandbox,
        "docker": DockerSandbox,
        "none": NoopSandbox,
    }
    cls = mapping.get(name.lower())
    if cls is None:
        raise ValueError(
            f"Unknown sandbox provider: {name!r}. "
            f"Choose from: {', '.join(mapping)}"
        )
    return cls()


class FallbackChain:
    """Orchestrate a chain of sandbox providers with circuit-breaker support.

    Usage::

        chain = FallbackChain()
        result = chain.run_tests(workspace_path="/tmp/repo", test_command="pytest")
    """

    def __init__(
        self,
        provider_order: list[str] | None = None,
        breaker_registry: BreakerRegistry | None = None,
        providers: dict[str, SandboxProvider] | None = None,
    ) -> None:
        self._breaker_registry = breaker_registry or get_breaker_registry()
        self._providers: dict[str, SandboxProvider] = providers or {}
        self._provider_order = provider_order or self._default_order()

    @staticmethod
    def _default_order() -> list[str]:
        raw = os.getenv("SANDBOX_PROVIDER_CHAIN", "e2b,docker,none")
        return [name.strip().lower() for name in raw.split(",") if name.strip()]

    def _get_provider(self, name: str) -> SandboxProvider:
        if name not in self._providers:
            self._providers[name] = _provider_factory(name)
        return self._providers[name]

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
        """Run tests using the first viable provider in the chain.

        Iterates the provider order; for each provider:
          1. If the provider is unavailable or its circuit is open, skip.
          2. Call ``provider.run_tests`` under the circuit breaker.
          3. If it succeeds, return the result.
          4. If it fails, record the failure and try the next provider.
        """
        last_result: SandboxResult | None = None

        for provider_name in self._provider_order:
            provider = self._get_provider(provider_name)

            if not provider.is_available:
                logger.info("Provider '%s' is unavailable -- skipping", provider_name)
                continue

            breaker = self._breaker_registry.get(provider_name)
            if breaker.state.__class__.__name__ == "CircuitOpenState":
                logger.warning("Provider '%s' circuit is OPEN -- skipping", provider_name)
                continue

            logger.info("Trying provider '%s' -- workspace=%s", provider_name, workspace_path)

            try:
                result = call_or_fallback(
                    func=provider.run_tests,
                    provider_name=provider_name,
                    workspace_path=workspace_path,
                    test_command=test_command,
                    capture_json=capture_json,
                    capture_xml=capture_xml,
                    timeout_seconds=timeout_seconds,
                    env_vars=env_vars,
                    registry=self._breaker_registry,
                )

                logger.info(
                    "Provider '%s' succeeded (exit=%d)",
                    provider_name,
                    result.exit_code,
                )
                return result

            except ProviderError as exc:
                last_result = SandboxResult(
                    exit_code=-1,
                    raw_output="",
                    error_message=f"Provider '{provider_name}' failed: {exc}",
                )
                logger.warning(
                    "Provider '%s' failed: %s -- trying next",
                    provider_name,
                    exc,
                )
                continue

            except Exception as exc:
                last_result = SandboxResult(
                    exit_code=-1,
                    raw_output="",
                    error_message=f"Provider '{provider_name}' failed: {exc}",
                )
                logger.warning(
                    "Provider '%s' failed unexpectedly: %s -- trying next",
                    provider_name,
                    exc,
                )
                continue

        logger.error("All sandbox providers exhausted")
        return SandboxResult(
            exit_code=-1,
            raw_output=last_result.raw_output if last_result else "",
            error_message="No sandbox provider available -- all providers exhausted",
        )

    def create_all(self) -> None:
        """Call ``create()`` on every available provider."""
        for provider_name in self._provider_order:
            provider = self._get_provider(provider_name)
            if provider.is_available:
                try:
                    provider.create()
                except ProviderError as exc:
                    logger.warning(
                        "Failed to pre-create provider '%s': %s",
                        provider_name,
                        exc,
                    )

    def destroy_all(self) -> None:
        """Tear down every provisioned provider."""
        for provider_name, provider in self._providers.items():
            try:
                provider.destroy()
            except Exception as exc:
                logger.warning(
                    "Failed to destroy provider '%s': %s",
                    provider_name,
                    exc,
                )

    @property
    def active_provider(self) -> str | None:
        """Name of the first available provider, or None."""
        for provider_name in self._provider_order:
            provider = self._get_provider(provider_name)
            if not provider.is_available:
                continue
            breaker = self._breaker_registry.get(provider_name)
            if breaker.state.__class__.__name__ != "CircuitOpenState":
                return provider_name
        return None

    @property
    def provider_states(self) -> dict[str, dict[str, Any]]:
        info: dict[str, dict[str, Any]] = {}
        for provider_name in self._provider_order:
            provider = self._get_provider(provider_name)
            breaker = self._breaker_registry.get(provider_name)
            info[provider_name] = {
                "available": provider.is_available,
                "circuit_state": breaker.state.__class__.__name__,
            }
        return info


_global_chain: FallbackChain | None = None


def get_fallback_chain(provider_order: list[str] | None = None) -> FallbackChain:
    """Return (creating if necessary) the global fallback-chain singleton."""
    global _global_chain
    if _global_chain is None:
        _global_chain = FallbackChain(provider_order=provider_order)
    return _global_chain


def run_tests(
    workspace_path: str,
    test_command: str = "",
    *,
    capture_json: bool = False,
    capture_xml: bool = False,
    timeout_seconds: int = 300,
    env_vars: dict[str, str] | None = None,
) -> SandboxResult:
    """Convenience: run tests via the global fallback chain."""
    chain = get_fallback_chain()
    return chain.run_tests(
        workspace_path=workspace_path,
        test_command=test_command,
        capture_json=capture_json,
        capture_xml=capture_xml,
        timeout_seconds=timeout_seconds,
        env_vars=env_vars,
    )
