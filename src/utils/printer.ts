/**
 * Thermal Printer Utility — v4.0 (Printer Device Registry)
 * 
 * Supports two modes:
 * 1. Browser Print — opens a styled print window optimized for thermal paper
 * 2. Bluetooth ESC/POS — connects to thermal printer via Web Bluetooth API
 * 
 * v4.0: Each logical printer (cashier, kitchen-food, kitchen-drink) has its own
 * independent Bluetooth device binding via a Printer Device Registry.
 */

import type { AppSettings, Transaction, CartItem, KitchenPrinterConfig } from '../types';
import { formatRupiah } from './format';
import { buildEqualSplitReceipt } from './splitAllocation';
import { useToastStore } from '../store/toastStore';

// ============================================================
// UNIFIED PRINT FALLBACK (TO DO 14.2) — satu kebijakan untuk semua
// jalur cetak Bluetooth: (1) re-pair senyap via getDevices(), (2) kalau
// gagal → fallback browser print + toast peringatan jelas. Tidak pernah
// membuka device picker tanpa klik eksplisit user (P-3).
// ============================================================

function notifyPrinterFallback(printerName: string) {
  try {
    useToastStore
      .getState()
      .addToast(
        `Printer "${printerName}" terputus — struk dicetak lewat dialog browser. Klik banner printer untuk menyambungkan kembali.`,
        'warning',
        5000
      );
  } catch {
    // toast store belum siap (mis. saat boot) — abaikan
  }
}

// ============================================================
// RECEIPT DATA TYPES
// ============================================================

export interface ReceiptData {
  storeName: string;
  storeAddress?: string;
  storeLogo?: string;
  queueNumber: number;
  date: string;
  cashierName: string;
  customerName?: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax?: number;
  total: number;
  paymentMethod: string;
  cashReceived?: number;
  change?: number;
  orderType?: 'Dine In' | 'Take Away';
  tableNumber?: string;
  receiptHeader?: string;
  receiptFooter?: string;
  isReprint?: boolean;
  showLogoOnReceipt?: boolean;
  // v4.7 TO DO 12.2.7 (P-A7): nama promo/voucher di struk — hanya diisi bila promo
  // benar-benar memberi diskon (promoAmount > 0; promo eksklusif yang kalah best-deal tidak tampil).
  promoName?: string;
  promoCode?: string;
  promoAmount?: number;
  // v4.8 TO DO 23.3: tanda tiket TAMBAHAN (delta items saat update pending) — header '=== TAMBAHAN ==='
  // ditampilkan di tiket dapur agar dapur tahu ini pesanan tambahan dari nomor antrean yang sudah ada.
  isAdditionalPrint?: boolean;

  // 🏷️ v4.9: Order Batch
  batchNumber?: number; // 1 = Pesanan Awal, 2+ = Tambahan
  batchLabel?: string;  // misal: 'PESANAN AWAL', 'TAMBAHAN #1'
}

export function buildReceiptFromTransaction(tx: Transaction, settings: AppSettings, isReprint: boolean = false): ReceiptData {
  return {
    storeName: settings.storeName,
    storeAddress: settings.address,
    storeLogo: settings.storeLogo,
    queueNumber: tx.queueNumber,
    date: tx.date,
    cashierName: tx.cashierName,
    customerName: tx.customerName,
    items: tx.items,
    subtotal: tx.subtotal,
    discount: tx.discount,
    tax: tx.tax,
    total: tx.totalAmount,
    paymentMethod: tx.paymentMethod,
    cashReceived: tx.cashReceived,
    change: tx.change,
    orderType: tx.orderType,
    tableNumber: tx.tableNumber,
    receiptHeader: settings.receiptHeader,
    receiptFooter: settings.receiptFooter,
    isReprint,
    batchNumber: tx.currentBatch,
    showLogoOnReceipt: settings.showLogoOnReceipt !== false,
    // v4.7 TO DO 12.2.7 (P-A7): tampilkan promo hanya bila memberi diskon (P-A3 snapshot promoAmount)
    promoName: tx.promoAmount ? tx.promoName : undefined,
    promoCode: tx.promoAmount ? tx.voucherCode : undefined,
    promoAmount: tx.promoAmount,
  };
}

// ============================================================
// PRINTER DEVICE REGISTRY (Multiple Bluetooth Connections)
// ============================================================

interface BluetoothConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
  deviceName: string;
  deviceId: string;
}

export interface PrinterStatus {
  printerId: string;
  connected: boolean;
  deviceName?: string;
  deviceId?: string;
}

export interface PrintJobResult {
  printer: string;
  status: 'success' | 'error';
  error?: string;
}

/**
 * Registry: Maps a logical printer ID to its Bluetooth connection.
 * - '__cashier__' → Cashier receipt printer
 * - '<kitchen-printer-uuid>' → Kitchen/bar printer
 */
const printerRegistry = new Map<string, BluetoothConnection>();
// S17 fix (AUDIT-OX): registry handler disconnect per printerId — re-pair pada device
// Bluetooth yang sama tidak lagi menumpuk listener `gattserverdisconnected`.
const disconnectedHandlers = new Map<string, () => void>();
export const CASHIER_PRINTER_ID = '__cashier__';

// ============================================================
// CROSS-TAB STATUS (TO DO 14.4) — BroadcastChannel agar status koneksi
// terlihat di semua tab (POS, Settings, Kitchen/Dapur). Registry tetap
// in-memory per tab (Web Bluetooth), tapi peristiwa connect/disconnect
// dibagikan ke tab lain sebagai sinyal UI.
// ============================================================

export type PrinterEvent =
  | { type: 'connected'; printerId: string; deviceName?: string }
  | { type: 'disconnected'; printerId: string };

// S17 fix (AUDIT-OX): SATU channel bersama + ref-count listener.
// Sebelumnya: broadcastPrinterEvent membuat channel BARU tiap panggilan tanpa close
// (kebocoran akumulatif), dan cleanup subscribe menutup channel milik subscriber lain.
let sharedChannel: BroadcastChannel | null = null;
let sharedChannelRefs = 0;

function getPrinterChannel(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === 'undefined') return null;
    if (!sharedChannel) sharedChannel = new BroadcastChannel('rempah-printer-events');
    return sharedChannel;
  } catch {
    return null;
  }
}

function broadcastPrinterEvent(event: PrinterEvent) {
  const ch = getPrinterChannel();
  if (!ch) return;
  try {
    ch.postMessage(event);
  } catch {
    // abaikan — hanya sinyal UI
  }
}

/**
 * Ekspor helper untuk tab lain (mis. halaman Kitchen): daftarkan listener
 * peristiwa printer dari tab lain. Return cleanup.
 */
export function subscribePrinterEvents(listener: (event: PrinterEvent) => void): () => void {
  const ch = getPrinterChannel();
  if (!ch) return () => {};
  sharedChannelRefs++;
  const handler = (e: MessageEvent) => {
    try {
      listener(e.data as PrinterEvent);
    } catch {
      // abaikan pesan tidak dikenal
    }
  };
  ch.addEventListener('message', handler);
  return () => {
    ch.removeEventListener('message', handler);
    sharedChannelRefs--;
    // Tutup channel hanya saat subscriber TERAKHIR pergi (bukan milik orang lain)
    if (sharedChannelRefs <= 0 && sharedChannel) {
      try {
        sharedChannel.close();
      } catch {
        // abaikan
      }
      sharedChannel = null;
      sharedChannelRefs = 0;
    }
  };
}

