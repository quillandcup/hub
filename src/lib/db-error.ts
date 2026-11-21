/** Postgres' statement_timeout error (the 8s limit on the API roles). */
const STATEMENT_TIMEOUT = "57014";

/** A database error with the section it came from, as a real Error (Supabase's are plain objects with no stack). */
export class DbQueryError extends Error {
  readonly code: string | undefined;
  readonly section: string;

  constructor(section: string, cause: unknown) {
    const { code, message } = (cause ?? {}) as { code?: string; message?: string };
    super(`${section}: ${message ?? String(cause)}${code ? ` (${code})` : ""}`, { cause });
    this.name = code === STATEMENT_TIMEOUT ? "DbStatementTimeout" : "DbQueryError";
    this.code = code;
    this.section = section;
  }
}

/** Throws a Supabase `error` as a DbQueryError naming `section`; does nothing when there is none. */
export function throwIfDbError(section: string, error: unknown): void {
  if (error) throw new DbQueryError(section, error);
}

