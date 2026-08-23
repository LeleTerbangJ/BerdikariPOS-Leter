import type { StateStorage } from 'zustand/middleware';
import { safeStorage } from './safeStorage';

/**
 * v4.5 TO DO 6.1 (item permanen) — Adapter Storage berbasis IndexedDB untuk zustand persist.
 *
 * Masalah: seluruh store dipersist ke localStorage (~5MB di browser mobile) sehingga
 * payload `rempah-transactions` (500 transaksi + recipeSnapshot) dan `rempah-audit-logs`
 * (cap 2.000) memenuhi kuota → QuotaExceededError berantai (save pending gagal, ghost
 * transaction, deadlock tutup shift). IndexedDB memiliki kuota jauh lebih besar (biasanya
 * persentase dari ruang disk, bukan batas tetap 5MB).
 *
 * Solusi: adapter `StateStorage` over IndexedDB yang aman:
 * - `getItem`/`setItem`/`removeItem` mengakses satu object store `kv` (key = nama persist).
 * - Cache in-memory → getItem berikutnya untuk key yang sama sinkron (hidrasi instan).
 * - **Migrasi one-time dari localStorage**: data lama (`rempah-transactions`/
 *   `rempah-audit-logs`) disalin ke IndexedDB pada baca pertama, lalu dihapus dari
 *   localStorage (bebas kuota). Jika IndexedDB tidak tersedia, data lama tetap dibaca
 *   dari localStorage (fallback aman).
 * - **Fallback**: jika IndexedDB gagal dibuka (private mode / diblokir / SSR/test),
 *   adapter diam-diam kembali ke `safeStorage` (localStorage wrapper yang tidak melempar)
 *   sehingga alur bisnis tidak pernah gagal.
 * - Tidak pernah melempar / me-reject — error ditelan + console.warn (pola safeStorage).
 *
 * Dipakai oleh `transactionStore` & `auditLogStore` via `createJSONStorage(() => idbStorage)`.
 */

export const IDB_DB_NAME = 'berdikari-pos';
export const IDB_STORE_NAME = 'kv';
const IDB_DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let dbDisabled = false; // pernah gagal buka → jangan coba lagi di sesi ini (fallback permanen)

const cache = new Map<string, string>();

/** Buka koneksi IndexedDB (lazy, sekali per sesi). Resolve null jika tidak tersedia/gagal. */
function openDb(): Promise<IDBDatabase | null> {
  if (dbDisabled) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    dbDisabled = true; // SSR / private mode — permanent untuk sesi ini
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    let settled = false;
    // `permanent`: true = kegagalan nyata (storage rusak/private mode) → disable sesi;
    // false = transient (onblocked oleh tab lain) → reset dbPromise agar op berikutnya retry.
    const finish = (db: IDBDatabase | null, permanent: boolean) => {
      if (settled) return;
      settled = true;
      if (!db && permanent) dbDisabled = true;
      if (!db && !permanent) dbPromise = null; // retry pada operasi berikutnya
      resolve(db);
    };

    try {
      const req = indexedDB.open(IDB_DB_NAME, IDB_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (db && !db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };
      req.onsuccess = () => finish(req.result ?? null, true);
      req.onerror = () => {
        // Kegagalan nyata (quota IDB penuh, private mode) → disable sesi agar tidak
        // mencoba lagi & menghindari spam warning; fallback localStorage aman.
        console.warn('[IdbStorage] Gagal membuka IndexedDB — fallback ke localStorage:', req.error);
        finish(null, true);
      };
      req.onblocked = () => {
        // Transient: tab lain masih menahan koneksi (upgrade versionchange). Bila tab itu
        // ditutup, IDB sehat kembali — jangan disable sesi, cukup retry op berikutnya.
        console.warn('[IdbStorage] IndexedDB diblokir tab lain — fallback ke localStorage (retry nanti).');
        finish(null, false);
      };
    } catch (e) {
      console.warn('[IdbStorage] IndexedDB tidak tersedia — fallback ke localStorage:', e);
      finish(null, true);
    }
  });
  return dbPromise;
}

/** Resolve request + selesaikan transaksi (dipakai baca). */
function requestDone<T>(req: IDBRequest<T>, tx?: IDBTransaction): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    if (tx) {
      tx.onabort = () => reject(tx.error || new Error('IDB transaction aborted'));
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve(req.result);
    }
  });
}

