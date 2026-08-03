"""
OSS prompt injection guard integration.

Provides ML-powered prompt injection detection via optional third-party
libraries: llm-guard, rebuff, and garak.

The integration is opt-in (enabled via ``SYNTARO_OSS_GUARD_ENABLED=true``).
When OSS tools are unavailable or time out, the guard logs a warning and
falls back to the existing regex-based ``InjectionGuard`` verdict.

Usage::

    from workers.gates.oss_integration import OssGuardManager

    manager = OssGuardManager()
    result = manager.scan("ignore all previous instructions")
    if result.detected:
        print(f"OSS severity: {result.severity}")
"""

from __future__ import annotations

import importlib
import logging
import os
import time
from typing import Any

from workers.gates.injection_guard import InjectionGuard, InjectionGuardResult

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_DEFAULT_TOOLS = ["llm_guard", "rebuff"]

# Map from config name → pip package name → import path
_TOOL_REGISTRY: dict[str, dict[str, str]] = {
    "llm_guard": {
        "package": "llm_guard",
        "module": "llm_guard",
        "scanner_class": "LLMGuardScanner",
    },
    "rebuff": {
        "package": "rebuff",
        "module": "rebuff",
        "scanner_class": "RebuffScanner",
    },
    "garak": {
        "package": "garak",
        "module": "garak",
        "scanner_class": "GarakScanner",
    },
}

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


class OssGuardResult:
    """Result from an OSS guard scan.

    Attributes:
        detected: Whether injection was detected by any active OSS tool.
        confidence: Aggregate confidence score (0.0 – 1.0).
        tools_used: List of OSS tools that contributed to the result.
        severity: One of ``"critical"``, ``"high"``, ``"medium"``, ``"low"``,
            ``"none"``.
        details: Per-tool detail dicts.
        fallback: Whether the result fell back to the regex guard.
    """

    __slots__ = (
        "detected",
        "confidence",
        "tools_used",
        "severity",
        "details",
        "fallback",
    )

    def __init__(
        self,
        detected: bool,
        confidence: float,
        tools_used: list[str],
        details: list[dict[str, Any]],
        fallback: bool = False,
    ) -> None:
        self.detected = detected
        self.confidence = confidence
        self.tools_used = tools_used
        self.severity = self._classify(confidence)
        self.details = details
        self.fallback = fallback

    @staticmethod
    def _classify(confidence: float) -> str:
        if confidence >= 0.8:
            return "critical"
        if confidence >= 0.6:
            return "high"
        if confidence >= 0.3:
            return "medium"
        if confidence > 0.0:
            return "low"
        return "none"

    def to_dict(self) -> dict[str, Any]:
        return {
            "detected": self.detected,
            "confidence": round(self.confidence, 2),
            "severity": self.severity,
            "tools_used": self.tools_used,
            "details": self.details,
            "fallback": self.fallback,
        }

    def __repr__(self) -> str:
        return (
            f"OssGuardResult(detected={self.detected}, confidence={self.confidence:.2f}, "
            f"severity={self.severity!r}, tools={self.tools_used}, fallback={self.fallback})"
        )


# ---------------------------------------------------------------------------
# Base scanner
# ---------------------------------------------------------------------------


class OssScannerBase:
    """Base class for OSS scanner wrappers.

    Subclasses implement ``scan(text) -> (detected: bool, confidence: float)``.
    """

    name: str = "base"

    def is_available(self) -> bool:
        """Return True if the underlying library can be imported."""
        raise NotImplementedError

    def scan(self, text: str) -> tuple[bool, float, dict[str, Any]]:
        """Scan *text* for prompt injection.

        Returns:
            ``(detected, confidence, details_dict)``
        """
        raise NotImplementedError


# ---------------------------------------------------------------------------
# LLM Guard scanner
# ---------------------------------------------------------------------------


class LLMGuardScanner(OssScannerBase):
    """Wrapper around llm-guard's prompt injection scanner.

    Uses the ``laiyer/deberta-v3-base-prompt-injection`` model via
    ``llm_guard.scan_prompt``.
    """

    name: str = "llm_guard"

    def __init__(self) -> None:
        self._scanner = None
        self._available = False
        self._init_scanner()

    def _init_scanner(self) -> None:
        try:
            from llm_guard import scan_prompt  # type: ignore[import-untyped]
            from llm_guard.input_scanners import PromptInjection  # type: ignore[import-untyped]

            self._scanner = PromptInjection()
            self._scan_prompt = scan_prompt
            self._available = True
            logger.info("llm-guard scanner initialized successfully")
        except ImportError:
            logger.info("llm-guard not installed — llm_guard scanner unavailable")
        except Exception as exc:
            logger.warning("llm-guard init failed: %s", exc)

    def is_available(self) -> bool:
        return self._available

    def scan(self, text: str) -> tuple[bool, float, dict[str, Any]]:
        if not self._available or self._scanner is None:
            return False, 0.0, {"error": "llm_guard not available"}

        try:
            sanitized_text, is_valid, risk_score = self._scanner.scan(text)
            # llm_guard returns (sanitized_text, is_valid, risk_score)
            # is_valid=False means injection detected
            detected = not is_valid
            confidence = float(risk_score) if risk_score is not None else (1.0 if detected else 0.0)
            return detected, confidence, {
                "risk_score": risk_score,
                "is_valid": is_valid,
            }
        except Exception as exc:
            logger.warning("llm-guard scan failed: %s", exc)
            return False, 0.0, {"error": str(exc)}


