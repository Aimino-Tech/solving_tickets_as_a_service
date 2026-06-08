import json
from pathlib import Path
from unittest import mock

import pytest

from app.common.db import get_repository


SESSION_DIR = Path(__file__).resolve().parent.parent / "csdn" / "browser-state"
SESSION_FILE = SESSION_DIR / "csdn_state.json"


@pytest.fixture(autouse=True)
def _clean_session_file():
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
    yield


def _mock_playwright(headless=True):
    mock_pw_module = mock.MagicMock()
    mock_playwright = mock.MagicMock()
    mock_browser = mock.MagicMock()
    mock_context = mock.MagicMock()
    mock_page = mock.MagicMock()

    mock_pw_module.return_value.start.return_value = mock_playwright
    mock_playwright.chromium.launch.return_value = mock_browser
    mock_browser.new_context.return_value = mock_context
    mock_context.new_page.return_value = mock_page

    return mock_pw_module, mock_playwright, mock_browser, mock_context, mock_page


class TestModuleFunctions:
    def test_ensure_session_dir_creates(self):
        if SESSION_DIR.exists():
            import shutil
            shutil.rmtree(SESSION_DIR)
        from csdn_publisher import _ensure_session_dir
        _ensure_session_dir()
        assert SESSION_DIR.exists()

    def test_save_storage_state(self):
        from csdn_publisher import _save_storage_state
        mock_context = mock.MagicMock()
        result = _save_storage_state(mock_context)
        assert result == SESSION_FILE
        mock_context.storage_state.assert_called_once_with(path=str(SESSION_FILE))

    def test_load_storage_state_nonexistent(self):
        from csdn_publisher import _load_storage_state
        state = _load_storage_state()
        assert state is None

    def test_load_storage_state_valid(self):
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        SESSION_FILE.write_text(json.dumps({"origins": [{"origin": "https://csdn.net", "cookies": [{"name": "UserName"}]}]}))
        from csdn_publisher import _load_storage_state
        state = _load_storage_state()
        assert state == {"origins": [{"origin": "https://csdn.net", "cookies": [{"name": "UserName"}]}]}

    def test_load_storage_state_corrupt(self):
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        SESSION_FILE.write_text("not json")
        from csdn_publisher import _load_storage_state
        state = _load_storage_state()
        assert state is None

    def test_has_valid_session_no_file(self):
        from csdn_publisher import _has_valid_session
        assert _has_valid_session() is False

    def test_has_valid_session_with_csdn_state(self):
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        SESSION_FILE.write_text(json.dumps({"origins": [{"origin": "https://csdn.net", "cookies": [{"name": "UserName", "value": "test"}]}]}))
        from csdn_publisher import _has_valid_session
        assert _has_valid_session() is True

    def test_has_valid_session_without_csdn_origin(self):
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        SESSION_FILE.write_text(json.dumps({"origins": [{"origin": "https://other.com", "cookies": [{"name": "x"}]}]}))
        from csdn_publisher import _has_valid_session
        assert _has_valid_session() is False


class TestCSDNPublisherDryRun:
    def test_dry_run_logs_and_returns(self):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with mock.patch.object(CSDNPublisher, "_ensure_logged_in") as mock_login:
                with CSDNPublisher(headless=True) as publisher:
                    record = publisher.publish_article("Test Title", "Test content", tags=["python", "mcp"], dry_run=True)
        assert record.status == "dry_run"
        mock_login.assert_not_called()

    def test_dry_run_logs_to_db(self):
        repo = get_repository(":memory:")
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True) as publisher:
                publisher.publish_article("Dry Run Title", "content", dry_run=True)
        records = repo.query(platform="csdn")
        assert len(records) >= 1
        assert records[-1].status == "dry_run"

    def test_dry_run_without_tags(self):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True) as publisher:
                record = publisher.publish_article("No Tags", "content", dry_run=True)
        assert record.status == "dry_run"
        assert record.metadata == {"tags": [], "title": "No Tags"}


class TestCSDNPublisherLogin:
    def test_ensure_logged_in_with_session(self):
        SESSION_DIR.mkdir(parents=True, exist_ok=True)
        SESSION_FILE.write_text(json.dumps({"origins": [{"origin": "https://csdn.net", "cookies": [{"name": "UserName", "value": "test"}]}]}))
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with mock.patch("csdn_publisher._has_valid_session", return_value=True):
                with CSDNPublisher(headless=True) as publisher:
                    publisher.page.goto = mock.MagicMock()
                    publisher.page.url = "https://mp.csdn.net/dashboard"
                    publisher._ensure_logged_in()
        publisher.page.goto.assert_called_once_with("https://mp.csdn.net", wait_until="domcontentloaded")

    def test_ensure_logged_in_with_cookie(self):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with mock.patch("csdn_publisher._has_valid_session", return_value=False):
                with mock.patch("csdn_publisher.CSDN_COOKIE", "session=abc123"):
                    with CSDNPublisher(headless=True) as publisher:
                        publisher.page.goto = mock.MagicMock()
                        publisher.page.evaluate = mock.MagicMock()
                        publisher.page.reload = mock.MagicMock()
                        publisher.page.url = "https://mp.csdn.net/dashboard"
                        publisher._ensure_logged_in()
        assert publisher.page.evaluate.called

    def test_ensure_logged_in_with_credentials(self):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with mock.patch("csdn_publisher._has_valid_session", return_value=False):
                with mock.patch("csdn_publisher.CSDN_COOKIE", ""):
                    with mock.patch("csdn_publisher.CSDN_USERNAME", "13800138000"):
                        with mock.patch("csdn_publisher.CSDN_PASSWORD", "secret"):
                            with CSDNPublisher(headless=True) as publisher:
                                publisher.page.goto = mock.MagicMock()
                                publisher.page.fill = mock.MagicMock()
                                publisher.page.click = mock.MagicMock()
                                publisher._ensure_logged_in()
        assert publisher.page.goto.call_args_list[0][0][0] == "https://passport.csdn.net/login"
        assert publisher.page.fill.call_count == 2

    def test_ensure_logged_in_no_credentials(self, capsys):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with mock.patch("csdn_publisher._has_valid_session", return_value=False):
                with mock.patch("csdn_publisher.CSDN_COOKIE", ""):
                    with mock.patch("csdn_publisher.CSDN_USERNAME", ""):
                        with mock.patch("csdn_publisher.CSDN_PASSWORD", ""):
                            with CSDNPublisher(headless=True) as publisher:
                                publisher._ensure_logged_in()
        stderr = capsys.readouterr().err
        assert "no credentials configured" in stderr


