#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CODEQL_DIR="${REPO_ROOT}/.codeql"
CODEQL_BIN="${CODEQL_DIR}/codeql/codeql"
CODEQL_VERSION="v2.20.1"
info()  { printf "\033[36m[codeql-init]\033[0m %s\n" "$*"; }
ok()    { printf "\033[32m[  OK]\033[0m %s\n" "$*"; }
err()   { printf "\033[31m[FAIL]\033[0m %s\n" "$*" >&2; }
check_codeql() {
  if command -v codeql &>/dev/null; then ok "Found in PATH: $(command -v codeql)"; codeql version; return 0; fi
  if [ -x "$CODEQL_BIN" ]; then ok "Found at: $CODEQL_BIN"; "$CODEQL_BIN" version; return 0; fi
  err "CodeQL not found"; return 1
}
install_codeql() {
  local p; case $(uname -s) in Linux) p=linux64 ;; Darwin) p=osx64 ;; *) err "Unsupported OS"; return 1 ;; esac
  local b="codeql-bundle-${p}.tar.gz"
  local u="https://github.com/github/codeql-action/releases/download/${CODEQL_VERSION}/${b}"
  mkdir -p "$CODEQL_DIR"
  curl -fsSL "$u" -o "${CODEQL_DIR}/${b}"
  tar -xzf "${CODEQL_DIR}/${b}" -C "$CODEQL_DIR"
  rm "${CODEQL_DIR}/${b}"
  ok "Installed at: $CODEQL_BIN"
  "$CODEQL_BIN" version
}
main() { case "${1:-}" in --check|-c) check_codeql ;; *) check_codeql || install_codeql ;; esac; }
main "$@"
