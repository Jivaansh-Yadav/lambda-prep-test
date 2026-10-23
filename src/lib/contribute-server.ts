import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { sql } from "./db";
import {
  getDriveIntegrationConfig,
  uploadDriveFile,
  type DriveFileEntry,
} from "./drive-integration-server";
import { requirePasscode } from "./admin-server";

// ---------------------------------------------------------------------
// Community "Contribute a resource" flow: lets any visitor submit a
// study-material file (or a link to one already on Drive) for the admin
// to review and fold into the real resource datasets. Every submission
// becomes one row in Neon (table: resource_contributions) — never
// written straight into the live resource JSON — so nothing public-facing
// changes until an admin reviews it from the "Manage resources" panel.
//
// Two submission paths, both land in the same table:
//   - "upload": the file itself is uploaded straight into the Drive
//     "Contributions" folder (CONTRIBUTIONS_FOLDER_ID below) via the same
//     uploadDriveFile() the admin's own Manage Resources panel uses, and
//     the table row records the resulting drive_file_id/drive_file_link.
//   - "drive_link": the contributor already has the file somewhere in
//     Drive (their own copy) and just pastes a shareable link instead of
//     fighting an upload — the table row records shared_drive_link with
//     no Drive write on our side at all.
// ---------------------------------------------------------------------

// The Drive folder contributions get uploaded into — a fixed subfolder of
// the same Drive tree the admin's Manage Resources panel already reads
// from (see drive-integration-server.ts), kept separate from the root so
// unreviewed submissions never mix with the live, crawled resource
// folders (ICSE/ISC class folders, Doxxmarks, etc.).
const CONTRIBUTIONS_FOLDER_ID = "1X5rsacL42GgcwllB2VTSE1NYkWEVll-f";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // mirrors the admin upload limit
const MAX_TEXT_LENGTH = 2000;
const MAX_ALIAS_LENGTH = 200;
const MAX_CONTACT_LENGTH = 300;

// Light per-IP throttle — same shape as the resource-feedback limiter:
// a brake on casual spam/abuse, not a hard security boundary. In-memory
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

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Formats a Date as "YYYY-MM-DD HH-mm-ss" for embedding in a filename —
// no colons or slashes, which Drive (and most filesystems) tolerate fine
// but look odd/break on some clients.
function formatTimestampForFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

// Every file actually written to the Drive "Contributions" folder gets a
// "{contributor's file name} - {submission date+time}" name, so the
// admin can tell submissions apart in Drive itself even when several
// contributors reuse the same generic file name (e.g. "Notes.pdf").
// Keeps the original extension intact when there is one.
function withContributionTimestamp(fileName: string, when: Date): string {
  const stamp = formatTimestampForFilename(when);
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex > 0 && dotIndex < fileName.length - 1) {
    return `${fileName.slice(0, dotIndex)} - ${stamp}${fileName.slice(dotIndex)}`;
  }
  return `${fileName} - ${stamp}`;
}

export type ContributeDetails = {
  fileName: string;
  classSlug: string;
  classLabel: string;
  subject: string;
  description: string;
  contributorAlias: string;
  contactMethod: string;
};

function validateDetails(d: Record<string, unknown>): ContributeDetails {
  const fileName = typeof d["fileName"] === "string" ? d["fileName"].trim() : "";
  const classSlug = typeof d["classSlug"] === "string" ? d["classSlug"].trim() : "";
  const classLabel = typeof d["classLabel"] === "string" ? d["classLabel"].trim() : "";
  const subject = typeof d["subject"] === "string" ? d["subject"].trim() : "";
  const description = typeof d["description"] === "string" ? d["description"].trim() : "";
  const contributorAlias = typeof d["contributorAlias"] === "string" ? d["contributorAlias"].trim() : "";
  const contactMethod = typeof d["contactMethod"] === "string" ? d["contactMethod"].trim() : "";

  if (!fileName) throw new Error("File name is required.");
  if (!classSlug) throw new Error("Class is required.");
  if (!subject) throw new Error("Subject is required.");
  if (!contactMethod) throw new Error("A way to reach you is required.");
  if (description.length > MAX_TEXT_LENGTH) throw new Error(`Description must be ${MAX_TEXT_LENGTH} characters or fewer.`);
  if (contributorAlias.length > MAX_ALIAS_LENGTH) throw new Error("Alias is too long.");
  if (contactMethod.length > MAX_CONTACT_LENGTH) throw new Error("Contact details are too long.");

  return { fileName, classSlug, classLabel, subject, description, contributorAlias, contactMethod };
}

