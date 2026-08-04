import os
import pytest
import re
from playwright.sync_api import Page, expect


SYNTARO_URL = os.environ.get("SYNTARO_URL", "http://localhost:3002")
OSY_URL = os.environ.get("OSY_URL", "http://localhost:3002")


def be_alive() -> bool:
    import urllib.request
    try:
        urllib.request.urlopen(f"{OSY_URL}/health", timeout=3)
        return True
    except Exception:
        return False


class TestSYNTAROHealth:
    def test_fe_health_endpoint_reachable(self, page: Page):
        resp = page.request.get(f"{SYNTARO_URL}/health")
        # Health endpoint returns 200 (all ok) or 503 (degraded, some deps down)
        # Both mean the server is alive
        assert resp.status in (200, 503), f"FE health returned {resp.status}"
        data = resp.json()
        assert data.get("status") in ("ok", "degraded")

    def test_fe_homepage_loads_correctly(self, page: Page):
        page.goto(SYNTARO_URL)
        page.wait_for_load_state("networkidle")
        expect(page).to_have_title(re.compile(r"SYNTARO Dashboard"))

    def test_be_health_endpoint_reachable(self, page: Page):
        if not be_alive():
            pytest.skip("OpenSymphony (BE) not running")
        resp = page.request.get(f"{OSY_URL}/health", timeout=5000)
        assert resp.status in (200, 503), f"BE health returned {resp.status}"
        data = resp.json()
        assert "status" in data

    def test_syntaro_and_osy_both_alive(self, page: Page):
        fe_resp = page.request.get(f"{SYNTARO_URL}/health")
        assert fe_resp.status in (200, 503), "SYNTARO FE is not healthy"
        if not be_alive():
            pytest.skip("OpenSymphony (BE) not running")
        be_resp = page.request.get(f"{OSY_URL}/health", timeout=5000)
        assert be_resp.status in (200, 503), "OpenSymphony BE is not healthy"
