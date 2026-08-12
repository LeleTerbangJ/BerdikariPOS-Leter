import { describe, it, expect, beforeEach } from 'vitest';
import JSZip from 'jszip';
import bcrypt from 'bcryptjs';
import {
  BackupService,
  calculateChecksum,
  resolveMediaUrl,
  CURRENT_APP_VERSION,
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
} from '../lib/backupService';
import { useMenuStore } from '../store/menuStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';

// ============================================================
// TO DO 7.1–7.3 — Backup & Restore: checksum berbasis isi,
// media (foto menu & logo) di-restore, mode Replace (7.2 UI).
// ============================================================

/** Replika buildChecksumPayload (urutan nama deterministik) — dipakai untuk membuat backup v2 valid di test. */
function checksumPayload(entries: { name: string; content: string }[]): string {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((e) => `${e.name}\u0000${e.content}`)
    .join('\u0001');
}

/** Replika buildLegacyChecksumPayload (count-based, schemaVersion 1.0). */
function legacyPayload(data: {
  settings: unknown;
  usersCount: number;
  menusCount: number;
  inventoryCount: number;
  txCount: number;
  shiftsCount: number;
}): string {
  return JSON.stringify(data);
}

async function makeZipFile(zip: JSZip): Promise<File> {
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'Backup_Test.zip', { type: 'application/zip' });
}

const SETTINGS_V2 = {
  storeName: 'Toko Uji',
  storeLogo: 'media/store-logo.png',
  managerPin: 'x',
};
const MEDIA_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('BackupService.validateBackup — checksum berbasis ISI (TO DO 7.1)', () => {
  it('backup v2.0 valid: checksum dihitung dari isi JSON + media; media ter-parse ke data.media (7.3)', async () => {
    const settingsStr = JSON.stringify(SETTINGS_V2, null, 2);
    const checksum = await calculateChecksum(
      checksumPayload([
        { name: 'media/store-logo.png', content: MEDIA_B64 },
        { name: 'settings.json', content: settingsStr },
      ])
    );

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        appVersion: '4.4.0',
        schemaVersion: '2.0',
        backupType: 'MASTER_DATA',
        createdAt: '2026-08-01T00:00:00.000Z',
        restaurantName: 'Toko Uji',
        totalTransactions: 0,
        checksum,
        mediaCount: 1,
      })
    );
    zip.file('settings.json', settingsStr);
    zip.file('media/store-logo.png', MEDIA_B64);

    const result = await BackupService.validateBackup(await makeZipFile(zip));

    expect(result.valid).toBe(true);
    expect(result.data?.media?.['media/store-logo.png']).toBe(MEDIA_B64);
    expect(result.entityCounts?.media).toBe(1);
    expect(result.data?.settings?.storeLogo).toBe('media/store-logo.png');
  });

  it('TAMPER: isi JSON diubah tanpa mengubah count → checksum mismatch → INVALID (akar bug 7.1)', async () => {
    const settingsStr = JSON.stringify(SETTINGS_V2, null, 2);
    const checksum = await calculateChecksum(checksumPayload([{ name: 'settings.json', content: settingsStr }]));

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        appVersion: '4.4.0',
        schemaVersion: '2.0',
        backupType: 'MASTER_DATA',
        createdAt: '2026-08-01T00:00:00.000Z',
        restaurantName: 'Toko Uji',
        totalTransactions: 0,
        checksum,
      })
    );
    // Isi diubah (harga/logo) — count entitas TIDAK berubah → dulu lolos, kini harus ditolak
    zip.file(
      'settings.json',
      JSON.stringify({ ...SETTINGS_V2, storeName: 'Toko Dihack' }, null, 2)
    );

    const result = await BackupService.validateBackup(await makeZipFile(zip));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Checksum validation mismatch/i);
  });

  it('TAMPER: file media diubah → checksum mismatch → INVALID', async () => {
    const settingsStr = JSON.stringify(SETTINGS_V2, null, 2);
    const checksum = await calculateChecksum(
      checksumPayload([
        { name: 'media/store-logo.png', content: MEDIA_B64 },
        { name: 'settings.json', content: settingsStr },
      ])
    );

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        appVersion: '4.4.0',
        schemaVersion: '2.0',
        backupType: 'MASTER_DATA',
        createdAt: '2026-08-01T00:00:00.000Z',
        restaurantName: 'Toko Uji',
        totalTransactions: 0,
        checksum,
      })
    );
    zip.file('settings.json', settingsStr);
    zip.file('media/store-logo.png', 'gantigambar');

    const result = await BackupService.validateBackup(await makeZipFile(zip));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Checksum validation mismatch/i);
  });

  it('backup LEGACY v1.0 (checksum count-based) tetap valid — tidak menolak backup lama', async () => {
    const settings = { storeName: 'Toko Lama', storeLogo: undefined };
    const users = [{ id: 'u1', name: 'Kasir' }];
    const menus = [{ id: 'm1', name: 'Nasi Goreng' }];
    const inventory = [{ id: 'i1', name: 'Beras' }];
    const transactions = [{ id: 't1', queueNumber: 1 }];
    const shifts = [{ id: 's1' }];

    const checksum = await calculateChecksum(
      legacyPayload({
        settings,
        usersCount: users.length,
        menusCount: menus.length,
        inventoryCount: inventory.length,
        txCount: transactions.length,
        shiftsCount: shifts.length,
      })
    );

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        appVersion: '4.0.0',
        schemaVersion: '1.0',
        backupType: 'FULL',
        createdAt: '2026-01-01T00:00:00.000Z',
        restaurantName: 'Toko Lama',
        totalTransactions: 1,
        checksum,
      })
    );
    zip.file('settings.json', JSON.stringify(settings));
    zip.file('users.json', JSON.stringify(users));
    zip.file('menus.json', JSON.stringify(menus));
    zip.file('inventory.json', JSON.stringify(inventory));
    zip.file('transactions.json', JSON.stringify(transactions));
    zip.file('cash.json', JSON.stringify({ shifts, cashMovements: [] }));

    const result = await BackupService.validateBackup(await makeZipFile(zip));

    expect(result.valid).toBe(true);
    expect(result.data?.users).toHaveLength(1);
    // Legacy 1.0: media biner TIDAK diparse (folder media diabaikan)
    expect(result.data?.media).toBeUndefined();
  });
});

