/**
 * Type definitions for the Redux Firefly Example App
 */

export type Priority = 1 | 2 | 3;

export interface Category {
  id: number;
  name: string;
  color: string;
  icon?: string;
  sortOrder: number;
  createdAt: number;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  createdAt?: number;
}

export interface Todo {
  id: number | string; // number for real IDs, string for temp IDs during optimistic updates
  text: string;
  description?: string;
  completed: boolean;
  categoryId?: number;
  category?: Category | null;
  tags: Tag[];
  priority: Priority;
  dueDate?: number;
  createdAt: number;
  updatedAt: number;
  syncing?: boolean; // Track sync status for UI feedback
  error?: string; // Store error message if operation failed
}

export interface TodoStats {
  total: number;
  completedCount: number;
  overdueCount: number;
  avgPriority: number;
}

export interface TodoFilters {
  categoryId?: number;
  tagIds?: number[];
  completed?: boolean;
  priority?: Priority;
  searchText?: string;
}

// Database row types are now inferred from drizzle table definitions
// via InferSelectModel<typeof table> — see database/tables.ts
