from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="api-health"),
    path("runs", views.agent_runs, name="api-agent-runs"),
    path("v1/dispatch", views.dispatch, name="api-dispatch"),
]