// ============================================================
// SESSION-STATE (P-2: TO DO 14.1) — tahu printer mana yang tadinya tersambung
// agar banner reconnect tampil agresif setelah page refresh (Web Bluetooth tidak
// bisa auto-reconnect tanpa user gesture; state ini memungkinkan UI memandu 1-klik).
// ============================================================

const SESSION_KEY = 'rempah-printer-session';

interface PrinterSessionState {
  [printerId: string]: { deviceId?: string; deviceName?: string; connectedAt: number };
}

function readSessionState(): PrinterSessionState {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as PrinterSessionState) : {};
  } catch {
    return {};
  }
}

function writeSessionState(state: PrinterSessionState) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage penuh/diblokir — abaikan (hanya sinyal UX)
  }
}

/**
 * Tandai printer sebagai "tadinya tersambung di sesi ini" (dipanggil setelah connect).
 */
export function markPrinterSession(printerId: string, deviceId?: string, deviceName?: string) {
  const state = readSessionState();
  state[printerId] = { deviceId, deviceName, connectedAt: Date.now() };
  writeSessionState(state);
}

/**
 * Hapus tanda sesi (dipanggil saat user memutus printer secara manual).
 */
export function clearPrinterSession(printerId: string) {
  const state = readSessionState();
  delete state[printerId];
  writeSessionState(state);
}

/**
 * Daftar printer yang tersambung SEBELUM refresh terakhir (untuk banner reconnect pasca-refresh).
 */
export function getPrinterSessionState(): PrinterSessionState {
  return readSessionState();
}

// ============================================================
// DEVICE IDENTITY — SATU SUMBER KEBENARAN (TO DO 14.6)
// ============================================================
// Settings (`bluetoothDeviceId` persisten) adalah sumber kanonik device identity;
// sessionStorage hanya penanda "pernah tersambung di sesi ini" (fallback bila settings
// belum tersimpan, mis. koneksi dibuat di tab lain). Semua jalur re-pair
// (usePrinterMonitor, usePrinterCrossTab, print paths) memakai helper ini agar
// tidak ada dua sumber device id yang bisa berbeda hasil.

export function getPrinterDeviceId(printerId: string, settings?: AppSettings): string | undefined {
  if (!settings) return getPrinterSessionState()[printerId]?.deviceId;
  if (printerId === CASHIER_PRINTER_ID) {
    return settings.cashierBluetoothDeviceId || getPrinterSessionState()[printerId]?.deviceId;
  }
  const kp = (settings.kitchenPrinters || []).find((k) => k.id === printerId);
  return kp?.bluetoothDeviceId || getPrinterSessionState()[printerId]?.deviceId;
}

export function getPrinterDeviceName(printerId: string, settings?: AppSettings): string | undefined {
  if (!settings) return getPrinterSessionState()[printerId]?.deviceName;
  if (printerId === CASHIER_PRINTER_ID) {
    return settings.cashierBluetoothDeviceName || getPrinterSessionState()[printerId]?.deviceName;
  }
  const kp = (settings.kitchenPrinters || []).find((k) => k.id === printerId);
  return kp?.bluetoothDeviceName || getPrinterSessionState()[printerId]?.deviceName;
}

// ============================================================
// BLUETOOTH CONNECTION MANAGEMENT
// ============================================================

/**
 * Connect a Bluetooth printer and register it under a specific printer ID.
 * Each call opens the browser's Bluetooth device picker independently.
 */
export async function connectBluetoothPrinter(
  printerId: string = CASHIER_PRINTER_ID
): Promise<{ success: boolean; deviceId?: string; deviceName?: string }> {
  try {
    if (!navigator.bluetooth) {
      // TO DO 14.6: alert() → toast (konsisten dengan jalur print lain)
      useToastStore.getState().addToast('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome atau Edge.', 'warning', 5000);
      return { success: false };
    }

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { services: ['000018f0-0000-1000-8000-00805f9b34fb'] },
      ],
      optionalServices: [
        '000018f0-0000-1000-8000-00805f9b34fb',
        '0000ff00-0000-1000-8000-00805f9b34fb',
        'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
      ],
    });

    if (!device) return { success: false };

    const ok = await establishConnection(printerId, device);
    if (!ok) {
      useToastStore.getState().addToast('Printer ditemukan tapi tidak bisa menulis. Pastikan printer thermal Bluetooth kompatibel.', 'error', 5000);
      return { success: false };
    }
    return { success: true, deviceId: device.id, deviceName: device.name || 'Unknown Printer' };
  } catch (err: any) {
    if (err.name !== 'NotFoundError') {
      console.error('Bluetooth error:', err);
      useToastStore.getState().addToast(`Gagal connect: ${err.message}`, 'error', 5000);
    }
    return { success: false };
  }
}

/**
 * Silent re-pair (TO DO 14.1 P-1): hubungkan ulang printer yang sudah pernah dipairing
 * TANPA membuka device picker. Memakai `navigator.bluetooth.getDevices()` (daftar device
 * yang pernah dipairing) dan mencocokkan `device.id` dengan `bluetoothDeviceId` tersimpan
 * di settings, lalu `gatt.connect()` + discovery service/characteristic.
 *
 * Catatan: `getDevices()` hanya berisi device yang dipairing dengan izin "remember device";
 * butuh user activation (klik) minimal sekali di sesi. Gagal → return false (UI fallback picker).
 */
export async function reconnectBluetoothPrinter(
  printerId: string,
  expectedDeviceId?: string
): Promise<{ success: boolean; deviceId?: string; deviceName?: string }> {
  try {
    if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
      return { success: false };
    }
    if (!expectedDeviceId) return { success: false };

    const devices = await navigator.bluetooth.getDevices();
    const device = devices.find((d) => d.id === expectedDeviceId);
    if (!device) {
      console.log(`[PrinterRegistry] Silent re-pair: device ${expectedDeviceId} tidak ada di daftar getDevices() — butuh picker.`);
      return { success: false };
    }

    const ok = await establishConnection(printerId, device);
    if (!ok) return { success: false };
    console.log(`[PrinterRegistry] ${printerId} silent re-paired (${device.name})`);
    return { success: true, deviceId: device.id, deviceName: device.name || 'Unknown Printer' };
  } catch (err: any) {
    // NotFoundError = user menutup picker dulu; SecurityError = butuh user gesture — keduanya normal
    console.log(`[PrinterRegistry] Silent re-pair gagal untuk ${printerId}:`, err?.name || err);
    return { success: false };
  }
}

/**
 * Internal: konek GATT + temukan service/characteristic tulis, lalu daftarkan di registry.
 * Dipakai bersama oleh connectBluetoothPrinter (picker) & reconnectBluetoothPrinter (senyap).
 */
