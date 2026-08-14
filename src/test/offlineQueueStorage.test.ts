import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDB_STORE_NAME } from '../utils/idbStorage';
import { safeStorage } from '../utils/safeStorage';

// ============================================================================
// Minimal in-memory fake IndexedDB (meniru API yang dipakai idbStorage).
// Node/vitest tidak punya indexedDB native — injeksi fake ini ke global.
// ============================================================================

type EventHandler = ((e: any) => void) | null;

function makeRequest() {
  return {
    result: undefined as any,
    error: null as any,
    onsuccess: null as EventHandler,
    onerror: null as EventHandler,
  };
}

function fireSuccess(req: any, result: any) {
  req.result = result;
  req.onsuccess?.({ target: req });
}
function fireError(req: any, message = 'IDB Error') {
  req.error = new DOMException(message, 'UnknownError');
  req.onerror?.({ target: req });
}

function createFakeStore() {
  const data = new Map<string, unknown>();
  let failNextPut = false;
  return {
    data,
    get failNextPut() {
      return failNextPut;
    },
    setFailNextPut(v: boolean) {
      failNextPut = v;
    },
    get: (key: string) => {
      const req = makeRequest();
      queueMicrotask(() => fireSuccess(req, data.get(key)));
      return req;
    },
    put: (value: unknown, key: string) => {
      const req = makeRequest();
      if (failNextPut) {
        failNextPut = false;
        queueMicrotask(() => fireError(req, 'put gagal'));
        return req;
      }
      data.set(key, value);
      queueMicrotask(() => fireSuccess(req, key));
      return req;
    },
    delete: (key: string) => {
      const req = makeRequest();
      data.delete(key);
      queueMicrotask(() => fireSuccess(req, undefined));
      return req;
    },
  };
}

function createFakeDb() {
  const stores = new Map<string, ReturnType<typeof createFakeStore>>();
  return {
    stores,
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore(name: string) {
      const s = createFakeStore();
      stores.set(name, s);
      return s;
    },
    transaction(name: string, _mode: string) {
      const store = stores.get(name);
      if (!store) throw new Error(`No object store named ${name}`);
      const tx: any = {
        objectStore: () => store,
        oncomplete: null as EventHandler,
        onerror: null as EventHandler,
        onabort: null as EventHandler,
      };
      // oncomplete DIPANCING DUA GELOMBANG microtask — meniru IndexedDB asli: transaksi
      // complete SETELAH semua request success (kalau sama-sama microtask, requestDone
      // resolve undefined lebih dulu karena req.result belum terisi).
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.({ target: tx })));
      return tx;
    },
  };
}

function createFakeIndexedDB() {
  const db = createFakeDb();
  return {
    db,
    open(name: string, version: number) {
      const req: any = {
        result: null as any,
        error: null as any,
        onupgradeneeded: null as EventHandler,
        onsuccess: null as EventHandler,
        onerror: null as EventHandler,
        onblocked: null as EventHandler,
      };
      queueMicrotask(() => {
        req.result = db;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          req.onupgradeneeded?.({ target: req });
        }
        fireSuccess(req, db);
      });
      return req;
    },
  };
}

const originalIndexedDB = (globalThis as any).indexedDB;
const originalLocalStorage = (globalThis as any).localStorage;
let fakeIdb: ReturnType<typeof createFakeIndexedDB> | null = null;

function installFakeIdb() {
  fakeIdb = createFakeIndexedDB();
  (globalThis as any).indexedDB = fakeIdb;
}
function uninstallFakeIdb() {
  (globalThis as any).indexedDB = originalIndexedDB;
}

/** Fake localStorage (node env tidak punya) — setItem bisa diset gagal (kuota penuh). */
function makeFakeStorage(failSetItem = false) {
  const store = new Map<string, string>();
  let fail = failSetItem;
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => {
      if (fail) {
        throw new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError');
      }
      store.set(key, value);
    },
    __setFail(v: boolean) {
      fail = v;
    },
    __store: store,
  } as Storage & { __setFail: (v: boolean) => void; __store: Map<string, string> };
}

let fakeStorage: Storage & { __setFail: (v: boolean) => void; __store: Map<string, string> };

function installFakeStorage() {
  fakeStorage = makeFakeStorage();
  (globalThis as any).localStorage = fakeStorage;
}
function uninstallFakeStorage() {
  (globalThis as any).localStorage = originalLocalStorage;
}

const QUEUE_KEY = 'rempah-offline-queue';
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Import modul offlineQueue dengan state segar (simulasi reload app). */
async function freshQueueModule() {
  vi.resetModules();
  return import('../lib/offlineQueue');
}

// ============================================================================

