import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import { v4 as uuid } from 'uuid';

export type BackupType = 'FULL' | 'MASTER_DATA' | 'TRANSACTION';

export interface BackupHistoryEntry {
  id: string;
  date: string; // ISO String
  type: BackupType;
  filename: string;
  // S4 fix (AUDIT-OX): status diperluas — riwayat mencerminkan hasil faktual per tahap
  status: 'Success' | 'Failed' | 'Uploaded' | 'Upload Failed' | 'Created — Check Download';
  size: string; // formatted size e.g. "1.2 MB"
  sizeBytes: number;
  totalTransactions?: number;
  checksum?: string;
  error?: string;
}

export interface AutoBackupConfig {
  frequency: 'OFF' | 'Daily' | 'Weekly';
  destination: 'Local Download' | 'Supabase Storage' | 'Google Drive';
  targetTime?: string; // e.g. "23:00"
  includeAuditLogs: boolean;
}

interface BackupState {
  history: BackupHistoryEntry[];
  autoBackupConfig: AutoBackupConfig;
  // v4.7 TO DO 7.6: penanda kapan auto backup terakhir SUKSES (persist) — scheduler
  // menggunakannya agar tidak mengeksekusi ulang dalam periode yang sama (Daily/Weekly).
  lastAutoBackupAt?: string;
  addHistoryEntry: (entry: Omit<BackupHistoryEntry, 'id'>) => string;
  // S4 fix (AUDIT-OX): perbarui status entri riwayat setelah hasil sebenarnya diketahui
  // (mis. upload cloud berhasil/gagal) — riwayat tidak lagi mengklaim "Success" prematur.
  updateBackupHistoryEntry: (id: string, patch: Partial<Pick<BackupHistoryEntry, 'status' | 'size'>>) => void;
  clearHistory: () => void;
  updateAutoBackupConfig: (config: Partial<AutoBackupConfig>) => void;
  setLastAutoBackupAt: (date: string) => void;
}

export const useBackupStore = create<BackupState>()(
  persist(
    (set) => ({
      history: [],
      autoBackupConfig: {
        frequency: 'OFF',
        destination: 'Local Download',
        targetTime: '23:00',
        includeAuditLogs: true,
      },

      addHistoryEntry: (entry) => {
        const newEntry: BackupHistoryEntry = {
          ...entry,
          id: uuid(),
        };
        set((s) => ({ history: [newEntry, ...s.history].slice(0, 100) })); // keep last 100 entries
        return newEntry.id;
      },

      updateBackupHistoryEntry: (id, patch) => {
        set((s) => ({
          history: s.history.map((h) => (h.id === id ? { ...h, ...patch } : h)),
        }));
      },

      clearHistory: () => {
        set({ history: [] });
      },

      updateAutoBackupConfig: (config) => {
        set((s) => ({
          autoBackupConfig: {
            ...s.autoBackupConfig,
            ...config,
          },
        }));
      },

      setLastAutoBackupAt: (date) => {
        set({ lastAutoBackupAt: date });
      },
    }),
    {
      name: 'berdikari_backup_store',
      storage: createJSONStorage(() => safeStorage),
    }
  )
);
