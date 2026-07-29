/**
 * Bundle Validation Engine — BerdikariPOS v4.0
 * 
 * Rules:
 * 1. Self-referencing check: A menu cannot contain itself as a component.
 * 2. Nested Bundle check (v1): A bundle menu cannot contain another bundle menu.
 * 3. Circular Reference check: Prevents circular dependency chains (e.g. A -> B -> A).
 */

import type { Menu, MenuComponent, ComponentType } from '../types';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a candidate component before adding it to a parent menu.
 */
export function validateMenuComponent(
  parentMenuId: string,
  childType: ComponentType,
  childId: string,
  allMenus: Menu[],
  existingComponents: MenuComponent[] = []
): ValidationResult {
  // Rule 1: Self-referencing check
  if (childType === 'Menu' && childId === parentMenuId) {
    return {
      valid: false,
      error: 'Menu paket tidak boleh berisi dirinya sendiri (Self-reference).',
    };
  }

  // Rule 2: Quantity check
  // (quantity validation is handled separately, must be > 0)

  if (childType === 'Menu') {
    const childMenu = allMenus.find((m) => m.id === childId);
    if (!childMenu) {
      return {
        valid: false,
        error: 'Menu anak tidak ditemukan di katalog.',
      };
    }

    // Rule 3: Nested Bundle Check (v1)
    if (childMenu.isBundle) {
      return {
        valid: false,
        error: `"${childMenu.name}" adalah Menu Paket (Bundle). Versi ini tidak mengizinkan Paket di dalam Paket (Nested Bundle).`,
      };
    }

    // Rule 4: Circular Reference check across the menu tree
    if (hasCircularReference(parentMenuId, childId, allMenus)) {
      return {
        valid: false,
        error: 'Terdeteksi ketergantungan melingkar (Circular reference).',
      };
    }
  }

  // Rule 5: Duplicate component check in same parent
  const isDuplicate = existingComponents.some(
    (c) => c.childType === childType && c.childId === childId
  );
  if (isDuplicate) {
    return {
      valid: false,
      error: 'Komponen ini sudah ada di dalam paket menu.',
    };
  }

  return { valid: true };
}

/**
 * Traverses the component tree to detect circular references (A -> B -> A).
 */
export function hasCircularReference(
  parentMenuId: string,
  candidateChildId: string,
  allMenus: Menu[],
  visited: Set<string> = new Set()
): boolean {
  if (candidateChildId === parentMenuId) return true;
  if (visited.has(candidateChildId)) return false;

  visited.add(candidateChildId);

  const candidateMenu = allMenus.find((m) => m.id === candidateChildId);
  if (!candidateMenu || !candidateMenu.components) return false;

  for (const comp of candidateMenu.components) {
    if (comp.childType === 'Menu') {
      if (comp.childId === parentMenuId) return true;
      if (hasCircularReference(parentMenuId, comp.childId, allMenus, visited)) {
        return true;
      }
    }
  }

  return false;
}
