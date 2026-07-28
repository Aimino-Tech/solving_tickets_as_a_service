from playwright.sync_api import Page


class AnalyticsPage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url

    def goto(self):
        self.page.goto(f"{self.base_url}/analytics")
        self.page.wait_for_load_state("networkidle")

    @property
    def page_heading(self):
        return self.page.get_by_role("heading", name="Analytics").first

    @property
    def total_runs_card(self):
        return self.page.locator("text=Total Runs").first

    @property
    def success_rate_card(self):
        return self.page.locator("text=Success Rate").first

    @property
    def avg_duration_card(self):
        return self.page.locator("text=Avg Duration").first

    @property
    def chart_container(self):
        return self.page.locator("canvas, .recharts-wrapper, [data-testid='chart']").first

    @property
    def export_button(self):
        return self.page.get_by_role("button", name="Export").first
