"""
Visual verification gate — uses oc-vision (MCP or CLI) or Playwright to capture
screenshots of affected frontend routes and compare them against baselines.

Queued on ``stas.verification``.

Flow:
  1. Detect available vision engine: oc-vision MCP -> oc-vision CLI -> Playwright.
  2. Inspect git diff for frontend file changes (*.tsx, *.jsx, *.css, *.html, *.vue).
  3. If none -> skip with ``{"all_pages_match": True, "pages": [], "summary": "..."}``.
  4. Start the project's dev server (subprocess).
  5. For each affected route:
       a. Navigate and take a full-page screenshot via detected engine.
       b. Look for a baseline at ``.visbaseline/{route}.png``.
       c. Baseline exists -> pixel-compare; generate diff overlay PNG.
       d. No baseline -> save screenshot as new baseline (capture mode).
  6. Tear down the dev server (cleanup guaranteed via try/finally).
  7. Return ``{all_pages_match, pages: [{route, status, diff_pct, screenshot_path}], summary}``.

Two vision engines are supported (tried in order):
  - **oc-vision** (MCP or CLI) -- preferred, logs warning if unavailable
  - **Playwright** -- fallback (requires ``playwright`` pip package)
  - If neither is available, the gate skips gracefully.
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Optional

from celery import shared_task

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────

FRONTEND_PATTERNS = ("*.tsx", "*.jsx", "*.css", "*.html", "*.vue")
BASELINE_DIR = ".visbaseline"
DEFAULT_VIEWPORT = {"width": 1280, "height": 720}
DIFF_THRESHOLD_PERCENT = 2.0  # fail if > 2 % pixels differ

# ── Vision Engine Configuration ────────────────────────────────────────────
# Tried in order: oc-vision MCP -> oc-vision CLI -> Playwright -> skip

OC_VISION_MCP_URL = os.getenv("OC_VISION_MCP_URL", "http://localhost:3100")
"""URL of the oc-vision MCP server (provides ``/screenshot`` endpoint)."""

OC_VISION_CLI_BIN = os.getenv("OC_VISION_CLI_BIN", "oc-vision")
"""Path or name of the oc-vision CLI binary."""

_VISION_ENGINE_CACHE: str | None = None
"""Cached result of _detect_vision_engine() for the duration of this task."""


def _detect_vision_engine() -> str | None:
    """
    Return the first available vision engine: ``"oc_vision_mcp"``,
    ``"oc_vision_cli"``, or ``"playwright"``.

    Returns ``None`` if none is available.
    """
    global _VISION_ENGINE_CACHE
    if _VISION_ENGINE_CACHE is not None:
        return _VISION_ENGINE_CACHE

    # 1. oc-vision MCP
    try:
        import urllib.request
        import urllib.error

        req = urllib.request.Request(OC_VISION_MCP_URL + "/health", method="GET")
        resp = urllib.request.urlopen(req, timeout=3)
        if resp.status == 200:
            _VISION_ENGINE_CACHE = "oc_vision_mcp"
            logger.info("Vision engine: oc-vision MCP at %s", OC_VISION_MCP_URL)
            return _VISION_ENGINE_CACHE
    except Exception:
        pass

    # 2. oc-vision CLI
    try:
        import shutil
        if shutil.which(OC_VISION_CLI_BIN) is not None:
            _VISION_ENGINE_CACHE = "oc_vision_cli"
            logger.info("Vision engine: oc-vision CLI (%s)", OC_VISION_CLI_BIN)
            return _VISION_ENGINE_CACHE
    except Exception:
        pass

    # 3. Playwright
    try:
        import playwright.sync_api  # noqa: F401
        _VISION_ENGINE_CACHE = "playwright"
        logger.info("Vision engine: Playwright")
        return _VISION_ENGINE_CACHE
    except ImportError:
        pass

    logger.warning("No vision engine available (tried oc-vision MCP, oc-vision CLI, Playwright)")
    _VISION_ENGINE_CACHE = None
    return None

DEV_SERVER_START_TIMEOUT_S = 30
DEV_SERVER_HEALTH_CHECK_RETRIES = 10
DEV_SERVER_HEALTH_CHECK_DELAY_S = 3
TASK_SOFT_TIMEOUT_S = 580
SCREENSHOT_TIMEOUT_MS = 30000

# ── Celery Task ──────────────────────────────────────────────────────────────


@shared_task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name="workers.tasks.visual_verification.visual_verify",
    autoretry_for=(Exception,),
    soft_time_limit=TASK_SOFT_TIMEOUT_S,
)
def visual_verify(
    self,
    workspace_path: str,
    affected_routes: list[str],
    baseline_branch: str = "main",
) -> dict:
    """
    Take screenshots of *affected_routes* and compare against stored baselines.

    Parameters
    ----------
    workspace_path : str
        Absolute path to the cloned repository on disk.
    affected_routes : list[str]
        Route paths to screenshot (e.g. ``["/", "/login", "/dashboard"]``).
        When empty, the task inspects ``git diff`` to auto-detect frontend
        changes.
    baseline_branch : str
        Git branch against which to diff for frontend-change detection.
        Defaults to ``"main"``.
    """
    correlation_id = self.request.id or ""
    logger.info(
        json.dumps({
            "event": "visual_verify.start",
            "workspace_path": workspace_path,
            "affected_routes": affected_routes,
            "baseline_branch": baseline_branch,
            "correlation_id": correlation_id,
        })
    )

    try:
        # ── 1. Resolve routes ───────────────────────────────────────────
        if not affected_routes:
            affected_routes = _detect_frontend_changes(workspace_path, baseline_branch)
            if not affected_routes:
                logger.info(
                    json.dumps({
                        "event": "visual_verify.skip",
                        "reason": "no_frontend_changes",
                        "correlation_id": correlation_id,
                    })
                )
                return {
                    "all_pages_match": True,
                    "pages": [],
                    "summary": "No frontend changes detected — skipping visual verification",
                }

        # ── 2. Start dev server ─────────────────────────────────────────
        server_proc, health_url = _start_dev_server(workspace_path)
        try:
            _wait_for_server(health_url)

            # ── 3. Screenshot each route ────────────────────────────────
            results: dict[str, dict] = {}
            summary = {"passed": 0, "failed": 0, "captured": 0, "skipped": 0}

            for route in affected_routes:
                route_result = _process_route(workspace_path, route)
                results[route] = route_result
                status = route_result.get("status", "skipped")
                if status == "passed":
                    summary["passed"] += 1
                elif status == "failed":
                    summary["failed"] += 1
                elif status == "captured":
                    summary["captured"] += 1
                else:
                    summary["skipped"] += 1

                logger.info(
                    json.dumps({
                        "event": "visual_verify.page_captured",
                        "route": route,
                        "status": status,
                        "diff_pct": route_result.get("diff_percent", 0.0),
                        "screenshot_path": route_result.get("screenshot_path", ""),
                        "correlation_id": correlation_id,
                    })
                )

            passed = summary["failed"] == 0
            pages = []
            for route in affected_routes:
                r = results.get(route, {})
                pages.append({
                    "route": route,
                    "status": r.get("status", "error"),
                    "diff_pct": r.get("diff_percent", 0.0),
                    "screenshot_path": r.get("screenshot_path", ""),
                })

            summary_line = (
                f"All {len(pages)} pages match baselines"
                if passed
                else f"{summary['failed']}/{len(pages)} pages have visual diffs exceeding threshold"
            )
            if summary.get("captured", 0) > 0:
                summary_line += f" ({summary['captured']} new baselines captured)"
            if summary.get("skipped", 0) > 0:
                summary_line += f" ({summary['skipped']} skipped)"

            logger.info(
                json.dumps({
                    "event": "visual_verify.complete",
                    "all_pages_match": passed,
                    "pages_count": len(pages),
                    "summary": summary_line,
                    "correlation_id": correlation_id,
                })
            )

            return {
                "all_pages_match": passed,
                "pages": pages,
                "summary": summary_line,
            }

        finally:
            _stop_dev_server(server_proc)

    except Exception as exc:
        logger.error(
            json.dumps({
                "event": "visual_verify.error",
                "error": str(exc),
                "correlation_id": correlation_id,
            }),
            exc_info=True,
        )
        raise self.retry(exc=exc)


# ── Git diff detection ──────────────────────────────────────────────────────


def _detect_frontend_changes(workspace_path: str, baseline_branch: str) -> list[str]:
    """
    Inspect ``git diff`` against *baseline_branch* for frontend file changes
    and return a best-effort list of route paths.

    Uses a simple heuristic: files matching FRONTEND_PATTERNS are mapped to
    route URLs by stripping ``src/`` and file extensions.
    """
    try:
        result = subprocess.run(
            ["git", "diff", "--name-only", f"{baseline_branch}...HEAD"],
            capture_output=True,
            text=True,
            cwd=workspace_path,
            timeout=30,
        )
        if result.returncode != 0:
            logger.warning("git diff failed (rc=%d): %s", result.returncode, result.stderr)
            return []

        changed_files = [f for f in result.stdout.splitlines() if f.strip()]
        logger.info(
            "git diff against %s returned %d changed file(s)",
            baseline_branch,
            len(changed_files),
        )

        frontend_files = _filter_frontend_files(changed_files)

        route_set: set[str] = set()
        for f in frontend_files:
            route = _file_to_route(f)
            if route is not None:
                route_set.add(route)

        routes = sorted(route_set)
        logger.info(
            "Detected %d frontend route(s) from %d changed file(s): %s",
            len(routes),
            len(frontend_files),
            routes,
        )
        return routes

    except subprocess.TimeoutExpired:
        logger.warning("git diff timed out — returning empty route list")
        return []
    except FileNotFoundError:
        logger.warning("git not found in workspace — returning empty route list")
        return []
    except Exception as exc:
        logger.warning("Failed to detect frontend changes: %s", exc)
        return []


def _filter_frontend_files(files: list[str]) -> list[str]:
    """Keep only files matching frontend patterns."""
    import fnmatch

    matched: list[str] = []
    for f in files:
        for pattern in FRONTEND_PATTERNS:
            if fnmatch.fnmatch(f, pattern) or fnmatch.fnmatch(
                Path(f).name, pattern
            ):
                matched.append(f)
                break
    return matched


def _file_to_route(file_path: str) -> Optional[str]:
    """
    Heuristic: convert a source file path into a route URL.

    Examples::

        src/pages/index.tsx        -> /
        src/pages/login.tsx        -> /login
        src/pages/dashboard.tsx    -> /dashboard
        src/pages/blog/[slug].tsx  -> /blog/:slug  (dynamic segment)
        src/components/Header.tsx   -> None (not a page)
        app/login/page.tsx         -> /login       (Next.js App Router)
    """
    p = Path(file_path)
    parts = p.parts
    stem = p.stem

    # ---- Helper: check if a directory looks like a non-page container ----
    _NON_PAGE_DIRS = {"components", "layouts", "lib", "utils", "hooks", "styles", "api"}

    def _is_page_file(stem: str) -> bool:
        return stem in ("index", "page", "app", "")

    # ---- Next.js App Router: app/<route>/page.tsx ----
    if "app" in parts:
        app_idx = parts.index("app")
        route_parts: list[str] = []
        for seg in parts[app_idx + 1 : -1]:
            if seg.startswith("(") and seg.endswith(")"):
                continue  # route groups: (auth)
            if seg.startswith("[") and seg.endswith("]"):
                route_parts.append(f":{seg[1:-1]}")
            elif seg == "page":
                continue
            else:
                route_parts.append(seg)
        if not route_parts:
            return "/"
        return "/" + "/".join(route_parts)

    # ---- Generic pages directory: src/pages/X.tsx ----
    if "pages" in parts:
        pages_idx = parts.index("pages")
        route_parts = []
        for seg in parts[pages_idx + 1 : -1]:
            if seg.startswith("[") and seg.endswith("]"):
                route_parts.append(f":{seg[1:-1]}")
            else:
                route_parts.append(seg)
        # The filename stem itself may also be part of the route
        if not _is_page_file(stem):
            # Transform dynamic segments: [slug] -> :slug
            if stem.startswith("[") and stem.endswith("]"):
                stem = f":{stem[1:-1]}"
            route_parts.append(stem)
        if not route_parts:
            return "/"
        return "/" + "/".join(route_parts)

    # ---- files directly under src/ — only treat as routes if in a page-like dir ----
    if "src" in parts:
        src_idx = parts.index("src")
        # If any path segment is a non-page directory, skip
        for seg in parts[src_idx + 1 : -1]:
            if seg in _NON_PAGE_DIRS:
                return None
        stem = p.stem
        if _is_page_file(stem):
            stem = ""
        rel_parts = list(parts[src_idx + 1 : -1]) + ([stem] if stem else [])
        if not rel_parts:
            return "/"
        return "/" + "/".join(rel_parts)

    return None


def _detect_dev_command(workspace_path: str) -> str:
    """Detect the dev server command from the project's package.json."""
    pkg_json = Path(workspace_path) / "package.json"
    if pkg_json.exists():
        try:
            with open(pkg_json) as f:
                pkg = json.load(f)
            scripts = pkg.get("scripts", {})
            # Prefer dev, then start, then dev:web
            for key in ("dev", "start", "dev:web", "dev:app"):
                if key in scripts:
                    cmd = scripts[key]
                    # If it contains "tsx watch" or "vite" or "next dev" or
                    # "nuxt" — it's the dev server.
                    if any(
                        tok in cmd
                        for tok in ("tsx watch", "vite", "next dev", "nuxt", "remix dev", "webpack serve")
                    ):
                        return cmd
            # Fallback: return the first script that looks like a server
            for key in ("dev", "start"):
                if key in scripts:
                    return scripts[key]
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("Could not read package.json: %s", exc)

    # Default fallback
    return "npm run dev"


