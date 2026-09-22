# openfox-devserver-status

Passive dev-server status indicators for OpenFox session rows.

This plugin replaces feature-specific sidebar code with the OpenFox Plugin API:
OpenFox exposes generic hooks and a dynamic badge surface; the plugin owns all
dev-server status state, presentation and polling decisions.

## What it shows

- **green** — dev server running
- **amber** — dev server warning
- **red** — dev server error
- **nothing** — server off or no state known

The indicator is passive and compact. Hovering it exposes the current URL or
error detail when available.

## Requirements

The complete implementation relies on two generic OpenFox extension points:

1. **Dynamic session-row badges** — RPC badge results may control visibility,
   tone, tooltip and icon, with optional refresh and workdir-scoped caching.
   This is carried by upstream PR **co-l/openfox#374**.
2. **Dev-server plugin hooks** — `devserver.started`, `devserver.stopped` and
   `devserver.state.changed`.
   These are carried by upstream PR **co-l/openfox#370**.

Until those changes are released by OpenFox, install the plugin only on a build
that contains both extension points.

## Install

In OpenFox:

1. Open **Settings → Plugins**.
2. Install from:
   `https://github.com/theshwal/openfox-devserver-status`
3. Enable **Dev Server Status**.

No project configuration is required.

## Architecture

The plugin registers one `session.row.badges` contribution. OpenFox passes the
session's effective `workdir` to the badge RPC. The plugin keeps a small
workdir-keyed state map updated by dev-server lifecycle/state hooks.

The badge RPC is intentionally cheap: it only reads that in-memory map. OpenFox
refreshes it every two seconds and de-duplicates calls by workdir, so sessions
sharing the same workspace do not multiply the underlying lookup.

State is persisted only for the lifetime of the current OpenFox process. This
allows disable/re-enable without losing a running status while preventing stale
"running" state from surviving an OpenFox restart.

## Scope

The plugin does **not**:

- start or stop dev servers;
- modify `.openfox/dev.json`;
- import OpenFox private internals;
- patch React components;
- open its own sockets or polling process.

Its only capabilities are `ui`, `hooks` and `rpc`.

## Development

```bash
npm install
npm test
```

The test suite covers registration, running/off/warning/error mapping and
same-process state restoration.
