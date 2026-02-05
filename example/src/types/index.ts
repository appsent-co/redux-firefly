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

// Database row types (as returned from SQLite)
export interface TodoRow {
  id: number;
  text: string;
  description: string | null;
  completed: number; // SQLite stores booleans as 0/1
  category_id: number | null;
  priority: number;
  due_date: number | null;
  created_at: number;
  updated_at: number;
}

export interface CategoryRow {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  created_at: number;
}

export interface TagRow {
  id: number;
  name: string;
  color: string;
  created_at: number;
}