async function establishConnection(printerId: string, device: BluetoothDevice): Promise<boolean> {
  const gatt = device.gatt;
  if (!gatt) return false;
  const server = await gatt.connect();

  // Try common thermal printer services
  const serviceUUIDs = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  ];

  for (const uuid of serviceUUIDs) {
    try {
      const service = await server.getPrimaryService(uuid);
      const characteristics = await service.getCharacteristics();
      for (const char of characteristics) {
        if (char.properties.write || char.properties.writeWithoutResponse) {
          // Register connection under this printerId
          printerRegistry.set(printerId, {
            device,
            characteristic: char,
            deviceName: device.name || 'Unknown Printer',
            deviceId: device.id,
          });

          // Listen for disconnection — S17 fix: hapus handler lama sebelum pasang (anti tumpuk)
          const prevHandler = disconnectedHandlers.get(printerId);
          if (prevHandler) {
            device.removeEventListener('gattserverdisconnected', prevHandler);
          }
          const disconnectedHandler = () => {
            printerRegistry.delete(printerId);
            console.log(`[PrinterRegistry] ${printerId} disconnected (${device.name})`);
            // TO DO 14.4: beri tahu tab lain (mis. halaman Kitchen) bahwa printer terputus
            broadcastPrinterEvent({ type: 'disconnected', printerId });
          };
          device.addEventListener('gattserverdisconnected', disconnectedHandler);
          disconnectedHandlers.set(printerId, disconnectedHandler);

          // P-2: tandai sesi agar banner pasca-refresh tahu printer ini pernah tersambung
          markPrinterSession(printerId, device.id, device.name || 'Unknown Printer');
          // TO DO 14.4: beri tahu tab lain (mis. halaman Kitchen) bahwa printer tersambung
          broadcastPrinterEvent({ type: 'connected', printerId, deviceName: device.name || 'Unknown Printer' });

          return true;
        }
      }
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * Check if a specific printer is connected.
 */
export function isBluetoothConnected(printerId: string = CASHIER_PRINTER_ID): boolean {
  const conn = printerRegistry.get(printerId);
  return !!(conn?.device?.gatt?.connected && conn?.characteristic);
}

/**
 * Get the status of a specific printer.
 */
export function getBluetoothStatus(printerId: string = CASHIER_PRINTER_ID): PrinterStatus {
  const conn = printerRegistry.get(printerId);
  const connected = !!(conn?.device?.gatt?.connected && conn?.characteristic);
  return {
    printerId,
    connected,
    deviceName: connected ? conn?.deviceName : undefined,
    deviceId: connected ? conn?.deviceId : undefined,
  };
}

/**
 * Disconnect a specific printer from the registry.
 */
export async function disconnectBluetoothPrinter(printerId: string = CASHIER_PRINTER_ID) {
  const conn = printerRegistry.get(printerId);
  if (conn?.device?.gatt?.connected) {
    conn.device.gatt.disconnect();
  }
  printerRegistry.delete(printerId);
  clearPrinterSession(printerId);
}

/**
 * Check if a Bluetooth device is already used by another printer in the registry.
 * Returns the printer ID and name that's using the device, or null.
 */
export function getDuplicateDeviceInfo(
  deviceId: string,
  excludePrinterId: string,
  settings: AppSettings
): { printerId: string; printerName: string } | null {
  for (const [regId, conn] of printerRegistry.entries()) {
    if (regId !== excludePrinterId && conn.deviceId === deviceId) {
      // Find human-readable name
      let printerName = 'Printer Kasir';
      if (regId !== CASHIER_PRINTER_ID) {
        const kp = (settings.kitchenPrinters || []).find(p => p.id === regId);
        printerName = kp?.name || regId;
      }
      return { printerId: regId, printerName };
    }
  }
  return null;
}

/**
 * Get statuses for all registered printers (for UI display).
 */
export function getAllPrinterStatuses(): PrinterStatus[] {
  const statuses: PrinterStatus[] = [];
  for (const [id, conn] of printerRegistry.entries()) {
    const connected = !!(conn.device?.gatt?.connected && conn.characteristic);
    statuses.push({
      printerId: id,
      connected,
      deviceName: conn.deviceName,
      deviceId: conn.deviceId,
    });
  }
  return statuses;
}

// ============================================================
// INTERNAL: Send ESC/POS byte data to a specific printer
// ============================================================

async function writeToPrinter(printerId: string, data: Uint8Array): Promise<void> {
  const conn = printerRegistry.get(printerId);
  if (!conn || !conn.characteristic) {
    throw new Error(`Printer "${printerId}" tidak terhubung.`);
  }

  // Verify GATT is still connected
  if (!conn.device.gatt?.connected) {
    printerRegistry.delete(printerId);
    throw new Error(`Koneksi Bluetooth ke printer "${conn.deviceName}" terputus.`);
  }

  const chunkSize = 20;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (conn.characteristic.properties.writeWithoutResponse) {
      await conn.characteristic.writeValueWithoutResponse(chunk);
    } else {
      await conn.characteristic.writeValue(chunk);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

// ============================================================
// PRINT QUEUE PER PRINTER (TO DO 14.3) — FIFO + retry 1× untuk
// error transient (GATT busy / disconnect sesaat). Mencegah tumpang
// tindih saat banyak job (struk kasir + tiket dapur + split) tiba bersamaan.
// ============================================================

interface PrintQueueJob {
  printerId: string;
  data: Uint8Array;
  attempts: number;
}

const printQueue: PrintQueueJob[] = [];
const drainingPrinters = new Set<string>();

function enqueuePrint(printerId: string, data: Uint8Array) {
  printQueue.push({ printerId, data, attempts: 0 });
  void drainPrintQueue();
}

async function drainPrintQueue() {
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const job of [...printQueue]) {
      if (drainingPrinters.has(job.printerId)) continue; // printer sedang sibuk — tunggu job sebelumnya

      drainingPrinters.add(job.printerId);
      try {
        await writeToPrinter(job.printerId, job.data);
        const idx = printQueue.indexOf(job);
        if (idx >= 0) printQueue.splice(idx, 1);
        progressed = true;
      } catch (err: any) {
        const idx = printQueue.indexOf(job);
        if (idx < 0) continue;
        if (job.attempts < 1) {
          // Retry sekali untuk error transient (GATT busy / disconnect sesaat)
          job.attempts += 1;
          printQueue[idx] = job;
          await new Promise((r) => setTimeout(r, 150));
        } else {
          printQueue.splice(idx, 1);
          console.warn(`[PrintQueue] ${job.printerId} gagal ${job.attempts + 1}x:`, err?.message || err);
        }
        progressed = true;
      } finally {
        drainingPrinters.delete(job.printerId);
      }
    }
  }
}

/**
 * Kirim data ke printer Bluetooth lewat antrean FIFO per printer (TO DO 14.3).
 * Semua jalur cetak (struk, tiket dapur, test print) melewati fungsi ini.
 */
async function sendToBluetoothPrinter(printerId: string, data: Uint8Array): Promise<void> {
  enqueuePrint(printerId, data);
  // Tunggu sampai job ini selesai (atau gagal setelah retry) — tetap serial per printer.
  while (printQueue.some((j) => j.data === data && j.printerId === printerId)) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

// ============================================================
// ============================================================
// MONOCHROME (BLACK & WHITE) LOGO CONVERSION FOR THERMAL PRINT
// ============================================================

/**
 * Convert any image (URL or Base64) into a 1-bit Black & White monochrome canvas.
 * Transparent PNG backgrounds become crisp white, colored pixels are thresholded to black/white.
 */
export function getMonochromeLogoCanvas(src: string, targetWidth = 160): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error('Gagal memuat logo'));
    img.onload = () => {
      // Scale image to compact targetWidth suitable for thermal receipt headers (~20mm width)
      const scale = targetWidth / Math.max(img.width, 1);
      const width = Math.max(8, Math.round(img.width * scale));
      const height = Math.max(8, Math.round(img.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(canvas);
        return;
      }

      // White background for transparent PNG logos
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const imgData = ctx.getImageData(0, 0, width, height);
      const data = imgData.data;

      // Convert to 1-bit Black & White (Grayscale + High-Contrast Thresholding)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const alpha = data[i + 3];

        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const bw = (gray < 165 && alpha > 128) ? 0 : 255;

        data[i] = bw;
        data[i + 1] = bw;
        data[i + 2] = bw;
        data[i + 3] = 255;
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas);
    };
    img.src = src;
  });
}

