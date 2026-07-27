// Binds the host-agnostic cloud client to Electron and serves /cloud/* over the
// app:// protocol. The session cookie is held in the per-user data directory,
// encrypted with the OS keychain (safeStorage) rather than dev's plaintext file.
// The request logic — token refresh, the starlink.com calls — is the shared
// createCloudHandler; Node's global fetch honours the manually set Cookie header,
// exactly as the dev proxy relies on.

import { app, safeStorage } from "electron";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createCloudHandler } from "../cloud/starlinkCloudHandler";

let handler: ReturnType<typeof createCloudHandler> | null = null;
let cookieFile = "";

function readCookie(): string | null {
  try {
    if (!existsSync(cookieFile)) return null;
    const stored = readFileSync(cookieFile);
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(stored)
      : stored.toString("utf8");
  } catch {
    return null;
  }
}

function writeCookie(cookie: string): void {
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(cookie)
    : Buffer.from(cookie, "utf8");
  writeFileSync(cookieFile, data);
}

function clearCookie(): void {
  try {
    rmSync(cookieFile);
  } catch {
    // already gone
  }
}

/** Create the cloud client once, after the app is ready (the data path needs it). */
export function startCloud(): void {
  cookieFile = join(app.getPath("userData"), "starlink-session.bin");
  handler = createCloudHandler({ readCookie, writeCookie, clearCookie });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Serve one /cloud request: session connect/disconnect, or a data route. */
export async function handleCloudRequest(request: Request): Promise<Response> {
  if (!handler) return json(503, { error: "cloud not started" });
  const route = new URL(request.url).pathname;

  if (route === "/cloud/session") {
    if (request.method === "DELETE") {
      const { status, body } = handler.disconnect();
      return json(status, body);
    }
    if (request.method === "POST") {
      const { cookie } = (await request.json().catch(() => ({}))) as { cookie?: string };
      const { status, body } = await handler.connect(cookie ?? "");
      return json(status, body);
    }
    return json(405, { error: "method_not_allowed" });
  }

  const { status, body } = await handler.handle(route);
  return json(status, body);
}
