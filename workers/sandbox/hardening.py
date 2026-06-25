import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

SECCOMP_PROFILE_PATH = "/etc/stas/seccomp/stas-default.json"
APPARMOR_PROFILE_PATH = "/etc/stas/apparmor/stas-default"
CIS_BENCHMARK_PATH = "/usr/local/bin/docker-bench-security.sh"
GRYPE_BINARY = "/usr/local/bin/grype"
TRIVY_BINARY = "/usr/local/bin/trivy"

SECCOMP_DEFAULT_PROFILE = {
    "defaultAction": "SCMP_ACT_ERRNO",
    "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
    "syscalls": [
        {"names": ["accept", "accept4", "access", "alarm", "bind", "brk", "clock_getres", "clock_gettime", "clock_nanosleep", "clone", "close", "connect", "creat", "dup", "dup2", "dup3", "epoll_create", "epoll_create1", "epoll_ctl", "epoll_ctl", "epoll_pwait", "epoll_wait", "eventfd", "eventfd2", "execve", "exit", "exit_group", "faccessat", "fadvise64", "fadvise64_64", "fallocate", "fchdir", "fchmod", "fchmodat", "fchown", "fchownat", "fcntl", "fcntl64", "fdatasync", "fgetxattr", "flistxattr", "flock", "fork", "fremovexattr", "fsetxattr", "fstat", "fstat64", "fstatat64", "fstatfs", "fstatfs64", "fsync", "ftruncate", "ftruncate64", "futex", "futimesat", "getcpu", "getcwd", "getdents", "getdents64", "getegid", "geteuid", "getgid", "getgroups", "getpeername", "getpgid", "getpgrp", "getpid", "getppid", "getpriority", "getrandom", "getresgid", "getresuid", "getrlimit", "getrusage", "getsockname", "getsockopt", "gettid", "gettimeofday", "getuid", "getxattr", "inotify_add_watch", "inotify_init1", "inotify_rm_watch", "io_cancel", "io_destroy", "io_getevents", "io_setup", "io_submit", "ioctl", "ioprio_get", "ioprio_set", "ipc", "listen", "lseek", "lstat", "lstat64", "madvise", "mincore", "mkdir", "mkdirat", "mlock", "mlock2", "mlockall", "mmap", "mmap2", "mprotect", "mq_getsetattr", "mq_notify", "mq_open", "mq_timedreceive", "mq_timedsend", "mq_unlink", "mremap", "msgctl", "msgget", "msgrcv", "msgsnd", "msync", "munlock", "munlockall", "munmap", "nanosleep", "newfstatat", "open", "openat", "pause", "pipe", "pipe2", "poll", "ppoll", "prctl", "pread64", "preadv", "prlimit64", "pselect6", "pwrite64", "pwritev", "read", "readahead", "readlink", "readlinkat", "readv", "recv", "recvfrom", "recvmsg", "remap_file_pages", "removexattr", "rename", "renameat", "renameat2", "restart_syscall", "rmdir", "rt_sigaction", "rt_sigpending", "rt_sigprocmask", "rt_sigqueueinfo", "rt_sigreturn", "rt_sigsuspend", "rt_sigtimedwait", "rt_tgsigqueueinfo", "sched_getaffinity", "sched_getattr", "sched_getparam", "sched_getscheduler", "sched_rr_get_interval", "sched_setaffinity", "sched_setattr", "sched_setparam", "sched_setscheduler", "sched_yield", "seccomp", "select", "semctl", "semget", "semop", "semtimedop", "send", "sendfile", "sendfile64", "sendmsg", "sendto", "set_robust_list", "set_tid_address", "setgid", "setgroups", "sethostname", "setitimer", "setpgid", "setpriority", "setrlimit", "setsid", "setsockopt", "setuid", "shmctl", "shmdt", "shmget", "shutdown", "sigaltstack", "signalfd", "signalfd4", "socket", "socketpair", "splice", "stat", "stat64", "statfs", "statfs64", "statx", "symlink", "symlinkat", "sync", "sync_file_range", "syncfs", "sysinfo", "tee", "tgkill", "time", "timer_create", "timer_delete", "timer_getoverrun", "timer_gettime", "timer_settime", "timerfd_create", "timerfd_gettime", "timerfd_settime", "times", "truncate", "truncate64", "umask", "uname", "unlink", "unlinkat", "unshare", "utime", "utimensat", "utimes", "vfork", "wait4", "waitid", "waitpid", "write", "writev"],
        "action": "SCMP_ACT_ALLOW",
    },
    ],
}

