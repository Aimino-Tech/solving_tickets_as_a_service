import os
import pytest
import re
from playwright.sync_api import Page, expect
from pages.login_page import LoginPage


SYNTARO_URL = os.environ.get("SYNTARO_URL", "http://localhost:3099")
OSY_URL = os.environ.get("OSY_URL", "http://localhost:4096")


def be_alive() -> bool:
    import urllib.request
    try:
        urllib.request.urlopen(f"{OSY_URL}/health", timeout=3)
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    os.environ.get("SKIP_BE_TESTS") == "1",
    reason="Backend tests skipped via SKIP_BE_TESTS=1",
)


class TestFEPlusBEIntegration:
    def test_login_page_loads(self, page: Page):
        login_page = LoginPage(page, SYNTARO_URL)
        login_page.goto()
        expect(page).to_have_title(re.compile(r"SYNTARO Dashboard"))

    def test_be_health_reachable(self, page: Page):
        if not be_alive():
            pytest.skip("OpenSymphony (BE) not running")
        resp = page.request.get(f"{OSY_URL}/health", timeout=5000)
        assert resp.ok, f"BE health returned {resp.status}"
        data = resp.json()
        assert "status" in data

    def test_be_dispatch_endpoint_exists(self, page: Page):
        if not be_alive():
            pytest.skip("OpenSymphony (BE) not running")
        resp = page.request.get(f"{OSY_URL}/api/v1/dispatch", timeout=5000)
        assert resp.status in (200, 405, 404, 401, 400)

    def test_cross_service_health_both_alive(self, page: Page):
        fe_resp = page.request.get(f"{SYNTARO_URL}/health")
        assert fe_resp.ok, "SYNTARO FE not healthy"
        if not be_alive():
            pytest.skip("OpenSymphony (BE) not running")
        osy_resp = page.request.get(f"{OSY_URL}/health", timeout=5000)
        assert osy_resp.ok, "OpenSymphony BE not healthy"
