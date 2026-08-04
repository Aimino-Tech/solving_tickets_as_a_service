import json, logging, os
from typing import Any, Optional
logger = logging.getLogger(__name__)
def load_registry(path: Optional[str] = None) -> dict[str, Any]:
    if path is None: path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "syntaro-registry.json")
    try:
        with open(path) as f: return json.load(f)
    except Exception as e: logger.warning("Failed to load registry: %s", e); return {}
def get_capability_manifest() -> dict[str, Any]:
    r = load_registry()
    return {"protocol_version": r.get("registry_version","1.0.0"), "capabilities": [{"name":c["name"],"description":c["description"],"scope":c.get("scope","read")} for c in r.get("capabilities",[])]}
