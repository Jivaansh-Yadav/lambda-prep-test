// One-off schema step for the "Trending today" section. This repo has no
// migration runner (see wiki/Database.md) — tables are created by hand — so
// this script is the record of exactly what was run in Neon.
//
//   bun scripts/create-resource-daily-views.mjs
//
// Safe to re-run: everything is IF NOT EXISTS.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const databaseUrl = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!databaseUrl) throw new Error('DATABASE_URL missing from .env');
const sql = neon(databaseUrl);

await sql.query(`
  CREATE TABLE IF NOT EXISTS resource_daily_views (
    file_id text NOT NULL,
    day date NOT NULL,
    view_count integer NOT NULL DEFAULT 0,
    class_slug text,
    subject text,
    source text,
    file_name text,
    PRIMARY KEY (file_id, day)
  )
`);

await sql.query(`
  CREATE INDEX IF NOT EXISTS resource_daily_views_day_class_idx
    ON resource_daily_views (day, class_slug, view_count DESC)
`);

const rows = await sql.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'resource_daily_views' ORDER BY ordinal_position`);
console.log('resource_daily_views columns:');
for (const row of rows) console.log(' -', row.column_name, row.data_type);