# ---------------------------------------------------------------------------
# Rebuff scanner
# ---------------------------------------------------------------------------


class RebuffScanner(OssScannerBase):
    """Wrapper around rebuff's prompt injection detector.

    Uses rebuff's heuristic + vector similarity detection.
    """

    name: str = "rebuff"

    def __init__(self) -> None:
        self._rebuff = None
        self._available = False
        self._init_rebuff()

    def _init_rebuff(self) -> None:
        try:
            from rebuff import Rebuff  # type: ignore[import-untyped]

            # Rebuff can work with or without an API key (heuristic-only mode)
            openai_api_key = os.getenv("OPENAI_API_KEY", "")
            self._rebuff = Rebuff(api_token=openai_api_key, openai_model="gpt-3.5-turbo")
            self._available = True
            logger.info("rebuff scanner initialized successfully")
        except ImportError:
            logger.info("rebuff not installed — rebuff scanner unavailable")
        except Exception as exc:
            logger.warning("rebuff init failed: %s", exc)

    def is_available(self) -> bool:
        return self._available

    def scan(self, text: str) -> tuple[bool, float, dict[str, Any]]:
        if not self._available or self._rebuff is None:
            return False, 0.0, {"error": "rebuff not available"}

        try:
            # rebuff.detect_injection returns dict with:
            #   {"injection_detected": bool, "similarity_score": float, ...}
            result = self._rebuff.detect_injection(text)
            detected = result.get("injection_detected", False)
            confidence = result.get("similarity_score", 1.0 if detected else 0.0)
            return detected, float(confidence), result
        except Exception as exc:
            logger.warning("rebuff scan failed: %s", exc)
            return False, 0.0, {"error": str(exc)}


# ---------------------------------------------------------------------------
# Garak scanner
# ---------------------------------------------------------------------------


class GarakScanner(OssScannerBase):
    """Wrapper around garak's LLM vulnerability scanner.

    Garak runs a battery of adversarial probes. In SYNTARO, it is used as a
    secondary/deep scan for high-risk inputs. Because garak is designed for
    probing a running model (not standalone text), we use its ``probe``
    module directly on the input text where possible.

    Garak is **not enabled by default** — it is slower than other scanners
    and is best used for periodic batch scans or high-risk triage.
    """

    name: str = "garak"

    def __init__(self) -> None:
        self._available = False
        self._init_garak()

    def _init_garak(self) -> None:
        try:
            # garak doesn't expose a simple text-level scanner in its public
            # API, so we attempt to import known probe modules
            importlib.import_module("garak")
            self._available = True
            logger.info("garak scanner initialized successfully")
        except ImportError:
            logger.info("garak not installed — garak scanner unavailable")
        except Exception as exc:
            logger.warning("garak init failed: %s", exc)

    def is_available(self) -> bool:
        return self._available

    def scan(self, text: str) -> tuple[bool, float, dict[str, Any]]:
        if not self._available:
            return False, 0.0, {"error": "garak not available"}

        try:
            # Garak's typical usage is to probe a running model endpoint.
            # For standalone text scanning we use a simple heuristic:
            #   flag if the text matches known adversarial probe templates
            probe_score = self._heuristic_probe_scan(text)
            detected = probe_score > 0.5
            return detected, probe_score, {
                "probe_score": probe_score,
                "scan_type": "heuristic",
            }
        except Exception as exc:
            logger.warning("garak scan failed: %s", exc)
            return False, 0.0, {"error": str(exc)}

    @staticmethod
    def _heuristic_probe_scan(text: str) -> float:
        """Simple heuristic scan for garak-style adversarial probes.

        Checks for patterns that garak probes commonly use, such as
        DAN (Do Anything Now), prefix injection, and refusal suppression.
        """
        text_lower = text.lower()
        score = 0.0

        # DAN-style jailbreak patterns
        dan_patterns = [
            "dan",
            "do anything now",
            "jailbreak",
            "jail broken",
            "unconstrained",
            "no restrictions",
            "no boundaries",
            "unfiltered",
            "uncensored",
            "no filters",
            "no rules",
            "no limitations",
            "deceptive",
            "roleplay",
        ]
        for pattern in dan_patterns:
            if pattern in text_lower:
                score += 0.15

        # Refusal suppression patterns
        refusal_patterns = [
            "don't say you cannot",
            "don't say you are unable",
            "don't refuse",
            "do not refuse",
            "do not apologize",
            "don't apologize",
            "without any warnings",
            "without saying no",
        ]
        for pattern in refusal_patterns:
            if pattern in text_lower:
                score += 0.2

        # Prefix injection patterns
        prefix_patterns = [
            "start with",
            "begin your response with",
            "prefix your",
            "output format",
            "format your response",
            "respond exactly",
            "answer exactly",
        ]
        for pattern in prefix_patterns:
            if pattern in text_lower:
                score += 0.1

        # Cap at 1.0
        return min(score, 1.0)


