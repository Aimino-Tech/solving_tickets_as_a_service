from playwright.sync_api import Page, expect


class DashboardPage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url

    def goto(self):
        self.page.goto(f"{self.base_url}/")
        self.page.wait_for_load_state("networkidle")

    @property
    def nav_analytics(self):
        return self.page.get_by_role("link", name="Analytics")

    @property
    def nav_settings(self):
        return self.page.get_by_role("link", name="Settings")

    @property
    def nav_dashboard(self):
        return self.page.get_by_role("link", name="Dashboard")

    @property
    def nav_runs(self):
        return self.page.get_by_role("link", name="Runs")

    @property
    def user_menu(self):
        return self.page.get_by_role("button", name="User menu")

    @property
    def page_heading(self):
        return self.page.get_by_role("heading").first
