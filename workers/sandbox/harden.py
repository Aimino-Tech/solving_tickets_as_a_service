"""Docker sandbox hardening — secure defaults for container execution.

Provides three public functions that encode the project's recommended
sandbox hardening posture:

- ``get_secure_config()`` — returns a dict of safe ``docker run`` defaults.
- ``get_seccomp_profile()`` — returns the seccomp profile as a dict,
  usable directly or serialised to JSON.
- ``get_apparmor_profile()`` — returns the AppArmor profile as a string,
  usable directly or written to ``/etc/apparmor.d/``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_DOCKER_DIR = Path(__file__).resolve().parent.parent.parent / "docker"
"""Path to the project-level ``docker/`` directory."""


# ── Public API ────────────────────────────────────────────────────────────────


def get_secure_config(
    *,
    memory_limit: str = "2g",
    cpu_limit: float = 1.0,
    read_only_rootfs: bool = True,
    network_disabled: bool = False,
    init_process: bool = True,
    drop_capabilities: bool = True,
    seccomp_profile: str | None = None,
    apparmor_profile: str | None = None,
) -> dict[str, object]:
    """Return a dict of recommended ``docker run`` security settings.

    Parameters
    ----------
    memory_limit:
        Maximum memory the container may consume (default ``"2g"``).
    cpu_limit:
        Maximum CPU cores the container may consume (default ``1.0``).
    read_only_rootfs:
        Mount the root filesystem read-only (default ``True``).
    network_disabled:
        Disable all container networking (default ``False`` — outbound
        HTTP is often required for package downloads).
    init_process:
        Use ``--init`` to reap zombie processes (default ``True``).
    drop_capabilities:
        Drop all Linux capabilities via ``--cap-drop ALL`` and then
        add back only the minimal set needed (default ``True``).
    seccomp_profile:
        Path to a custom seccomp profile JSON. When ``None`` the
        runtime-level helper will load the project default.
    apparmor_profile:
        Name of a custom AppArmor profile. When ``None`` the
        runtime-level helper will load the project default.

    Returns
    -------
    dict[str, object]
        A dictionary suitable for spreading into a ``docker run``
        command builder or passing to ``DockerSandbox`` constructor
        kwargs.
    """
    config: dict[str, object] = {
        "memory": memory_limit,
        "cpus": cpu_limit,
        "read_only": read_only_rootfs,
        "network_disabled": network_disabled,
        "init": init_process,
    }

    if drop_capabilities:
        config["cap_drop"] = ["ALL"]
        config["cap_add"] = [
            "CHOWN",
            "DAC_OVERRIDE",
            "FOWNER",
            "FSETID",
            "SETGID",
            "SETUID",
        ]

    if seccomp_profile is not None:
        config["seccomp_profile"] = seccomp_profile
    if apparmor_profile is not None:
        config["apparmor_profile"] = apparmor_profile

    return config


def get_seccomp_profile() -> dict[str, object]:
    """Return the project-default seccomp profile as a Python dict.

    The profile is loaded from ``docker/seccomp/sandbox.json`` at the
    project root.  It uses a default-ALLOW policy and blocks a curated
    set of dangerous syscalls (mount, kernel module loading, ``ptrace``,
    ``bpf``, ``perf_event_open``, …).

    Returns
    -------
    dict[str, object]
        The seccomp profile suitable for ``json.dumps()`` or passing to
        Docker's ``--security-opt seccomp=...`` (after writing to a
        tempfile).
    """
    profile_path = _DOCKER_DIR / "seccomp" / "sandbox.json"

    if not profile_path.is_file():
        raise FileNotFoundError(
            f"Seccomp profile not found at {profile_path}. "
            "Ensure docker/seccomp/sandbox.json exists."
        )

    with open(profile_path) as f:
        return dict(json.load(f))  # type: ignore[return-value]


def get_apparmor_profile() -> str:
    """Return the project-default AppArmor profile as a plain-text string.

    The profile is loaded from ``docker/apparmor/syntaro-sandbox`` at the
    project root.  It constrains file-system access, network operations,
    ``ptrace``, and signals for untrusted code execution.

    Returns
    -------
    str
        The raw AppArmor profile text, ready to be written to
        ``/etc/apparmor.d/syntaro-sandbox`` and loaded via
        ``apparmor_parser``.
    """
    profile_path = _DOCKER_DIR / "apparmor" / "syntaro-sandbox"

    if not profile_path.is_file():
        raise FileNotFoundError(
            f"AppArmor profile not found at {profile_path}. "
            "Ensure docker/apparmor/syntaro-sandbox exists."
        )

    return profile_path.read_text(encoding="utf-8")


# ── Convenience helpers (semi-private) ────────────────────────────────────────


def _resolve_docker_dir() -> Path:
    """Return the absolute path to the project's ``docker/`` directory.

    Exposed as a helper so callers can locate related profiles without
    hard-coding paths.
    """
    return _DOCKER_DIR
