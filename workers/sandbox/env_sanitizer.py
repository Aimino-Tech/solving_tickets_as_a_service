"""Environment variable sanitization and validation for sandbox operations.

Provides two core functions:
- ``sanitize_env()`` — strip dangerous or disallowed entries from an env dict.
- ``validate_env()`` — check an env dict against a ruleset, returning errors.
"""

from __future__ import annotations

import re
from typing import Any

# ── Dangerous patterns ────────────────────────────────────────────────────────

SHELL_METACHARACTERS = re.compile(r"[\x00-\x08\x0a-\x1f\x7f#&|;`$(){}\[\]<>!~*?\\]")
"""Characters that have special meaning in POSIX shells or are control chars."""

# ── Public API ────────────────────────────────────────────────────────────────


def sanitize_env(
    env: dict[str, str],
    allowlist: set[str] | None = None,
    *,
    strip_dangerous: bool = True,
    max_value_length: int = 4096,
) -> dict[str, str]:
    """Return a copy of *env* with dangerous or disallowed entries removed.

    Parameters
    ----------
    env:
        Raw environment variable dict (e.g. from ``os.environ``).
    allowlist:
        If given, only keys in this set are kept.  When *None* all keys are
        allowed (but still subject to value sanitization).
    strip_dangerous:
        When ``True`` (default), entries whose value contains shell
        metacharacters or exceeds *max_value_length* are dropped.
    max_value_length:
        Maximum allowed value length.  Values longer than this are dropped.
        Default 4096.

    Returns
    -------
    dict[str, str]
        Sanitised copy of *env*.
    """
    result: dict[str, str] = {}

    for key, value in env.items():
        # --- key-level allowlist -----------------------------------------------
        if allowlist is not None and key not in allowlist:
            continue

        # --- value-level sanitisation ------------------------------------------
        if strip_dangerous:
            # Reject values that are too long.
            if len(value) > max_value_length:
                continue
            # Reject values containing shell metacharacters.
            if SHELL_METACHARACTERS.search(value):
                continue

        result[key] = value

    return result


ValidationRuleSet = dict[str, Any]
"""Type alias for the *rules* parameter of :func:`validate_env`.

Recognised top-level keys
    ``required``
        A ``list[str]`` of env-var names that MUST be present in *env*.
    ``max_length``
        An ``int`` — values longer than this are flagged.
    ``patterns``
        A ``dict[str, str]`` mapping env-var names to compiled or string
        regex patterns.  The value is tested against the pattern; if it
        does **not** match, an error is added.
    ``allowed_values``
        A ``dict[str, list[str]]`` mapping env-var names to a list of
        acceptable values.
"""


def validate_env(
    env: dict[str, str],
    rules: ValidationRuleSet | None = None,
) -> list[str]:
    """Validate *env* against an optional *rules* set.

    Parameters
    ----------
    env:
        The environment dict to validate (typically already sanitised).
    rules:
        An optional dict of validation rules (see
        :obj:`ValidationRuleSet`).  When *None* only basic structural
        checks (key types) are performed.

    Returns
    -------
    list[str]
        A (possibly empty) list of human-readable error messages.
    """
    errors: list[str] = []

    # --- Basic type checks ----------------------------------------------------
    for key, value in env.items():
        if not isinstance(key, str):
            errors.append(f"Key {key!r} is not a string")
        if not isinstance(value, str):
            errors.append(f"Value for {key!r} is not a string")

    if rules is None:
        return errors

    # --- required keys --------------------------------------------------------
    for required_key in rules.get("required", []):
        if required_key not in env:
            errors.append(f"Required env var {required_key!r} is missing")

    # --- max value length ----------------------------------------------------
    max_len = rules.get("max_length")
    if max_len is not None:
        for key, value in env.items():
            if len(value) > max_len:
                errors.append(
                    f"Value for {key!r} exceeds max length ({len(value)} > {max_len})"
                )

    # --- regex patterns ------------------------------------------------------
    for key, pattern in rules.get("patterns", {}).items():
        if key not in env:
            continue
        compiled = re.compile(pattern)
        if not compiled.match(env[key]):
            errors.append(
                f"Value for {key!r} does not match pattern {pattern!r}"
            )

    # --- allowed values ------------------------------------------------------
    for key, allowed in rules.get("allowed_values", {}).items():
        if key not in env:
            continue
        if env[key] not in allowed:
            errors.append(
                f"Value for {key!r} is {env[key]!r}; allowed: {allowed}"
            )

    return errors
