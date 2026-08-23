/**
 * Auto Backup Scheduler — v4.7 (TO DO 7.6)
 *
 * Menjadwalkan backup otomatis berdasarkan `autoBackupConfig` (backupStore):
 * - `frequency`: OFF | Daily | Weekly
 * - `targetTime`: jam eksekusi (HH:mm, default 23:00)
 * - `destination`: 'Local Download' | 'Supabase Storage'
 *
 * Logika murni dipisah ke `isAutoBackupDue` agar bisa diuji tanpa timer/UI.
 */

import { BackupService, downloadBlob, formatBytes, uploadBackupToSupabase } from './backupService';
import { useBackupStore, type AutoBackupConfig } from '../store/backupStore';
import { useToastStore } from '../store/toastStore';
import { isSupabaseConfigured } from './supabase';

/** Cek kapan scheduler mengevaluasi jadwal (tiap 1 menit cukup presisi untuk jam eksekusi). */
export const CHECK_INTERVAL_MS = 60_000;
/** Setelah satu percobaan GAGAL, tunda percobaan berikutnya (hindari spam tiap menit). */
export const RETRY_DELAY_MS = 5 * 60_000;

const DEFAULT_TARGET_TIME = '23:00';

let schedulerId: ReturnType<typeof setInterval> | null = null;
let lastFailedAttemptAt: number | null = null;

/**
 * Apakah auto backup sudah waktunya dijalankan?
 * - frequency OFF → tidak pernah.
 * - Belum mencapai targetTime hari ini → tidak.
 * - Daily → sudah jalan HARI INI? tidak perlu. (berbeda hari → due)
 * - Weekly → sudah jalan MINGGU INI? tidak perlu. (beda minggu → due)
 */
export function isAutoBackupDue(
  config: Pick<AutoBackupConfig, 'frequency' | 'targetTime'>,
  lastRunAt: string | undefined,
  now: Date = new Date()
): boolean {
  if (config.frequency === 'OFF') return false;

  const [h, m] = (config.targetTime || DEFAULT_TARGET_TIME).split(':').map(Number);
  const target = new Date(now);
  target.setHours(Number.isFinite(h) ? h : 23, Number.isFinite(m) ? m : 0, 0, 0);
  if (now < target) return false;

  if (!lastRunAt) return true;
  const last = new Date(lastRunAt);
  if (Number.isNaN(last.getTime())) return true;

  if (config.frequency === 'Daily') {
    // Berbeda tanggal → sudah lewat satu hari → due
    return last.toDateString() !== now.toDateString();
  }

  // Weekly: due bila minggu kalender terakhir berbeda
  return !sameCalendarWeek(last, now);
}

/** Minggu (calendar) yang sama = sama-sama berada dalam rentang Minggu–Sabtu yang sama. */
function sameCalendarWeek(a: Date, b: Date): boolean {
  const startOfWeek = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - x.getDay()); // getDay(): 0 = Minggu
    return x.getTime();
  };
  return startOfWeek(a) === startOfWeek(b);
}

function triggerLocalDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  downloadBlob(blob, filename);
}

/**
 * Jalankan backup SEKARANG sesuai konfigurasi (juga dipakai tombol "Backup Sekarang" bila ada).
 * Mencatat `lastAutoBackupAt` HANYA saat sukses — gagal → scheduler akan mencoba lagi.
 */
export async function runAutoBackupNow(): Promise<{ ok: boolean; error?: string }> {
  const config = useBackupStore.getState().autoBackupConfig;
  try {
    const result = await BackupService.createBackup('FULL', {
      includeAuditLogs: config.includeAuditLogs !== false,
    });

    if (config.destination === 'Supabase Storage') {
      const up = await uploadBackupToSupabase(result.blob, result.filename);
      if (!up.ok) {
        // S4 fix (AUDIT-OX): riwayat diperbarui — jangan biarkan tercatat "Success" palsu.
        if (result.historyId) {
          useBackupStore.getState().updateBackupHistoryEntry(result.historyId, { status: 'Upload Failed' });
        }
        useToastStore.getState().addToast(
          `Auto Backup gagal diunggah ke cloud: ${up.error}`,
          'error'
        );
        return { ok: false, error: up.error };
      }
      // S4 fix: status akhir faktual setelah upload diketahui.
      if (result.historyId) {
        useBackupStore.getState().updateBackupHistoryEntry(result.historyId, { status: 'Uploaded' });
      }
      useToastStore.getState().addToast(
        `Auto Backup (${formatBytes(result.sizeBytes)}) terunggah ke cloud ✔`,
        'success'
      );
    } else {
      // S5 fix (AUDIT-OX): unduhan programmatic tanpa user gesture sering DIBLOKIR
      // browser — jangan klaim "diunduh otomatis ✔". Gunakan bahasa netral + arahan.
      triggerLocalDownload(result.blob, result.filename);
      if (result.historyId) {
        useBackupStore.getState().updateBackupHistoryEntry(result.historyId, { status: 'Created — Check Download' });
      }
      useToastStore.getState().addToast(
        'Backup otomatis dibuat — jika file tidak terunduh, ekspor manual dari Settings → Backup.',
        'info'
      );
    }

    useBackupStore.getState().setLastAutoBackupAt(new Date().toISOString());
    return { ok: true };
  } catch (e: any) {
    console.warn('[AutoBackup] Gagal membuat backup otomatis:', e);
    useToastStore.getState().addToast(
      `Auto Backup gagal: ${e?.message || 'Error tidak dikenal'}`,
      'error'
    );
    return { ok: false, error: e?.message || 'Error tidak dikenal' };
  }
}

/** Evaluasi satu kali: cek jadwal + guard (online untuk destinasi cloud) lalu jalankan. */
function tick(): void {
  const state = useBackupStore.getState();
  const config = state.autoBackupConfig;

  if (!isAutoBackupDue(config, state.lastAutoBackupAt)) return;

  if (config.destination === 'Supabase Storage') {
    if (!isSupabaseConfigured) {
      console.warn('[AutoBackup] Destinasi Supabase Storage dipilih tapi Supabase belum dikonfigurasi.');
      return;
    }
    // Offline → tunggu sampai online (interval tetap berjalan, tidak ada spam).
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    // Gagal baru-baru ini → tunda agar tidak mencoba tiap 1 menit.
    if (lastFailedAttemptAt !== null && Date.now() - lastFailedAttemptAt < RETRY_DELAY_MS) return;
  }

  runAutoBackupNow().then((r) => {
    lastFailedAttemptAt = r.ok ? null : Date.now();
  });
}

/** Mulai scheduler (idempoten). Panggil sekali saat boot aplikasi. */
export function startAutoBackupScheduler(): void {
  if (schedulerId !== null) return;
  // Evaluasi sekali segera (berguna jika app dibuka setelah jam target).
  tick();
  schedulerId = setInterval(tick, CHECK_INTERVAL_MS);
}

/** Hentikan scheduler (cleanup). */
export function stopAutoBackupScheduler(): void {
  if (schedulerId !== null) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
}
