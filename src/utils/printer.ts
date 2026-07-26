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
    showLogoOnReceipt: settings.showLogoOnReceipt !== false,
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
export const CASHIER_PRINTER_ID = '__cashier__';

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
      alert('Browser ini tidak mendukung Web Bluetooth. Gunakan Chrome atau Edge.');
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

    const gatt = device.gatt;
    if (!gatt) {
      alert('Printer tidak mendukung GATT. Coba pairing ulang.');
      return { success: false };
    }
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

            // Listen for disconnection
            device.addEventListener('gattserverdisconnected', () => {
              printerRegistry.delete(printerId);
              console.log(`[PrinterRegistry] ${printerId} disconnected (${device.name})`);
            });

            return {
              success: true,
              deviceId: device.id,
              deviceName: device.name || 'Unknown Printer',
            };
          }
        }
      } catch {
        continue;
      }
    }

    alert('Printer ditemukan tapi tidak bisa menulis. Pastikan printer thermal Bluetooth kompatibel.');
    return { success: false };
  } catch (err: any) {
    if (err.name !== 'NotFoundError') {
      console.error('Bluetooth error:', err);
      alert(`Gagal connect: ${err.message}`);
    }
    return { success: false };
  }
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

async function sendToBluetoothPrinter(printerId: string, data: Uint8Array): Promise<void> {
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
// MODE 1: BROWSER PRINT (window.print)
// ============================================================

export function printReceiptBrowser(data: ReceiptData, width: '58mm' | '80mm', preOpenedWindow?: Window | null) {
  const fontSize = width === '58mm' ? '10px' : '12px';
  const paperWidth = width === '58mm' ? '48mm' : '72mm';
  const separator = width === '58mm' ? '-'.repeat(32) : '-'.repeat(42);

  const dateStr = new Date(data.date).toLocaleString('id-ID');

  let lines: string[] = [];

  // Header
  if (data.isReprint) {
    lines.push(center('*** CETAK ULANG ***', width));
  }
  lines.push(center(data.storeName, width));
  if (data.storeAddress) lines.push(center(data.storeAddress, width));
  if (data.receiptHeader) lines.push(center(data.receiptHeader, width));
  lines.push(separator);

  // Transaction info
  const orderHeader = getOrderTypeHeaderLines(data.orderType, data.tableNumber);
  lines.push(leftRight(`No: #${data.queueNumber}`, orderHeader.line1, width));
  if (orderHeader.line2) {
    lines.push(leftRight(`Tgl: ${dateStr}`, orderHeader.line2, width));
  } else {
    lines.push(`Tgl: ${dateStr}`);
  }
  lines.push(`Kasir: ${data.cashierName}`);
  if (data.customerName) lines.push(`Pelanggan: ${data.customerName}`);
  lines.push(separator);

  // Items
  for (const item of data.items) {
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
    lines.push(`${item.name}`);
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      lines.push(`  ${detailStr}`);
    }
    lines.push(`  ${item.quantity}x ${formatRupiah(item.basePrice + item.addons.reduce((a, b) => a + b.price, 0))}${padLeft(formatRupiah(item.subtotal), width)}`);
  }

  lines.push(separator);

  // Totals
  lines.push(leftRight('Subtotal', formatRupiah(data.subtotal), width));
  if (data.discount > 0) {
    lines.push(leftRight('Diskon', `-${formatRupiah(data.discount)}`, width));
  }
  if (data.tax && data.tax > 0) {
    lines.push(leftRight('Pajak', formatRupiah(data.tax), width));
  }
  lines.push(leftRight('TOTAL', formatRupiah(data.total), width));
  lines.push(separator);

  // Payment
  lines.push(leftRight(`Bayar (${data.paymentMethod})`, formatRupiah(data.cashReceived || data.total), width));
  if (data.paymentMethod === 'Cash' && data.change !== undefined) {
    lines.push(leftRight('Kembali', formatRupiah(data.change), width));
  }

  lines.push(separator);
  lines.push('');
  if (data.receiptFooter) {
    lines.push(center(data.receiptFooter, width));
  } else {
    lines.push(center('Terima kasih!', width));
    lines.push(center('Semoga sehat selalu', width));
  }
  lines.push('');

  // Use pre-opened window if available, otherwise open a new one
  const printWindow = preOpenedWindow || window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) {
    console.warn('[printReceiptBrowser] Pop-up blocked. Please allow pop-ups for this site.');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Struk #${data.queueNumber}</title>
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
      ${data.storeLogo && data.showLogoOnReceipt !== false ? `<div style="text-align: center; margin-bottom: 6px;"><img src="${data.storeLogo}" style="max-height: 48px; max-width: 100%; object-fit: contain;" /></div>` : ''}
      <pre>${lines.join('\n')}</pre>
    </body>
    </html>
  `);
  printWindow.document.close();

  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
    setTimeout(() => printWindow.close(), 1000);
  }, 300);
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

  // Center align + Bold store name
  commands.push(ESC, 0x61, 0x01);
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(data.storeName + '\n'));
  commands.push(ESC, 0x45, 0x00);

  if (data.storeAddress) {
    commands.push(...encoder.encode(data.storeAddress + '\n'));
  }

  // Left align
  commands.push(ESC, 0x61, 0x00);
  if (data.isReprint) {
    commands.push(...encoder.encode('*** CETAK ULANG ***\n'));
  }
  if (data.receiptHeader) {
    commands.push(...encoder.encode(data.receiptHeader + '\n'));
  }
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // Transaction info
  const orderHeader = getOrderTypeHeaderLines(data.orderType, data.tableNumber);
  const line1 = leftRight(`No: #${data.queueNumber}`, orderHeader.line1, width);
  commands.push(...encoder.encode(line1 + '\n'));
  if (orderHeader.line2) {
    const line2 = leftRight(`Tgl: ${new Date(data.date).toLocaleString('id-ID')}`, orderHeader.line2, width);
    commands.push(...encoder.encode(line2 + '\n'));
  } else {
    commands.push(...encoder.encode(`Tgl: ${new Date(data.date).toLocaleString('id-ID')}\n`));
  }
  commands.push(...encoder.encode(`Kasir: ${data.cashierName}\n`));
  if (data.customerName) {
    commands.push(...encoder.encode(`Pelanggan: ${data.customerName}\n`));
  }
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // Items
  for (const item of data.items) {
    commands.push(...encoder.encode(`${item.name}\n`));
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      commands.push(...encoder.encode(`  ${detailStr}\n`));
    }
    commands.push(...encoder.encode(`  ${item.quantity}x    ${formatRupiah(item.subtotal)}\n`));
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // Totals
  commands.push(...encoder.encode(`Subtotal: ${formatRupiah(data.subtotal)}\n`));
  if (data.discount > 0) {
    commands.push(...encoder.encode(`Diskon: -${formatRupiah(data.discount)}\n`));
  }
  if (data.tax && data.tax > 0) {
    commands.push(...encoder.encode(`Pajak: ${formatRupiah(data.tax)}\n`));
  }

  // Bold total
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(`TOTAL: ${formatRupiah(data.total)}\n`));
  commands.push(ESC, 0x45, 0x00);

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));
  commands.push(...encoder.encode(`Bayar (${data.paymentMethod}): ${formatRupiah(data.cashReceived || data.total)}\n`));
  if (data.paymentMethod === 'Cash' && data.change !== undefined) {
    commands.push(...encoder.encode(`Kembali: ${formatRupiah(data.change)}\n`));
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  // Center footer
  commands.push(ESC, 0x61, 0x01);
  const footerText = data.receiptFooter || 'Terima kasih!\nSemoga sehat selalu';
  commands.push(...encoder.encode(`\n${footerText}\n\n`));

  // Feed and cut
  commands.push(ESC, 0x64, 0x04);
  commands.push(GS, 0x56, 0x00);

  return new Uint8Array(commands);
}

