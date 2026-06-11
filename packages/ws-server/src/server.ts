import "dotenv/config";
import * as http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import * as Y from "yjs";
import { runMigrations } from "./db.js";
import { verifyToken, extractToken } from "./auth.js";
import { loadSnapshot } from "./persistence.js";
import { Room, RoomConnection, roomRegistry } from "./room.js";
import { handleRequest } from "./api.js";
import { metricsHandler, activeConnections, activeRooms, messagesReceived } from "./metrics.js";

const PORT = parseInt(process.env.PORT ?? "1234", 10);

// ─── HTTP server ──────────────────────────────────────────────────────────────

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/metrics") {
    const { body, contentType } = await metricsHandler();
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
    return;
  }

  const handled = await handleRequest(req, res);
  if (!handled) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", async (request, socket, head) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/ws\/document\/([a-f0-9-]{36})$/);

  if (!match) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const docId = match[1];
  const token = extractToken(request.headers["authorization"], url.search.slice(1));

  if (!token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const user = await verifyToken(token);
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, { docId, user });
  });
});

wss.on(
  "connection",
  async (
    ws: WebSocket,
    _request: http.IncomingMessage,
    context: { docId: string; user: { id: string; name: string } }
  ) => {
    const { docId, user } = context;

    let room = roomRegistry.get(docId);
    if (!room) {
      const ydoc = (await loadSnapshot(docId)) ?? new Y.Doc();
      room = new Room(docId, ydoc);
      roomRegistry.set(docId, room);
      activeRooms.set(roomRegistry.size);
    }

    const conn: RoomConnection = {
      ws,
      userId: user.id,
      userName: user.name,
      userColor: deterministicColor(user.id),
    };

    room.addConnection(conn);
    activeConnections.inc({ doc_id: docId });

    ws.on("message", (data: Buffer) => {
      messagesReceived.inc({ type: "binary" });
      room!.handleMessage(conn, data);
    });

    ws.on("close", () => {
      room!.removeConnection(conn);
      activeConnections.dec({ doc_id: docId });
      activeRooms.set(roomRegistry.size);
    });

    ws.on("error", (err) => {
      console.error(`[ws] error user=${user.id} doc=${docId}:`, err);
      room!.removeConnection(conn);
      activeConnections.dec({ doc_id: docId });
    });
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deterministicColor(userId: string): string {
  const palette = [
    "#f97316", "#3b82f6", "#10b981", "#a855f7",
    "#ef4444", "#eab308", "#06b6d4", "#ec4899",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  await runMigrations();
  httpServer.listen(PORT, () => {
    console.log(`[server] ws://localhost:${PORT}/ws/document/:docId`);
    console.log(`[server] http://localhost:${PORT}/v1/documents`);
    console.log(`[server] http://localhost:${PORT}/healthz`);
  });
}

main().catch((err) => {
  console.error("[server] fatal:", err);
  process.exit(1);
});
