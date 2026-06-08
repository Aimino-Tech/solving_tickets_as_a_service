from __future__ import annotations
import time
import random
from playwright.sync_api import sync_playwright, Page
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))
from app.common.config import settings
from app.common.models import EngagementRecord
from app.common.db import get_repository
from app.common.rate_limiter import linkedin_limiter, RateLimitExceeded
from app.platforms.linkedin.session import load_storage_state, save_storage_state


class LinkedInBrowserClient:
    def __init__(self, headless: bool = False):
        self.headless = headless
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None

    def __enter__(self):
        self._playwright = sync_playwright().start()
        state = load_storage_state()
        self._browser = self._playwright.chromium.launch(headless=self.headless)
        if state:
            self._context = self._browser.new_context(
                storage_state=state,
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
            )
        else:
            self._context = self._browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                ),
            )
        self._page = self._context.new_page()
        return self

    def __exit__(self, *args):
        if self._context:
            save_storage_state(self._context)
        if self._browser:
            self._browser.close()
        if self._playwright:
            self._playwright.stop()

    @property
    def page(self) -> Page:
        assert self._page is not None
        return self._page

    def _human_delay(self, min_s: float = 0.5, max_s: float = 2.0) -> None:
        time.sleep(random.uniform(min_s, max_s))

    def _ensure_logged_in(self) -> None:
        self.page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded")
        self._human_delay()
        if "login" in self.page.url.lower():
            self.page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded")
            self._human_delay()
            self.page.fill("#username", settings.linkedin_client_id)
            self.page.fill("#password", settings.linkedin_client_secret)
            self.page.click("button[type=submit]")
            self.page.wait_for_url("**/feed/**", timeout=30000)
            self._human_delay()
            save_storage_state(self._context)

    def send_dm(self, target_profile_url: str, message: str) -> EngagementRecord:
        limiter = linkedin_limiter()
        limiter.check()

        record = EngagementRecord(
            platform="linkedin",
            engagement_type="dm",
            content=message,
            target=target_profile_url,
            status="pending_approval",
        )
        repo = get_repository()
        repo.log_engagement(record)

        if not settings.auto_approve:
            return record

        self._ensure_logged_in()
        self.page.goto("https://www.linkedin.com/messaging/thread/new/", wait_until="domcontentloaded")
        self._human_delay(1, 3)

        name_hint = target_profile_url.rstrip("/").split("/")[-1].replace("-", " ")
        name_input = self.page.locator("input[placeholder*='Type a name']")
        name_input.fill(name_hint)
        self._human_delay(1, 2)

        try:
            first_result = self.page.locator(".msg-connections-typeahead__results li").first
            first_result.wait_for(timeout=5000)
            first_result.click()
            self._human_delay()
        except Exception:
            repo.update_status(record.id, "failed", error="Could not find target user in DM search")
            record.mark_failed("Could not find target user in DM search")
            return record

        msg_area = self.page.locator("div[role='textbox'][contenteditable='true']").last
        msg_area.click()
        self._human_delay()
        msg_area.fill(message)
        self._human_delay()

        send_btn = self.page.locator("button[type='submit']").last
        send_btn.click()
        self._human_delay(1, 2)

        repo.update_status(record.id, "sent")
        record.mark_sent()
        return record

    def send_connection_request(self, profile_url: str, note: str = "") -> EngagementRecord:
        limiter = linkedin_limiter()
        limiter.check()

        record = EngagementRecord(
            platform="linkedin",
            engagement_type="connection_request",
            content=note,
            target=profile_url,
            status="pending_approval",
        )
        repo = get_repository()
        repo.log_engagement(record)

        if not settings.auto_approve:
            return record

        self._ensure_logged_in()
        self.page.goto(profile_url, wait_until="domcontentloaded")
        self._human_delay(2, 4)

        try:
            connect_btn = self.page.locator("button:has-text('Connect')")
            if connect_btn.is_visible():
                connect_btn.click()
                self._human_delay()
                if note:
                    add_note_btn = self.page.locator("button:has-text('Add a note')")
                    if add_note_btn.is_visible():
                        add_note_btn.click()
                        self._human_delay()
                        note_textarea = self.page.locator("textarea#custom-message")
                        note_textarea.fill(note)
                        self._human_delay()
                send_btn = self.page.locator("button:has-text('Send')")
                send_btn.click()
                self._human_delay()
                repo.update_status(record.id, "sent")
                record.mark_sent()
            else:
                repo.update_status(record.id, "failed", error="Connect button not found")
                record.mark_failed("Connect button not found")
        except Exception as e:
            repo.update_status(record.id, "failed", error=str(e))
            record.mark_failed(str(e))

        return record
