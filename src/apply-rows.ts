import type { ApplyRowsChanges, ApplyRowsConfig, MergedRow, MergedValue } from './types';

/**
 * Default row identity: the decoded primary key. A composite key (array) is
 * joined with ` ` into a stable string; a single-column key is used as-is.
 * `bigint`/`Uint8Array` keys are stringified so they compare by value.
 */
function defaultRowId(row: MergedRow): string | number {
  const key = row.key;
  if (Array.isArray(key)) return key.map(scalarId).join(' ');
  return scalarId(key);
}

function scalarId(v: MergedValue): string | number {
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return v.toString();
  if (v == null) return 'null';
  // Uint8Array (BLOB pk) — hex so equal bytes compare equal.
  let s = '';
  for (const b of v) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Options for {@link listApply}. */
export interface ListApplyOptions<Item> {
  /** Map a merged row to the list item shape stored in state. */
  toItem: (row: MergedRow) => Item;
  /** Stable id of an item already in state (used to match/replace on upsert). */
  getId: (item: Item) => string | number;
  /**
   * Stable id derived from a merged row (used to match items to remove on
   * delete, and to find the existing item to replace on upsert). Defaults to the
   * row's decoded primary key. Must agree with `getId(toItem(row))`.
   */
  rowId?: (row: MergedRow) => string | number;
  /**
   * The state property holding the item array (e.g. `'items'`). Omit when the
   * slice state **is** the array.
   */
  listKey?: string;
}

/**
 * A convenience builder for the common "slice holds a list of items" shape.
 * Returns an {@link ApplyRowsConfig.apply} that:
 *  - **upserts** each row in `changes.upserts`: replaces the existing item with
 *    the same id, or appends it when new (preserving order, new items at the end);
 *  - **removes** each row in `changes.deletes` by id.
 *
 * Reads/writes the array at `state[listKey]` (or treats `state` itself as the
 * array when `listKey` is omitted). Returns a new state object (or array) only
 * when something changed, otherwise the original reference.
 *
 * For non-list state shapes (maps keyed by id, nested objects, aggregates),
 * skip this builder and write the `apply` reducer by hand:
 * `(state, { upserts, deletes }) => nextState`.
 *
 * @example
 * // State shape: { items: Todo[] }
 * const todosReducer = applyRows(todosSlice.reducer, {
 *   table: 'todos',
 *   apply: listApply<Todo>({
 *     toItem: (row) => ({ id: String(row.key), text: String(row.columns.text) }),
 *     getId: (todo) => todo.id,
 *     listKey: 'items', // omit when the slice state IS the array
 *   }),
 * });
 *
 * @example
 * // Items keyed by a `uuid` column instead of the table's primary key:
 * listApply<Todo>({
 *   toItem: (row) => ({ id: String(row.columns.uuid), text: String(row.columns.text) }),
 *   getId: (todo) => todo.id,
 *   rowId: (row) => String(row.columns.uuid), // must agree with getId(toItem(row))
 * });
 */
export function listApply<Item, State = any>(
  opts: ListApplyOptions<Item>,
): ApplyRowsConfig<State>['apply'] {
  const { toItem, getId, rowId = defaultRowId, listKey } = opts;

  return (state: State, changes: ApplyRowsChanges): State => {
    const current = readList<Item>(state, listKey);
    if (changes.upserts.length === 0 && changes.deletes.length === 0) return state;

    // Index current items by id for O(1) replace/remove.
    const byId = new Map<string | number, number>();
    const next: Item[] = current.slice();
    for (let i = 0; i < next.length; i++) byId.set(getId(next[i]!), i);

    for (const row of changes.upserts) {
      const id = rowId(row);
      const item = toItem(row);
      const at = byId.get(id);
      if (at === undefined) {
        byId.set(id, next.length);
        next.push(item);
      } else {
        next[at] = item;
      }
    }

    if (changes.deletes.length > 0) {
      const removeIds = new Set<string | number>();
      for (const row of changes.deletes) removeIds.add(rowId(row));
      // Filter out deleted ids (skip if an id was also upserted this batch).
      for (const row of changes.upserts) removeIds.delete(rowId(row));
      if (removeIds.size > 0) {
        const filtered = next.filter((item) => !removeIds.has(getId(item)));
        return writeList(state, listKey, filtered) as State;
      }
    }

    return writeList(state, listKey, next) as State;
  };
}

function readList<Item>(state: any, listKey?: string): Item[] {
  if (listKey === undefined) {
    return Array.isArray(state) ? (state as Item[]) : [];
  }
  const v = state?.[listKey];
  return Array.isArray(v) ? (v as Item[]) : [];
}

function writeList(state: any, listKey: string | undefined, list: any[]): any {
  if (listKey === undefined) return list;
  return { ...state, [listKey]: list };
}
