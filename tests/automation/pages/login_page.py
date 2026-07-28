from playwright.sync_api import Page, expect


class LoginPage:
    def __init__(self, page: Page, base_url: str):
        self.page = page
        self.base_url = base_url

    def goto(self):
        self.page.goto(f"{self.base_url}/login")
        self.page.wait_for_load_state("networkidle")

    @property
    def sign_in_tab(self):
        return self.page.get_by_role("button", name="Sign In").first

    @property
    def register_tab(self):
        return self.page.get_by_role("button", name="Register")

    @property
    def name_input(self):
        return self.page.get_by_placeholder("Your name")

    @property
    def email_input(self):
        return self.page.get_by_placeholder("you@example.com")

    @property
    def password_input(self):
        return self.page.locator("input[type='password']")

    @property
    def sign_in_submit_button(self):
        return self.page.locator("button[type='submit']", has_text="Sign In")

    @property
    def submit_button(self):
        return self.page.get_by_role("button", name="Create Account")

    @property
    def error_message(self):
        return self.page.locator("form p.text-sm.text-red-500")

    @property
    def page_title_heading(self):
        return self.page.get_by_role("heading", name="Solving Tickets As A Service").first

    def switch_to_register(self):
        self.register_tab.click()
        self.page.wait_for_timeout(300)

    def switch_to_login(self):
        self.sign_in_tab.click()
        self.page.wait_for_timeout(300)

    def fill_register_form(self, name: str, email: str, password: str):
        self.name_input.fill(name)
        self.email_input.fill(email)
        self.password_input.fill(password)

    def submit_register(self):
        self.submit_button.click()

    def register(self, name: str, email: str, password: str):
        self.switch_to_register()
        self.fill_register_form(name, email, password)
        self.submit_register()

    def sign_in(self, email: str, password: str):
        self.switch_to_login()
        self.email_input.fill(email)
        self.password_input.fill(password)
        self.sign_in_submit_button.click()

    def expect_register_form_visible(self):
        expect(self.name_input).to_be_visible()
        expect(self.email_input).to_be_visible()
        expect(self.submit_button).to_be_visible()
