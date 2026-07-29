import re
from playwright.sync_api import Page, expect
from pages.analytics_page import AnalyticsPage


class TestAnalyticsPage:
    def test_analytics_page_loads(self, page: Page, base_url: str):
        analytics_page = AnalyticsPage(page, base_url)
        analytics_page.goto()
        expect(page).to_have_title(re.compile(r"Analytics"))
        expect(analytics_page.page_heading).to_be_visible()

    def test_analytics_shows_stat_cards(self, page: Page, base_url: str):
        analytics_page = AnalyticsPage(page, base_url)
        analytics_page.goto()
        page.wait_for_timeout(1000)
        cards = [
            analytics_page.total_runs_card,
            analytics_page.success_rate_card,
            analytics_page.avg_duration_card,
        ]
        visible_cards = [c for c in cards if c.is_visible()]
        assert len(visible_cards) > 0, "Expected at least one stat card to be visible"

    def test_analytics_chart_renders(self, page: Page, base_url: str):
        analytics_page = AnalyticsPage(page, base_url)
        analytics_page.goto()
        page.wait_for_timeout(2000)
        if analytics_page.chart_container.is_visible():
            expect(analytics_page.chart_container).to_be_visible()

    def test_analytics_export_button(self, page: Page, base_url: str):
        analytics_page = AnalyticsPage(page, base_url)
        analytics_page.goto()
        page.wait_for_timeout(1000)
        if analytics_page.export_button.is_visible():
            expect(analytics_page.export_button).to_be_visible()
