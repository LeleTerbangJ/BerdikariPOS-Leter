/**
 * Offline Queue — Stores failed cloud sync operations and retries when online.
 * 
 * Strategy:
 * - Every cloud sync call goes through this queue
 * - If online: execute immediately
 * - If offline or fails: store in queue (localStorage)
 * - When internet returns: flush queue (retry all pending operations)
 * - Listens to browser online/offline events
 */

import { supabase, isSupabaseConfigured } from './supabase';
// v4.7 TO DO 13.1 (O-1): antrean offline dipersist ke IndexedDB (kuota besar) dengan
// migrasi one-time dari localStorage legacy + fallback safeStorage bila IDB tidak tersedia.
import { idbGet, idbGetStrict, idbSet, idbRemove } from '../utils/idbStorage';
import { safeStorage } from '../utils/safeStorage';

export type QueueOperation = {
  id: string;
  table: string;
  action: 'upsert' | 'update' | 'delete' | 'insert';
  data: Record<string, any>;
  filter?: { column: string; value: string }; // for update/delete
  timestamp: string;
  retries: number;
};

const QUEUE_KEY = 'rempah-offline-queue';
const MAX_RETRIES = 5;

// ============================================================
// QUEUE MANAGEMENT
// ============================================================

// Mirror in-memory — source of truth SINKRON untuk semua pembaca (getQueue/addToQueue/
// flushQueue). Persistensi (IndexedDB primary, localStorage fallback) bersifat async;
// kegagalan persist TIDAK pernah melempar ke pemanggil (data tetap hidup di memory
// & di-flush ulang saat online).
let memoryQueue: QueueOperation[] | null = null;
// Guard race boot: sebelum hydrateQueue selesai, saveQueue TIDAK menulis ke penyimpanan
// (jika tidak, antrean tersimpan dari sesi sebelumnya bisa ditimpa oleh op yang baru
// ditambahkan sebelum hidrasi). hydrateQueue yang menggabungkan & mempersist hasil akhir.
let hydrated = false;

// T7 fix (AUDIT-OX): retry hidrasi tunggal (anti stacking) setelah kegagalan transien IDB.
let hydrateRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleHydrateRetry() {
  if (hydrateRetryTimer) return;
  hydrateRetryTimer = setTimeout(() => {
    hydrateRetryTimer = null;
    void hydrateQueue();
  }, 5000);
}

function getQueue(): QueueOperation[] {
  return memoryQueue ?? [];
}

function saveQueue(queue: QueueOperation[]) {
  memoryQueue = queue;
  if (!hydrated) return; // defer persist ke hydrateQueue (hindari clobber antrean tersimpan)
  let raw: string;
  try {
    raw = JSON.stringify(queue);
  } catch {
    return;
  }
  // Primary: IndexedDB (kuota jauh lebih besar dari localStorage — payload transaksi
  // besar tidak lagi hilang saat kuota localStorage penuh).
  void idbSet(QUEUE_KEY, raw).then((ok) => {
    if (ok) {
      // IDB sukses → bebaskan kuota localStorage dari salinan legacy bila ada.
      safeStorage.removeItem(QUEUE_KEY);
    } else {
      // IDB tidak tersedia (private mode / SSR / test) → fallback safeStorage (anti-throw).
      try {
        safeStorage.setItem(QUEUE_KEY, raw);
      } catch (e) {
        console.warn('[OfflineQueue] Gagal menyimpan antrean (IDB & localStorage):', e);
      }
    }
  });
}

/**
 * Hidrasi antrean dari penyimpanan persisten (dipanggil sekali saat boot).
 * - Primary: IndexedDB; fallback: localStorage (legacy / saat IDB tidak tersedia).
 * - Migrasi one-time: antrean lama di localStorage dipindahkan ke IndexedDB.
 * - Aman terhadap race boot: op yang ditambahkan sebelum hidrasi selesai TIDAK ditimpa
 *   (digabung, id yang sama dimenangkan oleh memori).
 */