BLOCKED_SYSCALLS = ["mount", "umount", "umount2", "ptrace", "perf_event_open", "bpf", "kexec_file_load", "kexec_load", "open_by_handle_at", "name_to_handle_at", "process_vm_readv", "process_vm_writev", "pivot_root", "chroot", "swapon", "swapoff", "delete_module", "init_module", "finit_module"]


def build_default_seccomp_profile() -> dict[str, Any]:
    profile = json.loads(json.dumps(SECCOMP_DEFAULT_PROFILE))
    allowed_syscalls = set(profile["syscalls"][0]["names"])
    for blocked in BLOCKED_SYSCALLS:
        allowed_syscalls.discard(blocked)
    profile["syscalls"][0]["names"] = sorted(allowed_syscalls)
    return profile


def write_seccomp_profile(output_path: str) -> dict[str, Any]:
    profile = build_default_seccomp_profile()
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(profile, f, indent=2)
    logger.info("Seccomp profile written to %s — %d syscalls allowed", output_path, len(profile["syscalls"][0]["names"]))
    return profile


def write_apparmor_profile(output_path: str, workspace_path: str) -> str:
    profile_content = f"""#include <tunables/global>

profile stas-sandbox flags=(attach_disconnected,mediate_deleted) {{
  #include <abstractions/base>
  #include <abstractions/nameservice>

  # Workspace directory access
  {workspace_path}/ r,
  {workspace_path}/** rwk,

  # Temp directory access
  /tmp/** rwk,
  /var/tmp/** rwk,

  # Minimal binary access
  /usr/bin/** rix,
  /bin/** rix,

  # Library access (read-only)
  /usr/lib/** r,
  /lib/** r,
  /lib64/** r,

  # Config access (read-only)
  /etc/ r,
  /etc/** r,

  # Deny everything else
  deny /** w,
  deny /** m,
  deny /** x,
}}
"""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w") as f:
        f.write(profile_content)
    logger.info("AppArmor profile written to %s — workspace=%s", output_path, workspace_path)
    return profile_content


def build_docker_run_command(
    image: str,
    workspace_path: str,
    command: list[str] | None = None,
    use_gvisor: bool = True,
    seccomp_profile: str = SECCOMP_PROFILE_PATH,
    apparmor_profile: str = APPARMOR_PROFILE_PATH,
    read_only_root: bool = True,
    user: str = "1000:1000",
    extra_mounts: list[str] | None = None,
) -> list[str]:
    cmd = ["docker", "run", "--rm"]

    if use_gvisor:
        cmd.extend(["--runtime", "runsc"])

    if seccomp_profile and os.path.isfile(seccomp_profile):
        cmd.extend(["--security-opt", f"seccomp={seccomp_profile}"])
    else:
        cmd.extend(["--security-opt", "seccomp=unconfined"])

    if apparmor_profile and os.path.isfile(apparmor_profile):
        cmd.extend(["--security-opt", f"apparmor={apparmor_profile}"])

    cmd.extend(["--cap-drop=ALL"])

    if read_only_root:
        cmd.extend(["--read-only"])

    if user:
        cmd.extend(["--user", user])

    cmd.extend(["-v", f"{workspace_path}:/workspace:rw"])

    if extra_mounts:
        for m in extra_mounts:
            cmd.extend(["-v", m])

    cmd.extend(["-w", "/workspace"])
    cmd.append(image)

    if command:
        cmd.extend(command)

    return cmd


