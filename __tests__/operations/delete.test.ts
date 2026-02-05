import { executeDelete } from '../../src/operations/delete';
import type { DeleteEffect } from '../../src/types';

describe('executeDelete', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      runAsync: jest.fn(),
    };
  });

  it('should execute DELETE with correct SQL', async () => {
    mockDb.runAsync.mockResolvedValue({
      changes: 1,
    });

    const effect: DeleteEffect = {
      type: 'DELETE',
      table: 'todos',
      where: { id: 5 },
    };

    const result = await executeDelete(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'DELETE FROM todos WHERE id = ?',
      [5]
    );
    expect(result.success).toBe(true);
    expect(result.rowsAffected).toBe(1);
  });

  it('should handle multiple WHERE conditions', async () => {
    mockDb.runAsync.mockResolvedValue({
      changes: 3,
    });

    const effect: DeleteEffect = {
      type: 'DELETE',
      table: 'todos',
      where: { user_id: 1, completed: true },
    };

    const result = await executeDelete(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'DELETE FROM todos WHERE user_id = ? AND completed = ?',
      [1, true]
    );
    expect(result.rowsAffected).toBe(3);
  });

  it('should handle NULL values in WHERE clause', async () => {
    mockDb.runAsync.mockResolvedValue({
      changes: 2,
    });

    const effect: DeleteEffect = {
      type: 'DELETE',
      table: 'users',
      where: { deleted_at: null },
    };

    const result = await executeDelete(mockDb, effect);

    expect(mockDb.runAsync).toHaveBeenCalledWith(
      'DELETE FROM users WHERE deleted_at IS NULL',
      []
    );
    expect(result.success).toBe(true);
  });

  it('should handle errors gracefully', async () => {
    const dbError = new Error('Database error');
    mockDb.runAsync.mockRejectedValue(dbError);

    const effect: DeleteEffect = {
      type: 'DELETE',
      table: 'todos',
      where: { id: 1 },
    };

    const result = await executeDelete(mockDb, effect);

    expect(result.success).toBe(false);
    expect(result.error).toBe(dbError);
  });
});