export async function hydrateQueue(): Promise<QueueOperation[]> {
  // T7 fix (AUDIT-OX): baca ketat — error/transien IDB TIDAK boleh dianggap "kosong".
  // Sebelumnya idbGet menelan error → null → fallback localStorage (sudah dihapus
  // pasca-migrasi) → persist '[]' MENIMPA antrean sesi sebelumnya (data hilang).
  let idbTransientFailure = false;
  let raw: string | null = null;
  try {
    raw = await idbGetStrict(QUEUE_KEY);
  } catch {
    idbTransientFailure = true;
  }
  if (!idbTransientFailure && raw === null) {
    // Migrasi / fallback: antrean legacy di localStorage
    try {
      raw = safeStorage.getItem(QUEUE_KEY);
    } catch {
      raw = null;
    }
  }
  let stored: QueueOperation[] = [];
  if (raw) {
    try {
      stored = JSON.parse(raw);
    } catch {
      stored = [];
    }
  }
  if (!Array.isArray(stored)) stored = [];

  // Race boot: op yang ditambahkan sebelum hidrasi selesai tidak boleh ditimpa.
  if (memoryQueue !== null && memoryQueue.length > 0) {
    const memIds = new Set(memoryQueue.map((o) => o.id));
    stored = [...memoryQueue, ...stored.filter((o) => !memIds.has(o.id))];
  }

  // Muat daftar op gagal permanen (O-3) — IDB primary, fallback localStorage.
  let failedRaw: string | null = null;
  try {
    failedRaw = await idbGetStrict(FAILED_KEY);
  } catch {
    idbTransientFailure = true;
  }
  if (!idbTransientFailure && failedRaw === null) {
    try {
      failedRaw = safeStorage.getItem(FAILED_KEY);
    } catch {
      failedRaw = null;
    }
  }
  let failedStored: FailedQueueOperation[] = [];
  if (failedRaw) {
    try {
      failedStored = JSON.parse(failedRaw);
    } catch {
      failedStored = [];
    }
  }
  if (!Array.isArray(failedStored)) failedStored = [];

  if (idbTransientFailure) {
    // Gagal transien: JANGAN timpa penyimpanan dengan hasil parsial/kosong & JANGAN
    // mengunci hydrated=true secara permanen. Op runtime tetap dipakai in-memory;
    // coba hidrasi ulang sekali lagi nanti (timer tunggal, anti stacking).
    // Catatan: daftar gagal runtime (memoryFailed) sengaja DIPERTAHANKAN apa adanya —
    // hasil baca IDB yang parsial/gagal tidak boleh menimpanya.
    console.warn('[OfflineQueue] IDB gagal transien saat hidrasi — retry 5 detik (data tersimpan tidak disentuh).');
    updateQueueCount();
    scheduleHydrateRetry();
    return getQueue();
  }

  memoryQueue = stored;
  hydrated = true;
  memoryFailed = failedStored;
  updateFailedCount();

  // Persist hasil gabungan + bebaskan localStorage bila IDB menerimanya.
  const rawNow = JSON.stringify(stored);
  void idbSet(QUEUE_KEY, rawNow).then((ok) => {
    if (ok) safeStorage.removeItem(QUEUE_KEY);
  });
  const failedRawNow = JSON.stringify(failedStored);
  void idbSet(FAILED_KEY, failedRawNow).then((ok) => {
    if (ok) safeStorage.removeItem(FAILED_KEY);
  });

  updateQueueCount();
  return stored;
}

// ============================================================
// FAILED OPERATIONS (v4.7 TO DO 13.2 — O-3: jangan drop diam-diam)
// ============================================================

/** Op yang gagal permanen setelah MAX_RETRIES — bisa di-retry manual / dihapus sadar. */
export type FailedQueueOperation = QueueOperation & {
  reason: string;
  lastError: string;
  failedAt: string;
};

const FAILED_KEY = 'rempah-offline-queue-failed';

let memoryFailed: FailedQueueOperation[] = [];
let onFailedChange: ((count: number) => void) | null = null;

export function setFailedOpsListener(listener: (count: number) => void) {
  onFailedChange = listener;
}

function updateFailedCount() {
  if (onFailedChange) onFailedChange(memoryFailed.length);
}

export function getFailedOps(): FailedQueueOperation[] {
  return memoryFailed;
}

export function getFailedOpsCount(): number {
  return memoryFailed.length;
}

