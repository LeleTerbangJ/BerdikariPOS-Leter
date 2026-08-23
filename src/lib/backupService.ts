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
  syncStockLog,
} from './cloudSync';
import { syncComponentToCloud } from './bundleRepository';
import type {
  AppSettings,
  User,
  Menu,
  MenuComponent,
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

// v4.7 TO DO 7.7: sinkron dengan versi fitur aktual (sebelumnya usang di '4.4.0')
export const CURRENT_APP_VERSION = '4.7.0';
// v2.0 (7.1/7.3): checksum berbasis ISI seluruh file (JSON + media teks base64), bukan count
// Legacy v1.0 tetap divalidasi dengan checksum count-based agar backup lama tidak ditolak.
export const CURRENT_SCHEMA_VERSION = '2.0';

/** Versi schema yang masih bisa direstore. Di luar daftar ini → backup DITOLAK (bukan gagal diam-diam). */
export const SUPPORTED_SCHEMA_VERSIONS = ['1.0', '2.0'];

/**
 * Tabel migrasi manifest (TO DO 7.7): schemaVersion lama → transformasi data sebelum restore.
 * Saat ini 1.0 → 2.0 tidak butuh transform isi (media biner v1.0 diabaikan; checksum count-based
 * ditangani jalur legacy; field baru semuanya opsional). Entri BARU ditambahkan di sini setiap
 * kali format backup berubah — restore backup lama tidak pernah gagal/hilang field diam-diam.
 */
const MANIFEST_MIGRATIONS: Record<string, (data: RestorableBackupData) => RestorableBackupData> = {
  '1.0': (data) => data, // legacy passthrough
  '2.0': (data) => data,
};

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
  // v4.7 TO DO 7.4: struktur bundle/add-on (menu_components) — dipisah dari field denormalized di menus
  menuComponents?: MenuComponent[];
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

// ============================================================
// 7.1 — Checksum berbasis ISI (bukan count)
// ============================================================

/**
 * Serialisasi deterministik dari kumpulan (nama, isi) file backup.
 * Nama diurutkan agar urutan tidak memengaruhi hasil hash.
 */
function buildChecksumPayload(entries: { name: string; content: string }[]): string {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.name}\u0000${e.content}`)
    .join('\u0001');
}

/**
 * Payload checksum LEGACY (schemaVersion 1.0) — hanya menghitung JUMLAH entitas.
 * Dipertahankan agar backup lama tetap bisa divalidasi.
 */
function buildLegacyChecksumPayload(data: {
  settings: unknown;
  users: unknown[];
  menus: unknown[];
  inventory: unknown[];
  transactions: unknown[];
  shifts: unknown[];
}): string {
  return JSON.stringify({
    settings: data.settings || null,
    usersCount: data.users?.length || 0,
    menusCount: data.menus?.length || 0,
    inventoryCount: data.inventory?.length || 0,
    txCount: data.transactions?.length || 0,
    shiftsCount: data.shifts?.length || 0,
  });
}

// ============================================================
// 7.2 — Scope tabel yang di-wipe pada mode Replace (anak dihapus lebih dulu)
// ============================================================

const REPLACE_SCOPE: Record<BackupType, string[]> = {
  FULL: [
    'transactions',
    'cash_movements',
    'stock_opnames',
    'stock_logs',
    'shifts',
    'audit_logs',
    'customers',
    'promos',
    'menu_components',
    'menus',
    'inventory',
    'users',
  ],
  MASTER_DATA: ['menu_components', 'menus', 'inventory', 'customers', 'promos', 'users'],
  TRANSACTION: ['transactions', 'shifts', 'cash_movements', 'stock_opnames', 'stock_logs'],
};

/**
 * Hapus SEMUA baris pada tabel cloud (mode Replace = snapshot penuh).
 * Gagal satu tabel tidak menghentikan proses (di-warn saja).
 * T9 fix (AUDIT-OX): collector opsional mencatat tabel yang berhasil dikirim perintah
 * hapusnya — dipakai pesan kegagalan restore di tengah jalan (cloud kondisi campuran).
 */
async function wipeCloudTables(tables: string[], wipedCollector?: string[]): Promise<void> {
  if (!isSupabaseConfigured || tables.length === 0) return;
  for (const t of tables) {
    try {
      // Re-audit T9 fix: cek `error` hasil delete (bukan hanya exception) — collector
      // hanya mencatat tabel yang BENAR-BENAR terhapus, bukan sekadar dicoba.
      const { error } = await supabase.from(t).delete().neq('id', '');
      if (!error) {
        wipedCollector?.push(t);
      } else {
        console.warn(`[BackupService] Replace: hapus tabel ${t} ditolak:`, error.message);
      }
    } catch (e) {
      console.warn(`[BackupService] Replace: gagal menghapus tabel ${t}:`, e);
    }
  }
}

/**
 * T9 fix (AUDIT-OX): helper murni — validasi struktur minimum RestorableBackupData
 * SEBELUM wipe/restore dieksekusi. Return pesan error bila tidak valid, null bila OK.
 */
export function assertRestorableStructure(data: RestorableBackupData): string | null {
  if (!data || typeof data !== 'object') return 'data backup kosong / bukan objek';
  if (!data.manifest || typeof data.manifest !== 'object') return 'manifest tidak ditemukan';
  const arrayFields: Array<[string, unknown]> = [
    ['users', data.users],
    ['menus', data.menus],
    ['menuComponents', data.menuComponents],
    ['inventory', data.inventory],
    ['customers', data.customers],
    ['promos', data.promos],
    ['transactions', data.transactions],
    ['auditLogs', data.auditLogs],
  ];
  for (const [name, value] of arrayFields) {
    if (value !== undefined && !Array.isArray(value)) {
      return `field "${name}" harus berupa array`;
    }
  }
  if (data.cash !== undefined) {
    if (typeof data.cash !== 'object' || data.cash === null) return 'field "cash" harus berupa objek';
    if (data.cash.shifts !== undefined && !Array.isArray(data.cash.shifts)) return '"cash.shifts" harus berupa array';
    if (data.cash.cashMovements !== undefined && !Array.isArray(data.cash.cashMovements)) return '"cash.cashMovements" harus berupa array';
  }
  if (data.stock !== undefined) {
    if (typeof data.stock !== 'object' || data.stock === null) return 'field "stock" harus berupa objek';
    if (data.stock.stockOpnames !== undefined && !Array.isArray(data.stock.stockOpnames)) return '"stock.stockOpnames" harus berupa array';
    if (data.stock.stockLogs !== undefined && !Array.isArray(data.stock.stockLogs)) return '"stock.stockLogs" harus berupa array';
  }
  return null;
}

// ============================================================
// 7.6 — Upload ke Supabase Storage & unduhan browser (shared helper)
// ============================================================

/** Bucket penyimpanan backup di Supabase Storage (buat manual sekali di dashboard/SQL Editor). */
export const BACKUP_STORAGE_BUCKET = 'backups';

/**
 * Pemicu unduhan file ke browser (dipakai BackupSection & scheduler auto backup).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return; // lingkungan non-browser (test/desktop headless)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Upload file backup ke Supabase Storage (bucket `backups`).
 * anon key TIDAK bisa membuat bucket/policy — jika bucket belum ada, gagal dengan
 * pesan yang mencantumkan SQL idempoten untuk dijalankan sekali di SQL Editor.
 */
export async function uploadBackupToSupabase(
  blob: Blob,
  filename: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'Supabase belum dikonfigurasi (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).' };
  }
  try {
    const { error } = await supabase.storage
      .from(BACKUP_STORAGE_BUCKET)
      .upload(filename, blob, { contentType: 'application/zip', upsert: true });
    if (error) {
      console.warn(`[AutoBackup] Upload ke Supabase Storage gagal: ${error.message}`);
      console.warn('[AutoBackup] Pastikan bucket "backups" sudah dibuat + policy anon. Jalankan SEKALI di SQL Editor:');
      console.warn(`  INSERT INTO storage.buckets (id, name, public) VALUES ('${BACKUP_STORAGE_BUCKET}', '${BACKUP_STORAGE_BUCKET}', false) ON CONFLICT (id) DO NOTHING;`);
      console.warn(`  CREATE POLICY "Allow anon upload ${BACKUP_STORAGE_BUCKET}" ON storage.objects FOR INSERT TO anon WITH CHECK (bucket_id = '${BACKUP_STORAGE_BUCKET}');`);
      console.warn(`  CREATE POLICY "Allow anon read ${BACKUP_STORAGE_BUCKET}" ON storage.objects FOR SELECT TO anon USING (bucket_id = '${BACKUP_STORAGE_BUCKET}');`);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    console.warn('[AutoBackup] Exception upload:', e);
    return { ok: false, error: e?.message || 'Gagal upload ke Supabase Storage.' };
  }
}

// ============================================================
// 7.3 — Resolusi media backup (referensi `media/...` → data URL)
// ============================================================

/**
 * Ubah referensi `media/<file>` menjadi data URL dari folder media backup.
 * Nilai yang bukan referensi media / tidak ditemukan dikembalikan apa adanya.
 */
export function resolveMediaUrl(
  imagePath: string | undefined,
  media?: Record<string, string>
): string | undefined {
  if (!imagePath || !media) return imagePath;
  if (!imagePath.startsWith('media/')) return imagePath;
  const b64 = media[imagePath];
  if (!b64) return imagePath;
  const ext = imagePath.split('.').pop() || 'png';
  return `data:image/${ext};base64,${b64}`;
}

export class BackupService {
  /**
   * Generates a ZIP file backup based on chosen mode and options.
   */
  static async createBackup(
    type: BackupType,
    options: { includeAuditLogs?: boolean } = {}
  ): Promise<{ filename: string; blob: Blob; sizeBytes: number; historyId: string }> {
    const zip = new JSZip();
    const settings = useSettingsStore.getState().settings;
    const users = useAuthStore.getState().users;
    const menus = useMenuStore.getState().menus;
    const menuComponents = useMenuStore.getState().menuComponents;
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
    // 7.1: kumpulan (nama, isi) seluruh file untuk checksum berbasis isi
    const checksumEntries: { name: string; content: string }[] = [];

    // Helper to extract base64 images into media folder
    const extractMedia = (base64Str: string | undefined, namePrefix: string): string | undefined => {
      if (!base64Str || !base64Str.startsWith('data:image/')) return undefined;
      try {
        const parts = base64Str.split(';base64,');
        const ext = parts[0].split('/')[1] || 'png';
        const rawBase64 = parts[1];
        const filename = `${namePrefix}.${ext}`;
        if (mediaFolder && rawBase64) {
          // 7.3: simpan base64 sebagai TEKS — deterministik untuk validasi & restore
          mediaFolder.file(filename, rawBase64);
          checksumEntries.push({ name: `media/${filename}`, content: rawBase64 });
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

    // Tulis file JSON + catat isinya untuk checksum berbasis isi (7.1)
    const addJsonFile = (name: string, value: unknown) => {
      const content = JSON.stringify(value, null, 2);
      zip.file(name, content);
      checksumEntries.push({ name, content });
    };

    if (type === 'FULL' || type === 'MASTER_DATA') {
      payload.settings = settings;
      payload.users = users;
      payload.categories = customCategories;
      payload.inventory = inventory;
      payload.customers = customers;
      payload.promos = promos;
      payload.menus = menus;
      // v4.7 TO DO 7.4: struktur bundle/add-on dibackup sebagai file tersendiri
      payload.menuComponents = menuComponents;
      addJsonFile('settings.json', settings);
      addJsonFile('users.json', users);
      addJsonFile('inventory.json', inventory);
      addJsonFile('customers.json', customers);
      addJsonFile('promos.json', promos);
      addJsonFile('menus.json', menus);
      addJsonFile('menu_components.json', menuComponents);
    }

    if (type === 'FULL' || type === 'TRANSACTION') {
      payload.transactions = transactions;
      payload.cash = { shifts, cashMovements };
      payload.stock = { stockOpnames, stockLogs };
      addJsonFile('transactions.json', transactions);
      addJsonFile('cash.json', { shifts, cashMovements });
      addJsonFile('stock.json', { stockOpnames, stockLogs });
    }

    if (type === 'FULL' && includeAuditLogs) {
      payload.auditLogs = auditLogs;
      addJsonFile('audit_logs.json', auditLogs);
    }

    // 7.1: SHA-256 berbasis ISI seluruh file JSON + media (urutan nama deterministik)
    const checksum = await calculateChecksum(buildChecksumPayload(checksumEntries));

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
    // S4 fix (AUDIT-OX): kembalikan historyId agar pemanggil (scheduler auto-backup) bisa
    // memperbarui status setelah hasil sebenarnya diketahui (upload cloud berhasil/gagal).
    const historyId = useBackupStore.getState().addHistoryEntry({
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
      historyId,
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

      // Konversi ke ArrayBuffer dulu: JSZip di lingkungan non-browser (Node/desktop) tidak bisa
      // membaca Blob/File secara langsung, tapi menerima ArrayBuffer/Uint8Array dengan baik.
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
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

      // TO DO 7.7: blokir backup dari versi schema yang tidak dikenal — lebih baik tolak
      // eksplisit daripada restore dengan field hilang diam-diam.
      if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
        return {
          valid: false,
          error: `Schema version ${manifest.schemaVersion} tidak didukung. Versi yang didukung: ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}. Perbarui aplikasi lalu coba lagi.`,
        };
      }

      const restorableData: RestorableBackupData = { manifest };
      const entityCounts: Record<string, number> = {};
      // 7.1: kumpulan isi MENTAH file (sebelum parse) untuk checksum berbasis isi
      const rawContents: { name: string; content: string }[] = [];

      // Parse JSON files present in ZIP
      if (zip.file('settings.json')) {
        const str = await zip.file('settings.json')!.async('string');
        rawContents.push({ name: 'settings.json', content: str });
        restorableData.settings = JSON.parse(str);
      }
      if (zip.file('users.json')) {
        const str = await zip.file('users.json')!.async('string');
        rawContents.push({ name: 'users.json', content: str });
        restorableData.users = JSON.parse(str);
        entityCounts.users = restorableData.users?.length || 0;
      }
      if (zip.file('menus.json')) {
        const str = await zip.file('menus.json')!.async('string');
        rawContents.push({ name: 'menus.json', content: str });
        restorableData.menus = JSON.parse(str);
        entityCounts.menus = restorableData.menus?.length || 0;
      }
      // v4.7 TO DO 7.4: struktur bundle/add-on di-restore dari file sendiri
      if (zip.file('menu_components.json')) {
        const str = await zip.file('menu_components.json')!.async('string');
        rawContents.push({ name: 'menu_components.json', content: str });
        restorableData.menuComponents = JSON.parse(str);
        entityCounts.menuComponents = restorableData.menuComponents?.length || 0;
      }
      if (zip.file('inventory.json')) {
        const str = await zip.file('inventory.json')!.async('string');
        rawContents.push({ name: 'inventory.json', content: str });
        restorableData.inventory = JSON.parse(str);
        entityCounts.inventory = restorableData.inventory?.length || 0;
      }
      if (zip.file('customers.json')) {
        const str = await zip.file('customers.json')!.async('string');
        rawContents.push({ name: 'customers.json', content: str });
        restorableData.customers = JSON.parse(str);
        entityCounts.customers = restorableData.customers?.length || 0;
      }
      if (zip.file('promos.json')) {
        const str = await zip.file('promos.json')!.async('string');
        rawContents.push({ name: 'promos.json', content: str });
        restorableData.promos = JSON.parse(str);
        entityCounts.promos = restorableData.promos?.length || 0;
      }
      if (zip.file('transactions.json')) {
        const str = await zip.file('transactions.json')!.async('string');
        rawContents.push({ name: 'transactions.json', content: str });
        restorableData.transactions = JSON.parse(str);
        entityCounts.transactions = restorableData.transactions?.length || 0;
      }
      if (zip.file('cash.json')) {
        const str = await zip.file('cash.json')!.async('string');
        rawContents.push({ name: 'cash.json', content: str });
        const parsed = JSON.parse(str);
        restorableData.cash = parsed;
        entityCounts.shifts = parsed.shifts?.length || 0;
        entityCounts.cashMovements = parsed.cashMovements?.length || 0;
      }
      if (zip.file('stock.json')) {
        const str = await zip.file('stock.json')!.async('string');
        rawContents.push({ name: 'stock.json', content: str });
        const parsed = JSON.parse(str);
        restorableData.stock = parsed;
        entityCounts.stockOpnames = parsed.stockOpnames?.length || 0;
      }
      if (zip.file('audit_logs.json')) {
        const str = await zip.file('audit_logs.json')!.async('string');
        rawContents.push({ name: 'audit_logs.json', content: str });
        restorableData.auditLogs = JSON.parse(str);
        entityCounts.auditLogs = restorableData.auditLogs?.length || 0;
      }

      // 7.3: parse folder media/ — hanya untuk schemaVersion >= 2.0 (backup 1.0 memakai media biner)
      const isLegacy = manifest.schemaVersion === '1.0';
      if (!isLegacy) {
        const mediaZip = zip.folder('media');
        if (mediaZip) {
          const media: Record<string, string> = {};
          for (const [path, file] of Object.entries(mediaZip.files)) {
            if (file.dir || !path.startsWith('media/')) continue;
            const b64 = await file.async('string');
            media[path] = b64;
            rawContents.push({ name: path, content: b64 });
          }
          restorableData.media = media;
          entityCounts.media = Object.keys(media).length;
        }
      }

      // Re-verify checksum (7.1): legacy 1.0 → count-based; v2.0 → content-based
      const calculatedChecksum = isLegacy
        ? await calculateChecksum(
            buildLegacyChecksumPayload({
              settings: restorableData.settings || null,
              users: restorableData.users || [],
              menus: restorableData.menus || [],
              inventory: restorableData.inventory || [],
              transactions: restorableData.transactions || [],
              shifts: restorableData.cash?.shifts || [],
            })
          )
        : await calculateChecksum(buildChecksumPayload(rawContents));

      if (calculatedChecksum !== manifest.checksum) {
        return {
          valid: false,
          error: 'Checksum validation mismatch. File backup mungkin telah diubah atau rusak!',
          manifest,
        };
      }

      // TO DO 7.7: aplikasikan transformasi migrasi (bila ada) sebelum restore
      const migrate = MANIFEST_MIGRATIONS[manifest.schemaVersion] || ((d: RestorableBackupData) => d);
      const migratedData = migrate(restorableData);

      return {
        valid: true,
        manifest,
        data: migratedData,
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
    onProgress?: (stepName: string, percent: number) => void,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<{ success: boolean; error?: string }> {
    // T9 fix (AUDIT-OX): jejak tabel yang sudah di-wipe — scope luar try agar bisa
    // dirujuk catch (pesan kegagalan restore di tengah jalan).
    const wipedTables: string[] = [];
    try {
      // T9 fix (AUDIT-OX) — PRE-FLIGHT WAJIB sebelum menyentuh cloud (khususnya sebelum
      // wipe mode Replace): validasi struktur data backup. Kegagalan parse/struktur yang
      // lolos sampai titik wipe meninggalkan cloud kosong/campuran tanpa rollback.
      const structureError = assertRestorableStructure(data);
      if (structureError) {
        return { success: false, error: `Backup tidak valid: ${structureError}` };
      }

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
      // 7.2 (Replace): kosongkan tabel cloud di luar backup (anak dulu) sebelum insert — snapshot penuh
      if (mode === 'replace') {
        onProgress?.('Mode Replace: menghapus data cloud di luar backup...', 8);
        const scopeAll = REPLACE_SCOPE[data.manifest.backupType] || [];
        // K2 fix (AUDIT-OX): batasi wipe HANYA ke tabel yang benar-benar ada datanya di
        // file backup. Sebelumnya scope ditentukan backupType saja → restore FULL tanpa
        // audit_logs.json MENGHAPUS audit_logs cloud tanpa mengisi apa pun (destruksi
        // permanen). Backup lengkap → daftar wipe identik dengan perilaku lama; yang
        // berubah hanya kasus ZIP parsial/rusak (kini fail-safe, bukan fail-destructive).
        const presentInBackup: Record<string, boolean> = {
          transactions: data.transactions !== undefined,
          cash_movements: data.cash?.cashMovements !== undefined,
          stock_opnames: data.stock?.stockOpnames !== undefined,
          stock_logs: data.stock?.stockLogs !== undefined,
          shifts: data.cash?.shifts !== undefined,
          audit_logs: data.auditLogs !== undefined,
          customers: data.customers !== undefined,
          promos: data.promos !== undefined,
          menu_components: data.menuComponents !== undefined,
          menus: data.menus !== undefined,
          inventory: data.inventory !== undefined,
          users: data.users !== undefined,
        };
        const scope = scopeAll.filter((t) => presentInBackup[t] === true);
        await wipeCloudTables(scope, wipedTables);
      }

      onProgress?.('Memulihkan Pengaturan (Settings)...', 10);
      // 1. Settings
      if (data.settings) {
        // 7.3: resolve logo dari folder media backup bila tersimpan sebagai referensi
        const restoredSettings = data.settings.storeLogo
          ? { ...data.settings, storeLogo: resolveMediaUrl(data.settings.storeLogo, data.media) ?? data.settings.storeLogo }
          : data.settings;
        settingsStore.updateSettings(restoredSettings);
        if (isSupabaseConfigured) {
          await syncSettings(restoredSettings);
        }
      }

      onProgress?.('Memulihkan Pengguna & Akses (Users)...', 20);
      // 2. Users
      if (data.users && data.users.length > 0) {
        useAuthStore.setState({ users: data.users });
        // v4.7 TO DO 7.8: re-resolve currentUser dari daftar user hasil restore.
        const prevCurrent = useAuthStore.getState().currentUser;
        if (prevCurrent) {
          const restored = data.users.find((u) => u.id === prevCurrent.id);
          if (restored) {
            // Pertahankan session aktif lokal agar tidak ter-logout paksa lintas device
            useAuthStore.setState({
              currentUser: { ...restored, activeSessionId: prevCurrent.activeSessionId },
            });
          } else {
            // User yang login tidak ada di backup → logout agar sesi tidak "hantu"
            useAuthStore.getState().logout();
          }
        }
        // Backup lama bisa membawa password plaintext → paksa re-hash pada boot berikutnya
        useAuthStore.setState({ passwordsHashed: false });
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
        // 7.3: resolve foto menu dari folder media backup bila tersimpan sebagai referensi
        const restoredMenus = data.menus.map((m) => ({
          ...m,
          image: resolveMediaUrl(m.image, data.media) ?? m.image,
        }));
        useMenuStore.setState({ menus: restoredMenus });
        if (isSupabaseConfigured) {
          for (const m of restoredMenus) {
            await syncMenu(m);
          }
        }
      }
      // v4.7 TO DO 7.4: struktur bundle/add-on (menu_components) — setelah menus (referensi parent id)
      if (data.menuComponents && data.menuComponents.length > 0) {
        useMenuStore.setState({ menuComponents: data.menuComponents });
        if (isSupabaseConfigured) {
          for (const c of data.menuComponents) {
            await syncComponentToCloud(c);
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
          // v4.7 TO DO 7.5: Stock Logs ikut di-sync ke cloud (sebelumnya hanya lokal)
          if (isSupabaseConfigured) {
            for (const log of data.stock.stockLogs) {
              await syncStockLog(log);
            }
          }
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
          `Restore database dari backup: Type=${data.manifest.backupType}, Mode=${mode}, File Date=${data.manifest.createdAt}`
        );
      }

      onProgress?.('Restorasi Selesai!', 100);
      return { success: true };
    } catch (err: any) {
      console.error('[BackupService] Restore error:', err);
      // T9 fix (AUDIT-OX): bila restore gagal di tengah setelah wipe, laporkan tabel yang
      // sudah terkena agar user tahu cloud dalam kondisi campuran — restore ULANG (idempoten,
      // full upsert) membersihkannya.
      const wipedInfo = wipedTables.length > 0 ? ` Tabel yang sudah dikosongkan: ${wipedTables.join(', ')}. Jalankan restore ulang dengan file backup yang sama untuk melengkapi pemulihan.` : '';
      return { success: false, error: (err.message || 'Terjadi kesalahan tidak terduga saat memulihkan data.') + wipedInfo };
    }
  }
}
