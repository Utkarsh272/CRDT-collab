# DESIGN.md — CRDT Collaborative Document

## What this is

A real-time multiplayer rich-text editor. Multiple users edit the same document simultaneously; their cursors are visible to each other; edits made offline merge cleanly on reconnect.

The core question this project answers: *how do you let N clients all modify a shared document concurrently without corrupting state?*

---

## Key design decisions

### 1. Yjs over Automerge

Both are mature CRDT libraries. I chose Yjs for three reasons:

- Tiptap (the editor) has official, maintained Yjs bindings via `@tiptap/extension-collaboration`. Automerge's ProseMirror integration is less mature.
- The `y-websocket` server is open source, ~200 lines, and readable — I could study it and write my own WS server that follows the same binary protocol, rather than using it as a black box.
- Yjs separates the CRDT core from the transport cleanly, making it easy to layer IndexedDB (offline) and WebSocket (online) providers simultaneously. The document state is provider-agnostic.

Automerge 2.0 (Rust core) has better performance characteristics at very high operation counts, but Yjs is better supported by the editor ecosystem.

### 2. Custom WebSocket server over y-websocket black-box

The `y-websocket` package is ~200 lines and easy to read. Writing my own server that implements the same binary sync protocol means:

- I understand every message type (SyncStep1, SyncStep2, Update, Awareness) rather than treating it as magic
- I can hook auth, document permission checks, snapshot scheduling, and Prometheus metrics at the right points
- I can explain every line in an interview

The downside is maintenance burden vs just `npm install y-websocket`. Worth it for portfolio purposes.

### 3. Full-state snapshots over a delta log

Each snapshot writes `Y.encodeStateAsUpdate(ydoc)` — the complete current state — to Postgres. An alternative is storing every incremental update (the delta log).

**Why full-state:**
- Recovery is one query: `SELECT state ORDER BY version DESC LIMIT 1`. Apply one `Y.applyUpdate` call and the document is restored.
- No need to replay potentially thousands of deltas in order.
- At portfolio scale (10KB doc × 50 snapshots × 100 documents = ~50MB) this is negligible.

**The trade-off:** Fine-grained edit history (who changed what character, when) is not possible without the delta log. If version history UI were a requirement, storing deltas would be necessary.

### 4. Debounced snapshots (5s window, 100-update force flush)

Without debouncing, every keystroke during active typing would trigger a DB write — a write storm. The 5s debounce collapses bursts into one write.

The 100-update force flush prevents indefinite deferral if someone types continuously. On disconnect, an immediate flush fires before the room is eligible for eviction.

Maximum data loss window = 5 seconds. Acceptable for portfolio scope; a production system would use 1-2s or a Redis WAL before Postgres.

### 5. JWT auth at WebSocket upgrade time only

Supabase JWTs are verified once — at connection upgrade, before the socket opens. Per-message auth would add latency on every operation and isn't necessary given short token TTLs.

**Known limitation:** Revoking access mid-session requires closing the existing connection. The client will fail to reconnect after their token expires (default 1 hour), but can continue editing during that window even if access was revoked. Acceptable for portfolio scope; documented here rather than hidden.

Token is passed as a `?token=` query parameter rather than a header — browsers don't support custom headers in `new WebSocket()` calls.

### 6. Awareness as ephemeral, never persisted

Cursor positions and selections are broadcast via Yjs Awareness:
- Not stored in Postgres — no value in persisting where someone's cursor was
- Automatically cleaned up — stale clients (no heartbeat 30s) are removed from the awareness map
- Separate message type (type byte 1) from document sync (type byte 0) — high-frequency awareness updates don't block or delay sync messages

### 7. key={docId} on the editor component

When switching between documents, the `CollaborativeEditor` component receives a `key={docId}` prop. React's key reconciliation forces a full unmount/remount on document change. This is the simplest way to tear down the Yjs doc, both providers (WebSocket + IndexedDB), and the Tiptap editor cleanly when switching documents.

The alternative — hot-swapping the Yjs document reference inside the Collaboration extension — is not supported by Tiptap's current API.

---

## What I'd do differently in production

**1. Redis pub/sub for multi-instance fan-out**
The current architecture is single-instance. If the same document has editors connected to different WS server instances (after horizontal scaling), updates don't reach all clients. `y-redis` solves this by using Redis pub/sub as a fan-out layer between instances.

**2. Rate-limiting per-connection updates**
A client sending 1MB/s of updates (e.g., script or bug) degrades other clients in the same room. A token bucket per connection would prevent this and protect server RAM.

**3. Permission check per message for write operations**
Currently permissions are checked once at connection time. If write access is revoked mid-session, the client can continue sending updates until their token expires or the connection drops. For a consumer product, periodic re-verification (every 60s) would be correct.

**4. Separate document size limits and compaction**
Yjs documents grow as tombstones accumulate from deletions. A production system would enforce a max serialized size per document and periodically compact tombstones using `Y.encodeStateAsUpdate` + `Y.decodeStateVector` to discard unreachable history.

**5. WebSocket reconnection backoff**
The `y-websocket` provider does reconnect, but with simple fixed intervals. A production client would use exponential backoff with jitter to avoid thundering herd after a server restart.

---

## Conflict resolution behaviour

Yjs (YATA algorithm) handles concurrent edits as follows:

| Scenario | Resolution |
|---|---|
| Two users insert at the same position | Ordered deterministically by client ID — same result on all peers |
| Two users delete the same text | Both deletions applied (tombstones) — neither is lost |
| User A formats bold while User B deletes the same span | Delete wins — the text is gone, format mark with it |
| Long offline edit + concurrent remote edits | Full state merge on reconnect — both sets of edits preserved |

The CRDT guarantee: **all clients always converge to the same document**, regardless of network order or operation interleaving.

---

## Known limitations

- No incremental cooperative rebalancing of awareness slots (full reset on disconnect)
- Single WS server instance — horizontal scaling requires `y-redis`
- No rich conflict visualisation — merges are silent (no "N changes merged" toast)
- Mobile editor experience is degraded — Tiptap toolbar assumes pointer input
- Auth is owner-only by default; share links grant access to anyone with the URL (no revocation UI beyond deleting the link in the DB)
