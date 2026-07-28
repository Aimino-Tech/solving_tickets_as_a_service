import os
import re
import requests
import pytest
from playwright.sync_api import Page, expect


FE_URL = os.environ.get("STAS_FE_URL", "http://localhost:5173/dashboard")
BE_URL = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")


def stas_backend_reachable() -> bool:
    try:
        r = requests.get(f"{BE_URL}/api/health", timeout=3)
        return r.status_code == 200 and "application/json" in r.headers.get("Content-Type", "")
    except (requests.ConnectionError, requests.Timeout):
        return False


class TestHealth:
    def test_fe_health_endpoint(self):
        resp = requests.get(f"{FE_URL}/health", timeout=5)
        assert resp.status_code in (200, 404), f"Expected 200 or 404, got {resp.status_code}"

    def test_fe_homepage_loads(self, page: Page):
        page.goto(f"{FE_URL}/")
        page.wait_for_load_state("networkidle")
        expect(page).to_have_title(re.compile(r"STAS Dashboard"))

    def test_fe_login_page_loads(self, page: Page):
        page.goto(f"{FE_URL}/login")
        page.wait_for_load_state("networkidle")
        expect(page).to_have_title(re.compile(r"STAS Dashboard"))
        heading = page.get_by_role("heading", name="Solving Tickets As A Service")
        expect(heading).to_be_visible()

    def test_be_api_health(self):
        if not stas_backend_reachable():
            pytest.skip("STAS backend not reachable — set STAS_BACKEND_URL if running")
        resp = requests.get(f"{BE_URL}/api/health", timeout=5)
        assert resp.status_code == 200
        data = resp.json()
        assert "status" in data or "ok" in str(data).lower()

    def test_be_root_health(self):
        if not stas_backend_reachable():
            pytest.skip("STAS backend not reachable")
        resp = requests.get(f"{BE_URL}/health", timeout=5)
        assert resp.status_code < 500

    def test_stas_and_fe_both_alive(self):
        fe_ok = False
        try:
            r = requests.get(f"{FE_URL}/", timeout=5)
            fe_ok = r.status_code < 500
        except requests.ConnectionError:
            pass
        be_ok = stas_backend_reachable()
        assert fe_ok, "STAS (FE) is not reachable"
        if not be_ok:
            pytest.skip("STAS (BE) not reachable — FE only check passed")