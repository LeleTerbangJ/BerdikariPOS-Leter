import { describe, it, expect } from 'vitest';
import type { Transaction } from '../types';

function filterKdsActiveOrders(transactions: Transaction[], todayStr: string): Transaction[] {
  const today = new Date(todayStr);
  today.setHours(0, 0, 0, 0);

  return transactions.filter((t) => {
    if (t.txStatus !== 'Selesai' && t.txStatus !== 'Pending') return false;
    // v4.8: Pesanan pending yang disimpan dengan "Simpan Tanpa Cetak" (kitchenTicketPrintedAt belum terisi)
    // TIDAK boleh muncul di KDS. KDS hanya menampilkan pesanan pending yang dicetak ke dapur.
    if (t.txStatus === 'Pending' && !t.kitchenTicketPrintedAt) return false;
    if (t.splitParentId || (t.splitIndex !== undefined && !t.splitParentId)) return false;
    if (new Date(t.date) < today) return false;
    return true;
  });
}

describe('KDS Pending Print Option Filter (v4.8)', () => {
  const nowStr = new Date().toISOString();

  it('pesanan pending yang disimpan dengan "Simpan Tanpa Cetak" (kitchenTicketPrintedAt undefined) TIDAK muncul di KDS', () => {
    const pendingNoPrint: Transaction = {
      id: 'tx-1',
      queueNumber: 1,
      date: nowStr,
      items: [],
      subtotal: 10000,
      discount: 0,
      totalAmount: 10000,
      hpp: 0,
      tax: 0,
      orderType: 'Dine In',
      paymentMethod: 'Cash',
      kitchenStatus: 'Waiting',
      txStatus: 'Pending',
      cashierId: 'c1',
      cashierName: 'Kasir',
      // kitchenTicketPrintedAt undefined
    };

    const res = filterKdsActiveOrders([pendingNoPrint], nowStr);
    expect(res).toHaveLength(0);
  });

  it('pesanan pending yang disimpan dengan "Cetak Dapur Saja" (kitchenTicketPrintedAt terisi) MUNCUL di KDS', () => {
    const pendingWithKitchenPrint: Transaction = {
      id: 'tx-2',
      queueNumber: 2,
      date: nowStr,
      items: [],
      subtotal: 15000,
      discount: 0,
      totalAmount: 15000,
      hpp: 0,
      tax: 0,
      orderType: 'Dine In',
      paymentMethod: 'Cash',
      kitchenStatus: 'Waiting',
      txStatus: 'Pending',
      cashierId: 'c1',
      cashierName: 'Kasir',
      kitchenTicketPrintedAt: nowStr,
    };

    const res = filterKdsActiveOrders([pendingWithKitchenPrint], nowStr);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('tx-2');
  });

  it('pesanan yang sudah lunas (txStatus === Selesai) MUNCUL di KDS meskipun tanpa kitchenTicketPrintedAt', () => {
    const completedTx: Transaction = {
      id: 'tx-3',
      queueNumber: 3,
      date: nowStr,
      items: [],
      subtotal: 20000,
      discount: 0,
      totalAmount: 20000,
      hpp: 0,
      tax: 0,
      orderType: 'Dine In',
      paymentMethod: 'Cash',
      kitchenStatus: 'Waiting',
      txStatus: 'Selesai',
      cashierId: 'c1',
      cashierName: 'Kasir',
    };

    const res = filterKdsActiveOrders([completedTx], nowStr);
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe('tx-3');
  });
});

import { mergeKitchenItemStatus } from '../utils/kitchenTicket';
import type { CartItem } from '../types';

