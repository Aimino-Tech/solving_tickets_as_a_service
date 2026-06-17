"""Tests for multi-tab sheet ingestion (``marketing/sheet_sync.py``).

Covers ``ALL_TABS`` constant, ``get_tab_ranges()``, ``pull_all_tabs()``,
and the parameterized ``_read_sheet(sheet_tab, column_range)`` signature.
"""

from __future__ import annotations

import json
from urllib.error import URLError
from unittest.mock import MagicMock, patch

import pytest

from marketing.sheet_sync import (
    ALL_TABS,
    _ALL_TABS,
    SheetSync,
)

SHEET_ID = "1Nf_H61D4GGq5aFlypAHlW_f1Uaso1c4OmJ9QRz5qRaY"


# ===================================================================
# Fixtures
# ===================================================================


@pytest.fixture
def mock_store() -> MagicMock:
    store = MagicMock()
    store.list_campaigns.return_value = []
    store.get_actions.return_value = []
    return store


@pytest.fixture
def sync(mock_store: MagicMock) -> SheetSync:
    return SheetSync(sheet_id=SHEET_ID, store=mock_store)


# ===================================================================
# ALL_TABS
# ===================================================================


class TestAllTabs:
    def test_all_9_tabs_present(self) -> None:
        assert len(ALL_TABS) == 9

    def test_expected_tab_names(self) -> None:
        expected = [
            "reddit-campaign",
            "project-overview",
            "twitter-campaign",
            "linkedin-campaign",
            "hacker-news-campaign",
            "discord-campaign",
            "instagram-campaign",
            "threads-campaign",
            "Public-marketplaces",
        ]
        assert ALL_TABS == expected

    def test_no_duplicates(self) -> None:
        assert len(ALL_TABS) == len(set(ALL_TABS))

    def test_all_tabs_in_ranges(self) -> None:
        """Every tab in ALL_TABS has a corresponding entry in _ALL_TABS."""
        tab_names = {name for name, _range in _ALL_TABS}
        for name in ALL_TABS:
            assert name in tab_names


# ===================================================================
# get_tab_ranges
# ===================================================================


