"""
Django settings for STAS project.

Uses environment variables for all configuration, matching the existing
.env format used by the Express version.
"""
import os
from pathlib import Path

import dotenv

# Build paths
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from project root (one level up from stas_project/)
dotenv.load_dotenv(BASE_DIR.parent / ".env")

# ── Security ──────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv(
    "DJANGO_SECRET_KEY",
    "django-insecure-change-me-in-production-stas-local-dev-key",
)
DEBUG = os.getenv("DJANGO_DEBUG", str(os.getenv("NODE_ENV", "development") != "production")).lower() in ("true", "1", "yes")
ALLOWED_HOSTS = os.getenv("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0").split(",")

# ── Installed Apps ─────────────────────────────────────────────────────────
DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS: list[str] = []

LOCAL_APPS = [
    "webhooks",
    "agents",
    "billing",
    "api",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# ── Middleware ─────────────────────────────────────────────────────────────
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "stas.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "stas.wsgi.application"

# ── Database ───────────────────────────────────────────────────────────────
# Uses the same DATABASE_URL as the Express version
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://localhost:5432/stas")

import re  # noqa: E402

_db_match = re.match(
    r"postgres(?:ql)?://"
    r"(?:(?P<user>[^:]+)(?::(?P<pass>[^@]+))?@)?"
    r"(?P<host>[^:/]+)"
    r"(?::(?P<port>\d+))?"
    r"/(?P<db>.+?)(?:\?.*)?$",
    DATABASE_URL,
)
if _db_match:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": _db_match.group("db") or "stas",
            "USER": _db_match.group("user") or os.environ.get("USER", "postgres"),
            "PASSWORD": _db_match.group("pass") or "",
            "HOST": _db_match.group("host") or "localhost",
            "PORT": _db_match.group("port") or "5432",
        }
    }
else:
    # Fallback: use individual PG env vars or SQLite for dev
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# ── Password validation ───────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ── Internationalization ───────────────────────────────────────────────────
LANGUAGE_CODE = "en-us"
TIME_ZONE = os.getenv("TZ", "UTC")
USE_I18N = True
USE_TZ = True

# ── Static files ───────────────────────────────────────────────────────────
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# ── Celery Configuration ──────────────────────────────────────────────────
# Matches workers/celeryconfig.py and existing .env conventions
CELERY_BROKER_URL = os.getenv(
    "CELERY_BROKER_URL",
    os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672//"),
)
CELERY_RESULT_BACKEND = os.getenv(
    "CELERY_RESULT_BACKEND",
    os.getenv("REDIS_URL", "redis://localhost:6379/0"),
)
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TASK_SOFT_TIME_LIMIT = int(os.getenv("CELERY_TASK_SOFT_TIME_LIMIT", "580"))
CELERY_TASK_HARD_TIME_LIMIT = int(os.getenv("CELERY_TASK_HARD_TIME_LIMIT", "600"))
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_DEFAULT_QUEUE = "stas.agents.default"
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_SEND_SENT_EVENT = True

# ── Queue routing ─────────────────────────────────────────────────────────
from kombu import Exchange, Queue  # noqa: E402

CELERY_TASK_QUEUES = [
    Queue("stas.agents.triage", Exchange("stas"), routing_key="stas.agents.triage"),
    Queue("stas.agents.dispatch", Exchange("stas"), routing_key="stas.agents.dispatch"),
    Queue("stas.agents.sandbox", Exchange("stas"), routing_key="stas.agents.sandbox"),
    Queue("stas.agents.verification", Exchange("stas"), routing_key="stas.agents.verification"),
    Queue("stas.agents.pr_creation", Exchange("stas"), routing_key="stas.agents.pr_creation"),
    Queue("stas.agents.notifications", Exchange("stas"), routing_key="stas.agents.notifications"),
    Queue("stas.agents.default", Exchange("stas"), routing_key="stas.agents.default"),
]

CELERY_TASK_ROUTES = {
    "workers.tasks.triage.*": {"queue": "stas.agents.triage"},
    "workers.tasks.agent.*": {"queue": "stas.agents.dispatch"},
    "workers.tasks.sandbox.*": {"queue": "stas.agents.sandbox"},
    "workers.tasks.verification.*": {"queue": "stas.agents.verification"},
    "workers.tasks.pr_creation.*": {"queue": "stas.agents.pr_creation"},
    "workers.tasks.notifications.*": {"queue": "stas.agents.notifications"},
    "agents.tasks.*": {"queue": "stas.agents.default"},
}

# ── STAS Custom Settings ──────────────────────────────────────────────────
STAS_LABEL = os.getenv("STAS_LABEL", "stas:fix")
BOT_NAME = os.getenv("BOT_NAME", "STAS")
MAX_AGENT_ITERATIONS = int(os.getenv("MAX_AGENT_ITERATIONS", "40"))
MAX_ISSUE_COMMENTS = int(os.getenv("MAX_ISSUE_COMMENTS", "15"))
OPENCODE_URL = os.getenv("OPENCODE_URL", "http://localhost:4096")
OPENCODE_MODEL = os.getenv("OPENCODE_MODEL", "anthropic/claude-sonnet-4-20250514")
FALLBACK_MODELS = os.getenv("FALLBACK_MODELS", "gpt-4o,claude-haiku")

# ── OpenCode / Agent Settings ─────────────────────────────────────────────
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_CHEAP_MODEL = os.getenv("OPENAI_CHEAP_MODEL", "gpt-4o-mini")

# ── E2B Sandbox ───────────────────────────────────────────────────────────
E2B_API_KEY = os.getenv("E2B_API_KEY", "")
E2B_TEMPLATE_ID = os.getenv("E2B_TEMPLATE_ID", "stas-default")
E2B_SANDBOX_TIMEOUT_MS = int(os.getenv("E2B_SANDBOX_TIMEOUT_MS", "300000"))

# ── Stripe ─────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")

# ── Slack ──────────────────────────────────────────────────────────────────
SLACK_WEBHOOK_URL = os.getenv("SLACK_WEBHOOK_URL", "")
SLACK_BOT_TOKEN = os.getenv("SLACK_BOT_TOKEN", "")
SLACK_SIGNING_SECRET = os.getenv("SLACK_SIGNING_SECRET", "")

# ── GitHub App ─────────────────────────────────────────────────────────────
GITHUB_APP_ID = os.getenv("GITHUB_APP_ID", "")
GITHUB_APP_PRIVATE_KEY_PATH = os.getenv("GITHUB_APP_PRIVATE_KEY_PATH", "")
GITHUB_APP_PRIVATE_KEY = os.getenv("GITHUB_APP_PRIVATE_KEY", "")
GITHUB_WEBHOOK_SECRET = os.getenv("GITHUB_WEBHOOK_SECRET", "")

# ── Default primary key field type ─────────────────────────────────────────
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
