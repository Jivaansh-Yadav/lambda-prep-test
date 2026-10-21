import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";

// ---------------------------------------------------------------------
// Resource file feedback: a free-text companion to the 1-5 star rating
// (resource_ratings), shown just below it in the Resource Watch detail
// pane. Unlike a rating, feedback isn't a single "my score" value that
// gets upserted — every submission is its own row (table:
// resource_feedback), so a student can leave more than one note over
// time and the admin panel can review the full history.
//
// There's no sign-in system in this app, so feedback is stored with an
// optional per-browser voter id (see voter-id.ts) purely for potential
// future "your feedback" UI — it is never required and never used to
// gate or deduplicate submissions.
// ---------------------------------------------------------------------

const MAX_FEEDBACK_LENGTH = 2000;

// Light per-IP throttle so a single abusive client can't flood the table
// with junk rows. In-memory only (resets on deploy/restart) — same
// tradeoff as the admin passcode limiter in admin-server.ts: a brake on
// casual spam, not a hard security boundary.
const MAX_SUBMISSIONS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const submissionsByIp = new Map<string, { count: number; windowStart: number }>();

function getClientIp(): string {
  try {
    return getRequestIP({ xForwardedFor: true }) ?? "unknown";
  } catch {
    return "unknown";
  }
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const rec = submissionsByIp.get(ip);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    submissionsByIp.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_SUBMISSIONS;
}

export type SubmitResourceFeedbackResult = { ok: true } | { ok: false; reason: string };

/** Inserts one feedback entry for a resource file. Always succeeds with
 * `ok: false` (never throws) on misconfiguration, rate limiting, or a DB
 * error, so the UI can show a clear inline message instead of a crash. */
export const submitResourceFeedback = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { fileId?: unknown; voterId?: unknown; feedback?: unknown };
    if (typeof d?.fileId !== "string" || !d.fileId) throw new Error("Missing fileId");
    if (d.voterId !== undefined && typeof d.voterId !== "string") throw new Error("Invalid voterId");
    if (typeof d?.feedback !== "string") throw new Error("Missing feedback");
    const trimmed = d.feedback.trim();
    if (!trimmed) throw new Error("Feedback cannot be empty");
    if (trimmed.length > MAX_FEEDBACK_LENGTH) {
      throw new Error(`Feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer`);
    }
    return { fileId: d.fileId, voterId: d.voterId as string | undefined, feedback: trimmed };
  })
  .handler(async ({ data }): Promise<SubmitResourceFeedbackResult> => {
    if (!sql) return { ok: false, reason: "Feedback storage isn't configured." };

    if (isRateLimited(getClientIp())) {
      return { ok: false, reason: "Too many submissions — please try again later." };
    }

    try {
      await sql.query(
        `INSERT INTO resource_feedback (file_id, voter_id, feedback) VALUES ($1, $2, $3)`,
        [data.fileId, data.voterId ?? null, data.feedback]
      );
      return { ok: true };
    } catch (error) {
      console.error("[resource-feedback] failed to insert feedback", error);
      return { ok: false, reason: "Could not save your feedback. Try again." };
    }
  });
