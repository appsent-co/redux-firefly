import { executeRaw } from '../../src/operations/raw';
import type { RawEffect } from '../../src/types';

describe('executeRaw', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      getAllAsync: jest.fn(),
      runAsync: jest.fn(),
    };
  });

  describe('SELECT queries', () => {
    it('should execute SELECT query and return rows', async () => {
      const mockRows = [{ id: 1, text: 'Todo 1' }];
      mockDb.getAllAsync.mockResolvedValue(mockRows);

      const effect: RawEffect = {
        type: 'RAW',
        sql: 'SELECT * FROM todos WHERE id = ?',
        params: [1],
      };

      const result = await executeRaw(mockDb, effect);

      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        'SELECT * FROM todos WHERE id = ?',
        [1]
      );
      expect(result.success).toBe(true);
      expect(result.rows).toEqual(mockRows);
    });

    it('should handle SELECT without params', async () => {
      mockDb.getAllAsync.mockResolvedValue([]);

      const effect: RawEffect = {
        type: 'RAW',
        sql: 'SELECT * FROM todos',
      };

      const result = await executeRaw(mockDb, effect);

      expect(mockDb.getAllAsync).toHaveBeenCalledWith(
        'SELECT * FROM todos',
        []
      );
      expect(result.success).toBe(true);
    });
  });

  describe('Mutation queries', () => {
    it('should execute INSERT and return insertId', async () => {
      mockDb.runAsync.mockResolvedValue({
        lastInsertRowId: 5,
        changes: 1,
      });

      const effect: RawEffect = {
        type: 'RAW',
        sql: 'INSERT INTO todos (text, completed) VALUES (?, ?)',
        params: ['Buy milk', 0],
      };

      const result = await executeRaw(mockDb, effect);

      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'INSERT INTO todos (text, completed) VALUES (?, ?)',
        ['Buy milk', 0]
      );
      expect(result.success).toBe(true);
      expect(result.insertId).toBe(5);
      expect(result.rowsAffected).toBe(1);
    });

    it('should execute UPDATE and return rowsAffected', async () => {
      mockDb.runAsync.mockResolvedValue({
        lastInsertRowId: 0,
        changes: 3,
      });

      const effect: RawEffect = {
        type: 'RAW',
        sql: 'UPDATE todos SET completed = 1 WHERE user_id = ?',
        params: [1],
      };

      const result = await executeRaw(mockDb, effect);

      expect(mockDb.runAsync).toHaveBeenCalledWith(
        'UPDATE todos SET completed = 1 WHERE user_id = ?',
        [1]
      );
      expect(result.rowsAffected).toBe(3);
    });

    it('should execute DELETE', async () => {
      mockDb.runAsync.mockResolvedValue({
        lastInsertRowId: 0,
        changes: 2,
      });

      const effect: RawEffect = {
        type: 'RAW',
        sql: 'DELETE FROM todos WHERE completed = 1',
      };

      const result = await executeRaw(mockDb, effect);

      expect(result.success).toBe(true);
      expect(result.rowsAffected).toBe(2);
    });
  });

  it('should handle errors gracefully', async () => {
    const dbError = new Error('SQL syntax error');
    mockDb.getAllAsync.mockRejectedValue(dbError);

    const effect: RawEffect = {
      type: 'RAW',
      sql: 'SELECT * FROM invalid_table',
    };

    const result = await executeRaw(mockDb, effect);

    expect(result.success).toBe(false);
    expect(result.error).toBe(dbError);
  });
});
