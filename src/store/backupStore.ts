import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuid } from 'uuid';

export type BackupType = 'FULL' | 'MASTER_DATA' | 'TRANSACTION';

export interface BackupHistoryEntry {
  id: string;
  date: string; // ISO String
  type: BackupType;
  filename: string;
  status: 'Success' | 'Failed';
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
  addHistoryEntry: (entry: Omit<BackupHistoryEntry, 'id'>) => void;
  clearHistory: () => void;
  updateAutoBackupConfig: (config: Partial<AutoBackupConfig>) => void;
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
    }),
    {
      name: 'berdikari_backup_store',
    }
  )
);
