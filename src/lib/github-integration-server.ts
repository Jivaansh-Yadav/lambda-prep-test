// github-integration-server.ts
//
// Server-only GitHub Actions client for the admin "Manage Resources"
// panel's "Update resource datasets" button. Reads the PAT + target
// repo/workflow from Neon (table: github_integration) and talks to the
// GitHub REST API directly over fetch — no @octokit dependency needed for
// this narrow use case (dispatch a workflow, then poll its run status).

import { sql } from "./db";

const GITHUB_API = "https://api.github.com";

export type GithubIntegrationConfig = {
  pat: string;
  owner: string;
  repo: string;
  workflowFile: string;
  ref: string;
};

/**
 * Reads the single-row GitHub integration config (PAT + repo + workflow
 * file) from Neon. Returns null if the row doesn't exist yet, or if `sql`
 * isn't configured (no DATABASE_URL).
 */
export async function getGithubIntegrationConfig(): Promise<GithubIntegrationConfig | null> {
  if (!sql) return null;
  const rows = await sql.query(
    "SELECT pat, owner, repo, workflow_file, ref FROM github_integration WHERE id = true LIMIT 1"
  );
  const row = rows[0] as
    | { pat: string; owner: string; repo: string; workflow_file: string; ref: string }
    | undefined;
  if (!row) return null;
  return { pat: row.pat, owner: row.owner, repo: row.repo, workflowFile: row.workflow_file, ref: row.ref };
}

function authHeaders(pat: string) {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * Dispatches the configured workflow via workflow_dispatch, then polls
 * (briefly) for the newest matching run so the caller can return its id
 * right away rather than making the browser do a second round trip.
 * GitHub's dispatch endpoint doesn't return the created run's id directly
 * — we have to look it up by listing runs right after.
 */
export async function dispatchWorkflow(config: GithubIntegrationConfig): Promise<{ runId: number; htmlUrl: string }> {
  const dispatchUrl = `${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/dispatches`;
  const beforeDispatch = new Date();

  const dispatchRes = await fetch(dispatchUrl, {
    method: "POST",
    headers: { ...authHeaders(config.pat), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: config.ref }),
  });

  if (!dispatchRes.ok) {
    const bodyText = await dispatchRes.text().catch(() => "<unreadable>");
    throw new Error(`GitHub workflow dispatch failed (HTTP ${dispatchRes.status}): ${bodyText.slice(0, 300)}`);
  }

  // The run doesn't appear instantly — poll briefly for a run created at
  // or after the moment we dispatched it.
  const runsUrl = `${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/runs?per_page=5`;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const runsRes = await fetch(runsUrl, { headers: authHeaders(config.pat) });
    if (!runsRes.ok) continue;
    const json = (await runsRes.json()) as { workflow_runs: Array<{ id: number; created_at: string; html_url: string }> };
    const match = json.workflow_runs.find((r) => new Date(r.created_at) >= beforeDispatch);
    if (match) return { runId: match.id, htmlUrl: match.html_url };
  }

  throw new Error("Workflow was dispatched, but no matching run appeared within 10 seconds.");
}

export type WorkflowStep = { name: string; status: string; conclusion: string | null };
export type WorkflowRunStatus = {
  runId: number;
  htmlUrl: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | ... | null while running
  steps: WorkflowStep[];
};
/**
 * Fetches the current status + per-step progress of a previously
 * dispatched run, for the UI to poll.
 */
export async function getWorkflowRunStatus(
  config: GithubIntegrationConfig,
  runId: number
): Promise<WorkflowRunStatus> {
  const runUrl = `${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/runs/${runId}`;
  const runRes = await fetch(runUrl, { headers: authHeaders(config.pat) });
  if (!runRes.ok) {
    const bodyText = await runRes.text().catch(() => "<unreadable>");
    throw new Error(`Could not fetch run status (HTTP ${runRes.status}): ${bodyText.slice(0, 300)}`);
  }
  const run = (await runRes.json()) as { status: string; conclusion: string | null; html_url: string };

  const jobsUrl = `${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/runs/${runId}/jobs`;
  const jobsRes = await fetch(jobsUrl, { headers: authHeaders(config.pat) });
  const steps: WorkflowStep[] = [];
  if (jobsRes.ok) {
    const jobsJson = (await jobsRes.json()) as {
      jobs: Array<{ steps: Array<{ name: string; status: string; conclusion: string | null }> }>;
    };
    for (const job of jobsJson.jobs) {
      for (const step of job.steps) {
        steps.push({ name: step.name, status: step.status, conclusion: step.conclusion });
      }
    }
  }

  return { runId, htmlUrl: run.html_url, status: run.status, conclusion: run.conclusion, steps };
}

export type LatestCommit = {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authoredAt: string;
  htmlUrl: string;
};

/**
 * Fetches the most recent commit on the configured ref, for the admin
 * "Latest commit" card. Uses the same PAT already stored for workflow
 * dispatch — no separate credential needed.
 */
export async function getLatestCommit(config: GithubIntegrationConfig): Promise<LatestCommit> {
  const url = `${GITHUB_API}/repos/${config.owner}/${config.repo}/commits/${config.ref}`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "<unreadable>");
    throw new Error(`Could not fetch latest commit (HTTP ${res.status}): ${bodyText.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author: { name: string; date: string };
    };
  };
  return {
    sha: json.sha,
    shortSha: json.sha.slice(0, 7),
    message: json.commit.message.split("\n")[0] ?? json.commit.message,
    authorName: json.commit.author.name,
    authoredAt: json.commit.author.date,
    htmlUrl: json.html_url,
  };
}
