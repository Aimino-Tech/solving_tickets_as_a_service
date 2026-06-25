import json
import logging
import os
from typing import Any

from celery import shared_task

from workers.sandbox.hardening import (
    APPARMOR_PROFILE_PATH,
    SECCOMP_PROFILE_PATH,
    SandboxHardeningConfig,
    build_docker_run_command,
    build_default_seccomp_profile,
    run_cis_benchmark,
    scan_base_image,
    write_apparmor_profile,
    write_seccomp_profile,
)

logger = logging.getLogger(__name__)


@shared_task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name="workers.tasks.sandbox_hardening.apply_sandbox_hardening",
    autoretry_for=(Exception,),
)
def apply_sandbox_hardening(
    self,
    image: str,
    workspace_path: str,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    logger.info("Applying sandbox hardening — image=%s workspace=%s", image, workspace_path)
    cfg = SandboxHardeningConfig()
    if config:
        cfg = SandboxHardeningConfig(
            use_gvisor=config.get("use_gvisor", True),
            drop_all_capabilities=config.get("drop_all_capabilities", True),
            read_only_root=config.get("read_only_root", True),
            non_root_user=config.get("non_root_user", "1000:1000"),
            seccomp_profile_path=config.get("seccomp_profile_path", SECCOMP_PROFILE_PATH),
            apparmor_profile_path=config.get("apparmor_profile_path", APPARMOR_PROFILE_PATH),
            scan_base_images=config.get("scan_base_images", True),
            run_cis_benchmarks=config.get("run_cis_benchmarks", False),
        )

    seccomp_result = {}
    if cfg.seccomp_profile_path:
        try:
            profile = write_seccomp_profile(cfg.seccomp_profile_path)
            seccomp_result = {
                "path": cfg.seccomp_profile_path,
                "allowed_syscalls": len(profile["syscalls"][0]["names"]),
            }
        except OSError as exc:
            logger.warning("Failed to write seccomp profile: %s", exc)

    apparmor_result = {}
    if cfg.apparmor_profile_path:
        try:
            write_apparmor_profile(cfg.apparmor_profile_path, workspace_path)
            apparmor_result = {"path": cfg.apparmor_profile_path}
        except OSError as exc:
            logger.warning("Failed to write AppArmor profile: %s", exc)

    cis_results = {}
    if cfg.run_cis_benchmarks:
        cis_results = run_cis_benchmark()

    image_scan = {}
    if cfg.scan_base_images:
        image_scan = scan_base_image(image)

    docker_cmd = build_docker_run_command(
        image=image,
        workspace_path=workspace_path,
        use_gvisor=cfg.use_gvisor,
        seccomp_profile=cfg.seccomp_profile_path,
        apparmor_profile=cfg.apparmor_profile_path,
        read_only_root=cfg.read_only_root,
        user=cfg.non_root_user,
    )

    return {
        "image": image,
        "workspace_path": workspace_path,
        "config": cfg.to_dict(),
        "docker_command": docker_cmd,
        "seccomp_profile": seccomp_result,
        "apparmor_profile": apparmor_result,
        "cis_benchmark": cis_results,
        "image_scan": image_scan,
        "hardened": True,
    }
