import { executeSelect } from '../../src/operations/select';
import type { SelectEffect } from '../../src/types';

describe('executeSelect', () => {
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      getAllAsync: jest.fn(),
    };
  });

  it('should execute SELECT with all defaults', async () => {
    const mockRows = [{ id: 1, text: 'Todo 1' }, { id: 2, text: 'Todo 2' }];
    mockDb.getAllAsync.mockResolvedValue(mockRows);

    const effect: SelectEffect = {
      type: 'SELECT',
      table: 'todos',
    };

    const result = await executeSelect(mockDb, effect);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      'SELECT * FROM todos',
      []
    );
    expect(result.success).toBe(true);
    expect(result.rows).toEqual(mockRows);
  });

  it('should handle specific columns', async () => {
    const mockRows = [{ id: 1, text: 'Todo 1' }];
    mockDb.getAllAsync.mockResolvedValue(mockRows);

    const effect: SelectEffect = {
      type: 'SELECT',
      table: 'todos',
      columns: ['id', 'text'],
    };

    const result = await executeSelect(mockDb, effect);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      'SELECT id, text FROM todos',
      []
    );
    expect(result.rows).toEqual(mockRows);
  });

  it('should handle WHERE clause', async () => {
    const mockRows = [{ id: 1, text: 'Todo 1', completed: 0 }];
    mockDb.getAllAsync.mockResolvedValue(mockRows);

    const effect: SelectEffect = {
      type: 'SELECT',
      table: 'todos',
      where: { completed: 0 },
    };

    const result = await executeSelect(mockDb, effect);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      'SELECT * FROM todos WHERE completed = ?',
      [0]
    );
    expect(result.success).toBe(true);
  });

  it('should handle ORDER BY', async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    const effect: SelectEffect = {
      type: 'SELECT',
      table: 'todos',
      orderBy: 'created_at DESC',
    };

    const result = await executeSelect(mockDb, effect);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      'SELECT * FROM todos ORDER BY created_at DESC',
      []
    );
    expect(result.success).toBe(true);
  });

  it('should handle LIMIT', async () => {
    mockDb.getAllAsync.mockResolvedValue([]);

    const effect: SelectEffect = {
      type: 'SELECT',
      table: 'todos',
      limit: 10,
    };

    const result = await executeSelect(mockDb, effect);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      'SELECT * FROM todos LIMIT 10',
      []
    );
    expect(result.success).toBe(true);
  });

  it('should handle complex query with all options', async () => {
    const mockRows = [{ id: 1, text: 'Todo 1' }];
    mockDb.getAllAsync.mockResolvedValue(mockRows);

    const effect: SelectEffect = {
      type: 'SELECT',
      table: 'todos',
      columns: ['id', 'text', 'completed'],
      where: { user_id: 1, completed: 0 },
      orderBy: 'created_at DESC',
      limit: 5,
    };

    const result = await executeSelect(mockDb, effect);

    expect(mockDb.getAllAsync).toHaveBeenCalledWith(
      'SELECT id, text, completed FROM todos WHERE user_id = ? AND completed = ? ORDER BY created_at DESC LIMIT 5',
      [1, 0]
    );
    expect(result.rows).toEqual(mockRows);
  });

  it('should handle errors gracefully', async () => {
    const dbError = new Error('Database error');
    mockDb.getAllAsync.mockRejectedValue(dbError);

    const effect: SelectEffect = {
      type: 'SELECT',
      table: 'todos',
    };

    const result = await executeSelect(mockDb, effect);

    expect(result.success).toBe(false);
    expect(result.error).toBe(dbError);
  });
});