export type SubmitContributionResult =
  | { ok: true; id: number }
  | { ok: false; reason: string };

/**
 * Path 1: contributor uploads the actual file. Uploads it into the Drive
 * Contributions folder (same write path the admin panel's own uploader
 * uses) and records the resulting file in resource_contributions with
 * status 'pending'. Never touches the live resource datasets.
 */
export const submitContributionUpload = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected FormData");
    const file = data.get("file");
    if (!(file instanceof File)) throw new Error("Missing file");
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`File is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`);
    }
    const details = validateDetails({
      fileName: data.get("fileName") ?? file.name,
      classSlug: data.get("classSlug"),
      classLabel: data.get("classLabel"),
      subject: data.get("subject"),
      description: data.get("description"),
      contributorAlias: data.get("contributorAlias"),
      contactMethod: data.get("contactMethod"),
    });
    return { file, details };
  })
  .handler(async ({ data }): Promise<SubmitContributionResult> => {
    if (!sql) return { ok: false, reason: "Contribution storage isn't configured." };
    if (isRateLimited(getClientIp())) {
      return { ok: false, reason: "Too many submissions — please try again later." };
    }

    const config = await getDriveIntegrationConfig();
    if (!config) {
      return { ok: false, reason: "File uploads aren't available right now. Try sharing a Drive link instead." };
    }

    let uploaded: DriveFileEntry;
    try {
      const arrayBuffer = await data.file.arrayBuffer();
      const driveFileName = withContributionTimestamp(data.details.fileName, new Date());
      uploaded = await uploadDriveFile(
        config,
        {
          name: driveFileName,
          mimeType: data.file.type || "application/octet-stream",
          data: arrayBuffer,
        },
        CONTRIBUTIONS_FOLDER_ID
      );
    } catch (error) {
      return {
        ok: false,
        reason: `Could not upload the file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    try {
      const rows = await sql.query(
        `INSERT INTO resource_contributions
           (submission_type, file_name, class_slug, subject, description, contributor_alias,
            drive_file_id, drive_file_link, contact_method)
         VALUES ('upload', $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          data.details.fileName,
          data.details.classLabel || data.details.classSlug,
          data.details.subject,
          data.details.description || null,
          data.details.contributorAlias || null,
          uploaded.id,
          uploaded.webViewLink,
          data.details.contactMethod,
        ]
      );
      const row = rows[0] as { id: number } | undefined;
      return { ok: true, id: row?.id ?? 0 };
    } catch (error) {
      console.error("[contribute] failed to insert upload contribution", error);
      return { ok: false, reason: "The file uploaded, but we couldn't save your submission. Try again." };
    }
  });

/**
 * Path 2: contributor already has the file in their own Drive and just
 * shares a link — no Drive write on our side, just a DB row for the
 * admin to review and copy from.
 */
