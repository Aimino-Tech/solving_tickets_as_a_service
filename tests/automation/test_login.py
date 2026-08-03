import pytest
import re
from playwright.sync_api import Page, expect
from pages.login_page import LoginPage


class TestLoginPageUI:
    def test_page_loads_correctly(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        expect(page).to_have_title(re.compile(r"SYNTARO Dashboard"))
        expect(login_page.page_title_heading).to_be_visible()

    def test_sign_in_and_register_tabs_visible(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        expect(login_page.sign_in_tab).to_be_visible()
        expect(login_page.register_tab).to_be_visible()

    def test_sign_in_tab_active_by_default(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        expect(login_page.sign_in_tab).to_have_class(re.compile(r"bg-brand-600"))
        expect(login_page.register_tab).not_to_have_class(re.compile(r"bg-brand-600"))

    def test_register_form_shows_name_field(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.switch_to_register()
        login_page.expect_register_form_visible()

    def test_register_click_adds_name_field(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        name_field = login_page.name_input
        expect(name_field).not_to_be_visible()
        login_page.switch_to_register()
        expect(name_field).to_be_visible()

    def test_password_field_type(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.switch_to_register()
        password_type = login_page.password_input.get_attribute("type")
        assert password_type == "password", f"Expected type=password, got {password_type}"


class TestRegisterFunctionality:
    @pytest.fixture(autouse=True)
    def setup(self, page: Page, base_url: str):
        self.page = page
        self.login_page = LoginPage(page, base_url)
        self.login_page.goto()

    def test_register_button_text_is_create_account(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.switch_to_register()
        expect(login_page.submit_button).to_have_text("Create Account")

    def test_register_form_submission_shows_error(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.register("Test User", "test@example.com", "password123")
        self.page.wait_for_timeout(2000)
        expect(login_page.error_message).to_be_visible(timeout=10000)

    def test_password_minimum_length_is_8(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.switch_to_register()
        password_input = login_page.password_input
        min_length = password_input.get_attribute("minLength")
        assert min_length == "8", f"Expected minLength=8, got {min_length}"

    def test_register_requires_email(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.switch_to_register()
        email_input = login_page.email_input
        email_type = email_input.get_attribute("type")
        assert email_type == "email", f"Expected type=email, got {email_type}"


class TestSignInFunctionality:
    @pytest.fixture(autouse=True)
    def setup(self, page: Page, base_url: str):
        self.page = page
        self.login_page = LoginPage(page, base_url)
        self.login_page.goto()

    def test_sign_in_form_has_email_and_password(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        expect(login_page.email_input).to_be_visible()
        expect(login_page.password_input).to_be_visible()
        expect(login_page.sign_in_submit_button).to_be_visible()

    def test_sign_in_submit_button_text(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        expect(login_page.sign_in_submit_button).to_have_text("Sign In")

    def test_sign_in_no_name_field(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        expect(login_page.name_input).not_to_be_visible()

    def test_sign_in_switch_to_register_switches_back(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.switch_to_register()
        expect(login_page.name_input).to_be_visible()
        login_page.switch_to_login()
        expect(login_page.name_input).not_to_be_visible()

    def test_sign_in_form_submission_redirects_back_to_login(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.email_input.fill("test@example.com")
        login_page.password_input.fill("password123")
        login_page.sign_in_submit_button.click()
        page.wait_for_url(f"{base_url}/login", timeout=10000)

    def test_sign_in_form_submission_shows_error(self, page: Page, base_url: str):
        login_page = LoginPage(page, base_url)
        login_page.goto()
        login_page.sign_in("test@example.com", "password123")
        page.wait_for_timeout(2000)
        expect(login_page.error_message).to_be_visible(timeout=10000)
