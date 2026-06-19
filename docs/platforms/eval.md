# Eval on Any Platform

The STAS 3-tier eval strategy translates to each platform differently.

## Tier Translation

| Tier | GitHub | GitLab | Bitbucket |
|------|--------|--------|-----------|
| Smoke (push) | `on: [push]` | `rules: - if: $CI_PIPELINE_SOURCE == "push"` | Triggers on push by default |
| Standard (PR) | `on: [pull_request]` | `rules: - if: $CI_PIPELINE_SOURCE == "merge_request_event"` | Triggers on PR webhook |
| Full (nightly) | `on: schedule: - cron: '0 6 * * *'` | `rules: - if: $CI_PIPELINE_SOURCE == "schedule"` | `custom: schedules:` |

## GitLab CI Schedules

```yaml
# .gitlab-ci.yml (eval-full equivalent)
stas-eval-nightly:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - npx promptfoo eval --config eval/promptfooconfig.yaml --output eval/results/nightly.json
```

## Bitbucket Pipelines Schedules

```yaml
# bitbucket-pipelines.yml
custom:
  stas-eval-nightly:
    schedule:
      - cron: '0 6 * * *'
    steps:
      - step:
          script:
            - npx promptfoo eval --config eval/promptfooconfig.yaml --output eval/results/nightly.json
```

## Interpreting Results

When the target platform is not GitHub, eval results indicate:

- Pass = the agent created a merge request / pull request on the correct platform
- Fail = the agent failed to interact with the platform API
- Partial = the agent investigated but couldn't create a PR/MR

The `platform` field in eval results indicates which platform was targeted.
