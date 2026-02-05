import * as SQLite from 'expo-sqlite';

// Database instance - will be initialized in initDatabase()
export let db: SQLite.SQLiteDatabase;

/**
 * Initialize database schema and seed initial data
 */
export function initDatabase() {
  // Open database if not already open
  if (!db) {
    console.log('[Database] Opening database...');
    db = SQLite.openDatabaseSync('myapp.db');
  }

  console.log('[Database] Initializing schema...');

  // Create categories table
  db.execSync(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Create todos table with foreign key to categories
  db.execSync(`
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      description TEXT,
      completed INTEGER DEFAULT 0,
      category_id INTEGER,
      priority INTEGER DEFAULT 1,
      due_date INTEGER,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER DEFAULT (strftime('%s', 'now')),
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
  `);

  // Create tags table
  db.execSync(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now'))
    );
  `);

  // Create junction table for many-to-many relationship between todos and tags
  db.execSync(`
    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (todo_id, tag_id),
      FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

  // Create indexes for better query performance
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_todos_category ON todos(category_id);`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_todo_tags_todo ON todo_tags(todo_id);`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_todo_tags_tag ON todo_tags(tag_id);`);

  // Seed initial categories
  seedCategories();

  // Seed initial tags
  seedTags();

  // Seed sample todos
  seedSampleTodos();

  console.log('[Database] Schema initialized successfully');
}

/**
 * Seed initial categories
 */
function seedCategories() {
  const existingCategories = db.getAllSync('SELECT COUNT(*) as count FROM categories');
  if ((existingCategories[0] as any).count > 0) {
    console.log('[Database] Categories already seeded');
    return;
  }

  const categories = [
    { name: 'Work', color: '#007AFF', icon: '💼', sort_order: 0 },
    { name: 'Personal', color: '#34C759', icon: '🏠', sort_order: 1 },
    { name: 'Shopping', color: '#FF9500', icon: '🛒', sort_order: 2 },
    { name: 'Health', color: '#FF3B30', icon: '❤️', sort_order: 3 },
    { name: 'Learning', color: '#AF52DE', icon: '📚', sort_order: 4 },
  ];

  categories.forEach((cat) => {
    db.runSync(
      'INSERT INTO categories (name, color, icon, sort_order) VALUES (?, ?, ?, ?)',
      [cat.name, cat.color, cat.icon, cat.sort_order]
    );
  });

  console.log('[Database] Seeded categories');
}

/**
 * Seed initial tags
 */
function seedTags() {
  const existingTags = db.getAllSync('SELECT COUNT(*) as count FROM tags');
  if ((existingTags[0] as any).count > 0) {
    console.log('[Database] Tags already seeded');
    return;
  }

  const tags = [
    { name: 'Urgent', color: '#FF3B30' },
    { name: 'Important', color: '#FF9500' },
    { name: 'Quick', color: '#34C759' },
    { name: 'Routine', color: '#8E8E93' },
    { name: 'Goal', color: '#AF52DE' },
  ];

  tags.forEach((tag) => {
    db.runSync(
      'INSERT INTO tags (name, color) VALUES (?, ?)',
      [tag.name, tag.color]
    );
  });

  console.log('[Database] Seeded tags');
}

/**
 * Seed sample todos for demonstration
 */
function seedSampleTodos() {
  const existingTodos = db.getAllSync('SELECT COUNT(*) as count FROM todos');
  if ((existingTodos[0] as any).count > 0) {
    console.log('[Database] Todos already seeded');
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const dayInSeconds = 86400;

  const sampleTodos = [
    {
      text: 'Welcome to Redux Firefly!',
      description: 'This is a comprehensive example app demonstrating all redux-firefly features.',
      completed: 0,
      category_id: 2, // Personal
      priority: 2,
      due_date: null,
    },
    {
      text: 'Review quarterly goals',
      description: 'Analyze Q1 performance and set Q2 objectives',
      completed: 0,
      category_id: 1, // Work
      priority: 3,
      due_date: now + (2 * dayInSeconds),
    },
    {
      text: 'Buy groceries',
      description: 'Milk, eggs, bread, vegetables',
      completed: 0,
      category_id: 3, // Shopping
      priority: 1,
      due_date: now + dayInSeconds,
    },
    {
      text: 'Morning workout',
      description: '30 min cardio + stretching',
      completed: 1,
      category_id: 4, // Health
      priority: 2,
      due_date: now,
    },
    {
      text: 'Read Redux documentation',
      description: 'Study Redux Toolkit patterns',
      completed: 0,
      category_id: 5, // Learning
      priority: 2,
      due_date: now + (3 * dayInSeconds),
    },
  ];

  sampleTodos.forEach((todo) => {
    const result = db.runSync(
      `INSERT INTO todos (text, description, completed, category_id, priority, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        todo.text,
        todo.description,
        todo.completed,
        todo.category_id,
        todo.priority,
        todo.due_date,
        now,
        now,
      ]
    );

    // Add some tags to sample todos
    if (result.lastInsertRowId === 2) {
      // Work todo - add "Important" and "Urgent" tags
      db.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [2, 1]); // Urgent
      db.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [2, 2]); // Important
    } else if (result.lastInsertRowId === 3) {
      // Shopping todo - add "Quick" tag
      db.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [3, 3]); // Quick
    } else if (result.lastInsertRowId === 5) {
      // Learning todo - add "Goal" tag
      db.runSync('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)', [5, 5]); // Goal
    }
  });

  console.log('[Database] Seeded sample todos');
}

/**
 * Utility function to reset database (for development/testing)
 */
export function resetDatabase() {
  console.log('[Database] Resetting database...');

  db.execSync('DROP TABLE IF EXISTS todo_tags;');
  db.execSync('DROP TABLE IF EXISTS todos;');
  db.execSync('DROP TABLE IF EXISTS tags;');
  db.execSync('DROP TABLE IF EXISTS categories;');

  initDatabase();

  console.log('[Database] Database reset complete');
}
