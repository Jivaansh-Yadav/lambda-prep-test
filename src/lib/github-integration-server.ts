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
    // GitHub's REST API rejects requests without a User-Agent header
    // (HTTP 403 "Request forbidden by administrative rules").
    "User-Agent": "lambda-prep-admin",
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

// The run/job/step shapes are shared with the client-side progress
// helpers, so the admin panel and this server module can't drift apart.
export type {
  WorkflowJob,
  WorkflowRunStatus,
  WorkflowRunSummary,
  WorkflowStep,
} from "./workflow-progress";
import type { WorkflowJob, WorkflowRunStatus, WorkflowRunSummary } from "./workflow-progress";


type RawStep = {
  number?: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
};

type RawJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  html_url?: string;
  steps?: RawStep[];
};

type RawRun = {
  id: number;
  run_number?: number;
  html_url: string;
  event?: string;
  head_branch?: string;
  head_sha?: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at?: string | null;
  updated_at?: string;
};


/**
 * Fetches a run's current status plus every job and its steps. Jobs are
 * kept separate (not flattened) because the admin panel groups the steps
 * into task categories and needs each job's own timing to show where the
 * run currently is.
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
  const run = (await runRes.json()) as RawRun;

  const jobsUrl = `${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/runs/${runId}/jobs?per_page=100`;
  const jobsRes = await fetch(jobsUrl, { headers: authHeaders(config.pat) });
  const jobs: WorkflowJob[] = [];
  if (jobsRes.ok) {
    const jobsJson = (await jobsRes.json()) as { jobs?: RawJob[] };
    for (const job of jobsJson.jobs ?? []) {
      jobs.push({
        id: job.id,
        name: job.name,
        status: job.status,
        conclusion: job.conclusion,
        startedAt: job.started_at ?? null,
        completedAt: job.completed_at ?? null,
        htmlUrl: job.html_url ?? null,
        steps: (job.steps ?? []).map((step, index) => ({
          number: step.number ?? index + 1,
          name: step.name,
          status: step.status,
          conclusion: step.conclusion,
          startedAt: step.started_at ?? null,
          completedAt: step.completed_at ?? null,
        })),
      });
    }
  }

  return {
    runId: run.id,
    runNumber: run.run_number ?? 0,
    htmlUrl: run.html_url,
    event: run.event ?? "unknown",
    headBranch: run.head_branch ?? "",
    headSha: run.head_sha ?? "",
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    startedAt: run.run_started_at ?? null,
    updatedAt: run.updated_at ?? run.created_at,
    jobs,
  };
}

/** Most recent run of the configured workflow, whatever triggered it
 * (schedule or a manual dispatch) — lets the admin panel attach to a run
 * that was started before the page was opened, or by the weekly cron. */
export async function getLatestWorkflowRun(
  config: GithubIntegrationConfig
): Promise<WorkflowRunStatus | null> {
  const url = `${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/runs?per_page=1`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "<unreadable>");
    throw new Error(`Could not list workflow runs (HTTP ${res.status}): ${bodyText.slice(0, 300)}`);
  }
  const json = (await res.json()) as { workflow_runs?: RawRun[] };
  const latest = json.workflow_runs?.[0];
  if (!latest) return null;
  // The list payload already carries everything but the jobs; skip the
  // extra round trip and fetch the full status for this run only.
  return getWorkflowRunStatus(config, latest.id);
}

/** Recent run history (newest first) for the compact list in the admin
 * panel — one API call, no jobs. */
export async function listWorkflowRuns(
  config: GithubIntegrationConfig,
  limit = 6
): Promise<WorkflowRunSummary[]> {
  const url =
    `${GITHUB_API}/repos/${config.owner}/${config.repo}/actions/workflows/${config.workflowFile}/runs` +
    `?per_page=${Math.min(Math.max(limit, 1), 20)}`;
  const res = await fetch(url, { headers: authHeaders(config.pat) });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "<unreadable>");
    throw new Error(`Could not list workflow runs (HTTP ${res.status}): ${bodyText.slice(0, 300)}`);
  }
  const json = (await res.json()) as { workflow_runs?: RawRun[] };
  return (json.workflow_runs ?? []).map((run) => ({
    runId: run.id,
    runNumber: run.run_number ?? 0,
    event: run.event ?? "unknown",
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    htmlUrl: run.html_url,
  }));
}

/**
 * Whether the workflow already has a run in flight. Used to refuse a
 * duplicate dispatch — GitHub would happily queue a second full crawl on
 * top of the one already running.
 */
export async function getActiveWorkflowRun(
  config: GithubIntegrationConfig
): Promise<WorkflowRunSummary | null> {
  const runs = await listWorkflowRuns(config, 5);
  return runs.find((run) => run.status === "queued" || run.status === "in_progress") ?? null;
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
