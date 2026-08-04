import re
import uuid
import pytest
from playwright.sync_api import Page, expect
from pages.login_page import LoginPage

BACKEND_URL = "http://localhost:3002"


def _dashboard_url_regex(base_url: str) -> re.Pattern:
    return re.compile(rf"{re.escape(base_url)}/$")


class TestUserStory2Register:
    def test_register_fresh_user_lands_on_dashboard(self, page: Page, base_url: str):
        email = f"us2-{uuid.uuid4().hex[:10]}@aimino-test.de"
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.register("US2 User", email, "Us2User123!")
        expect(page).to_have_url(_dashboard_url_regex(base_url), timeout=10000)
        expect(page.get_by_text("Recent Fix Runs")).to_be_visible(timeout=10000)


class TestUserStory3SignIn:
    def test_sign_in_valid_credentials_lands_on_dashboard(
        self, page: Page, base_url: str, e2e_user
    ):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.sign_in(e2e_user["email"], e2e_user["password"])
        expect(page).to_have_url(_dashboard_url_regex(base_url), timeout=10000)
        expect(page.get_by_text("Recent Fix Runs")).to_be_visible(timeout=10000)

    def test_sign_in_wrong_password_shows_error(
        self, page: Page, base_url: str, e2e_user
    ):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.sign_in(e2e_user["email"], "WrongPassword123!")
        expect(login_page.error_message).to_be_visible(timeout=10000)


class TestUserStory11RunsDashboard:
    def test_runs_page_loads_with_status_filter(self, authed_page: Page, base_url: str):
        authed_page.goto(f"{base_url}/runs")
        authed_page.wait_for_load_state("networkidle")
        expect(authed_page.get_by_role("combobox").first).to_be_visible(timeout=10000)
        expect(authed_page.locator("label", has_text="Status:")).to_be_visible()
        expect(authed_page.get_by_role("heading", name="Runs")).to_be_visible()


class TestUserStory10LabelToPR:
    def test_webhook_rejects_missing_signature(self, playwright_instance):
        request = playwright_instance.request.new_context(base_url=BACKEND_URL)
        try:
            resp = request.post("/webhook", data={})
            assert resp.status == 401, f"expected 401, got {resp.status}"
        finally:
            request.dispose()

    def test_webhook_rejects_bad_signature(self, playwright_instance):
        request = playwright_instance.request.new_context(base_url=BACKEND_URL)
        try:
            resp = request.post(
                "/webhook",
                headers={"x-hub-signature-256": "sha256=deadbeef"},
                data={},
            )
            assert resp.status == 401, f"expected 401, got {resp.status}"
        finally:
            request.dispose()
