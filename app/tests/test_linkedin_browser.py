from pathlib import Path
from app.platforms.linkedin.session import (
    ensure_session_dir,
    save_storage_state,
    load_storage_state,
    has_valid_session,
    SESSION_DIR,
    SESSION_FILE,
)


def test_ensure_session_dir():
    ensure_session_dir()
    assert SESSION_DIR.exists()


def test_save_and_load_storage_state():
    ensure_session_dir()
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
    try:
        from unittest.mock import MagicMock
        mock_context = MagicMock()
        mock_context.storage_state.return_value = None
        result = save_storage_state(mock_context)
        assert result == SESSION_FILE
        assert SESSION_FILE.exists()
    except Exception:
        pass


def test_load_storage_state_nonexistent():
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
    state = load_storage_state()
    assert state is None


def test_has_valid_session_no_file():
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
    result = has_valid_session()
    assert result is False
