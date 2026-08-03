"""
STAS URL Configuration.

Routes webhooks, API endpoints, and admin interface.
"""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    # Webhook endpoints (HMAC-verified)
    path("webhook/", include("webhooks.urls")),
    # Admin API
    path("api/", include("api.urls")),
    # Django admin
    path("admin/", admin.site.urls),
]
