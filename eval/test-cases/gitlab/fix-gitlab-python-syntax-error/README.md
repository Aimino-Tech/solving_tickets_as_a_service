# GitLab — Fix Python Syntax Error

## Description

A self-hosted GitLab project has a Python script with a syntax error. The issue
reports that the CI pipeline always fails with a `SyntaxError`.

## Setup

1. A GitLab project at `https://gitlab.example.com/devops/python-tools`
2. Project has a `.gitlab-ci.yml` that runs `python src/tools.py`
3. `src/tools.py` contains a `SyntaxError: invalid syntax` on the last line

## Expected Outcome

- Agent investigates the issue
- Agent fixes the syntax error in `src/tools.py`
- Agent pushes a branch and creates a Merge Request
- MR description references the issue
- After merge, the CI pipeline passes

## Verification

1. The fix should correct the syntax error without changing the file's logic
2. A regression test (e.g., `tests/test_tools.py`) should be added
3. The `.gitlab-ci.yml` should remain unchanged unless necessary
4. The MR should be created via the GitLab API (POST /projects/{id}/merge_requests)