function saveFailedOps(list: FailedQueueOperation[]) {
  memoryFailed = list;
  updateFailedCount();
  if (!hydrated) return; // defer persist ke hydrateQueue (pola sama dengan queue)
  let raw: string;
  try {
    raw = JSON.stringify(list);
  } catch {
    return;
  }
  void idbSet(FAILED_KEY, raw).then((ok) => {
    if (ok) {
      safeStorage.removeItem(FAILED_KEY);
    } else {
      try {
        safeStorage.setItem(FAILED_KEY, raw);
      } catch (e) {
        console.warn('[OfflineQueue] Gagal menyimpan daftar gagal (IDB & localStorage):', e);
      }
    }
  });
}

/**
 * Pindahkan semua op yang gagal permanen kembali ke antrean aktif (retry manual).
 * Return jumlah op yang dihidupkan kembali.
 */
export async function retryFailedOps(): Promise<number> {
  const failed = memoryFailed;
  if (failed.length === 0) return 0;
  const queue = getQueue();
  const existingIds = new Set(queue.map((o) => o.id));
  const revived = failed
    .map((f) => {
      const { reason: _reason, lastError: _lastError, failedAt: _failedAt, ...op } = f;
      return { ...op, retries: 0 };
    })
    .filter((o) => !existingIds.has(o.id));
  saveQueue([...queue, ...revived]);
  clearFailedOps();
  return revived.length;
}

/** Hapus daftar op yang gagal permanen (konfirmasi user di UI). */
export function clearFailedOps() {
  memoryFailed = [];
  updateFailedCount();
  void idbRemove(FAILED_KEY);
  safeStorage.removeItem(FAILED_KEY);
}

export function addToQueue(op: Omit<QueueOperation, 'id' | 'timestamp' | 'retries'>) {
  const queue = getQueue();
  
  // BUG-M8 fix: Deduplicate — for upsert/update, replace existing pending op for same table+record
  // BUG-M3 fix: Also deduplicate inserts using data.id to prevent duplicate logs
  const recordId = op.data?.id || op.filter?.value;
  if (recordId && (op.action === 'upsert' || op.action === 'update' || op.action === 'insert')) {
    const existingIdx = queue.findIndex(
      (q) => q.table === op.table && 
             (q.action === op.action || ((q.action === 'upsert' || q.action === 'update') && (op.action === 'upsert' || op.action === 'update'))) &&
             (q.data?.id === recordId || q.filter?.value === recordId)
    );
    if (existingIdx !== -1) {
      // For inserts with same ID, skip (it's a duplicate)
      if (op.action === 'insert' && queue[existingIdx].action === 'insert') {
        return; // Already queued, don't add again
      }
      // Replace the stale operation with the latest data
      queue[existingIdx] = {
        ...queue[existingIdx],
        data: op.action === 'update' ? { ...queue[existingIdx].data, ...op.data } : op.data,
        filter: op.filter || queue[existingIdx].filter,
        timestamp: new Date().toISOString(),
        retries: 0,
      };
      saveQueue(queue);
      updateQueueCount();
      return;
    }
  }

  queue.push({
    ...op,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    retries: 0,
  });
  saveQueue(queue);
  updateQueueCount();
}

export function getQueueLength(): number {
  return getQueue().length;
}

/** K6 fix (AUDIT-OX): akses read-only isi antrean — untuk debug/UI/test. Salinan array. */
export function getQueuedOperations(): QueueOperation[] {
  return [...getQueue()];
}

// ============================================================
// FLUSH QUEUE (retry pending operations)
// ============================================================

let isFlushing = false;

/**
 * Klasifikasi error transient (jaringan) vs permanen (RLS/constraint/kolom).
 * Error jaringan TIDAK menaikkan retries — op tetap di antrean dan dicoba lagi oleh
 * retry berkala (O-2), karena "navigator.onLine" bisa salah (Wi-Fi tanpa internet).
 */
function isTransientError(error: any): boolean {
  if (!error) return false;
  const msg = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return (
    msg.includes('failed to fetch') ||
    msg.includes('fetch failed') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('socket') ||
    msg.includes('timeout') ||
    error instanceof TypeError
  );
}

