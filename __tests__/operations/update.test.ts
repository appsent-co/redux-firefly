import { executeUpdate } from '../../src/operations/update';
import type { UpdateEffect } from '../../src/types';

describe('executeUpdate', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      runAsync: jest.fn(),
    };
  });

  it('should execute UPDATE with correct SQL', async () => {
    mockDb.runAsync.mockResolvedValue({
      changes: 1,
    });

    const effect: UpdateEffect = {
      type: 'UPDATE',
      table: 'todos',
      values: { completed: 1 },
      where: { id: 5 },
    };

    const result = await executeUpdate(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE todos SET completed = ? WHERE id = ?',
      [1, 5]
    );
    expect(result.success).toBe(true);
    expect(result.rowsAffected).toBe(1);
  });

  it('should handle multiple SET columns', async () => {
    mockDb.runAsync.mockResolvedValue({
      changes: 1,
    });

    const effect: UpdateEffect = {
      type: 'UPDATE',
      table: 'users',
      values: { name: 'Jane', age: 25 },
      where: { id: 10 },
    };

    const result = await executeUpdate(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE users SET name = ?, age = ? WHERE id = ?',
      ['Jane', 25, 10]
    );
    expect(result.success).toBe(true);
  });

  it('should handle multiple WHERE conditions', async () => {
    mockDb.runAsync.mockResolvedValue({
      changes: 2,
    });

    const effect: UpdateEffect = {
      type: 'UPDATE',
      table: 'todos',
      values: { completed: 1 },
      where: { user_id: 1, completed: 0 },
    };

    const result = await executeUpdate(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE todos SET completed = ? WHERE user_id = ? AND completed = ?',
      [1, 1, 0]
    );
    expect(result.rowsAffected).toBe(2);
  });

  it('should handle NULL values in WHERE clause', async () => {
    mockDb.runAsync.mockResolvedValue({
      changes: 1,
    });

    const effect: UpdateEffect = {
      type: 'UPDATE',
      table: 'users',
      values: { active: false },
      where: { deleted_at: null },
    };

    const result = await executeUpdate(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'UPDATE users SET active = ? WHERE deleted_at IS NULL',
      [false]
    );
    expect(result.success).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    const dbError = new Error('Database error');
    mockDb.runAsync.mockRejectedValue(dbError);

    const effect: UpdateEffect = {
      type: 'UPDATE',
      table: 'todos',
      values: { completed: 1 },
      where: { id: 1 },
    };

    const result = await executeUpdate(mockDb, effect);

    expect(result.success).toBe(false);
    expect(result.error).toBe(dbError);
  });
});