describe('offlineQueue — persistensi IndexedDB (O-1)', () => {
  beforeEach(() => {
    installFakeIdb();
    installFakeStorage();
  });
  afterEach(() => {
    uninstallFakeIdb();
    uninstallFakeStorage();
    vi.restoreAllMocks();
  });

  it('addToQueue menyimpan ke IndexedDB (bukan localStorage) — payload besar tidak hilang', async () => {
    const m = await freshQueueModule();
    // Boot: hidrasi dulu (seperti initOfflineQueue) — setelah ini saveQueue menulis ke IDB.
    await m.hydrateQueue();
    const bigOp = {
      table: 'transactions',
      action: 'upsert' as const,
      data: { id: 'tx-1', items: Array.from({ length: 2000 }, (_, i) => ({ id: i })) },
    };
    m.addToQueue(bigOp);
    await flush();

    // Persist ke IDB (kv store), bukan localStorage
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
    const store = fakeIdb!.db.stores.get(IDB_STORE_NAME)!;
    expect(store.data.has(QUEUE_KEY)).toBe(true);
    const saved = JSON.parse(store.data.get(QUEUE_KEY) as string);
    expect(saved).toHaveLength(1);
    expect(saved[0].data.id).toBe('tx-1');
  });

  it('antrean survive reload: hydrateQueue memuat ulang dari IndexedDB', async () => {
    // Sesi 1: boot (hidrasi) + tambahkan op → persist ke IDB
    let m = await freshQueueModule();
    await m.hydrateQueue();
    m.addToQueue({ table: 'customers', action: 'upsert', data: { id: 'c-1', name: 'Budi' } });
    await flush();

    // Sesi 2 (reload): modul baru, memory kosong → hydrate dari IDB
    m = await freshQueueModule();
    expect(m.getQueueLength()).toBe(0);
    const loaded = await m.hydrateQueue();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].data.id).toBe('c-1');
    expect(m.getQueueLength()).toBe(1);
  });

  it('migrasi one-time: antrean legacy di localStorage dipindah ke IndexedDB', async () => {
    // Seed antrean lama (sebelum fitur IDB) di localStorage
    const legacy = [{ id: 'legacy-1', table: 'menus', action: 'upsert', data: { id: 'm-1' }, timestamp: new Date().toISOString(), retries: 0 }];
    localStorage.setItem(QUEUE_KEY, JSON.stringify(legacy));

    const m = await freshQueueModule();
    const loaded = await m.hydrateQueue();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('legacy-1');

    // Data sudah pindah ke IDB & localStorage legacy dibersihkan
    await flush();
    const store = fakeIdb!.db.stores.get(IDB_STORE_NAME)!;
    expect(store.data.has(QUEUE_KEY)).toBe(true);
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('clearQueue membersihkan memory + IndexedDB + localStorage', async () => {
    const m = await freshQueueModule();
    await m.hydrateQueue();
    m.addToQueue({ table: 'inventory', action: 'update', data: { stock: 5 }, filter: { column: 'id', value: 'i-1' } });
    await flush();
    expect(m.getQueueLength()).toBe(1);

    m.clearQueue();
    await flush();
    expect(m.getQueueLength()).toBe(0);
    const store = fakeIdb!.db.stores.get(IDB_STORE_NAME)!;
    expect(store.data.has(QUEUE_KEY)).toBe(false);
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it('dedup: op upsert dengan id yang sama menggantikan antrean lama (tidak dobel)', async () => {
    const m = await freshQueueModule();
    await m.hydrateQueue();
    m.addToQueue({ table: 'promos', action: 'upsert', data: { id: 'p-1', value: 10 } });
    m.addToQueue({ table: 'promos', action: 'upsert', data: { id: 'p-1', value: 20 } });
    expect(m.getQueueLength()).toBe(1);
    await flush();
    const store = fakeIdb!.db.stores.get(IDB_STORE_NAME)!;
    const saved = JSON.parse(store.data.get(QUEUE_KEY) as string);
    expect(saved[0].data.value).toBe(20);
  });

  it('tidak pernah melempar saat IDB gagal + localStorage penuh — op tetap hidup di memory', async () => {
    // Buka DB dulu (store 'kv' dibuat), lalu set put berikutnya gagal
    vi.resetModules();
    const idbMod = await import('../utils/idbStorage');
    await idbMod.idbSet('probe', 'x');
    const store = fakeIdb!.db.stores.get(IDB_STORE_NAME)!;
    store.setFailNextPut(true);

    // localStorage juga penuh (melempar QuotaExceededError)
    fakeStorage.__setFail(true);

    const m = await freshQueueModule();
    await m.hydrateQueue(); // hydrated=true → saveQueue benar-benar mencoba persist
    expect(() => m.addToQueue({ table: 'cash_movements', action: 'insert', data: { id: 'cm-1', amount: 50000 } })).not.toThrow();
    // Data tetap hidup di memory (akan di-flush ulang saat online / reload berikutnya)
    expect(m.getQueueLength()).toBe(1);
    // Tetap bisa dibaca walau persist gagal
    const q = await m.hydrateQueue();
    expect(q.some((o) => o.data.id === 'cm-1')).toBe(true);

    fakeStorage.__setFail(false);
  });

  it('race boot: op yang ditambahkan sebelum hidrasi tidak ditimpa antrean tersimpan', async () => {
    // Seed antrean tersimpan di IDB (sesi lama — versi baru menyimpan di IndexedDB)
    const legacy = [{ id: 'old-1', table: 'menus', action: 'upsert', data: { id: 'm-old' }, timestamp: new Date().toISOString(), retries: 0 }];
    vi.resetModules();
    const idbMod = await import('../utils/idbStorage');
    await idbMod.idbSet(QUEUE_KEY, JSON.stringify(legacy));

    const m = await freshQueueModule();
    // Op baru ditambahkan SEBELUM hydrateQueue selesai (race boot)
    m.addToQueue({ table: 'transactions', action: 'upsert', data: { id: 'tx-new' } });
    const loaded = await m.hydrateQueue();
    const ids = loaded.map((o: any) => o.data.id);
    expect(ids).toContain('tx-new');
    expect(ids).toContain('m-old');
    expect(m.getQueueLength()).toBe(2);
  });
});