/**
 * Convert Canvas bitmap into ESC/POS GS v 0 raster bit image commands.
 */
export function convertCanvasToESCPOSRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d');
  if (!ctx) return new Uint8Array(0);

  const width = canvas.width;
  const height = canvas.height;
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  const bytesWidth = Math.ceil(width / 8);
  const commands: number[] = [];

  const xL = bytesWidth & 0xFF;
  const xH = (bytesWidth >> 8) & 0xFF;
  const yL = height & 0xFF;
  const yH = (height >> 8) & 0xFF;

  // Center align logo
  commands.push(0x1B, 0x61, 0x01);
  // GS v 0 0 xL xH yL yH
  commands.push(0x1D, 0x76, 0x30, 0x00, xL, xH, yL, yH);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < bytesWidth; x++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const px = x * 8 + bit;
        if (px < width) {
          const idx = (y * width + px) * 4;
          const r = data[idx];
          if (r < 128) {
            byte |= (0x80 >> bit);
          }
        }
      }
      commands.push(byte);
    }
  }

  commands.push(0x0A); // Line feed after logo
  return new Uint8Array(commands);
}

// ============================================================
// MODE 1: BROWSER PRINT (window.print)
// ============================================================

export function printReceiptBrowser(data: ReceiptData, width: '58mm' | '80mm', preOpenedWindow?: Window | null) {
  const fontSize = width === '58mm' ? '11px' : '12px';
  const paperWidth = width === '58mm' ? '48mm' : '72mm';
  const dateStr = formatDateShort(data.date);

  const itemsHtml = data.items.map((item) => {
    if (item.isBundleChild) {
      return `
        <div style="font-size: 85%; color: #555; padding-left: 12px; margin-bottom: 2px;">
          - ${item.quantity}x ${item.name}
        </div>
      `;
    }

    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => (a.price > 0 ? a.name : a.name + '(Gratis)')).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    const unitPrice = item.basePrice + item.addons.reduce((a, b) => a + b.price, 0);
    const itemDisc = item.itemDiscount || 0;
    const originalTotal = unitPrice * item.quantity;

    return `
      <div class="item-row">
        <div class="font-bold">${item.name} ${item.isBundle ? '<span style="font-size: 80%; font-weight: normal;">(Paket)</span>' : ''}</div>
        ${detailStr ? `<div class="item-details">${detailStr}</div>` : ''}
        <div class="flex-between">
          <span style="padding-left: 4px;">${item.quantity}x ${formatRupiah(unitPrice)}</span>
          <span class="font-bold">${formatRupiah(item.subtotal)}</span>
        </div>
        ${itemDisc > 0 ? `<div class="flex-between" style="font-size: 85%; color: #b45309;"><span style="padding-left: 4px;">Diskon item</span><span>-${formatRupiah(itemDisc)}</span></div>` : ''}
      </div>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Struk #${data.queueNumber}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Courier New', Courier, monospace;
          font-size: ${fontSize};
          width: ${paperWidth};
          margin: 0 auto;
          padding: 4mm 2mm;
          color: #000;
          background: #fff;
          line-height: 1.3;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .font-bold { font-weight: bold; }
        .uppercase { text-transform: uppercase; }
        .divider { border-bottom: 1px dashed #000; margin: 6px 0; }
        .flex-between { display: flex; justify-content: space-between; align-items: flex-start; }
        .item-row { margin-bottom: 5px; }
        .item-details { font-size: 90%; color: #444; padding-left: 4px; }
        .logo-container { text-align: center; margin-bottom: 6px; }
        .logo-img { max-height: 45px; max-width: 130px; width: auto; height: auto; object-fit: contain; margin: 0 auto; display: block; filter: grayscale(100%) contrast(200%); }
        @media print {
          @page { margin: 0; size: ${width} auto; }
          body { width: 100%; padding: 2mm; }
        }
      </style>
    </head>
    <body>
      ${data.storeLogo && data.showLogoOnReceipt !== false ? `<div class="logo-container"><img id="receipt-logo" src="${data.storeLogo}" class="logo-img" alt="Logo" /></div>` : ''}
      
      ${data.isReprint ? `<div class="text-center font-bold">*** CETAK ULANG ***</div>` : ''}
      <div class="text-center font-bold uppercase" style="font-size: 110%;">${data.storeName}</div>
      ${data.storeAddress ? `<div class="text-center" style="font-size: 90%;">${data.storeAddress}</div>` : ''}
      ${data.receiptHeader ? `<div class="text-center" style="font-size: 90%; margin-top: 2px;">${data.receiptHeader}</div>` : ''}
      
      <div class="divider"></div>
      
      <div class="flex-between" style="font-size: 95%;">
        <div>
          <div>No: #${data.queueNumber}</div>
          <div>Tgl: ${dateStr}</div>
          <div>Kasir: ${data.cashierName}</div>
          ${data.customerName ? `<div>Pelanggan: ${data.customerName}</div>` : ''}
        </div>
        <div class="text-right font-bold uppercase">
          ${data.orderType ? `<div>${data.orderType}</div>` : ''}
          ${data.tableNumber ? `<div>${data.tableNumber}</div>` : ''}
        </div>
      </div>
      
      <div class="divider"></div>
      
      <div style="margin: 4px 0;">
        ${itemsHtml}
      </div>
      
      <div class="divider"></div>
      
      <div style="font-size: 95%;">
        <div class="flex-between"><span>Subtotal</span><span>${formatRupiah(data.subtotal)}</span></div>
        ${data.discount > 0 ? `<div class="flex-between"><span>Diskon</span><span>-${formatRupiah(data.discount)}</span></div>` : ''}
        ${data.promoName ? `<div class="flex-between"><span>Promo</span><span>${data.promoName}${data.promoCode ? ` (${data.promoCode})` : ''}</span></div>` : ''}
        ${data.tax && data.tax > 0 ? `<div class="flex-between"><span>Pajak</span><span>${formatRupiah(data.tax)}</span></div>` : ''}
        <div class="flex-between font-bold" style="font-size: 105%; margin-top: 2px;"><span>TOTAL</span><span>${formatRupiah(data.total)}</span></div>
      </div>
      
      <div class="divider"></div>
      
      <div style="font-size: 95%;">
        <div class="flex-between"><span>Bayar (${data.paymentMethod})</span><span>${formatRupiah(data.cashReceived || data.total)}</span></div>
        ${data.paymentMethod === 'Cash' && data.change !== undefined ? `<div class="flex-between"><span>Kembali</span><span>${formatRupiah(data.change)}</span></div>` : ''}
      </div>
      
      <div class="divider"></div>
      
      <div class="text-center" style="margin-top: 6px; font-size: 90%;">
        ${data.receiptFooter ? data.receiptFooter : 'Terima kasih atas kunjungan Anda!'}
      </div>

      <script>
        function triggerPrint() {
          window.focus();
          window.print();
          setTimeout(function() { window.close(); }, 1200);
        }
        window.onload = function() {
          var img = document.getElementById('receipt-logo');
          if (img) {
            if (img.complete && img.naturalWidth !== 0) {
              triggerPrint();
            } else {
              img.onload = triggerPrint;
              img.onerror = triggerPrint;
              setTimeout(triggerPrint, 1000);
            }
          } else {
            triggerPrint();
          }
        };
      </script>
    </body>
    </html>
  `;

  // Use pre-opened window if available, otherwise open a new one
  const printWindow = preOpenedWindow || window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) {
    console.warn('[printReceiptBrowser] Pop-up blocked. Please allow pop-ups for this site.');
    return;
  }

  printWindow.document.write(html);
  printWindow.document.close();
}

