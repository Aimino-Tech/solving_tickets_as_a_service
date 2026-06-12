# GitLab — Fix Broken .gitlab-ci.yml

## Description

A GitLab project has a malformed `.gitlab-ci.yml` that causes the CI pipeline
to fail at the validation stage. The issue reports "Jobs:stages config should
implement a script: or a trigger: keyword".

## Setup

1. A GitLab project at `https://gitlab.example.com/infra/terraform-modules`
2. Project has a `.gitlab-ci.yml` with a job configuration error (stage without
   `script` or `trigger` keyword)
3. CI pipeline fails immediately with a YAML validation error

## Expected Outcome

- Agent investigates the issue
- Agent fixes the `.gitlab-ci.yml` to pass GitLab CI validation
- Agent pushes a branch and creates a Merge Request
- MR description explains the YAML fix
- After merge, the CI pipeline passes validation

## Verification

1. The fixed `.gitlab-ci.yml` should pass `gitlab-ci-local --list` validation
2. The pipeline should not fail on syntax or keyword validation
3. A regression test is optional for this type of fix
4. The MR should be created via the GitLab API
