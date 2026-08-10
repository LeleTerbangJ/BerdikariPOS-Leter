import type { CartItem, PaymentMethod } from '../types';

/**
 * v4.5 TO DO 5.1 — Manajemen reserve stok split FRESH yang dipersistenkan lintas buka/tutup modal.
 *
 * Akar masalah lama: `sessionReservedRef`/`sessionPaidRef` di-reset di `useEffect([open])` dan
 * di-null-kan di `handleClose`. Kasir yang menutup modal di tengah split lalu membukanya lagi
 * membuat sub-bill pertama sesi baru dianggap "sub-bill pertama" → `deductStock(fullDeductions)`
 * dipanggil LAGI → stok item yang sudah lunas di sesi 1 terpotong ganda (double deduction).
 *
 * Solusi: simpan sesi reserve di module-level (bertahan lintas mount/unmount komponen),
 * dicocokkan dengan **signature cart**. Sesi dibersihkan hanya saat:
 *   1. Semua sub-bill lunas (stok seluruhnya terpakai sah — tidak perlu revert), atau
 *   2. Isi cart berubah (kasir pindah ke order lain) → kembalikan stok bagian yang belum lunas.
 *
 * Modul murni (tanpa React/store) agar mudah diuji unit.
 */
export interface SplitStockSession {
  /** Signature cart saat sesi dibuat — deteksi perubahan cart antar buka/tutup. */
  cartSignature: string;
  /** Deduksi stok PENUH (seluruh item cart) yang di-reserve. */
  reserved: Record<string, number>;
  /** Deduksi stok yang sudah "terpakai sah" oleh sub-bill lunas — di-CAP pada nilai reserved. */
  paid: Record<string, number>;
  /** Flag visit/promo — dicatat sekali per sesi split (bukan sekali per buka modal). */
  visitRecorded: boolean;

  // v4.5 TO DO 5.7: sub-bill yang sudah lunas (index → info bayar) — dipakai rehydrate paidState UI
  // saat modal dibuka ulang (resume sesi 5.1) agar sub-bill yang lunas tidak bisa dibayar ganda.
  paidBills?: Record<number, { payMethod: PaymentMethod; cash: number }>;
  // v4.5 TO DO 5.7/5.9: konfigurasi split & nomor antrean sesi — restore UI + SATU nomor per order fresh.
  mode?: 'equal' | 'item';
  count?: number;
  queueNumber?: number;
}

/**
 * Signature stabil dari isi cart: menuId + quantity + addons + suhu + gula.
 * Dipakai untuk membandingkan "cart yang sama" antar buka/tutup modal split.
 */
export function computeCartSignature(items: CartItem[]): string {
  return JSON.stringify(
    items
      .map(
        (i) =>
          `${i.menuId}:${i.quantity}:${i.addons.map((a) => a.name).join(',')}:${i.temperature || ''}:${i.sugar || ''}`
      )
      .sort()
  );
}

export function createSplitStockSession(
  cartSignature: string,
  reserved: Record<string, number>
): SplitStockSession {
  return { cartSignature, reserved, paid: {}, visitRecorded: false };
}

/**
 * v4.5 TO DO 5.7 — Catat sub-bill yang lunas ke session (index → info bayar).
 * Dipakai rehydrate `paidState` UI saat modal dibuka ulang (resume sesi 5.1): sub-bill yang
 * sudah lunas tetap tampil lunas → tidak bisa dibayar dua kali (duplikasi revenue).
 */
export function recordPaidBill(
  session: SplitStockSession,
  billIdx: number,
  payMethod: PaymentMethod,
  cash: number
): void {
  session.paidBills = { ...(session.paidBills || {}), [billIdx]: { payMethod, cash } };
}

/**
 * Akumulasi porsi sub-bill yang lunas ke `session.paid`.
 * Di-CAP pada nilai `reserved` per inventoryId — tanpa cap, mode Equal (semua sub-bill membawa
 * semua item) mengakumulasi deduksi penuh berulang per sub-bill → `reserved − paid ≤ 0` → tidak
 * ada revert yang benar → stok bocor ganda.
 */
export function accumulatePaidPortion(
  session: SplitStockSession,
  portion: Record<string, number>
): void {
  for (const [invId, qty] of Object.entries(portion)) {
    const cap = session.reserved[invId] || 0;
    session.paid[invId] = Math.min(cap, (session.paid[invId] || 0) + qty);
  }
}

/**
 * Sisa stok yang BELUM lunas (reserved − paid, hanya nilai positif).
 * Dipakai saat sesi dibatalkan (cart berubah) — bagian yang sudah lunas TIDAK boleh di-revert
 * (stoknya sudah terpakai sah oleh transaksi sub-bill yang tercatat).
 */
export function computeUnpaidPortion(session: SplitStockSession): Record<string, number> {
  const remaining: Record<string, number> = {};
  for (const [invId, fullQty] of Object.entries(session.reserved)) {
    const diff = fullQty - (session.paid[invId] || 0);
    if (diff > 0) remaining[invId] = diff;
  }
  return remaining;
}

// ============ Persistensi lintas reload (recovery) ============
// Sesi disimpan ke localStorage agar hard-refresh / restart PWA tidak kehilangan state reserve
// (jika session hilang padahal stok sudah ter-deduct, buka modal lagi akan deduct ganda).

const STORAGE_KEY = 'rempah-split-stock-session';

export function loadSplitStockSession(): SplitStockSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.cartSignature === 'string' &&
      parsed.reserved &&
      parsed.paid
    ) {
      return parsed as SplitStockSession;
    }
    return null;
  } catch (e) {
    console.warn('[SplitStockSession] Gagal memuat session:', e);
    return null;
  }
}

export function persistSplitStockSession(session: SplitStockSession | null): void {
  try {
    if (session) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    console.warn('[SplitStockSession] Gagal menyimpan session (kuota?):', e);
  }
}

// ============ Holder session module-level (singleton) ============
// Sesi aktif dipegang di sini (bukan di komponen) agar SplitBillModal DAN POS dapat mengaksesnya:
// POS perlu melepaskan reserve saat kasir beralih dari split (modal ditutup di tengah) ke
// checkout NORMAL dari cart yang sama — jika tidak, engine akan deduct stok penuh lagi di atas
// reserve yang masih di-hold → double deduction.

let activeSplitStockSession: SplitStockSession | null = loadSplitStockSession();

export function getActiveSplitStockSession(): SplitStockSession | null {
  return activeSplitStockSession;
}

export function setActiveSplitStockSession(session: SplitStockSession | null): void {
  activeSplitStockSession = session;
  persistSplitStockSession(session);
}

/**
 * Lepaskan reserve sesi split untuk cart yang sama (digunakan POS sebelum checkout NORMAL).
 * Mengembalikan stok bagian yang belum lunas (reserved − paid) agar pemanggil me-revert-nya,
 * lalu membersihkan sesi. No-op (null) jika tidak ada sesi aktif atau cart berbeda.
 */
export function releaseSplitReserveForCart(
  items: CartItem[]
): Record<string, number> | null {
  if (!activeSplitStockSession) return null;
  if (activeSplitStockSession.cartSignature !== computeCartSignature(items)) return null;
  const unpaid = computeUnpaidPortion(activeSplitStockSession);
  activeSplitStockSession = null;
  persistSplitStockSession(null);
  return unpaid;
}