// ============================================================
// MODE 2: BLUETOOTH ESC/POS — Cashier Receipt
// ============================================================

async function buildReceiptESCPOS(data: ReceiptData, width: '58mm' | '80mm'): Promise<Uint8Array> {
  const maxChars = width === '58mm' ? 32 : 42;
  const encoder = new TextEncoder();
  const ESC = 0x1B;
  const GS = 0x1D;
  const commands: number[] = [];

  // Initialize printer
  commands.push(ESC, 0x40);

  // 1. Monochromatic Logo Printing (converted to B&W 1-bit raster image)
  if (data.showLogoOnReceipt !== false && data.storeLogo) {
    try {
      const targetPixelWidth = width === '58mm' ? 160 : 220;
      const monoCanvas = await getMonochromeLogoCanvas(data.storeLogo, targetPixelWidth);
      const rasterBytes = convertCanvasToESCPOSRaster(monoCanvas);
      commands.push(...rasterBytes);
    } catch (e) {
      console.warn('[ESCPOS] Logo conversion failed, printing text only:', e);
    }
  }

  // 2. Header
  if (data.isReprint) {
    commands.push(ESC, 0x61, 0x01); // Center align
    commands.push(...encoder.encode('*** CETAK ULANG ***\n'));
  }

  // Center align + Bold store name
  commands.push(ESC, 0x61, 0x01);
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(data.storeName + '\n'));
  commands.push(ESC, 0x45, 0x00);

  if (data.storeAddress) {
    commands.push(...encoder.encode(data.storeAddress + '\n'));
  }
  if (data.receiptHeader) {
    commands.push(...encoder.encode(data.receiptHeader + '\n'));
  }

  // Left align
  commands.push(ESC, 0x61, 0x00);
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 3. Transaction Info (Exact Left/Right Alignment)
  const orderHeader = getOrderTypeHeaderLines(data.orderType, data.tableNumber);
  const formattedDate = formatDateShort(data.date);

  const line1 = leftRight(`No: #${data.queueNumber}`, orderHeader.line1, width);
  commands.push(...encoder.encode(line1 + '\n'));

  const dateLeft = `Tgl: ${formattedDate}`;
  const rightTag = orderHeader.line2 || '';
  const line2 = leftRight(dateLeft, rightTag, width);
  commands.push(...encoder.encode(line2 + '\n'));

  commands.push(...encoder.encode(`Kasir: ${data.cashierName}\n`));
  if (data.customerName) {
    commands.push(...encoder.encode(`Pelanggan: ${data.customerName}\n`));
  }
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 4. Items List (Exact Left/Right Alignment)
  for (const item of data.items) {
    commands.push(...encoder.encode(`${item.name}\n`));
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => (a.price > 0 ? a.name : a.name + '(Gratis)')).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      commands.push(...encoder.encode(`  ${detailStr}\n`));
    }

    const unitPrice = item.basePrice + item.addons.reduce((a, b) => a + b.price, 0);
    const qtyPriceStr = `  ${item.quantity}x ${formatRupiah(unitPrice)}`;
    const subtotalStr = formatRupiah(item.subtotal);
    commands.push(...encoder.encode(leftRight(qtyPriceStr, subtotalStr, width) + '\n'));
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 5. Totals (Exact Left/Right Alignment)
  commands.push(...encoder.encode(leftRight('Subtotal', formatRupiah(data.subtotal), width) + '\n'));
  if (data.discount > 0) {
    commands.push(...encoder.encode(leftRight('Diskon', `-${formatRupiah(data.discount)}`, width) + '\n'));
  }
  // v4.7 TO DO 12.2.7 (P-A7): nama promo/voucher di struk thermal (ESC/POS) — potong bila panjang
  if (data.promoName) {
    const promoLabel = `Promo: ${data.promoName}${data.promoCode ? ` (${data.promoCode})` : ''}`;
    commands.push(...encoder.encode(promoLabel.slice(0, maxChars) + '\n'));
  }
  if (data.tax && data.tax > 0) {
    commands.push(...encoder.encode(leftRight('Pajak', formatRupiah(data.tax), width) + '\n'));
  }

  // Bold TOTAL
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(leftRight('TOTAL', formatRupiah(data.total), width) + '\n'));
  commands.push(ESC, 0x45, 0x00);

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // Payment & Change (Exact Left/Right Alignment)
  const payLabel = `Bayar (${data.paymentMethod})`;
  const payVal = formatRupiah(data.cashReceived || data.total);
  commands.push(...encoder.encode(leftRight(payLabel, payVal, width) + '\n'));

  if (data.paymentMethod === 'Cash' && data.change !== undefined) {
    commands.push(...encoder.encode(leftRight('Kembali', formatRupiah(data.change), width) + '\n'));
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // 6. Footer (Centered & Wrapped to prevent line overflow)
  commands.push(ESC, 0x61, 0x01); // Center align
  const rawFooter = data.receiptFooter || 'Terima kasih atas kunjungan Anda!';
  const wrappedFooterLines = wrapCenterLines(rawFooter, width);
  commands.push(...encoder.encode('\n' + wrappedFooterLines.join('\n') + '\n\n'));

  // Feed and cut
  commands.push(ESC, 0x64, 0x04);
  commands.push(GS, 0x56, 0x00);

  return new Uint8Array(commands);
}

/**
 * Cetak struk kasir via Bluetooth. Return true bila berhasil dicetak (termasuk via
 * fallback browser bila diaktifkan); false bila Bluetooth gagal & fallback nonaktif
 * (pemanggil mencatat status error — TO DO 14.5 fallback eksplisit per printer).
 */
async function printReceiptBluetooth(data: ReceiptData, width: '58mm' | '80mm', settings?: AppSettings): Promise<boolean> {
  if (!isBluetoothConnected(CASHIER_PRINTER_ID)) {
    // TO DO 14.1 P-3 + 14.2: re-pair senyap dulu (tanpa picker); gagal → fallback browser
    // print + toast peringatan (bukan error diam-diam, bukan picker di tengah checkout).
    // TO DO 14.5: fallback hanya dipakai bila opsi eksplisit per-printer aktif (default true).
    const expected = getPrinterDeviceId(CASHIER_PRINTER_ID, settings);
    if (expected) {
      const result = await reconnectBluetoothPrinter(CASHIER_PRINTER_ID, expected);
      if (result.success) {
        const escposData = await buildReceiptESCPOS(data, width);
        await sendToBluetoothPrinter(CASHIER_PRINTER_ID, escposData);
        return true;
      }
    }
    if (settings?.cashierFallbackBrowser === false) {
      notifyPrinterFallback('Printer Kasir');
      return false;
    }
    printReceiptBrowser(data, width);
    notifyPrinterFallback('Printer Kasir');
    return true;
  }

  const escposData = await buildReceiptESCPOS(data, width);
  await sendToBluetoothPrinter(CASHIER_PRINTER_ID, escposData);
  return true;
}

// ============================================================
// KITCHEN TICKET — Browser Print
// ============================================================

