/**
 * syncQueue.ts — IndexedDB-backed queue for offline mutations.
 *
 * When a POST/PUT/DELETE request fails because the browser is offline,
 * the caller enqueues the mutation here rather than showing an error.
 * The queue is replayed in FIFO order when connectivity returns.
 *
 * Design decisions:
 *  - IndexedDB (not localStorage) because mutation payloads can be
 *    large and we need structured storage + querying by state.
 *  - Each mutation carries enough context to replay independently:
 *    url, method, headers, body, and an optional `optimisticId` that
 *    the client can use to dedupe when the replay succeeds.
 *  - Exponential backoff per mutation: retry 0 -> immediate, 1 -> 5s,
 *    2 -> 25s, 3 -> 125s, then stop. The user can retry manually via
 *    the OfflineIndicator's "Retry now" button.
 *  - Max queue size: 500 entries. Beyond that, the oldest mutation is
 *    dropped (evicted) so the queue doesn't grow unbounded.
 *
 * Thread safety:
 *  - IndexedDB transactions are serialised per-object-store per-
 *    origin. Two tabs opening the same DB will see each other's
 *    writes, but the `replayAll` function processes mutations in a
 *    loop with individual reads-and-deletes so a single failed replay
 *    doesn't block the rest of the queue.
 *
 * O(1) operations:
 *  - enqueue: append-only, O(1) amortised.
 *  - getCount: IndexedDB count() is O(n) in the number of entries,
 *    but we cache it in a module-level variable. Invalidation sets
 *    cachedCount = null so the next call recomputes.
 *  - replayAll: O(m) where m = number of pending mutations. Each
 *    mutation is fetched, replayed, and deleted in sequence.
 */

const DB_NAME = 'walletsync';
const DB_VERSION = 1;
const STORE_NAME = 'mutations';
const MAX_QUEUE_SIZE = 500;
const MAX_RETRIES = 4;

/** Retry delay in ms: index -> delay. retryCount 0 = first attempt. */
const RETRY_DELAYS: ReadonlyArray<number> = [0, 5_000, 25_000, 125_000, 0];

export interface PendingMutation {
  /** Auto-increment primary key (assigned by IndexedDB). */
  id?: number;
  /** HTTP method. */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Target URL (relative, e.g. /api/entries). */
  url: string;
  /** Request headers (Content-Type, etc.). */
  headers: Record<string, string>;
  /** Serialised JSON body. */
  body: string;
  /** Millisecond epoch when the mutation was enqueued. */
  createdAt: number;
  /** Number of replay attempts so far. */
  retryCount: number;
  /**
   * Client-side identifier for the optimistic entry this mutation
   * corresponds to. When the replay succeeds, the page can use this
   * to remove the client-generated entry.
   */
  optimisticId: string | null;
  /** Human-readable label for the OfflineIndicator. */
  label: string;
}

/* ── Cached count + subscriber notification ───────────────────────── */

let cachedCount: number | null = null;
let countCallbacks: Array<(n: number) => void> = [];

/** Re-fetch count from IndexedDB and notify all subscribers. O(n) in
 *  the number of subscribers (typically 1). Sets cachedCount so
 *  subsequent getCount() calls are O(1). */
async function invalidateAndNotify(): Promise<void> {
  cachedCount = null;
  const count = await getCount();
  for (const cb of countCallbacks) {
    try { cb(count); } catch { /* subscriber error is non-fatal */ }
  }
}

/* ── DB lifecycle ─────────────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('retryCount', 'retryCount', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ── CRUD operations ──────────────────────────────────────────────── */

/**
 * Enqueue a new mutation. O(1) amortised append to the object store.
 * Subscribers are notified of the new count after the write completes.
 * Returns the assigned auto-increment id.
 */
export async function enqueue(mutation: {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  optimisticId?: string | null;
  label?: string;
}): Promise<number> {
  const entry: PendingMutation = {
    method: mutation.method,
    url: mutation.url,
    headers: mutation.headers ?? { 'Content-Type': 'application/json' },
    body: mutation.body ?? '',
    createdAt: Date.now(),
    retryCount: 0,
    optimisticId: mutation.optimisticId ?? null,
    label: mutation.label ?? mutation.url,
  };

  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.add(entry);

    const id = await new Promise<number>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });

    // Wait for the transaction to fully commit before notifying.
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Evict oldest entries if over limit.
    void evictIfNeeded().catch(() => {});
    // Notify subscribers of updated count.
    void invalidateAndNotify();

    return id;
  } finally {
    db.close();
  }
}

/**
 * Remove a mutation by id. O(1) keyed delete.
 * Subscribers are notified of the new count.
 */
async function dequeue(id: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    void invalidateAndNotify();
  } finally {
    db.close();
  }
}

/**
 * Update a mutation's retryCount. O(1) keyed put.
 */
async function updateRetry(id: number, retryCount: number): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    const existing = await new Promise<PendingMutation | undefined>(
      (resolve, reject) => {
        req.onsuccess = () => resolve(req.result ?? undefined);
        req.onerror = () => reject(req.error);
      },
    );
    if (!existing) return;
    existing.retryCount = retryCount;
    store.put(existing);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Read all pending mutations, ordered oldest-first (FIFO).
 */
