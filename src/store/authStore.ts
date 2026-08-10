import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeStorage } from '../utils/safeStorage';
import bcrypt from 'bcryptjs';
import type { User, Role } from '../types';
import { seedUsers } from '../utils/seed';
import { useAuditLogStore } from './auditLogStore';
import { syncUser, deleteUserCloud, fetchUsersFromCloud } from '../lib/cloudSync';
import { useCartStore } from './cartStore';

interface AuthState {
  users: User[];
  currentUser: User | null;
  passwordsHashed: boolean; // flag to track migration
  login: (username: string, password: string) => User | null;
  logout: () => void;
  addUser: (user: User) => void;
  updateUser: (id: string, data: Partial<User>) => void;
  deleteUser: (id: string) => void;
  getRedirectPath: (role: Role) => string;
  migratePasswords: () => void;
  loadFromCloud: (fullSync?: boolean) => Promise<void>;
}

const SALT_ROUNDS = 10;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      users: seedUsers,
      currentUser: null,
      passwordsHashed: false,

      migratePasswords: () => {
        if (get().passwordsHashed) return;
        const users = get().users.map((u) => {
          // If password doesn't start with $2a$ or $2b$, it's plain text
          if (!u.password.startsWith('$2a$') && !u.password.startsWith('$2b$')) {
            return { ...u, password: bcrypt.hashSync(u.password, SALT_ROUNDS) };
          }
          return u;
        });
        set({ users, passwordsHashed: true });
      },

      login: (username, password) => {
        const user = get().users.find((u) => u.username === username);
        if (!user) return null;

        // Compare with bcrypt
        let match = false;
        if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
          match = bcrypt.compareSync(password, user.password);
        } else {
          // Fallback for unhashed passwords (pre-migration)
          match = user.password === password;
        }

        if (match) {
          // Multi-login check: generate new active session ID
          const activeSessionId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
          const updatedUser = { ...user, activeSessionId };

          set({ currentUser: updatedUser });
          useAuditLogStore.getState().addLog(user.id, user.name, user.role, 'login', 'User logged in');
          
          set((s) => ({
            users: s.users.map((u) => (u.id === user.id ? updatedUser : u)),
          }));

          syncUser(updatedUser);

          return updatedUser;
        }
        return null;
      },

      logout: () => {
        const currentUser = get().currentUser;
        if (currentUser) {
          useAuditLogStore.getState().addLog(currentUser.id, currentUser.name, currentUser.role, 'logout', 'User logged out');
        }
        // BUG-NEW-01 fix: Clear cart SYNCHRONOUSLY before nulling user
        // to prevent next user from seeing previous user's cart
        useCartStore.getState().clearCart();
        set({ currentUser: null });
      },

      addUser: (user) => {
        // Hash password before storing
        const hashedUser = {
          ...user,
          password: bcrypt.hashSync(user.password, SALT_ROUNDS),
        };
        set((s) => ({ users: [...s.users, hashedUser] }));
        syncUser(hashedUser);
      },

      updateUser: (id, data) => {
        // Hash password if it's being updated
        const updateData = { ...data };
        if (updateData.password && !updateData.password.startsWith('$2a$') && !updateData.password.startsWith('$2b$')) {
          updateData.password = bcrypt.hashSync(updateData.password, SALT_ROUNDS);
        }
        set((s) => ({
          users: s.users.map((u) => (u.id === id ? { ...u, ...updateData } : u)),
          currentUser:
            s.currentUser?.id === id
              ? { ...s.currentUser, ...updateData }
              : s.currentUser,
        }));
        const updated = get().users.find((u) => u.id === id);
        if (updated) syncUser(updated);
      },

      deleteUser: (id) => {
        deleteUserCloud(id);
        set((s) => ({ users: s.users.filter((u) => u.id !== id) }));
      },

      getRedirectPath: (role) => {
        switch (role) {
          case 'Manager':
            return '/dashboard';
          case 'Kasir':
            return '/pos';
          case 'Acaraki':
            return '/kitchen';
          case 'Staf Gudang':
            return '/inventory';
          default:
            return '/';
        }
      },

      loadFromCloud: async (fullSync = false) => {
        const cloudUsers = await fetchUsersFromCloud();
        if (cloudUsers !== null) {
          if (cloudUsers.length > 0) {
            set((s) => {
              const cloudIds = new Set(cloudUsers.map((u) => u.id));
              let localOnly: User[];
              if (fullSync) {
                // Real-time: cloud is authoritative for deletions
                localOnly = []; // Trust cloud completely for users
              } else {
                localOnly = s.users.filter((u) => !cloudIds.has(u.id));
              }
              // BUG-C2 fix: Protect locally hashed passwords from plaintext cloud overwrite.
              const mergedCloud = cloudUsers.map((cloudUser) => {
                const localUser = s.users.find((u) => u.id === cloudUser.id);
                if (localUser) {
                  const localIsHashed = localUser.password.startsWith('$2a$') || localUser.password.startsWith('$2b$');
                  const cloudIsHashed = cloudUser.password.startsWith('$2a$') || cloudUser.password.startsWith('$2b$');
                  
                  let preserved = { ...cloudUser };
                  if (localIsHashed && !cloudIsHashed) {
                    preserved.password = localUser.password;
                    syncUser(preserved);
                  }
                  
                  // Keep the activeSessionId if it's the current user's local session ID
                  if (s.currentUser?.id === cloudUser.id) {
                    preserved.activeSessionId = s.currentUser.activeSessionId;
                  }
                  return preserved;
                }
                return cloudUser;
              });

              // Multi-login check on data load
              const cloudCurrentUser = cloudUsers.find((u) => u.id === s.currentUser?.id);
              if (cloudCurrentUser && s.currentUser) {
                if (cloudCurrentUser.activeSessionId && s.currentUser.activeSessionId && cloudCurrentUser.activeSessionId !== s.currentUser.activeSessionId) {
                  // Force logout in the next tick to prevent state transaction issues
                  setTimeout(() => {
                    alert('Akun Anda telah masuk di perangkat lain. Sesi ini akan ditutup.');
                    get().logout();
                    window.location.href = '/';
                  }, 0);
                }
              }

              // Preserve current user state safely
              const updatedCurrentUser = s.currentUser
                ? mergedCloud.find((u) => u.id === s.currentUser!.id) || s.currentUser
                : null;
              if (updatedCurrentUser && s.currentUser) {
                updatedCurrentUser.activeSessionId = s.currentUser.activeSessionId;
              }

              return { 
                users: [...mergedCloud, ...localOnly],
                currentUser: updatedCurrentUser
              };
            });
          } else {
            // Cloud is empty, seed it with local users
            const localUsers = get().users;
            for (const user of localUsers) {
              await syncUser(user);
            }
          }
        }
      },
    }),
    { name: 'rempah-auth', storage: createJSONStorage(() => safeStorage) }
  )
);