export function printKitchenReceiptBrowser(data: ReceiptData, items: CartItem[], kp: KitchenPrinterConfig) {
  const fontSize = kp.width === '58mm' ? '10px' : '12px';
  const paperWidth = kp.width === '58mm' ? '48mm' : '72mm';
  const separator = kp.width === '58mm' ? '-'.repeat(32) : '-'.repeat(42);

  const dateStr = new Date(data.date).toLocaleString('id-ID');

  let lines: string[] = [];

  // Header
  // 🏷️ v4.9: Header Order Batch
  if (data.batchNumber && data.batchNumber > 1) {
    lines.push(center('================================', kp.width));
    lines.push(center(`[BATCH #${data.batchNumber} - ${data.batchLabel || `TAMBAHAN #${data.batchNumber - 1}`}]`, kp.width));
    lines.push(center('================================', kp.width));
  } else if (data.isAdditionalPrint) {
    lines.push(center('========== ==========', kp.width));
    lines.push(center('TAMBAHAN', kp.width));
    lines.push(center('========== ==========', kp.width));
  } else if (data.batchNumber === 1) {
    lines.push(center('[BATCH #1 - PESANAN AWAL]', kp.width));
  }

  lines.push(center(`TIKET DAPUR - #${data.queueNumber}`, kp.width));
  lines.push(center(kp.name.toUpperCase(), kp.width));
  if (data.isReprint) {
    lines.push(center('*** CETAK ULANG ***', kp.width));
  }
  lines.push(separator);

  // Info
  lines.push(`Tgl: ${dateStr}`);
  lines.push(`Kasir: ${data.cashierName}`);
  if (data.customerName) lines.push(`Pelanggan: ${data.customerName}`);
  if (data.orderType) lines.push(`Tipe: ${data.orderType}${data.tableNumber ? ` (${data.tableNumber})` : ''}`);
  lines.push(separator);

  // Items
  for (const item of items) {
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => (a.price > 0 ? a.name : a.name + '(Gratis)')).join(',')}` : '';
    lines.push(`${item.name}`);
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      lines.push(`  ${detailStr}`);
    }
    lines.push(`  QTY: ${item.quantity}`);
    lines.push('');
  }

  lines.push(separator);
  lines.push('');
  lines.push(center('Selesai Tiket', kp.width));
  lines.push('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tiket Dapur #${data.queueNumber} - ${kp.name}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: ${fontSize}; width: ${paperWidth}; margin: 0 auto; padding: 4mm 2mm; color: #000; }
        pre { white-space: pre-wrap; word-break: break-all; line-height: 1.4; font-weight: bold; font-family: inherit; }
        @media print {
          @page { margin: 0; size: ${kp.width} auto; }
          body { width: 100%; padding: 2mm; }
        }
      </style>
    </head>
    <body>
      <pre>${lines.join('\n')}</pre>
    </body>
    </html>
  `;
  printHtmlInIframe(html);
}

// ============================================================
// KITCHEN TICKET — Bluetooth ESC/POS
// ============================================================

async function buildKitchenESCPOS(data: ReceiptData, items: CartItem[], kp: KitchenPrinterConfig): Promise<Uint8Array> {
  const maxChars = kp.width === '58mm' ? 32 : 42;
  const encoder = new TextEncoder();
  const ESC = 0x1B;
  const GS = 0x1D;
  const commands: number[] = [];

  // Reset printer & center align
  commands.push(ESC, 0x40);
  commands.push(ESC, 0x61, 0x01);

  // 1. Header (Scoped bold and explicit CRLF line feeds to prevent buffer overlap)
  // 🏷️ v4.9: Header Order Batch
  if (data.batchNumber && data.batchNumber > 1) {
    commands.push(ESC, 0x45, 0x01);
    commands.push(...encoder.encode('================================\r\n'));
    commands.push(...encoder.encode(`[BATCH #${data.batchNumber} - ${data.batchLabel || `TAMBAHAN #${data.batchNumber - 1}`}]\r\n`));
    commands.push(...encoder.encode('================================\r\n'));
    commands.push(ESC, 0x45, 0x00);
  } else if (data.isAdditionalPrint) {
    commands.push(ESC, 0x45, 0x01);
    commands.push(...encoder.encode('========== ==========\r\n'));
    commands.push(...encoder.encode('TAMBAHAN\r\n'));
    commands.push(...encoder.encode('========== ==========\r\n'));
    commands.push(ESC, 0x45, 0x00);
  }

  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(`TIKET DAPUR - #${data.queueNumber}\r\n`));
  commands.push(ESC, 0x45, 0x00);

  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(`${kp.name.toUpperCase()}\r\n`));
  commands.push(ESC, 0x45, 0x00);

  if (data.isReprint) {
    commands.push(ESC, 0x45, 0x01);
    commands.push(...encoder.encode('*** CETAK ULANG ***\r\n'));
    commands.push(ESC, 0x45, 0x00);
  }

  // Left align for body
  commands.push(ESC, 0x61, 0x00);
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\r\n'));
  commands.push(...encoder.encode(`Tgl: ${new Date(data.date).toLocaleString('id-ID')}\r\n`));
  commands.push(...encoder.encode(`Kasir: ${data.cashierName}\r\n`));
  if (data.customerName) {
    commands.push(...encoder.encode(`Pelanggan: ${data.customerName}\r\n`));
  }
  if (data.orderType) {
    commands.push(...encoder.encode(`Tipe: ${data.orderType}${data.tableNumber ? ` (${data.tableNumber})` : ''}\r\n`));
  }
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\r\n'));

  // Items list
  for (const item of items) {
    commands.push(...encoder.encode(`${item.name}\r\n`));
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => (a.price > 0 ? a.name : a.name + '(Gratis)')).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      commands.push(...encoder.encode(`  ${detailStr}\r\n`));
    }
    commands.push(ESC, 0x45, 0x01);
    commands.push(...encoder.encode(`  QTY: ${item.quantity}\r\n\r\n`));
    commands.push(ESC, 0x45, 0x00);
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\r\n'));
  commands.push(ESC, 0x61, 0x01);
  commands.push(...encoder.encode('\r\nSelesai Tiket\r\n\r\n'));
  commands.push(ESC, 0x64, 0x04);
  commands.push(GS, 0x56, 0x00);

  return new Uint8Array(commands);
}

/**
 * Cetak tiket dapur via Bluetooth. Return true bila berhasil dicetak (termasuk via
 * fallback browser bila diaktifkan); false bila Bluetooth gagal & fallback nonaktif
 * (TO DO 14.5 fallback eksplisit per printer dapur).
 */
async function printKitchenReceiptBluetooth(
  data: ReceiptData,
  items: CartItem[],
  kp: KitchenPrinterConfig,
  settings?: AppSettings
): Promise<boolean> {
  if (!isBluetoothConnected(kp.id)) {
    // TO DO 14.1 P-3 + 14.2: re-pair senyap dulu; gagal → fallback browser print + toast
    // (tiket dapur tetap keluar, dapur tidak kehilangan pesanan karena printer terputus).
    const expected = getPrinterDeviceId(kp.id, settings) || kp.bluetoothDeviceId;
    if (expected) {
      const result = await reconnectBluetoothPrinter(kp.id, expected);
      if (result.success) {
        const escposData = await buildKitchenESCPOS(data, items, kp);
        await sendToBluetoothPrinter(kp.id, escposData);
        return true;
      }
    }
    if (kp.fallbackBrowser === false) {
      notifyPrinterFallback(kp.name);
      return false;
    }
    printKitchenReceiptBrowser(data, items, kp);
    notifyPrinterFallback(kp.name);
    return true;
  }

  const escposData = await buildKitchenESCPOS(data, items, kp);
  await sendToBluetoothPrinter(kp.id, escposData);
  return true;
}

