/**
 * Cloud Sync Service
 * 
 * Provides functions to sync local Zustand state with Supabase.
 * Strategy: Local-first with background sync.
 * - Writes go to both localStorage (instant) and Supabase (async)
 * - Reads prefer Supabase if available, fallback to localStorage
 * - Real-time subscriptions for KDS (transactions table)
 */

import { supabase, isSupabaseConfigured } from './supabase';
import { smartUpsert, smartUpdate, smartDelete, smartInsert } from './offlineQueue';
export { smartUpsert, smartUpdate, smartDelete, smartInsert };
import type { 
  User, InventoryItem, Menu, Transaction, Customer, 
  CashierShift, Promo, AuditLogEntry, AppSettings, LoyaltySettings,
  StockOpname, CashMovement
} from '../types';
import type { StockLogEntry } from '../store/stockLogStore';
import { diagnoseCashMovementWriteError, CASH_MOVEMENTS_POLICY_SQL } from '../utils/cashMovementPolicy';

// ============================================================
// DATABASE MIGRATIONS — run once on app startup
// ============================================================

/**
 * Ensures that the database schema is up-to-date.
 * Attempts to add missing columns. Safe to call multiple times.
 */
export async function runMigrations() {
  if (!isSupabaseConfigured) return;
  try {
    // Migration 1: Add manual_hpp column to menus table
    const { error } = await supabase.from('menus').select('manual_hpp').limit(1);
    if (error && error.message.includes('manual_hpp')) {
      console.warn('[Migration] Column "manual_hpp" missing in menus table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE menus ADD COLUMN IF NOT EXISTS manual_hpp FLOAT DEFAULT 0;');
      migrationNeeded.manualHpp = true;
    }

    // Migration 2: Add active_session_id column to users table
    const { error: userError } = await supabase.from('users').select('active_session_id').limit(1);
    if (userError && userError.message.includes('active_session_id')) {
      console.warn('[Migration] Column "active_session_id" missing in users table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_id TEXT;');
      migrationNeeded.activeSessionId = true;
    }

    // Migration 3: Add tax column to transactions table (GAP-3 fix)
    const { error: txError } = await supabase.from('transactions').select('tax').limit(1);
    if (txError && txError.message.includes('tax')) {
      console.warn('[Migration] Column "tax" missing in transactions table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax INT DEFAULT 0;');
      migrationNeeded.tax = true;
    }

    // Migration 4: Add kitchen_target column to menus table
    const { error: kitchenTargetError } = await supabase.from('menus').select('kitchen_target').limit(1);
    if (kitchenTargetError && kitchenTargetError.message.includes('kitchen_target')) {
      console.warn('[Migration] Column "kitchen_target" missing in menus table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE menus ADD COLUMN IF NOT EXISTS kitchen_target TEXT DEFAULT NULL;');
      migrationNeeded.kitchenTarget = true;
    }

    // Migration 5: Add kitchen_printers column to settings table
    const { error: kitchenPrintersError } = await supabase.from('settings').select('kitchen_printers').limit(1);
    if (kitchenPrintersError && kitchenPrintersError.message.includes('kitchen_printers')) {
      console.warn('[Migration] Column "kitchen_printers" missing in settings table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS kitchen_printers JSONB DEFAULT \'[]\';');
      migrationNeeded.kitchenPrinters = true;
    }

    // Migration 6: Add show_sugar_level column to menus table
    const { error: sugarError } = await supabase.from('menus').select('show_sugar_level').limit(1);
    if (sugarError && sugarError.message.includes('show_sugar_level')) {
      console.warn('[Migration] Column "show_sugar_level" missing in menus table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE menus ADD COLUMN IF NOT EXISTS show_sugar_level BOOLEAN DEFAULT TRUE;');
      migrationNeeded.showSugarLevel = true;
    }

    // Migration 7: Add theme_color column to settings table
    const { error: themeColorError } = await supabase.from('settings').select('theme_color').limit(1);
    if (themeColorError && themeColorError.message.includes('theme_color')) {
      console.warn('[Migration] Column "theme_color" missing in settings table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS theme_color TEXT;');
      migrationNeeded.themeColor = true;
    }

    // Migration 8: Add theme_shades column to settings table
    const { error: themeShadesError } = await supabase.from('settings').select('theme_shades').limit(1);
    if (themeShadesError && themeShadesError.message.includes('theme_shades')) {
      console.warn('[Migration] Column "theme_shades" missing in settings table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS theme_shades JSONB;');
      migrationNeeded.themeShades = true;
    }

    // Migration 9: Add show_temperature column to menus table
    const { error: tempError } = await supabase.from('menus').select('show_temperature').limit(1);
    if (tempError && tempError.message.includes('show_temperature')) {
      console.warn('[Migration] Column "show_temperature" missing in menus table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE menus ADD COLUMN IF NOT EXISTS show_temperature BOOLEAN DEFAULT TRUE;');
      migrationNeeded.showTemperature = true;
    }

    // Migration 10: Add order_type column to transactions table
    const { error: orderTypeError } = await supabase.from('transactions').select('order_type').limit(1);
    if (orderTypeError && orderTypeError.message.includes('order_type')) {
      console.warn('[Migration] Column "order_type" missing in transactions table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_type TEXT;');
      migrationNeeded.orderType = true;
    }

    // Migration 11: Add table_features column to settings table
    const { error: tableFeaturesError } = await supabase.from('settings').select('table_features').limit(1);
    if (tableFeaturesError && tableFeaturesError.message.includes('table_features')) {
      console.warn('[Migration] Column "table_features" missing in settings table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_features JSONB DEFAULT \'{"enabled": false, "tables": ["Meja 1", "Meja 2", "Meja 3", "Meja 4", "Meja 5"]}\';');
      migrationNeeded.tableFeatures = true;
    }

    // Migration 12: Add table_number column to transactions table
    const { error: tableNumError } = await supabase.from('transactions').select('table_number').limit(1);
    if (tableNumError && tableNumError.message.includes('table_number')) {
      console.warn('[Migration] Column "table_number" missing in transactions table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_number TEXT;');
      migrationNeeded.tableNumber = true;
    }

    // Migration 13: Add tax_enabled column to settings table
    const { error: taxEnabledError } = await supabase.from('settings').select('tax_enabled').limit(1);
    if (taxEnabledError && taxEnabledError.message.includes('tax_enabled')) {
      console.warn('[Migration] Column "tax_enabled" missing in settings table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT FALSE;');
      migrationNeeded.taxEnabled = true;
    }

    // Migration 14: Add demo_mode column to settings table
    const { error: demoModeError } = await supabase.from('settings').select('demo_mode').limit(1);
    if (demoModeError && demoModeError.message.includes('demo_mode')) {
      console.warn('[Migration] Column "demo_mode" missing in settings table.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS demo_mode BOOLEAN DEFAULT TRUE;');
      migrationNeeded.demoMode = true;
    }

    // Migration 15: Add pending/split columns to transactions table (Pending Payment & Split Bill v4.1)
    // PostgREST returns an error if ANY of these columns is missing, so one query validates all of them.
    const pendingColumns = ['table_name', 'is_pending', 'pending_notes', 'split_parent_id', 'split_index', 'total_split_count', 'paid_amount'];
    const { error: pendingColError } = await supabase
      .from('transactions')
      .select(pendingColumns.join(','))
      .limit(1);
    // PostgREST mengembalikan error format: Could not find the 'is_pending' column of 'transactions' in the schema cache
    // Cukup cek apakah nama kolom yang hilang muncul di pesan error.
    const pendingColMissing =
      !!pendingColError &&
      pendingColumns.some((c) => pendingColError.message?.includes(c));
    if (pendingColMissing) {
      console.warn('[Migration] Kolom Pending/Split Bill belum ada di tabel transactions (fitur Pending Payment & Split Bill v4.1).');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  DO $$ DECLARE cname TEXT; BEGIN');
      console.warn('    SELECT conname INTO cname FROM pg_constraint');
      console.warn('    WHERE conrelid = \'transactions\'::regclass AND contype = \'c\' AND pg_get_constraintdef(oid) LIKE \'%tx_status%\';');
      console.warn('    IF cname IS NOT NULL THEN EXECUTE format(\'ALTER TABLE transactions DROP CONSTRAINT %I\', cname); END IF;');
      console.warn('  END $$;');
      console.warn('  ALTER TABLE transactions ADD CONSTRAINT transactions_tx_status_check CHECK (tx_status IN (\'Selesai\', \'Cancel\', \'Pending\', \'Demo\'));');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_name TEXT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_pending BOOLEAN DEFAULT FALSE;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pending_notes TEXT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_parent_id TEXT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_index INT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_split_count INT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paid_amount FLOAT;');
      migrationNeeded.tableName = true;
      migrationNeeded.isPending = true;
      migrationNeeded.pendingNotes = true;
      migrationNeeded.splitParentId = true;
      migrationNeeded.splitIndex = true;
      migrationNeeded.totalSplitCount = true;
      migrationNeeded.paidAmount = true;
    }

    // Migration 16: Add receipt print columns to settings table (TO DO 2.7)
    // syncSettings menulis keempat kolom ini — tanpa deteksi, upsert pada DB lama akan gagal dan
    // menumpuk offline queue. Deteksi dalam satu query (PostgREST error bila salah satu hilang).
    const receiptPrintColumns = ['receipt_ascii_only', 'auto_print_receipt', 'receipt_header', 'receipt_footer'];
    const { error: receiptPrintError } = await supabase
      .from('settings')
      .select(receiptPrintColumns.join(','))
      .limit(1);
    const receiptPrintMissing =
      !!receiptPrintError &&
      receiptPrintColumns.some((c) => receiptPrintError.message?.includes(c));
    if (receiptPrintMissing) {
      console.warn('[Migration] Kolom cetak struk di settings belum lengkap (TO DO 2.7): receipt_ascii_only / auto_print_receipt / receipt_header / receipt_footer.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_header TEXT;');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_footer TEXT;');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_ascii_only BOOLEAN DEFAULT FALSE;');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_print_receipt BOOLEAN DEFAULT FALSE;');
      migrationNeeded.receiptAsciiOnly = true;
      migrationNeeded.autoPrintReceipt = true;
      migrationNeeded.receiptHeader = true;
      migrationNeeded.receiptFooter = true;
    }
    // Migration 17: Add pending promo columns to transactions table (TO DO 5.5)
    // syncTransaction menulis applied_promo_id/voucher_code — deteksi agar upsert pada DB lama tidak gagal.
    const pendingPromoColumns = ['applied_promo_id', 'voucher_code'];
    const { error: pendingPromoError } = await supabase
      .from('transactions')
      .select(pendingPromoColumns.join(','))
      .limit(1);
    const pendingPromoMissing =
      !!pendingPromoError &&
      pendingPromoColumns.some((c) => pendingPromoError.message?.includes(c));
    if (pendingPromoMissing) {
      console.warn('[Migration] Kolom promo pending belum ada di transactions (TO DO 5.5): applied_promo_id / voucher_code.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS applied_promo_id TEXT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voucher_code TEXT;');
      migrationNeeded.appliedPromoId = true;
      migrationNeeded.voucherCode = true;
    }

    // Migration 19 (v4.7 TO DO 10.2/10.3): kolom otorisasi opname di stock_opnames.
    // syncStockOpname menulis approver_id/approver_name/approver_role/approved_at/device_id/
    // adjustment_reason — deteksi agar upsert pada DB lama tidak gagal (mencegah penumpukan offline queue).
    const opnameColumns = ['approver_id', 'approver_name', 'approver_role', 'approved_at', 'device_id', 'adjustment_reason'];
    const { error: opnameColError } = await supabase
      .from('stock_opnames')
      .select(opnameColumns.join(','))
      .limit(1);
    const opnameColumnsMissing =
      !!opnameColError &&
      opnameColumns.some((c) => opnameColError.message?.includes(c));
    if (opnameColumnsMissing) {
      console.warn('[Migration] Kolom otorisasi opname belum ada di stock_opnames (TO DO 10.2/10.3): approver_id / approver_name / approver_role / approved_at / device_id / adjustment_reason.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_id TEXT;');
      console.warn('  ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_name TEXT;');
      console.warn('  ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approver_role TEXT;');
      console.warn('  ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;');
      console.warn('  ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS device_id TEXT;');
      console.warn('  ALTER TABLE stock_opnames ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;');
      migrationNeeded.opnameApprover = true;
    }

    // Migration 20 (v4.7 TO DO 11.2 / P0.2): kolom refund transaksi.
    // updateTxMeta menulis refunded/refunded_at/refunded_amount/refund_note/refunded_by_id/
    // refunded_by_name — deteksi agar smartUpdate pada DB lama tidak gagal.
    const refundColumns = ['refunded', 'refunded_at', 'refunded_amount', 'refund_note', 'refunded_by_id', 'refunded_by_name'];
    const { error: refundColError } = await supabase
      .from('transactions')
      .select(refundColumns.join(','))
      .limit(1);
    const refundColumnsMissing =
      !!refundColError &&
      refundColumns.some((c) => refundColError.message?.includes(c));
    if (refundColumnsMissing) {
      console.warn('[Migration] Kolom refund transaksi belum ada di transactions (TO DO 11.2 / P0.2): refunded / refunded_at / refunded_amount / refund_note / refunded_by_id / refunded_by_name.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT FALSE;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_amount FLOAT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refund_note TEXT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_id TEXT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded_by_name TEXT;');
      migrationNeeded.refunded = true;
    }

    // Migration 21 (v4.7 TO DO 11.2 / P0.4): kolom auto_send_digital_receipt di settings.
    // syncSettings menulis kolom ini — deteksi agar upsert pada DB lama tidak gagal (mencegah
    // penumpukan offline queue), konsisten dengan pola Migration 16 (kolom cetak struk).
    const { error: autoSendColError } = await supabase
      .from('settings')
      .select('auto_send_digital_receipt')
      .limit(1);
    if (autoSendColError && autoSendColError.message?.includes('auto_send_digital_receipt')) {
      console.warn('[Migration] Kolom auto_send_digital_receipt belum ada di settings (TO DO 11.2 / P0.4).');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_send_digital_receipt BOOLEAN DEFAULT FALSE;');
      migrationNeeded.autoSendDigitalReceipt = true;
    }

    // Migration 22 (v4.7 TO DO 12.2.4 / P-A3): kolom performa promo di transactions.
    // syncTransaction menulis promo_name/promo_amount — deteksi agar upsert pada DB lama tidak
    // gagal (mencegah penumpukan offline queue), konsisten dengan pola Migration 17.
    const promoPerfColumns = ['promo_name', 'promo_amount'];
    const { error: promoPerfError } = await supabase
      .from('transactions')
      .select(promoPerfColumns.join(','))
      .limit(1);
    const promoPerfMissing =
      !!promoPerfError &&
      promoPerfColumns.some((c) => promoPerfError.message?.includes(c));
    if (promoPerfMissing) {
      console.warn('[Migration] Kolom performa promo belum ada di transactions (TO DO 12.2.4 / P-A3): promo_name / promo_amount.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_name TEXT;');
      console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_amount FLOAT;');
      migrationNeeded.promoName = true;
      migrationNeeded.promoAmount = true;
    }

    // Migration 23 (v4.7 TO DO 12.2.3 / P-A4): kolom stackable di promos.
    // syncPromo menulis stackable — deteksi agar upsert pada DB lama tidak gagal.
    const { error: stackableColError } = await supabase
      .from('promos')
      .select('stackable')
      .limit(1);
    if (stackableColError && stackableColError.message?.includes('stackable')) {
      console.warn('[Migration] Kolom stackable belum ada di promos (TO DO 12.2.3 / P-A4).');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE promos ADD COLUMN IF NOT EXISTS stackable BOOLEAN DEFAULT TRUE;');
      migrationNeeded.promoStackable = true;
    }

    // Migration 24 (v4.7 TO DO 12.2.5 / P-A5): BOGO & min-qty di promos.
    // syncPromo menulis min_qty/bogo_config dan type='bogo' (CHECK constraint lama hanya
    // percentage/fixed) — deteksi kolom agar upsert pada DB lama tidak gagal, dan cetak
    // SQL relax constraint type (idempoten, pola sama dengan migrasi tx_status).
    const bogoColumns = ['min_qty', 'bogo_config'];
    const { error: bogoColError } = await supabase
      .from('promos')
      .select(bogoColumns.join(','))
      .limit(1);
    const bogoColumnsMissing =
      !!bogoColError &&
      bogoColumns.some((c) => bogoColError.message?.includes(c));
    if (bogoColumnsMissing) {
      console.warn('[Migration] Kolom BOGO/min-qty belum ada di promos (TO DO 12.2.5 / P-A5): min_qty / bogo_config + izinkan type bogo.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE promos ADD COLUMN IF NOT EXISTS min_qty INT;');
      console.warn('  ALTER TABLE promos ADD COLUMN IF NOT EXISTS bogo_config JSONB;');
      console.warn('  DO $$ DECLARE cname TEXT; BEGIN');
      console.warn("    SELECT conname INTO cname FROM pg_constraint WHERE conrelid = 'promos'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%percentage%';");
      console.warn("    IF cname IS NOT NULL THEN EXECUTE format('ALTER TABLE promos DROP CONSTRAINT %I', cname); END IF;");
      console.warn('  END $$;');
      console.warn("  ALTER TABLE promos ADD CONSTRAINT promos_type_check CHECK (type IN ('percentage', 'fixed', 'bogo'));");
      migrationNeeded.promoMinQty = true;
      migrationNeeded.promoBogoConfig = true;
    }

    // Migration 25 (v4.7 TO DO 12.2.6 / P-A6): batas pemakaian per pelanggan di promos.
    // syncPromo menulis usage_limit_per_customer/usage_by_customer — deteksi agar upsert
    // pada DB lama tidak gagal (mencegah penumpukan offline queue).
    const perCustomerColumns = ['usage_limit_per_customer', 'usage_by_customer'];
    const { error: perCustomerColError } = await supabase
      .from('promos')
      .select(perCustomerColumns.join(','))
      .limit(1);
    const perCustomerColumnsMissing =
      !!perCustomerColError &&
      perCustomerColumns.some((c) => perCustomerColError.message?.includes(c));
    if (perCustomerColumnsMissing) {
      console.warn('[Migration] Kolom batas per pelanggan belum ada di promos (TO DO 12.2.6 / P-A6): usage_limit_per_customer / usage_by_customer.');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_limit_per_customer INT;');
      console.warn("  ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_by_customer JSONB DEFAULT '{}';");
      migrationNeeded.promoUsagePerCustomer = true;
    }

    // Migration 26 (v4.7 TO DO 12.2.2 / P-A8): kolom poin loyalty di customers.
    // syncCustomer menulis loyalty_points — deteksi agar upsert pada DB lama tidak gagal.
    const { error: loyaltyColError } = await supabase
      .from('customers')
      .select('loyalty_points')
      .limit(1);
    if (loyaltyColError && loyaltyColError.message?.includes('loyalty_points')) {
      console.warn('[Migration] Kolom loyalty_points belum ada di customers (TO DO 12.2.2 / P-A8).');
      console.warn('[Migration] Please run this SQL in Supabase SQL Editor:');
      console.warn('  ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0;');
      migrationNeeded.loyaltyPoints = true;
    }

    // Migration 27 (v4.7 TO DO 18.1 / Prioritas 18): RPC atomik penyesuaian stok
    // `adjust_inventory_stock` (optimistic concurrency — cegah lost-update 2 kasir).
    // Probe panggil RPC dengan id tak dikenal + delta 0 (tanpa efek samping):
    //   - fungsi ADA  → { ok:false, stock:null, reason:'not_found' } (sehat)
    //   - fungsi TIDAK ADA → error PGRST202 / "Could not find the function" → warn + flag.
    // Saat flag aktif, sync stok tetap jalan dengan fallback absolut (perilaku lama) sampai
    // admin menjalankan SQL sekali di Supabase SQL Editor (fungsi tidak bisa dibuat via anon key).
    try {
      const probe = await supabase.rpc('adjust_inventory_stock', {
        p_id: '__migration_probe__',
        p_delta: 0,
      });
      if (probe.error) {
        const msg = probe.error.message || '';
        if (msg.includes('Could not find the function') || msg.includes('PGRST202') || msg.includes('adjust_inventory_stock')) {
          console.warn('[Migration] Fungsi RPC adjust_inventory_stock belum ada di DB (TO DO 18.1 — optimistic concurrency stok 2 kasir).');
          console.warn('[Migration] Please run this SQL ONCE in Supabase SQL Editor (idempoten):');
          console.warn('  CREATE OR REPLACE FUNCTION adjust_inventory_stock(p_id TEXT, p_delta FLOAT)');
          console.warn('  RETURNS JSONB');
          console.warn('  LANGUAGE plpgsql');
          console.warn('  AS $$');
          console.warn('  DECLARE');
          console.warn('    v_stock FLOAT;');
          console.warn('  BEGIN');
          console.warn("    SELECT stock INTO v_stock FROM inventory WHERE id = p_id;");
          console.warn('    IF NOT FOUND THEN');
          console.warn("      RETURN jsonb_build_object('ok', false, 'stock', NULL::FLOAT, 'reason', 'not_found');");
          console.warn('    END IF;');
          console.warn('    IF p_delta < 0 AND v_stock < -p_delta THEN');
          console.warn("      RETURN jsonb_build_object('ok', false, 'stock', v_stock, 'reason', 'insufficient');");
          console.warn('    END IF;');
          console.warn('    UPDATE inventory SET stock = v_stock + p_delta, updated_at = now() WHERE id = p_id;');
          console.warn("    RETURN jsonb_build_object('ok', true, 'stock', v_stock + p_delta, 'reason', 'ok');");
          console.warn('  END;');
          console.warn('  $$;');
          migrationNeeded.inventoryStockRpc = true;
        }
      }
    } catch (e) {
      // Offline/network saat startup — jangan salah diagnosa; fallback absolut tetap aman.
    }

    // Migration 28 (v4.7 TO DO 18.2 / Prioritas 18): RPC atomik alokasi nomor antrean
    // `allocate_queue_number` (counter queue_counters) — cegah #N kembar antar kasir.
    // Probe memanggil RPC dengan date/outlet khusus (baris sampah '__probe__' tidak pernah
    // cocok dengan tanggal asli): fungsi ADA → sukses; TIDAK ADA → PGRST202 → warn + flag.
    // Saat flag aktif, getNextQueueNumber tetap jalan dengan fallback max+1 (perilaku lama).
    try {
      const queueProbe = await supabase.rpc('allocate_queue_number', {
        p_date: '__migration_probe__',
        p_outlet: '__probe__',
        p_min: 0,
      });
      if (queueProbe.error) {
        const msg = queueProbe.error.message || '';
        if (msg.includes('Could not find the function') || msg.includes('PGRST202') || msg.includes('allocate_queue_number')) {
          console.warn('[Migration] Fungsi RPC allocate_queue_number belum ada di DB (TO DO 18.2 — cegah nomor antrean duplikat antar kasir).');
          console.warn('[Migration] Please run this SQL ONCE in Supabase SQL Editor (idempoten):');
          console.warn('  CREATE TABLE IF NOT EXISTS queue_counters (outlet_id TEXT NOT NULL DEFAULT \'default\', date TEXT NOT NULL, last_number INT NOT NULL DEFAULT 0, PRIMARY KEY (outlet_id, date));');
          console.warn('  ALTER TABLE queue_counters ENABLE ROW LEVEL SECURITY;');
          console.warn('  CREATE POLICY "Allow all for anon" ON queue_counters FOR ALL USING (true) WITH CHECK (true);');
          console.warn('  CREATE OR REPLACE FUNCTION allocate_queue_number(p_date TEXT, p_outlet TEXT DEFAULT \'default\', p_min INT DEFAULT 0)');
          console.warn('  RETURNS INT LANGUAGE plpgsql AS $$');
          console.warn('  DECLARE');
          console.warn('    v_next INT;');
          console.warn('  BEGIN');
          console.warn('    INSERT INTO queue_counters (outlet_id, date, last_number)');
          console.warn('    VALUES (p_outlet, p_date, GREATEST(0, p_min) + 1)');
          console.warn('    ON CONFLICT (outlet_id, date)');
          console.warn('    DO UPDATE SET last_number = GREATEST(queue_counters.last_number + 1, p_min + 1)');
          console.warn('    RETURNING last_number INTO v_next;');
          console.warn('    RETURN v_next;');
          console.warn('  END;');
          console.warn('  $$;');
          migrationNeeded.queueCounterRpc = true;
        }
      }
    } catch (e) {
      // Offline/network saat startup — jangan salah diagnosa.
    }

    // Migration 29 (v4.7 TO DO 18.8 / A5): kolom `updated_at` di tabel inventory — dipakai
    // last-write-wins lintas device (sync stok burst multi-device tidak boleh menimpa mutasi
    // yang lebih baru dengan nilai cloud stale). Kolom sudah ada di schema.sql CREATE TABLE;
    // ALTER idempoten ini self-heal DB lama yang dibuat sebelum kolom ada.
    try {
      const invProbe = await supabase.from('inventory').select('updated_at').limit(1);
      if (invProbe.error) {
        const invMsg = invProbe.error.message || '';
        if (invMsg.includes('updated_at')) {
          console.warn('[Migration] Kolom "updated_at" belum ada di tabel inventory (TO DO 18.8/A5 — last-write-wins lintas device).');
          console.warn('[Migration] Please run this SQL ONCE in Supabase SQL Editor (idempoten):');
          console.warn('  ALTER TABLE inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();');
          migrationNeeded.inventoryUpdatedAt = true;
        }
      }
    } catch (e) {
      // Offline/network saat startup — jangan salah diagnosa.
    }

    // Migration 30 (v4.7 TO DO 18.8 / A10): kolom `kitchen_ticket_printed_at` di tabel transactions —
    // resume pending skip cetak tiket dapur hanya bila tiket SUDAH pernah tercetak (anti tiket dobel
    // & anti tiket hilang saat printer gagal). Kolom sudah ada di schema.sql CREATE TABLE; ALTER
    // idempoten ini self-heal DB lama.
    try {
      const ktpProbe = await supabase.from('transactions').select('kitchen_ticket_printed_at').limit(1);
      if (ktpProbe.error) {
        const ktpMsg = ktpProbe.error.message || '';
        if (ktpMsg.includes('kitchen_ticket_printed_at')) {
          console.warn('[Migration] Kolom "kitchen_ticket_printed_at" belum ada di tabel transactions (TO DO 18.8/A10 — status cetak tiket dapur pending).');
          console.warn('[Migration] Please run this SQL ONCE in Supabase SQL Editor (idempoten):');
          console.warn('  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS kitchen_ticket_printed_at TIMESTAMPTZ;');
          migrationNeeded.kitchenTicketPrintedAt = true;
        }
      }
    } catch (e) {
      // Offline/network saat startup — jangan salah diagnosa.
    }

    // Verify cash_movements table (label asli "Migration 15" sudah dipakai 2x — dinormalisasi agar
    // urutan migrasi 15/16/17 tidak membingungkan, lihat TO DO 5.5)
    const { error: cmError } = await supabase.from('cash_movements').select('id').limit(1);
    if (cmError) {
      console.warn('[Migration] Table "cash_movements" missing or inaccessible in Supabase.');
      console.warn('[Migration] Please run SQL in Supabase SQL Editor to create table, RLS policy & enable Realtime:');
      console.warn('  CREATE TABLE IF NOT EXISTS public.cash_movements (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), shift_id TEXT, type TEXT NOT NULL CHECK (type IN (\'in\', \'out\')), amount NUMERIC NOT NULL DEFAULT 0, category TEXT NOT NULL, notes TEXT, cashier_id TEXT, cashier_name TEXT NOT NULL, date TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());');
      console.warn('  ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;');
      console.warn('  CREATE POLICY "Allow all for anon" ON public.cash_movements FOR ALL USING (true) WITH CHECK (true);');
      console.warn('  ALTER PUBLICATION supabase_realtime ADD TABLE public.cash_movements;');
    } else {
      // Migration 18 (v4.6): Deteksi RLS aktif TANPA policy pada cash_movements.
      // Gejala: Kas Masuk/Kas Keluar tidak pernah tersinkron antar device; SELECT anon diam-diam
      // kosong sehingga cek SELECT di atas tidak bisa menangkapnya. Probe INSERT sengaja melanggar
      // CHECK type ('PROBE') — baris TIDAK pernah dibuat; urutan evaluasi Postgres menjalankan
      // RLS SEBELUM constraint, jadi error-nya membedakan RLS vs tabel sehat.
      try {
        const probeId = crypto.randomUUID();
        const probeResult = await supabase.from('cash_movements').insert({
          id: probeId,
          type: 'PROBE', // melanggar CHECK type IN ('in','out') — ditolak di level constraint
          amount: 0,
          category: 'MIGRATION-PROBE',
          notes: 'migration-probe',
          cashier_id: 'migration-probe',
          cashier_name: 'MIGRATION-PROBE',
          date: new Date().toISOString(),
        });
        if (!probeResult.error) {
          // Varian tabel lama tanpa CHECK type — baris probe terlanjur masuk; hapus segera.
          await supabase.from('cash_movements').delete().eq('id', probeId);
        } else {
          const diagnosis = diagnoseCashMovementWriteError(probeResult.error.message);
          if (diagnosis === 'rls-missing-policy') {
            console.warn('[Migration] cash_movements: RLS aktif tanpa policy — anon key diblokir, Rekap Kas tidak pernah tersinkron antar device.');
            console.warn('[Migration] Jalankan SQL berikut SEKALI di Supabase SQL Editor agar Rekap Kas berfungsi lintas device:');
            console.warn(CASH_MOVEMENTS_POLICY_SQL);
            migrationNeeded.cashMovementPolicy = true;
          }
          // 'ok' (ditolak CHECK) = sehat; 'unknown'/'table-missing' = skip tanpa menyesatkan.
        }
      } catch (e) {
        // Probe gagal karena offline/network — jangan salah diagnosa.
      }
    }

    try {
      const ppoProbe = await supabase.from('settings').select('pending_print_option').eq('id', 1).single();
      if (ppoProbe.error && ppoProbe.error.message?.includes('pending_print_option')) {
        console.warn('[Migration] Kolom "pending_print_option" belum ada di tabel settings (v4.8).');
        console.warn('[Migration] Please run this SQL ONCE in Supabase SQL Editor (idempoten):');
        console.warn('  ALTER TABLE settings ADD COLUMN IF NOT EXISTS pending_print_option TEXT DEFAULT \'dapur_only\';');
        migrationNeeded.pendingPrintOption = true;
      }
    } catch (e) {
      // Offline/network saat startup — jangan salah diagnosa.
    }
  } catch (e) {
    console.warn('[Migration] Could not verify schema:', e);
  }
}

