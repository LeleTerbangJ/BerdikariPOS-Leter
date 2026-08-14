import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDB_STORE_NAME } from '../utils/idbStorage';

// ============================================================================
// Stub supabase — error upsert dikontrol per test via mockState (vi.hoisted).
// ============================================================================

const { mockState } = vi.hoisted(() => ({
  mockState: {
    error: null as any,
    callCount: 0,
  },
}));

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: vi.fn(() => {
      mockState.callCount++;
      return {
        upsert: vi.fn(async () => ({ error: mockState.error })),
        insert: vi.fn(async () => ({ error: mockState.error })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: mockState.error })) })),
        delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: mockState.error })) })),
      };
    }),
  },
}));

// ============================================================================
// Minimal fake IndexedDB + localStorage (pola test offlineQueueStorage).
// ============================================================================

type EventHandler = ((e: any) => void) | null;

function makeRequest() {
  return { result: undefined as any, error: null as any, onsuccess: null as EventHandler, onerror: null as EventHandler };
}
function fireSuccess(req: any, result: any) {
  req.result = result;
  req.onsuccess?.({ target: req });
}

function createFakeStore() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: (key: string) => {
      const req = makeRequest();
      queueMicrotask(() => fireSuccess(req, data.get(key)));
      return req;
    },
    put: (value: unknown, key: string) => {
      const req = makeRequest();
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
  const stores = new Map<string, any>();
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
      const tx: any = {
        objectStore: () => store,
        oncomplete: null as EventHandler,
        onerror: null as EventHandler,
        onabort: null as EventHandler,
      };
      // oncomplete SETELAH request success (meniru IDB asli)
      queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.({ target: tx })));
      return tx;
    },
  };
}

function createFakeIndexedDB() {
  const db = createFakeDb();
  return {
    db,
    open(_name: string, _version: number) {
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
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) req.onupgradeneeded?.({ target: req });
        fireSuccess(req, db);
      });
      return req;
    },
  };
}

const origIdb = (globalThis as any).indexedDB;
const origLs = (globalThis as any).localStorage;

