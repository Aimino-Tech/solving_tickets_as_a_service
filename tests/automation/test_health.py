import os
import pytest
import re
from playwright.sync_api import Page, expect


STAS_URL = os.environ.get("STAS_URL", "http://localhost:3099")
OSY_URL = os.environ.get("OSY_URL", "http://localhost:4096")


def be_alive() -> bool:
    import urllib.request
    try:
        urllib.request.urlopen(f"{OSY_URL}/health", timeout=3)
        return True
    except Exception:
        return False


class TestSTASHealth:
    def test_fe_health_endpoint_reachable(self, page: Page):
        resp = page.request.get(f"{STAS_URL}/health")
        assert resp.ok, f"FE health returned {resp.status}"
        data = resp.json()
        assert data.get("status") == "ok"

    def test_fe_homepage_loads_correctly(self, page: Page):
        page.goto(STAS_URL)
        page.wait_for_load_state("networkidle")
        expect(page).to_have_title(re.compile(r"STAS Dashboard"))

    def test_be_health_endpoint_reachable(self, page: Page):
        if not be_alive():
            pytest.skip("OpenSymphony (BE) not running")
        resp = page.request.get(f"{OSY_URL}/health", timeout=5000)
        assert resp.ok, f"BE health returned {resp.status}"
        data = resp.json()
        assert "status" in data

    def test_stas_and_osy_both_alive(self, page: Page):
        fe_resp = page.request.get(f"{STAS_URL}/health")
        assert fe_resp.ok, "STAS FE is not healthy"
        if not be_alive():
            pytest.skip("OpenSymphony (BE) not running")
        be_resp = page.request.get(f"{OSY_URL}/health", timeout=5000)
        assert be_resp.ok, "OpenSymphony BE is not healthy"
