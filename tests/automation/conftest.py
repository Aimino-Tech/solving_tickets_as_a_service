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