export const submitContributionLink = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as Record<string, unknown>;
    const driveLink = typeof d["driveLink"] === "string" ? d["driveLink"].trim() : "";
    if (!driveLink) throw new Error("A Drive link is required.");
    if (!isHttpUrl(driveLink)) throw new Error("That doesn't look like a valid link.");
    const details = validateDetails(d);
    return { driveLink, details };
  })
  .handler(async ({ data }): Promise<SubmitContributionResult> => {
    if (!sql) return { ok: false, reason: "Contribution storage isn't configured." };
    if (isRateLimited(getClientIp())) {
      return { ok: false, reason: "Too many submissions — please try again later." };
    }

    try {
      const rows = await sql.query(
        `INSERT INTO resource_contributions
           (submission_type, file_name, class_slug, subject, description, contributor_alias,
            shared_drive_link, contact_method)
         VALUES ('drive_link', $1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          data.details.fileName,
          data.details.classLabel || data.details.classSlug,
          data.details.subject,
          data.details.description || null,
          data.details.contributorAlias || null,
          data.driveLink,
          data.details.contactMethod,
        ]
      );
      const row = rows[0] as { id: number } | undefined;
      return { ok: true, id: row?.id ?? 0 };
    } catch (error) {
      console.error("[contribute] failed to insert link contribution", error);
      return { ok: false, reason: "Could not save your submission. Try again." };
    }
  });

// ---------------------------------------------------------------------
// Admin-facing read/update surface — listed in the "Manage resources"
// section of /admin as a "Contributed resources" card. Reuses the same
// requirePasscode() gate as every other admin server function (imported
// from admin-server.ts to avoid duplicating the passcode/rate-limit
// logic in two places).
// ---------------------------------------------------------------------

export type ContributionStatus = "pending" | "approved" | "rejected";

export type AdminContributionRow = {
  id: number;
  createdAt: string;
  submissionType: "upload" | "drive_link";
  fileName: string;
  classLabel: string;
  subject: string;
  description: string | null;
  contributorAlias: string | null;
  driveFileId: string | null;
  driveFileLink: string | null;
  sharedDriveLink: string | null;
  contactMethod: string;
  status: ContributionStatus;
  adminNotes: string | null;
};

export type AdminContributionsResult =
  | { configured: true; contributions: AdminContributionRow[] }
  | { configured: false; reason: string };

function mapContributionRow(r: Record<string, unknown>): AdminContributionRow {
  return {
    // Neon returns BIGSERIAL columns as strings (to avoid JS precision loss
    // on true bigints) — these ids are small enough to round-trip safely
    // as numbers, so convert explicitly rather than trusting the raw type.
    id: Number(r["id"]),
    createdAt: r["created_at"] as string,
    submissionType: r["submission_type"] as "upload" | "drive_link",
    fileName: r["file_name"] as string,
    classLabel: r["class_slug"] as string,
    subject: r["subject"] as string,
    description: (r["description"] as string | null) ?? null,
    contributorAlias: (r["contributor_alias"] as string | null) ?? null,
    driveFileId: (r["drive_file_id"] as string | null) ?? null,
    driveFileLink: (r["drive_file_link"] as string | null) ?? null,
    sharedDriveLink: (r["shared_drive_link"] as string | null) ?? null,
    contactMethod: r["contact_method"] as string,
    status: r["status"] as ContributionStatus,
    adminNotes: (r["admin_notes"] as string | null) ?? null,
  };
}

/** Lists every contribution, newest first — called by the admin
 * "Contributed resources" card. Requires the passcode, same as every
 * other admin read. */
export const getAdminContributions = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    return { passcode: d.passcode };
  })
  .handler(async ({ data }): Promise<AdminContributionsResult> => {
    requirePasscode(data.passcode);

    if (!sql) {
      return { configured: false, reason: "Database isn't configured (missing DATABASE_URL)." };
    }

    try {
      const rows = await sql.query(
        `SELECT id, created_at, submission_type, file_name, class_slug, subject, description,
                contributor_alias, drive_file_id, drive_file_link, shared_drive_link, contact_method,
                status, admin_notes
         FROM resource_contributions
         ORDER BY created_at DESC`
      );
      return { configured: true, contributions: (rows as Record<string, unknown>[]).map(mapContributionRow) };
    } catch (error) {
      return {
        configured: false,
        reason: `Could not load contributions: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });

export type UpdateContributionStatusResult = { ok: true } | { ok: false; reason: string };

/** Updates a single contribution's status (approved/rejected/pending) and
 * optional admin note — the admin's review action after checking the
 * uploaded file or shared link themselves. Doesn't touch Drive or the
 * live resource datasets; that's still a manual step via "Manage
 * resources" / "Update resource datasets" once the admin has decided to
 * fold a contribution in. */
export const updateContributionStatus = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const d = data as { passcode?: unknown; id?: unknown; status?: unknown; adminNotes?: unknown };
    if (typeof d?.passcode !== "string") throw new Error("Missing passcode");
    if (typeof d?.id !== "number") throw new Error("Missing id");
    if (d.status !== "pending" && d.status !== "approved" && d.status !== "rejected") {
      throw new Error("Invalid status");
    }
    if (d.adminNotes !== undefined && typeof d.adminNotes !== "string") throw new Error("Invalid adminNotes");
    return { passcode: d.passcode, id: d.id, status: d.status, adminNotes: d.adminNotes as string | undefined };
  })
  .handler(async ({ data }): Promise<UpdateContributionStatusResult> => {
    requirePasscode(data.passcode);

    if (!sql) return { ok: false, reason: "Database isn't configured." };

    try {
      await sql.query(
        `UPDATE resource_contributions
         SET status = $1, admin_notes = $2, reviewed_at = now()
         WHERE id = $3`,
        [data.status, data.adminNotes ?? null, data.id]
      );
      return { ok: true };
    } catch (error) {
      console.error("[contribute] failed to update status", error);
      return { ok: false, reason: "Could not update the status. Try again." };
    }
  });