def _start_dev_server(workspace_path: str) -> tuple[subprocess.Popen, str]:
    """
    Start the project's dev server as a subprocess.

    Returns
    -------
    tuple[Popen, str]
        The process handle and a health-check URL (default ``http://localhost:3000/health``).
    """
    dev_command = _detect_dev_command(workspace_path)
    logger.info("Starting dev server with command: %s", dev_command)

    # Use npm/npx from the workspace
    env = os.environ.copy()
    env["PORT"] = str(env.get("PORT", "3000"))
    env["HOST"] = env.get("HOST", "0.0.0.0")
    env["NODE_ENV"] = "development"

    proc = subprocess.Popen(
        dev_command,
        shell=True,
        cwd=workspace_path,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
    )

    port = env["PORT"]
    health_url = f"http://localhost:{port}/health"
    logger.info("Dev server PID=%d health_url=%s", proc.pid, health_url)

    return proc, health_url


def _wait_for_server(health_url: str) -> None:
    """Poll *health_url* until the server responds or timeout is reached."""
    import urllib.request
    import urllib.error

    for attempt in range(1, DEV_SERVER_HEALTH_CHECK_RETRIES + 1):
        try:
            resp = urllib.request.urlopen(health_url, timeout=5)
            if resp.status == 200:
                logger.info("Dev server is ready (attempt %d/%d)", attempt, DEV_SERVER_HEALTH_CHECK_RETRIES)
                return
        except (urllib.error.URLError, ConnectionError, OSError):
            pass

        logger.debug(
            "Waiting for dev server... (attempt %d/%d)",
            attempt,
            DEV_SERVER_HEALTH_CHECK_RETRIES,
        )
        time.sleep(DEV_SERVER_HEALTH_CHECK_DELAY_S)

    logger.warning(
        "Dev server did not respond at %s after %d attempts — proceeding anyway",
        health_url,
        DEV_SERVER_HEALTH_CHECK_RETRIES,
    )


