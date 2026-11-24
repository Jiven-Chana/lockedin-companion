/**
 * The relay's storage: the small part of Cloudflare D1's API the relay
 * uses, so the same code runs on D1 in production and on node:sqlite in
 * the tests (tests/companion-relay.test.ts). D1 is SQLite.
 */

export interface Stmt {
	bind(...values: unknown[]): Stmt;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<{ meta: { changes: number } }>;
}

export interface Db {
	prepare(sql: string): Stmt;
	batch(stmts: Stmt[]): Promise<unknown[]>;
}