// Track which migrations are needed so sync functions can adapt
const migrationNeeded = { manualHpp: false, activeSessionId: false, tax: false, kitchenTarget: false, kitchenPrinters: false, showSugarLevel: false, themeColor: false, themeShades: false, showTemperature: false, orderType: false, tableFeatures: false, tableNumber: false, taxEnabled: false, demoMode: false, tableName: false, isPending: false, pendingNotes: false, splitParentId: false, splitIndex: false, totalSplitCount: false, paidAmount: false, appliedPromoId: false, voucherCode: false, receiptAsciiOnly: false, autoPrintReceipt: false, receiptHeader: false, receiptFooter: false, cashMovementPolicy: false, opnameApprover: false, refunded: false, autoSendDigitalReceipt: false, promoName: false, promoAmount: false, promoStackable: false, promoMinQty: false, promoBogoConfig: false, promoUsagePerCustomer: false, loyaltyPoints: false, inventoryStockRpc: false, queueCounterRpc: false, inventoryUpdatedAt: false, kitchenTicketPrintedAt: false, pendingPrintOption: false, kitchenItemStatus: false };
export function isMigrationNeeded(key: keyof typeof migrationNeeded) {
  return migrationNeeded[key];
}

// NOTE: camelCase↔snake_case mapping is done explicitly per sync function
// for full control and visibility of field mappings.

