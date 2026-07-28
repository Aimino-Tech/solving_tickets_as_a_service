import pytest
from playwright.sync_api import Page, expect
from pages.dashboard_page import DashboardPage
from pages.analytics_page import AnalyticsPage
from pages.settings_page import SettingsPage


class TestDashboardNavigation:
    @pytest.fixture(autouse=True)
    def setup(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url

    def test_dashboard_nav_links_visible(self, page: Page, base_url: str):
        dash = DashboardPage(page, base_url)
        dash.goto()
        expect(dash.nav_dashboard).to_be_visible()
        expect(dash.nav_runs).to_be_visible()

    def test_analytics_nav_visible(self, page: Page, base_url: str):
        dash = DashboardPage(page, base_url)
        dash.goto()
        expect(dash.nav_analytics).to_be_visible()

    def test_settings_nav_visible(self, page: Page, base_url: str):
        dash = DashboardPage(page, base_url)
        dash.goto()
        expect(dash.nav_settings).to_be_visible()

    def test_analytics_page_loads(self, page: Page, base_url: str):
        analytics = AnalyticsPage(page, base_url)
        analytics.goto()
        expect(page).to_have_title("Analytics")

    def test_settings_page_loads(self, page: Page, base_url: str):
        settings = SettingsPage(page, base_url)
        settings.goto()
        expect(page).to_have_title("Settings")


class TestAnalyticsPage:
    def test_analytics_heading_visible(self, page: Page, base_url: str):
        analytics = AnalyticsPage(page, base_url)
        analytics.goto()
        expect(analytics.page_heading).to_be_visible()


class TestSettingsPage:
    def test_settings_heading_visible(self, page: Page, base_url: str):
        settings = SettingsPage(page, base_url)
        settings.goto()
        expect(settings.page_heading).to_be_visible()
