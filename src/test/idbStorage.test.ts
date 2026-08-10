import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { idbStorage, resetIdbStorage, IDB_DB_NAME, IDB_STORE_NAME } from '../utils/idbStorage';
import { safeStorage } from '../utils/safeStorage';

// ============================================================================
// Minimal in-memory fake IndexedDB (meniru API yang dipakai idbStorage).
// Node/vitest tidak punya indexedDB native — kita injeksi fake ini ke global.
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

interface FakeStore {
  data: Map<string, unknown>;
  get: (key: string) => any;
  put: (value: unknown, key: string) => any;
  delete: (key: string) => any;
}

function createFakeStore(): FakeStore {
  const data = new Map<string, unknown>();
  return {
    data,
    // Mutasi data DILAKUKAN SINKRON (seperti IDB real: perubahan terlihat setelah request
    // settle), event request via queueMicrotask agar chain async deterministik di test.
    get: (key: string) => {
      const req = makeRequest();
      queueMicrotask(() => fireSuccess(req, data.get(key)));
      return req;
    },
    put: (value: unknown, key: string) => {
      const req = makeRequest();
      data.set(key, value); // mutasi sinkron → baca setelah flush selalu konsisten
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

interface FakeDb {
  stores: Map<string, FakeStore>;
  objectStoreNames: { contains: (name: string) => boolean };
  createObjectStore: (name: string) => FakeStore;
  transaction: (name: string, mode: string) => { objectStore: (n: string) => FakeStore };
}

function createFakeDb(): FakeDb {
  const stores = new Map<string, FakeStore>();
  return {
    stores,
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore(name) {
      const s = createFakeStore();
      stores.set(name, s);
      return s;
    },
    transaction(name, _mode) {
      const store = stores.get(name);
      if (!store) throw new Error(`No object store named ${name}`);
      const tx: any = {
        objectStore: () => store,
        oncomplete: null as EventHandler,
        onerror: null as EventHandler,
        onabort: null as EventHandler,
      };
      // Fire complete via microtask — selesai DALAM satu gelombang microtask yang sama dengan
      // operasi store, jadi tidak ada chain async yang bocor ke test berikutnya (deterministik).
      queueMicrotask(() => tx.oncomplete?.({ target: tx }));
      return tx;
    },
  };
}

interface FakeIdb {
  db: FakeDb;
  openCalls: number;
  failNextOpen: boolean;
  blockedNextOpen: boolean;
  open: (name: string, version: number) => any;
}

function createFakeIndexedDB(): FakeIdb {
  const db = createFakeDb();
  return {
    db,
    openCalls: 0,
    failNextOpen: false,
    blockedNextOpen: false,
    open(name, version) {
      this.openCalls++;
      const req: any = {
        result: null as any,
        error: null as any,
        onupgradeneeded: null as EventHandler,
        onsuccess: null as EventHandler,
        onerror: null as EventHandler,
        onblocked: null as EventHandler,
      };
      queueMicrotask(() => {
        if (this.blockedNextOpen) {
          this.blockedNextOpen = false;
          req.onblocked?.({ target: req });
          return; // tidak pernah success/error → openDb resolve null via onblocked
        }
        if (this.failNextOpen) {
          this.failNextOpen = false;
          fireError(req, 'open gagal');
          return;
        }
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

let fakeIdb: FakeIdb | null = null;

function installFakeIdb() {
  fakeIdb = createFakeIndexedDB();
  (globalThis as any).indexedDB = fakeIdb;
}
function uninstallFakeIdb() {
  (globalThis as any).indexedDB = originalIndexedDB;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('idbStorage — IndexedDB path', () => {
  beforeEach(() => {
    resetIdbStorage();
    installFakeIdb();
  });
  afterEach(() => {
    uninstallFakeIdb();
  });

  it('setItem → getItem round-trip lewat IndexedDB', async () => {
    idbStorage.setItem('rempah-test-key', '{"state":"ok"}');
    await flush();
    const value = await idbStorage.getItem('rempah-test-key');
    expect(value).toBe('{"state":"ok"}');
  });

  it('getItem key yang belum pernah ditulis → null', async () => {
    const value = await idbStorage.getItem('rempah-tidak-ada');
    expect(value).toBeNull();
  });

  it('setItem menimpa nilai lama', async () => {
    idbStorage.setItem('k', 'v1');
    await flush();
    idbStorage.setItem('k', 'v2');
    await flush();
    expect(await idbStorage.getItem('k')).toBe('v2');
  });

  it('removeItem menghapus dari IndexedDB', async () => {
    idbStorage.setItem('k', 'v');
    await flush();
    idbStorage.removeItem('k');
    await flush();
    expect(await idbStorage.getItem('k')).toBeNull();
  });

  it('getItem memakai cache sinkron untuk key yang hangat (tanpa menunggu IDB)', async () => {
    idbStorage.setItem('k', 'v');
    await flush();
    // reset hanya membuang cache? Tidak — resetIdbStorage membuang cache.
    // Simulasi cache hangat: getItem kedua harus sinkron (string, bukan Promise)
    const result = idbStorage.getItem('k');
    expect(result).toBe('v');
  });

  it('membuat object store saat upgrade pertama (upgrade event)', async () => {
    idbStorage.setItem('k', 'v');
    await flush();
    expect(fakeIdb!.db.stores.has(IDB_STORE_NAME)).toBe(true);
    expect(fakeIdb!.openCalls).toBeGreaterThan(0);
  });

  it('gagal open → fallback ke localStorage (safeStorage)', async () => {
    const fake = createFakeIndexedDB();
    fake.failNextOpen = true;
    (globalThis as any).indexedDB = fake;
    resetIdbStorage();

    const originalLS = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;

    try {
      idbStorage.setItem('k', 'v');
      await flush();
      // IDB gagal → ditulis ke localStorage
      expect(store.get('k')).toBe('v');
      // getItem: IDB null → fallback localStorage
      expect(await idbStorage.getItem('k')).toBe('v');
    } finally {
      (globalThis as any).localStorage = originalLS;
    }
  });

  it('blocked open → fallback berjalan (transient), op berikutnya retry ke IDB', async () => {
    const fake = createFakeIndexedDB();
    fake.blockedNextOpen = true;
    (globalThis as any).indexedDB = fake;
    resetIdbStorage();

    // blocked → openDb resolve null (transient, tanpa disable) → idbSet false → fallback localStorage
    const originalLS = (globalThis as any).localStorage;
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;

    try {
      expect(() => idbStorage.setItem('k', 'v')).not.toThrow();
      await flush();
      expect(store.get('k')).toBe('v');

      // blocked bersifat transient → operasi berikutnya MENCARI ULANG ke IndexedDB
      // (dbPromise di-reset, bukan dbDisabled) — tulis baru masuk ke IDB, bukan localStorage.
      idbStorage.setItem('k2', 'v2');
      await flush();
      expect(fake.db.stores.get(IDB_STORE_NAME)!.data.get('k2')).toBe('v2');
      // nilai pertama (saat blocked) tetap di localStorage, yang baru di IDB
      expect(store.get('k')).toBe('v');
      expect(await idbStorage.getItem('k2')).toBe('v2');
    } finally {
      (globalThis as any).localStorage = originalLS;
    }
  });
});

describe('idbStorage — migrasi one-time dari localStorage', () => {
  const originalLS = (globalThis as any).localStorage;

  afterEach(() => {
    (globalThis as any).localStorage = originalLS;
  });

  it('data lama di localStorage disalin ke IDB saat getItem pertama & dihapus dari localStorage', async () => {
    resetIdbStorage();
    installFakeIdb();

    const store = new Map<string, string>();
    store.set('rempah-legacy', '{"old":"data"}');
    (globalThis as any).localStorage = {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;

    try {
      const value = await idbStorage.getItem('rempah-legacy');
      expect(value).toBe('{"old":"data"}');
      await flush(); // biarkan idbSet selesai
      // Salinan di IDB
      expect(fakeIdb!.db.stores.get(IDB_STORE_NAME)!.data.get('rempah-legacy')).toBe('{"old":"data"}');
      // localStorage dibersihkan (kuota lega)
      expect(store.has('rempah-legacy')).toBe(false);
      // getItem berikutnya datang dari cache/IDB, bukan localStorage
      expect(await idbStorage.getItem('rempah-legacy')).toBe('{"old":"data"}');
    } finally {
      uninstallFakeIdb();
    }
  });
});

describe('idbStorage — tanpa IndexedDB sama sekali', () => {
  const originalLS = (globalThis as any).localStorage;

  beforeEach(() => {
    resetIdbStorage();
    (globalThis as any).indexedDB = undefined;
  });
  afterEach(() => {
    (globalThis as any).indexedDB = originalIndexedDB;
    (globalThis as any).localStorage = originalLS;
  });

  it('setItem/getItem round-trip via safeStorage (localStorage wrapper)', async () => {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
      get length() { return store.size; },
      clear: () => store.clear(),
      getItem: (k: string) => store.get(k) ?? null,
      key: (i: number) => [...store.keys()][i] ?? null,
      removeItem: (k: string) => void store.delete(k),
      setItem: (k: string, v: string) => void store.set(k, v),
    } as Storage;

    idbStorage.setItem('k', 'v');
    await flush();
    expect(await idbStorage.getItem('k')).toBe('v');
  });

  it('tidak melempar saat localStorage menolak (kuota penuh) — pola safeStorage', async () => {
    (globalThis as any).localStorage = {
      get length() { return 0; },
      clear: () => {},
      getItem: () => null,
      key: () => null,
      removeItem: () => {},
      setItem: (_k: string, _v: string) => {
        throw new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError');
      },
    } as Storage;

    // JANGAN melempar ke pemanggil (alur bisnis tidak boleh gagal walau persist ditolak)
    expect(() => idbStorage.setItem('k', 'v')).not.toThrow();
    await flush();
    // Cache memori tetap memegang nilai — persist gagal hanya berarti data tidak tersimpan
    // lokal, BUKAN kehilangan data sesi (data hidup di memory & cloud).
    expect(await idbStorage.getItem('k')).toBe('v');
  });

  it('safeStorage.get lenient di environment tanpa localStorage', () => {
    // Node tanpa localStorage → safeStorage tidak melempar
    expect(() => safeStorage.setItem('x', 'y')).not.toThrow();
    expect(safeStorage.getItem('x')).toBeNull();
  });
});

describe('idbStorage — reset & konsistensi nama DB', () => {
  it('nama DB & store sesuai konstanta (kontrak dengan store persist)', () => {
    expect(IDB_DB_NAME).toBe('berdikari-pos');
    expect(IDB_STORE_NAME).toBe('kv');
  });
});
