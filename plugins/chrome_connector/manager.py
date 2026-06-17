"""Chrome Profile Manager — lifecycle, health checks, CDP connections."""

from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import requests
import websocket


# ---------------------------------------------------------------------------
# Platform configs
# ---------------------------------------------------------------------------

@dataclass
class PlatformConfig:
    """Configuration for a platform's Chrome profile."""
    name: str
    port: int
    profile_dir: str  # relative to /tmp/chrome-all/
    user_data_dir: str  # absolute path
    login_url: str
    requires_sso: bool = False
    sso_provider: str = ""  # e.g. "instagram" for Threads
    rate_limit_seconds: int = 0
    extra_args: list = field(default_factory=list)


# Default platform configurations
PLATFORM_CONFIGS: dict[str, PlatformConfig] = {
    "twitter": PlatformConfig(
        name="twitter",
        port=9226,
        profile_dir="twitter",
        user_data_dir="/tmp/chrome-all/twitter",
        login_url="https://x.com/login",
        rate_limit_seconds=5,
    ),
    "linkedin": PlatformConfig(
        name="linkedin",
        port=9240,
        profile_dir="linkedin",
        user_data_dir="/tmp/chrome-all/linkedin",
        login_url="https://www.linkedin.com/login",
        rate_limit_seconds=10,
    ),
    "reddit": PlatformConfig(
        name="reddit",
        port=9230,
        profile_dir="reddit",
        user_data_dir="/tmp/chrome-all/reddit",
        login_url="https://www.reddit.com/login",
        rate_limit_seconds=5,
    ),
    "threads": PlatformConfig(
        name="threads",
        port=9226,  # shares with Twitter via IG SSO
        profile_dir="threads",
        user_data_dir="/tmp/chrome-all/threads",
        login_url="https://www.threads.net/login",
        requires_sso=True,
        sso_provider="instagram",
        rate_limit_seconds=10,
    ),
    "hackernews": PlatformConfig(
        name="hackernews",
        port=9236,
        profile_dir="hackernews",
        user_data_dir="/tmp/chrome-all/hackernews",
        login_url="https://news.ycombinator.com/login",
        rate_limit_seconds=60,
    ),
    "discord": PlatformConfig(
        name="discord",
        port=9241,
        profile_dir="Discord1",
        user_data_dir="/tmp/chrome-all/Discord1",
        login_url="https://discord.com/login",
        rate_limit_seconds=5,
    ),
}


# ---------------------------------------------------------------------------
# Chrome Profile Manager
# ---------------------------------------------------------------------------

