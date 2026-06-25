# Docker Sandbox Hardening

This document describes the security hardening measures applied to the Docker sandbox used for agentic code execution in STAS.

## Overview

The Docker sandbox isolates untrusted code execution in containers with multiple layers of defense:

1. **Seccomp** — Restricts available syscalls to prevent container escape
2. **AppArmor** — Limits filesystem access to workspace directories
3. **Capability Dropping** — Removes all Linux capabilities by default
4. **Read-Only Root Filesystem** — Prevents persistent modifications
5. **No New Privileges** — Prevents privilege escalation
6. **Network Isolation** — Blocks or restricts network access
7. **Non-Root User** — Code runs as an unprivileged user
8. **gVisor Runtime** — Optional sandboxed kernel for extra isolation
9. **Vulnerability Scanning** — CVE scanning of base images

## Security Layers

### 1. Seccomp Profile

**File**: `src/sandbox/profiles/seccomp.json`

A custom seccomp (secure computing mode) profile that blocks dangerous syscalls while allowing normal program execution.

**Blocked syscalls include**:
- `mount` / `umount` / `umount2` — Filesystem mounting (container escape vector)
- `ptrace` — Process tracing and debugging
- `bpf` — Berkeley Packet Filter (kernel exploit vector)
- `perf_event_open` — Performance monitoring (side-channel attacks)
- `kexec_load` / `kexec_file_load` — Kernel execution (container escape)
- `swapon` / `swapoff` — Swap manipulation
- `reboot` — System reboot
- `ioperm` / `iopl` — I/O port access
- `init_module` / `finit_module` / `delete_module` — Kernel module loading
- `io_uring_*` — Async I/O (potential kernel exploit vector)
- `keyctl` / `add_key` / `request_key` — Kernel keyring manipulation
- `process_vm_readv` / `process_vm_writev` — Cross-process memory access
- `setns` — Namespace switching (container escape)
- `unshare` — Namespace unsharing
- `userfaultfd` — Userfault file descriptor
- `personality` — Process execution domain
- `syslog` — Kernel log access
- `seccomp` — Seccomp filter manipulation

**Applied via**: `--security-opt seccomp=<profile-path>`

### 2. AppArmor Profile

**File**: `src/sandbox/profiles/apparmor-profile`

An AppArmor profile that restricts filesystem access to workspace directories (`/home/node`, `/home/user`, `/tmp`).

**Applied via**: `--security-opt apparmor=<profile-name>`

**Note**: The AppArmor profile must be loaded into the kernel before use:

```bash
sudo apparmor_parser -r /path/to/src/sandbox/profiles/apparmor-profile
```

### 3. Capability Dropping

All Linux capabilities are dropped by default:

```
--cap-drop=ALL
```

No capabilities are added unless explicitly required (e.g., `NET_ADMIN` + `NET_RAW` for network tests).

### 4. Read-Only Root Filesystem

The container root filesystem is mounted read-only:

```
--read-only
--tmpfs /tmp:rw,noexec,nosuid,size=2g
```

A writable tmpfs is mounted at `/tmp` for temporary files, with `noexec` and `nosuid` restrictions.

### 5. No New Privileges

Prevents privilege escalation via setuid binaries:

```
--security-opt no-new-privileges:true
```

### 6. Network Isolation

By default, containers have no network access:

```
--network none
```

When network access is required (e.g., for dependency installation), traffic is routed through an egress proxy (Squid) with strict allowlisting.

### 7. Non-Root User

Containers run as the `node` user (UID 1000) with the working directory at `/home/node`. This prevents root-level access to container resources.

### 8. gVisor Runtime (Optional)

Support for the gVisor sandboxed kernel runtime is configurable:

| Config | Value | Description |
|---|---|---|
| `docker.runtime` | `runc` (default) | Standard Docker runtime |
| `docker.runtime` | `runsc` | gVisor sandboxed kernel |

When `runsc` is selected, the `--runtime=runsc` flag is added to container creation.

**Prerequisites**: Install gVisor on the host:
```bash
# Install runsc
sudo apt-get install runsc  # or download from https://gvisor.dev/docs/user_guide/install/
sudo runsc install
```

### 9. Vulnerability Scanning

**File**: `src/sandbox/scan.ts`

Functions for scanning Docker base images for CVEs:

| Function | Description |
|---|---|
| `scanImage(image, options)` | Scan an image and return results |
| `assertImageSafe(image, options)` | Scan and throw on critical/high CVEs |
| `clearScanCache(image?)` | Clear scan cache |

**Supported scanners** (auto-detected):
- [Grype](https://github.com/anchore/grype) — Anchore's vulnerability scanner
- [Trivy](https://github.com/aquasecurity/trivy) — Aqua Security's scanner

**Configuration**:

| Variable | Default | Description |
|---|---|---|
| `DOCKER_IMAGE_SCAN_ENABLED` | `true` | Enable/disable scanning |
| `DOCKER_IMAGE_SCAN_FAIL_ON` | `critical` | Fail threshold (`critical` or `high`) |

Results are cached to avoid re-scanning the same image.

## Container Creation Arguments

When container security is fully hardened, the effective Docker create command includes:

```bash
docker create \
  --init \
  --rm \
  --security-opt seccomp=/app/src/sandbox/profiles/seccomp.json \
  --security-opt apparmor=stas-sandbox \
  --security-opt no-new-privileges:true \
  --cap-drop=ALL \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=2g \
  --runtime=runc \
  --network none \
  --label stas-sandbox=true \
  -w /home/node \
  -e HOME=/home/node \
  -e USER=node \
  <image> \
  tail -f /dev/null
```

## Verification

Run the hardening tests to verify all security measures are applied:

```bash
npx vitest run src/__tests__/sandbox/hardening.test.ts
```

## Adding New Security Measures

1. Add the security flag to `buildCreateArgs()` in `src/sandbox/docker.ts`
2. Add the same flag to `createContainer()` in `src/sandbox/pool.ts` (for warm containers)
3. Add configuration options to `src/config.ts`
4. Add tests in `src/__tests__/sandbox/hardening.test.ts`
5. Update this document

## Security Checklist

- [ ] Seccomp profile blocks dangerous syscalls
- [ ] AppArmor profile restricts filesystem access
- [ ] All capabilities dropped
- [ ] Root filesystem is read-only
- [ ] No new privileges enforced
- [ ] Network is disabled or restricted
- [ ] Container runs as non-root user
- [ ] gVisor runtime available as option
- [ ] Base image vulnerability scanning
- [ ] Docker `--init` flag for proper signal handling
- [ ] No `--privileged` mode
- [ ] No `--pid=host` or `--ipc=host`
- [ ] Resource limits applied (memory, CPU)
