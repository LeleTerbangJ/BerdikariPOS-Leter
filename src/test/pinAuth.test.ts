import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import {
  APPROVER_ROLES,
  isApproverRole,
  authenticateManager,
  getDeviceMarker,
} from '../utils/pinAuth';
import type { User } from '../types';

function makeUser(over: Partial<User> & { username: string }): User {
  return {
    id: 'u1',
    name: 'User',
    password: bcrypt.hashSync('rahasia', 4),
    role: 'Manager',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function makeStorage(initial?: Record<string, string>) {
  const store: Record<string, string> = { ...initial };
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
}

// ============================================================
// TO DO 10.2 — role-gate: hanya Manager/Owner yang bisa menyetujui
// ============================================================

describe('isApproverRole (TO DO 10.2 — role approver)', () => {
  it('Manager → bisa menyetujui', () => {
    expect(isApproverRole('Manager')).toBe(true);
  });

  it('Kasir / Acaraki / Staf Gudang → TIDAK bisa menyetujui', () => {
    expect(isApproverRole('Kasir')).toBe(false);
    expect(isApproverRole('Acaraki')).toBe(false);
    expect(isApproverRole('Staf Gudang')).toBe(false);
  });

  it('undefined / null / tidak dikenal → tidak bisa menyetujui', () => {
    expect(isApproverRole(undefined)).toBe(false);
    expect(isApproverRole(null)).toBe(false);
  });

  it('APPROVER_ROLES hanya berisi role manajerial', () => {
    expect(APPROVER_ROLES).toEqual(['Manager']);
  });
});

describe('authenticateManager (TO DO 10.2 — quick-login approver tanpa efek samping)', () => {
  const manager = makeUser({ id: 'm1', name: 'Budi', username: 'manager' });
  const kasir = makeUser({ id: 'k1', name: 'Sari', username: 'kasir', role: 'Kasir' });
  const users = [manager, kasir];

  it('kredensial Manager benar (bcrypt) → mengembalikan user Manager', () => {
    const result = authenticateManager(users, 'manager', 'rahasia');
    expect(result?.id).toBe('m1');
    expect(result?.role).toBe('Manager');
  });

  it('password salah → null', () => {
    expect(authenticateManager(users, 'manager', 'salah')).toBeNull();
  });

  it('akun NON-Manager (Kasir) dengan kredensial benar → null (role-gate)', () => {
    expect(authenticateManager(users, 'kasir', 'rahasia')).toBeNull();
  });

  it('username tidak dikenal → null', () => {
    expect(authenticateManager(users, 'tidak-ada', 'rahasia')).toBeNull();
  });

  it('password legacy plaintext (pra-migrasi) → tetap bisa diautentikasi', () => {
    const legacy = makeUser({ username: 'legacy', password: '1234' });
    expect(authenticateManager([legacy], 'legacy', '1234')?.id).toBe(legacy.id);
    expect(authenticateManager([legacy], 'legacy', '9999')).toBeNull();
  });
});

// ============================================================
// TO DO 10.2 — penanda perangkat (jejak audit lintas device)
// ============================================================

describe('getDeviceMarker (TO DO 10.2 — penanda perangkat stabil)', () => {
  it('dibuat sekali lalu STABIL di panggilan berikutnya (storage di-inject)', () => {
    const storage = makeStorage();
    const first = getDeviceMarker(storage);
    const second = getDeviceMarker(storage);
    expect(first).toMatch(/^dev-/);
    expect(second).toBe(first);
  });

  it('storage yang sudah punya id → id yang sama dikembalikan', () => {
    const storage = makeStorage({ 'rempah-device-id': 'dev-existing' });
    expect(getDeviceMarker(storage)).toBe('dev-existing');
  });

  it('storage melempar error → fallback dev-unknown (tidak crash)', () => {
    const throwing = {
      getItem: () => {
        throw new Error('quota');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(getDeviceMarker(throwing)).toBe('dev-unknown');
  });

  it('tanpa storage (node) → dev-unknown, tidak crash', () => {
    expect(getDeviceMarker(undefined as any)).toBe('dev-unknown');
  });
});
