// drive-integration-server.ts
//
// Server-only Google Drive client for the admin "Manage Resources" panel.
// Reads the service-account credentials + target folder ID from Neon
// (table: drive_integration), signs a JWT assertion with `jose` (edge/
// Workers-compatible, unlike the heavier `googleapis` package used by the
// Node-only scripts/drive-crawl crawler), exchanges it for an OAuth2
// access token, and talks to the Drive v3 REST API directly over fetch.
//
// Scope is the full `drive` scope (not drive.readonly) because this panel
// also uploads new files — actual permission enforcement still depends on
// the service account having Editor access to the target folder in Drive's
// own sharing settings.

import { SignJWT, importPKCS8 } from "jose";
import { sql } from "./db";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

export type ServiceAccountJson = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

export type DriveIntegrationConfig = {
  serviceAccount: ServiceAccountJson;
  folderId: string;
};

export type DriveFileEntry = {
  id: string;
  name: string;
  mimeType: string;
  size: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  webViewLink: string | null;
};

/**
 * Reads the single-row Drive integration config (service account JSON +
 * target folder ID) from Neon. Returns null if the row doesn't exist yet,
 * or if `sql` isn't configured (no DATABASE_URL).
 */
export async function getDriveIntegrationConfig(): Promise<DriveIntegrationConfig | null> {
  if (!sql) return null;
  const rows = await sql.query(
    "SELECT service_account_json, folder_id FROM drive_integration WHERE id = true LIMIT 1"
  );
  const row = rows[0] as { service_account_json: ServiceAccountJson; folder_id: string } | undefined;
  if (!row) return null;
  return { serviceAccount: row.service_account_json, folderId: row.folder_id };
}

// Access tokens are valid for ~1h; cache in module scope so repeated
// requests within the same server instance don't re-mint a token every
// time. Keyed by client_email in case credentials ever change at runtime.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Exchanges the service-account JSON for a short-lived Drive OAuth2 access
 * token via the standard JWT-bearer grant, caching it in memory until
 * shortly before expiry.
 */
export async function getDriveAccessToken(serviceAccount: ServiceAccountJson): Promise<string> {
  const cached = tokenCache.get(serviceAccount.client_email);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");

  const assertion = await new SignJWT({ scope: DRIVE_SCOPE })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(serviceAccount.client_email)
    .setAudience(serviceAccount.token_uri ?? TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey);

  const response = await fetch(serviceAccount.token_uri ?? TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "<unreadable>");
    throw new Error(`Google token exchange failed (HTTP ${response.status}): ${bodyText.slice(0, 300)}`);
  }

  const json = (await response.json()) as { access_token: string; expires_in: number };
  tokenCache.set(serviceAccount.client_email, {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });
  return json.access_token;
}

const FILE_FIELDS = "id, name, mimeType, size, createdTime, modifiedTime, webViewLink";

export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_SHORTCUT_MIME = "application/vnd.google-apps.shortcut";

/** True if a Drive entry is itself a (navigable) folder rather than a file. */
export function isDriveFolder(entry: DriveFileEntry): boolean {
  return entry.mimeType === DRIVE_FOLDER_MIME;
}

type RawDriveFile = DriveFileEntry & {
  shortcutDetails?: { targetId: string; targetMimeType: string };
};

/**
 * Drive "shortcuts" (`application/vnd.google-apps.shortcut`) are pointer
 * objects, not the real folder/file — their own mimeType/id never match
 * the target, so without resolving them a shortcut to a folder renders as
 * an inert, un-openable file. This fetches the shortcut's real target
 * (one `files.get` call) and returns an entry carrying the target's actual
 * id/mimeType/size/dates/link, so shortcuts to folders drill down exactly
 * like real folders and shortcuts to files open the real file.
 */
async function resolveShortcut(token: string, raw: RawDriveFile): Promise<DriveFileEntry> {
  const targetId = raw.shortcutDetails?.targetId;
  if (!targetId) return raw;
  try {
    const url = new URL(`${DRIVE_FILES_URL}/${targetId}`);
    url.searchParams.set("fields", FILE_FIELDS);
    url.searchParams.set("supportsAllDrives", "true");
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const target = (await response.json()) as DriveFileEntry;
    // Keep the shortcut's own display name (normally identical to the
    // target's anyway), but adopt everything else from the real target.
    return { ...target, name: raw.name };
  } catch {
    // Target deleted/moved/inaccessible — fall back to the raw shortcut
    // entry so the list still renders (it just won't be navigable).
    return raw;
  }
}

