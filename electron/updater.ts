import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";

export interface UpdateState {
  available: boolean;
  version: string | null;
  ready: boolean;
  installing: boolean;
}

let state: UpdateState = { available: false, version: null, ready: false, installing: false };
let pendingDeb: string | null = null;
const listeners = new Set<(state: UpdateState) => void>();

function setState(next: UpdateState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

export function updateState(): UpdateState {
  return state;
}

export function onUpdateStateChanged(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const OWNER = "DaveyHert";
const REPO = "dishylink";

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

function newerThanCurrent(version: string): boolean {
  const a = app.getVersion().split(".").map(Number);
  const b = version.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const x = Number.isFinite(a[i]) ? a[i] : 0;
    const y = Number.isFinite(b[i]) ? b[i] : 0;
    if (y !== x) return y > x;
  }
  return false;
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Dishylink/${app.getVersion()}`,
    },
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { headers: { "User-Agent": `Dishylink/${app.getVersion()}` } });
  if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`);
  await pipeline(
    Readable.fromWeb(response.body as unknown as NodeReadableStream),
    createWriteStream(destination),
  );
}

async function verifySha256(file: string, expected: string): Promise<boolean> {
  const data = await readFile(file);
  const actual = createHash("sha256").update(data).digest("hex");
  return actual.toLowerCase() === expected.toLowerCase();
}

async function prepareLinuxUpdate(): Promise<void> {
  const release = await githubJson<GitHubRelease>(
    `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`,
  );
  const version = String(release.tag_name ?? "").replace(/^v/, "");
  if (!version || !newerThanCurrent(version)) {
    setState({ available: false, version: null, ready: false, installing: false });
    return;
  }

  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const debName = `Dishylink-${version}-${arch}.deb`;
  const deb = release.assets?.find((asset) => asset.name === debName);
  const sums = release.assets?.find((asset) => asset.name === "SHA256SUMS");
  if (!deb) throw new Error(`Release ${version} has no ${debName}`);

  const directory = join(tmpdir(), "dishylink-update");
  await mkdir(directory, { recursive: true });
  const debPath = join(directory, debName);
  await downloadFile(deb.browser_download_url, debPath);

  // Releases produced by the supplied GitHub workflow include SHA256SUMS. If an older
  // release has no checksum file, the HTTPS GitHub asset itself still protects transport;
  // current releases are always checksum-verified before installation.
  if (sums) {
    const sumPath = join(directory, "SHA256SUMS");
    await downloadFile(sums.browser_download_url, sumPath);
    const text = await readFile(sumPath, "utf8");
    const line = text.split(/\r?\n/).find((entry) => entry.trimEnd().endsWith(`  ${debName}`));
    const expected = line?.trim().split(/\s+/)[0];
    if (!expected || !(await verifySha256(debPath, expected))) {
      throw new Error("The downloaded update failed SHA-256 verification.");
    }
  }

  pendingDeb = debPath;
  setState({ available: true, version, ready: true, installing: false });
}

function runPkexec(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pkexec", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`pkexec exited with ${code}`)),
    );
  });
}

export async function installUpdate(): Promise<{ ok: boolean; message?: string }> {
  if (process.platform !== "linux" || pendingDeb === null || !existsSync(pendingDeb)) {
    return { ok: false, message: "No downloaded Linux update is ready." };
  }
  setState({ ...state, installing: true });
  try {
    await runPkexec(["apt-get", "install", "-y", pendingDeb]);
    setState({ available: false, version: null, ready: false, installing: false });
    await rm(pendingDeb, { force: true });
    pendingDeb = null;
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (error) {
    setState({ ...state, installing: false });
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

let checksStarted = false;

export function checkForUpdates(): void {
  if (process.platform === "linux") {
    void prepareLinuxUpdate().catch(() => {});
    return;
  }
  void autoUpdater.checkForUpdates().catch(() => {});
}

export function startUpdateChecks(): void {
  if (checksStarted) return;
  checksStarted = true;
  if (process.platform === "linux") {
    checkForUpdates();
    setInterval(checkForUpdates, CHECK_INTERVAL_MS);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", (info) =>
    setState({ available: true, version: info.version, ready: false, installing: false }),
  );
  autoUpdater.on("update-not-available", () =>
    setState({ available: false, version: null, ready: false, installing: false }),
  );
  autoUpdater.on("error", () => {});

  checkForUpdates();
  setInterval(checkForUpdates, CHECK_INTERVAL_MS);
}
