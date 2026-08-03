from django.urls import path

from . import views

urlpatterns = [
    path("github", views.github_webhook, name="webhook-github"),
    path("gitlab", views.gitlab_webhook, name="webhook-gitlab"),
    path("bitbucket", views.bitbucket_webhook, name="webhook-bitbucket"),
    path("linear", views.linear_webhook, name="webhook-linear"),
    path("jira", views.jira_webhook, name="webhook-jira"),
    path("stripe", views.stripe_webhook, name="webhook-stripe"),
    path("slack", views.slack_webhook, name="webhook-slack"),
]
