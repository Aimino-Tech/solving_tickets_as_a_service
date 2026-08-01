# STAS MCP — End-to-End Smoke Test

## Purpose

Verify the full MCP distribution chain works from a clean machine:
npm install → server launch → tool discovery → tool execution.

## Prerequisites

- Node.js >= 18 (for npm/npx)
- Python >= 3.10 (for the MCP server)
- Internet access to npm registry
- A GitHub personal access token with `repo` scope (for `syntaro_label_issue` / `syntaro_run_fix`)

## Test 1: npm Package Install

**Objective**: Package installs without errors.

```bash
cd $(mktemp -d)
npm init -y
npm install @aimino/syntaro-mcp
```

**Expected**: Exit code 0, no warnings. **Timing**: < 10s

**Verification**: `ls node_modules/@aimino/syntaro-mcp/` should show `index.js` and `package.json`.

## Test 2: Stdio Transport

**Objective**: MCP server launches and responds to `initialize` request.

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}' | npx -y @aimino/syntaro-mcp stdio
```

**Expected**: JSON-RPC response with `result.serverInfo.name`. **Timing**: < 5s

## Test 3: Tool Discovery (list_tools)

```bash
echo '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | npx -y @aimino/syntaro-mcp stdio | head -c 2000
```

**Expected**: Response contains `syntaro_label_issue`, `syntaro_run_fix`, `syntaro_check_status`, `syntaro_get_pr`, `list_issues`, `search_codebase`. **Timing**: < 3s

## Test 4: SSE Transport

```bash
npx -y @aimino/syntaro-mcp sse &
sleep 2
curl -N http://localhost:4095/sse
```

**Expected**: SSE connection established, server sends endpoint event. **Timing**: < 5s

## Test 5: Streamable HTTP Transport

```bash
npx -y @aimino/syntaro-mcp streamable-http &
sleep 2
curl -X POST http://localhost:4095/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

**Expected**: JSON-RPC response with tool list. **Timing**: < 5s

## Test 6: Claude Desktop Discovery

1. Install the package: `npm install -g @aimino/syntaro-mcp`
2. Add to Claude Desktop config:
   ```json
   {
     "mcpServers": {
       "stas": {
         "command": "npx",
         "args": ["-y", "@aimino/syntaro-mcp", "stdio"]
       }
     }
   }
   ```
3. Restart Claude Desktop
4. Verify: Claude shows stas tools in the MCP tool list

## Test 7: OpenCode Discovery

1. Add to OpenCode config (`opencode.json`):
   ```json
   {
     "mcpServers": {
       "stas": {
         "command": "npx",
         "args": ["-y", "@aimino/syntaro-mcp", "stdio"]
       }
     }
   }
   ```
2. Restart OpenCode
3. Verify: `/mcp` command shows stas tools

## Success Criteria

- [ ] Test 1 passes: npm install succeeds
- [ ] Test 2 passes: stdio transport responds
- [ ] Test 3 passes: all tools discoverable
- [ ] Test 4 passes: SSE transport works
- [ ] Test 5 passes: Streamable HTTP transport works
- [ ] Test 6 passes: Claude Desktop discovers stas tools
- [ ] Test 7 passes: OpenCode discovers stas tools
