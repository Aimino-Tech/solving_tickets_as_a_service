import pytest
import re
from playwright.sync_api import Page, expect
from pages.dashboard_page import DashboardPage
from pages.analytics_page import AnalyticsPage
from pages.settings_page import SettingsPage

ANALYTICS_NOT_IMPLEMENTED = "Analytics page/route not implemented in dashboard app"


class TestDashboardNavigation:
    @pytest.fixture(autouse=True)
    def setup(self, authed_page: Page, base_url: str):
        self.page = authed_page
        self.base_url = base_url

    def test_dashboard_nav_links_visible(self, authed_page: Page, base_url: str):
        dash = DashboardPage(authed_page, base_url)
        dash.goto()
        expect(dash.nav_dashboard).to_be_visible()
        expect(dash.nav_runs).to_be_visible()

    @pytest.mark.xfail(reason=ANALYTICS_NOT_IMPLEMENTED, strict=False)
    def test_analytics_nav_visible(self, authed_page: Page, base_url: str):
        dash = DashboardPage(authed_page, base_url)
        dash.goto()
        expect(dash.nav_analytics).to_be_visible()

    def test_settings_nav_visible(self, authed_page: Page, base_url: str):
        dash = DashboardPage(authed_page, base_url)
        dash.goto()
        expect(dash.nav_settings).to_be_visible()

    @pytest.mark.xfail(reason=ANALYTICS_NOT_IMPLEMENTED, strict=False)
    def test_analytics_page_loads(self, authed_page: Page, base_url: str):
        analytics = AnalyticsPage(authed_page, base_url)
        analytics.goto()
        expect(authed_page).to_have_title(re.compile(r"SYNTARO Dashboard"))

    def test_settings_page_loads(self, authed_page: Page, base_url: str):
        settings = SettingsPage(authed_page, base_url)
        settings.goto()
        expect(authed_page).to_have_title(re.compile(r"SYNTARO Dashboard"))


class TestAnalyticsPage:
    @pytest.mark.xfail(reason=ANALYTICS_NOT_IMPLEMENTED, strict=False)
    def test_analytics_heading_visible(self, authed_page: Page, base_url: str):
        analytics = AnalyticsPage(authed_page, base_url)
        analytics.goto()
        expect(analytics.page_heading).to_be_visible()


class TestSettingsPage:
    def test_settings_heading_visible(self, authed_page: Page, base_url: str):
        settings = SettingsPage(authed_page, base_url)
        settings.goto()
        expect(settings.page_heading).to_be_visible()