// ============================================================
// TRANSACTIONS (most critical for KDS real-time)
// ============================================================

// v4.7 TO DO 13.7 (O-5): return boolean agar store bisa menandai id sebagai "terkonfirmasi sync"
// (badge "Belum Sync" hilang saat transaksi benar-benar sampai ke cloud).
export async function syncTransaction(tx: Transaction): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  const data: Record<string, any> = {
    id: tx.id,
    queue_number: tx.queueNumber,
    date: tx.date,
    items: tx.items,
    subtotal: tx.subtotal,
    discount: tx.discount,
    total_amount: tx.totalAmount,
    payment_method: tx.paymentMethod,
    cash_received: tx.cashReceived,
    change: tx.change,
    kitchen_status: tx.kitchenStatus,
    tx_status: tx.txStatus,
    cashier_id: tx.cashierId,
    cashier_name: tx.cashierName,
    customer_id: tx.customerId,
    customer_name: tx.customerName,
    hpp: tx.hpp,
  };
  if (!migrationNeeded.tax) {
    data.tax = tx.tax || 0;
  }
  if (!migrationNeeded.orderType) {
    data.order_type = tx.orderType || null;
  }
  if (!migrationNeeded.tableNumber) {
    data.table_number = tx.tableNumber || tx.tableName || null;
  }
  // v4.1: Pending Payment & Split Bill columns (guarded against missing DB migration)
  if (!migrationNeeded.tableName) {
    data.table_name = tx.tableName || null;
  }
  if (!migrationNeeded.isPending) {
    data.is_pending = tx.isPending || tx.txStatus === 'Pending';
  }
  if (!migrationNeeded.pendingNotes) {
    data.pending_notes = tx.pendingNotes || null;
  }
  if (!migrationNeeded.splitParentId) {
    data.split_parent_id = tx.splitParentId || null;
  }
  if (!migrationNeeded.splitIndex) {
    data.split_index = tx.splitIndex || null;
  }
  if (!migrationNeeded.totalSplitCount) {
    data.total_split_count = tx.totalSplitCount || null;
  }
  if (!migrationNeeded.paidAmount) {
    data.paid_amount = tx.paidAmount || null;
  }
  // v4.5 TO DO 5.5: promo/voucher pending (di-restore saat resume lintas device), guard migrasi
  if (!migrationNeeded.appliedPromoId) {
    data.applied_promo_id = tx.appliedPromoId || null;
  }
  if (!migrationNeeded.voucherCode) {
    data.voucher_code = tx.voucherCode || null;
  }
  // v4.7 TO DO 12.2.4 (P-A3): snapshot performa promo (nama & nominal diskon promo saat checkout)
  if (!migrationNeeded.promoName) {
    data.promo_name = tx.promoName || null;
  }
  if (!migrationNeeded.promoAmount) {
    data.promo_amount = tx.promoAmount ?? null;
  }
  // v4.7 TO DO 18.8 (A10): waktu tiket dapur tercetak (resume skip tiket lintas device)
  if (!migrationNeeded.kitchenTicketPrintedAt) {
    data.kitchen_ticket_printed_at = tx.kitchenTicketPrintedAt || null;
  }
  return smartUpsert('transactions', data);
}