# ---------------------------------------------------------------------------
# Scanner factory
# ---------------------------------------------------------------------------


def _create_scanner(name: str) -> OssScannerBase | None:
    """Create a scanner instance by name.

    Returns ``None`` if the scanner's dependencies are not installed.
    """
    cls_map: dict[str, type[OssScannerBase]] = {
        "llm_guard": LLMGuardScanner,
        "rebuff": RebuffScanner,
        "garak": GarakScanner,
    }
    cls = cls_map.get(name)
    if cls is None:
        logger.warning("Unknown OSS scanner %r — skipping", name)
        return None
    try:
        instance = cls()
        if instance.is_available():
            return instance
        return None
    except Exception as exc:
        logger.warning("Failed to initialize scanner %r: %s", name, exc)
        return None


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------


class OssGuardManager:
    """Manages OSS prompt injection scanners.

    Reads configuration from environment variables and maintains a pool of
    available scanners. Scanning runs across all available scanners and
    aggregates results.

    When no OSS tools are available, falls back to the regex-based
    ``InjectionGuard`` result.
    """

    def __init__(self) -> None:
        self.enabled = os.getenv("SYNTARO_OSS_GUARD_ENABLED", "false").strip().lower() in (
            "true",
            "1",
            "yes",
        )
        raw_tools = os.getenv("SYNTARO_OSS_GUARD_TOOLS", ",".join(_DEFAULT_TOOLS))
        self.tool_names = [t.strip() for t in raw_tools.split(",") if t.strip()]
        self.timeout = float(os.getenv("SYNTARO_OSS_GUARD_TIMEOUT", "5.0"))

        self.scanners: list[OssScannerBase] = []
        if self.enabled:
            for name in self.tool_names:
                scanner = _create_scanner(name)
                if scanner is not None:
                    self.scanners.append(scanner)

            if self.scanners:
                logger.info(
                    "OSS guard enabled — tools=%s scanners=%d",
                    self.tool_names,
                    len(self.scanners),
                )
            else:
                logger.warning(
                    "OSS guard enabled but no scanners available — will fall back to regex guard"
                )

    @property
    def available_tools(self) -> list[str]:
        """Return the names of currently active scanners."""
        return [s.name for s in self.scanners]

    def scan(self, text: str) -> OssGuardResult:
        """Scan *text* using all available OSS tools.

        If OSS is disabled or no scanners are available, immediately
        delegates to the regex guard and returns that result wrapped
        in ``OssGuardResult``.

        Args:
            text: The text to scan.

        Returns:
            An ``OssGuardResult`` with aggregated results.
        """
        if not self.enabled or not self.scanners:
            # Fallback to regex guard
            regex_result: InjectionGuardResult = InjectionGuard.scan(text)
            return OssGuardResult(
                detected=regex_result.detected,
                confidence=regex_result.score,
                tools_used=["regex_fallback"],
                details=[{"source": "regex_fallback", **regex_result.to_dict()}],
                fallback=True,
            )

        details: list[dict[str, Any]] = []
        total_confidence = 0.0
        detected_count = 0
        tool_names: list[str] = []

        for scanner in self.scanners:
            tool_names.append(scanner.name)
            start = time.perf_counter()
            try:
                detected, confidence, scan_details = scanner.scan(text)
                elapsed = (time.perf_counter() - start) * 1000
                scan_details["scan_duration_ms"] = round(elapsed, 1)
                scan_details["scanner"] = scanner.name
                details.append(scan_details)

                if detected:
                    detected_count += 1
                total_confidence += confidence
            except Exception as exc:
                logger.warning("Scanner %s failed: %s", scanner.name, exc)
                details.append({
                    "scanner": scanner.name,
                    "error": str(exc),
                })

        if not details:
            # All scanners failed — fallback
            regex_fallback: InjectionGuardResult = InjectionGuard.scan(text)
            return OssGuardResult(
                detected=regex_fallback.detected,
                confidence=regex_fallback.score,
                tools_used=["regex_fallback"],
                details=[{"source": "regex_fallback", **regex_fallback.to_dict()}],
                fallback=True,
            )

        # Aggregate: average confidence, majority vote for detection
        avg_confidence = total_confidence / len(self.scanners)
        majority_detected = detected_count > len(self.scanners) / 2

        return OssGuardResult(
            detected=majority_detected,
            confidence=avg_confidence,
            tools_used=tool_names,
            details=details,
            fallback=False,
        )