describe('KDS Multi-Column Item Distribution & Delta Splitting (v4.8.4)', () => {
  it('mergeKitchenItemStatus: menambah kuantitas menu yang sudah Done memisahkan porsi lama (Done) dan porsi tambahan (New)', () => {
    const pendingItems: CartItem[] = [
      {
        lineId: 'line-1',
        menuId: 'm-1',
        name: 'Pecel Lele',
        basePrice: 15000,
        quantity: 1,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 15000,
        kitchenItemStatus: 'done',
      },
    ];

    const cartItems: CartItem[] = [
      {
        lineId: 'line-1',
        menuId: 'm-1',
        name: 'Pecel Lele',
        basePrice: 15000,
        quantity: 2, // Tambah 1 porsi (total 2)
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 30000,
      },
    ];

    const merged = mergeKitchenItemStatus(cartItems, pendingItems);
    expect(merged).toHaveLength(2);

    const doneItem = merged.find((i) => i.kitchenItemStatus === 'done');
    const newItem = merged.find((i) => i.kitchenItemStatus === 'new');

    expect(doneItem).toBeDefined();
    expect(doneItem!.quantity).toBe(1);
    expect(doneItem!.subtotal).toBe(15000);

    expect(newItem).toBeDefined();
    expect(newItem!.quantity).toBe(1);
    expect(newItem!.subtotal).toBe(15000);
    expect(newItem!.lineId).not.toBe('line-1');
  });

  it('KDS Column Filter: transaksi dengan item Done dan item New muncul di KEDUA kolom (Done & Waiting)', () => {
    const tx: Transaction = {
      id: 'tx-multi-col',
      queueNumber: 5,
      date: new Date().toISOString(),
      items: [
        {
          lineId: 'l1',
          menuId: 'm1',
          name: 'Nasi Goreng',
          basePrice: 20000,
          quantity: 1,
          temperature: 'Hangat',
          sugar: 'None',
          addons: [],
          subtotal: 20000,
          kitchenItemStatus: 'done',
        },
        {
          lineId: 'l2',
          menuId: 'm2',
          name: 'Es Teh Manis',
          basePrice: 5000,
          quantity: 1,
          temperature: 'Dingin',
          sugar: 'Normal',
          addons: [],
          subtotal: 5000,
          kitchenItemStatus: 'new',
        },
      ],
      subtotal: 25000,
      discount: 0,
      totalAmount: 25000,
      hpp: 0,
      tax: 0,
      orderType: 'Dine In',
      paymentMethod: 'Cash',
      kitchenStatus: 'Waiting',
      txStatus: 'Pending',
      cashierId: 'c1',
      cashierName: 'Kasir',
      kitchenTicketPrintedAt: new Date().toISOString(),
    };

    const isInWaiting = tx.items.some((i) => !i.isBundle && (i.kitchenItemStatus || 'new') === 'new');
    const isInProcessing = tx.items.some((i) => !i.isBundle && i.kitchenItemStatus === 'processing');
    const isInDone = tx.items.some((i) => !i.isBundle && i.kitchenItemStatus === 'done');

    expect(isInWaiting).toBe(true);
    expect(isInProcessing).toBe(false);
    expect(isInDone).toBe(true);

    // Items rendered in Waiting column should only be 'new'
    const waitingItems = tx.items.filter((i) => (i.kitchenItemStatus || 'new') === 'new');
    expect(waitingItems).toHaveLength(1);
    expect(waitingItems[0].name).toBe('Es Teh Manis');

    // Items rendered in Done column should only be 'done'
    const doneItems = tx.items.filter((i) => i.kitchenItemStatus === 'done');
    expect(doneItems).toHaveLength(1);
    expect(doneItems[0].name).toBe('Nasi Goreng');
  });

  it('mergeKitchenItemStatus: multi-resume bertahap mempertahankan semua porsi lama (Done) dan hanya menambah 1 porsi New', () => {
    // 2 porsi sebelumnya sudah dimasak dan berstatus Done
    const pendingMulti: CartItem[] = [
      {
        lineId: 'line-1',
        menuId: 'm-1',
        name: 'Pecel Lele',
        basePrice: 15000,
        quantity: 1,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 15000,
        kitchenItemStatus: 'done',
      },
      {
        lineId: 'line-1-add-abc',
        menuId: 'm-1',
        name: 'Pecel Lele',
        basePrice: 15000,
        quantity: 1,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 15000,
        kitchenItemStatus: 'done',
      },
    ];

    // Kasir menambah 1 porsi lagi di keranjang POS (total 3)
    const cartItems: CartItem[] = [
      {
        lineId: 'line-1',
        menuId: 'm-1',
        name: 'Pecel Lele',
        basePrice: 15000,
        quantity: 3,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 45000,
      },
    ];

    const merged = mergeKitchenItemStatus(cartItems, pendingMulti);
    // Harus ada 3 baris (2 baris lama 'done' + 1 baris baru 'new')
    expect(merged).toHaveLength(3);

    const doneList = merged.filter((i) => i.kitchenItemStatus === 'done');
    const newList = merged.filter((i) => i.kitchenItemStatus === 'new');

    expect(doneList).toHaveLength(2);
    expect(doneList.reduce((sum, i) => sum + i.quantity, 0)).toBe(2);

    expect(newList).toHaveLength(1);
    expect(newList[0].quantity).toBe(1);
  });

  it('mergeKitchenItemStatus: transaksi pending yang sudah Done mempertahankan seluruh item sebagai Done saat pelunasan tanpa menu baru', () => {
    const pendingItems: CartItem[] = [
      {
        lineId: 'line-1',
        menuId: 'm-1',
        name: 'Pecel Lele',
        basePrice: 15000,
        quantity: 1,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 15000,
      },
      {
        lineId: 'line-2',
        menuId: 'm-2',
        name: 'Es Teh',
        basePrice: 5000,
        quantity: 2,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 10000,
      },
    ];

    const cartItems: CartItem[] = [
      {
        lineId: 'line-1',
        menuId: 'm-1',
        name: 'Pecel Lele',
        basePrice: 15000,
        quantity: 1,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 15000,
      },
      {
        lineId: 'line-2',
        menuId: 'm-2',
        name: 'Es Teh',
        basePrice: 5000,
        quantity: 2,
        temperature: 'Dingin',
        sugar: 'Normal',
        addons: [],
        subtotal: 10000,
      },
    ];

    const merged = mergeKitchenItemStatus(cartItems, pendingItems, 'Done');
    expect(merged).toHaveLength(2);
    expect(merged.every((i) => i.kitchenItemStatus === 'done')).toBe(true);
    expect(merged.some((i) => i.kitchenItemStatus === 'new')).toBe(false);
  });
});