export async function syncTransactionStatus(id: string, kitchenStatus: string) {
  if (!isSupabaseConfigured) return;
  await smartUpdate('transactions', { kitchen_status: kitchenStatus }, 'id', id);
}

export async function syncTransactionTxStatus(id: string, txStatus: string) {
  if (!isSupabaseConfigured) return;
  // v4.5 TO DO 5.10: ikut tulis is_pending (guard migrasi) agar kolom DB tidak stale —
  // sebelumnya hanya tx_status yang disync → is_pending di DB tetap true untuk order yang
  // sudah lunas/batal → device lain masih melihatnya sebagai Pending.
  const data: Record<string, any> = { tx_status: txStatus };
  if (!migrationNeeded.isPending) {
    data.is_pending = txStatus === 'Pending';
  }
  await smartUpdate('transactions', data, 'id', id);
}

// v4.5 TO DO 5.8: sync metadata transaksi terpilih ke cloud (payment_method parent split).
// v4.7 TO DO 11.2 (P0.2): + kolom refund. Field yang didukung dipetakan eksplisit — field lain
// diabaikan agar tidak menulis kolom tak dikenal (mencegah penumpukan offline queue).
export async function syncTransactionMeta(id: string, partial: Partial<Transaction>) {
  if (!isSupabaseConfigured) return;
  const data: Record<string, any> = {};
  if (partial.paymentMethod !== undefined) {
    data.payment_method = partial.paymentMethod;
  }
  if (!migrationNeeded.refunded) {
    if (partial.refunded !== undefined) data.refunded = partial.refunded;
    if (partial.refundedAt !== undefined) data.refunded_at = partial.refundedAt;
    if (partial.refundedAmount !== undefined) data.refunded_amount = partial.refundedAmount;
    if (partial.refundNote !== undefined) data.refund_note = partial.refundNote;
    if (partial.refundedById !== undefined) data.refunded_by_id = partial.refundedById;
    if (partial.refundedByName !== undefined) data.refunded_by_name = partial.refundedByName;
  }
  // v4.7 TO DO 18.8 (A10): waktu tiket dapur tercetak — resume skip tiket di device lain
  if (!migrationNeeded.kitchenTicketPrintedAt) {
    if (partial.kitchenTicketPrintedAt !== undefined) data.kitchen_ticket_printed_at = partial.kitchenTicketPrintedAt;
  }
  // v4.8 TO DO 23.6: sync kitchenItemStatus per-item ke cloud (JSON)
  if (!migrationNeeded.kitchenItemStatus) {
    if (partial.items !== undefined) {
      // Simpan items dengan kitchenItemStatus ke cloud
      data.items = partial.items;
    }
  }
  if (Object.keys(data).length > 0) {
    await smartUpdate('transactions', data, 'id', id);
  }
}

