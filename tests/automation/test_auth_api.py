import os
import pytest
import requests


REGISTER_PATH = "/api/v1/auth/register"
LOGIN_PATH = "/api/v1/auth/login"


def stas_backend_reachable() -> bool:
    url = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")
    try:
        r = requests.get(f"{url}/api/health", timeout=3)
        return r.status_code == 200 and "application/json" in r.headers.get("Content-Type", "")
    except (requests.ConnectionError, requests.Timeout):
        return False


class TestAuthAPI:
    @pytest.mark.xfail(reason="Supabase auth not configured — returns 500")
    def test_register_endpoint_returns_201(self):
        url = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")
        resp = requests.post(
            f"{url}{REGISTER_PATH}",
            json={"email": "test@example.com", "password": "password123", "name": "Test User"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "token" in data
        assert "user" in data

    @pytest.mark.xfail(reason="Supabase auth not configured — returns 500")
    def test_register_without_name_returns_201(self):
        url = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")
        resp = requests.post(
            f"{url}{REGISTER_PATH}",
            json={"email": "noname@example.com", "password": "password123"},
        )
        assert resp.status_code == 201

    def test_register_with_short_password_returns_400(self):
        if not stas_backend_reachable():
            pytest.skip("STAS backend not reachable")
        url = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")
        resp = requests.post(
            f"{url}{REGISTER_PATH}",
            json={"email": "weak@example.com", "password": "123"},
        )
        assert resp.status_code == 400

    def test_register_with_invalid_email_returns_400(self):
        if not stas_backend_reachable():
            pytest.skip("STAS backend not reachable")
        url = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")
        resp = requests.post(
            f"{url}{REGISTER_PATH}",
            json={"email": "not-an-email", "password": "password123"},
        )
        assert resp.status_code == 400

    def test_register_duplicate_email_returns_409(self):
        if not stas_backend_reachable():
            pytest.skip("STAS backend not reachable")
        url = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")
        email = "duplicate@example.com"
        resp1 = requests.post(
            f"{url}{REGISTER_PATH}",
            json={"email": email, "password": "password123", "name": "First"},
        )
        if resp1.status_code != 201:
            pytest.skip("First registration did not succeed, skipping duplicate test")
        resp2 = requests.post(
            f"{url}{REGISTER_PATH}",
            json={"email": email, "password": "password123", "name": "Second"},
        )
        assert resp2.status_code == 409

    @pytest.mark.xfail(reason="Supabase auth not configured — returns 401")
    def test_login_endpoint_returns_200(self):
        url = os.environ.get("STAS_BACKEND_URL", "http://localhost:3000")
        resp = requests.post(
            f"{url}{LOGIN_PATH}",
            json={"email": "test@example.com", "password": "password123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "token" in data