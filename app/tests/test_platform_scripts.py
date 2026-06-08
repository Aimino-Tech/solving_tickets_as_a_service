from unittest import mock

import httpx
from app.common.db import get_repository


def _mock_client(mock_class, method="get", json_data=None, status_code=200, raise_on=None, text=None):
    instance = mock_class.return_value.__enter__.return_value
    resp = instance.request.return_value if method == "request" else getattr(instance, method).return_value
    resp.status_code = status_code
    if json_data is not None:
        resp.json.return_value = json_data
    if text is not None:
        resp.text = text
    resp.raise_for_status.side_effect = raise_on
    return instance


class TestV2EXClient:
    def test_get_latest_topics(self):
        with mock.patch("v2ex_client.httpx.Client") as mc:
            fake_data = [{"id": 1, "title": "hello"}]
            _mock_client(mc, json_data=fake_data)
            from v2ex_client import get_latest_topics
            result = get_latest_topics("python", 5)
        assert result == fake_data

    def test_create_topic(self):
        with mock.patch("v2ex_client.httpx.Client") as mc:
            fake_data = {"id": 123, "title": "test"}
            _mock_client(mc, method="post", json_data=fake_data)
            from v2ex_client import create_topic
            result = create_topic("python", "Hello", "World", ["mcp"])
        assert result == fake_data

    def test_create_topic_retry_on_429(self):
        with mock.patch("v2ex_client.httpx.Client") as mc:
            fake_data = {"id": 456, "title": "retried"}
            instance = mc.return_value.__enter__.return_value
            fail_resp = mock.MagicMock()
            fail_resp.status_code = 429
            fail_resp.raise_for_status.side_effect = httpx.HTTPStatusError("rate limit", request=mock.MagicMock(), response=fail_resp)
            ok_resp = mock.MagicMock()
            ok_resp.status_code = 200
            ok_resp.json.return_value = fake_data
            ok_resp.raise_for_status.return_value = None
            instance.post.side_effect = [fail_resp, ok_resp]
            from v2ex_client import create_topic
            result = create_topic("python", "Hello", "World")
        assert result == fake_data
        assert instance.post.call_count == 2

    def test_get_token_info(self):
        with mock.patch("v2ex_client.httpx.Client") as mc:
            fake_data = {"token": "abc", "scope": "all"}
            _mock_client(mc, json_data=fake_data)
            from v2ex_client import get_token_info
            result = get_token_info()
        assert result == fake_data

    def test_logs_to_db(self):
        repo = get_repository(":memory:")
        with mock.patch("v2ex_client.httpx.Client") as mc:
            _mock_client(mc, json_data=[{"id": 1}])
            from v2ex_client import get_latest_topics
            get_latest_topics("python", 3)
        records = repo.query(platform="v2ex")
        assert len(records) >= 1


class TestJuejinClient:
    def test_search_articles(self):
        with mock.patch("juejin_client.httpx.Client") as mc:
            fake_data = {"data": [{"article_id": "1"}]}
            _mock_client(mc, method="post", json_data=fake_data)
            from juejin_client import search_articles
            result = search_articles("mcp")
        assert result == fake_data

    def test_create_article(self):
        with mock.patch("juejin_client.httpx.Client") as mc:
            fake_data = {"data": {"article_id": "999"}}
            _mock_client(mc, method="post", json_data=fake_data)
            from juejin_client import create_article
            result = create_article("Title", "Content")
        assert result == fake_data

    def test_create_article_retry_on_429(self):
        with mock.patch("juejin_client.httpx.Client") as mc:
            fake_data = {"data": {"article_id": "888"}}
            instance = mc.return_value.__enter__.return_value
            fail_resp = mock.MagicMock()
            fail_resp.status_code = 429
            fail_resp.raise_for_status.side_effect = httpx.HTTPStatusError("rate limit", request=mock.MagicMock(), response=fail_resp)
            ok_resp = mock.MagicMock()
            ok_resp.status_code = 200
            ok_resp.json.return_value = fake_data
            ok_resp.raise_for_status.return_value = None
            instance.post.side_effect = [fail_resp, ok_resp]
            from juejin_client import create_article
            result = create_article("Title", "Content")
        assert result == fake_data

    def test_logs_to_db(self):
        repo = get_repository(":memory:")
        with mock.patch("juejin_client.httpx.Client") as mc:
            _mock_client(mc, method="post", json_data={"data": []})
            from juejin_client import search_articles
            search_articles("test")
        records = repo.query(platform="juejin")
        assert len(records) >= 1