class TestGetTabRanges:
    def test_returns_all_tabs(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert len(ranges) == 9

    def test_reddit_campaign_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["reddit-campaign"] == "A:T"

    def test_project_overview_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["project-overview"] == "A:L"

    def test_twitter_campaign_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["twitter-campaign"] == "A:P"

    def test_linkedin_campaign_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["linkedin-campaign"] == "A:P"

    def test_hacker_news_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["hacker-news-campaign"] == "A:N"

    def test_discord_campaign_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["discord-campaign"] == "A:N"

    def test_instagram_campaign_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["instagram-campaign"] == "A:L"

    def test_threads_campaign_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["threads-campaign"] == "A:L"

    def test_public_marketplaces_range(self) -> None:
        ranges = SheetSync.get_tab_ranges()
        assert ranges["Public-marketplaces"] == "A:G"


# ===================================================================
# pull_all_tabs
# ===================================================================


class TestPullAllTabs:
    def test_returns_dict_with_all_tab_keys(self, sync: SheetSync) -> None:
        """Each tab in ALL_TABS appears as a key in the result."""
        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = ([], None)
            result = sync.pull_all_tabs()

        for tab in ALL_TABS:
            assert tab in result

    def test_each_entry_has_rows_and_headers(
        self, sync: SheetSync,
    ) -> None:
        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = ([], None)
            result = sync.pull_all_tabs()

        for tab in ALL_TABS:
            entry = result[tab]
            assert "rows" in entry
            assert "headers" in entry

    def test_reads_with_correct_column_range(
        self, sync: SheetSync,
    ) -> None:
        """Verify _read_sheet is called with tab-specific column ranges."""
        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = ([], None)
            sync.pull_all_tabs()

        expected_calls = [
            ("reddit-campaign", "A:T"),
            ("project-overview", "A:L"),
            ("twitter-campaign", "A:P"),
            ("linkedin-campaign", "A:P"),
            ("hacker-news-campaign", "A:N"),
            ("discord-campaign", "A:N"),
            ("instagram-campaign", "A:L"),
            ("threads-campaign", "A:L"),
            ("Public-marketplaces", "A:G"),
        ]

        assert mock_read.call_count == 9
        for i, (tab, col_range) in enumerate(expected_calls):
            call_args = mock_read.call_args_list[i]
            assert call_args == ((tab,), {"column_range": col_range}), (
                f"Mismatch at call {i}: expected ({tab!r}, column_range={col_range!r}), "
                f"got {call_args}"
            )

    def test_returns_data_rows_and_headers(
        self, sync: SheetSync,
    ) -> None:
        """Data rows and headers are correctly returned."""
        mock_rows = [
            ["ContentID", "ActionType", "Platform"],
            ["ODA000001", "comment", "reddit"],
            ["ODA000002", "post", "twitter"],
        ]

        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = (mock_rows[1:], mock_rows[0])
            result = sync.pull_all_tabs()
            entry = result["reddit-campaign"]

        assert entry["headers"] == ["ContentID", "ActionType", "Platform"]
        assert len(entry["rows"]) == 2
        assert entry["rows"][0] == ["ODA000001", "comment", "reddit"]
        assert entry["rows"][1] == ["ODA000002", "post", "twitter"]

    def test_headers_empty_when_no_rows(
        self, sync: SheetSync,
    ) -> None:
        """When _read_sheet returns no data, headers is empty list."""
        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = ([], None)
            result = sync.pull_all_tabs()

        for tab in ALL_TABS:
            assert result[tab]["headers"] == []

    def test_headers_empty_when_no_header(
        self, sync: SheetSync,
    ) -> None:
        """When _read_sheet returns ([], None), headers is []."""
        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = ([], None)
            result = sync.pull_all_tabs()

        for tab in ALL_TABS:
            assert result[tab]["headers"] == []

    def test_rows_empty_when_no_data(
        self, sync: SheetSync,
    ) -> None:
        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = ([], None)
            result = sync.pull_all_tabs()

        for tab in ALL_TABS:
            assert result[tab]["rows"] == []

    def test_headers_empty_when_header_only(
        self, sync: SheetSync,
    ) -> None:
        """When _read_sheet returns only a header row, rows is empty but headers is populated."""
        mock_rows = [["Col1", "Col2", "Col3"]]

        with patch.object(sync, "_read_sheet") as mock_read:
            mock_read.return_value = ([], mock_rows[0])
            result = sync.pull_all_tabs()

        for tab in ALL_TABS:
            assert result[tab]["headers"] == ["Col1", "Col2", "Col3"]
            assert result[tab]["rows"] == []


# ===================================================================
# Graceful degradation
# ===================================================================


class TestGracefulDegradation:
    def test_urlerror_returns_empty(
        self, sync: SheetSync,
    ) -> None:
        """URLError on a tab should log warning and return empty."""
        def side_effect(tab: str, **kw: str) -> tuple[list, None]:
            if tab == "reddit-campaign":
                raise URLError("Tab not found")
            return ([], None)

        with (
            patch.object(sync, "_read_sheet", side_effect=side_effect),
            patch("marketing.sheet_sync.logger.warning") as mock_warn,
        ):
            result = sync.pull_all_tabs()

        assert result["reddit-campaign"]["rows"] == []
        assert result["reddit-campaign"]["headers"] == []
        mock_warn.assert_called_once()
        assert "reddit-campaign" in str(mock_warn.call_args)

    def test_json_decode_error_returns_empty(
        self, sync: SheetSync,
    ) -> None:
        """JSON decode error should be caught gracefully."""

        def side_effect(tab: str, **kw: str) -> tuple[list, None]:
            if tab == "twitter-campaign":
                raise json.JSONDecodeError("Bad JSON", "", 0)
            return ([], None)

        with (
            patch.object(sync, "_read_sheet", side_effect=side_effect),
            patch("marketing.sheet_sync.logger.warning") as mock_warn,
        ):
            result = sync.pull_all_tabs()

        assert result["twitter-campaign"]["rows"] == []
        mock_warn.assert_called_once()

    def test_oserror_returns_empty(
        self, sync: SheetSync,
    ) -> None:
        """OSError (connection reset) should be caught gracefully."""

        def side_effect(tab: str, **kw: str) -> tuple[list, None]:
            if tab == "discord-campaign":
                raise OSError("Connection reset")
            return ([], None)

        with (
            patch.object(sync, "_read_sheet", side_effect=side_effect),
        ):
            result = sync.pull_all_tabs()

        assert result["discord-campaign"]["rows"] == []

    def test_multiple_tabs_fail_others_still_read(
        self, sync: SheetSync,
    ) -> None:
        """If two tabs fail, the remaining 7 are still read successfully."""
        fail_tabs = {"project-overview", "hacker-news-campaign"}

        data = [
            ["ContentID", "ActionType"],
            ["ODA000001", "comment"],
        ]

        def side_effect(tab: str, **kw: str) -> tuple[list, None]:
            if tab in fail_tabs:
                raise URLError("Missing")
            return (data[1:], data[0])

        with patch.object(sync, "_read_sheet", side_effect=side_effect):
            result = sync.pull_all_tabs()

        assert result["project-overview"]["rows"] == []
        assert result["hacker-news-campaign"]["rows"] == []

        for tab in set(ALL_TABS) - fail_tabs:
            assert len(result[tab]["rows"]) == 1
            assert result[tab]["headers"] == ["ContentID", "ActionType"]

    def test_all_tabs_fail_returns_empty_dicts(
        self, sync: SheetSync,
    ) -> None:
        """When all tabs fail, each still has rows/headers keys."""
        with patch.object(
            sync, "_read_sheet",
            side_effect=URLError("Network down"),
        ):
            result = sync.pull_all_tabs()

        for tab in ALL_TABS:
            assert result[tab] == {"rows": [], "headers": []}


# ===================================================================
# Thread safety
# ===================================================================


class TestThreadSafety:
    def test_pull_all_tabs_uses_lock(self, sync: SheetSync) -> None:
        """pull_all_tabs acquires self._lock (public method)."""
        with (
            patch.object(sync, "_lock") as mock_lock,
            patch.object(sync, "_read_sheet") as mock_read,
        ):
            mock_read.return_value = ([], None)
            sync.pull_all_tabs()

        mock_lock.__enter__.assert_called_once()
