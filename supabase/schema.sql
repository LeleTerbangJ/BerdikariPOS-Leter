-- ============================================================
-- BerdikariPOS — Supabase Database Schema (v4.3)
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- 1. Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Manager', 'Kasir', 'Acaraki', 'Staf Gudang')),
  active_session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Inventory table
CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  stock FLOAT NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'kg',
  cost_per_unit FLOAT NOT NULL DEFAULT 0,
  min_stock FLOAT DEFAULT 3,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Menus table
CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price FLOAT NOT NULL,
  description TEXT,
  image TEXT,
  is_best_seller BOOLEAN DEFAULT false,
  is_available BOOLEAN DEFAULT true,
  ingredients JSONB DEFAULT '{}',
  available_addons JSONB DEFAULT '[]',
  manual_hpp FLOAT DEFAULT 0,
  kitchen_target TEXT DEFAULT NULL,
  show_sugar_level BOOLEAN DEFAULT true,
  show_temperature BOOLEAN DEFAULT true,
  is_bundle BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Safe migration for existing databases
ALTER TABLE menus ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN DEFAULT false;
-- v4.7 TO DO 18.8 (A5): last-write-wins lintas device — kolom updated_at inventory
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 3b. Menu Components table (Bundle & Add-on Engine)
CREATE TABLE IF NOT EXISTS menu_components (
  id TEXT PRIMARY KEY,
  parent_menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  child_type TEXT NOT NULL CHECK (child_type IN ('Menu', 'Inventory', 'Modifier')),
  child_id TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'Bundle' CHECK (mode IN ('Bundle', 'Add-on')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_components_parent ON menu_components(parent_menu_id);

-- 4. Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_number INT NOT NULL,
  date TIMESTAMPTZ DEFAULT now(),
  items JSONB NOT NULL DEFAULT '[]',
  subtotal FLOAT NOT NULL DEFAULT 0,
  discount FLOAT NOT NULL DEFAULT 0,
  total_amount FLOAT NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'QRIS', 'Transfer')),
  cash_received FLOAT,
  change FLOAT,
  kitchen_status TEXT NOT NULL DEFAULT 'Waiting' CHECK (kitchen_status IN ('Waiting', 'Processing', 'Done')),
  tx_status TEXT NOT NULL DEFAULT 'Selesai' CHECK (tx_status IN ('Selesai', 'Cancel', 'Pending', 'Demo')),
  cashier_id TEXT,
  cashier_name TEXT,
  customer_id TEXT,
  customer_name TEXT,
  hpp FLOAT DEFAULT 0,
  tax INT DEFAULT 0,
  order_type TEXT DEFAULT 'Dine In',
  table_number TEXT,
  -- Pending Payment & Split Bill (v4.1)
  table_name TEXT,
  is_pending BOOLEAN DEFAULT FALSE,
  pending_notes TEXT,
  split_parent_id TEXT,
  split_index INT,
  total_split_count INT,
  paid_amount FLOAT,
  -- Promo pending (v4.5 TO DO 5.5) — di-restore saat resume agar total konsisten lintas device
  applied_promo_id TEXT,
  voucher_code TEXT,
  -- v4.7 TO DO 12.2.4 (P-A3): snapshot performa promo — nama & nominal diskon promo saat checkout
  promo_name TEXT,
  promo_amount FLOAT,
  -- v4.7 TO DO 18.8 (A10): waktu tiket dapur tercetak saat Simpan Pending — resume skip tiket dapur
  -- hanya bila sudah pernah tercetak (anti tiket dobel; printer gagal → tiket tidak hilang diam-diam)
  kitchen_ticket_printed_at TIMESTAMPTZ,
  -- v4.7 TO DO 11.2 (P0.2): refund/retur penuh — stok & kunjungan di-revert, kas keluar 'Refund' di Rekap Kas
  refunded BOOLEAN DEFAULT false,
  refunded_at TIMESTAMPTZ,
  refunded_amount FLOAT,
  refund_note TEXT,
  refunded_by_id TEXT,
  refunded_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Safe migration for existing databases (Pending Payment & Split Bill v4.1)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_pending BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pending_notes TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_parent_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_index INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_split_count INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paid_amount FLOAT;
