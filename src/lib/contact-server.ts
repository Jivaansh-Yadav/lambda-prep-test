import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";
import { requirePasscode } from "./admin-server";

// ---------------------------------------------------------------------
// Footer "Send us a message" contact form: a lightweight way for any
// visitor to reach the Lambda Prep team without needing to know a
// Discord/Reddit handle. Every submission becomes one row in Neon
// (table: contact_messages) for the admin to read later — no email is
// sent automatically, this is just durable storage + an admin read
// surface, mirroring resource_contributions in contribute-server.ts.
// ---------------------------------------------------------------------

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320; // RFC 5321 max mailbox length
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_SOCIAL_HANDLE_LENGTH = 200;

// Light per-IP throttle — same shape as the contribute-server limiter: a
// brake on casual spam/abuse, not a hard security boundary. In-memory
// only, resets on deploy/restart.
const MAX_SUBMISSIONS = 5;
const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
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

// Deliberately permissive (not a strict RFC 5322 implementation) — just
// enough to catch obvious typos ("name without an @ or domain") without
// rejecting real addresses a stricter regex might choke on.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactMessageInput = {
  name: string;
  email: string;
  subject: string;
  message: string;
  /** Optional Discord/Reddit handle — lets the team reach out on-platform
   * if a reply there is easier than email. Empty string when omitted. */
  socialHandle: string;
};

function validateContactMessage(d: Record<string, unknown>): ContactMessageInput {
  const name = typeof d["name"] === "string" ? d["name"].trim() : "";
  const email = typeof d["email"] === "string" ? d["email"].trim() : "";
  const subject = typeof d["subject"] === "string" ? d["subject"].trim() : "";
  const message = typeof d["message"] === "string" ? d["message"].trim() : "";
  const socialHandle = typeof d["socialHandle"] === "string" ? d["socialHandle"].trim() : "";

  if (!name) throw new Error("Name is required.");
  if (name.length > MAX_NAME_LENGTH) throw new Error("Name is too long.");
  if (!email) throw new Error("Email is required.");
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw new Error("Please enter a valid email address.");
  }
  if (!subject) throw new Error("Subject is required.");
  if (subject.length > MAX_SUBJECT_LENGTH) throw new Error("Subject is too long.");
  if (!message) throw new Error("Message is required.");
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }
  if (socialHandle.length > MAX_SOCIAL_HANDLE_LENGTH) throw new Error("Discord/Reddit handle is too long.");

  return { name, email, subject, message, socialHandle };
}

export type SubmitContactMessageResult = { ok: true; id: number } | { ok: false; reason: string };

/** Saves a footer "Send us a message" submission. Never touches email —
 * the admin reads these from the database (see getAdminContactMessages
 * below) rather than being notified in real time. */
export const submitContactMessage = createServerFn({ method: "POST" })
  .validator((data: unknown) => validateContactMessage(data as Record<string, unknown>))
  .handler(async ({ data }): Promise<SubmitContactMessageResult> => {
    if (!sql) return { ok: false, reason: "Messaging isn't configured right now." };
    if (isRateLimited(getClientIp())) {
      return { ok: false, reason: "Too many messages sent — please try again later." };
    }

    try {
      const rows = await sql.query(
        `INSERT INTO contact_messages (name, email, subject, message, social_handle)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [data.name, data.email, data.subject, data.message, data.socialHandle || null]
      );
      const row = rows[0] as { id: number } | undefined;
      return { ok: true, id: Number(row?.id ?? 0) };
    } catch (error) {
      console.error("[contact] failed to insert message", error);
      return { ok: false, reason: "Could not send your message. Try again." };
    }
  });

// ---------------------------------------------------------------------
// Admin-facing read surface, same requirePasscode() gate as every other
// admin read (see contribute-server.ts / admin-server.ts). Lets the
// admin review submitted messages from /admin without needing direct
// database access.
// ---------------------------------------------------------------------

export type ContactMessageStatus = "unread" | "read" | "archived";

export type AdminContactMessageRow = {
  id: number;
  createdAt: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: ContactMessageStatus;
  adminNotes: string | null;
  socialHandle: string | null;
};

export type AdminContactMessagesResult =
  | { configured: true; messages: AdminContactMessageRow[] }
  | { configured: false; reason: string };

function mapContactMessageRow(r: Record<string, unknown>): AdminContactMessageRow {
  return {
    id: Number(r["id"]),
    createdAt: r["created_at"] as string,
    name: r["name"] as string,
    email: r["email"] as string,
    subject: r["subject"] as string,
    message: r["message"] as string,
    status: r["status"] as ContactMessageStatus,
    adminNotes: (r["admin_notes"] as string | null) ?? null,
    socialHandle: (r["social_handle"] as string | null) ?? null,
  };
}

export const getAdminContactMessages = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<AdminContactMessagesResult> => {
    requirePasscode(data.passcode);

    if (!sql) {
      return { configured: false, reason: "Database isn't configured (missing DATABASE_URL)." };
    }

    try {
      const rows = await sql.query(
        `SELECT id, created_at, name, email, subject, message, status, admin_notes, social_handle
         FROM contact_messages
         ORDER BY created_at DESC`
      );
      return { configured: true, messages: (rows as Record<string, unknown>[]).map(mapContactMessageRow) };
    } catch (error) {
      return {
        configured: false,
        reason: `Could not load messages: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

export type UpdateContactMessageStatusResult = { ok: true } | { ok: false; reason: string };

export const updateContactMessageStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; id?: unknown; status?: unknown; adminNotes?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (typeof d?.id !== "number") throw new Error("Missing id");
    if (d.status !== "unread" && d.status !== "read" && d.status !== "archived") {
      throw new Error("Invalid status");
    }
    if (d.adminNotes !== undefined && typeof d.adminNotes !== "string") throw new Error("Invalid adminNotes");
    return { passcode: d.passcode, id: d.id, status: d.status, adminNotes: d.adminNotes as string | undefined };
  })
  .handler(async ({ data }): Promise<UpdateContactMessageStatusResult> => {
    requirePasscode(data.passcode);

    if (!sql) return { ok: false, reason: "Database isn't configured." };

    try {
      await sql.query(
        `UPDATE contact_messages
         SET status = $1, admin_notes = $2, reviewed_at = now()
         WHERE id = $3`,
        [data.status, data.adminNotes ?? null, data.id]
      );
      return { ok: true };
    } catch (error) {
      console.error("[contact] failed to update status", error);
      return { ok: false, reason: "Could not update the status. Try again." };
    }
  });
