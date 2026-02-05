import { executeInsert } from '../../src/operations/insert';
import type { InsertEffect } from '../../src/types';

describe('executeInsert', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      runAsync: jest.fn(),
    };
  });

  it('should execute INSERT with correct SQL', async () => {
    mockDb.runAsync.mockResolvedValue({
      lastInsertRowId: 1,
      changes: 1,
    });

    const effect: InsertEffect = {
      type: 'INSERT',
      table: 'todos',
      values: { text: 'Buy milk', completed: 0 },
    };

    const result = await executeInsert(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'INSERT INTO todos (text, completed) VALUES (?, ?)',
      ['Buy milk', 0]
    );
    expect(result.success).toBe(true);
    expect(result.insertId).toBe(1);
    expect(result.rowsAffected).toBe(1);
  });

  it('should handle multiple columns', async () => {
    mockDb.runAsync.mockResolvedValue({
      lastInsertRowId: 2,
      changes: 1,
    });

    const effect: InsertEffect = {
      type: 'INSERT',
      table: 'users',
      values: { name: 'John', email: 'john@example.com', age: 30 },
    };

    const result = await executeInsert(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'INSERT INTO users (name, email, age) VALUES (?, ?, ?)',
      ['John', 'john@example.com', 30]
    );
    expect(result.success).toBe(true);
    expect(result.insertId).toBe(2);
  });

  it('should handle errors gracefully', async () => {
    const dbError = new Error('Database error');
    mockDb.runAsync.mockRejectedValue(dbError);

    const effect: InsertEffect = {
      type: 'INSERT',
      table: 'todos',
      values: { text: 'Test' },
    };

    const result = await executeInsert(mockDb, effect);

    expect(result.success).toBe(false);
    expect(result.error).toBe(dbError);
  });
});