def scan_base_image(image: str) -> dict[str, Any]:
    results: dict[str, Any] = {"critical": 0, "high": 0, "medium": 0, "low": 0}

    if os.path.isfile(GRYPE_BINARY):
        try:
            result = subprocess.run(
                [GRYPE_BINARY, image, "--fail-on", "critical", "--scope", "all-layers", "-o", "json"],
                capture_output=True,
                text=True,
                timeout=300,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                for match in data.get("matches", []):
                    sev = match.get("vulnerability", {}).get("severity", "unknown").lower()
                    if sev == "critical":
                        results["critical"] += 1
                    elif sev == "high":
                        results["high"] += 1
                    elif sev == "medium":
                        results["medium"] += 1
                    else:
                        results["low"] += 1
                logger.info("grype scan: %s — %s", image, results)
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
            logger.warning("grype scan failed: %s", exc)
    elif os.path.isfile(TRIVY_BINARY):
        try:
            result = subprocess.run(
                [TRIVY_BINARY, "image", "--severity", "CRITICAL,HIGH", "--format", "json", image],
                capture_output=True,
                text=True,
                timeout=300,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                for result_item in data.get("Results", []):
                    for vuln in result_item.get("Vulnerabilities", []):
                        sev = vuln.get("Severity", "unknown").lower()
                        if sev == "critical":
                            results["critical"] += 1
                        elif sev == "high":
                            results["high"] += 1
                        elif sev == "medium":
                            results["medium"] += 1
                        else:
                            results["low"] += 1
                logger.info("trivy scan: %s — %s", image, results)
        except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
            logger.warning("trivy scan failed: %s", exc)
    else:
        logger.warning("No vulnerability scanner available (grype/trivy not installed)")

    return results


def run_cis_benchmark() -> dict[str, Any]:
    results: dict[str, Any] = {"pass": 0, "warn": 0, "fail": 0, "info": 0}
    if os.path.isfile(CIS_BENCHMARK_PATH):
        try:
            result = subprocess.run(
                [CIS_BENCHMARK_PATH],
                capture_output=True,
                text=True,
                timeout=300,
            )
            for line in result.stdout.split("\n"):
                line = line.strip().lower()
                if "[pass]" in line or "[passed]" in line:
                    results["pass"] += 1
                elif "[warn]" in line or "[warning]" in line:
                    results["warn"] += 1
                elif "[fail]" in line or "[failed]" in line:
                    results["fail"] += 1
                elif "[info]" in line:
                    results["info"] += 1
            logger.info("CIS benchmark: %s", results)
        except (subprocess.TimeoutExpired, OSError) as exc:
            logger.warning("CIS benchmark failed: %s", exc)
    else:
        logger.info("CIS benchmark not available")
    return results


class SandboxHardeningConfig:
    def __init__(
        self,
        use_gvisor: bool = True,
        drop_all_capabilities: bool = True,
        read_only_root: bool = True,
        non_root_user: str = "1000:1000",
        seccomp_profile_path: str = SECCOMP_PROFILE_PATH,
        apparmor_profile_path: str = APPARMOR_PROFILE_PATH,
        scan_base_images: bool = True,
        run_cis_benchmarks: bool = False,
    ):
        self.use_gvisor = use_gvisor
        self.drop_all_capabilities = drop_all_capabilities
        self.read_only_root = read_only_root
        self.non_root_user = non_root_user
        self.seccomp_profile_path = seccomp_profile_path
        self.apparmor_profile_path = apparmor_profile_path
        self.scan_base_images = scan_base_images
        self.run_cis_benchmarks = run_cis_benchmarks

    def to_dict(self) -> dict[str, Any]:
        return {
            "use_gvisor": self.use_gvisor,
            "drop_all_capabilities": self.drop_all_capabilities,
            "read_only_root": self.read_only_root,
            "non_root_user": self.non_root_user,
            "seccomp_profile_path": self.seccomp_profile_path,
            "apparmor_profile_path": self.apparmor_profile_path,
            "scan_base_images": self.scan_base_images,
            "run_cis_benchmarks": self.run_cis_benchmarks,
        }