export async function deleteTransactionCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('transactions', 'id', id);
}

// v4.7 TO DO 18.2 (Prioritas 18): baca max(queue_number) hari ini dari cloud (tanpa Demo/Cancel).
// Dipakai getNextQueueNumber sebagai FLOOR — nomor yang sudah terpakai tidak boleh di-alokasi ulang.
// Mengembalikan 0 bila offline / tidak dikonfigurasi / query gagal (fallback lokal).
export async function fetchMaxQueueNumberCloud(dateStr: string): Promise<number> {
  if (!isSupabaseConfigured) return 0;
  if (navigator.onLine === false) return 0;
  try {
    // v4.7 TO DO 18.3 (fix): `dateStr` = tanggal LOKAL. Range harus dibangun dari
    // tengah malam LOKAL lalu dikonversi ke ISO UTC — memakai `T00:00:00.000Z`
    // langsung (UTC) membuat transaksi jam 00:00–07:00 WIB (UTC = tanggal sebelumnya)
    // terlewat → cloudMax terlalu rendah → nomor antrean bisa menabrak #N yang ada.
    const localMidnight = new Date(`${dateStr}T00:00:00`);
    const todayStart = localMidnight.toISOString();
    const localEnd = new Date(`${dateStr}T23:59:59.999`);
    const todayEnd = localEnd.toISOString();
    const { data, error } = await supabase
      .from('transactions')
      .select('queue_number')
      .gte('date', todayStart)
      .lte('date', todayEnd)
      .neq('tx_status', 'Demo')
      .neq('tx_status', 'Cancel')
      .order('queue_number', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return 0;
    return data[0].queue_number || 0;
  } catch (e) {
    return 0;
  }
}

// v4.7 TO DO 18.2 (Prioritas 18): alokasi nomor antrean ATOMIK dari counter cloud
// `allocate_queue_number` (tabel queue_counters + row-lock upsert). Dua kasir yang
// memproses bersamaan TIDAK bisa mendapat nomor sama saat online.
//   - `floor` = max(cloudMax, localMax) hari ini → nomor tidak menabrak transaksi yang sudah ada.
//   - Mengembalikan nomor teralokasi, atau NULL bila: offline / RPC belum dibuat di DB
//     (flag queueCounterRpc) / error / respons tak terduga → pemanggil fallback max+1 lokal.
export async function allocateQueueNumberCloud(dateStr: string, floor: number): Promise<number | null> {
  if (!isSupabaseConfigured) return null;
  if (navigator.onLine === false || migrationNeeded.queueCounterRpc) return null;
  try {
    const { data, error } = await supabase.rpc('allocate_queue_number', {
      p_date: dateStr,
      p_outlet: 'default',
      p_min: floor,
    });
    if (error) return null;
    return typeof data === 'number' && data > 0 ? data : null;
  } catch (e) {
    return null;
  }
}

export async function fetchTransactionsFromCloud(): Promise<Transaction[] | null> {
  if (!isSupabaseConfigured) { console.log('[CloudSync] Not configured'); return null; }
  try {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false })
      .limit(500);
    if (error) { console.error('[CloudSync] Fetch error:', error.message); throw error; }
    console.log('[CloudSync] Fetched', data?.length || 0, 'transactions from cloud');
    return data?.map((row) => ({
      id: row.id,
      queueNumber: row.queue_number,
      date: row.date,
      items: row.items,
      subtotal: row.subtotal,
      discount: row.discount,
      totalAmount: row.total_amount,
      paymentMethod: row.payment_method,
      cashReceived: row.cash_received,
      change: row.change,
      kitchenStatus: row.kitchen_status,
      txStatus: row.tx_status,
      cashierId: row.cashier_id,
      cashierName: row.cashier_name,
      customerId: row.customer_id,
      customerName: row.customer_name,
      hpp: row.hpp,
      tax: row.tax || 0,
      orderType: row.order_type || undefined,
      tableNumber: row.table_number || row.table_name || undefined,
      tableName: row.table_name || row.table_number || undefined,
      // v4.5 TO DO 5.10: tx_status adalah otoritatif — kolom is_pending bisa stale (true) untuk
      // order yang sudah lunas/batal di era sebelum syncTransactionTxStatus menulis is_pending.
      isPending: row.tx_status === 'Pending',
      // v4.7 TO DO 11.2 (P0.2): baca balik status refund lintas device
      refunded: row.refunded || false,
      refundedAt: row.refunded_at || undefined,
      refundedAmount: row.refunded_amount || undefined,
      refundNote: row.refund_note || undefined,
      refundedById: row.refunded_by_id || undefined,
      refundedByName: row.refunded_by_name || undefined,
      pendingNotes: row.pending_notes || undefined,
      splitParentId: row.split_parent_id || undefined,
      splitIndex: row.split_index || undefined,
      totalSplitCount: row.total_split_count || undefined,
      paidAmount: row.paid_amount || undefined,
      appliedPromoId: row.applied_promo_id || undefined,
      voucherCode: row.voucher_code || undefined,
      promoName: row.promo_name || undefined,
      promoAmount: row.promo_amount || undefined,
      kitchenTicketPrintedAt: row.kitchen_ticket_printed_at || undefined,
    })) || null;
  } catch (e) {
    console.error('[CloudSync] Fetch EXCEPTION:', e);
    return null;
  }
}

// ============================================================
// REAL-TIME SUBSCRIPTION (for KDS)
// ============================================================

export function subscribeToTransactions(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `tx-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'transactions' },
      callback
    )
    .subscribe();

  return channel;
}

export function unsubscribeChannel(channel: any) {
  if (channel) {
    try {
      supabase.removeChannel(channel);
    } catch (e) {
      console.warn('[Realtime] Failed to remove channel:', e);
    }
  }
}

export function subscribeToUsers(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `users-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      callback
    )
    .subscribe();

  return channel;
}

export function subscribeToSettings(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `settings-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'settings' },
      callback
    )
    .subscribe();

  return channel;
}

export function subscribeToStockOpnames(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `stock-opnames-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stock_opnames' },
      callback
    )
    .subscribe();

  return channel;
}