export async function flushQueue(): Promise<{ success: number; failed: number; pending: number }> {
  if (!isSupabaseConfigured || isFlushing) return { success: 0, failed: 0, pending: getQueue().length };
  
  isFlushing = true;
  const queue = getQueue();
  if (queue.length === 0) { isFlushing = false; return { success: 0, failed: 0, pending: 0 }; }

  // v4.7 TO DO 13.11 (O-10): urut KRONOLOGIS (timestamp) — urutan kejadian nyata antar
  // entitas dipertahankan (mis. cash movement refund setelah transaksi induknya, bukan
  // didahulukan karena action 'insert'). Tie-break action order (insert → upsert → update
  // → delete) hanya untuk timestamp sama (keamanan dependensi parent-before-child).
  const actionOrder: Record<string, number> = { insert: 0, upsert: 1, update: 2, delete: 3 };
  const sortedQueue = [...queue].sort((a, b) => {
    const timeCmp = a.timestamp.localeCompare(b.timestamp);
    if (timeCmp !== 0) return timeCmp;
    const orderA = actionOrder[a.action] ?? 1;
    const orderB = actionOrder[b.action] ?? 1;
    if (orderA !== orderB) return orderA - orderB;
    return a.id.localeCompare(b.id);
  });

  console.log(`[OfflineQueue] Flushing ${sortedQueue.length} pending operations...`);

  let success = 0;
  let failed = 0;
  const remaining: QueueOperation[] = [];
  const newlyFailed: FailedQueueOperation[] = [];
  // K6 fix (AUDIT-OX): id op yang SUKSES — dipakai di akhir flush untuk membedakan
  // "sudah tersync" vs "masih harus diantrekan ulang".
  const succeededIds = new Set<string>();

  // O-3: op yang gagal permanen dipindah ke daftar gagal (bukan di-drop diam-diam);
  // error transient (jaringan) tetap di antrean tanpa menaikkan retries.
  const failOp = (op: QueueOperation, error: any) => {
    if (isTransientError(error)) {
      remaining.push(op);
      return;
    }
    const errMsg = typeof error?.message === 'string' ? error.message : String(error || 'Unknown error');
    op.retries++;
    if (op.retries >= MAX_RETRIES) {
      newlyFailed.push({
        ...op,
        reason: `Gagal permanen setelah ${MAX_RETRIES} percobaan`,
        lastError: errMsg,
        failedAt: new Date().toISOString(),
      });
      failed++;
    } else {
      remaining.push(op);
    }
  };

  for (const op of sortedQueue) {
    try {
      let error: any = null;

      switch (op.action) {
        case 'upsert':
          ({ error } = await supabase.from(op.table).upsert(op.data));
          break;
        case 'insert':
          ({ error } = await supabase.from(op.table).insert(op.data));
          break;
        case 'update':
          if (op.filter) {
            ({ error } = await supabase.from(op.table).update(op.data).eq(op.filter.column, op.filter.value));
          }
          break;
        case 'delete':
          if (op.filter) {
            ({ error } = await supabase.from(op.table).delete().eq(op.filter.column, op.filter.value));
          }
          break;
      }

      if (error) {
        // Self-healing: If error is due to missing column in DB schema, strip bad column & retry immediately
        if (typeof error.message === 'string') {
          const missingColMatch = error.message.match(/column ["']?([a-zA-Z0-9_]+)["']? of relation/i) ||
                                  error.message.match(/Could not find the ["']?([a-zA-Z0-9_]+)["']? column/i) ||
                                  error.message.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
          if (missingColMatch && missingColMatch[1] && op.data && op.data[missingColMatch[1]] !== undefined) {
            const badCol = missingColMatch[1];
            console.warn(`[OfflineQueue] Self-healing: Stripping missing column "${badCol}" from queued ${op.table} payload...`);
            delete op.data[badCol];
            let retryErr: any = null;
            if (op.action === 'upsert') {
              ({ error: retryErr } = await supabase.from(op.table).upsert(op.data));
            } else if (op.action === 'update' && op.filter) {
              ({ error: retryErr } = await supabase.from(op.table).update(op.data).eq(op.filter.column, op.filter.value));
            } else if (op.action === 'insert') {
              ({ error: retryErr } = await supabase.from(op.table).insert(op.data));
            }
            if (!retryErr) {
              error = null; // Self-healed successfully!
            }
          }
        }
      }

      if (error) {
        console.warn(`[OfflineQueue] Failed (attempt ${op.retries + 1}):`, op.table, error.message);
        failOp(op, error);
      } else {
        success++;
        succeededIds.add(op.id);
      }
    } catch (e) {
      failOp(op, e);
    }
  }

  if (newlyFailed.length > 0) {
    saveFailedOps([...memoryFailed, ...newlyFailed]);
  }

  // ============================================================
  // K6 fix (AUDIT-OX): JANGAN menimpa antrean dengan `remaining` mentah.
  // Op baru yang masuk lewat addToQueue() SELAMA flush berjalan sudah
  // di-persist oleh saveQueue internal addToQueue, tetapi AKAN TERHAPUS
  // bila akhir flush menimpa dengan remaining saja → transaksi hilang.
  //
  // Merge dari kondisi antrean TERKINI (bukan snapshot):
  //   1) op yang TIDAK ada di snapshot flush → masuk selama flush → simpan.
  //   2) op sukses lalu di-replace in-place oleh addToQueue (id sama, objek
  //      baru berisi data lebih baru) → antrekan ulang versi terbarunya.
  //   3) op sukses tanpa perubahan → tidak diantrekan ulang (perilaku lama).
  //   4) op gagal permanen → pindah ke daftar gagal (tidak ikut antrean).
  //   5) op gagal transient / retries < MAX → tetap antre (pakai versi
  //      terbaru hasil replace in-place, bukan objek basi dari snapshot).
  // Kasus tanpa operasi konkuren (mayoritas) = identik dengan saveQueue(remaining).
  // ============================================================
  const snapshotById = new Map(sortedQueue.map((o) => [o.id, o] as const));
  const permanentIds = new Set(newlyFailed.map((f) => f.id));
  const currentQueue = getQueue();
  const merged: QueueOperation[] = [];
  for (const op of currentQueue) {
    const snap = snapshotById.get(op.id);
    if (!snap) {
      merged.push(op); // (1) op baru saat flush
      continue;
    }
    const replacedDuringFlush = op !== snap; // addToQueue replace-in-place membuat objek baru
    if (permanentIds.has(op.id)) continue; // (4)
    if (succeededIds.has(op.id)) {
      if (replacedDuringFlush) merged.push(op); // (2)
      // (3) sukses & tak berubah → lewati
    } else {
      merged.push(op); // (5)
    }
  }
  saveQueue(merged);
  updateQueueCount();
  isFlushing = false;

  console.log(`[OfflineQueue] Done. Success: ${success}, Failed: ${failed}, Remaining: ${merged.length}, FailedList: ${newlyFailed.length}`);
  return { success, failed, pending: merged.length };
}

export function clearQueue() {
  memoryQueue = [];
  memoryFailed = [];
  updateQueueCount();
  updateFailedCount();
  // Bersihkan kedua lapisan (IDB primary + localStorage legacy/fallback).
  void idbRemove(QUEUE_KEY);
  void idbRemove(FAILED_KEY);
  safeStorage.removeItem(QUEUE_KEY);
  safeStorage.removeItem(FAILED_KEY);
}

// ============================================================
// ONLINE/OFFLINE LISTENER
// ============================================================

let initialized = false;
let onQueueChange: ((count: number) => void) | null = null;

export function setQueueChangeListener(listener: (count: number) => void) {
  onQueueChange = listener;
}

function updateQueueCount() {
  if (onQueueChange) onQueueChange(getQueue().length);
}

// v4.7 TO DO 13.3 (O-2): retry berkala — navigator.onLine bisa salah (Wi-Fi tanpa
// internet); timer mencoba flush selama masih ada antrean, error transient tidak
// membakar retries sehingga op tidak pernah di-drop karena jaringan putus.
const SYNC_RETRY_INTERVAL_MS = 30000;

export async function initOfflineQueue() {
  if (initialized) return;
  initialized = true;

  // Hidrasi antrean dari IndexedDB/localStorage sebelum listener & flush pertama
  // (antrean dari sesi sebelumnya tidak boleh hilang / tertimpa).
  await hydrateQueue();

  // Flush when coming back online
  window.addEventListener('online', () => {
    console.log('[OfflineQueue] Back online — flushing queue...');
    setTimeout(flushQueue, 2000); // Small delay to let connection stabilize
  });

  // Log when going offline
  window.addEventListener('offline', () => {
    console.log('[OfflineQueue] Device went offline. Operations will be queued.');
  });

  // O-2: retry berkala selama ada antrean (30 detik) — mengatasi "online tapi tanpa
  // internet" yang tidak memicu event 'online'.
  window.setInterval(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (getQueue().length === 0) return;
    void flushQueue();
  }, SYNC_RETRY_INTERVAL_MS);

  // O-2: kembali ke tab (visible) dengan antrean tersisa → coba flush segera.
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getQueue().length > 0) {
      setTimeout(flushQueue, 500);
    }
  });

  // Try to flush on init (in case there are pending items from last session)
  if (navigator.onLine) {
    setTimeout(flushQueue, 3000);
  }
}

