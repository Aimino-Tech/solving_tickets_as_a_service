from playwright.sync_api import Page


class SettingsPage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url

    def goto(self):
        self.page.goto(f"{self.base_url}/settings")
        self.page.wait_for_load_state("networkidle")

    @property
    def page_heading(self):
        return self.page.get_by_role("heading", name="Settings").first

    @property
    def profile_section(self):
        return self.page.locator("text=Profile").first

    @property
    def notification_section(self):
        return self.page.locator("text=Notifications").first

    @property
    def api_keys_section(self):
        return self.page.locator("text=API Keys").first

    @property
    def team_section(self):
        return self.page.locator("text=Team").first

    @property
    def save_button(self):
        return self.page.get_by_role("button", name="Save").first