-- v4.5 TO DO 5.5: kolom promo pending
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS applied_promo_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voucher_code TEXT;
-- v4.7 TO DO 12.2.4 (P-A3): kolom performa promo (snapshot nama & nominal diskon saat checkout)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS promo_amount FLOAT;
-- v4.7 TO DO 18.8 (A10): kolom tiket dapur tercetak (self-heal DB lama)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS kitchen_ticket_printed_at TIMESTAMPTZ;

-- Safe migration: izinkan status 'Pending' pada tx_status (di-drop lalu di-add ulang dengan nilai yang sama, aman dijalankan berulang)
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'transactions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%tx_status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', cname);
  END IF;
END $$;
ALTER TABLE transactions ADD CONSTRAINT transactions_tx_status_check
  CHECK (tx_status IN ('Selesai', 'Cancel', 'Pending', 'Demo'));

-- 5. Customers table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  total_spent FLOAT DEFAULT 0,
  visit_count INT DEFAULT 0,
  -- v4.7 TO DO 12.2.2 (P-A8): poin loyalty (earn saat checkout, redeem jadi diskon)
  loyalty_points INT DEFAULT 0,
  last_visit TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- v4.7 TO DO 12.2.2 (P-A8): kolom poin loyalty (migrasi DB lama)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_points INT DEFAULT 0;

-- 6. Shifts table
CREATE TABLE IF NOT EXISTS shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  user_name TEXT NOT NULL,
  opened_at TIMESTAMPTZ DEFAULT now(),
  closed_at TIMESTAMPTZ,
  opening_cash FLOAT NOT NULL DEFAULT 0,
  closing_cash FLOAT,
  expected_cash FLOAT,
  cash_difference FLOAT,
  total_sales FLOAT DEFAULT 0,
  total_transactions INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- H.3 Pilar 1 (v4.9.3): identitas approver Manager force close shift gantung
  closed_by TEXT,
  closed_by_id TEXT,
  closed_by_role TEXT
);
-- DB lama: jalankan ALTER idempoten berikut sekali di SQL Editor (juga tercetak otomatis di console app — Migration 31):
-- ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by TEXT;
-- ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by_id TEXT;
-- ALTER TABLE shifts ADD COLUMN IF NOT EXISTS closed_by_role TEXT;

-- 7. Promos table
CREATE TABLE IF NOT EXISTS promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed', 'bogo')),
  value FLOAT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'category', 'menu', 'loyalty')),
  scope_target TEXT,
  min_purchase FLOAT,
  max_discount FLOAT,
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  usage_limit INT,
  usage_count INT DEFAULT 0,
  loyalty_min_visits INT,
  -- v4.7 TO DO 12.2.3 (P-A4): boleh digabung dengan diskon lain (manual/loyalty)?
  -- false = eksklusif → POS otomatis memberi best-deal (promo ATAU manual+loyalty)
  stackable BOOLEAN DEFAULT TRUE,
  -- v4.7 TO DO 12.2.5 (P-A5): BOGO (beli N gratis M, dikonfigurasi di bogo_config JSONB)
  -- & min-qty gate untuk diskon %/nominal (min_qty)
  bogo_config JSONB,
  min_qty INT,
  -- v4.7 TO DO 12.2.6 (P-A6): batas pemakaian per pelanggan
  usage_limit_per_customer INT,
  usage_by_customer JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- v4.7 TO DO 12.2.3 (P-A4): kolom stacking promo (migrasi DB lama)
ALTER TABLE promos ADD COLUMN IF NOT EXISTS stackable BOOLEAN DEFAULT TRUE;
-- v4.7 TO DO 12.2.5 (P-A5): kolom BOGO & min-qty (migrasi DB lama)
ALTER TABLE promos ADD COLUMN IF NOT EXISTS bogo_config JSONB;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS min_qty INT;
-- v4.7 TO DO 12.2.6 (P-A6): kolom batas pemakaian per pelanggan (migrasi DB lama)
ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_limit_per_customer INT;
ALTER TABLE promos ADD COLUMN IF NOT EXISTS usage_by_customer JSONB DEFAULT '{}';
-- v4.7 TO DO 12.2.5 (P-A5): izinkan type 'bogo' (relax CHECK constraint promos.type — idempoten)
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'promos'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%percentage%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE promos DROP CONSTRAINT %I', cname);
  END IF;
END $$;
ALTER TABLE promos ADD CONSTRAINT promos_type_check
  CHECK (type IN ('percentage', 'fixed', 'bogo'));