// ============================================================
// SMART SYNC — wraps supabase calls with offline fallback
// ============================================================

function extractMissingColumn(errorMessage: string): string | null {
  if (typeof errorMessage !== 'string') return null;
  const match = errorMessage.match(/column ["']?([a-zA-Z0-9_]+)["']? of relation/i) ||
                errorMessage.match(/Could not find the ["']?([a-zA-Z0-9_]+)["']? column/i) ||
                errorMessage.match(/column ["']?([a-zA-Z0-9_]+)["']? does not exist/i);
  return match && match[1] ? match[1] : null;
}

export async function smartUpsert(table: string, data: Record<string, any>): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  if (!navigator.onLine) {
    addToQueue({ table, action: 'upsert', data });
    return false;
  }

  try {
    const { error } = await supabase.from(table).upsert(data);
    if (error) {
      const badCol = extractMissingColumn(error.message);
      if (badCol && data[badCol] !== undefined) {
        console.warn(`[SmartSync] Self-healing: Stripping missing column "${badCol}" from ${table} payload...`);
        const copy = { ...data };
        delete copy[badCol];
        const retryRes = await supabase.from(table).upsert(copy);
        if (!retryRes.error) return true;
      }
      console.warn(`[SmartSync] Upsert failed, queuing:`, error.message);
      addToQueue({ table, action: 'upsert', data });
      return false;
    }
    return true;
  } catch {
    addToQueue({ table, action: 'upsert', data });
    return false;
  }
}

export async function smartUpdate(table: string, data: Record<string, any>, column: string, value: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  if (!navigator.onLine) {
    addToQueue({ table, action: 'update', data, filter: { column, value } });
    return false;
  }

  try {
    const { error } = await supabase.from(table).update(data).eq(column, value);
    if (error) {
      addToQueue({ table, action: 'update', data, filter: { column, value } });
      return false;
    }
    return true;
  } catch {
    addToQueue({ table, action: 'update', data, filter: { column, value } });
    return false;
  }
}

export async function smartDelete(table: string, column: string, value: string): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  if (!navigator.onLine) {
    addToQueue({ table, action: 'delete', data: {}, filter: { column, value } });
    return false;
  }

  try {
    const { error } = await supabase.from(table).delete().eq(column, value);
    if (error) {
      addToQueue({ table, action: 'delete', data: {}, filter: { column, value } });
      return false;
    }
    return true;
  } catch {
    addToQueue({ table, action: 'delete', data: {}, filter: { column, value } });
    return false;
  }
}

export async function smartInsert(table: string, data: Record<string, any>): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  if (!navigator.onLine) {
    addToQueue({ table, action: 'insert', data });
    return false;
  }

  try {
    const { error } = await supabase.from(table).insert(data);
    if (error) {
      addToQueue({ table, action: 'insert', data });
      return false;
    }
    return true;
  } catch {
    addToQueue({ table, action: 'insert', data });
    return false;
  }
}

// 🏷️ v4.9.2: Bulk insert untuk mengurangi round-trip HTTP REST API (misal multi-stock log)
export async function smartInsertMany(table: string, items: Record<string, any>[]): Promise<boolean> {
  if (!isSupabaseConfigured || items.length === 0) return false;

  if (!navigator.onLine) {
    for (const data of items) {
      addToQueue({ table, action: 'insert', data });
    }
    return false;
  }

  try {
    const { error } = await supabase.from(table).insert(items);
    if (error) {
      for (const data of items) {
        addToQueue({ table, action: 'insert', data });
      }
      return false;
    }
    return true;
  } catch {
    for (const data of items) {
      addToQueue({ table, action: 'insert', data });
    }
    return false;
  }
}

