/**
 * Deteksi misconfiguration RLS pada tabel `cash_movements` (v4.6 fix).
 *
 * Latar belakang: RLS yang aktif TANPA policy membuat anon key diblokir diam-diam —
 * SELECT mengembalikan baris kosong TANPA error, INSERT ditolak dengan
 * "new row violates row-level security policy". Gejala: Rekap Kas (Kas Masuk/Kas Keluar)
 * tidak pernah tersinkron antar device dan laporan Shift Manager selalu menampilkan 0.
 *
 * anon key tidak bisa membaca pg_policies (pg_catalog tidak diekspos) dan tidak bisa
 * mengeksekusi DDL. Maka deteksi dilakukan via "probe INSERT" yang sengaja melanggar
 * CHECK constraint `type IN ('in','out')`:
 *  - Healthy (RLS off / policy ada)  → error CHECK constraint (baris TIDAK pernah dibuat)
 *  - RLS aktif tanpa policy          → error row-level security (diblokir SEBELUM constraint)
 *  - Tabel tidak ada                 → error relation does not exist
 */

export type CashMovementWriteDiagnosis = 'ok' | 'rls-missing-policy' | 'table-missing' | 'unknown';

/** Error message dari PostgREST/Postgres → diagnosis. Kosong = probe berhasil (tidak mungkin utk CHECK). */
export function diagnoseCashMovementWriteError(errorMessage: string | null | undefined): CashMovementWriteDiagnosis {
  if (!errorMessage) return 'ok';
  if (errorMessage.includes('row-level security')) return 'rls-missing-policy';
  // RLS lolos tapi ditolak CHECK → tabel sehat, tulis berfungsi
  if (errorMessage.includes('check constraint') || errorMessage.includes('check-constraint')) return 'ok';
  if (errorMessage.includes('does not exist')) return 'table-missing';
  return 'unknown';
}

/** SQL idempoten untuk memperbaiki DB lama: buat policy bila belum ada + pastikan RLS aktif. */
export const CASH_MOVEMENTS_POLICY_SQL = `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'cash_movements'
      AND policyname = 'Allow all for anon'
  ) THEN
    CREATE POLICY "Allow all for anon" ON cash_movements FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;`;
