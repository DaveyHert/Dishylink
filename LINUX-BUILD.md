# Linux desktop build

Dishylink already contains an Electron desktop application and supports Linux at runtime. This repository adds a native Debian package target.

## Ubuntu 26.04 / Debian-family systems

Requirements:

- Node.js 22
- npm
- Internet access for `npm ci`

Build the package:

```bash
npm ci
npm run pack:linux
```

The resulting package is written to `release/`:

```text
Dishylink-1.2.0-x64.deb
```

Install it with:

```bash
sudo apt install ./release/Dishylink-1.2.0-x64.deb
```

The application appears in the GNOME application launcher as **Dishylink**. It can also be started from a terminal with:

```bash
dishylink
```

The package is intended for x86-64 Ubuntu/Debian systems. The electron-builder configuration also declares an arm64 target for ARM64 Linux releases.

## GitHub Actions

The added `Linux desktop package` workflow can build the `.deb` on GitHub's Ubuntu runner. Run it manually from the Actions tab or push a `v*` tag.

## Ubuntu 26.04 desktop package

The Linux build is a native Debian package for Ubuntu 26.04 and GNOME. It installs
Dishylink into `/opt/Dishylink`, adds a normal GNOME application entry, and installs
an XDG autostart entry so the recorder starts in the background when you log in.
The existing Electron tray remains active after the main window is closed.

### Installing

The downloaded `.deb` can be opened from Files and installed with **App Center** or
another Debian package handler. It can also be installed with `apt` if desired.

### Updates

Linux releases publish both `.deb` packages and a `SHA256SUMS` file. Dishylink checks
GitHub Releases every six hours, downloads a matching x64/arm64 package in the
background, verifies its SHA-256 checksum, and offers the update from the application.
Installation uses Ubuntu's PolicyKit (`pkexec`) so the normal administrator password
prompt is shown rather than running the application as root.
