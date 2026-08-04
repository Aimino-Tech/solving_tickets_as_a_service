# @tarquinen/syntaro-plugin

**OpenCode plugin for [SYNTARO](https://github.com/tamnguyen08/solving_tickets_as_a_service)**

Provides local development tools for operating and testing the SYNTARO GitHub bot directly from within OpenCode.

## Installation

Add the plugin to your `opencode.json`:

```json
{
  "plugin": ["@tarquinen/syntaro-plugin"]
}
```

Or install from npm:

```bash
npm install @tarquinen/syntaro-plugin
```

Once loaded, the plugin exposes 4 tools that the OpenCode agent can invoke during development.

## Available Tools

### `syntaro_webhook_test`

Send a test webhook event to a running SYNTARO bot.

| Argument | Type | Default | Description |
|---|---|---|---|
| `event` | `string` | `"issues.labeled"` | GitHub webhook event type |
| `payloadFile` | `string?` | — | Path to JSON payload file |
| `syntaroUrl` | `string?` | `"http://localhost:3000"` | SYNTARO bot URL override |

```bash
# Agent can call:
syntaro_webhook_test event="issues.labeled"
syntaro_webhook_test event="issues.opened" syntaroUrl="http://localhost:3000"
```

### `syntaro_config_validate`

Validate or initialize the SYNTARO `.env` configuration.

| Argument | Type | Default | Description |
|---|---|---|---|
| `mode` | `string` | `"check"` | `"check"` to validate, `"init"` to create `.env` from template |
| `envFile` | `string?` | — | Override path to `.env` file |

```bash
# Agent can call:
syntaro_config_validate mode="check"
syntaro_config_validate mode="init"
```

### `syntaro_status`

Check if SYNTARO bot and OpenCode serve are running and healthy.

| Argument | Type | Default | Description |
|---|---|---|---|
| `syntaroUrl` | `string?` | `"http://localhost:3000"` | SYNTARO bot URL override |
| `opencodeUrl` | `string?` | `"http://localhost:4096"` | OpenCode serve URL override |

```bash
# Agent can call:
syntaro_status
syntaro_status syntaroUrl="http://localhost:3001"
```

### `syntaro_dev_start`

Start the local development environment.

| Argument | Type | Default | Description |
|---|---|---|---|
| `mode` | `string` | `"full"` | `"full"` (both), `"bot-only"`, or `"opencode-only"` |
| `opencodePort` | `string?` | `"4096"` | OpenCode serve port override |
| `syntaroPort` | `string?` | `"3000"` | SYNTARO bot port override |

```bash
# Agent can call:
syntaro_dev_start mode="full"
syntaro_dev_start mode="bot-only"
```

## Standalone CLI Usage

Each tool backs onto a shell script in `plugin/tools/` that can be used independently of OpenCode:

```bash
# Validate config
bash plugin/tools/syntaro-config.sh check

# Start dev environment
bash plugin/tools/syntaro-dev.sh

# Send test webhook
bash plugin/tools/syntaro-webhook-test.sh issues.labeled

# Check status
bash plugin/tools/syntaro-status.sh
```

Environment variables (`SYNTARO_URL`, `OPENCODE_URL`, `OPENCODE_PORT`, `SYNTARO_PORT`) are respected by both the tools and the plugin.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/tamnguyen08/solving_tickets_as_a_service
cd solving_tickets_as_a_service

# Install plugin dependencies
cd plugin && npm install

# Build the plugin
npm run build

# Watch mode
npm run dev
```

### Testing Plugin Changes Locally

To test local changes without publishing, reference the plugin by path in your `opencode.json`:

```json
{
  "plugin": ["./plugin"]
}
```

This tells OpenCode to load the plugin directly from the local directory.

## Project Structure

```
plugin/
├── src/
│   └── index.ts          # Plugin entry — registers 4 OpenCode tools
├── tools/
│   ├── syntaro-config.sh      # Config validation/init script
│   ├── syntaro-dev.sh         # Dev environment launcher
│   ├── syntaro-status.sh      # Health check script
│   └── syntaro-webhook-test.sh # Webhook simulation script
├── package.json
├── tsconfig.json
└── README.md
```

## Publishing

```bash
cd plugin
npm run build
npm publish
```

The plugin is scoped to `@tarquinen/`. Ensure you have publish access before attempting.

## License

MIT — see the [main repo](https://github.com/tamnguyen08/solving_tickets_as_a_service) for details.