-- 8. Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  user_name TEXT NOT NULL,
  user_role TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  metadata JSONB,
  timestamp TIMESTAMPTZ DEFAULT now()
);

-- 9. Stock logs table
CREATE TABLE IF NOT EXISTS stock_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id TEXT REFERENCES inventory(id) ON DELETE CASCADE,
  inventory_name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deduct', 'add', 'adjust', 'import')),
  amount FLOAT NOT NULL,
  stock_before FLOAT NOT NULL,
  stock_after FLOAT NOT NULL,
  unit TEXT NOT NULL,
  reason TEXT,
  date TIMESTAMPTZ DEFAULT now()
);

-- 10. Settings table (multi-row: id=1 app settings, id=2 loyalty, id=3 custom categories)
CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1,
  manager_pin TEXT DEFAULT '1234',
  store_name TEXT DEFAULT 'BerdikariPOS',
  store_logo TEXT,
  address TEXT,
  tax_enabled BOOLEAN DEFAULT false,
  tax_percent FLOAT DEFAULT 0,
  categories JSONB DEFAULT '["Jamu Murni", "Wedang", "Signature", "Segar"]',
  printer_enabled BOOLEAN DEFAULT false,
  printer_type TEXT DEFAULT 'browser',
  printer_width TEXT DEFAULT '58mm',
  auto_print_on_checkout BOOLEAN DEFAULT false,
  super_admin_pin TEXT DEFAULT '000000',
  demo_mode BOOLEAN DEFAULT true,
  loyalty_enabled BOOLEAN DEFAULT false,
  loyalty_settings JSONB DEFAULT '{}',
  kitchen_printers JSONB DEFAULT '[]',
  theme_color TEXT,
  theme_shades JSONB,
  table_features_enabled BOOLEAN DEFAULT false,
  available_table_numbers JSONB DEFAULT '[]',
  table_features JSONB DEFAULT '{"enabled": false, "tables": ["Meja 1", "Meja 2", "Meja 3", "Meja 4", "Meja 5"]}',
  receipt_header TEXT,
  receipt_footer TEXT,
  -- v4.8: Pencetakan pesanan pending (dapur_only | ask | dapur_and_cashier | none)
  auto_send_digital_receipt BOOLEAN DEFAULT false,
  pending_print_option TEXT DEFAULT 'dapur_only'
);

-- Safe migration: kolom pending_print_option (v4.8)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pending_print_option TEXT DEFAULT 'dapur_only';

-- Insert default settings row
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 11. Stock Opnames table (Stock Taking / Physical Inventory Count)
CREATE TABLE IF NOT EXISTS stock_opnames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date TIMESTAMPTZ DEFAULT now(),
  staff_id TEXT NOT NULL,
  staff_name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  total_loss_value FLOAT DEFAULT 0,
  total_items INT DEFAULT 0,
  items_with_difference INT DEFAULT 0,
  pin_verified BOOLEAN DEFAULT false,
  -- v4.7 TO DO 10.2: identitas approver + jejak audit (dual-control opname)
  approver_id TEXT,
  approver_name TEXT,
  approver_role TEXT,
  approved_at TIMESTAMPTZ,
  device_id TEXT,
  -- v4.7 TO DO 10.3: alasan penyesuaian wajib untuk Staf Gudang pasca-PIN
  adjustment_reason TEXT,
  notes TEXT
);

-- 12. Cash Movements table (Rekap Kas: Kas Masuk & Kas Keluar)
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount FLOAT NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  notes TEXT,
  cashier_id TEXT NOT NULL,
  cashier_name TEXT NOT NULL,
  date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Enable Realtime for ALL tables (required for multi-device sync)
-- ============================================================

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE customers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE menus;
  ALTER TABLE menus REPLICA IDENTITY FULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE menu_components;
  ALTER TABLE menu_components REPLICA IDENTITY FULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
  ALTER TABLE inventory REPLICA IDENTITY FULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE users;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE promos;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE settings;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE shifts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE stock_opnames;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;
  ALTER TABLE cash_movements REPLICA IDENTITY FULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE promos ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_opnames ENABLE ROW LEVEL SECURITY;
