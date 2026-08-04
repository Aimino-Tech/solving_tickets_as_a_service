# Docker Sandbox Hardening

> **Seccomp profiles, AppArmor policies, capability dropping, and read-only
> root filesystem for the SYNTARO Docker sandbox.**

## Overview

SYNTARO runs untrusted code inside Docker containers. This document describes
the hardening stack that isolates sandbox containers from the host and from
each other:

| Layer | Mechanism | Enforced by |
|-------|-----------|-------------|
| Syscall filtering | Seccomp profile | `--security-opt seccomp=...` |
| Mandatory access control | AppArmor profile | `--security-opt apparmor=...` |
| Read-only rootfs | `--read-only` | Docker |
| Capability dropping | `--cap-drop ALL` + allowlist | Docker |
| Init process reaper | `--init` (tini) | Docker |
| Resource limits | `--memory` / `--cpus` | Docker / cgroups |
| Network isolation | `--network none` | Docker |

## Quick start

```bash
# One-shot install (root required)
sudo ./scripts/docker-sandbox-security.sh

# Verify
sudo ./scripts/docker-sandbox-security.sh --status
```

## Profiles

### Seccomp (`docker/seccomp/sandbox.json`)

Uses a **default-ALLOW** policy — every syscall is permitted unless
explicitly blocked. Blocked syscalls include:

- **Kernel module loading**: `init_module`, `finit_module`, `delete_module`
- **Mount operations**: `mount`, `umount`, `umount2`, `pivot_root`
- **Process introspection / debugging**: `ptrace`, `perf_event_open`, `process_vm_readv`, `process_vm_writev`
- **Kernel introspection**: `bpf`, `kexec_file_load`, `kexec_load`
- **Key management**: `keyctl`, `add_key`, `request_key`
- **System clock / time**: `clock_settime`, `clock_adjtime`, `stime`
- **Namespace operations**: `setns`, `unshare` (with namespace flags)
- **Obsolete / dangerous**: `acct`, `uselib`, `vm86`, `create_module`, `sysfs`, `syslog`

The profile also restricts `clone` to disallow creating new namespaces
(`CLONE_NEWNS`, `CLONE_NEWNET`, etc.).

### AppArmor (`docker/apparmor/syntaro-sandbox`)

Uses a **default-DENY** policy — only explicitly allowed resources are
accessible. Key constraints:

- **Network**: outbound TCP/UDP only (DNS + HTTP/S via proxy)
- **Capabilities**: `chown`, `dac_override`, `dac_read_search`, `fowner`,
  `fsetid`, `setgid`, `setuid`, `net_bind_service`, `net_raw`, `sys_ptrace`
- **Workspace**: full read-write on `/home/node/**`
- **System binaries**: read + execute on `/bin/**`, `/usr/bin/**`, `/usr/lib/**`
- **Temp**: read-write on `/tmp/**`
- **Denied**: `/proc/**`, `/sys/**`, `/dev/**`, `/etc/shadow`, `/boot/**`,
  `/root/**`, `/var/log/**`
- **ptrace**: only same-UID processes in the workspace tree

## Python API

The `workers.sandbox.harden` module exposes three functions:

```python
from workers.sandbox.harden import get_secure_config, get_seccomp_profile, get_apparmor_profile

# Recommended docker run defaults
config = get_secure_config()
# => {"memory": "2g", "cpus": 1.0, "read_only": True, ...}

# Seccomp profile as a dict
seccomp = get_seccomp_profile()
# => {"defaultAction": "SCMP_ACT_ALLOW", "architectures": [...], "syscalls": [...]}

# AppArmor profile as raw text
apparmor = get_apparmor_profile()
# => "profile syntaro-sandbox flags=(attach_disconnected, ...) { ... }"
```

### Integration with `DockerSandbox`

```python
from workers.sandbox.provider import DockerSandbox
from workers.sandbox.harden import get_secure_config

cfg = get_secure_config()
provider = DockerSandbox(
    memory_limit=cfg["memory"],        # type: ignore[arg-type]
    cpu_limit=cfg["cpus"],             # type: ignore[arg-type]
    read_only_rootfs=cfg["read_only"],  # type: ignore[arg-type]
    network_disabled=cfg["network_disabled"],  # type: ignore[arg-type]
)
```

## Shell script

The `scripts/docker-sandbox-security.sh` script:

1. Installs the seccomp profile to `/etc/docker/seccomp/sandbox.json`.
2. Loads the AppArmor profile into the kernel (if AppArmor is available).
3. Prints an example `docker run` command using both profiles.

```bash
# Install
sudo ./scripts/docker-sandbox-security.sh

# Check status
sudo ./scripts/docker-sandbox-security.sh --status

# Remove AppArmor profile from kernel
sudo ./scripts/docker-sandbox-security.sh --unload
```

## Verification

After installation, verify the profiles are active:

```bash
# Seccomp
docker run --rm --security-opt seccomp=/etc/docker/seccomp/sandbox.json \
  alpine echo "seccomp works"

# AppArmor
docker run --rm --security-opt apparmor=syntaro-sandbox \
  alpine echo "apparmor works"

# Both combined
docker run --rm --init \
  --security-opt seccomp=/etc/docker/seccomp/sandbox.json \
  --security-opt apparmor=syntaro-sandbox \
  --read-only \
  --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE \
  --cap-add FOWNER --cap-add FSETID --cap-add SETGID --cap-add SETUID \
  --memory 2g --cpus 1.0 \
  python:3.12-slim python -c "print('hardened sandbox OK')"
```

## Reference

- [Docker seccomp security profiles](https://docs.docker.com/engine/security/seccomp/)
- [Docker AppArmor security profiles](https://docs.docker.com/engine/security/apparmor/)
- [Docker security fundamentals](https://docs.docker.com/engine/security/)
- [Open Containers Runtime Spec — seccomp](https://github.com/opencontainers/runtime-spec/blob/main/config-linux.md#seccomp)
