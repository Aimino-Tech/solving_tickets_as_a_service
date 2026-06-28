"""Tests for workers.sandbox.harden — get_secure_config, seccomp, AppArmor."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from workers.sandbox.harden import (
    get_secure_config,
    get_seccomp_profile,
    get_apparmor_profile,
    _resolve_docker_dir,
)


class TestGetSecureConfig:
    """Coverage for :func:`get_secure_config`."""

    def test_defaults(self):
        cfg = get_secure_config()
        assert isinstance(cfg, dict)
        assert cfg["memory"] == "2g"
        assert cfg["cpus"] == 1.0
        assert cfg["read_only"] is True
        assert cfg["network_disabled"] is False
        assert cfg["init"] is True

    def test_drops_capabilities_by_default(self):
        cfg = get_secure_config()
        assert cfg["cap_drop"] == ["ALL"]
        assert "CHOWN" in cfg["cap_add"]
        assert "DAC_OVERRIDE" in cfg["cap_add"]
        assert "FOWNER" in cfg["cap_add"]
        assert "FSETID" in cfg["cap_add"]
        assert "SETGID" in cfg["cap_add"]
        assert "SETUID" in cfg["cap_add"]

    def test_drop_capabilities_false(self):
        cfg = get_secure_config(drop_capabilities=False)
        assert "cap_drop" not in cfg
        assert "cap_add" not in cfg

    def test_custom_limits(self):
        cfg = get_secure_config(memory_limit="4g", cpu_limit=2.0)
        assert cfg["memory"] == "4g"
        assert cfg["cpus"] == 2.0

    def test_read_only_false(self):
        cfg = get_secure_config(read_only_rootfs=False)
        assert cfg["read_only"] is False

    def test_network_disabled_true(self):
        cfg = get_secure_config(network_disabled=True)
        assert cfg["network_disabled"] is True

    def test_init_false(self):
        cfg = get_secure_config(init_process=False)
        assert cfg["init"] is False

    def test_seccomp_profile_passthrough(self):
        cfg = get_secure_config(seccomp_profile="/tmp/custom.json")
        assert cfg["seccomp_profile"] == "/tmp/custom.json"

    def test_apparmor_profile_passthrough(self):
        cfg = get_secure_config(apparmor_profile="custom-profile")
        assert cfg["apparmor_profile"] == "custom-profile"

    def test_both_profiles_passthrough(self):
        cfg = get_secure_config(
            seccomp_profile="/etc/docker/seccomp/custom.json",
            apparmor_profile="stas-custom",
        )
        assert cfg["seccomp_profile"] == "/etc/docker/seccomp/custom.json"
        assert cfg["apparmor_profile"] == "stas-custom"


class TestGetSeccompProfile:
    """Coverage for :func:`get_seccomp_profile`."""

    def test_returns_valid_seccomp_dict(self):
        profile = get_seccomp_profile()
        assert isinstance(profile, dict)
        assert "defaultAction" in profile
        assert profile["defaultAction"] == "SCMP_ACT_ALLOW"
        assert "architectures" in profile
        assert "syscalls" in profile
        assert isinstance(profile["syscalls"], list)

    def test_includes_blocked_syscalls(self):
        profile = get_seccomp_profile()
        syscall_names = []
        for rule in profile["syscalls"]:
            syscall_names.extend(rule.get("names", []))
        assert "mount" in syscall_names
        assert "ptrace" in syscall_names
        assert "bpf" in syscall_names
        assert "init_module" in syscall_names
        assert "delete_module" in syscall_names

    def test_blocked_syscalls_have_action_errno(self):
        profile = get_seccomp_profile()
        for rule in profile["syscalls"]:
            if "comment" in rule and "Block dangerous" in rule["comment"]:
                assert rule["action"] == "SCMP_ACT_ERRNO"

    def test_raises_when_file_missing(self):
        fake_dir = Path(tempfile.mkdtemp())
        with patch(
            "workers.sandbox.harden._DOCKER_DIR",
            fake_dir,
        ):
            with pytest.raises(FileNotFoundError, match="Seccomp profile not found"):
                get_seccomp_profile()

    def test_returns_valid_json(self):
        """The dict returned should be JSON-serialisable."""
        profile = get_seccomp_profile()
        serialised = json.dumps(profile, indent=2)
        assert isinstance(serialised, str)
        assert '"defaultAction"' in serialised


class TestGetApparmorProfile:
    """Coverage for :func:`get_apparmor_profile`."""

    def test_returns_string(self):
        profile = get_apparmor_profile()
        assert isinstance(profile, str)
        assert len(profile) > 100

    def test_includes_profile_declaration(self):
        profile = get_apparmor_profile()
        assert "profile stas-sandbox" in profile

    def test_includes_workspace_rules(self):
        profile = get_apparmor_profile()
        assert "/home/node/**" in profile

    def test_includes_deny_rules(self):
        profile = get_apparmor_profile()
        assert "deny /proc/**" in profile
        assert "deny /sys/**" in profile
        assert "deny /dev/**" in profile

    def test_raises_when_file_missing(self):
        fake_dir = Path(tempfile.mkdtemp())
        with patch(
            "workers.sandbox.harden._DOCKER_DIR",
            fake_dir,
        ):
            with pytest.raises(FileNotFoundError, match="AppArmor profile not found"):
                get_apparmor_profile()


class TestResolveDockerDir:
    """Coverage for :func:`_resolve_docker_dir`."""

    def test_returns_path_object(self):
        path = _resolve_docker_dir()
        assert isinstance(path, Path)
        assert path.exists()

    def test_contains_expected_subdirs(self):
        path = _resolve_docker_dir()
        assert (path / "seccomp").is_dir()
        assert (path / "apparmor").is_dir()


class TestIntegration:
    """End-to-end: config + profiles are internally consistent."""

    def test_seccomp_profile_path_used_in_config(self):
        """Secure config can reference the project seccomp profile."""
        cfg = get_secure_config(seccomp_profile="/etc/docker/seccomp/sandbox.json")
        assert cfg["seccomp_profile"] == "/etc/docker/seccomp/sandbox.json"

    def test_get_secure_config_does_not_load_profiles(self):
        """``get_secure_config`` should NOT read profiles from disk."""
        cfg = get_secure_config()
        assert "seccomp_profile" not in cfg
        assert "apparmor_profile" not in cfg

    def test_both_profiles_load_without_error(self):
        """Both profile-loading functions should succeed together."""
        get_seccomp_profile()
        get_apparmor_profile()