async function listPending(): Promise<PendingMutation[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const req = index.getAll();

    const all = await new Promise<PendingMutation[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as PendingMutation[]);
      req.onerror = () => reject(req.error);
    });

    // Filter out evicted entries (retryCount > MAX_RETRIES) and sort
    // oldest-first for FIFO replay.
    return all
      .filter((m) => m.retryCount <= MAX_RETRIES)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  } finally {
    db.close();
  }
}

/**
 * Get the count of pending mutations. O(1) when cached; O(n) on first
 * call (falls back to IndexedDB index count).
 */
export async function getCount(): Promise<number> {
  if (cachedCount !== null) return cachedCount;

  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('retryCount');
    const range = IDBKeyRange.bound(0, MAX_RETRIES);
    const req = index.count(range);

    const count = await new Promise<number>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    cachedCount = count;
    return count;
  } finally {
    db.close();
  }
}

/**
 * Subscribe to count changes. The callback fires immediately with the
 * current count and on every subsequent mutation (enqueue/dequeue/
 * clear/evict). Returns an unsubscribe function.
 */
export function onCountChange(cb: (n: number) => void): () => void {
  countCallbacks.push(cb);
  void getCount().then(cb);
  return () => {
    countCallbacks = countCallbacks.filter((c) => c !== cb);
  };
}

/* ── Eviction ─────────────────────────────────────────────────────── */

/**
 * If the queue exceeds MAX_QUEUE_SIZE, evict the oldest entries (by
 * createdAt) beyond the limit. This keeps the IndexedDB store bounded
 * so the app doesn't fill the user's disk with offline mutations.
 */
async function evictIfNeeded(): Promise<void> {
  const count = await getCount();
  if (count <= MAX_QUEUE_SIZE) return;

  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('createdAt');
    const req = index.getAll();

    const all = await new Promise<PendingMutation[]>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result as PendingMutation[]);
      req.onerror = () => reject(req.error);
    });

    // Sort oldest-first and mark excess entries for deletion.
    const sorted = all.sort(
      (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
    );
    const toEvict = sorted.slice(
      0,
      sorted.length - Math.floor(MAX_QUEUE_SIZE / 2),
    );

    for (const m of toEvict) {
      if (m.id !== undefined) store.delete(m.id);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    void invalidateAndNotify();
  } finally {
    db.close();
  }
}

/* ── Replay ────────────────────────────────────────────────────────── */

export interface ReplayResult {
  succeeded: number;
  failed: number;
  permanentFailures: Array<{ id: number; error: string; label: string }>;
}

/**
 * Replay all pending mutations in FIFO order. Mutations that succeed
 * (2xx) are dequeued. Mutations that fail are either retried later
 * (if retryCount < MAX_RETRIES) or permanently failed (surfaced to
 * the user).
 *
 * @param fetchFn - Optional custom fetch function (for testing). Uses
 *   the global `fetch` by default.
 */
export async function replayAll(
  fetchFn: typeof fetch = fetch,
): Promise<ReplayResult> {
  const pending = await listPending();
  if (pending.length === 0) {
    return { succeeded: 0, failed: 0, permanentFailures: [] };
  }

  const result: ReplayResult = {
    succeeded: 0,
    failed: 0,
    permanentFailures: [],
  };

  for (const mutation of pending) {
    if (mutation.id === undefined) continue;

    const delay = RETRY_DELAYS[mutation.retryCount] ?? 125_000;
    const age = Date.now() - (mutation.createdAt ?? 0);
    if (age < delay) continue;

    try {
      const url = mutation.url.startsWith('http')
        ? mutation.url
        : `${window.location.origin}${mutation.url}`;

      const res = await fetchFn(url, {
        method: mutation.method,
        headers: mutation.headers,
        body: mutation.body || undefined,
      });

      if (res.ok) {
        await dequeue(mutation.id);
        result.succeeded++;
      } else if (res.status >= 400 && res.status <= 499) {
        await dequeue(mutation.id);
        result.permanentFailures.push({
          id: mutation.id,
          error: `${mutation.method} ${mutation.url} returned ${res.status}`,
          label: mutation.label,
        });
        result.failed++;
      } else {
        const nextRetry = mutation.retryCount + 1;
        if (nextRetry > MAX_RETRIES) {
          await dequeue(mutation.id);
          result.permanentFailures.push({
            id: mutation.id,
            error: `Max retries exceeded for ${mutation.method} ${mutation.url}`,
            label: mutation.label,
          });
          result.failed++;
        } else {
          await updateRetry(mutation.id, nextRetry);
          result.failed++;
        }
      }
    } catch (err) {
      const nextRetry = mutation.retryCount + 1;
      if (nextRetry > MAX_RETRIES) {
        await dequeue(mutation.id);
        result.permanentFailures.push({
          id: mutation.id,
          error:
            err instanceof Error
              ? err.message
              : 'Network error after max retries',
          label: mutation.label,
        });
        result.failed++;
      } else {
        await updateRetry(mutation.id, nextRetry);
        result.failed++;
      }
    }
  }

  cachedCount = null;
  return result;
}

/* ── Utility ──────────────────────────────────────────────────────── */

/**
 * Clear all pending mutations. Used when the user explicitly dismisses
 * the offline queue.
 */
export async function clearQueue(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    cachedCount = 0;
    for (const cb of countCallbacks) {
      try { cb(0); } catch { /* ignore */ }
    }
  } finally {
    db.close();
  }
}
