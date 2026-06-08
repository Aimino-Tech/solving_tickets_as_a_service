import json
import unittest
from unittest.mock import patch, MagicMock


class TestWeComWebhook(unittest.TestCase):
    def setUp(self):
        self.maxDiff = None

    @patch.dict("os.environ", {"WECOM_WEBHOOK_TOKEN": "test_token"})
    def test_verify_url_valid(self):
        from app.utils.wecom_webhook import _verify_url
        import hashlib
        token = "test_token"
        timestamp = "1234567890"
        nonce = "nonce123"
        echostr = "hello"
        parts = sorted([token, timestamp, nonce])
        expected_sig = hashlib.sha1("".join(parts).encode()).hexdigest()
        result = _verify_url(expected_sig, timestamp, nonce, echostr)
        self.assertEqual(result, echostr)

    @patch.dict("os.environ", {"WECOM_WEBHOOK_TOKEN": "test_token"})
    def test_verify_url_invalid(self):
        from app.utils.wecom_webhook import _verify_url
        result = _verify_url("wrong_sig", "123", "nonce", "echostr")
        self.assertIsNone(result)

    def test_parse_xml(self):
        from app.utils.wecom_webhook import _parse_xml
        xml = b"<xml><ToUserName><![CDATA[toUser]]></ToUserName><MsgType><![CDATA[text]]></MsgType></xml>"
        result = _parse_xml(xml)
        self.assertEqual(result.get("ToUserName"), "toUser")
        self.assertEqual(result.get("MsgType"), "text")

    def test_handle_message_json(self):
        from app.utils.wecom_webhook import handle_message
        body = json.dumps({"MsgType": "text", "Content": "hello"}).encode()
        result = handle_message(body, {})
        self.assertEqual(result["errcode"], 0)

    def test_handle_event(self):
        from app.utils.wecom_webhook import handle_event
        body = json.dumps({"Event": "change_contact", "ChangeType": "create_user"}).encode()
        result = handle_event(body, {})
        self.assertEqual(result["errcode"], 0)
        self.assertEqual(result["event"], "change_contact")

    def test_handle_status(self):
        from app.utils.wecom_webhook import handle_status
        body = json.dumps({"status": "success"}).encode()
        result = handle_status(body, {})
        self.assertEqual(result["errcode"], 0)