// ============================================================
// MAIN PRINT ORCHESTRATOR — Error Isolation with Promise.allSettled
// ============================================================

export async function printReceipt(
  data: ReceiptData,
  settings: AppSettings,
  targetPrinter: 'all' | 'cashier' | 'kitchen' = 'all',
  preOpenedWindow?: Window | null
): Promise<PrintJobResult[]> {
  const results: PrintJobResult[] = [];

  // 1. Print cashier receipt (skip saat target 'kitchen' — hanya tiket dapur)
  if (settings.printerEnabled && targetPrinter !== 'kitchen') {
    try {
      if (settings.printerType === 'bluetooth') {
        // TO DO 14.5: return boolean — false berarti BT gagal & fallback browser nonaktif
        const ok = await printReceiptBluetooth(data, settings.printerWidth, settings);
        if (ok) {
          results.push({ printer: 'Printer Kasir', status: 'success' });
        } else {
          results.push({
            printer: 'Printer Kasir',
            status: 'error',
            error: 'Koneksi Bluetooth terputus dan fallback browser nonaktif untuk printer ini.',
          });
        }
      } else {
        printReceiptBrowser(data, settings.printerWidth, preOpenedWindow);
        results.push({ printer: 'Printer Kasir', status: 'success' });
      }
    } catch (err: any) {
      console.error('[PrintReceipt] Cashier print failed:', err);
      results.push({ printer: 'Printer Kasir', status: 'error', error: err.message });
    }
  }

  // 2. Print kitchen tickets (target 'all' atau 'kitchen')
  if (
    (targetPrinter === 'all' || targetPrinter === 'kitchen') &&
    settings.kitchenPrinters &&
    settings.kitchenPrinters.length > 0
  ) {
    const activeKitchenPrinters = settings.kitchenPrinters.filter((kp) => kp.enabled);

    if (activeKitchenPrinters.length > 0) {
      const kitchenJobs = activeKitchenPrinters.map(async (kp): Promise<PrintJobResult> => {
        // Filter items by kitchen target (Bundles themselves are NEVER printed in kitchen, only child items)
        const matchingItems = data.items.filter((item) => {
          if (item.isBundle) return false;
          const itemTarget = (item.kitchenTarget || '').trim().toLowerCase();
          const printerTarget = (kp.targetCategory || '').trim().toLowerCase();
          // v4.7: kitchenTarget 'ALL' ("Semua Dapur" di form Edit Menu) → tiket dicetak
          // ke SEMUA printer dapur yang aktif (item ini tampil di semua target dapur).
          if (!itemTarget || itemTarget === 'all' || itemTarget === 'semua dapur' || itemTarget === '*') {
            return true;
          }
          return itemTarget === printerTarget && printerTarget !== '';
        });

        if (matchingItems.length === 0) {
          return { printer: kp.name, status: 'success' }; // Nothing to print = success
        }

        try {
          if (kp.type === 'bluetooth') {
            // TO DO 14.5: return boolean — false berarti BT gagal & fallback browser nonaktif
            const ok = await printKitchenReceiptBluetooth(data, matchingItems, kp, settings);
            if (ok) return { printer: kp.name, status: 'success' };
            return {
              printer: kp.name,
              status: 'error',
              error: 'Koneksi Bluetooth terputus dan fallback browser nonaktif untuk printer ini.',
            };
          }
          printKitchenReceiptBrowser(data, matchingItems, kp);
          return { printer: kp.name, status: 'success' };
        } catch (err: any) {
          console.error(`[PrintReceipt] Kitchen print failed for ${kp.name}:`, err);
          return { printer: kp.name, status: 'error', error: err.message };
        }
      });

      const kitchenResults = await Promise.allSettled(kitchenJobs);
      for (const result of kitchenResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({ printer: 'Kitchen (unknown)', status: 'error', error: result.reason?.message });
        }
      }
    }
  }

  return results;
}

// ============================================================
// TEST PRINT — Independent per printer
// ============================================================

export async function testPrintBluetooth(
  printerId: string,
  printerName: string,
  targetLabel: string,
  width: '58mm' | '80mm' = '58mm'
): Promise<void> {
  if (!isBluetoothConnected(printerId)) {
    throw new Error(`Printer "${printerName}" belum terhubung.`);
  }

  const conn = printerRegistry.get(printerId);
  const deviceName = conn?.deviceName || 'Unknown';

  const maxChars = width === '58mm' ? 32 : 42;
  const encoder = new TextEncoder();
  const ESC = 0x1B;
  const GS = 0x1D;
  const commands: number[] = [];

  commands.push(ESC, 0x40); // Initialize
  commands.push(ESC, 0x61, 0x01); // Center

  commands.push(ESC, 0x45, 0x01); // Bold on
  commands.push(...encoder.encode('BERDIKARIPOS\n'));
  commands.push(...encoder.encode('TEST PRINT\n'));
  commands.push(ESC, 0x45, 0x00); // Bold off

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));
  commands.push(ESC, 0x61, 0x00); // Left align
  commands.push(...encoder.encode(`Printer: ${printerName}\n`));
  commands.push(...encoder.encode(`Target: ${targetLabel}\n`));
  commands.push(...encoder.encode(`Device: ${deviceName}\n`));
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  commands.push(ESC, 0x61, 0x01); // Center
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode('\nStatus: OK\n\n'));
  commands.push(ESC, 0x45, 0x00);

  commands.push(ESC, 0x64, 0x04); // Feed
  commands.push(GS, 0x56, 0x00); // Cut

  const data = new Uint8Array(commands);
  await sendToBluetoothPrinter(printerId, data);
}

// ============================================================
// RAW TEXT PRINTING (for shift summary etc.)
// ============================================================

export async function printTextRaw(lines: string[], settings: AppSettings): Promise<boolean> {
  if (!settings.printerEnabled) {
    fallbackBrowserPrintText(lines, '58mm');
    return true;
  }

  if (settings.printerType === 'bluetooth') {
    // Ensure cashier printer is connected — TO DO 14.1 P-3 + 14.2: re-pair senyap dulu,
    // tanpa membuka picker; kalau gagal → fallback browser print + toast (tidak memblokir shift).
    // TO DO 14.5: fallback hanya bila opsi eksplisit aktif (default true); kalau nonaktif
    // → return false (pemanggil, mis. tutup shift, memutuskan — tidak melempar agar kasir
    // tidak terkunci, lihat TO DO 6.4).
    if (!isBluetoothConnected(CASHIER_PRINTER_ID)) {
      const expected = getPrinterDeviceId(CASHIER_PRINTER_ID, settings);
      let connected = false;
      if (expected) {
        const result = await reconnectBluetoothPrinter(CASHIER_PRINTER_ID, expected);
        connected = result.success;
      }
      if (!connected) {
        if (settings.cashierFallbackBrowser === false) {
          notifyPrinterFallback('Printer Kasir');
          return false;
        }
        fallbackBrowserPrintText(lines, settings.printerWidth);
        notifyPrinterFallback('Printer Kasir');
        return true;
      }
    }

    const maxChars = settings.printerWidth === '58mm' ? 32 : 42;
    const encoder = new TextEncoder();
    const ESC = 0x1B;
    const GS = 0x1D;
    const commands: number[] = [];

    commands.push(ESC, 0x40);
    commands.push(ESC, 0x61, 0x00);

    for (const line of lines) {
      commands.push(...encoder.encode(line + '\n'));
    }

    commands.push(ESC, 0x64, 0x04);
    commands.push(GS, 0x56, 0x00);

    const data = new Uint8Array(commands);
    try {
      await sendToBluetoothPrinter(CASHIER_PRINTER_ID, data);
      return true;
    } catch (err) {
      console.error('printTextRaw Bluetooth error:', err);
      if (settings.cashierFallbackBrowser === false) {
        notifyPrinterFallback('Printer Kasir');
        return false;
      }
      fallbackBrowserPrintText(lines, settings.printerWidth);
      return true;
    }
  } else {
    fallbackBrowserPrintText(lines, settings.printerWidth);
    return true;
  }
}

