import { neon } from "@neondatabase/serverless";

// Singleton Neon HTTP client. @neondatabase/serverless is the client Neon's
// own skill docs recommend for serverless/edge runtimes (no persistent TCP
// connection, works over fetch) — see .agents/skills/neon-postgres/SKILL.md.
const databaseUrl = process.env["DATABASE_URL"];

export const sql = databaseUrl ? neon(databaseUrl) : null;
