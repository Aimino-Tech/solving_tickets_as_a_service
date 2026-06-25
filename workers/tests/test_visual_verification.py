"""Tests for the visual verification gate (workers/tasks/visual_verification.py)."""

import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ── Helpers ──────────────────────────────────────────────────────────────────


def _make_png_bytes(rgba: tuple[int, int, int, int] = (0, 0, 0, 255), width: int = 4, height: int = 4) -> bytes:
    """Generate a minimal valid PNG of a single colour."""
    import struct
    import zlib

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + c + crc

    # PNG signature
    sig = b"\x89PNG\r\n\x1a\n"
    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    ihdr = _chunk(b"IHDR", ihdr_data)
    # IDAT (raw pixel data)
    raw = b""
    for y in range(height):
        raw += b"\x00"  # filter byte
        for x in range(width):
            raw += bytes(rgba[:3])
    idat = _chunk(b"IDAT", zlib.compress(raw))
    # IEND
    iend = _chunk(b"IEND", b"")

    return sig + ihdr + idat + iend


# ── Tests: _detect_frontend_changes ──────────────────────────────────────────


@patch("workers.tasks.visual_verification.subprocess.run")
def test_detect_frontend_changes_returns_routes(mock_run):
    """git diff with frontend files returns mapped routes."""
    from workers.tasks.visual_verification import _detect_frontend_changes

    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = "src/pages/index.tsx\nsrc/pages/login.tsx\nsrc/pages/dashboard.tsx\n"
    mock_run.return_value.stderr = ""

    routes = _detect_frontend_changes("/fake/workspace", "main")
    # index.tsx → /, login.tsx → /login, dashboard.tsx → /dashboard
    assert "/" in routes
    assert "/login" in routes
    assert "/dashboard" in routes
    assert len(routes) == 3


@patch("workers.tasks.visual_verification.subprocess.run")
def test_detect_frontend_changes_empty_when_no_frontend(mock_run):
    """git diff with only non-frontend files returns empty list."""
    from workers.tasks.visual_verification import _detect_frontend_changes

    mock_run.return_value.returncode = 0
    mock_run.return_value.stdout = "src/lib/utils.ts\nREADME.md\n"
    mock_run.return_value.stderr = ""

    routes = _detect_frontend_changes("/fake/workspace", "main")
    assert routes == []


@patch("workers.tasks.visual_verification.subprocess.run")
def test_detect_frontend_changes_handles_git_failure(mock_run):
    """git diff non-zero exit returns empty list."""
    from workers.tasks.visual_verification import _detect_frontend_changes

    mock_run.return_value.returncode = 128
    mock_run.return_value.stdout = ""
    mock_run.return_value.stderr = "fatal: bad revision"

    routes = _detect_frontend_changes("/fake/workspace", "main")
    assert routes == []


# ── Tests: _filter_frontend_files ────────────────────────────────────────────


def test_filter_frontend_files_keeps_tsx_jsx_css_html_vue():
    """Only frontend file extensions are retained."""
    from workers.tasks.visual_verification import _filter_frontend_files

    files = [
        "src/pages/index.tsx",
        "src/pages/login.jsx",
        "src/styles/global.css",
        "public/index.html",
        "src/pages/about.vue",
        "src/lib/utils.ts",
        "README.md",
        "package.json",
    ]
    filtered = _filter_frontend_files(files)
    assert len(filtered) == 5
    assert all(
        f.endswith((".tsx", ".jsx", ".css", ".html", ".vue"))
        for f in filtered
    )


# ── Tests: _file_to_route ────────────────────────────────────────────────────


def test_file_to_route_pages():
    from workers.tasks.visual_verification import _file_to_route

    assert _file_to_route("src/pages/index.tsx") == "/"
    assert _file_to_route("src/pages/login.tsx") == "/login"
    assert _file_to_route("src/pages/settings.tsx") == "/settings"
    assert _file_to_route("src/pages/dashboard.tsx") == "/dashboard"
    assert _file_to_route("src/pages/dashboard/index.tsx") == "/dashboard"
    assert _file_to_route("src/pages/blog/[slug].tsx") == "/blog/:slug"


