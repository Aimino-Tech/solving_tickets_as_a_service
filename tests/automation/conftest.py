import pytest
from playwright.sync_api import Page, BrowserContext, APIRequestContext, sync_playwright


@pytest.fixture(scope="session")
def playwright_instance():
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="session")
def browser(playwright_instance):
    browser = playwright_instance.chromium.launch(headless=True)
    yield browser
    browser.close()


@pytest.fixture(scope="function")
def context(browser) -> BrowserContext:
    context = browser.new_context(viewport={"width": 1280, "height": 720})
    yield context
    context.close()


@pytest.fixture(scope="function")
def page(context: BrowserContext) -> Page:
    page = context.new_page()
    yield page
    page.close()


@pytest.fixture(scope="session")
def base_url() -> str:
    return "http://localhost:5173"


@pytest.fixture(scope="function")
def api_context(playwright_instance, base_url) -> APIRequestContext:
    request = playwright_instance.request.new_context(base_url=base_url)
    yield request
    request.dispose()


E2E_USER_EMAIL = "e2e-core-journey@aimino-test.de"
E2E_USER_PASSWORD = "E2eAutomation123!"
E2E_USER_NAME = "E2E Automation"


@pytest.fixture(scope="session")
def e2e_user(playwright_instance, base_url) -> dict:
    request = playwright_instance.request.new_context(base_url=base_url)
    try:
        resp = request.post(
            "/api/v1/auth/register",
            data={
                "email": E2E_USER_EMAIL,
                "password": E2E_USER_PASSWORD,
                "name": E2E_USER_NAME,
            },
        )
        if resp.status == 201:
            token = resp.json()["token"]
        else:
            # register never 4xx for valid input → existing account, log in instead
            resp = request.post(
                "/api/v1/auth/login",
                data={
                    "email": E2E_USER_EMAIL,
                    "password": E2E_USER_PASSWORD,
                },
            )
            assert resp.status == 200, (
                f"e2e_user setup failed: register={resp.status}, login={resp.status} "
                f"body={resp.text()[:300]}"
            )
            token = resp.json()["token"]
        return {
            "email": E2E_USER_EMAIL,
            "password": E2E_USER_PASSWORD,
            "name": E2E_USER_NAME,
            "token": token,
        }
    finally:
        request.dispose()


@pytest.fixture(scope="function")
def authed_page(context: BrowserContext, e2e_user) -> Page:
    page = context.new_page()
    page.add_init_script(
        "localStorage.setItem('syntaro_token', '%s')" % e2e_user["token"]
    )
    yield page
    page.close()