-- v4.6 fix (Kas Masuk tidak tersinkron): RLS cash_movements aktif TANPA policy membuat
-- anon key diblokir diam-diam (SELECT kosong, INSERT ditolak) — Rekap Kas tidak pernah sync.
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON menus FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON promos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON audit_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON stock_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON stock_opnames FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for anon" ON cash_movements FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- v4.7 TO DO 18.1 (Prioritas 18): RPC atomik penyesuaian stok (optimistic concurrency 2 kasir)
-- ============================================================
-- Masalah: validasi stok & pemotongan terpisah → dua kasir yang membaca stok sama bisa
-- memotong melebihi fisik (lost-update). Solusi: penyesuaian stok cloud berbasis DELTA yang
-- atomik & terjaga (guard) di level database.
--   - p_delta < 0 (deduksi)  : DITOLAK bila stok cloud < -p_delta → cegah oversell lintas device.
--   - p_delta > 0 (revert)   : selalu diizinkan (menambah stok tidak pernah konflik).
-- Mengembalikan JSONB { ok, stock, reason }:
--   - ok=true,  stock=<stok baru>            → penyesuaian berhasil
--   - ok=false, stock=<stok aktual>, reason='insufficient' → deduksi ditolak (stok cloud kurang)
--   - ok=false, reason='not_found' (stock tidak disertakan — NULL) → id tidak ada di tabel inventory
CREATE OR REPLACE FUNCTION adjust_inventory_stock(p_id TEXT, p_delta FLOAT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_stock FLOAT;
BEGIN
  SELECT stock INTO v_stock FROM inventory WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'stock', NULL::FLOAT, 'reason', 'not_found');
  END IF;
  IF p_delta < 0 AND v_stock < -p_delta THEN
    RETURN jsonb_build_object('ok', false, 'stock', v_stock, 'reason', 'insufficient');
  END IF;
  UPDATE inventory SET stock = v_stock + p_delta, updated_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'stock', v_stock + p_delta, 'reason', 'ok');
END;
$$;

