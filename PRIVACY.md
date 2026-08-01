# Privacy Policy

DishyLink is a local dashboard and history recorder for a Starlink kit. This
page describes what the app does with data today, not what a future feature
might do.

## What stays on your machine

The dashboard and the always-on history recorder (the "historian") talk
directly to your dish and router over your own LAN. Everything they record —
throughput, latency, power draw, obstruction, outages, thermal events, radio
temps, device lists — is written to local storage on your machine and is
never transmitted anywhere. There is no backend, no analytics, and no
telemetry collection by us. We do not see your data; we never receive it.

## The optional "connect account" feature

If you choose to sign in with your own Starlink account (the "Cloud account"
tab), the app opens a Starlink login window and keeps the resulting session
on your device only:

- On desktop, the session is stored in your app's local data directory,
  encrypted with your OS's keychain where available.
- The session is used solely to read your own plan, billing, and usage data
  directly from `starlink.com` on your behalf, in response to your own
  requests.
- It is never sent to us or to any third party — we have no server that
  could receive it. Disconnecting the account clears the stored session.

This feature is entirely opt-in. If you never sign in, no Starlink account
session is created or stored.

## Third parties

The one exception to "never leaves your machine": the in-app speed test
measures your connection against Cloudflare's public speed-test
infrastructure, the same way any browser-based speed test does. That request
carries no personal data beyond what any internet connection to Cloudflare
already involves.

## Open source

DishyLink's source is public, so you can verify all of the above yourself —
see the repository this file lives in.

## Changes

If a future feature changes what leaves your machine (for example, a
possible opt-in, anonymized congestion map), this document will be updated
before that feature ships, and any such feature will require its own
explicit opt-in.

## Contact

Questions about this policy: hello@daveyhert.com
