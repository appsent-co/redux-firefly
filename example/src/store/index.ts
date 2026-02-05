import { configureStore } from '@reduxjs/toolkit';
import { createFireflyMiddleware, hydrateFromDatabase, fireflyReducer } from 'redux-firefly';
import { db, initDatabase } from '../database/schema';
import todosReducer from './slices/todosSlice';
import categoriesReducer from './slices/categoriesSlice';
import tagsReducer from './slices/tagsSlice';
import type { Todo, Category, Tag } from '../types';

// Initialize database schema
initDatabase();

/**
 * Create Redux store with Firefly middleware and hydration
 * This demonstrates the complete setup including complex JOIN queries
 */
export async function createStore() {
  console.log('[Store] Creating store with Firefly middleware...');

  // Create Firefly middleware
  const fireflyMiddleware = createFireflyMiddleware({
    database: db,
    onError: (error, action) => {
      console.error('[Firefly Error]', {
        error: error.message,
        action: action.type,
        timestamp: new Date().toISOString(),
        stack: error.stack,
      });
    },
    debug: __DEV__,
  });

  try {
    // Hydrate initial state from database
    // This demonstrates complex JOIN queries and data transformation
    const preloadedState = await hydrateFromDatabase(db, {
      todos: {
        // Complex JOIN query to load todos with their categories and tags
        query: `
          SELECT
            t.id, t.text, t.description, t.completed,
            t.category_id, t.priority, t.due_date,
            t.created_at, t.updated_at,
            c.name as category_name, c.color as category_color,
            c.icon as category_icon, c.sort_order as category_sort_order,
            GROUP_CONCAT(tg.id || ':' || tg.name || ':' || tg.color) as tags_data
          FROM todos t
          LEFT JOIN categories c ON t.category_id = c.id
          LEFT JOIN todo_tags tt ON t.id = tt.todo_id
          LEFT JOIN tags tg ON tt.tag_id = tg.id
          GROUP BY t.id
          ORDER BY t.completed ASC, t.due_date ASC, t.created_at DESC
        `,
        transform: (rows): Todo[] => {
          return rows.map((row: any) => {
            // Parse tags from concatenated string
            const tags: Tag[] = [];
            if (row.tags_data) {
              const tagParts = row.tags_data.split(',');
              tagParts.forEach((part: string) => {
                const [id, name, color] = part.split(':');
                tags.push({
                  id: parseInt(id),
                  name,
                  color,
                });
              });
            }

            return {
              id: row.id,
              text: row.text,
              description: row.description,
              completed: Boolean(row.completed),
              categoryId: row.category_id,
              category: row.category_name
                ? {
                    id: row.category_id,
                    name: row.category_name,
                    color: row.category_color,
                    icon: row.category_icon,
                    sortOrder: row.category_sort_order,
                    createdAt: 0, // Not needed for display
                  }
                : null,
              tags,
              priority: row.priority as 1 | 2 | 3,
              dueDate: row.due_date,
              createdAt: row.created_at * 1000, // Convert to milliseconds
              updatedAt: row.updated_at * 1000,
            };
          });
        },
      },
      categories: {
        query: 'SELECT * FROM categories ORDER BY sort_order ASC, name ASC',
        transform: (rows): Category[] => {
          return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            color: row.color,
            icon: row.icon,
            sortOrder: row.sort_order,
            createdAt: row.created_at * 1000,
          }));
        },
      },
      tags: {
        query: 'SELECT * FROM tags ORDER BY name ASC',
        transform: (rows): Tag[] => {
          return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            color: row.color,
            createdAt: row.created_at * 1000,
          }));
        },
      },
    });

    console.log('[Store] Hydration complete:', {
      todos: (preloadedState.todos as Todo[]).length,
      categories: (preloadedState.categories as Category[]).length,
      tags: (preloadedState.tags as Tag[]).length,
    });

    // Create store with hydrated state
    const store = configureStore({
      reducer: {
        todos: todosReducer,
        categories: categoriesReducer,
        tags: tagsReducer,
        _firefly: fireflyReducer, // Required for FireflyGate
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
          serializableCheck: {
            // Ignore firefly metadata in actions
            ignoredActionPaths: ['meta.firefly'],
          },
        }).concat(fireflyMiddleware),
      preloadedState: {
        ...preloadedState,
        _firefly: { hydrated: true }, // Mark hydration as complete
      },
    });

    console.log('[Store] Store created successfully');
    return store;
  } catch (error) {
    console.error('[Store] Failed to create store:', error);
    throw error;
  }
}

// Export types for TypeScript
export type RootState = {
  todos: Todo[];
  categories: Category[];
  tags: Tag[];
  _firefly: { hydrated: boolean };
};

export type AppStore = Awaited<ReturnType<typeof createStore>>;
export type AppDispatch = AppStore['dispatch'];