class TestCSDNScraper:
    def test_search_articles(self):
        with mock.patch("csdn_scraper.httpx.Client") as mc:
            _mock_client(mc, text="<html>results</html>")
            from csdn_scraper import search_articles
            result = search_articles("mcp")
        assert "<html>results</html>" in result

    def test_check_blog_exists(self):
        with mock.patch("csdn_scraper.httpx.Client") as mc:
            instance = mc.return_value.__enter__.return_value
            resp = instance.get.return_value
            resp.status_code = 200
            from csdn_scraper import check_blog
            result = check_blog("testuser")
        assert result["exists"] is True

    def test_check_blog_not_found(self):
        with mock.patch("csdn_scraper.httpx.Client") as mc:
            instance = mc.return_value.__enter__.return_value
            resp = instance.get.return_value
            resp.status_code = 404
            from csdn_scraper import check_blog
            result = check_blog("nobody")
        assert result["exists"] is False

    def test_logs_to_db(self):
        repo = get_repository(":memory:")
        with mock.patch("csdn_scraper.httpx.Client") as mc:
            _mock_client(mc, text="ok")
            from csdn_scraper import search_articles
            search_articles("mcp")
        records = repo.query(platform="csdn")
        assert len(records) >= 1


class TestZhihuScraper:
    def test_search_content(self):
        with mock.patch("zhihu_scraper.httpx.Client") as mc:
            fake_data = {"data": [{"question": {"title": "test"}}]}
            _mock_client(mc, json_data=fake_data)
            from zhihu_scraper import search_content
            result = search_content("mcp")
        assert result == fake_data

    def test_get_hot_topics(self):
        with mock.patch("zhihu_scraper.httpx.Client") as mc:
            fake_data = {"data": [{"id": "hot1"}]}
            _mock_client(mc, json_data=fake_data)
            from zhihu_scraper import get_hot_topics
            result = get_hot_topics()
        assert result == fake_data

    def test_logs_to_db(self):
        repo = get_repository(":memory:")
        with mock.patch("zhihu_scraper.httpx.Client") as mc:
            _mock_client(mc, json_data={"data": []})
            from zhihu_scraper import search_content
            search_content("mcp")
        records = repo.query(platform="zhihu")
        assert len(records) >= 1


class TestWeComBot:
    def _setup_env(self):
        import os
        os.environ["WECOM_AGENT_ID"] = "1000001"
        os.environ["WECOM_CORP_ID"] = "test-corp"
        os.environ["WECOM_CORP_SECRET"] = "test-secret"

    def test_send_text(self):
        self._setup_env()
        with mock.patch("wecom_bot.httpx.Client") as mc:
            instance = mc.return_value.__enter__.return_value
            token_resp = instance.get.return_value
            token_resp.json.return_value = {"errcode": 0, "access_token": "test-token"}
            token_resp.raise_for_status.return_value = None
            send_resp = mock.MagicMock()
            send_resp.json.return_value = {"errcode": 0, "msgid": "msg-123"}
            send_resp.raise_for_status.return_value = None
            instance.post.return_value = send_resp
            from wecom_bot import send_text
            result = send_text("hello", "user1")
        assert result["errcode"] == 0

    def test_send_text_token_error(self):
        self._setup_env()
        with mock.patch("wecom_bot.httpx.Client") as mc:
            instance = mc.return_value.__enter__.return_value
            token_resp = instance.get.return_value
            token_resp.json.return_value = {"errcode": 40001, "errmsg": "invalid cred"}
            token_resp.raise_for_status.return_value = None
            from wecom_bot import send_text
            import pytest
            with pytest.raises(Exception, match="Token error"):
                send_text("hello")

    def test_logs_to_db(self):
        self._setup_env()
        repo = get_repository(":memory:")
        with mock.patch("wecom_bot.httpx.Client") as mc:
            instance = mc.return_value.__enter__.return_value
            token_resp = instance.get.return_value
            token_resp.json.return_value = {"errcode": 0, "access_token": "t"}
            token_resp.raise_for_status.return_value = None
            send_resp = mock.MagicMock()
            send_resp.json.return_value = {"errcode": 0, "msgid": "m-1"}
            send_resp.raise_for_status.return_value = None
            instance.post.return_value = send_resp
            from wecom_bot import send_text
            send_text("hello")
        records = repo.query(platform="wecom")
        assert len(records) >= 1
