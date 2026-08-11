# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue. Use
the **Report a vulnerability** button on this repository's
[Security tab](https://github.com/DaveyHert/Dishylink/security/advisories/new),
which opens a private thread visible only to you and the maintainer. If you
would rather use email, **hello@dishylink.com** reaches the same place.

Include what you found, how to reproduce it, which platform you were on, and the
version of Dishylink you were running.

Reports are read and answered on a best effort basis by a single maintainer.
Please allow a reasonable window for a fix before sharing details publicly.

## Supported versions

Fixes land in the latest published release. Older releases are not patched, so
updating is the way to pick up a fix.

## Scope

In scope:

- The desktop app (macOS and Windows builds)
- The browser extension
- The history recorder that runs in the background
- How the app handles your Starlink account session, and anything it writes to
  local storage or to disk

Out of scope:

- Vulnerabilities in Starlink hardware, in dish or router firmware, or in
  `starlink.com` itself. Those belong to SpaceX and should go through SpaceX's
  own reporting channels.
- Anything that requires an attacker to already have full access to your machine
  or browser profile. [PRIVACY.md](PRIVACY.md) documents what is stored locally
  and how.

## Testing

Test against hardware you own. Dishylink talks to a dish and router on your own
network, and the router is a small embedded device that has been observed
rebooting under ordinary polling load. Please do not fuzz or stress its
endpoints. A crashed router takes the whole connection down with it, and that on
its own is not a finding.
