import json
import unittest
from unittest.mock import patch, MagicMock


class TestEngagementAPI(unittest.TestCase):
    def test_query_engagements_empty(self):
        mock_repo = MagicMock()
        mock_repo.conn.execute.return_value.fetchdf.return_value = __import__("pandas").DataFrame()
        with patch("app.orchestration.engagement_api.get_repository", return_value=mock_repo):
            from app.orchestration.engagement_api import query_engagements
            result = query_engagements({"platform": "wecom"})
            self.assertTrue(result["success"])
            self.assertEqual(result["count"], 0)

    def test_export_engagements(self):
        mock_repo = MagicMock()
        mock_df = MagicMock()
        mock_repo.conn.execute.return_value.fetchdf.return_value = mock_df
        with patch("app.orchestration.engagement_api.get_repository", return_value=mock_repo):
            from app.orchestration.engagement_api import export_engagements
            result = export_engagements({})
            self.assertTrue(result["success"])
            mock_df.to_csv.assert_called_once()

    def test_export_engagements_failure(self):
        mock_repo = MagicMock()
        mock_repo.conn.execute.side_effect = Exception("db error")
        with patch("app.orchestration.engagement_api.get_repository", return_value=mock_repo):
            from app.orchestration.engagement_api import export_engagements
            result = export_engagements({})
            self.assertFalse(result["success"])
            self.assertIn("internal error", result["error"])