function installFakeEnv() {
  (globalThis as any).indexedDB = createFakeIndexedDB();
  (globalThis as any).localStorage = {
    get length() {
      return 0;
    },
    clear: () => {},
    getItem: () => null,
    key: () => null,
    removeItem: () => {},
    setItem: () => {},
  };
}
function uninstallFakeEnv() {
  (globalThis as any).indexedDB = origIdb;
  (globalThis as any).localStorage = origLs;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

async function freshModule() {
  vi.resetModules();
  const m = await import('../lib/offlineQueue');
  await m.hydrateQueue();
  return m;
}

// ============================================================================

describe('offlineQueue — failed-ops list & retry berkala (O-2/O-3)', () => {
  beforeEach(() => {
    installFakeEnv();
    mockState.error = null;
    mockState.callCount = 0;
  });
  afterEach(() => {
    uninstallFakeEnv();
  });

  it('error PERMANEN setelah MAX_RETRIES dipindah ke daftar gagal (tidak di-drop)', async () => {
    mockState.error = { message: 'permission denied for table transactions' };
    const m = await freshModule();
    m.addToQueue({ table: 'transactions', action: 'upsert', data: { id: 't-1' } });

    for (let i = 0; i < 5; i++) {
      await m.flushQueue(); // retries: 1 → 2 → 3 → 4 → 5 (5th = pindah ke daftar gagal)
    }
    // Op tidak hilang — masuk daftar gagal permanen
    expect(m.getQueueLength()).toBe(0);
    expect(m.getFailedOpsCount()).toBe(1);
    const f = m.getFailedOps()[0];
    expect(f.data.id).toBe('t-1');
    expect(f.lastError).toContain('permission denied');
    expect(f.reason).toContain('Gagal permanen');
  });

  it('error TRANSIENT (jaringan) tidak membakar retries — op tetap di antrean', async () => {
    mockState.error = new TypeError('Failed to fetch');
    const m = await freshModule();
    m.addToQueue({ table: 'transactions', action: 'upsert', data: { id: 't-2' } });

    for (let i = 0; i < 8; i++) {
      await m.flushQueue();
    }
    expect(m.getQueueLength()).toBe(1);
    expect(m.getFailedOpsCount()).toBe(0);
  });

  it('retryFailedOps memindahkan op gagal kembali ke antrean & bisa sukses setelah diperbaiki', async () => {
    mockState.error = { message: 'column "x" does not exist' };
    const m = await freshModule();
    m.addToQueue({ table: 'promos', action: 'upsert', data: { id: 'p-1' } });
    for (let i = 0; i < 5; i++) await m.flushQueue();
    expect(m.getFailedOpsCount()).toBe(1);

    // Perbaiki (kolom sudah ada) → retry
    mockState.error = null;
    const revived = await m.retryFailedOps();
    expect(revived).toBe(1);
    expect(m.getFailedOpsCount()).toBe(0);
    expect(m.getQueueLength()).toBe(1);

    const res = await m.flushQueue();
    expect(res.success).toBe(1);
    expect(res.failed).toBe(0);
    expect(m.getQueueLength()).toBe(0);
  });

  it('clearFailedOps menghapus daftar gagal (konfirmasi user)', async () => {
    mockState.error = { message: 'duplicate key value violates unique constraint' };
    const m = await freshModule();
    m.addToQueue({ table: 'customers', action: 'upsert', data: { id: 'c-1' } });
    for (let i = 0; i < 5; i++) await m.flushQueue();
    expect(m.getFailedOpsCount()).toBe(1);

    m.clearFailedOps();
    expect(m.getFailedOpsCount()).toBe(0);
    expect(m.getQueueLength()).toBe(0);
  });

  it('daftar gagal survive reload (hydrate dari IndexedDB)', async () => {
    mockState.error = { message: 'permission denied for table menus' };
    let m = await freshModule();
    m.addToQueue({ table: 'menus', action: 'upsert', data: { id: 'm-1' } });
    for (let i = 0; i < 5; i++) await m.flushQueue();
    expect(m.getFailedOpsCount()).toBe(1);
    await flush();

    // Reload: modul baru, memory kosong → hydrate memuat daftar gagal
    vi.resetModules();
    m = await import('../lib/offlineQueue');
    expect(m.getFailedOpsCount()).toBe(0);
    await m.hydrateQueue();
    expect(m.getFailedOpsCount()).toBe(1);
    expect(m.getFailedOps()[0].data.id).toBe('m-1');
  });

  it('clearQueue (reset data) juga membersihkan daftar gagal', async () => {
    mockState.error = { message: 'permission denied for table settings' };
    let m = await freshModule();
    m.addToQueue({ table: 'settings', action: 'upsert', data: { id: 1 } });
    for (let i = 0; i < 5; i++) await m.flushQueue();
    expect(m.getFailedOpsCount()).toBe(1);

    m.clearQueue();
    expect(m.getFailedOpsCount()).toBe(0);
    expect(m.getQueueLength()).toBe(0);
  });

  it('flushQueue mengembalikan shape { success, failed, pending }', async () => {
    const m = await freshModule();
    const res = await m.flushQueue();
    expect(typeof res.success).toBe('number');
    expect(typeof res.failed).toBe('number');
    expect(typeof res.pending).toBe('number');
  });

  it('urutan KRONOLOGIS (O-10): urutan kejadian nyata dipertahankan antar entitas', async () => {
    const m = await freshModule();
    const calls: string[] = [];
    const { supabase } = await import('../lib/supabase');
    (supabase.from as any).mockImplementation((t: string) => {
      calls.push(t);
      return {
        upsert: vi.fn(async () => ({ error: null })),
        insert: vi.fn(async () => ({ error: null })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      };
    });

    // Kejadian 1: transaksi (upsert) — lebih dulu
    m.addToQueue({ table: 'transactions', action: 'upsert', data: { id: 't-1' } });
    await new Promise((r) => setTimeout(r, 2));
    // Kejadian 2: kas keluar refund (insert) — lebih lambat
    m.addToQueue({ table: 'cash_movements', action: 'insert', data: { id: 'cm-1' } });

    await m.flushQueue();
    // BUKAN urutan action (insert dulu) — melainkan urutan kejadian nyata
    expect(calls).toEqual(['transactions', 'cash_movements']);
  });
});