async function printReceiptBluetooth(data: ReceiptData, width: '58mm' | '80mm') {
  if (!isBluetoothConnected(CASHIER_PRINTER_ID)) {
    const result = await connectBluetoothPrinter(CASHIER_PRINTER_ID);
    if (!result.success) return;
  }

  const escposData = await buildReceiptESCPOS(data, width);
  await sendToBluetoothPrinter(CASHIER_PRINTER_ID, escposData);
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
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
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

  commands.push(ESC, 0x40);
  commands.push(ESC, 0x61, 0x01);
  commands.push(ESC, 0x45, 0x01);
  commands.push(...encoder.encode(`TIKET DAPUR - #${data.queueNumber}\n`));
  commands.push(...encoder.encode(`${kp.name.toUpperCase()}\n`));
  if (data.isReprint) {
    commands.push(...encoder.encode('*** CETAK ULANG ***\n'));
  }
  commands.push(ESC, 0x45, 0x00);

  commands.push(ESC, 0x61, 0x00);
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));
  commands.push(...encoder.encode(`Tgl: ${new Date(data.date).toLocaleString('id-ID')}\n`));
  commands.push(...encoder.encode(`Kasir: ${data.cashierName}\n`));
  if (data.customerName) {
    commands.push(...encoder.encode(`Pelanggan: ${data.customerName}\n`));
  }
  if (data.orderType) {
    commands.push(...encoder.encode(`Tipe: ${data.orderType}${data.tableNumber ? ` (${data.tableNumber})` : ''}\n`));
  }
  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));

  for (const item of items) {
    commands.push(...encoder.encode(`${item.name}\n`));
    const addonStr = item.addons.length > 0 ? ` +${item.addons.map(a => a.name).join(',')}` : '';
    const sugarStr = item.showSugarLevel !== false ? `/${item.sugar}` : '';
    const tempStr = item.showTemperature !== false ? item.temperature : '';
    const detailStr = `${tempStr}${sugarStr}${addonStr}`.trim();
    if (detailStr) {
      commands.push(...encoder.encode(`  ${detailStr}\n`));
    }
    commands.push(ESC, 0x45, 0x01);
    commands.push(...encoder.encode(`  QTY: ${item.quantity}\n\n`));
    commands.push(ESC, 0x45, 0x00);
  }

  commands.push(...encoder.encode('-'.repeat(maxChars) + '\n'));
  commands.push(ESC, 0x61, 0x01);
  commands.push(...encoder.encode('\nSelesai Tiket\n\n'));
  commands.push(ESC, 0x64, 0x04);
  commands.push(GS, 0x56, 0x00);

  return new Uint8Array(commands);
}

