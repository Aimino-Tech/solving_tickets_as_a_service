---
name: publish-mcp
description: Publish an MCP server to public registries. Triggered by "/publish-mcp <repo> <version>" or "/publish <repo> <version>". Handles the full release pipeline (cargo, npm, PyPI/uv, GitHub Release).
metadata:
  version: 1.0.0
---

# Skill: publish-mcp

When the user types `/publish-mcp <repo> <version>` or `/publish <repo> <version>`, execute the public release pipeline:

## Supported registries
- **crates.io** — `cargo publish` for Rust crates
- **npm** — `npm publish` for Node.js packages
- **PyPI via uv** — `uv publish` for Python packages
- **GitHub Releases** — pre-built binaries

## Workflow
1. Validate the version string (semver)
2. Check if the repo exists and has proper Cargo.toml / package.json / pyproject.toml
3. Run the release pipeline sequentially for each registry
4. Report results back to the user

## Repos
- `Aimino-Tech/office-oxide-mcp` — cargo + npm + PyPI
- `Aimino-Tech/OpenTalk2HTML-NotMD` — npm only (formerly fast-html-mcp-server)

## Usage
- `/publish-mcp office-oxide-mcp 0.2.0` — publish version 0.2.0
- `/publish-mcp OpenTalk2HTML-NotMD 0.2.0` — publish npm package
- `/publish-mcp opentalk2html-notmd 0.2.0` — alias (lowercase)