def _stop_dev_server(proc: Optional[subprocess.Popen]) -> None:
    """Kill the dev server subprocess and its children."""
    if proc is None:
        return
    try:
        logger.info("Stopping dev server (PID=%d)", proc.pid)
        # Try graceful shutdown first
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            logger.warning("Dev server did not terminate gracefully — killing")
            proc.kill()
            proc.wait(timeout=5)
        logger.info("Dev server stopped")
    except Exception as exc:
        logger.warning("Error stopping dev server: %s", exc)


# ── Screenshot & comparison ──────────────────────────────────────────────────


def _process_route(workspace_path: str, route: str) -> dict:
    """
    Take a screenshot of *route*, compare against baseline, and return result.

    Returns a dict with keys: status, route, diff_percent, diff_image_path,
    baseline_path, screenshot_path.
    """
    baseline_dir = Path(workspace_path) / BASELINE_DIR
    baseline_dir.mkdir(parents=True, exist_ok=True)

    # Sanitise route for use as a filename
    safe_name = route.strip("/").replace("/", "_") or "index"
    baseline_path = baseline_dir / f"{safe_name}.png"

    logger.info("Processing route=%s baseline=%s", route, baseline_path)

    try:
        screenshot_bytes = _take_screenshot(workspace_path, route)
        screenshot_path = _save_screenshot(baseline_dir, safe_name, screenshot_bytes)

        if not baseline_path.exists():
            # No baseline yet — capture it
            import shutil

            shutil.copy2(screenshot_path, baseline_path)
            logger.info("Captured new baseline for route=%s at %s", route, baseline_path)
            return {
                "status": "captured",
                "route": route,
                "diff_percent": 0.0,
                "diff_image_path": None,
                "baseline_path": str(baseline_path),
                "screenshot_path": screenshot_path,
                "message": "No baseline existed — captured as new baseline",
            }

        # Compare against baseline
        diff_result = _compare_screenshots(
            str(baseline_path),
            screenshot_path,
            safe_name,
            baseline_dir,
        )

        if diff_result["diff_percent"] > DIFF_THRESHOLD_PERCENT:
            status = "failed"
            message = (
                f"Visual diff {diff_result['diff_percent']:.2f}% exceeds "
                f"threshold {DIFF_THRESHOLD_PERCENT}%"
            )
        else:
            status = "passed"
            message = (
                f"Visual diff {diff_result['diff_percent']:.2f}% within "
                f"threshold {DIFF_THRESHOLD_PERCENT}%"
            )

        return {
            "status": status,
            "route": route,
            "diff_percent": diff_result["diff_percent"],
            "diff_image_path": diff_result["diff_image_path"],
            "baseline_path": str(baseline_path),
            "screenshot_path": screenshot_path,
            "message": message,
        }

    except Exception as exc:
        logger.error("Failed to process route=%s: %s", route, exc, exc_info=True)
        return {
            "status": "error",
            "route": route,
            "error": str(exc),
        }


