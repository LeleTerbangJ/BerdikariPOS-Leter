/**
 * PIN / Manager Approval Helpers — v4.7 (TO DO 10.2 & 10.3)
 *
 * Dual-control opname: approval (PIN) HANYA bisa berasal dari akun Manager/Owner.
 * - `isApproverRole`  : role apa yang boleh menyetujui.
 * - `authenticateManager`: validasi kredensial akun MANAGER TANPA efek samping
 *   (tidak mengubah sesi/currentUser — staff tetap tercatat sebagai penginput).
 * - `getDeviceMarker` : penanda perangkat stabil (untuk jejak audit lintas device).
 */

import bcrypt from 'bcryptjs';
import type { Role, User } from '../types';

/** Role yang boleh menyetujui opname berselisih besar (approver). */
export const APPROVER_ROLES: Role[] = ['Manager'];

export interface ApproverInfo {
  id: string;
  name: string;
  role: Role;
}

/** Apakah role user boleh menjadi approver (Manager/Owner). */
export function isApproverRole(role?: Role | null): boolean {
  return !!role && APPROVER_ROLES.includes(role);
}

/**
 * Validasi kredensial akun MANAGER (tanpa mengubah sesi).
 * - User tidak ditemukan / bukan Manager → null.
 * - Password benar (bcrypt atau legacy plaintext) → user; salah → null.
 */
export function authenticateManager(
  users: User[],
  username: string,
  password: string
): User | null {
  const user = users.find((u) => u.username === username);
  if (!user || !isApproverRole(user.role)) return null;
  const match =
    user.password.startsWith('$2a$') || user.password.startsWith('$2b$')
      ? bcrypt.compareSync(password, user.password)
      : user.password === password;
  return match ? user : null;
}

const DEVICE_KEY = 'rempah-device-id';

/**
 * Penanda perangkat stabil (dibuat sekali lalu di-persist). Storage bisa di-inject
 * untuk test; di lingkungan tanpa localStorage mengembalikan 'dev-unknown'.
 */
export function getDeviceMarker(
  storage?: Pick<Storage, 'getItem' | 'setItem'>
): string {
  const s =
    storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!s) return 'dev-unknown';
  try {
    let id = s.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      s.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'dev-unknown';
  }
}
