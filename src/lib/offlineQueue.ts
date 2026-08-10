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

function getQueue(): QueueOperation[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueueOperation[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (e) {
    // v4.5 TO DO 6.1: jangan lempar QuotaExceededError ke pemanggil (smartUpsert/sync)
    // — antrean tetap hidup di memory; operasi cloud akan di-flush ulang saat online.
    console.warn('[OfflineQueue] Gagal menyimpan antrean ke localStorage (kemungkinan kuota penuh):', e);
  }
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

// ============================================================
// FLUSH QUEUE (retry pending operations)
// ============================================================

let isFlushing = false;

export async function flushQueue(): Promise<{ success: number; failed: number }> {
  if (!isSupabaseConfigured || isFlushing) return { success: 0, failed: 0 };
  
  isFlushing = true;
  const queue = getQueue();
  if (queue.length === 0) { isFlushing = false; return { success: 0, failed: 0 }; }

  // LOGIC-ERR-04 fix: Sort queue to respect dependency ordering
  // insert → upsert → update → delete ensures parent records exist before child ops
  const actionOrder: Record<string, number> = { insert: 0, upsert: 1, update: 2, delete: 3 };
  const sortedQueue = [...queue].sort((a, b) => {
    const orderA = actionOrder[a.action] ?? 1;
    const orderB = actionOrder[b.action] ?? 1;
    if (orderA !== orderB) return orderA - orderB;
    // Within same action type, preserve chronological order
    return a.timestamp.localeCompare(b.timestamp);
  });

  console.log(`[OfflineQueue] Flushing ${sortedQueue.length} pending operations...`);

  let success = 0;
  let failed = 0;
  const remaining: QueueOperation[] = [];

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
        op.retries++;
        if (op.retries < MAX_RETRIES) {
          remaining.push(op);
        }
        failed++;
        console.warn(`[OfflineQueue] Failed (attempt ${op.retries}):`, op.table, error.message);
      } else {
        success++;
      }
    } catch (e) {
      op.retries++;
      if (op.retries < MAX_RETRIES) {
        remaining.push(op);
      }
      failed++;
    }
  }

  saveQueue(remaining);
  updateQueueCount();
  isFlushing = false;

  console.log(`[OfflineQueue] Done. Success: ${success}, Failed: ${failed}, Remaining: ${remaining.length}`);
  return { success, failed };
}

export function clearQueue() {
  saveQueue([]);
  updateQueueCount();
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

export function initOfflineQueue() {
  if (initialized) return;
  initialized = true;

  // Flush when coming back online
  window.addEventListener('online', () => {
    console.log('[OfflineQueue] Back online — flushing queue...');
    setTimeout(flushQueue, 2000); // Small delay to let connection stabilize
  });

  // Log when going offline
  window.addEventListener('offline', () => {
    console.log('[OfflineQueue] Device went offline. Operations will be queued.');
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
