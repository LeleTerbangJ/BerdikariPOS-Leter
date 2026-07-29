/**
 * Bundle Repository — BerdikariPOS v4.0
 * 
 * Database Access Layer for `menu_components` table in Supabase.
 * Supports local-first offline queueing & Supabase cloud sync.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import { smartUpsert, smartDelete } from './offlineQueue';
import type { MenuComponent } from '../types';

export async function fetchComponentsFromCloud(): Promise<MenuComponent[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase
      .from('menu_components')
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) {
      console.warn('[BundleRepository] Error fetching menu components:', error.message);
      return null;
    }

    return data?.map((row) => ({
      id: row.id,
      parentMenuId: row.parent_menu_id,
      childType: row.child_type,
      childId: row.child_id,
      quantity: Number(row.quantity),
      mode: row.mode,
      sortOrder: row.sort_order || 0,
      createdAt: row.created_at,
    })) || [];
  } catch (err) {
    console.warn('[BundleRepository] Exception fetching components:', err);
    return null;
  }
}

export async function syncComponentToCloud(component: MenuComponent): Promise<void> {
  if (!isSupabaseConfigured) return;
  await smartUpsert('menu_components', {
    id: component.id,
    parent_menu_id: component.parentMenuId,
    child_type: component.childType,
    child_id: component.childId,
    quantity: component.quantity,
    mode: component.mode,
    sort_order: component.sortOrder || 0,
    created_at: component.createdAt || new Date().toISOString(),
  });
}

export async function deleteComponentFromCloud(componentId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  await smartDelete('menu_components', 'id', componentId);
}
