import * as SQLite from 'expo-sqlite';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from '../../../../drizzle/migrations';

// Open expo-sqlite database
const expoDb = SQLite.openDatabaseSync('myapp.db');

// Create drizzle database instance
export const db = drizzle(expoDb);

/**
 * Initialize database schema and seed initial data
 */
export function initDatabase() {
  console.log('[Database] Initializing schema...');

  migrate(db, migrations);

  seedCategories();
  seedTags();
  seedSampleTodos();

  console.log('[Database] Schema initialized successfully');
}

function seedCategories() {
  const existing = expoDb.getAllSync('SELECT COUNT(*) as count FROM categories');
  if ((existing[0] as any).count > 0) return;

  const data = [
    { name: 'Work', color: '#007AFF', icon: '💼', sortOrder: 0 },
    { name: 'Personal', color: '#34C759', icon: '🏠', sortOrder: 1 },
    { name: 'Shopping', color: '#FF9500', icon: '🛒', sortOrder: 2 },
    { name: 'Health', color: '#FF3B30', icon: '❤️', sortOrder: 3 },
    { name: 'Learning', color: '#AF52DE', icon: '📚', sortOrder: 4 },
  ];

  data.forEach((cat) => {
    expoDb.runSync(
      'INSERT INTO categories (name, color, icon, sort_order) VALUES (?, ?, ?, ?)',
      [cat.name, cat.color, cat.icon, cat.sortOrder]
    );
  });

  console.log('[Database] Seeded categories');
}

function seedTags() {
  const existing = expoDb.getAllSync('SELECT COUNT(*) as count FROM tags');
  if ((existing[0] as any).count > 0) return;

  const data = [
    { name: 'Urgent', color: '#FF3B30' },
    { name: 'Important', color: '#FF9500' },
    { name: 'Quick', color: '#34C759' },
    { name: 'Routine', color: '#8E8E93' },
    { name: 'Goal', color: '#AF52DE' },
  ];

  data.forEach((tag) => {
    expoDb.runSync('INSERT INTO tags (name, color) VALUES (?, ?)', [tag.name, tag.color]);
  });

  console.log('[Database] Seeded tags');
}

function seedSampleTodos() {
  const existing = expoDb.getAllSync('SELECT COUNT(*) as count FROM todos');
  if ((existing[0] as any).count > 0) return;

  const now = Math.floor(Date.now() / 1000);
  const dayInSeconds = 86400;

  const sampleTodos = [
    { text: 'Welcome to Redux Firefly!', description: 'This is a comprehensive example app demonstrating all redux-firefly features.', completed: 0, category_id: 2, priority: 2, due_date: null },
    { text: 'Review quarterly goals', description: 'Analyze Q1 performance and set Q2 objectives', completed: 0, category_id: 1, priority: 3, due_date: now + (2 * dayInSeconds) },
    { text: 'Buy groceries', description: 'Milk, eggs, bread, vegetables', completed: 0, category_id: 3, priority: 1, due_date: now + dayInSeconds },
    { text: 'Morning workout', description: '30 min cardio + stretching', completed: 1, category_id: 4, priority: 2, due_date: now },
    { text: 'Read Redux documentation', description: 'Study Redux Toolkit patterns', completed: 0, category_id: 5, priority: 2, due_date: now + (3 * dayInSeconds) },
  ];

  sampleTodos.forEach((todo) => {
    const result = expoDb.runSync(
      `INSERT INTO todos (text, description, completed, category_id, priority, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [todo.text, todo.description, todo.completed, todo.category_id, todo.priority, todo.due_date, now, now]
    );

    if (result.lastInsertRowId === 2) {
      expoDb.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [2, 1]);
      expoDb.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [2, 2]);
    } else if (result.lastInsertRowId === 3) {
      expoDb.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [3, 3]);
    } else if (result.lastInsertRowId === 5) {
      expoDb.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [5, 5]);
    }
  });

  console.log('[Database] Seeded sample todos');
}

export function resetDatabase() {
  console.log('[Database] Resetting database...');

  expoDb.execSync('DROP TABLE IF EXISTS todo_tags;');
  expoDb.execSync('DROP TABLE IF EXISTS todos;');
  expoDb.execSync('DROP TABLE IF EXISTS tags;');
  expoDb.execSync('DROP TABLE IF EXISTS categories;');

  initDatabase();

  console.log('[Database] Database reset complete');
}
