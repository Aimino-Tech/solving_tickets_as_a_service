import json
import unittest
from unittest.mock import patch, MagicMock


class TestRednoteAutoReply(unittest.TestCase):
    @patch.dict("os.environ", {}, clear=True)
    def test_auto_reply_no_api_configured(self):
        from app.platforms.chinese.rednote_auto_reply import auto_reply
        result = auto_reply(dry_run=True)
        self.assertEqual(result["status"], "noop")
        self.assertEqual(result["replied"], 0)

    @patch("app.platforms.chinese.rednote_auto_reply.fetch_comments", return_value=[])
    def test_auto_reply_no_comments(self, mock_fetch):
        from app.platforms.chinese.rednote_auto_reply import auto_reply
        result = auto_reply(dry_run=True)
        self.assertEqual(result["status"], "noop")

    @patch("app.platforms.chinese.rednote_auto_reply.fetch_comments", return_value=[{"id": "1"}, {"id": "2"}])
    def test_auto_reply_dry_run(self, mock_fetch):
        from app.platforms.chinese.rednote_auto_reply import auto_reply
        result = auto_reply(dry_run=True)
        self.assertEqual(result["status"], "dry_run")
        self.assertEqual(result["replied"], 2)