/** Resolve saat transaksi tulis selesai (dipakai tulis/hapus). */
function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Baca nilai dari IndexedDB (string). Resolve null jika IDB tidak tersedia / key kosong. */
export async function idbGet(key: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const req = tx.objectStore(IDB_STORE_NAME).get(key);
    const value = await requestDone(req, tx);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/**
 * T7 fix (AUDIT-OX): baca ketat — MEMBEDAKAN tiga kondisi yang oleh `idbGet`
 * dicampur menjadi `null`:
 *   - key memang kosong            → resolve `null` (aman diperlakukan kosong)
 *   - IDB gagal PERMANEN           → resolve `null` (fallback localStorage sah)
 *   - IDB gagal TRANSIEN (blocked) → REJECT (pemanggil HARUS tidak menimpa data
 *     tersimpan dengan hasil kosong — cegah wipe antrean/data saat boot)
 */
export async function idbGetStrict(key: string): Promise<string | null> {
  const db = await openDb();
  if (!db) {
    if (dbDisabled) return null; // permanen → jalur fallback legacy sah
    throw new Error('IDB transient unavailable (blocked by another tab)');
  }
  const tx = db.transaction(IDB_STORE_NAME, 'readonly');
  const req = tx.objectStore(IDB_STORE_NAME).get(key);
  const value = await requestDone(req, tx); // error baca → reject (bukan null)
  return typeof value === 'string' ? value : null;
}

/** Tulis ke IndexedDB. Return true jika berhasil (false = IDB tidak tersedia/gagal). */
export async function idbSet(key: string, value: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(value, key);
    await txDone(tx);
    return true;
  } catch {
    return false;
  }
}

/** Hapus key dari IndexedDB (tidak pernah melempar). */
export async function idbRemove(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).delete(key);
    await txDone(tx);
  } catch {
    /* noop — removeItem tidak boleh gagal */
  }
}

/**
 * Adapter Storage kompatibel dengan `createJSONStorage` zustand.
 * Semua operasi tidak pernah melempar/reject — kegagalan IDB di-fallback ke safeStorage.
 */
export const idbStorage: StateStorage = {
  getItem(name) {
    // 1. Cache hangat → baca sinkron (hidrasi instan untuk key yang sudah dibaca/ditulis)
    const cached = cache.get(name);
    if (cached !== undefined) return cached;

    // 2. IndexedDB (async), dengan migrasi one-time dari localStorage bila kosong
    return idbGet(name).then((value) => {
      if (value !== null) {
        cache.set(name, value);
        return value;
      }
      // 3. Migrasi / fallback: data lama di localStorage → salin ke IDB + bebas kuota
      const legacy = safeStorage.getItem(name);
      if (legacy !== null) {
        cache.set(name, legacy);
        void idbSet(name, legacy).then((ok) => {
          if (ok) safeStorage.removeItem(name); // hanya hapus bila IDB benar-benar menulis
        });
        return legacy;
      }
      return null;
    });
  },

  setItem(name, value) {
    cache.set(name, value);
    void idbSet(name, value).then((ok) => {
      if (ok) {
        // bersihkan salinan legacy localStorage (kuota lega) bila ada
        safeStorage.removeItem(name);
      } else {
        // IDB tidak tersedia → fallback ke localStorage (wrapper anti-throw)
        safeStorage.setItem(name, value);
      }
    });
  },

  removeItem(name) {
    cache.delete(name);
    void idbRemove(name);
    safeStorage.removeItem(name); // konsisten di kedua lapisan
  },
};

/**
 * Hapus beberapa key dari IndexedDB sekaligus (await) — dipakai Data Manager
 * (Bersihkan Data / Reset / Factory Reset) sebelum `window.location.reload()` agar
 * transaksi delete selesai sebelum halaman di-unload (jika tidak, data bisa "ghost"
 * kembali karena delete IDB bersifat async). Juga membersihkan cache in-memory dan
 * lapisan localStorage (fallback) untuk key yang sama.
 */
export async function clearIdbKeys(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  for (const k of keys) cache.delete(k);
  keys.forEach((k) => safeStorage.removeItem(k)); // lapisan localStorage (fallback) ikut bersih
  const db = await openDb();
  if (!db) return; // IDB tidak tersedia → tidak ada data di IDB
  try {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    const store = tx.objectStore(IDB_STORE_NAME);
    for (const k of keys) store.delete(k);
    await txDone(tx);
  } catch {
    /* noop — clear tidak boleh gagal */
  }
}

/**
 * Reset state adapter (cache + koneksi). Dipakai test / hot-reload — data IndexedDB
 * itu sendiri TIDAK dihapus.
 */
export function resetIdbStorage(): void {
  cache.clear();
  dbPromise = null;
  dbDisabled = false;
}
