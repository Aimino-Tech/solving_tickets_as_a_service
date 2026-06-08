from __future__ import annotations
import json
import os
import random
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright, Page, BrowserContext

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.db import get_repository
from app.common.models import EngagementRecord

SESSION_DIR = Path(__file__).parent / "csdn" / "browser-state"
SESSION_FILE = SESSION_DIR / "csdn_state.json"
CSDN_COOKIE = os.getenv("CSDN_COOKIE", "")
CSDN_USERNAME = os.getenv("CSDN_USERNAME", "")
CSDN_PASSWORD = os.getenv("CSDN_PASSWORD", "")


def _ensure_session_dir() -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)


def _save_storage_state(context: BrowserContext) -> Path:
    _ensure_session_dir()
    context.storage_state(path=str(SESSION_FILE))
    return SESSION_FILE


def _load_storage_state() -> dict | None:
    if SESSION_FILE.exists():
        try:
            with open(SESSION_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None
    return None


def _has_valid_session() -> bool:
    state = _load_storage_state()
    if not state:
        return False
    for origin in state.get("origins", []):
        if "csdn.net" in origin.get("origin", ""):
            cookies = origin.get("cookies", [])
            names = [c.get("name", "") for c in cookies]
            if "UserName" in names or "BT" in names or "session" in str(names).lower():
                return True
    return False


class CSDNPublisher:
    def __init__(self, headless: bool = True):
        self.headless = headless
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None

    def __enter__(self) -> CSDNPublisher:
        self._playwright = sync_playwright().start()
        state = _load_storage_state()
        self._browser = self._playwright.chromium.launch(headless=self.headless)
        ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        if state:
            self._context = self._browser.new_context(storage_state=state, user_agent=ua)
        else:
            self._context = self._browser.new_context(user_agent=ua)
        self._page = self._context.new_page()
        return self

    def __exit__(self, *args):
        if self._context:
            _save_storage_state(self._context)
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()

    @property
    def page(self) -> Page:
        assert self._page is not None
        return self._page

    @staticmethod
    def _human_delay(min_s: float = 0.5, max_s: float = 2.0) -> None:
        time.sleep(random.uniform(min_s, max_s))

    def _ensure_logged_in(self) -> None:
        if _has_valid_session():
            self.page.goto("https://mp.csdn.net", wait_until="domcontentloaded")
            self._human_delay()
            if "login" not in self.page.url.lower():
                return
        if CSDN_COOKIE:
            self.page.goto("https://mp.csdn.net", wait_until="domcontentloaded")
            self._human_delay()
            self.page.evaluate(f"document.cookie = '{CSDN_COOKIE}'")
            self.page.reload(wait_until="domcontentloaded")
            self._human_delay()
            if "login" not in self.page.url.lower():
                _save_storage_state(self._context)
                return
        if CSDN_USERNAME and CSDN_PASSWORD:
            self.page.goto("https://passport.csdn.net/login", wait_until="domcontentloaded")
            self._human_delay()
            self.page.fill("input[placeholder*='手机号']", CSDN_USERNAME)
            self._human_delay()
            self.page.fill("input[placeholder*='密码']", CSDN_PASSWORD)
            self._human_delay()
            self.page.click("button[type='submit']")
            try:
                self.page.wait_for_url("**/mp.csdn.net/**", timeout=30000)
                _save_storage_state(self._context)
            except Exception as e:
                print(f"CSDN login failed: {e}", file=sys.stderr)
                return
        else:
            print("CSDN: no credentials configured, using saved session if available", file=sys.stderr)

    def publish_article(self, title: str, content: str, tags: list[str] | None = None, dry_run: bool = False) -> EngagementRecord:
        record = EngagementRecord(
            platform="csdn",
            engagement_type="publish_article",
            content=content,
            target=title,
            status="dry_run" if dry_run else "pending_approval",
            metadata={"tags": tags or [], "title": title},
        )
        repo = get_repository()
        repo.log_engagement(record)
        if dry_run:
            print(f"[DRY RUN] CSDN: would publish '{title}' with tags {tags}", file=sys.stderr)
            return record
        self._ensure_logged_in()
        if "login" in self.page.url.lower():
            repo.update_status(record.id, "failed", error="Not logged in to CSDN")
            record.mark_failed("Not logged in to CSDN")
            return record
        try:
            self.page.goto("https://mp.csdn.net/mp_blog/creation/editor", wait_until="domcontentloaded")
            self._human_delay(1, 3)
            title_input = self.page.locator("input#articleTitle, input[placeholder*='标题'], input.title-input")
            title_input.fill(title)
            self._human_delay()
            content_area = self.page.locator("div#articleContent, div.editor-content, div.CodeMirror-code, div.markdown_views")
            if content_area.is_visible():
                content_area.click()
                self._human_delay()
                self.page.keyboard.insert_text(content)
            else:
                textarea = self.page.locator("textarea#articleContent, textarea.edit-area")
                textarea.fill(content)
            self._human_delay()
            if tags:
                tag_input = self.page.locator("input#tag", "input[placeholder*='标签'], input.tag-input")
                for tag in tags[:5]:
                    tag_input.fill(tag)
                    self._human_delay(0.3, 0.8)
                    self.page.keyboard.press("Enter")
                    self._human_delay(0.2, 0.5)
            self._human_delay()
            publish_btn = self.page.locator("button:has-text('发布'), button:has-text('发表'), button.btn-publish")
            publish_btn.first.click()
            self._human_delay(2, 4)
            repo.update_status(record.id, "sent")
            record.mark_sent()
            print(f"CSDN: published '{title}' successfully", file=sys.stderr)
        except Exception as e:
            repo.update_status(record.id, "failed", error=str(e))
            record.mark_failed(str(e))
            print(f"CSDN publish failed: {e}", file=sys.stderr)
        return record


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="CSDN article publisher via Playwright")
    parser.add_argument("--title", required=True, help="Article title")
    parser.add_argument("--content", required=True, help="Article content (markdown)")
    parser.add_argument("--tags", nargs="*", help="Tags")
    parser.add_argument("--dry-run", action="store_true", help="Preview without publishing")
    parser.add_argument("--visible", action="store_true", help="Run browser in visible mode")
    args = parser.parse_args()
    with CSDNPublisher(headless=not args.visible) as publisher:
        result = publisher.publish_article(args.title, args.content, args.tags, dry_run=args.dry_run)
    print(json.dumps({"id": result.id, "status": result.status, "platform": result.platform}, indent=2))