-- ============================================================
-- v4.7 TO DO 18.2 (Prioritas 18): counter nomor antrean atomik per outlet+date
-- ============================================================
-- Masalah: getNextQueueNumber memakai check-then-act (baca max → +1) → dua kasir yang
-- memproses bersamaan bisa mendapat nomor antrean SAMA (#N kembar). Solusi: counter
-- persisten di cloud yang dinaikkan secara ATOMIK (row lock upsert) — dua device tidak
-- mungkin mendapat nomor sama saat online.
CREATE TABLE IF NOT EXISTS queue_counters (
  outlet_id TEXT NOT NULL DEFAULT 'default',
  date TEXT NOT NULL,              -- 'YYYY-MM-DD' lokal device (konsisten dengan getTodayDateStr)
  last_number INT NOT NULL DEFAULT 0,
  PRIMARY KEY (outlet_id, date)
);
ALTER TABLE queue_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON queue_counters FOR ALL USING (true) WITH CHECK (true);

-- Alokasi nomor berikutnya secara atomik:
--   - p_min = nomor tertinggi yang SUDAH terpakai (floor) — mencegah nomor menabrak
--     transaksi yang sudah ada (data lama / device lain yang belum pakai RPC).
--   - INSERT (counter baru) → last_number = max(0, p_min) + 1 → nomor pertama = p_min + 1.
--   - ON CONFLICT DO UPDATE → last_number = GREATEST(last_number + 1, p_min + 1); row lock
--     mengserialkan dua permintaan bersamaan → nomor selalu unik.
CREATE OR REPLACE FUNCTION allocate_queue_number(p_date TEXT, p_outlet TEXT DEFAULT 'default', p_min INT DEFAULT 0)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_next INT;
BEGIN
  INSERT INTO queue_counters (outlet_id, date, last_number)
  VALUES (p_outlet, p_date, GREATEST(0, p_min) + 1)
  ON CONFLICT (outlet_id, date)
  DO UPDATE SET last_number = GREATEST(queue_counters.last_number + 1, p_min + 1)
  RETURNING last_number INTO v_next;
  RETURN v_next;
END;
$$;

-- ============================================================
-- Seed Data
-- ============================================================
INSERT INTO users (name, username, password, role) VALUES
  ('Admin Manager', 'manager', 'manager123', 'Manager'),
  ('Kasir 1', 'kasir', 'kasir123', 'Kasir'),
  ('Acaraki Dapur', 'acaraki', 'acaraki123', 'Acaraki'),
  ('Staf Gudang 1', 'gudang', 'gudang123', 'Staf Gudang')
ON CONFLICT (username) DO NOTHING;

INSERT INTO inventory (id, name, stock, unit, cost_per_unit, min_stock) VALUES
  ('kunyit', 'Kunyit Segar', 5, 'kg', 25000, 3),
  ('jahe', 'Jahe Emprit', 4, 'kg', 30000, 3),
  ('temulawak', 'Temulawak', 2.5, 'kg', 28000, 3),
  ('sereh', 'Sereh', 1.5, 'kg', 15000, 3),
  ('kayu-manis', 'Kayu Manis', 1, 'kg', 80000, 2),
  ('gula-aren', 'Gula Aren', 8, 'kg', 35000, 3),
  ('gula-pasir', 'Gula Pasir', 10, 'kg', 16000, 3),
  ('madu', 'Madu Murni', 3, 'L', 150000, 2),
  ('lemon', 'Lemon', 2, 'kg', 40000, 3),
  ('jeruk-nipis', 'Jeruk Nipis', 1.2, 'kg', 25000, 2),
  ('susu', 'Susu UHT', 12, 'L', 18000, 5),
  ('cup-16oz', 'Cup 16oz', 200, 'pcs', 800, 50),
  ('cup-12oz', 'Cup 12oz', 150, 'pcs', 700, 50),
  ('sedotan', 'Sedotan', 300, 'pcs', 150, 50),
  ('air', 'Air Galon', 40, 'L', 500, 10)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 🔄 ALTER TABLE MIGRATION SCRIPT (Untuk Database yang Sudah Ada)
-- Copy & Run skrip di bawah ini di Supabase SQL Editor jika database Anda sudah dibuat sebelumnya:
-- ============================================================
/*
ALTER TABLE menus ADD COLUMN IF NOT EXISTS manual_hpp FLOAT DEFAULT 0;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS kitchen_target TEXT DEFAULT NULL;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS show_sugar_level BOOLEAN DEFAULT TRUE;
ALTER TABLE menus ADD COLUMN IF NOT EXISTS show_temperature BOOLEAN DEFAULT TRUE;

ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_id TEXT;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tax INT DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS order_type TEXT DEFAULT 'Dine In';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_number TEXT;

-- Skrip untuk fitur Pending Payment & Split Bill (v4.1):
-- 1) Izinkan status 'Pending' pada CHECK constraint tx_status
DO $$
DECLARE
  cname TEXT;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'transactions'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%tx_status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE transactions DROP CONSTRAINT %I', cname);
  END IF;
END $$;
ALTER TABLE transactions ADD CONSTRAINT transactions_tx_status_check
  CHECK (tx_status IN ('Selesai', 'Cancel', 'Pending', 'Demo'));
-- 2) Kolom tambahan untuk Pending Payment & Split Bill
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS table_name TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_pending BOOLEAN DEFAULT FALSE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS pending_notes TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_parent_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS split_index INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS total_split_count INT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS paid_amount FLOAT;
-- v4.5 TO DO 5.5: kolom promo pending (di-restore saat resume)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS applied_promo_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS voucher_code TEXT;

ALTER TABLE settings ADD COLUMN IF NOT EXISTS kitchen_printers JSONB DEFAULT '[]';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS theme_color TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS theme_shades JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_features JSONB DEFAULT '{"enabled": false, "tables": ["Meja 1", "Meja 2", "Meja 3", "Meja 4", "Meja 5"]}';
-- Kolom settings lain yang ditulis syncSettings (TO DO 2.6/2.7) — pastikan ada di DB lama:
ALTER TABLE settings ADD COLUMN IF NOT EXISTS tax_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS demo_mode BOOLEAN DEFAULT TRUE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_header TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_footer TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS receipt_ascii_only BOOLEAN DEFAULT FALSE;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_print_receipt BOOLEAN DEFAULT FALSE;

ALTER PUBLICATION supabase_realtime ADD TABLE stock_opnames;

-- Skrip untuk fitur Rekap Kas (Kas Masuk & Kas Keluar):
CREATE TABLE IF NOT EXISTS cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('in', 'out')),
  amount FLOAT NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  notes TEXT,
  cashier_id TEXT NOT NULL,
  cashier_name TEXT NOT NULL,
  date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER PUBLICATION supabase_realtime ADD TABLE cash_movements;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for anon" ON cash_movements FOR ALL USING (true) WITH CHECK (true);
*/