class TestCSDNPublisherPublish:
    def test_publish_not_logged_in(self):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True) as publisher:
                publisher._ensure_logged_in = mock.MagicMock()
                publisher.page.url = "https://passport.csdn.net/login"
                record = publisher.publish_article("Title", "content")
        assert record.status == "failed"
        assert "Not logged in" in (record.error_message or "")

    def test_publish_full_flow(self):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True) as publisher:
                publisher._ensure_logged_in = mock.MagicMock()
                publisher.page.url = "https://mp.csdn.net/dashboard"
                publisher.page.goto = mock.MagicMock()
                publisher.page.keyboard = mock.MagicMock()

                title_input = mock.MagicMock()
                content_area = mock.MagicMock()
                content_area.is_visible.return_value = True
                publish_btn = mock.MagicMock()

                def locator_side_effect(*args, **kwargs):
                    selector = args[0] if args else ""
                    if "title" in selector:
                        return title_input
                    if "发布" in selector or "发表" in selector:
                        return publish_btn
                    if "articleContent" in selector or "editor-content" in selector or "CodeMirror-code" in selector:
                        return content_area
                    return mock.MagicMock()

                publisher.page.locator.side_effect = locator_side_effect

                record = publisher.publish_article("My Article", "Hello world", tags=["tag1", "tag2"])
        assert record.status == "sent"
        title_input.fill.assert_called_once_with("My Article")
        publish_btn.first.click.assert_called_once()

    def test_publish_with_error(self):
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True) as publisher:
                publisher._ensure_logged_in = mock.MagicMock()
                publisher.page.url = "https://mp.csdn.net/dashboard"
                publisher.page.goto = mock.MagicMock(side_effect=Exception("Navigation timeout"))
                record = publisher.publish_article("Failing Article", "content")
        assert record.status == "failed"
        assert "Navigation timeout" in (record.error_message or "")

    def test_publish_logs_to_db(self):
        repo = get_repository(":memory:")
        mock_pw, _, _, _, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True) as publisher:
                publisher._ensure_logged_in = mock.MagicMock()
                publisher.page.url = "https://mp.csdn.net/dashboard"
                publisher.page.goto = mock.MagicMock()
                publisher.page.keyboard = mock.MagicMock()

                title_input = mock.MagicMock()
                content_area = mock.MagicMock()
                content_area.is_visible.return_value = True
                publish_btn = mock.MagicMock()

                def locator_side_effect(*args, **kwargs):
                    selector = args[0] if args else ""
                    if "title" in selector:
                        return title_input
                    if "发布" in selector or "发表" in selector:
                        return publish_btn
                    return content_area

                publisher.page.locator.side_effect = locator_side_effect
                publisher.publish_article("DB Test", "content", tags=["test"])
        records = repo.query(platform="csdn")
        assert len(records) >= 1
        assert records[-1].status == "sent"


class TestCSDNPublisherLifecycle:
    def test_context_manager_creates_browser(self):
        mock_pw, mock_playwright, mock_browser, mock_context, mock_page = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            publisher = CSDNPublisher(headless=False)
            with publisher as p:
                assert p._playwright is not None
                assert p._browser is not None
                assert p._context is not None
                assert p._page is not None

            mock_playwright.chromium.launch.assert_called_once_with(headless=False)
            mock_browser.new_context.assert_called_once()
            mock_context.new_page.assert_called_once()

    def test_context_manager_cleanup(self):
        mock_pw, _, mock_browser, mock_context, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True):
                pass

            mock_browser.close.assert_called_once()

    def test_context_manager_saves_state_on_exit(self):
        mock_pw, _, mock_browser, mock_context, _ = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True):
                pass

            mock_context.storage_state.assert_called_once_with(path=str(SESSION_FILE))

    def test_page_property(self):
        mock_pw, _, _, _, mock_page = _mock_playwright()
        with mock.patch("csdn_publisher.sync_playwright", mock_pw):
            from csdn_publisher import CSDNPublisher
            with CSDNPublisher(headless=True) as publisher:
                assert publisher.page is publisher._page

    def test_page_property_raises_before_enter(self):
        from csdn_publisher import CSDNPublisher
        publisher = CSDNPublisher()
        with pytest.raises(AssertionError):
            _ = publisher.page
