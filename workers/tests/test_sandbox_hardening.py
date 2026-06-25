import json
import os
import tempfile
from pathlib import Path

import pytest

from workers.sandbox.hardening import (
    BLOCKED_SYSCALLS,
    SECCOMP_DEFAULT_PROFILE,
    SandboxHardeningConfig,
    build_default_seccomp_profile,
    build_docker_run_command,
    write_apparmor_profile,
    write_seccomp_profile,
)


def test_seccomp_profile_blocks_dangerous_syscalls():
    profile = build_default_seccomp_profile()
    allowed = set(profile["syscalls"][0]["names"])
    for blocked in BLOCKED_SYSCALLS:
        assert blocked not in allowed, f"{blocked} should not be in allowed syscalls"


def test_seccomp_profile_has_required_keys():
    profile = build_default_seccomp_profile()
    assert "defaultAction" in profile
    assert profile["defaultAction"] == "SCMP_ACT_ERRNO"
    assert "architectures" in profile
    assert "syscalls" in profile


def test_write_seccomp_profile():
    with tempfile.TemporaryDirectory() as tmpdir:
        path = os.path.join(tmpdir, "seccomp.json")
        profile = write_seccomp_profile(path)
        assert os.path.isfile(path)
        with open(path) as f:
            loaded = json.load(f)
        assert loaded["defaultAction"] == "SCMP_ACT_ERRNO"


def test_write_apparmor_profile():
    with tempfile.TemporaryDirectory() as tmpdir:
        workspace = os.path.join(tmpdir, "workspace")
        os.makedirs(workspace)
        path = os.path.join(tmpdir, "apparmor")
        write_apparmor_profile(path, workspace)
        assert os.path.isfile(path)
        with open(path) as f:
            content = f.read()
        assert workspace in content
        assert "profile stas-sandbox" in content


def test_build_docker_run_command_defaults():
    cmd = build_docker_run_command("python:3.12", "/tmp/workspace")
    assert "docker" in cmd
    assert "run" in cmd
    assert "--runtime" in cmd
    assert "runsc" in cmd
    assert "--cap-drop=ALL" in cmd
    assert "--read-only" in cmd
    assert "--user" in cmd
    assert "1000:1000" in cmd
    assert "python:3.12" in cmd


def test_build_docker_run_no_gvisor():
    cmd = build_docker_run_command("python:3.12", "/tmp/workspace", use_gvisor=False)
    assert "--runtime" not in cmd or "runsc" not in cmd


def test_build_docker_run_with_command():
    cmd = build_docker_run_command("python:3.12", "/tmp/workspace", command=["python", "test.py"])
    assert "python" in cmd
    assert "test.py" in cmd


def test_build_docker_run_read_only_false():
    cmd = build_docker_run_command("python:3.12", "/tmp/workspace", read_only_root=False)
    assert "--read-only" not in cmd


def test_sandbox_hardening_config_defaults():
    cfg = SandboxHardeningConfig()
    d = cfg.to_dict()
    assert d["use_gvisor"] is True
    assert d["drop_all_capabilities"] is True
    assert d["read_only_root"] is True
    assert d["non_root_user"] == "1000:1000"
    assert d["scan_base_images"] is True


def test_sandbox_hardening_config_custom():
    cfg = SandboxHardeningConfig(
        use_gvisor=False,
        read_only_root=False,
        non_root_user="2000:2000",
        scan_base_images=False,
    )
    d = cfg.to_dict()
    assert d["use_gvisor"] is False
    assert d["read_only_root"] is False
    assert d["non_root_user"] == "2000:2000"
    assert d["scan_base_images"] is False


def test_no_privileged_mode():
    cmd = build_docker_run_command("python:3.12", "/tmp/workspace")
    assert "--privileged" not in cmd


def test_workspace_mounted():
    cmd = build_docker_run_command("python:3.12", "/tmp/workspace")
    mount_idx = None
    for i, arg in enumerate(cmd):
        if arg == "-v" and i + 1 < len(cmd):
            mount_idx = i + 1
            break
    assert mount_idx is not None
    assert "/tmp/workspace:/workspace:rw" in cmd[mount_idx]
