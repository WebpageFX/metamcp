import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const DEFAULT_DATABASE_URL = "file:./data/metamcp.db";

function sqliteFilePath(databaseUrl: string): string {
  if (/^(postgres(ql)?|mysql|mariadb):\/\//i.test(databaseUrl)) {
    throw new Error(
      `DATABASE_URL must be a SQLite file URL (e.g. file:/data/metamcp.db), got: ${databaseUrl}`,
    );
  }

  let withoutScheme = databaseUrl;
  if (databaseUrl.startsWith("file:")) {
    withoutScheme = databaseUrl.slice("file:".length);
  } else if (databaseUrl.startsWith("sqlite://")) {
    // sqlite:///abs/path or sqlite://./rel/path — strip scheme only
    withoutScheme = databaseUrl.slice("sqlite://".length);
  } else if (databaseUrl.startsWith("sqlite:")) {
    withoutScheme = databaseUrl.slice("sqlite:".length);
  }

  // file:///data/foo.db → /data/foo.db
  if (withoutScheme.startsWith("//")) {
    withoutScheme = withoutScheme.slice(1);
  }

  if (isAbsolute(withoutScheme)) {
    return withoutScheme;
  }

  return resolve(process.cwd(), withoutScheme);
}

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.SQLITE_DATABASE_URL ||
  DEFAULT_DATABASE_URL;
const sqlitePath = sqliteFilePath(databaseUrl);

mkdirSync(dirname(sqlitePath), { recursive: true });

const sqlite = new Database(sqlitePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("cache_size = -20000");
sqlite.pragma("mmap_size = 268435456");

export const db = drizzle(sqlite, { schema });
export const sqliteClient = sqlite;
