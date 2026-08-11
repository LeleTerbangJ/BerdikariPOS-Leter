import { describe, it, expect } from 'vitest';
import {
  diagnoseCashMovementWriteError,
  CASH_MOVEMENTS_POLICY_SQL,
  type CashMovementWriteDiagnosis,
} from '../utils/cashMovementPolicy';

describe('diagnoseCashMovementWriteError', () => {
  const cases: Array<{ name: string; message: string | null | undefined; expected: CashMovementWriteDiagnosis }> = [
    {
      name: 'RLS aktif tanpa policy → rls-missing-policy',
      message: 'new row violates row-level security policy for table "cash_movements"',
      expected: 'rls-missing-policy',
    },
    {
      name: 'Check constraint (tabel sehat) → ok',
      message: 'new row for relation "cash_movements" violates check constraint "cash_movements_type_check" on table "cash_movements"',
      expected: 'ok',
    },
    {
      name: 'Check constraint gaya lain → ok',
      message: 'new row violates check-constraint "cash_movements_type_check"',
      expected: 'ok',
    },
    {
      name: 'Tabel tidak ada → table-missing',
      message: 'relation "public.cash_movements" does not exist',
      expected: 'table-missing',
    },
    {
      name: 'Tidak ada error (probe sukses) → ok',
      message: null,
      expected: 'ok',
    },
    {
      name: 'Error lain (network/permission) → unknown',
      message: 'Failed to fetch',
      expected: 'unknown',
    },
    {
      name: 'Error kosong string → ok',
      message: '',
      expected: 'ok',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(diagnoseCashMovementWriteError(c.message)).toBe(c.expected);
    });
  }

  it('CASH_MOVEMENTS_POLICY_SQL idempoten: memuat DO block cek pg_policies + CREATE POLICY + ENABLE RLS', () => {
    expect(CASH_MOVEMENTS_POLICY_SQL).toContain('SELECT 1 FROM pg_policies');
    expect(CASH_MOVEMENTS_POLICY_SQL).toContain('tablename = \'cash_movements\'');
    expect(CASH_MOVEMENTS_POLICY_SQL).toContain('CREATE POLICY "Allow all for anon" ON cash_movements FOR ALL USING (true) WITH CHECK (true)');
    expect(CASH_MOVEMENTS_POLICY_SQL).toContain('ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY');
  });
});
