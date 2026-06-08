from __future__ import annotations
import json
from pathlib import Path
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from playwright.sync_api import sync_playwright, BrowserContext

SESSION_DIR = Path(__file__).resolve().parent / "browser-state"
SESSION_FILE = SESSION_DIR / "linkedin_state.json"


def ensure_session_dir() -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)


def save_storage_state(context: BrowserContext) -> Path:
    ensure_session_dir()
    state = context.storage_state(path=str(SESSION_FILE))
    return SESSION_FILE


def load_storage_state() -> dict | None:
    if SESSION_FILE.exists():
        try:
            with open(SESSION_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None
    return None


def has_valid_session() -> bool:
    state = load_storage_state()
    if not state:
        return False
    origins = state.get("origins", [])
    for origin in origins:
        if "linkedin.com" in origin.get("origin", ""):
            cookies = origin.get("localStorage", [])
            if any("session" in str(k).lower() or "token" in str(k).lower()
                   for k, _ in [(c.get("name", ""), c.get("value", ""))
                                for c in origin.get("cookies", [])]):
                return True
    return False


def create_session(email: str, password: str) -> Path | None:
    ensure_session_dir()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
        )
        page = context.new_page()
        page.goto("https://www.linkedin.com/login", wait_until="networkidle")
        page.fill("#username", email)
        page.fill("#password", password)
        page.click("button[type=submit]")
        page.wait_for_url("**/feed/**", timeout=60000)
        save_storage_state(context)
        browser.close()
        return SESSION_FILE
