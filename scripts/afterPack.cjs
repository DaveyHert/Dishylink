// Ad-hoc sign the packaged macOS app so it can post notifications.
//
// macOS emits notifications only from a code-signed app whose signing identifier
// matches its bundle id; an unsigned Electron build fails the notification call
// outright. electron-builder without a certificate leaves the prebuilt Electron
// framework's own "Electron" identifier in place, so the app registers under
// "Electron" (or not at all) and never appears in System Settings as itself.
//
// Ad-hoc signing (`codesign -s -`) is free, needs no Apple account, and rewrites
// the identifier to the bundle id — enough for notifications on this machine.
// Developer ID signing is a separate, distribution-only concern (Gatekeeper /
// notarization for handing the app to other people), added later.
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