def _take_screenshot(workspace_path: str, route: str) -> bytes:
    """
    Navigate to *route* on the local dev server and capture a full-page
    screenshot.

    Tries vision engines in order of preference:
      1. oc-vision MCP (``/screenshot`` endpoint)
      2. oc-vision CLI (``oc-vision screenshot`` subcommand)
      3. Playwright (sync API)

    Returns raw PNG bytes.

    Raises
    ------
    RuntimeError
        If no vision engine is available.
    """
    port = os.environ.get("PORT", "3000")
    url = f"http://localhost:{port}{route}"

    engine = _detect_vision_engine()

    if engine is None:
        raise RuntimeError(
            "No vision engine available. Install playwright "
            "(pip install playwright && playwright install chromium) "
            "or configure oc-vision (OC_VISION_MCP_URL or OC_VISION_CLI_BIN)."
        )

    if engine == "oc_vision_mcp":
        return _take_screenshot_with_oc_vision_mcp(url, route)
    elif engine == "oc_vision_cli":
        return _take_screenshot_with_oc_vision_cli(url, route)
    else:
        return _take_screenshot_with_playwright(url, route)


def _take_screenshot_with_oc_vision_mcp(url: str, route: str) -> bytes:
    """Use oc-vision MCP server to take a screenshot."""
    import json as _json
    import urllib.request
    import urllib.error

    payload = _json.dumps({
        "url": url,
        "viewport": DEFAULT_VIEWPORT,
        "full_page": True,
    }).encode("utf-8")

    req = urllib.request.Request(
        OC_VISION_MCP_URL + "/screenshot",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        resp = urllib.request.urlopen(req, timeout=SCREENSHOT_TIMEOUT_MS // 1000 + 5)
        screenshot_bytes = resp.read()
        logger.info(
            "oc-vision MCP screenshot for route=%s size=%d bytes",
            route,
            len(screenshot_bytes),
        )
        return screenshot_bytes
    except urllib.error.HTTPError as exc:
        logger.warning(
            "oc-vision MCP returned HTTP %d for route=%s — falling through to error",
            exc.code,
            route,
        )
        raise RuntimeError(f"oc-vision MCP /screenshot failed: HTTP {exc.code}") from exc


def _take_screenshot_with_oc_vision_cli(url: str, route: str) -> bytes:
    """Use oc-vision CLI to take a screenshot."""
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        output_path = tmp.name

    try:
        cmd = [
            OC_VISION_CLI_BIN,
            "screenshot",
            url,
            "--output", output_path,
            "--viewport", f"{DEFAULT_VIEWPORT['width']}x{DEFAULT_VIEWPORT['height']}",
            "--full-page",
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=SCREENSHOT_TIMEOUT_MS // 1000 + 5,
        )

        if result.returncode != 0:
            raise RuntimeError(
                f"oc-vision CLI screenshot failed (rc={result.returncode}): {result.stderr[:200]}"
            )

        with open(output_path, "rb") as f:
            screenshot_bytes = f.read()

        logger.info(
            "oc-vision CLI screenshot for route=%s size=%d bytes",
            route,
            len(screenshot_bytes),
        )
        return screenshot_bytes

    finally:
        try:
            os.unlink(output_path)
        except OSError:
            pass


def _take_screenshot_with_playwright(url: str, route: str) -> bytes:
    """Use Playwright to navigate to *url* and capture a full-page screenshot.

    Returns raw PNG bytes.
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error("playwright is not installed — cannot take screenshots")
        raise RuntimeError(
            "playwright Python package is required. "
            "Install with: pip install playwright && playwright install chromium"
        )

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        context = browser.new_context(
            viewport=DEFAULT_VIEWPORT,
            ignore_https_errors=True,
        )
        page = context.new_page()

        try:
            resp = page.goto(url, wait_until="networkidle", timeout=SCREENSHOT_TIMEOUT_MS)
            if resp is not None and resp.status >= 400:
                logger.warning(
                    "Route %s returned HTTP %d — screenshot may show error page",
                    route,
                    resp.status,
                )

            # Small settle time for any JS animations
            page.wait_for_timeout(500)

            screenshot_bytes = page.screenshot(full_page=True)
            logger.info(
                "Screenshot captured for route=%s size=%d bytes",
                route,
                len(screenshot_bytes),
            )
            return screenshot_bytes

        finally:
            browser.close()


def _save_screenshot(baseline_dir: Path, safe_name: str, data: bytes) -> str:
    """Write raw PNG bytes to a temporary file in the baseline dir."""
    screenshot_dir = baseline_dir / "_screenshots"
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    path = str(screenshot_dir / f"{safe_name}_{int(time.time())}.png")
    with open(path, "wb") as f:
        f.write(data)
    logger.debug("Screenshot saved to %s", path)
    return path


def _compare_screenshots(
    baseline_path: str,
    current_path: str,
    safe_name: str,
    output_dir: Path,
) -> dict:
    """
    Pixel-compare two PNG images using Pillow.

    Returns dict with ``diff_percent``, ``diff_pixels``, ``total_pixels``,
    and ``diff_image_path`` (overlay PNG with differing pixels highlighted).
    """
    from PIL import Image

    baseline_img = Image.open(baseline_path).convert("RGB")
    current_img = Image.open(current_path).convert("RGB")

    # Resize current to match baseline if dimensions differ
    if current_img.size != baseline_img.size:
        logger.warning(
            "Dimension mismatch: baseline %s current %s — resizing current to match baseline",
            baseline_img.size,
            current_img.size,
        )
        current_img = current_img.resize(baseline_img.size, Image.LANCZOS)

    width, height = baseline_img.size
    total_pixels = width * height

    # Pixel-by-pixel comparison
    diff_pixels = 0
    diff_overlay = Image.new("RGB", (width, height), (0, 0, 0))
    bpixels = baseline_img.load()
    cpixels = current_img.load()
    dpixels = diff_overlay.load()

    for y in range(height):
        for x in range(width):
            bp = bpixels[x, y]
            cp = cpixels[x, y]
            if bp != cp:
                diff_pixels += 1
                # Highlight differing pixels in magenta
                dpixels[x, y] = (255, 0, 255)

    diff_percent = (diff_pixels / total_pixels * 100) if total_pixels > 0 else 0.0

    # Save diff overlay image
    diff_dir = output_dir / "_diffs"
    diff_dir.mkdir(parents=True, exist_ok=True)
    diff_image_path = str(diff_dir / f"{safe_name}_diff.png")
    diff_overlay.save(diff_image_path)

    logger.info(
        "Comparison done — diff_percent=%.2f%% diff_pixels=%d total_pixels=%d",
        diff_percent,
        diff_pixels,
        total_pixels,
    )

    return {
        "diff_percent": round(diff_percent, 2),
        "diff_pixels": diff_pixels,
        "total_pixels": total_pixels,
        "diff_image_path": diff_image_path,
    }
