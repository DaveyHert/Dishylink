// Runs only for /api/*; every other path is served straight from the static
// build (assets.run_worker_first in wrangler.jsonc).

interface D1Result<T> {
  results: T[];
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}
interface Env {
  DB: { prepare(sql: string): D1Statement };
  ASSETS: { fetch(request: Request): Promise<Response> };
  TURNSTILE_SECRET: string;
  /** e.g. "dishylink.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag. */
  ACCESS_AUD?: string;
  /** Local `wrangler dev` only, from .dev.vars; honoured for loopback clients alone. */
  ADMIN_DEV_BYPASS?: string;
}

const MAX_TEXT = 500;
const MAX_NAME = 40;
const PLATFORMS = new Set(["mac", "windows", "linux", "web", "chrome", "edge", "firefox"]);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

async function submit(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request." }, 400);

  const stars = Number(body.stars);
  const text = String(body.text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const name =
    String(body.name ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME) || null;
  const platform = PLATFORMS.has(String(body.platform)) ? String(body.platform) : "web";
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return json({ error: "Pick a star rating." }, 400);
  }
  if (!text || text.length > MAX_TEXT) {
    return json({ error: `Write up to ${MAX_TEXT} characters.` }, 400);
  }

  const verdict = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: String(body.turnstile ?? ""),
      remoteip: request.headers.get("cf-connecting-ip") ?? "",
    }),
  }).then((r) => r.json() as Promise<{ success: boolean }>);
  if (!verdict.success) return json({ error: "Spam check failed. Reload and try again." }, 403);

  await env.DB.prepare("INSERT INTO reviews (stars, text, name, platform) VALUES (?, ?, ?, ?)")
    .bind(stars, text, name, platform)
    .run();
  return json({ ok: true }, 201);
}

async function approved(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, created_at, stars, text, name, platform FROM reviews WHERE status = 'approved' ORDER BY created_at DESC",
  ).all();
  return json({ reviews: results });
}

// Cloudflare Access already blocks unauthenticated requests at the edge; the
// token is still checked here so a misconfigured Access policy fails closed.
async function isAdmin(request: Request, env: Env): Promise<boolean> {
  // `wrangler dev` reports the production hostname, so the guard is the client
  // IP, which Cloudflare sets itself in production and a caller cannot forge.
  const ip = request.headers.get("cf-connecting-ip");
  if (env.ADMIN_DEV_BYPASS === "1" && (ip === "127.0.0.1" || ip === "::1")) return true;
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;

  const [head, payload, signature] = token.split(".");
  if (!head || !payload || !signature) return false;
  const decode = (part: string) =>
    Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const header = JSON.parse(new TextDecoder().decode(decode(head))) as { kid?: string };
  const claims = JSON.parse(new TextDecoder().decode(decode(payload))) as {
    aud?: string | string[];
    exp?: number;
    iss?: string;
  };

  const { keys } = (await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`).then(
    (r) => r.json(),
  )) as { keys: (JsonWebKey & { kid: string })[] };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decode(signature),
    new TextEncoder().encode(`${head}.${payload}`),
  );
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  return (
    valid &&
    audiences.includes(env.ACCESS_AUD) &&
    claims.iss === `https://${env.ACCESS_TEAM_DOMAIN}` &&
    (claims.exp ?? 0) * 1000 > Date.now()
  );
}

async function admin(request: Request, env: Env, id: string | undefined): Promise<Response> {
  if (!(await isAdmin(request, env))) return json({ error: "Not authorised." }, 403);
  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, created_at, stars, text, name, platform, status FROM reviews ORDER BY status = 'pending' DESC, created_at DESC LIMIT 200",
    ).all();
    return json({ reviews: results });
  }
  if (request.method === "POST" && id) {
    const { status } = ((await request.json().catch(() => ({}))) ?? {}) as { status?: string };
    if (status !== "approved" && status !== "rejected" && status !== "pending") {
      return json({ error: "Unknown status." }, 400);
    }
    await env.DB.prepare("UPDATE reviews SET status = ? WHERE id = ?")
      .bind(status, Number(id))
      .run();
    return json({ ok: true });
  }
  return json({ error: "Not found." }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/reviews") {
      if (request.method === "POST") return submit(request, env);
      if (request.method === "GET") return approved(env);
    }
    const adminMatch = pathname.match(/^\/api\/admin\/reviews(?:\/(\d+))?$/);
    if (adminMatch) return admin(request, env, adminMatch[1]);
    if (pathname.startsWith("/api/")) return json({ error: "Not found." }, 404);
    return env.ASSETS.fetch(request);
  },
};
