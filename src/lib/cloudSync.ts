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
import type { 
  User, InventoryItem, Menu, Transaction, Customer, 
  CashierShift, Promo, AuditLogEntry, AppSettings, LoyaltySettings,
  StockOpname, CashMovement
} from '../types';
import type { StockLogEntry } from '../store/stockLogStore';

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
  } catch (e) {
    console.warn('[Migration] Could not verify schema:', e);
  }
}

// Track which migrations are needed so sync functions can adapt
const migrationNeeded = { manualHpp: false, activeSessionId: false, tax: false, kitchenTarget: false, kitchenPrinters: false, showSugarLevel: false, themeColor: false, themeShades: false, showTemperature: false, orderType: false, tableFeatures: false, tableNumber: false };
export function isMigrationNeeded(key: keyof typeof migrationNeeded) {
  return migrationNeeded[key];
}

// NOTE: camelCase↔snake_case mapping is done explicitly per sync function
// for full control and visibility of field mappings.

// ============================================================
// TRANSACTIONS (most critical for KDS real-time)
// ============================================================

export async function syncTransaction(tx: Transaction) {
  if (!isSupabaseConfigured) return;
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
    data.table_number = tx.tableNumber || null;
  }
  await smartUpsert('transactions', data);
}

export async function syncTransactionStatus(id: string, kitchenStatus: string) {
  if (!isSupabaseConfigured) return;
  await smartUpdate('transactions', { kitchen_status: kitchenStatus }, 'id', id);
}

export async function syncTransactionTxStatus(id: string, txStatus: string) {
  if (!isSupabaseConfigured) return;
  await smartUpdate('transactions', { tx_status: txStatus }, 'id', id);
}

export async function deleteTransactionCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('transactions', 'id', id);
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
      tableNumber: row.table_number || undefined,
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
  
  const channel = supabase
    .channel('transactions-realtime')
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
    supabase.removeChannel(channel);
  }
}

export function subscribeToUsers(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;
  
  const channel = supabase
    .channel('auth-users-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      callback
    )
    .subscribe();

  return channel;
}

export function subscribeToStockOpnames(callback: (payload: any) => void) {
  if (!isSupabaseConfigured) return null;

  const channel = supabase
    .channel('stock-opnames-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'stock_opnames' },
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
  });
}

export async function syncInventoryDeduction(deductions: Record<string, number>, items: InventoryItem[]) {
  if (!isSupabaseConfigured) return;
  // BUG-C1 fix: items already contain post-deduction stock values (deducted in inventoryStore).
  // Previously this subtracted `amount` again, causing double deduction in cloud.
  for (const [id] of Object.entries(deductions)) {
    const item = items.find((i) => i.id === id);
    if (item) {
      await smartUpdate('inventory', { stock: item.stock }, 'id', id);
    }
  }
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
    is_available: menu.isAvailable,
    ingredients: menu.ingredients,
    available_addons: menu.availableAddons,
    description: menu.description,
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
  await smartUpsert('customers', {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    notes: customer.notes,
    total_spent: customer.totalSpent,
    visit_count: customer.visitCount,
    last_visit: customer.lastVisit,
    created_at: customer.createdAt,
  });
}

export async function deleteCustomerCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('customers', 'id', id);
}

// ============================================================
// SHIFTS
// ============================================================

export async function syncShift(shift: CashierShift) {
  if (!isSupabaseConfigured) return;
  await smartUpsert('shifts', {
    id: shift.id,
    user_id: shift.userId,
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
    demo_mode: settings.demoMode,
  };
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
  await smartUpsert('promos', {
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
  });
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
      notes: row.notes || undefined,
    })) || null;
  } catch {
    return null;
  }
}

// ============================================================
// CASH MOVEMENTS (Rekap Kas: Kas Masuk & Kas Keluar)
// ============================================================

export async function syncCashMovement(movement: CashMovement) {
  if (!isSupabaseConfigured) return;
  await smartUpsert('cash_movements', {
    id: movement.id,
    shift_id: movement.shiftId || null,
    type: movement.type,
    amount: movement.amount,
    category: movement.category,
    notes: movement.notes || null,
    cashier_id: movement.cashierId,
    cashier_name: movement.cashierName,
    date: movement.date,
    created_at: movement.createdAt,
  });
}

export async function fetchCashMovementsFromCloud(): Promise<CashMovement[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.from('cash_movements').select('*').order('date', { ascending: false }).limit(500);
    if (error) return null;
    return data?.map((row) => ({
      id: row.id,
      shiftId: row.shift_id || undefined,
      type: row.type as 'in' | 'out',
      amount: row.amount,
      category: row.category,
      notes: row.notes || undefined,
      cashierId: row.cashier_id,
      cashierName: row.cashier_name,
      date: row.date,
      createdAt: row.created_at || row.date,
    })) || null;
  } catch {
    return null;
  }
}

export async function deleteCashMovementCloud(id: string) {
  if (!isSupabaseConfigured) return;
  await smartDelete('cash_movements', 'id', id);
}
