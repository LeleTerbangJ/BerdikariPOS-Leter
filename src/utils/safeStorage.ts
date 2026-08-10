/**
 * v4.5 TO DO 6.1 — Safe Storage wrapper untuk zustand persist.
 *
 * Masalah: zustand v4 persist dengan storage sinkron (localStorage) MELEMPAR
 * QuotaExceededError secara sinkron ke pemanggil `set()` (lihat
 * node_modules/zustand/system/middleware.development.js — `void setItem()`).
 * Akibatnya operasi bisnis (checkout, simpan pending, tutup shift, addLog) bisa
 * gagal/di-rollback padahal data sudah aman di memory & cloud.
 *
 * Solusi: bungkus localStorage agar setItem TIDAK pernah melempar — error tulis
 * (kuota penuh) ditelan + console.warn. Implementasi Storage-compliant sehingga
 * bisa dipakai langsung di `createJSONStorage(() => safeStorage)`.
 */
export const safeStorage: Storage = {
  get length() {
    try {
      return localStorage.length;
    } catch {
      return 0;
    }
  },
  clear() {
    try {
      localStorage.clear();
    } catch (e) {
      console.warn('[SafeStorage] clear() gagal:', e);
    }
  },
  getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  key(index) {
    try {
      return localStorage.key(index);
    } catch {
      return null;
    }
  },
  removeItem(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.warn(`[SafeStorage] removeItem("${key}") gagal:`, e);
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      // QuotaExceededError (atau private mode) — jangan dilempar ke alur bisnis.
      // Data tetap hidup di memory & cloud (sync terpisah); persist hanyalah cache lokal.
      console.warn(
        `[SafeStorage] Gagal menulis "${key}" ke localStorage (kemungkinan kuota penuh). ` +
          'Data aman di memori & cloud — hanya cache lokal yang tidak tersimpan.',
        e
      );
    }
  },
};
