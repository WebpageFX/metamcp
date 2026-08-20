/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.SQLITE_DATABASE_URL || "file:./data/metamcp.db",
  },
});
