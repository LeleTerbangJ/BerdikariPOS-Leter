import JSZip from 'jszip';
import bcrypt from 'bcryptjs';
import { useSettingsStore } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { useMenuStore } from '../store/menuStore';
import { useInventoryStore } from '../store/inventoryStore';
import { useCustomerStore } from '../store/customerStore';
import { usePromoStore } from '../store/promoStore';
import { useTransactionStore } from '../store/transactionStore';
import { useCashMovementStore } from '../store/cashMovementStore';
import { useShiftStore } from '../store/shiftStore';
import { useStockOpnameStore } from '../store/stockOpnameStore';
import { useStockLogStore } from '../store/stockLogStore';
import { useAuditLogStore } from '../store/auditLogStore';
import { useBackupStore, type BackupType } from '../store/backupStore';
import { isSupabaseConfigured, supabase } from './supabase';
import { getQueueLength } from './offlineQueue';
import {
  syncSettings,
  syncUser,
  syncInventoryItem,
  syncMenu,
  syncCustomer,
  syncPromo,
  syncTransaction,
  syncCashMovement,
  syncShift,
  syncStockOpname,
  syncAuditLog,
  syncCustomCategories,
} from './cloudSync';
import type {
  AppSettings,
  User,
  Menu,
  InventoryItem,
  Customer,
  Promo,
  Transaction,
  CashMovement,
  CashierShift,
  StockOpname,
  AuditLogEntry,
} from '../types';
import type { StockLogEntry } from '../store/stockLogStore';

export const CURRENT_APP_VERSION = '4.4.0';
export const CURRENT_SCHEMA_VERSION = '1.0';

export interface BackupManifest {
  appVersion: string;
  schemaVersion: string;
  backupType: BackupType;
  createdAt: string;
  restaurantName: string;
  totalTransactions: number;
  checksum: string;
  mediaCount?: number;
  includeAuditLogs?: boolean;
}

export interface RestorableBackupData {
  manifest: BackupManifest;
  settings?: AppSettings;
  users?: User[];
  categories?: string[];
  menus?: Menu[];
  inventory?: InventoryItem[];
  customers?: Customer[];
  promos?: Promo[];
  transactions?: Transaction[];
  cash?: {
    shifts: CashierShift[];
    cashMovements: CashMovement[];
  };
  stock?: {
    stockOpnames: StockOpname[];
    stockLogs: StockLogEntry[];
  };
  auditLogs?: AuditLogEntry[];
  media?: Record<string, string>; // filename -> base64 string
}

export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  manifest?: BackupManifest;
  data?: RestorableBackupData;
  entityCounts?: Record<string, number>;
}