def test_file_to_route_app_router():
    from workers.tasks.visual_verification import _file_to_route

    assert _file_to_route("app/page.tsx") == "/"
    assert _file_to_route("app/login/page.tsx") == "/login"
    assert _file_to_route("app/(auth)/login/page.tsx") == "/login"
    assert _file_to_route("app/dashboard/settings/page.tsx") == "/dashboard/settings"


def test_file_to_route_non_page_returns_none():
    from workers.tasks.visual_verification import _file_to_route

    assert _file_to_route("src/components/Header.tsx") is None
    assert _file_to_route("src/lib/utils.ts") is None
    assert _file_to_route("README.md") is None


# ── Tests: _compare_screenshots ──────────────────────────────────────────────


def test_compare_screenshots_identical(tmp_path):
    """Identical images produce 0 % diff."""
    from workers.tasks.visual_verification import _compare_screenshots

    png = _make_png_bytes()
    baseline = tmp_path / "base.png"
    current = tmp_path / "curr.png"
    baseline.write_bytes(png)
    current.write_bytes(png)

    result = _compare_screenshots(str(baseline), str(current), "identical", tmp_path)
    assert result["diff_percent"] == 0.0
    assert result["diff_pixels"] == 0
    assert result["total_pixels"] == 4 * 4  # 16
    assert result["diff_image_path"] is not None
    assert Path(result["diff_image_path"]).exists()


def test_compare_screenshots_different(tmp_path):
    """Different images produce diff_percent > 0."""
    from workers.tasks.visual_verification import _compare_screenshots

    png_black = _make_png_bytes((0, 0, 0, 255))
    png_white = _make_png_bytes((255, 255, 255, 255))
    baseline = tmp_path / "base.png"
    current = tmp_path / "curr.png"
    baseline.write_bytes(png_black)
    current.write_bytes(png_white)

    result = _compare_screenshots(str(baseline), str(current), "different", tmp_path)
    assert result["diff_percent"] == 100.0
    assert result["diff_pixels"] == 4 * 4


# ── Tests: _take_screenshot (mocked Playwright) ──────────────────────────────


@patch("playwright.sync_api.sync_playwright")
def test_take_screenshot_returns_bytes(mock_sync_pw):
    """Screenshot returns raw PNG bytes."""
    from workers.tasks.visual_verification import _take_screenshot

    mock_browser = MagicMock()
    mock_context = MagicMock()
    mock_page = MagicMock()
    mock_page.goto.return_value = MagicMock(status=200)
    mock_page.screenshot.return_value = b"fake-png-bytes"

    mock_sync_pw.return_value.__enter__.return_value.chromium.launch.return_value = mock_browser
    mock_browser.new_context.return_value = mock_context
    mock_context.new_page.return_value = mock_page

    result = _take_screenshot("/fake/workspace", "/test-route")
    assert result == b"fake-png-bytes"
    mock_page.goto.assert_called_once()
    mock_page.screenshot.assert_called_once_with(full_page=True)


# ── Tests: _process_route (capture vs compare) ───────────────────────────────


@patch("workers.tasks.visual_verification._take_screenshot")
def test_process_route_captures_new_baseline(mock_screenshot, tmp_path):
    """When no baseline exists, the screenshot is captured as baseline."""
    from workers.tasks.visual_verification import _process_route

    mock_screenshot.return_value = _make_png_bytes()

    result = _process_route(str(tmp_path), "/new-route")
    assert result["status"] == "captured"
    assert result["route"] == "/new-route"
    assert result["diff_percent"] == 0.0

    # Baseline file should exist
    baseline_file = tmp_path / ".visbaseline" / "new-route.png"
    assert baseline_file.exists()


