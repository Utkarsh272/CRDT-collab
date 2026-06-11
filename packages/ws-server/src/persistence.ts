import * as Y from "yjs";
import { getDb } from "./db.js";

const SNAPSHOT_DEBOUNCE_MS = 5_000;
const SNAPSHOT_MAX_UPDATES = 100;
const SNAPSHOT_GC_KEEP = 50;
export const MEMORY_EVICT_GRACE_MS = 60_000;

interface SnapshotState {
  timer: ReturnType<typeof setTimeout> | null;
  updateCount: number;
}

const pendingSnapshots = new Map<string, SnapshotState>();

export function scheduleSnapshot(
  docId: string,
  ydoc: Y.Doc,
  forceImmediate = false
): void {
  let state = pendingSnapshots.get(docId);
  if (!state) {
    state = { timer: null, updateCount: 0 };
    pendingSnapshots.set(docId, state);
  }

  state.updateCount++;
  if (state.timer) clearTimeout(state.timer);

  if (forceImmediate || state.updateCount >= SNAPSHOT_MAX_UPDATES) {
    writeSnapshot(docId, ydoc);
    return;
  }

  state.timer = setTimeout(() => writeSnapshot(docId, ydoc), SNAPSHOT_DEBOUNCE_MS);
}

async function writeSnapshot(docId: string, ydoc: Y.Doc): Promise<void> {
  const state = pendingSnapshots.get(docId);
  if (state) {
    if (state.timer) clearTimeout(state.timer);
    pendingSnapshots.delete(docId);
  }

  try {
    const encoded = Y.encodeStateAsUpdate(ydoc);
    const db = getDb();

    await db.query(
      `INSERT INTO document_states (document_id, version, state, byte_size)
       SELECT $1,
              COALESCE((SELECT MAX(version) FROM document_states WHERE document_id = $1), 0) + 1,
              $2, $3`,
      [docId, Buffer.from(encoded), encoded.byteLength]
    );

    await db.query(`UPDATE documents SET updated_at = now() WHERE id = $1`, [docId]);

    // GC: prune beyond SNAPSHOT_GC_KEEP
    await db.query(
      `DELETE FROM document_states
       WHERE document_id = $1
         AND version NOT IN (
           SELECT version FROM document_states
           WHERE document_id = $1
           ORDER BY version DESC LIMIT $2
         )`,
      [docId, SNAPSHOT_GC_KEEP]
    );

    console.log(`[persist] snapshot written doc=${docId} (${encoded.byteLength}B)`);
  } catch (err) {
    console.error(`[persist] snapshot failed doc=${docId}:`, err);
  }
}

export async function loadSnapshot(docId: string): Promise<Y.Doc | null> {
  const db = getDb();
  const result = await db.query<{ state: Buffer }>(
    `SELECT state FROM document_states
     WHERE document_id = $1
     ORDER BY version DESC LIMIT 1`,
    [docId]
  );

  if (result.rows.length === 0) return null;

  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, new Uint8Array(result.rows[0].state));
  console.log(`[persist] loaded snapshot doc=${docId}`);
  return ydoc;
}