class ChromeProfileManager:
    """Manages Chrome browser profiles for social platform connections."""

    def __init__(self):
        self._processes: dict[str, subprocess.Popen] = {}
        self._connections: dict[str, websocket.WebSocket] = {}
        self._last_activity: dict[str, float] = {}

    def list_platforms(self) -> list[dict]:
        """List all configured platforms and their status."""
        results = []
        for name, config in PLATFORM_CONFIGS.items():
            is_running = self._is_running(name)
            has_cookies = self._has_cookies(name)
            results.append({
                "platform": name,
                "port": config.port,
                "status": "running" if is_running else "stopped",
                "has_cookies": has_cookies,
                "profile_dir": config.user_data_dir,
                "rate_limit": config.rate_limit_seconds,
            })
        return results

    def start(self, platform: str, headless: bool = True) -> dict:
        """Start a Chrome instance for a platform."""
        if platform not in PLATFORM_CONFIGS:
            return {"error": f"Unknown platform: {platform}. Available: {list(PLATFORM_CONFIGS.keys())}"}

        config = PLATFORM_CONFIGS[platform]

        if self._is_running(platform):
            return {"status": "already_running", "platform": platform, "port": config.port}

        # Ensure profile directory exists
        os.makedirs(config.user_data_dir, exist_ok=True)

        # Build Chrome command
        cmd = [
            "/opt/google/chrome/chrome",
            f"--remote-debugging-port={config.port}",
            "--remote-allow-origins=*",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--window-size=1920,1080",
            f"--user-data-dir={config.user_data_dir}",
            "--noerrdialogs",
            "--no-first-run",
            "--disable-background-networking",
            "--disable-default-apps",
            "--disable-extensions",
            "--disable-sync",
            "--no-default-browser-check",
        ]

        if headless:
            cmd.extend([
                "--headless",
                "--ozone-platform=headless",
                "--ozone-override-screen-size=1920,1080",
                "--use-angle=swiftshader-webgl",
            ])

        cmd.extend(config.extra_args)

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            self._processes[platform] = proc

            # Wait for CDP to be ready
            time.sleep(2)
            if self._wait_for_cdp(config.port, timeout=10):
                return {
                    "status": "started",
                    "platform": platform,
                    "port": config.port,
                    "pid": proc.pid,
                }
            else:
                return {
                    "status": "started_but_cdp_not_ready",
                    "platform": platform,
                    "port": config.port,
                    "pid": proc.pid,
                }
        except Exception as e:
            return {"error": f"Failed to start Chrome: {e}"}

    def stop(self, platform: str) -> dict:
        """Stop a Chrome instance for a platform."""
        if platform not in PLATFORM_CONFIGS:
            return {"error": f"Unknown platform: {platform}"}

        # Close CDP connection if open
        if platform in self._connections:
            try:
                self._connections[platform].close()
            except Exception:
                pass
            del self._connections[platform]

        # Kill process
        if platform in self._processes:
            try:
                self._processes[platform].terminate()
                self._processes[platform].wait(timeout=5)
            except Exception:
                try:
                    self._processes[platform].kill()
                except Exception:
                    pass
            del self._processes[platform]

        # Also kill any orphan Chrome on this port
        config = PLATFORM_CONFIGS[platform]
        self._kill_port(config.port)

        return {"status": "stopped", "platform": platform}

    def stop_all(self) -> list[dict]:
        """Stop all Chrome instances."""
        results = []
        for platform in list(PLATFORM_CONFIGS.keys()):
            if self._is_running(platform):
                results.append(self.stop(platform))
        return results

    def get_connection(self, platform: str) -> Optional[websocket.WebSocket]:
        """Get or create a CDP websocket connection for a platform."""
        if platform not in PLATFORM_CONFIGS:
            return None

        config = PLATFORM_CONFIGS[platform]

        # Check if existing connection is still alive
        if platform in self._connections:
            try:
                self._connections[platform].ping()
                return self._connections[platform]
            except Exception:
                del self._connections[platform]

        # Check if CDP is available
        if not self._wait_for_cdp(config.port, timeout=5):
            return None

        # Get websocket URL from CDP - use page-level endpoint
        try:
            # First try to get a page-level WebSocket (for Page/Runtime domains)
            resp = requests.get(f"http://localhost:{config.port}/json", timeout=5)
            pages = resp.json()
            ws_url = None
            for page in pages:
                if page.get("type") == "page":
                    ws_url = page.get("webSocketDebuggerUrl")
                    break
            
            # Fallback to browser-level WebSocket
            if not ws_url:
                resp = requests.get(f"http://localhost:{config.port}/json/version", timeout=5)
                data = resp.json()
                ws_url = data.get("webSocketDebuggerUrl")
            
            if not ws_url:
                return None

            ws = websocket.create_connection(ws_url, timeout=30)
            self._connections[platform] = ws
            return ws
        except Exception:
            return None

    def execute_cdp(self, platform: str, method: str, params: dict = None) -> dict:
        """Execute a CDP command on a platform."""
        ws = self.get_connection(platform)
        if not ws:
            return {"error": f"Cannot connect to {platform} Chrome instance"}

        try:
            msg_id = int(time.time() * 1000) % 100000
            message = {"id": msg_id, "method": method}
            if params:
                message["params"] = params

            ws.send(json.dumps(message))

            # Wait for response with matching id
            deadline = time.time() + 30
            while time.time() < deadline:
                raw = ws.recv()
                data = json.loads(raw)
                if data.get("id") == msg_id:
                    return data
                # Skip events
                if "method" in data:
                    continue

            return {"error": "CDP response timeout"}
        except Exception as e:
            return {"error": f"CDP execution failed: {e}"}

    def navigate(self, platform: str, url: str) -> dict:
        """Navigate a platform's browser to a URL."""
        return self.execute_cdp(platform, "Page.navigate", {"url": url})

    def evaluate(self, platform: str, expression: str) -> dict:
        """Evaluate JavaScript in a platform's browser."""
        result = self.execute_cdp(platform, "Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
        })
        if "result" in result and "result" in result["result"]:
            return result["result"]["result"].get("value", result)
        return result

    def screenshot(self, platform: str) -> dict:
        """Take a screenshot of a platform's browser."""
        result = self.execute_cdp(platform, "Page.captureScreenshot", {"format": "png"})
        if "result" in result and "data" in result["result"]:
            return {"success": True, "data": result["result"]["data"]}
        return result

    def check_health(self, platform: str) -> dict:
        """Check health of a platform's Chrome instance."""
        config = PLATFORM_CONFIGS.get(platform)
        if not config:
            return {"error": f"Unknown platform: {platform}"}

        is_running = self._is_running(platform)
        cdp_ready = self._wait_for_cdp(config.port, timeout=3) if is_running else False
        has_cookies = self._has_cookies(platform)

        return {
            "platform": platform,
            "process_running": is_running,
            "cdp_ready": cdp_ready,
            "has_cookies": has_cookies,
            "port": config.port,
            "last_activity": self._last_activity.get(platform),
        }

    # ---------------------------------------------------------------------------
    # Internal helpers
    # ---------------------------------------------------------------------------

    def _is_running(self, platform: str) -> bool:
        """Check if Chrome is running for a platform."""
        if platform in self._processes:
            proc = self._processes[platform]
            if proc.poll() is None:
                return True
            del self._processes[platform]

        # Check by port
        config = PLATFORM_CONFIGS.get(platform)
        if config:
            return self._is_port_open(config.port)
        return False

    def _is_port_open(self, port: int) -> bool:
        """Check if a port is open."""
        import socket
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                return s.connect_ex(("localhost", port)) == 0
        except Exception:
            return False

    def _wait_for_cdp(self, port: int, timeout: int = 10) -> bool:
        """Wait for CDP endpoint to be ready."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                resp = requests.get(f"http://localhost:{port}/json/version", timeout=2)
                if resp.status_code == 200:
                    return True
            except Exception:
                pass
            time.sleep(0.5)
        return False

    def _has_cookies(self, platform: str) -> bool:
        """Check if a platform has saved cookies."""
        config = PLATFORM_CONFIGS.get(platform)
        if not config:
            return False
        cookie_path = Path(config.user_data_dir) / "Default" / "Cookies"
        return cookie_path.exists()

    def _kill_port(self, port: int):
        """Kill any process listening on a port."""
        try:
            result = subprocess.run(
                ["fuser", "-k", f"{port}/tcp"],
                capture_output=True,
                timeout=5,
            )
        except Exception:
            pass


# Singleton
_manager: Optional[ChromeProfileManager] = None


def get_manager() -> ChromeProfileManager:
    """Get or create the singleton ChromeProfileManager."""
    global _manager
    if _manager is None:
        _manager = ChromeProfileManager()
    return _manager