export function printHtmlInIframe(htmlContent: string) {
  const iframeId = `thermal-print-iframe-${Math.random().toString(36).substring(2, 9)}`;
  const iframe = document.createElement('iframe');
  iframe.id = iframeId;
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0px';
  iframe.style.height = '0px';
  iframe.style.border = '0px';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (doc) {
    doc.open();
    doc.write(htmlContent);
    doc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (e) {
        console.error('Iframe print error:', e);
      } finally {
        setTimeout(() => {
          try {
            document.body.removeChild(iframe);
          } catch (e) {
            // ignore
          }
        }, 60000);
      }
    }, 250);
  } else {
    const printWindow = window.open('', '_blank', 'width=400,height=600');
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
        setTimeout(() => printWindow.close(), 1000);
      }, 300);
    }
  }
}

function fallbackBrowserPrintText(lines: string[], width: '58mm' | '80mm') {
  const fontSize = width === '58mm' ? '10px' : '12px';
  const paperWidth = width === '58mm' ? '48mm' : '72mm';
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Ringkasan</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; font-size: ${fontSize}; width: ${paperWidth}; margin: 0 auto; padding: 4mm 2mm; color: #000; }
        pre { white-space: pre-wrap; word-break: break-all; line-height: 1.4; font-family: inherit; }
        @media print {
          @page { margin: 0; size: ${width} auto; }
          body { width: 100%; padding: 2mm; }
        }
      </style>
    </head>
    <body>
      <pre>${lines.join('\n')}</pre>
    </body>
    </html>
  `;
  printHtmlInIframe(html);
}

// ============================================================
// HELPERS
// ============================================================

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

export function wrapCenterLines(text: string, width: '58mm' | '80mm'): string[] {
  const maxChars = width === '58mm' ? 32 : 42;
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxChars) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(center(currentLine, width));
      currentLine = word;
    }
  }
  if (currentLine) lines.push(center(currentLine, width));
  return lines;
}

function center(text: string, width: '58mm' | '80mm'): string {
  const maxChars = width === '58mm' ? 32 : 42;
  const pad = Math.max(0, Math.floor((maxChars - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function leftRight(left: string, right: string, width: '58mm' | '80mm'): string {
  const maxChars = width === '58mm' ? 32 : 42;
  const space = Math.max(1, maxChars - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

function padLeft(text: string, width: '58mm' | '80mm'): string {
  const maxChars = width === '58mm' ? 32 : 42;
  const pad = Math.max(1, maxChars - text.length - 10);
  return ' '.repeat(pad) + text;
}

export function getOrderTypeHeaderLines(orderType?: string, tableNumber?: string): { line1: string; line2?: string } {
  const type = (orderType || 'Dine In').trim();

  if (type.toLowerCase() === 'dine in') {
    let tableStr = '';
    if (tableNumber) {
      const cleanTable = tableNumber.replace(/^meja\s*/i, '').trim();
      tableStr = `MEJA ${cleanTable}`;
    }
    return {
      line1: 'DINE IN',
      line2: tableStr || undefined,
    };
  }

  if (type.toLowerCase() === 'take away' || type.toLowerCase() === 'takeaway') {
    return {
      line1: 'TAKE',
      line2: 'AWAY',
    };
  }

  return {
    line1: type.toUpperCase(),
    line2: tableNumber ? `MEJA ${tableNumber.replace(/^meja\s*/i, '').toUpperCase()}` : undefined,
  };
}

export function printProvisionalBill(tx: Transaction, settings: AppSettings) {
  const receiptData = buildReceiptFromTransaction(tx, settings);
  receiptData.receiptHeader = `*** BILL SEMENTARA (PRE-PAYMENT) ***\n${receiptData.receiptHeader || ''}`.trim();
  receiptData.paymentMethod = 'BELUM DIBAYAR (PENDING)';
  receiptData.cashReceived = undefined;
  receiptData.change = undefined;

  return printReceipt(receiptData, settings, 'cashier');
}

export async function printSplitReceipt(
  subTx: Transaction,
  parentTx: Transaction | null | undefined,
  settings: AppSettings,
  target: 'cashier' | 'all' = 'cashier',
  allItems?: CartItem[],
  // v4.7 TO DO 15.3: dua toggle independen di split bill —
  // skipCashierPrint = true → struk kasir sub-bill dilewati (tiket dapur tetap bisa keluar);
  // skipKitchenPrint = true → tiket dapur dilewati (anti tiket DOBEL saat split dari pending).
  skipCashierPrint?: boolean,
  skipKitchenPrint?: boolean
): Promise<PrintJobResult[]> {
  const receiptData = buildReceiptFromTransaction(subTx, settings);
  const splitLabel = `[SPLIT BILL ${subTx.splitIndex || 1} OF ${subTx.totalSplitCount || 1}]`;
  const parentLabel = parentTx ? `Induk Order #${parentTx.queueNumber}\n` : '';

  // v4.1 TO DO 2.3 — Mode Equal (Split Nominal Rata): label bagian eksplisit (menggantikan
  // splitLabel agar tidak duplikat) + subtotal per item proporsional (Σ item === subtotal bagian),
  // plus baris ringkasan pesanan asli sebagai konteks. Mode item tidak diubah.
  const equalSplit = buildEqualSplitReceipt(subTx);
  if (equalSplit) {
    const orderTotal = subTx.items.reduce((a, i) => a + i.subtotal, 0);
    receiptData.receiptHeader =
      `${equalSplit.header}\nPesanan: ${subTx.items.length} item — Total ${formatRupiah(orderTotal)}\n` +
      `${parentLabel}${receiptData.receiptHeader || ''}`.trim();
    receiptData.items = equalSplit.items;
  } else {
    receiptData.receiptHeader = `${splitLabel}\n${parentLabel}${receiptData.receiptHeader || ''}`.trim();
  }

  const results: PrintJobResult[] = [];

  // 1. Struk kasir sub-bill (hanya item sub-bill itu) — dilewati bila skipCashierPrint (hemat struk)
  if (!skipCashierPrint) {
    results.push(...(await printReceipt(receiptData, settings, 'cashier')));
  }

  // 2. Tiket dapur lengkap — hanya saat target 'all' (split fresh, sub-bill pertama):
  //    dapur belum pernah menerima tiket, cetak semua item cart sekaligus agar tidak ada pesanan yang terlewat.
  //    Dilewati bila skipKitchenPrint (tiket sudah keluar saat pesanan disimpan Pending → anti dobel).
  if (target === 'all' && !skipKitchenPrint) {
    const kitchenData = allItems ? { ...receiptData, items: allItems } : receiptData;
    results.push(...(await printReceipt(kitchenData, settings, 'kitchen')));
  }

  return results;
}
