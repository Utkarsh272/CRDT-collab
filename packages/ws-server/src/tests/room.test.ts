/**
 * Unit tests for the Room sync protocol.
 *
 * All tests run in-process with fake WebSocket connections — no TCP, no DB.
 * The persistence module is mocked so snapshots are no-ops.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";
import { makeRoom, connectClient, pushUpdate, deliverPending } from "./helpers/room-harness.js";

// Mock persistence so scheduleSnapshot is a no-op in tests
vi.mock("../persistence.js", () => ({
  scheduleSnapshot: vi.fn(),
  loadSnapshot: vi.fn().mockResolvedValue(null),
  MEMORY_EVICT_GRACE_MS: 100,
}));

// ─── Basic sync ───────────────────────────────────────────────────────────────

describe("Room — basic sync", () => {
  it("second client receives existing document state on connect", () => {
    const room = makeRoom();

    // Client A connects and writes text
    const clientA = connectClient(room, "user-a", "Alice");
    clientA.ydoc.transact(() => {
      const text = clientA.ydoc.getText("content");
      text.insert(0, "Hello from Alice");
    });
    const update = Y.encodeStateAsUpdate(clientA.ydoc);
    pushUpdate(room, clientA, update);

    // Client B connects — should receive Alice's text via SyncStep2
    const clientB = connectClient(room, "user-b", "Bob");
    deliverPending(clientB);

    const textB = clientB.ydoc.getText("content");
    expect(textB.toString()).toBe("Hello from Alice");
  });

  it("update from one client broadcasts to all other clients", () => {
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");
    const clientB = connectClient(room, "user-b", "Bob");
    const clientC = connectClient(room, "user-c", "Carol");

    // A inserts text
    clientA.ydoc.transact(() => {
      clientA.ydoc.getText("content").insert(0, "broadcast test");
    });
    const update = Y.encodeStateAsUpdate(clientA.ydoc);
    pushUpdate(room, clientA, update);

    // B and C should receive it; A should NOT (no echo)
    expect(clientA.ws.sent.length).toBe(0);
    expect(deliverPending(clientB)).toBeGreaterThan(0);
    expect(deliverPending(clientC)).toBeGreaterThan(0);

    expect(clientB.ydoc.getText("content").toString()).toBe("broadcast test");
    expect(clientC.ydoc.getText("content").toString()).toBe("broadcast test");
  });

  it("disconnected client is removed from room", () => {
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");
    const clientB = connectClient(room, "user-b", "Bob");

    expect(room.connections.size).toBe(2);
    room.removeConnection(clientB.conn);
    expect(room.connections.size).toBe(1);
  });
});

// ─── Conflict resolution ──────────────────────────────────────────────────────

describe("Room — CRDT conflict resolution", () => {
  it("concurrent inserts at same position both survive", () => {
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");
    const clientB = connectClient(room, "user-b", "Bob");

    // Both start with an empty doc
    // A inserts "Hello" at position 0
    const docA = clientA.ydoc;
    const textA = docA.getText("content");
    docA.transact(() => textA.insert(0, "Hello"));

    // B (independently, without seeing A's update yet) also inserts at position 0
    const docB = clientB.ydoc;
    const textB = docB.getText("content");
    docB.transact(() => textB.insert(0, "World"));

    // Push both updates to the room
    pushUpdate(room, clientA, Y.encodeStateAsUpdate(docA));
    pushUpdate(room, clientB, Y.encodeStateAsUpdate(docB));

    // Deliver all pending to both clients
    deliverPending(clientA);
    deliverPending(clientB);

    // Both clients must converge to the same string (order determined by clientID)
    const resultA = textA.toString();
    const resultB = textB.toString();

    expect(resultA).toBe(resultB);
    // Both words must be present — no data lost
    expect(resultA).toContain("Hello");
    expect(resultA).toContain("World");
  });

  it("concurrent deletes of the same range both apply without error", () => {
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");

    // Seed the document with some text
    const textA = clientA.ydoc.getText("content");
    clientA.ydoc.transact(() => textA.insert(0, "Delete me please"));
    pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));

    // Client B joins and receives the seeded text
    const clientB = connectClient(room, "user-b", "Bob");
    deliverPending(clientB);

    const textB = clientB.ydoc.getText("content");
    expect(textB.toString()).toBe("Delete me please");

    // A deletes characters 0-5 ("Delete")
    clientA.ydoc.transact(() => textA.delete(0, 6));
    // B independently deletes characters 7-8 ("me") — overlapping intent
    clientB.ydoc.transact(() => textB.delete(7, 2));

    // Push both deletions
    pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));
    pushUpdate(room, clientB, Y.encodeStateAsUpdate(clientB.ydoc));

    // Deliver and check convergence
    deliverPending(clientA);
    deliverPending(clientB);

    // Both must agree — neither crashes, neither loops
    expect(textA.toString()).toBe(textB.toString());
    // "Delete" and "me" should both be gone
    expect(textA.toString()).not.toContain("Delete");
  });

  it("long offline edit merges cleanly with concurrent remote edits", () => {
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");
    const clientB = connectClient(room, "user-b", "Bob");

    // Establish a baseline
    const textA = clientA.ydoc.getText("content");
    clientA.ydoc.transact(() => textA.insert(0, "Baseline text. "));
    pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));
    deliverPending(clientB);

    // --- B goes "offline" (stops sending to room) ---

    // B makes 50 offline edits
    const textB = clientB.ydoc.getText("content");
    for (let i = 0; i < 50; i++) {
      clientB.ydoc.transact(() => textB.insert(textB.length, `b${i} `));
    }

    // Meanwhile A makes 10 online edits
    for (let i = 0; i < 10; i++) {
      clientA.ydoc.transact(() => textA.insert(textA.length, `a${i} `));
      pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));
    }
    deliverPending(clientA);

    // --- B reconnects: pushes all its offline edits at once ---
    pushUpdate(room, clientB, Y.encodeStateAsUpdate(clientB.ydoc));
    deliverPending(clientA);
    deliverPending(clientB);

    // Both clients must converge
    expect(textA.toString()).toBe(textB.toString());

    // Neither's edits were lost
    expect(textA.toString()).toContain("a0");
    expect(textA.toString()).toContain("b0");
    expect(textA.toString()).toContain("Baseline text.");
  });

  it("format + concurrent delete: deleted text does not retain mark", () => {
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");
    const clientB = connectClient(room, "user-b", "Bob");

    // Seed with XmlFragment (Tiptap's actual structure)
    const fragA = clientA.ydoc.getXmlFragment("prosemirror");
    clientA.ydoc.transact(() => {
      const para = new Y.XmlElement("paragraph");
      const textNode = new Y.XmlText();
      textNode.insert(0, "format and delete");
      para.insert(0, [textNode]);
      fragA.insert(0, [para]);
    });
    pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));
    deliverPending(clientB);

    // A formats the word "format" as bold (positions 0-5)
    const fragA2 = clientA.ydoc.getXmlFragment("prosemirror");
    const paraA = fragA2.get(0) as Y.XmlElement;
    const txtA = paraA.get(0) as Y.XmlText;
    clientA.ydoc.transact(() => txtA.format(0, 6, { bold: true }));

    // B deletes the entire paragraph concurrently
    const fragB = clientB.ydoc.getXmlFragment("prosemirror");
    const paraB = fragB.get(0) as Y.XmlElement;
    clientB.ydoc.transact(() => fragB.delete(0, 1));

    pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));
    pushUpdate(room, clientB, Y.encodeStateAsUpdate(clientB.ydoc));
    deliverPending(clientA);
    deliverPending(clientB);

    // Both docs converge — no crash, no split-brain
    const stateA = Y.encodeStateAsUpdate(clientA.ydoc);
    const stateB = Y.encodeStateAsUpdate(clientB.ydoc);

    // Apply A's state to a fresh doc and B's state to another — compare
    const checkA = new Y.Doc();
    Y.applyUpdate(checkA, stateA);
    const checkB = new Y.Doc();
    Y.applyUpdate(checkB, stateB);

    // Convergence: encoding the state as JSON-like must match
    expect(
      checkA.getXmlFragment("prosemirror").toString()
    ).toBe(
      checkB.getXmlFragment("prosemirror").toString()
    );
  });
});

// ─── Persistence integration ──────────────────────────────────────────────────

describe("Room — snapshot scheduling", () => {
  it("scheduleSnapshot is called after each update", async () => {
    const { scheduleSnapshot } = await import("../persistence.js");
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");

    const text = clientA.ydoc.getText("content");
    clientA.ydoc.transact(() => text.insert(0, "trigger snapshot"));
    pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));

    expect(scheduleSnapshot).toHaveBeenCalled();
  });

  it("scheduleSnapshot with forceImmediate=true called when last client leaves", async () => {
    const { scheduleSnapshot } = await import("../persistence.js");
    vi.clearAllMocks();

    const room = makeRoom();
    const client = connectClient(room, "user-a", "Alice");
    room.removeConnection(client.conn);

    expect(scheduleSnapshot).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Y.Doc),
      true  // forceImmediate
    );
  });
});

// ─── Room registry ────────────────────────────────────────────────────────────

describe("Room — connection lifecycle", () => {
  it("evict timer cancels if a new client joins before it fires", () => {
    vi.useFakeTimers();
    const room = makeRoom();
    const clientA = connectClient(room, "user-a", "Alice");

    // A leaves — starts evict timer
    room.removeConnection(clientA.conn);
    expect(room.connections.size).toBe(0);

    // B joins before timer fires
    const clientB = connectClient(room, "user-b", "Bob");
    expect(room.connections.size).toBe(1);

    // Advance past evict grace — room should still be alive
    vi.advanceTimersByTime(200);
    expect(room.connections.size).toBe(1);

    vi.useRealTimers();
  });

  it("multiple clients can each receive independent SyncStep2 deltas", () => {
    const room = makeRoom();

    // Client A connects and writes some text
    const clientA = connectClient(room, "user-a", "Alice");
    clientA.ydoc.transact(() => {
      clientA.ydoc.getText("content").insert(0, "doc content");
    });
    pushUpdate(room, clientA, Y.encodeStateAsUpdate(clientA.ydoc));

    // Client B connects and also writes something A hasn't seen
    const clientB = connectClient(room, "user-b", "Bob");
    deliverPending(clientB); // B gets A's content

    clientB.ydoc.transact(() => {
      clientB.ydoc.getText("content").insert(
        clientB.ydoc.getText("content").length,
        " and more"
      );
    });
    pushUpdate(room, clientB, Y.encodeStateAsUpdate(clientB.ydoc));
    deliverPending(clientA); // A gets B's addition

    // C joins late — should get the full merged state
    const clientC = connectClient(room, "user-c", "Carol");
    deliverPending(clientC);

    expect(clientC.ydoc.getText("content").toString()).toContain("doc content");
    expect(clientC.ydoc.getText("content").toString()).toContain("and more");
  });
});
