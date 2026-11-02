export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  APP_ORIGIN?: string;
}

/** Обёртка над D1: считает обращения к хранилищу за запрос. */
export class Store {
  ops = 0;
  constructor(public db: D1Database) {}
  stmt(sql: string, ...args: unknown[]) { return this.db.prepare(sql).bind(...args); }
  async first<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T | null> {
    this.ops++; return (await this.stmt(sql, ...args).first<T>()) ?? null;
  }
  async all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T[]> {
    this.ops++; return (await this.stmt(sql, ...args).all<T>()).results;
  }
  async run(sql: string, ...args: unknown[]) {
    this.ops++; return this.stmt(sql, ...args).run();
  }
  /** Атомарная пачка (одна транзакция D1). Считается как одно обращение. */
  async batch(stmts: D1PreparedStatement[]) {
    if (!stmts.length) return [];
    this.ops++; return this.db.batch(stmts);
  }
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public headers: Record<string, string> = {}) { super(message); }
}
