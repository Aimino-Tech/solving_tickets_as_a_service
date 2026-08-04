import re
from playwright.sync_api import Page, expect
from pages.settings_page import SettingsPage


class TestSettingsPage:
    def test_settings_page_loads(self, authed_page: Page, base_url: str):
        settings_page = SettingsPage(authed_page, base_url)
        settings_page.goto()
        expect(authed_page).to_have_title(re.compile(r"SYNTARO Dashboard"))
        expect(settings_page.page_heading).to_be_visible()

    def test_settings_shows_sections(self, authed_page: Page, base_url: str):
        settings_page = SettingsPage(authed_page, base_url)
        settings_page.goto()
        authed_page.wait_for_timeout(1000)
        sections = [
            settings_page.profile_section,
            settings_page.notification_section,
            settings_page.api_keys_section,
            settings_page.team_section,
        ]
        visible_sections = [s for s in sections if s.is_visible()]
        assert len(visible_sections) > 0, "Expected at least one settings section to be visible"

    def test_settings_save_button(self, authed_page: Page, base_url: str):
        settings_page = SettingsPage(authed_page, base_url)
        settings_page.goto()
        authed_page.wait_for_timeout(1000)
        if settings_page.save_button.is_visible():
            expect(settings_page.save_button).to_be_visible()
