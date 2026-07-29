import logging
import os


_LOG_FORMAT = os.environ.get("GUARDRAIL_LOG_FORMAT", "text").lower()

_JSON_AVAILABLE = False
try:
    from pythonjsonlogger import jsonlogger
    _JSON_AVAILABLE = True
except ImportError:
    pass


def configure_guardrail_logging() -> None:
    root = logging.getLogger("guardrail")
    if root.handlers:
        return
    handler = logging.StreamHandler()
    if _LOG_FORMAT == "json" and _JSON_AVAILABLE:
        formatter = jsonlogger.JsonFormatter(
            fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
            timestamp=True,
        )
    else:
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
        )
    handler.setFormatter(formatter)
    root.addHandler(handler)
    root.setLevel(logging.INFO)
