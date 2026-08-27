# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Live dashboard plus an always-on recorder (the "historian") for a Starlink kit. The dev machine
is on the Starlink network itself — changes are verified against real hardware.

## Hardware safety — read before touching anything router-facing

- **NEVER call or poll the router's `get_ping` (field 1009), at any cadence.** Trialled three
  times on 2026-07-20 (2s, 5s, and 30s); each trial was followed within ~15 minutes by a router
  watchdog reboot that took the network down. Router ping success comes from `get_status`'s
  `popPingDropRate5m` (lowercase trailing `m`), which rides a reply we already fetch.
- `wifi_get_ping_metrics` (3007) and `set_config` answer PERMISSION_DENIED to anonymous LAN
  clients on current firmware. The official app gets its cloud data through an authenticated
  `api.starlink.com` session, not the LAN.
- The router is a small embedded box and has rebooted under ordinary load: **never add a new
  poll against it without explicit approval.** Reuse replies already being fetched —
  `routerStatusFeed` in the browser, the 5s status poll in the recorder.

## CI

CI runs `npm run typecheck`, `npm run lint`, `npm test`, and a prettier check. The format job
checks only changed files, so a full-tree `prettier --check` reports a pre-existing backlog that
is not yours. Tests that open a socket behave differently on the Linux runner than on macOS, so
a green local run is not a guaranteed green CI run.

## Process facts

- The historian (`collector/historian.mts`) is the always-on recording service, run by launchd as
  `com.dishylink.historian`. Edits under `collector/` need
  `launchctl kickstart -k gui/$UID/com.dishylink.historian` to take effect; `tsc` and `vitest`
  pass without it. Its recordings live in `collector/data`.
- "Historian" is the component's name in code, service, and docs. User-facing copy stays plain
  English — "history recorder" or "recording" — because UI readers aren't assumed to know the
  industrial term.
- The pasted starlink.com session lives in `.starlink-cookie` at the repo root (written by
  `dev/starlinkCloudProxy.ts`). It is a live credential: never print it, never commit it.