export function subscribeToMenus(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `menus-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menus' },
      callback
    )
    .subscribe();

  return channel;
}

export function subscribeToInventory(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `inventory-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory' },
      callback
    )
    .subscribe();

  return channel;
}

export function subscribeToCashMovements(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `cash-movements-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'cash_movements' },
      callback
    )
    .subscribe();

  return channel;
}

export function subscribeToMenuComponents(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  const channelName = `menu-components-rt-${Math.random().toString(36).substring(2, 9)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'menu_components' },
      callback
    )
    .subscribe();

  return channel;
}

// ============================================================
// INVENTORY
// ============================================================

export async function syncInventoryItem(item: InventoryItem) {
  if (!isSupabaseConfigured) return;
  await smartUpsert('inventory', {
    id: item.id,
    name: item.name,
    stock: item.stock,
    unit: item.unit,
    cost_per_unit: item.costPerUnit,
    min_stock: item.minStock,
    // v4.7 TO DO 18.8 (A5): stamp waktu mutasi → last-write-wins lintas device
    updated_at: item.updatedAt || new Date().toISOString(),
  });
}

// v4.7 TO DO 8.3: satu helper BULK untuk sync stok cloud — dipakai deductStock & revertStock
// (sebelumnya deduct pakai fungsi ini, revert pakai loop syncInventoryItem → dua jalur berbeda).
// Nama netral: helper ini mengirim NILAI STOK TERBARU (post-mutasi) dari items untuk setiap id.
export async function syncInventoryStock(deductions: Record<string, number>, items: InventoryItem[]) {
  if (!isSupabaseConfigured) return;
  // BUG-C1 fix: items already contain post-change stock values (mutated in inventoryStore).
  // Previously this subtracted `amount` again, causing double deduction in cloud.
  for (const [id] of Object.entries(deductions)) {
    const item = items.find((i) => i.id === id);
    if (item) {
      // v4.7 TO DO 18.8 (A5): sertakan updated_at (last-write-wins) — fetch cloud stale
      // tidak akan menimpa mutasi lokal yang lebih baru saat merge berikutnya.
      await smartUpdate('inventory', { stock: item.stock, updated_at: item.updatedAt || new Date().toISOString() }, 'id', id);
    }
  }
}

export interface InventoryAdjustment {
  id: string;
  delta: number; // negatif = deduksi, positif = revert/adjust naik
}

export interface InventoryAdjustmentResult {
  ok: { id: string; delta: number }[];
  // Deduksi yang DITOLAK cloud (stok cloud kurang — kemungkinan sudah terjual device lain)
  conflicts: { id: string; delta: number; cloudStock: number }[];
  // true bila fallback absolut dipakai (offline / RPC belum dibuat di DB) — bukan jalur atomik
  degraded: boolean;
}

// v4.7 TO DO 18.1 (Prioritas 18): sync stok cloud berbasis DELTA ATOMIK via RPC
// `adjust_inventory_stock` — guard `stock >= -delta` di level database mencegah dua kasir
// memotong bahan yang sama melebihi fisik (lost-update validate-then-deduct).
//   - Online + RPC ada    → panggil RPC per id; deduksi ditolak → masuk `conflicts` (oversell).
//   - Offline / RPC belum ada → fallback ABSOLUT (perilaku lama: tulis stok pasca-mutasi,
//     di-queue bila offline) — atomicity tidak mungkin tanpa RPC; ditandai `degraded`.
// Pemakaian: inventoryStore.deductStock (delta negatif) & revertStock (delta positif).
export async function adjustInventoryStockCloud(
  adjustments: InventoryAdjustment[],
  items: InventoryItem[]
): Promise<InventoryAdjustmentResult> {
  const result: InventoryAdjustmentResult = { ok: [], conflicts: [], degraded: false };
  if (!isSupabaseConfigured) {
    // Tanpa cloud — tidak ada yang bisa dikoreksi; semua dianggap berhasil (local-first).
    for (const a of adjustments) result.ok.push({ id: a.id, delta: a.delta });
    return result;
  }

  const fallbackAbsolute = async (pending: InventoryAdjustment[]) => {
    result.degraded = true;
    for (const a of pending) {
      const item = items.find((i) => i.id === a.id);
      if (item) {
        // v4.7 TO DO 18.8 (A5): sertakan updated_at (last-write-wins) pada jalur fallback absolut
        await smartUpdate('inventory', { stock: item.stock, updated_at: item.updatedAt || new Date().toISOString() }, 'id', a.id);
      }
      result.ok.push({ id: a.id, delta: a.delta });
    }
  };

  if (navigator.onLine === false || migrationNeeded.inventoryStockRpc) {
    await fallbackAbsolute(adjustments);
    return result;
  }

  const failed: InventoryAdjustment[] = [];
  for (const a of adjustments) {
    try {
      const { data, error } = await supabase.rpc('adjust_inventory_stock', {
        p_id: a.id,
        p_delta: a.delta,
      });
      if (error) {
        // RPC gagal (fungsi belum dibuat / jaringan) → fallback absolut untuk id ini
        failed.push(a);
        continue;
      }
      if (data && typeof data === 'object' && typeof (data as any).ok === 'boolean') {
        if ((data as any).ok) {
          result.ok.push({ id: a.id, delta: a.delta });
        } else if ((data as any).reason === 'insufficient') {
          result.conflicts.push({
            id: a.id,
            delta: a.delta,
            cloudStock: typeof (data as any).stock === 'number' ? (data as any).stock : 0,
          });
        } else {
          // not_found: id tidak ada di cloud (bahan baru lokal belum di-upsert) — treat as ok
          result.ok.push({ id: a.id, delta: a.delta });
        }
      } else {
        // Respons tak terduga — jangan gagalkan transaksi; fallback absolut untuk id ini
        failed.push(a);
      }
    } catch (e) {
      // Exception (offline mendadak dsb.) → fallback absolut (masuk queue bila offline)
      failed.push(a);
    }
  }
  if (failed.length > 0) {
    await fallbackAbsolute(failed);
  }
  return result;
}

export async function deleteInventoryCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('inventory', 'id', id);
}

// ============================================================
// MENUS
// ============================================================

export async function syncMenu(menu: Menu) {
  if (!isSupabaseConfigured) return;
  const data: Record<string, any> = {
    id: menu.id,
    name: menu.name,
    category: menu.category,
    price: menu.price,
    image: menu.image,
    is_best_seller: menu.isBestSeller,
    is_available: menu.isAvailable !== false,
    ingredients: menu.ingredients,
    available_addons: menu.availableAddons,
    description: menu.description,
    is_bundle: menu.isBundle || false,
  };
  // Only include manual_hpp if the column exists in DB
  if (!migrationNeeded.manualHpp) {
    data.manual_hpp = menu.manualHpp || 0;
  }
  // Only include kitchen_target if the column exists in DB
  if (!migrationNeeded.kitchenTarget) {
    data.kitchen_target = menu.kitchenTarget || null;
  }
  // Only include show_sugar_level if the column exists in DB
  if (!migrationNeeded.showSugarLevel) {
    data.show_sugar_level = menu.showSugarLevel !== false;
  }
  // Only include show_temperature if the column exists in DB
  if (!migrationNeeded.showTemperature) {
    data.show_temperature = menu.showTemperature !== false;
  }
  await smartUpsert('menus', data);
}

export async function deleteMenuCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('menus', 'id', id);
}

// ============================================================
// CUSTOMERS
// ============================================================

export async function syncCustomer(customer: Customer) {
  if (!isSupabaseConfigured) return;
  const data: Record<string, any> = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    notes: customer.notes,
    total_spent: customer.totalSpent,
    visit_count: customer.visitCount,
    last_visit: customer.lastVisit,
    created_at: customer.createdAt,
  };
  // v4.7 TO DO 12.2.2 (P-A8): poin loyalty — hanya ditulis jika kolom sudah ada di DB
  if (!migrationNeeded.loyaltyPoints) {
    data.loyalty_points = customer.loyaltyPoints || 0;
  }
  await smartUpsert('customers', data);
}

export async function deleteCustomerCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('customers', 'id', id);
}

// ============================================================
// SHIFTS
// ============================================================

const isValidUuid = (str?: string | null) => str ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str) : false;

export async function syncShift(shift: CashierShift) {
  if (!isSupabaseConfigured) return;
  await smartUpsert('shifts', {
    id: shift.id,
    user_id: isValidUuid(shift.userId) ? shift.userId : null,
    user_name: shift.userName,
    opened_at: shift.openedAt,
    closed_at: shift.closedAt,
    opening_cash: shift.openingCash,
    closing_cash: shift.closingCash,
    expected_cash: shift.expectedCash,
    cash_difference: shift.cashDifference,
    total_sales: shift.totalSales,
    total_transactions: shift.totalTransactions,
    status: shift.status,
  });
}

// ============================================================
// AUDIT LOG
// ============================================================