/**
 * Drive file/folder IDs are opaque, but they only ever use a URL-safe
 * alphabet: letters, digits, `-` and `_` (e.g.
 * `1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms`). Bounded length because
 * real IDs are well under 100 chars.
 *
 * This is a validation allowlist rather than an escaping routine on
 * purpose: folder IDs are interpolated into a Drive `q` search expression
 * below, which is its own little query language with quoted literals,
 * `and`/`or` and `in parents`. Rejecting anything that isn't a bare ID is
 * far easier to reason about than trying to escape every metacharacter.
 */
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;

/** True when `value` looks like a well-formed Drive file/folder ID. */
export function isDriveId(value: string): boolean {
  return DRIVE_ID_PATTERN.test(value);
}

/**
 * Lists the (non-trashed) items directly inside a Drive folder, newest-
 * modified first. Defaults to the configured root folder, but accepts any
 * folder ID so the admin panel can drill down into subfolders returned by
 * a previous call (one level at a time, mirroring the Editor's Choice
 * folder navigator used on the public resources pages). Shortcuts are
 * transparently resolved to their real target, so shortcuts to folders
 * behave like real folders.
 */
export async function listDriveFolderFiles(
  config: DriveIntegrationConfig,
  folderId: string = config.folderId
): Promise<DriveFileEntry[]> {
  // Validate here as well as at the server-function boundary: this is the
  // one place that builds the Drive query, so no caller can route an
  // unvalidated ID into it. The value is deliberately not echoed back —
  // it may be attacker-controlled and ends up in a UI error message.
  if (!isDriveId(folderId)) {
    throw new Error("Invalid Drive folder ID: expected letters, digits, '-' and '_' only.");
  }

  const token = await getDriveAccessToken(config.serviceAccount);

  const rawFiles: RawDriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(DRIVE_FILES_URL);
    url.searchParams.set("q", `'${folderId}' in parents and trashed=false`);
    url.searchParams.set("fields", `nextPageToken, files(${FILE_FIELDS}, shortcutDetails)`);
    url.searchParams.set("orderBy", "modifiedTime desc");
    url.searchParams.set("pageSize", "100");
    // Required for the folder to resolve when it lives inside a Shared
    // Drive (service accounts have no storage quota of their own and
    // can only own/write content inside a Shared Drive — see
    // uploadDriveFile below for the write-side half of this).
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "<unreadable>");
      throw new Error(`Drive files.list failed (HTTP ${response.status}): ${bodyText.slice(0, 300)}`);
    }

    const json = (await response.json()) as { files: RawDriveFile[]; nextPageToken?: string };
    rawFiles.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken);

  const files = await Promise.all(
    rawFiles.map((f) => (f.mimeType === DRIVE_SHORTCUT_MIME ? resolveShortcut(token, f) : f))
  );

  // Folders first (so the navigator always surfaces subfolders ahead of
  // loose files), each group still newest-modified first.
  return files.sort((a, b) => {
    const aFolder = isDriveFolder(a) ? 0 : 1;
    const bFolder = isDriveFolder(b) ? 0 : 1;
    return aFolder - bFolder;
  });
}

/**
 * Uploads a single file into the configured Drive folder via a multipart
 * upload (metadata + content in one request). Returns the newly created
 * file's basic metadata.
 */
export async function uploadDriveFile(
  config: DriveIntegrationConfig,
  file: { name: string; mimeType: string; data: ArrayBuffer }
): Promise<DriveFileEntry> {
  const token = await getDriveAccessToken(config.serviceAccount);

  const boundary = `lp-upload-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: file.name, parents: [config.folderId] });

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [
    encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${file.mimeType}\r\n\r\n`
    ),
    new Uint8Array(file.data),
    encoder.encode(`\r\n--${boundary}--`),
  ];
  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }

  const url = new URL(DRIVE_UPLOAD_URL);
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("fields", FILE_FIELDS);
  // Required for the destination folder to accept writes when it lives
  // inside a Shared Drive — service accounts have no personal storage
  // quota, so uploads to a regular "My Drive" folder are rejected by
  // Google with a storageQuotaExceeded error even with Editor access;
  // moving the folder into a Shared Drive (billed to the Drive, not the
  // service account) is what makes this flag actually take effect.
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "<unreadable>");
    if (bodyText.includes("storageQuotaExceeded")) {
      throw new Error(
        "Google rejected the upload: service accounts have no storage quota in a regular \"My Drive\" " +
          "folder. Move the target folder into a Shared Drive (service accounts can write there) and try again."
      );
    }
    throw new Error(`Drive upload failed (HTTP ${response.status}): ${bodyText.slice(0, 300)}`);
  }

  return (await response.json()) as DriveFileEntry;
}
