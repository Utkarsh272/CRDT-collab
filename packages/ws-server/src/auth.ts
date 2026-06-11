import * as jwt from "jsonwebtoken";
import { getDb } from "./db.js";

export interface AuthUser {
  id: string;         // our DB UUID
  supabaseId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Verify a Supabase JWT and upsert the user into our DB.
 * Returns null if the token is invalid or expired.
 */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!jwtSecret) throw new Error("SUPABASE_JWT_SECRET not set");

    const payload = jwt.verify(token, jwtSecret) as jwt.JwtPayload;

    const supabaseId: string = payload.sub!;
    const email: string = payload.email ?? "";
    const name: string =
      payload.user_metadata?.full_name ??
      payload.user_metadata?.name ??
      email.split("@")[0];
    const avatarUrl: string | undefined =
      payload.user_metadata?.avatar_url ?? undefined;

    const db = getDb();
    const result = await db.query<{ id: string }>(
      `INSERT INTO users (supabase_id, email, name, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (supabase_id) DO UPDATE
         SET email = EXCLUDED.email,
             name = EXCLUDED.name,
             avatar_url = EXCLUDED.avatar_url
       RETURNING id`,
      [supabaseId, email, name, avatarUrl ?? null]
    );

    return { id: result.rows[0].id, supabaseId, email, name, avatarUrl };
  } catch (err) {
    console.warn("[auth] token verification failed:", (err as Error).message);
    return null;
  }
}

/**
 * Parse token from:
 * - Authorization: Bearer <token>  (REST requests)
 * - ?token=<token>                 (WebSocket upgrade)
 */
export function extractToken(
  authHeader: string | undefined,
  urlQuery: string
): string | null {
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const params = new URLSearchParams(urlQuery);
  return params.get("token");
}
