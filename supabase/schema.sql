-- ============================================================
-- BerdikariPOS — Supabase Database Schema (v3.6)
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
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price FLOAT NOT NULL,
  image TEXT,
  is_best_seller BOOLEAN DEFAULT false,
  is_available BOOLEAN DEFAULT true,
  ingredients JSONB DEFAULT '{}',
  available_addons JSONB DEFAULT '[]',
  manual_hpp FLOAT DEFAULT 0,
  kitchen_target TEXT DEFAULT NULL,
  show_sugar_level BOOLEAN DEFAULT true,
  show_temperature BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
  tx_status TEXT NOT NULL DEFAULT 'Selesai' CHECK (tx_status IN ('Selesai', 'Cancel', 'Demo')),
  cashier_id TEXT,
  cashier_name TEXT,
  customer_id TEXT,
  customer_name TEXT,
  hpp FLOAT DEFAULT 0,
  tax INT DEFAULT 0,
  order_type TEXT DEFAULT 'Dine In',
  table_number TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Customers table
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  total_spent FLOAT DEFAULT 0,
  visit_count INT DEFAULT 0,
  last_visit TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

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
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

-- 7. Promos table
CREATE TABLE IF NOT EXISTS promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
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
  created_at TIMESTAMPTZ DEFAULT now()
);

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
  tax_percent FLOAT DEFAULT 0,
  categories JSONB DEFAULT '["Jamu Murni", "Wedang", "Signature", "Segar"]',
  printer_enabled BOOLEAN DEFAULT false,
  printer_type TEXT DEFAULT 'browser',
  printer_width TEXT DEFAULT '58mm',
  auto_print_on_checkout BOOLEAN DEFAULT false,
  super_admin_pin TEXT DEFAULT '000000',
  loyalty_enabled BOOLEAN DEFAULT false,
  loyalty_settings JSONB DEFAULT '{}',
  kitchen_printers JSONB DEFAULT '[]',
  theme_color TEXT,
  theme_shades JSONB,
  table_features_enabled BOOLEAN DEFAULT false,
  available_table_numbers JSONB DEFAULT '[]',
  table_features JSONB DEFAULT '{"enabled": false, "tables": ["Meja 1", "Meja 2", "Meja 3", "Meja 4", "Meja 5"]}'
);

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
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE inventory;
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

ALTER TABLE settings ADD COLUMN IF NOT EXISTS kitchen_printers JSONB DEFAULT '[]';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS theme_color TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS theme_shades JSONB;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS table_features JSONB DEFAULT '{"enabled": false, "tables": ["Meja 1", "Meja 2", "Meja 3", "Meja 4", "Meja 5"]}';

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
