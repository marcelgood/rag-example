// Runs SQL written by the LLM against the sales database, safely.
//
// Never trust SQL that a model wrote. Three layers of protection:
//  1. The connection is opened read-only, so SQLite itself refuses writes.
//  2. An authorizer allows only reading: no ATTACH (which could open other
//     database files), no PRAGMA, no schema changes.
//  3. At most `sqlMaxRows` rows go back to the model.
// In a production database you would also use a database user that only
// has SELECT rights on the allowed tables, and set a query timeout.

import { DatabaseSync, constants } from 'node:sqlite';
import { config } from '../config.ts';

const ALLOWED_ACTIONS = new Set([
  constants.SQLITE_SELECT, // a SELECT statement
  constants.SQLITE_READ, // reading a column of a table
  constants.SQLITE_FUNCTION, // calling a function such as COUNT() or strftime()
  constants.SQLITE_RECURSIVE, // WITH RECURSIVE queries
]);

let db: DatabaseSync | undefined;

function openReadOnly(): DatabaseSync {
  if (!db) {
    db = new DatabaseSync(config.sqlDbPath, { readOnly: true });
    db.setAuthorizer((action) => (ALLOWED_ACTIONS.has(action) ? constants.SQLITE_OK : constants.SQLITE_DENY));
  }
  return db;
}

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Number of rows the query returned before the row limit was applied. */
  totalRows: number;
  truncated: boolean;
};

/**
 * Run one read-only SQL statement. Throws if the SQL is invalid or not allowed.
 * Only the first statement is compiled; anything after a `;` is ignored.
 */
export function runQuery(sql: string): QueryResult {
  const statement = openReadOnly().prepare(sql);
  const columns = statement.columns().map((c) => c.name);
  const allRows = statement.all();
  return {
    columns,
    rows: allRows.slice(0, config.sqlMaxRows),
    totalRows: allRows.length,
    truncated: allRows.length > config.sqlMaxRows,
  };
}
