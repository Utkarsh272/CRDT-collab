/**
 * Room — per-document in-memory state.
 *
 * Implements the y-websocket sync protocol from first principles.
 * Source to learn from: https://github.com/yjs/y-websocket/blob/master/src/y-websocket.js
 *
 * Message type byte:
 *   0 = sync      (sub-types: 0=SyncStep1, 1=SyncStep2, 2=Update)
 *   1 = awareness (cursor/selection/user ephemeral state)
 */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { WebSocket } from "ws";
import { scheduleSnapshot, MEMORY_EVICT_GRACE_MS } from "./persistence.js";

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface RoomConnection {
  ws: WebSocket;
  userId: string;
  userName: string;
  userColor: string;
}

export class Room {
  readonly docId: string;
  readonly ydoc: Y.Doc;
  readonly awareness: awarenessProtocol.Awareness;
  readonly connections = new Set<RoomConnection>();

  private evictTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(docId: string, ydoc: Y.Doc) {
    this.docId = docId;
    this.ydoc = ydoc;
    this.awareness = new awarenessProtocol.Awareness(ydoc);

    // Trigger snapshot on every doc update
    this.ydoc.on("update", () => {
      scheduleSnapshot(this.docId, this.ydoc);
    });

    // Propagate awareness changes to all connections
    this.awareness.on(
      "update",
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changedClients = [...added, ...updated, ...removed];
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
        );
        this.broadcast(encoding.toUint8Array(encoder), null);
      }
    );
  }

  addConnection(conn: RoomConnection): void {
    this.connections.add(conn);
    if (this.evictTimer) {
      clearTimeout(this.evictTimer);
      this.evictTimer = null;
    }

    // Send SyncStep1 — our state vector so client knows what we have
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.ydoc);
    conn.ws.send(encoding.toUint8Array(encoder));

    // Send current awareness states of all present users
    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const aEncoder = encoding.createEncoder();
      encoding.writeVarUint(aEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        aEncoder,
        awarenessProtocol.encodeAwarenessUpdate(
          this.awareness,
          Array.from(awarenessStates.keys())
        )
      );
      conn.ws.send(encoding.toUint8Array(aEncoder));
    }

    console.log(`[room:${this.docId}] +conn user=${conn.userId} total=${this.connections.size}`);
  }

  handleMessage(conn: RoomConnection, data: Buffer): void {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MESSAGE_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncMsgType = syncProtocol.readSyncMessage(decoder, encoder, this.ydoc, conn);

        // Send reply (SyncStep2) back to sender if we produced one
        if (encoding.length(encoder) > 1) {
          conn.ws.send(encoding.toUint8Array(encoder));
        }

        // If this was an Update, broadcast to all other room members
        if (
          syncMsgType === syncProtocol.messageYjsSyncStep2 ||
          syncMsgType === syncProtocol.messageYjsUpdate
        ) {
          this.broadcast(new Uint8Array(data), conn);
        }
      } else if (msgType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(
          this.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
      }
    } catch (err) {
      console.error(`[room:${this.docId}] message error:`, err);
    }
  }

  removeConnection(conn: RoomConnection): void {
    this.connections.delete(conn);
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [conn.ws as unknown as number],
      "connection closed"
    );

    console.log(`[room:${this.docId}] -conn user=${conn.userId} total=${this.connections.size}`);

    if (this.connections.size === 0) {
      scheduleSnapshot(this.docId, this.ydoc, true); // flush immediately on empty room
      this.evictTimer = setTimeout(() => {
        roomRegistry.delete(this.docId);
        console.log(`[room:${this.docId}] evicted from memory`);
      }, MEMORY_EVICT_GRACE_MS);
    }
  }

  private broadcast(message: Uint8Array, sender: RoomConnection | null): void {
    for (const conn of this.connections) {
      if (conn !== sender && conn.ws.readyState === 1 /* OPEN */) {
        conn.ws.send(message);
      }
    }
  }
}

// Global in-memory registry: docId → Room
export const roomRegistry = new Map<string, Room>();
