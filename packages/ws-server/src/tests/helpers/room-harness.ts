/**
 * In-process test harness for Room.
 *
 * Creates fake WebSocket connections backed by real Y.Doc clients so we can
 * test the sync protocol, conflict resolution, and snapshot behaviour without
 * spinning up a TCP server.
 */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { Room, RoomConnection } from "../room.js";

const MESSAGE_SYNC = 0;

/** A fake WebSocket that queues outgoing messages into an array. */
export class FakeWS {
  readonly sent: Uint8Array[] = [];
  readyState = 1; // OPEN

  send(data: Uint8Array) {
    this.sent.push(data instanceof Uint8Array ? data : new Uint8Array(data));
  }

  /** Pop and return all messages sent since the last drain. */
  drain(): Uint8Array[] {
    return this.sent.splice(0);
  }
}

export interface TestClient {
  ws: FakeWS;
  conn: RoomConnection;
  ydoc: Y.Doc;
  /** The shared text type (root-level "prosemirror" key used by Tiptap). */
  text: Y.XmlFragment;
}

/**
 * Create a test client and connect it to the given room,
 * fully completing the SyncStep1/SyncStep2 handshake.
 */
export function connectClient(
  room: Room,
  userId = "user-" + Math.random().toString(36).slice(2),
  userName = "Test User"
): TestClient {
  const ws = new FakeWS();
  const conn: RoomConnection = {
    ws: ws as unknown as import("ws").WebSocket,
    userId,
    userName,
    userColor: "#6366f1",
  };

  const ydoc = new Y.Doc();
  const text = ydoc.getXmlFragment("prosemirror");

  // Attach client to room — room will send SyncStep1
  room.addConnection(conn);

  // Process server's SyncStep1: reply with SyncStep2
  const serverMsgs = ws.drain();
  for (const msg of serverMsgs) {
    const dec = decoding.createDecoder(msg);
    const msgType = decoding.readVarUint(dec);
    if (msgType === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(dec, enc, ydoc, null);
      if (encoding.length(enc) > 1) {
        // Feed our SyncStep2 (what we're missing) back into the room
        room.handleMessage(conn, Buffer.from(encoding.toUint8Array(enc)));
      }
      // Send our own SyncStep1 to the room
      const step1Enc = encoding.createEncoder();
      encoding.writeVarUint(step1Enc, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(step1Enc, ydoc);
      room.handleMessage(conn, Buffer.from(encoding.toUint8Array(step1Enc)));
    }
  }

  // Drain any SyncStep2 the room sent us in response and apply
  for (const msg of ws.drain()) {
    const dec = decoding.createDecoder(msg);
    const msgType = decoding.readVarUint(dec);
    if (msgType === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(dec, enc, ydoc, null);
    }
  }

  return { ws, conn, ydoc, text };
}

/**
 * Apply a Y.Doc update from one client into the room (simulates sending
 * an "Update" sync message from that client to the server).
 */
export function pushUpdate(room: Room, client: TestClient, update: Uint8Array) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeUpdate(enc, update);
  room.handleMessage(client.conn, Buffer.from(encoding.toUint8Array(enc)));
}

/**
 * Deliver all pending messages from the room to a client's Y.Doc.
 * Returns the number of messages delivered.
 */
export function deliverPending(client: TestClient): number {
  const msgs = client.ws.drain();
  for (const msg of msgs) {
    const dec = decoding.createDecoder(msg);
    const msgType = decoding.readVarUint(dec);
    if (msgType === MESSAGE_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(dec, enc, client.ydoc, null);
    }
  }
  return msgs.length;
}

/** Build a fresh in-memory Room (no DB, snapshot is a no-op). */
export function makeRoom(docId = "test-doc-" + Math.random().toString(36).slice(2)): Room {
  const ydoc = new Y.Doc();
  return new Room(docId, ydoc);
}