@patch("workers.tasks.visual_verification._take_screenshot")
def test_process_route_compares_against_existing_baseline(mock_screenshot, tmp_path):
    """When baseline exists, screenshot is compared and passed."""
    from workers.tasks.visual_verification import _process_route

    # Create baseline first
    baseline_dir = tmp_path / ".visbaseline"
    baseline_dir.mkdir(parents=True)
    baseline_file = baseline_dir / "existing-route.png"
    baseline_file.write_bytes(_make_png_bytes())

    # Current screenshot matches baseline
    mock_screenshot.return_value = _make_png_bytes()

    result = _process_route(str(tmp_path), "/existing-route")
    assert result["status"] == "passed"
    assert result["diff_percent"] == 0.0


@patch("workers.tasks.visual_verification._take_screenshot")
def test_process_route_blocks_on_diff_exceeds_threshold(mock_screenshot, tmp_path):
    """Pixel diff > 2% results in 'failed' status."""
    from workers.tasks.visual_verification import _process_route

    # Create baseline (all black)
    baseline_dir = tmp_path / ".visbaseline"
    baseline_dir.mkdir(parents=True)
    baseline_file = baseline_dir / "failing-route.png"
    baseline_file.write_bytes(_make_png_bytes((0, 0, 0, 255)))

    # Current screenshot (all white = 100 % diff on a 4×4 image)
    mock_screenshot.return_value = _make_png_bytes((255, 255, 255, 255))

    result = _process_route(str(tmp_path), "/failing-route")
    assert result["status"] == "failed"
    assert result["diff_percent"] == 100.0


# ── Tests: Celery task (high-level) ──────────────────────────────────────────


@patch("workers.tasks.visual_verification._process_route")
@patch("workers.tasks.visual_verification._start_dev_server")
def test_visual_verify_skips_when_no_frontend_changes(mock_start, mock_process):
    """Task returns no_frontend_changes when affected_routes is empty."""
    from workers.tasks.visual_verification import visual_verify

    result = visual_verify.run("/fake/ws", [], "main")
    assert result["all_pages_match"] is True
    assert result["pages"] == []
    assert "skipping" in result["summary"]
    mock_start.assert_not_called()
    mock_process.assert_not_called()


@patch("workers.tasks.visual_verification._process_route")
@patch("workers.tasks.visual_verification._start_dev_server")
@patch("workers.tasks.visual_verification._wait_for_server")
def test_visual_verify_routes_in_order(mock_wait, mock_start, mock_process):
    """Task processes each route and returns results."""
    from workers.tasks.visual_verification import visual_verify

    mock_proc = MagicMock()
    mock_start.return_value = (mock_proc, "http://localhost:3000/health")

    # Simulate per-route results
    mock_process.side_effect = [
        {"status": "passed", "route": "/", "diff_percent": 0.0},
        {"status": "passed", "route": "/login", "diff_percent": 0.5},
        {"status": "captured", "route": "/about", "diff_percent": 0.0},
    ]

    result = visual_verify.run("/fake/ws", ["/", "/login", "/about"], "main")
    assert result["all_pages_match"] is True
    assert len(result["pages"]) == 3
    assert "All" in result["summary"]
    # pages should contain route entries with status/diff_pct/screenshot_path
    for page in result["pages"]:
        assert "route" in page
        assert "status" in page
        assert "diff_pct" in page
        assert "screenshot_path" in page


@patch("workers.tasks.visual_verification._process_route")
@patch("workers.tasks.visual_verification._start_dev_server")
@patch("workers.tasks.visual_verification._wait_for_server")
def test_visual_verify_blocks_on_failure(mock_wait, mock_start, mock_process):
    """Task returns status='blocked' when any route fails pixel diff."""
    from workers.tasks.visual_verification import visual_verify

    mock_proc = MagicMock()
    mock_start.return_value = (mock_proc, "http://localhost:3000/health")

    mock_process.side_effect = [
        {"status": "passed", "route": "/", "diff_percent": 0.0},
        {"status": "failed", "route": "/broken", "diff_percent": 12.5},
    ]

    result = visual_verify.run("/fake/ws", ["/", "/broken"], "main")
    assert result["all_pages_match"] is False
    assert "diffs" in result["summary"] or "fail" in result["summary"]
    # Check that pages reflect failure
    pages = result["pages"]
    failed_pages = [p for p in pages if p["status"] == "failed"]
    assert len(failed_pages) == 1


