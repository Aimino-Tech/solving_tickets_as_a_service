"""
Tests for guardrail memory_service module.
"""
import os
import sys
import tempfile

_test_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.abspath(os.path.join(_test_dir, "..", "..", ".."))
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from guardrail import memory_service


def test_store_and_retrieve():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        memory_service.init_db(db_path)
        memory_service.store("test-key", "test-value", db_path=db_path)
        results = memory_service.retrieve("test-key", db_path=db_path)
        assert len(results) == 1
        assert results[0]["key"] == "test-key"
        assert results[0]["value"] == "test-value"
    finally:
        os.unlink(db_path)


def test_store_with_metadata():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        memory_service.init_db(db_path)
        memory_service.store(
            "key1",
            "val1",
            guardrail="slop-detector",
            model="deepseek-reasoner",
            metadata={"score": 0.85},
            db_path=db_path,
        )
        results = memory_service.retrieve("key1", db_path=db_path)
        assert len(results) == 1
        assert results[0]["guardrail"] == "slop-detector"
        assert results[0]["model"] == "deepseek-reasoner"
    finally:
        os.unlink(db_path)


def test_retrieve_limit():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        memory_service.init_db(db_path)
        for i in range(5):
            memory_service.store("dup-key", f"val-{i}", db_path=db_path)
        results = memory_service.retrieve("dup-key", limit=2, db_path=db_path)
        assert len(results) == 2
    finally:
        os.unlink(db_path)


def test_query_filter():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        memory_service.init_db(db_path)
        memory_service.store("k1", "v1", guardrail="g1", db_path=db_path)
        memory_service.store("k2", "v2", guardrail="g2", db_path=db_path)
        g1_results = memory_service.query(guardrail="g1", db_path=db_path)
        assert len(g1_results) == 1
        assert g1_results[0]["key"] == "k1"
    finally:
        os.unlink(db_path)


def test_query_model_filter():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        memory_service.init_db(db_path)
        memory_service.store("k1", "v1", model="m1", db_path=db_path)
        memory_service.store("k2", "v2", model="m2", db_path=db_path)
        m1_results = memory_service.query(model="m1", db_path=db_path)
        assert len(m1_results) == 1
    finally:
        os.unlink(db_path)


def test_query_pagination():
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        memory_service.init_db(db_path)
        for i in range(10):
            memory_service.store(f"k{i}", f"v{i}", db_path=db_path)
        page = memory_service.query(limit=3, offset=0, db_path=db_path)
        assert len(page) == 3
    finally:
        os.unlink(db_path)


def test_env_var_overrides_path():
    import os as _os
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        env_path = f.name
    try:
        _os.environ["GUARDRAIL_MEMORY_DB_PATH"] = env_path
        memory_service.init_db()
        memory_service.store("env-key", "env-val")
        results = memory_service.retrieve("env-key")
        assert len(results) >= 1
        del _os.environ["GUARDRAIL_MEMORY_DB_PATH"]
    finally:
        _os.unlink(env_path)
