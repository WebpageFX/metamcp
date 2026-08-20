import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  splitting: false,
  bundle: true,
  keepNames: true,
  minify: false,
  external: [
    "@modelcontextprotocol/sdk",
    // Bundle @repo/* into dist so Docker deploy does not need workspace package dist/
    "@trpc/server",
    "basic-auth",
    "better-auth",
    "better-sqlite3",
    "cors",
    "dotenv",
    "drizzle-orm",
    "express",
    "helmet",
    "nanoid",
    "shell-quote",
    "spawn-rx",
    "zod",
  ],
});