@patch("workers.tasks.visual_verification._process_route")
@patch("workers.tasks.visual_verification._start_dev_server")
@patch("workers.tasks.visual_verification._wait_for_server")
def test_visual_verify_cleanup_on_success(mock_wait, mock_start, mock_process):
    """Dev server is stopped even when all tests pass."""
    from workers.tasks.visual_verification import visual_verify

    mock_proc = MagicMock()
    mock_start.return_value = (mock_proc, "http://localhost:3000/health")
    mock_process.return_value = {"status": "passed", "route": "/", "diff_percent": 0.0}

    visual_verify.run("/fake/ws", ["/"], "main")
    # terminate should be called as part of cleanup
    assert mock_proc.terminate.called or mock_proc.kill.called or mock_proc.wait.called


# ── Tests: dev server management ─────────────────────────────────────────────


@patch("workers.tasks.visual_verification.subprocess.Popen")
def test_start_dev_server_detects_command(mock_popen):
    """Dev server uses detected command from package.json."""
    from workers.tasks.visual_verification import _detect_dev_command, _start_dev_server

    # This project has "dev": "tsx watch src/index.ts" in package.json
    ws = "/tmp/opencode/worktrees/AIM-1976"
    cmd = _detect_dev_command(ws)
    assert "tsx watch" in cmd or "tsx" in cmd

    mock_proc = MagicMock()
    mock_proc.pid = 12345
    mock_popen.return_value = mock_proc

    proc, health_url = _start_dev_server(ws)
    assert health_url.startswith("http://localhost:")
    mock_popen.assert_called_once()


@patch("workers.tasks.visual_verification.subprocess.Popen")
def test_stop_dev_server_terminates(mock_popen):
    """_stop_dev_server calls terminate on the process."""
    from workers.tasks.visual_verification import _stop_dev_server

    mock_proc = MagicMock()
    _stop_dev_server(mock_proc)
    mock_proc.terminate.assert_called_once()


def test_stop_dev_server_none():
    """_stop_dev_server handles None gracefully."""
    from workers.tasks.visual_verification import _stop_dev_server

    _stop_dev_server(None)  # should not raise


# ── Tests: _detect_dev_command ───────────────────────────────────────────────


def test_detect_dev_command_found():
    """Returns the dev command from package.json when present."""
    from workers.tasks.visual_verification import _detect_dev_command

    cmd = _detect_dev_command("/tmp/opencode/worktrees/AIM-1976")
    assert "dev" in cmd or "tsx" in cmd


def test_detect_dev_command_fallback(tmp_path):
    """Returns 'npm run dev' when no package.json exists."""
    from workers.tasks.visual_verification import _detect_dev_command

    cmd = _detect_dev_command(str(tmp_path))
    assert cmd == "npm run dev"


# ── Tests: edge cases ────────────────────────────────────────────────────────


def test_sanitise_route_creates_safe_filename(tmp_path):
    """Route sanitisation handles root, nested, and special chars."""
    from workers.tasks.visual_verification import _process_route

    with patch("workers.tasks.visual_verification._take_screenshot") as mock_shot:
        mock_shot.return_value = _make_png_bytes()

        result = _process_route(str(tmp_path), "/")
        assert result["status"] == "captured"
        assert (tmp_path / ".visbaseline" / "index.png").exists()

        result = _process_route(str(tmp_path), "/deep/nested/route")
        assert result["status"] == "captured"
        assert (tmp_path / ".visbaseline" / "deep_nested_route.png").exists()


@patch("workers.tasks.visual_verification._take_screenshot")
def test_process_route_handles_error_gracefully(mock_screenshot):
    """When screenshot fails, the route result contains the error."""
    from workers.tasks.visual_verification import _process_route

    mock_screenshot.side_effect = RuntimeError("Connection refused")

    result = _process_route("/tmp/nonexistent", "/fail")
    assert result["status"] == "error"
    assert "error" in result