export async function syncAuditLog(entry: AuditLogEntry) {
  if (!isSupabaseConfigured) return;
  const isValidUuid = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  await smartInsert('audit_logs', {
    id: entry.id,
    user_id: isValidUuid(entry.userId) ? entry.userId : null,
    user_name: entry.userName,
    user_role: entry.userRole,
    action: entry.action,
    detail: entry.detail,
    metadata: entry.metadata,
    timestamp: entry.timestamp,
  });
}

// ============================================================
// CONNECTION CHECK
// ============================================================

export async function checkConnection(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const { error } = await supabase.from('settings').select('id').limit(1);
    return !error;
  } catch {
    return false;
  }
}

// ============================================================
// SETTINGS (sync logo, store name, etc across devices)
// ============================================================

export async function syncSettings(settings: AppSettings) {
  if (!isSupabaseConfigured) return;
  const data: Record<string, any> = {
    id: 1,
    manager_pin: settings.managerPin,
    store_name: settings.storeName,
    store_logo: settings.storeLogo || null,
    address: settings.address || null,
    tax_percent: settings.taxPercent || 0,
    categories: settings.categories,
    printer_enabled: settings.printerEnabled,
    printer_type: settings.printerType,
    printer_width: settings.printerWidth,
    auto_print_on_checkout: settings.autoPrintOnCheckout,
    super_admin_pin: settings.superAdminPin,
  };
  // v4.1 TO DO 2.7: kolom opsional settings — hanya ditulis jika kolom sudah ada di DB
  // (tanpa guard, upsert pada DB lama gagal → offline queue menumpuk).
  if (!migrationNeeded.receiptHeader) {
    data.receipt_header = settings.receiptHeader || null;
  }
  if (!migrationNeeded.receiptFooter) {
    data.receipt_footer = settings.receiptFooter || null;
  }
  if (!migrationNeeded.receiptAsciiOnly) {
    data.receipt_ascii_only = settings.receiptAsciiOnly ?? false;
  }
  if (!migrationNeeded.autoPrintReceipt) {
    data.auto_print_receipt = settings.autoPrintReceipt ?? false;
  }
  if (!migrationNeeded.demoMode) {
    data.demo_mode = settings.demoMode;
  }
  if (!migrationNeeded.kitchenPrinters) {
    data.kitchen_printers = settings.kitchenPrinters || [];
  }
  if (!migrationNeeded.themeColor) {
    data.theme_color = settings.themeColor || null;
  }
  if (!migrationNeeded.themeShades) {
    data.theme_shades = settings.themeShades || null;
  }
  if (!migrationNeeded.tableFeatures) {
    data.table_features = {
      enabled: settings.tableFeaturesEnabled ?? false,
      tables: settings.availableTableNumbers ?? ['Meja 1', 'Meja 2', 'Meja 3', 'Meja 4', 'Meja 5']
    };
  }
  if (!migrationNeeded.taxEnabled) {
    data.tax_enabled = settings.taxEnabled ?? false;
  }
  // v4.7 TO DO 11.2 (P0.4): auto-kirim struk digital — hanya ditulis jika kolom sudah ada di DB
  if (!migrationNeeded.autoSendDigitalReceipt) {
    data.auto_send_digital_receipt = settings.autoSendDigitalReceipt ?? false;
  }
  if (!migrationNeeded.pendingPrintOption) {
    data.pending_print_option = settings.pendingPrintOption || 'dapur_only';
  }
  await smartUpsert('settings', data);
}

export async function fetchSettingsFromCloud(): Promise<AppSettings | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single();
    if (error || !data) return null;
    return {
      managerPin: data.manager_pin,
      storeName: data.store_name,
      storeLogo: data.store_logo || undefined,
      address: data.address || undefined,
      taxEnabled: data.tax_enabled !== undefined && data.tax_enabled !== null ? data.tax_enabled : (data.tax_percent ? data.tax_percent > 0 : false),
      taxPercent: data.tax_percent || 0,
      categories: data.categories || [],
      printerEnabled: data.printer_enabled || false,
      printerType: data.printer_type || 'browser',
      printerWidth: data.printer_width || '58mm',
      autoPrintOnCheckout: data.auto_print_on_checkout || false,
      kitchenPrinters: data.kitchen_printers || [],
      superAdminPin: data.super_admin_pin || '000000',
      demoMode: data.demo_mode !== false,
      themeColor: data.theme_color || undefined,
      themeShades: data.theme_shades || undefined,
      tableFeaturesEnabled: data.table_features?.enabled || false,
      availableTableNumbers: data.table_features?.tables || ['Meja 1', 'Meja 2', 'Meja 3', 'Meja 4', 'Meja 5'],
      receiptHeader: data.receipt_header || undefined,
      receiptFooter: data.receipt_footer || undefined,
      receiptAsciiOnly: data.receipt_ascii_only || false,
      autoPrintReceipt: data.auto_print_receipt || false,
      autoSendDigitalReceipt: data.auto_send_digital_receipt || false,
      pendingPrintOption: data.pending_print_option || 'dapur_only',
    };
  } catch (e) {
    console.warn('[CloudSync] Fetch settings failed:', e);
    return null;
  }
}

// ============================================================
// LOYALTY SETTINGS (BUG-M5 fix: sync across devices)
// Uses settings table row id=2 to store loyalty config as JSON
// ============================================================

export async function syncLoyaltySettings(ls: LoyaltySettings) {
  if (!isSupabaseConfigured) return;
  await smartUpsert('settings', {
    id: 1,
    loyalty_enabled: ls.enabled,
    loyalty_settings: ls,
  });
}

export async function fetchLoyaltySettingsFromCloud(): Promise<LoyaltySettings | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('settings').select('loyalty_settings').eq('id', 1).single();
    if (error || !data?.loyalty_settings) return null;
    return data.loyalty_settings as LoyaltySettings;
  } catch {
    return null;
  }
}

// ============================================================
// CUSTOM CATEGORIES (GAP-1 fix: sync across devices)
// Uses settings table row id=3 to store categories as JSON
// ============================================================

export async function syncCustomCategories(categories: string[]) {
  if (!isSupabaseConfigured) return;
  await smartUpsert('settings', {
    id: 1,
    categories: categories,
  });
}

export async function fetchCustomCategoriesFromCloud(): Promise<string[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('settings').select('categories').eq('id', 1).single();
    if (error || !data?.categories) return null;
    return data.categories as string[];
  } catch {
    return null;
  }
}

// ============================================================
// FETCH ALL SHARED DATA (for multi-device sync on load)
// ============================================================

export async function fetchCustomersFromCloud(): Promise<Customer[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone || undefined,
      email: row.email || undefined,
      notes: row.notes || undefined,
      totalSpent: row.total_spent || 0,
      visitCount: row.visit_count || 0,
      loyaltyPoints: row.loyalty_points || 0,
      lastVisit: row.last_visit || undefined,
      createdAt: row.created_at,
    })) || null;
  } catch {
    return null;
  }
}

export async function fetchMenusFromCloud(): Promise<Menu[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('menus').select('*');
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      price: row.price,
      image: row.image || undefined,
      isBestSeller: row.is_best_seller || false,
      isAvailable: row.is_available !== false,
      ingredients: row.ingredients || {},
      availableAddons: row.available_addons || [],
      description: row.description || undefined,
      manualHpp: row.manual_hpp || 0,
      kitchenTarget: row.kitchen_target || undefined,
      showSugarLevel: (row.show_sugar_level !== undefined && row.show_sugar_level !== null)
        ? row.show_sugar_level
        : undefined,
      showTemperature: (row.show_temperature !== undefined && row.show_temperature !== null)
        ? row.show_temperature
        : undefined,
      isBundle: row.is_bundle || false,
    })) || null;
  } catch {
    return null;
  }
}

export async function fetchInventoryFromCloud(): Promise<InventoryItem[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('inventory').select('*');
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      name: row.name,
      stock: row.stock,
      unit: row.unit,
      costPerUnit: row.cost_per_unit,
      minStock: row.min_stock,
      // v4.7 TO DO 18.8 (A5): baca timestamp cloud → last-write-wins saat merge lokal
      updatedAt: row.updated_at || undefined,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// USERS (BUG-10 fix: multi-device user sync)
// ============================================================

export async function syncUser(user: User) {
  if (!isSupabaseConfigured) return;
  const data: Record<string, any> = {
    id: user.id,
    name: user.name,
    username: user.username,
    password: user.password,
    role: user.role,
    created_at: user.createdAt,
  };
  if (!migrationNeeded.activeSessionId) {
    data.active_session_id = user.activeSessionId || null;
  }
  await smartUpsert('users', data);
}

export async function deleteUserCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('users', 'id', id);
}

