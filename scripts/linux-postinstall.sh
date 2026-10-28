#!/bin/sh
set -eu

# Keep the standard electron-builder Debian setup that a custom afterInstall
# script otherwise replaces. In particular, Ubuntu 24.04+ restricts user
# namespaces for unprofiled applications, so the bundled AppArmor profile must
# be installed before Chromium starts.
if command -v update-alternatives >/dev/null 2>&1; then
    if [ -L /usr/bin/dishylink ] && [ -e /usr/bin/dishylink ] &&
       [ "$(readlink /usr/bin/dishylink)" != /etc/alternatives/dishylink ]; then
        rm -f /usr/bin/dishylink
    fi
    update-alternatives --install /usr/bin/dishylink dishylink /opt/Dishylink/dishylink 100 ||
        ln -sf /opt/Dishylink/dishylink /usr/bin/dishylink
else
    ln -sf /opt/Dishylink/dishylink /usr/bin/dishylink
fi

if ! { [ -L /proc/self/ns/user ] && unshare --user true >/dev/null 2>&1; }; then
    chmod 4755 /opt/Dishylink/chrome-sandbox || true
else
    chmod 0755 /opt/Dishylink/chrome-sandbox || true
fi

if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime || true
fi

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications || true
fi

APPARMOR_PROFILE_SOURCE=/opt/Dishylink/resources/apparmor-profile
APPARMOR_PROFILE_TARGET=/etc/apparmor.d/dishylink
if command -v apparmor_status >/dev/null 2>&1 && apparmor_status --enabled >/dev/null 2>&1 &&
   command -v apparmor_parser >/dev/null 2>&1 &&
   apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" >/dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"
    if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; }; then
        apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
else
    echo "Skipping the installation of the AppArmor profile as this system does not support it"
fi

# Ubuntu/GNOME launches Dishylink in the background at login. Electron's
# app.setLoginItemSettings() is not a reliable Linux primitive, so the Debian
# package owns the XDG autostart entry instead.
AUTOSTART_DIR="/etc/xdg/autostart"
mkdir -p "$AUTOSTART_DIR"
cat > "$AUTOSTART_DIR/dishylink.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Dishylink
Comment=Starlink network monitoring and control
Exec=/opt/Dishylink/dishylink --hidden
Terminal=false
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Notify=true
DESKTOP
chmod 644 "$AUTOSTART_DIR/dishylink.desktop"

# Refresh desktop metadata when the helper exists. Failure is harmless.
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database /usr/share/applications || true
exit 0
