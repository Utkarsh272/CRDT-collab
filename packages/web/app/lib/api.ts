const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:1234";

async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const { token, ...rest } = options;
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  title: string;
  owner_name: string;
  owner_id: string;
  permission?: string;
  created_at: string;
  updated_at: string;
}

export interface RoomStats {
  active_connections: number;
  in_memory: boolean;
}

// ─── API client ───────────────────────────────────────────────────────────────

export const api = {
  documents: {
    list: (token: string) =>
      apiFetch<{ documents: Document[] }>("/v1/documents", { token }),

    create: (token: string, title?: string) =>
      apiFetch<Document>("/v1/documents", {
        method: "POST",
        body: JSON.stringify({ title: title ?? "Untitled" }),
        token,
      }),

    get: (token: string, id: string) =>
      apiFetch<Document>(`/v1/documents/${id}`, { token }),

    update: (token: string, id: string, title: string) =>
      apiFetch<Document>(`/v1/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title }),
        token,
      }),

    delete: (token: string, id: string) =>
      apiFetch<void>(`/v1/documents/${id}`, { method: "DELETE", token }),

    shareByEmail: (
      token: string,
      id: string,
      email: string,
      permission: "read" | "write" = "write"
    ) =>
      apiFetch<{ shared: boolean; permission: string }>(
        `/v1/documents/${id}/share`,
        { method: "POST", body: JSON.stringify({ email, permission }), token }
      ),

    createShareLink: (token: string, id: string, permission: "read" | "write" = "write") =>
      apiFetch<{ link: string }>(`/v1/documents/${id}/share`, {
        method: "POST",
        body: JSON.stringify({ link: true, permission }),
        token,
      }),

    roomStats: (token: string, id: string) =>
      apiFetch<RoomStats>(`/v1/documents/${id}/room-stats`, { token }),
  },

  health: () => apiFetch<{ status: string; rooms: number }>("/healthz"),
};

// ─── WebSocket URL helper ─────────────────────────────────────────────────────

export function wsUrl(docId: string, token: string): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws/document/${docId}?token=${encodeURIComponent(token)}`;
}