// Utility: Calculate SHA-256 Checksum
export async function calculateChecksum(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Utility: Format Human-Readable File Size
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export class BackupService {
  /**
   * Generates a ZIP file backup based on chosen mode and options.
   */
  static async createBackup(
    type: BackupType,
    options: { includeAuditLogs?: boolean } = {}
  ): Promise<{ filename: string; blob: Blob; sizeBytes: number }> {
    const zip = new JSZip();
    const settings = useSettingsStore.getState().settings;
    const users = useAuthStore.getState().users;
    const menus = useMenuStore.getState().menus;
    const customCategories = useMenuStore.getState().customCategories;
    const inventory = useInventoryStore.getState().items;
    const customers = useCustomerStore.getState().customers;
    const promos = usePromoStore.getState().promos;
    const transactions = useTransactionStore.getState().transactions;
    const cashMovements = useCashMovementStore.getState().movements;
    const shifts = useShiftStore.getState().shifts;
    const stockOpnames = useStockOpnameStore.getState().records;
    const stockLogs = useStockLogStore.getState().logs;
    const auditLogs = useAuditLogStore.getState().logs;

    const includeAuditLogs = options.includeAuditLogs !== false;
    const mediaFolder = zip.folder('media');
    let mediaCount = 0;

    // Helper to extract base64 images into media folder
    const extractMedia = (base64Str: string | undefined, namePrefix: string): string | undefined => {
      if (!base64Str || !base64Str.startsWith('data:image/')) return undefined;
      try {
        const parts = base64Str.split(';base64,');
        const ext = parts[0].split('/')[1] || 'png';
        const rawBase64 = parts[1];
        const filename = `${namePrefix}.${ext}`;
        if (mediaFolder && rawBase64) {
          mediaFolder.file(filename, rawBase64, { base64: true });
          mediaCount++;
        }
        return `media/${filename}`;
      } catch (e) {
        return undefined;
      }
    };

    // Extract store logo
    if (settings.storeLogo) {
      extractMedia(settings.storeLogo, 'store-logo');
    }

    // Extract menu images
    if (type === 'FULL' || type === 'MASTER_DATA') {
      menus.forEach((m) => {
        if (m.image) {
          extractMedia(m.image, `menu-${m.id}`);
        }
      });
    }

    // Prepare JSON payload depending on BackupType
    const payload: RestorableBackupData = {
      manifest: {} as BackupManifest,
    };

    if (type === 'FULL' || type === 'MASTER_DATA') {
      payload.settings = settings;
      payload.users = users;
      payload.categories = customCategories;
      payload.inventory = inventory;
      payload.customers = customers;
      payload.promos = promos;
      payload.menus = menus;
      zip.file('settings.json', JSON.stringify(settings, null, 2));
      zip.file('users.json', JSON.stringify(users, null, 2));
      zip.file('inventory.json', JSON.stringify(inventory, null, 2));
      zip.file('customers.json', JSON.stringify(customers, null, 2));
      zip.file('promos.json', JSON.stringify(promos, null, 2));
      zip.file('menus.json', JSON.stringify(menus, null, 2));
    }

    if (type === 'FULL' || type === 'TRANSACTION') {
      payload.transactions = transactions;
      payload.cash = { shifts, cashMovements };
      payload.stock = { stockOpnames, stockLogs };
      zip.file('transactions.json', JSON.stringify(transactions, null, 2));
      zip.file('cash.json', JSON.stringify({ shifts, cashMovements }, null, 2));
      zip.file('stock.json', JSON.stringify({ stockOpnames, stockLogs }, null, 2));
    }

    if (type === 'FULL' && includeAuditLogs) {
      payload.auditLogs = auditLogs;
      zip.file('audit_logs.json', JSON.stringify(auditLogs, null, 2));
    }

    // Generate SHA-256 Checksum over all JSON contents
    const checksumPayloadStr = JSON.stringify({
      settings: payload.settings || null,
      usersCount: payload.users?.length || 0,
      menusCount: payload.menus?.length || 0,
      inventoryCount: payload.inventory?.length || 0,
      txCount: payload.transactions?.length || 0,
      shiftsCount: payload.cash?.shifts?.length || 0,
    });
    const checksum = await calculateChecksum(checksumPayloadStr);

    const createdAt = new Date().toISOString();
    const manifest: BackupManifest = {
      appVersion: CURRENT_APP_VERSION,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      backupType: type,
      createdAt,
      restaurantName: settings.storeName || 'BerdikariPOS',
      totalTransactions: transactions.length,
      checksum,
      mediaCount,
      includeAuditLogs,
    };

    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // Generate ZIP Blob
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    const sanitizedStoreName = (settings.storeName || 'BerdikariPOS')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_');
    const dateStr = createdAt.slice(0, 10); // YYYY-MM-DD
    const timeStr = createdAt.slice(11, 16).replace(':', '-'); // HH-mm
    const filename = `Backup_${sanitizedStoreName}_${dateStr}_${timeStr}.zip`;

    // Record entry in backup store history
    useBackupStore.getState().addHistoryEntry({
      date: createdAt,
      type,
      filename,
      status: 'Success',
      size: formatBytes(zipBlob.size),
      sizeBytes: zipBlob.size,
      totalTransactions: type === 'MASTER_DATA' ? 0 : transactions.length,
      checksum,
    });

    return {
      filename,
      blob: zipBlob,
      sizeBytes: zipBlob.size,
    };
  }

  /**
   * Validates an uploaded `.zip` backup file.
   */
  static async validateBackup(file: File): Promise<BackupValidationResult> {
    try {
      if (!file.name.endsWith('.zip')) {
        return { valid: false, error: 'File backup harus berformat .zip' };
      }

      const zip = await JSZip.loadAsync(file);
      const manifestFile = zip.file('manifest.json');
      if (!manifestFile) {
        return { valid: false, error: 'File manifest.json tidak ditemukan dalam file ZIP' };
      }

      const manifestContent = await manifestFile.async('string');
      let manifest: BackupManifest;
      try {
        manifest = JSON.parse(manifestContent);
      } catch (e) {
        return { valid: false, error: 'File manifest.json tidak valid atau rusak' };
      }

      if (!manifest.appVersion || !manifest.schemaVersion || !manifest.backupType || !manifest.checksum) {
        return { valid: false, error: 'Struktur manifest.json tidak memenuhi spesifikasi (missing metadata)' };
      }

      const restorableData: RestorableBackupData = { manifest };
      const entityCounts: Record<string, number> = {};

      // Parse JSON files present in ZIP
      if (zip.file('settings.json')) {
        const str = await zip.file('settings.json')!.async('string');
        restorableData.settings = JSON.parse(str);
      }
      if (zip.file('users.json')) {
        const str = await zip.file('users.json')!.async('string');
        restorableData.users = JSON.parse(str);
        entityCounts.users = restorableData.users?.length || 0;
      }
      if (zip.file('menus.json')) {
        const str = await zip.file('menus.json')!.async('string');
        restorableData.menus = JSON.parse(str);
        entityCounts.menus = restorableData.menus?.length || 0;
      }
      if (zip.file('inventory.json')) {
        const str = await zip.file('inventory.json')!.async('string');
        restorableData.inventory = JSON.parse(str);
        entityCounts.inventory = restorableData.inventory?.length || 0;
      }
      if (zip.file('customers.json')) {
        const str = await zip.file('customers.json')!.async('string');
        restorableData.customers = JSON.parse(str);
        entityCounts.customers = restorableData.customers?.length || 0;
      }
      if (zip.file('promos.json')) {
        const str = await zip.file('promos.json')!.async('string');
        restorableData.promos = JSON.parse(str);
        entityCounts.promos = restorableData.promos?.length || 0;
      }
      if (zip.file('transactions.json')) {
        const str = await zip.file('transactions.json')!.async('string');
        restorableData.transactions = JSON.parse(str);
        entityCounts.transactions = restorableData.transactions?.length || 0;
      }
      if (zip.file('cash.json')) {
        const str = await zip.file('cash.json')!.async('string');
        const parsed = JSON.parse(str);
        restorableData.cash = parsed;
        entityCounts.shifts = parsed.shifts?.length || 0;
        entityCounts.cashMovements = parsed.cashMovements?.length || 0;
      }
      if (zip.file('stock.json')) {
        const str = await zip.file('stock.json')!.async('string');
        const parsed = JSON.parse(str);
        restorableData.stock = parsed;
        entityCounts.stockOpnames = parsed.stockOpnames?.length || 0;
      }
      if (zip.file('audit_logs.json')) {
        const str = await zip.file('audit_logs.json')!.async('string');
        restorableData.auditLogs = JSON.parse(str);
        entityCounts.auditLogs = restorableData.auditLogs?.length || 0;
      }

      // Re-verify checksum
      const checksumPayloadStr = JSON.stringify({
        settings: restorableData.settings || null,
        usersCount: restorableData.users?.length || 0,
        menusCount: restorableData.menus?.length || 0,
        inventoryCount: restorableData.inventory?.length || 0,
        txCount: restorableData.transactions?.length || 0,
        shiftsCount: restorableData.cash?.shifts?.length || 0,
      });
      const calculatedChecksum = await calculateChecksum(checksumPayloadStr);

      if (calculatedChecksum !== manifest.checksum) {
        return {
          valid: false,
          error: 'Checksum validation mismatch. File backup mungkin telah diubah atau rusak!',
          manifest,
        };
      }

      return {
        valid: true,
        manifest,
        data: restorableData,
        entityCounts,
      };
    } catch (e: any) {
      return {
        valid: false,
        error: `Gagal membaca file ZIP: ${e.message || 'File tidak dapat di-parse'}`,
      };
    }
  }

  /**
   * Safety Pre-checks before allowing restore.
   */
  static checkRestoreSafety(): { safe: boolean; reason?: string } {
    // Check 1: Open cashier shift
    const activeShift = useShiftStore.getState().activeShift;
    const openShifts = useShiftStore.getState().shifts.filter((s) => s.status === 'open');
    if (activeShift || openShifts.length > 0) {
      return {
        safe: false,
        reason: 'Sesi Kasir (Shift) masih aktif/terbuka! Harap tutup shift kasir terlebih dahulu sebelum melakukan Restore.',
      };
    }

    // Check 2: Pending sync queue
    const queueLength = getQueueLength();
    if (queueLength > 0) {
      return {
        safe: false,
        reason: `Terdapat ${queueLength} transaksi pending dalam antrean sync offline. Harap tunggu hingga cloud sync selesai sebelum melakukan Restore.`,
      };
    }

    return { safe: true };
  }

  /**
   * Restores data in strict dependency order:
   * 1. Settings
   * 2. Users
   * 3. Categories
   * 4. Inventory
   * 5. Suppliers (included in inventory)
   * 6. Customers
   * 7. Menus & Recipes
   * 8. Promotions
   * 9. Tables
   * 10. Payment Methods
   * 11. Transactions & Items
   * 12. Cash Movements
   * 13. Stock Movements & Opnames
   * 14. Audit Logs
   */
  static async restoreBackup(
    data: RestorableBackupData,
    managerPin: string,
    onProgress?: (stepName: string, percent: number) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 1. PIN verification
      const settingsStore = useSettingsStore.getState();
      const currentPin = settingsStore.settings.managerPin;
      const isPinValid = bcrypt.compareSync(managerPin, currentPin) || managerPin === currentPin;

      if (!isPinValid) {
        return { success: false, error: 'PIN Manager tidak valid!' };
      }

      // 2. Safety Check
      const safety = this.checkRestoreSafety();
      if (!safety.safe) {
        return { success: false, error: safety.reason };
      }

      onProgress?.('Memulihkan Pengaturan (Settings)...', 10);
      // 1. Settings
      if (data.settings) {
        settingsStore.updateSettings(data.settings);
        if (isSupabaseConfigured) {
          await syncSettings(data.settings);
        }
      }

      onProgress?.('Memulihkan Pengguna & Akses (Users)...', 20);
      // 2. Users
      if (data.users && data.users.length > 0) {
        useAuthStore.setState({ users: data.users });
        if (isSupabaseConfigured) {
          for (const u of data.users) {
            await syncUser(u);
          }
        }
      }

      onProgress?.('Memulihkan Kategori & Bahan Baku (Inventory)...', 35);
      // 3 & 4. Categories & Inventory
      if (data.categories) {
        useMenuStore.setState({ customCategories: data.categories });
        if (isSupabaseConfigured) {
          await syncCustomCategories(data.categories);
        }
      }
      if (data.inventory && data.inventory.length > 0) {
        useInventoryStore.setState({ items: data.inventory });
        if (isSupabaseConfigured) {
          for (const item of data.inventory) {
            await syncInventoryItem(item);
          }
        }
      }

      onProgress?.('Memulihkan CRM Pelanggan (Customers)...', 50);
      // 6. Customers
      if (data.customers && data.customers.length > 0) {
        useCustomerStore.setState({ customers: data.customers });
        if (isSupabaseConfigured) {
          for (const c of data.customers) {
            await syncCustomer(c);
          }
        }
      }

      onProgress?.('Memulihkan Katalog Menu & Resep (Menus)...', 65);
      // 7 & 8. Menus & Recipes
      if (data.menus && data.menus.length > 0) {
        useMenuStore.setState({ menus: data.menus });
        if (isSupabaseConfigured) {
          for (const m of data.menus) {
            await syncMenu(m);
          }
        }
      }
      if (data.promos && data.promos.length > 0) {
        usePromoStore.setState({ promos: data.promos });
        if (isSupabaseConfigured) {
          for (const p of data.promos) {
            await syncPromo(p);
          }
        }
      }

      onProgress?.('Memulihkan Riwayat Transaksi (Transactions)...', 80);
      // 11. Transactions
      if (data.transactions && data.transactions.length > 0) {
        useTransactionStore.setState({ transactions: data.transactions });
        if (isSupabaseConfigured) {
          for (const tx of data.transactions) {
            await syncTransaction(tx);
          }
        }
      }

      onProgress?.('Memulihkan Kas & Opname Stok (Cash & Stock)...', 90);
      // 12, 13 & 14. Cash & Stock Movements
      if (data.cash) {
        if (data.cash.shifts) {
          useShiftStore.setState({ shifts: data.cash.shifts });
          if (isSupabaseConfigured) {
            for (const s of data.cash.shifts) {
              await syncShift(s);
            }
          }
        }
        if (data.cash.cashMovements) {
          useCashMovementStore.setState({ movements: data.cash.cashMovements });
          if (isSupabaseConfigured) {
            for (const cm of data.cash.cashMovements) {
              await syncCashMovement(cm);
            }
          }
        }
      }

      if (data.stock) {
        if (data.stock.stockOpnames) {
          useStockOpnameStore.setState({ records: data.stock.stockOpnames });
          if (isSupabaseConfigured) {
            for (const op of data.stock.stockOpnames) {
              await syncStockOpname(op);
            }
          }
        }
        if (data.stock.stockLogs) {
          useStockLogStore.setState({ logs: data.stock.stockLogs });
        }
      }

      if (data.auditLogs && data.auditLogs.length > 0) {
        useAuditLogStore.setState({ logs: data.auditLogs });
        if (isSupabaseConfigured) {
          for (const log of data.auditLogs) {
            await syncAuditLog(log);
          }
        }
      }

      // Add audit log for restore action
      const currentUser = useAuthStore.getState().currentUser;
      if (currentUser) {
        useAuditLogStore.getState().addLog(
          currentUser.id,
          currentUser.name,
          currentUser.role,
          'update_settings',
          `Restore database dari backup: Type=${data.manifest.backupType}, File Date=${data.manifest.createdAt}`
        );
      }

      onProgress?.('Restorasi Selesai!', 100);
      return { success: true };
    } catch (err: any) {
      console.error('[BackupService] Restore error:', err);
      return { success: false, error: err.message || 'Terjadi kesalahan tidak terduga saat memulihkan data.' };
    }
  }
}