export async function fetchUsersFromCloud(): Promise<User[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('users').select('*');
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      name: row.name,
      username: row.username,
      password: row.password,
      role: row.role,
      createdAt: row.created_at,
      activeSessionId: row.active_session_id || undefined,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// PROMOS (BUG-10 fix: multi-device promo sync)
// ============================================================

export async function syncPromo(promo: Promo) {
  if (!isSupabaseConfigured) return;
  const data: Record<string, any> = {
    id: promo.id,
    name: promo.name,
    code: promo.code || null,
    type: promo.type,
    value: promo.value,
    scope: promo.scope,
    scope_target: promo.scopeTarget || null,
    min_purchase: promo.minPurchase || null,
    max_discount: promo.maxDiscount || null,
    start_date: promo.startDate,
    end_date: promo.endDate,
    is_active: promo.isActive,
    usage_limit: promo.usageLimit || null,
    usage_count: promo.usageCount,
    loyalty_min_visits: promo.loyaltyMinVisits || null,
    // BUG-NEW-07 fix: Include createdAt to prevent null column in cloud
    created_at: promo.createdAt || new Date().toISOString(),
  };
  // v4.7 TO DO 12.2.3 (P-A4): flag stacking promo — hanya ditulis jika kolom sudah ada di DB
  if (!migrationNeeded.promoStackable) {
    data.stackable = promo.stackable !== false;
  }
  // v4.7 TO DO 12.2.5 (P-A5): BOGO & min-qty — hanya ditulis jika kolom sudah ada di DB
  if (!migrationNeeded.promoMinQty) {
    data.min_qty = promo.minQty || null;
  }
  if (!migrationNeeded.promoBogoConfig) {
    data.bogo_config =
      promo.type === 'bogo'
        ? {
            buyQty: promo.bogoBuyQty || 2,
            freeQty: promo.bogoFreeQty || 1,
            percent: promo.bogoPercent ?? 0,
          }
        : null;
  }
  // v4.7 TO DO 12.2.6 (P-A6): batas pemakaian per pelanggan — hanya ditulis jika kolom ada
  if (!migrationNeeded.promoUsagePerCustomer) {
    data.usage_limit_per_customer = promo.usageLimitPerCustomer || null;
    data.usage_by_customer = promo.usageByCustomer || {};
  }
  await smartUpsert('promos', data);
}

export async function deletePromoCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('promos', 'id', id);
}

export async function fetchPromosFromCloud(): Promise<Promo[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('promos').select('*');
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code || undefined,
      type: row.type,
      value: row.value,
      scope: row.scope || 'all',
      scopeTarget: row.scope_target || undefined,
      minPurchase: row.min_purchase || undefined,
      maxDiscount: row.max_discount || undefined,
      startDate: row.start_date,
      endDate: row.end_date,
      isActive: row.is_active !== false,
      usageLimit: row.usage_limit || undefined,
      usageCount: row.usage_count || 0,
      loyaltyMinVisits: row.loyalty_min_visits || undefined,
      stackable: row.stackable !== false,
      // v4.7 TO DO 12.2.5 (P-A5): BOGO & min-qty (bogo_config JSONB di cloud)
      minQty: row.min_qty || undefined,
      bogoBuyQty: row.bogo_config?.buyQty || undefined,
      bogoFreeQty: row.bogo_config?.freeQty || undefined,
      bogoPercent: row.bogo_config?.percent ?? undefined,
      // v4.7 TO DO 12.2.6 (P-A6): batas pemakaian per pelanggan
      usageLimitPerCustomer: row.usage_limit_per_customer || undefined,
      usageByCustomer: row.usage_by_customer || undefined,
      createdAt: row.created_at,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// SHIFTS (BUG-C3 fix: multi-device shift sync)
// ============================================================

export async function fetchShiftsFromCloud(): Promise<CashierShift[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('shifts').select('*').order('opened_at', { ascending: false }).limit(200);
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      openedAt: row.opened_at,
      closedAt: row.closed_at || undefined,
      openingCash: row.opening_cash,
      closingCash: row.closing_cash ?? undefined,
      expectedCash: row.expected_cash ?? undefined,
      cashDifference: row.cash_difference ?? undefined,
      totalSales: row.total_sales || 0,
      totalTransactions: row.total_transactions || 0,
      status: row.status,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// STOCK LOGS (BUG-C4 fix: cloud sync for stock_logs)
// ============================================================

export async function syncStockLog(entry: StockLogEntry) {
  if (!isSupabaseConfigured) return;
  await smartInsert('stock_logs', {
    id: entry.id,
    inventory_id: entry.inventoryId,
    inventory_name: entry.inventoryName,
    type: entry.type,
    amount: entry.amount,
    stock_before: entry.stockBefore,
    stock_after: entry.stockAfter,
    unit: entry.unit,
    reason: entry.reason || null,
    date: entry.date,
  });
}

export async function fetchStockLogsFromCloud(): Promise<StockLogEntry[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('stock_logs').select('*').order('date', { ascending: false }).limit(500);
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      inventoryId: row.inventory_id,
      inventoryName: row.inventory_name,
      type: row.type,
      amount: row.amount,
      stockBefore: row.stock_before,
      stockAfter: row.stock_after,
      unit: row.unit,
      reason: row.reason || undefined,
      date: row.date,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// AUDIT LOGS (BUG-C4 fix: fetch audit logs from cloud)
// ============================================================

export async function fetchAuditLogsFromCloud(): Promise<AuditLogEntry[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(500);
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      userRole: row.user_role,
      action: row.action,
      detail: row.detail,
      timestamp: row.timestamp,
      metadata: row.metadata || undefined,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// STOCK OPNAMES (Stock Taking Records)
// ============================================================

export async function syncStockOpname(record: StockOpname) {
  if (!isSupabaseConfigured) return;
  await smartInsert('stock_opnames', {
    id: record.id,
    date: record.date,
    staff_id: record.staffId,
    staff_name: record.staffName,
    items: record.items,
    total_loss_value: record.totalLossValue,
    total_items: record.totalItems,
    items_with_difference: record.itemsWithDifference,
    pin_verified: record.pinVerified,
    // v4.7 TO DO 10.2/10.3: identitas approver + jejak audit + alasan penyesuaian
    approver_id: record.approverId || null,
    approver_name: record.approverName || null,
    approver_role: record.approverRole || null,
    approved_at: record.approvedAt || null,
    device_id: record.deviceId || null,
    adjustment_reason: record.adjustmentReason || null,
    notes: record.notes || null,
  });
}

export async function fetchStockOpnamesFromCloud(): Promise<StockOpname[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('stock_opnames').select('*').order('date', { ascending: false }).limit(200);
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      date: row.date,
      staffId: row.staff_id,
      staffName: row.staff_name,
      items: row.items || [],
      totalLossValue: row.total_loss_value || 0,
      totalItems: row.total_items || 0,
      itemsWithDifference: row.items_with_difference || 0,
      pinVerified: row.pin_verified || false,
      // v4.7 TO DO 10.2/10.3: baca balik identitas approver + jejak audit + alasan
      approverId: row.approver_id || undefined,
      approverName: row.approver_name || undefined,
      approverRole: row.approver_role || undefined,
      approvedAt: row.approved_at || undefined,
      deviceId: row.device_id || undefined,
      adjustmentReason: row.adjustment_reason || undefined,
      notes: row.notes || undefined,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// CASH MOVEMENTS (Rekap Kas: Kas Masuk & Kas Keluar)
// ============================================================

export async function syncCashMovement(movement: CashMovement): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  // v4.6 fix #3: kolom shift_id/cashier_id di schema adalah TEXT — kirim nilai apa adanya
  // (sanitasi isValidUuid lama justru membuang data non-UUID). Via smartUpsert (offline queue):
  // online → langsung; offline/gagal → antre + flush otomatis saat online (retry berkelanjutan).
  return smartUpsert('cash_movements', {
    id: movement.id,
    shift_id: movement.shiftId || null,
    type: movement.type,
    amount: movement.amount,
    category: movement.category,
    notes: movement.notes || null,
    cashier_id: movement.cashierId || null,
    cashier_name: movement.cashierName,
    date: movement.date,
    created_at: movement.createdAt,
  });
}

export async function fetchCashMovementsFromCloud(): Promise<CashMovement[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('cash_movements').select('*').order('date', { ascending: false }).limit(500);
    if (error) {
      console.warn('[CloudSync] Failed to fetch cash_movements:', error.message);
      return null;
    }
    console.log('[CloudSync] Fetched', data?.length || 0, 'cash movements from cloud');
    return data?.map((row) => ({
      id: row.id,
      shiftId: row.shift_id || undefined,
      type: row.type as 'in' | 'out',
      amount: Number(row.amount) || 0,
      category: row.category,
      notes: row.notes || undefined,
      cashierId: row.cashier_id || '',
      cashierName: row.cashier_name,
      date: row.date,
      createdAt: row.created_at || row.date,
    })) || null;
  } catch (e) {
    console.warn('[CloudSync] Exception fetching cash_movements:', e);
    return null;
  }
}

export async function deleteCashMovementCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('cash_movements', 'id', id);
}
