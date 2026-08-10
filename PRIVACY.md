# Privacy Policy

Dishylink is an open-source app that monitors the performance and health of
your Starlink. This page describes what the app does with your data.

## What stays on your machine

Dishylink talks directly to your dish and router over your own LAN, including
while its window is closed. Everything it measures — throughput, latency,
power draw, obstruction, outages, thermal events, radio temps, device lists —
is written to local storage on your machine and is never transmitted
anywhere. There is no backend, no analytics, and no telemetry collection by
us. We do not see your data; we never receive it.

## The optional "connect account" feature

If you choose to sign in with your own Starlink account (the "Cloud account"
tab), the app opens a Starlink login window and keeps the resulting session
on your device only:

- On desktop, the session is stored in your app's local data directory,
  encrypted with your OS's keychain where available.
- In the browser extension, the session is stored in the extension's own
  storage area, inside your browser profile. No website and no other
  extension can read it. It is not encrypted at rest, so anything with
  access to your browser profile on disk could.
- The session is used solely to read your own plan, billing, and usage data
  directly from `starlink.com` on your behalf, in response to your own
  requests.
- It is never sent to us or to any third party — we have no server that
  could receive it. Disconnecting the account clears the stored session.
  In the extension, disconnecting clears only Dishylink's copy — your own
  starlink.com login in the browser is left signed in.

This feature is entirely opt-in. If you never sign in, no Starlink account
session is created or stored.

## Third parties

The one exception to "never leaves your machine": the in-app speed test
measures your connection against Cloudflare's public speed-test
infrastructure, the same way any browser-based speed test does. That request
carries no personal data beyond what any internet connection to Cloudflare
already involves.

## Open source

Dishylink's source is public, so you can verify all of the above yourself —
see the repository this file lives in.

## Changes

If a future feature changes what leaves your machine, this document will be
updated before that feature ships, and any such feature will require its own
explicit opt-in.

## Contact

Questions about this policy: hello@dishylink.com
