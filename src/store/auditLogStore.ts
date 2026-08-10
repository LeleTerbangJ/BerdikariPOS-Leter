import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { idbStorage } from '../utils/idbStorage';
import { capEntries, DEFAULT_AUDIT_LOG_CAP } from '../utils/storagePrune';
import { v4 as uuid } from 'uuid';
import type { AuditLogEntry, AuditAction, Role } from '../types';
import { syncAuditLog, fetchAuditLogsFromCloud } from '../lib/cloudSync';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

interface AuditLogState {
  logs: AuditLogEntry[];
  addLog: (userId: string, userName: string, userRole: Role, action: AuditAction, detail: string, metadata?: Record<string, any>) => void;
  getLogsByUser: (userId: string) => AuditLogEntry[];
  getLogsByAction: (action: AuditAction) => AuditLogEntry[];
  getLogsByDateRange: (from: Date, to: Date) => AuditLogEntry[];
  clearOldLogs: (daysToKeep?: number) => void;
  clearAllLogs: () => Promise<boolean>;
  loadFromCloud: () => Promise<void>;
}

export const useAuditLogStore = create<AuditLogState>()(
  persist(
    (set, get) => ({
      logs: [],

      addLog: (userId, userName, userRole, action, detail, metadata) => {
        const entry: AuditLogEntry = {
          id: uuid(),
          userId,
          userName,
          userRole,
          action,
          detail,
          timestamp: new Date().toISOString(),
          metadata,
        };
        set((s) => ({ logs: capEntries([entry, ...s.logs], DEFAULT_AUDIT_LOG_CAP) })); // v4.5 TO DO 6.1: cap lokal dikurangi agar payload localStorage tidak membengkak
        syncAuditLog(entry);
      },

      getLogsByUser: (userId) =>
        get().logs.filter((l) => l.userId === userId),

      getLogsByAction: (action) =>
        get().logs.filter((l) => l.action === action),

      getLogsByDateRange: (from, to) =>
        get().logs.filter((l) => {
          const d = new Date(l.timestamp);
          return d >= from && d <= to;
        }),

      clearOldLogs: (daysToKeep = 90) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysToKeep);
        set((s) => ({ logs: s.logs.filter((l) => new Date(l.timestamp) >= cutoff) }));
      },

      clearAllLogs: async () => {
        set({ logs: [] });
        if (isSupabaseConfigured) {
          try {
            const { error } = await supabase.from('audit_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
            if (error) {
              console.error('Error clearing audit logs in cloud:', error.message);
              return false;
            }
            return true;
          } catch (err) {
            console.error('Failed to clear audit logs in cloud:', err);
            return false;
          }
        }
        return true;
      },

      // BUG-C4 fix: Load audit logs from cloud for multi-device visibility
      loadFromCloud: async () => {
        const cloudLogs = await fetchAuditLogsFromCloud();
        if (cloudLogs && cloudLogs.length > 0) {
          set((s) => {
            const cloudIds = new Set(cloudLogs.map((l) => l.id));
            const localOnly = s.logs.filter((l) => !cloudIds.has(l.id));
            const merged = [...cloudLogs, ...localOnly];
            merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            return { logs: capEntries(merged, DEFAULT_AUDIT_LOG_CAP) };
          });
        }
      },
    }),
    { name: 'rempah-audit-logs', storage: createJSONStorage(() => idbStorage) } // v4.5 TO DO 6.1 (permanen): IndexedDB — kuota jauh lebih besar
  )
);
