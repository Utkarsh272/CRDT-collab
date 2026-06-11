import { IncomingMessage, ServerResponse } from "http";
import { getDb } from "./db.js";
import { verifyToken, extractToken, AuthUser } from "./auth.js";
import { roomRegistry } from "./room.js";

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  user: AuthUser,
  params: Record<string, string>
) => Promise<void>;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGINS ?? "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  res.end(payload);
}

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { resolve({}); }
    });
  });
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const listDocuments: Handler = async (_req, res, user) => {
  const db = getDb();
  const result = await db.query(
    `SELECT d.id, d.title, d.created_at, d.updated_at,
            dp.permission,
            u.name AS owner_name, u.id AS owner_id
     FROM documents d
     JOIN users u ON u.id = d.owner_id
     LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $1
     WHERE d.owner_id = $1 OR dp.user_id = $1
     ORDER BY d.updated_at DESC`,
    [user.id]
  );
  json(res, 200, { documents: result.rows });
};

const createDocument: Handler = async (req, res, user) => {
  const body = await parseBody(req);
  const title = (body.title as string | undefined) ?? "Untitled";
  const db = getDb();
  const result = await db.query<{ id: string; title: string; created_at: string }>(
    `INSERT INTO documents (owner_id, title) VALUES ($1, $2) RETURNING id, title, created_at`,
    [user.id, title]
  );
  json(res, 201, result.rows[0]);
};

const getDocument: Handler = async (_req, res, user, params) => {
  const db = getDb();
  const result = await db.query(
    `SELECT d.id, d.title, d.created_at, d.updated_at,
            u.name AS owner_name, u.id AS owner_id
     FROM documents d
     JOIN users u ON u.id = d.owner_id
     LEFT JOIN document_permissions dp ON dp.document_id = d.id AND dp.user_id = $2
     WHERE d.id = $1 AND (d.owner_id = $2 OR dp.user_id = $2)`,
    [params.id, user.id]
  );
  if (result.rows.length === 0) { json(res, 404, { error: "Not found" }); return; }
  json(res, 200, result.rows[0]);
};

const updateDocument: Handler = async (req, res, user, params) => {
  const body = await parseBody(req);
  if (!body.title) { json(res, 400, { error: "title required" }); return; }
  const db = getDb();
  const result = await db.query(
    `UPDATE documents SET title = $1, updated_at = now()
     WHERE id = $2 AND owner_id = $3
     RETURNING id, title, updated_at`,
    [body.title, params.id, user.id]
  );
  if (result.rows.length === 0) { json(res, 403, { error: "Forbidden" }); return; }
  json(res, 200, result.rows[0]);
};

const deleteDocument: Handler = async (_req, res, user, params) => {
  const db = getDb();
  const result = await db.query(
    `DELETE FROM documents WHERE id = $1 AND owner_id = $2 RETURNING id`,
    [params.id, user.id]
  );
  if (result.rows.length === 0) { json(res, 403, { error: "Forbidden" }); return; }
  roomRegistry.delete(params.id);
  json(res, 204, null);
};

const shareDocument: Handler = async (req, res, user, params) => {
  const body = await parseBody(req);
  const db = getDb();

  const ownerCheck = await db.query(
    `SELECT id FROM documents WHERE id = $1 AND owner_id = $2`,
    [params.id, user.id]
  );
  if (ownerCheck.rows.length === 0) { json(res, 403, { error: "Only owner can share" }); return; }

  if (body.email) {
    const target = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`, [body.email]
    );
    if (target.rows.length === 0) {
      json(res, 404, { error: "User not found (they must have signed in once)" }); return;
    }
    const permission = (body.permission as string) ?? "write";
    await db.query(
      `INSERT INTO document_permissions (document_id, user_id, permission, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (document_id, user_id) DO UPDATE SET permission = EXCLUDED.permission`,
      [params.id, target.rows[0].id, permission, user.id]
    );
    json(res, 200, { shared: true, permission });
    return;
  }

  if (body.link) {
    const permission = (body.permission as string) ?? "write";
    const result = await db.query<{ id: string }>(
      `INSERT INTO share_links (document_id, permission, expires_at) VALUES ($1, $2, $3) RETURNING id`,
      [params.id, permission, body.expires_at ?? null]
    );
    json(res, 201, {
      link: `${process.env.FRONTEND_URL}/docs/${params.id}?share=${result.rows[0].id}`,
    });
    return;
  }

  json(res, 400, { error: "Provide email or link:true" });
};

const getRoomStats: Handler = async (_req, res, _user, params) => {
  const room = roomRegistry.get(params.id);
  json(res, 200, { active_connections: room?.connections.size ?? 0, in_memory: roomRegistry.has(params.id) });
};

// ─── Router ───────────────────────────────────────────────────────────────────

type Route = { method: string; pattern: RegExp; paramNames: string[]; handler: Handler };

function route(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:([^/]+)/g, (_m, name) => { paramNames.push(name); return "([^/]+)"; }) + "$"
  );
  return { method, pattern, paramNames, handler };
}

const routes: Route[] = [
  route("GET",    "/v1/documents",               listDocuments),
  route("POST",   "/v1/documents",               createDocument),
  route("GET",    "/v1/documents/:id",            getDocument),
  route("PATCH",  "/v1/documents/:id",            updateDocument),
  route("DELETE", "/v1/documents/:id",            deleteDocument),
  route("POST",   "/v1/documents/:id/share",      shareDocument),
  route("GET",    "/v1/documents/:id/room-stats", getRoomStats),
];

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/healthz") {
    json(res, 200, { status: "ok", rooms: roomRegistry.size });
    return true;
  }

  if (req.method === "OPTIONS") { json(res, 204, null); return true; }

  for (const r of routes) {
    if (req.method !== r.method) continue;
    const match = url.pathname.match(r.pattern);
    if (!match) continue;

    const params: Record<string, string> = {};
    r.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });

    const token = extractToken(req.headers["authorization"], url.search.slice(1));
    if (!token) { json(res, 401, { error: "Unauthorized" }); return true; }

    const user = await verifyToken(token);
    if (!user) { json(res, 401, { error: "Invalid token" }); return true; }

    try {
      await r.handler(req, res, user, params);
    } catch (err) {
      console.error("[api] handler error:", err);
      json(res, 500, { error: "Internal server error" });
    }
    return true;
  }

  return false;
}
