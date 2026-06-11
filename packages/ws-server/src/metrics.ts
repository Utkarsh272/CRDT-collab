import * as client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const activeConnections = new client.Gauge({
  name: "ws_active_connections",
  help: "Number of active WebSocket connections",
  labelNames: ["doc_id"],
  registers: [register],
});

export const activeRooms = new client.Gauge({
  name: "ws_active_rooms",
  help: "Number of documents loaded in memory",
  registers: [register],
});

export const messagesReceived = new client.Counter({
  name: "ws_messages_received_total",
  help: "Total WebSocket messages received",
  labelNames: ["type"],
  registers: [register],
});

export async function metricsHandler(): Promise<{ body: string; contentType: string }> {
  return { body: await register.metrics(), contentType: register.contentType };
}