async function printKitchenReceiptBluetooth(data: ReceiptData, items: CartItem[], kp: KitchenPrinterConfig): Promise<void> {
  if (!isBluetoothConnected(kp.id)) {
    throw new Error(`Printer Bluetooth "${kp.name}" belum terhubung. Sambungkan printer terlebih dahulu di Settings.`);
  }

  const escposData = await buildKitchenESCPOS(data, items, kp);
  await sendToBluetoothPrinter(kp.id, escposData);
}

// ============================================================
// MAIN PRINT ORCHESTRATOR — Error Isolation with Promise.allSettled
// ============================================================

export async function printReceipt(
  data: ReceiptData,
  settings: AppSettings,
  targetPrinter: 'all' | 'cashier' = 'all',
  preOpenedWindow?: Window | null
): Promise<PrintJobResult[]> {
  const results: PrintJobResult[] = [];

  // 1. Print cashier receipt
  if (settings.printerEnabled) {
    try {
      if (settings.printerType === 'bluetooth') {
        await printReceiptBluetooth(data, settings.printerWidth);
      } else {
        printReceiptBrowser(data, settings.printerWidth, preOpenedWindow);
      }
      results.push({ printer: 'Printer Kasir', status: 'success' });
    } catch (err: any) {
      console.error('[PrintReceipt] Cashier print failed:', err);
      results.push({ printer: 'Printer Kasir', status: 'error', error: err.message });
    }
  }

  // 2. Print kitchen tickets (only when target is 'all')
  if (targetPrinter === 'all' && settings.kitchenPrinters && settings.kitchenPrinters.length > 0) {
    const kitchenJobs = settings.kitchenPrinters
      .filter(kp => kp.enabled)
      .map(async (kp): Promise<PrintJobResult> => {
        // Filter items by kitchen target
        const matchingItems = data.items.filter((item) => {
          const itemTarget = (item.kitchenTarget || '').trim().toLowerCase();
          const printerTarget = (kp.targetCategory || '').trim().toLowerCase();
          return itemTarget === printerTarget && printerTarget !== '';
        });

        if (matchingItems.length === 0) {
          return { printer: kp.name, status: 'success' }; // Nothing to print = success
        }

        try {
          if (kp.type === 'bluetooth') {
            await printKitchenReceiptBluetooth(data, matchingItems, kp);
          } else {
            printKitchenReceiptBrowser(data, matchingItems, kp);
          }
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

export async function printTextRaw(lines: string[], settings: AppSettings) {
  if (!settings.printerEnabled) {
    fallbackBrowserPrintText(lines, '58mm');
    return;
  }

  if (settings.printerType === 'bluetooth') {
    // Ensure cashier printer is connected
    if (!isBluetoothConnected(CASHIER_PRINTER_ID)) {
      const result = await connectBluetoothPrinter(CASHIER_PRINTER_ID);
      if (!result.success) {
        fallbackBrowserPrintText(lines, settings.printerWidth);
        return;
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
    } catch (err) {
      console.error('printTextRaw Bluetooth error:', err);
      fallbackBrowserPrintText(lines, settings.printerWidth);
    }
  } else {
    fallbackBrowserPrintText(lines, settings.printerWidth);
  }
}

export function printHtmlInIframe(htmlContent: string) {
  let iframe = document.getElementById('thermal-print-iframe') as HTMLIFrameElement;
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'thermal-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = '0px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);
  }

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