describe('BackupService — struktur bundle menu_components (TO DO 7.4)', () => {
  it('createBackup MASTER_DATA menyertakan menu_components.json (state menuComponents ikut dibackup)', async () => {
    useMenuStore.setState({
      menus: [{ id: 'm1', name: 'Paket A', isBundle: true, price: 50000, category: 'Signature' } as any],
      menuComponents: [
        {
          id: 'c1',
          parentMenuId: 'm1',
          childType: 'menu',
          childId: 'm2',
          quantity: 1,
          mode: 'single',
          sortOrder: 0,
          createdAt: '2026-08-01T00:00:00.000Z',
        } as any,
      ],
    });

    const result = await BackupService.createBackup('MASTER_DATA', { includeAuditLogs: false });
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const raw = await zip.file('menu_components.json')!.async('string');
    const parsed = JSON.parse(raw);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].parentMenuId).toBe('m1');

    // Checksum berbasis isi ikut menghitung file ini → backup tetap valid end-to-end
    const file = new File([result.blob], result.filename);
    const validation = await BackupService.validateBackup(file);
    expect(validation.valid).toBe(true);
    expect(validation.data?.menuComponents).toHaveLength(1);
    expect(validation.entityCounts?.menuComponents).toBe(1);
  });

  it('validateBackup mem-parse menu_components.json dari ZIP v2 (restore struktur bundle)', async () => {
    const menuCompsStr = JSON.stringify([
      {
        id: 'c1',
        parentMenuId: 'm1',
        childType: 'menu',
        childId: 'm2',
        quantity: 2,
        mode: 'single',
      },
    ]);
    const settingsStr = JSON.stringify({ storeName: 'Toko Uji' });
    const checksum = await calculateChecksum(
      checksumPayload([
        { name: 'menu_components.json', content: menuCompsStr },
        { name: 'settings.json', content: settingsStr },
      ])
    );

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        appVersion: '4.7.0',
        schemaVersion: '2.0',
        backupType: 'MASTER_DATA',
        createdAt: '2026-08-01T00:00:00.000Z',
        restaurantName: 'Toko Uji',
        totalTransactions: 0,
        checksum,
      })
    );
    zip.file('settings.json', settingsStr);
    zip.file('menu_components.json', menuCompsStr);

    const result = await BackupService.validateBackup(await makeZipFile(zip));
    expect(result.valid).toBe(true);
    expect(result.data?.menuComponents).toHaveLength(1);
    expect(result.data?.menuComponents?.[0].quantity).toBe(2);
    expect(result.entityCounts?.menuComponents).toBe(1);
  });

  it('backup v2 tanpa menu_components.json → data.menuComponents undefined (opsional, tidak crash)', async () => {
    const settingsStr = JSON.stringify({ storeName: 'Toko Uji' });
    const checksum = await calculateChecksum(
      checksumPayload([{ name: 'settings.json', content: settingsStr }])
    );

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        appVersion: '4.7.0',
        schemaVersion: '2.0',
        backupType: 'FULL',
        createdAt: '2026-08-01T00:00:00.000Z',
        restaurantName: 'Toko Uji',
        totalTransactions: 0,
        checksum,
      })
    );
    zip.file('settings.json', settingsStr);

    const result = await BackupService.validateBackup(await makeZipFile(zip));
    expect(result.valid).toBe(true);
    expect(result.data?.menuComponents).toBeUndefined();
  });
});

describe('BackupService — manifest versioning (TO DO 7.7)', () => {
  it('CURRENT_APP_VERSION sinkron dengan versi fitur aktual (4.7.0); schema 2.0 + legacy 1.0 didukung', () => {
    expect(CURRENT_APP_VERSION).toBe('4.7.0');
    expect(CURRENT_SCHEMA_VERSION).toBe('2.0');
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain('1.0');
    expect(SUPPORTED_SCHEMA_VERSIONS).toContain('2.0');
  });

  it('validateBackup MENOLAK schemaVersion tak dikenal (3.0) dengan pesan jelas (bukan gagal diam-diam)', async () => {
    const settingsStr = JSON.stringify({ storeName: 'Toko Uji' });
    const checksum = await calculateChecksum(
      checksumPayload([{ name: 'settings.json', content: settingsStr }])
    );

    const zip = new JSZip();
    zip.file(
      'manifest.json',
      JSON.stringify({
        appVersion: '9.9.9',
        schemaVersion: '3.0',
        backupType: 'FULL',
        createdAt: '2026-08-01T00:00:00.000Z',
        restaurantName: 'X',
        totalTransactions: 0,
        checksum,
      })
    );
    zip.file('settings.json', settingsStr);

    const result = await BackupService.validateBackup(await makeZipFile(zip));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Schema version 3\.0 tidak didukung/i);
  });
});

describe('BackupService.restoreBackup — currentUser di-resolve ulang (TO DO 7.8)', () => {
  const manifest = {
    appVersion: '4.7.0',
    schemaVersion: '2.0',
    backupType: 'MASTER_DATA' as const,
    createdAt: '2026-08-01T00:00:00.000Z',
    restaurantName: 'Toko Uji',
    totalTransactions: 0,
    checksum: 'x',
  };

  beforeEach(() => {
    // PIN manager hashed (perilaku produksi) — plaintext default '1234' membuat bcrypt.compareSync throw
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, managerPin: bcrypt.hashSync('1234', 8) },
    });
    useAuthStore.setState({
      users: [
        { id: 'u1', name: 'Kasir 1', username: 'kasir1', password: 'hash', role: 'Kasir' } as any,
      ],
      currentUser: {
        id: 'u1',
        name: 'Kasir 1',
        username: 'kasir1',
        password: 'hash',
        role: 'Kasir',
        activeSessionId: 'sess-abc',
      } as any,
    });
  });

  it('user yang login ADA di backup → currentUser re-resolve dengan data baru + session dipertahankan', async () => {
    const result = await BackupService.restoreBackup(
      {
        manifest,
        users: [
          { id: 'u1', name: 'Kasir Baru', username: 'kasir1', password: 'hash', role: 'Kasir' } as any,
        ],
      },
      '1234'
    );

    expect(result.success).toBe(true);
    const cu = useAuthStore.getState().currentUser;
    expect(cu?.id).toBe('u1');
    expect(cu?.name).toBe('Kasir Baru'); // data baru dari backup
    expect(cu?.activeSessionId).toBe('sess-abc'); // session lokal tidak hilang
  });

  it('user yang login TIDAK ada di backup → logout (currentUser null, tidak ada sesi "hantu")', async () => {
    const result = await BackupService.restoreBackup(
      {
        manifest,
        users: [
          { id: 'u9', name: 'Orang Lain', username: 'lain', password: 'hash', role: 'Manager' } as any,
        ],
      },
      '1234'
    );

    expect(result.success).toBe(true);
    expect(useAuthStore.getState().currentUser).toBeNull();
  });
});

describe('resolveMediaUrl (TO DO 7.3 — restore foto menu & logo)', () => {
  const media = { 'media/menu-abc.png': 'QUJD', 'media/store-logo.png': 'TE9HTw==' };

  it('referensi media/... di-resolve ke data URL base64', () => {
    expect(resolveMediaUrl('media/menu-abc.png', media)).toBe('data:image/png;base64,QUJD');
  });

  it('nilai yang bukan referensi media dikembalikan apa adanya', () => {
    expect(resolveMediaUrl('data:image/png;base64,XXXX', media)).toBe('data:image/png;base64,XXXX');
    expect(resolveMediaUrl(undefined, media)).toBeUndefined();
  });

  it('referensi media tanpa folder media (backup tanpa gambar) → tetap referensi (tidak crash)', () => {
    expect(resolveMediaUrl('media/menu-abc.png', undefined)).toBe('media/menu-abc.png');
    expect(resolveMediaUrl('media/menu-abc.png', {})).toBe('media/menu-abc.png');
  });
});
