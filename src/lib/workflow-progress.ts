/**
 * Pure helpers for turning a GitHub Actions run into the grouped,
 * per-category progress view the admin panel renders.
 *
 * GitHub's REST API is the only progress source we have: it reports live
 * step status while a run is in flight, but never live logs (those are
 * only downloadable once the run finishes). So the granularity the panel
 * can show is exactly the granularity of the workflow's steps — which is
 * why `.github/workflows/update-resources.yml` names every step with a
 * `[Category]` prefix. Keep this file free of server-only imports so the
 * same derivation can be unit-tested and reused client-side.
 */

export type WorkflowStep = {
  number: number;
  name: string;
  status: string; // queued | in_progress | completed
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type WorkflowJob = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
  steps: WorkflowStep[];
};

export type WorkflowRunStatus = {
  runId: number;
  runNumber: number;
  htmlUrl: string;
  event: string;
  headBranch: string;
  headSha: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  jobs: WorkflowJob[];
};

export type WorkflowRunSummary = {
  runId: number;
  runNumber: number;
  event: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  htmlUrl: string;
};

export type WorkflowCategoryKey =
  | "setup"
  | "crawl"
  | "datasets"
  | "instarevision"
  | "commit"
  | "runner"
  | "other";

type CategoryDef = {
  key: WorkflowCategoryKey;
  label: string;
  description: string;
};

/** Display order + copy for each category. `runner` holds GitHub's own
 * "Set up job" / "Post …" / "Complete job" bookkeeping steps, which are
 * noise for the creator but still worth showing collapsed at the end. */
export const WORKFLOW_CATEGORIES: CategoryDef[] = [
  { key: "setup", label: "Setup", description: "Checkout, Node/Python toolchains, Drive credentials" },
  { key: "crawl", label: "Drive crawl", description: "Walks the Drive folder tree and lists every file" },
  { key: "datasets", label: "Datasets", description: "Transform, split, sort and count the resource JSON" },
  { key: "instarevision", label: "InstaRevision", description: "Re-signs the 7-day GCS PDF links" },
  { key: "commit", label: "Commit", description: "Cleans up secrets and commits the regenerated data" },
  { key: "runner", label: "Runner", description: "GitHub's own job setup and teardown steps" },
  { key: "other", label: "Other", description: "Steps without a category tag" },
];

const CATEGORY_ALIASES: Record<string, WorkflowCategoryKey> = {
  setup: "setup",
  prepare: "setup",
  crawl: "crawl",
  drive: "crawl",
  dataset: "datasets",
  datasets: "datasets",
  data: "datasets",
  instarevision: "instarevision",
  revision: "instarevision",
  commit: "commit",
  publish: "commit",
};

/** GitHub's bookkeeping steps that wrap every job. */
const RUNNER_STEP = /^(set up job|complete job|post .*|pre .*)$/i;

export type StepCategory = {
  key: WorkflowCategoryKey;
  label: string;
  /** Step name with the `[Category]` prefix removed. */
  displayName: string;
};

/**
 * Resolves a step to its category. A `[Tag]` prefix wins; otherwise the
 * legacy un-tagged workflow names are mapped by keyword, so a run started
 * before the workflow was split still renders sensibly.
 */
export function categorizeStep(rawName: string): StepCategory {
  const name = rawName.trim();
  const tagged = /^\[([^\]]+)\]\s*(.*)$/.exec(name);
  if (tagged) {
    const key = CATEGORY_ALIASES[tagged[1]!.trim().toLowerCase()] ?? "other";
    const def = WORKFLOW_CATEGORIES.find((c) => c.key === key)!;
    return { key, label: def.label, displayName: tagged[2] || name };
  }

  if (RUNNER_STEP.test(name)) {
    return { key: "runner", label: "Runner", displayName: name };
  }

  // Legacy (pre-`[Category]`) step names from earlier workflow revisions.
  // Order matters: the old pipeline collapsed crawl+transform into one
  // "Run full resource pipeline" step, and "Write … credentials" vs
  // "Remove … credentials" belong to opposite categories.
  if (/insta\s*revision|signed link/i.test(name)) {
    return { key: "instarevision", label: "InstaRevision", displayName: name };
  }
  if (/^commit\b|commit regenerated|remove .*credential/i.test(name)) {
    return { key: "commit", label: "Commit", displayName: name };
  }
  if (/^checkout|set up node|set up python|install .*dependenc|write .*credential/i.test(name)) {
    return { key: "setup", label: "Setup", displayName: name };
  }
  if (/transform|split|sort|count|pipeline|dataset/i.test(name)) {
    return { key: "datasets", label: "Datasets", displayName: name };
  }
  if (/crawl|drive/i.test(name)) {
    return { key: "crawl", label: "Drive crawl", displayName: name };
  }
  return { key: "other", label: "Other", displayName: name };
}

export type CategoryGroup = {
  key: WorkflowCategoryKey;
  label: string;
  description: string;
  steps: Array<WorkflowStep & { displayName: string; categoryKey: WorkflowCategoryKey }>;
  status: string; // queued | in_progress | completed
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

export type RunProgress = {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  /** 0–100, based on completed steps (running steps count as started). */
  percent: number;
  /** Net elapsed time, i.e. now − run start for a live run, or the run's
   * own wall time for a finished one. */
  elapsedMs: number | null;
  /** Straight-line estimate from the average finished step; null when it
   * can't be estimated or the run already finished. */
  etaMs: number | null;
  isRunning: boolean;
  isQueued: boolean;
  currentStepName: string | null;
  currentCategoryKey: WorkflowCategoryKey | null;
};

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Collapses every job's steps into ordered category groups. */
export function categorizeRun(run: WorkflowRunStatus): CategoryGroup[] {
  const buckets = new Map<WorkflowCategoryKey, CategoryGroup>();

  for (const def of WORKFLOW_CATEGORIES) {
    buckets.set(def.key, {
      key: def.key,
      label: def.label,
      description: def.description,
      steps: [],
      status: "queued",
      conclusion: null,
      startedAt: null,
      completedAt: null,
      durationMs: null,
    });
  }

  const steps = run.jobs.flatMap((job) => job.steps);
  for (const step of steps) {
    const { key, displayName } = categorizeStep(step.name);
    const bucket = buckets.get(key)!;
    bucket.steps.push({ ...step, displayName, categoryKey: key });
    const started = time(step.startedAt);
    if (started !== null && (bucket.startedAt === null || started < time(bucket.startedAt)!)) {
      bucket.startedAt = step.startedAt;
    }
    const finished = time(step.completedAt);
    if (finished !== null && (bucket.completedAt === null || finished > time(bucket.completedAt)!)) {
      bucket.completedAt = step.completedAt;
    }
  }

  for (const bucket of buckets.values()) {
    if (bucket.steps.length === 0) continue;

    // A category's own status is a roll-up of its steps: any failure →
    // failure, any still running → in_progress, all done → its conclusion.
    const failing = bucket.steps.find(
      (s) => s.status === "completed" && s.conclusion && !["success", "skipped", "neutral"].includes(s.conclusion)
    );
    const running = bucket.steps.find((s) => s.status === "in_progress");
    const queued = bucket.steps.find((s) => s.status === "queued");
    const allDone = bucket.steps.every((s) => s.status === "completed");
    const onlySkipped = allDone && bucket.steps.every((s) => s.conclusion === "skipped");

    if (failing) {
      bucket.status = "completed";
      bucket.conclusion = failing.conclusion;
    } else if (running) {
      bucket.status = "in_progress";
      bucket.conclusion = null;
    } else if (queued) {
      bucket.status = allDone ? "completed" : "queued";
      bucket.conclusion = allDone ? "success" : null;
    } else {
      bucket.status = "completed";
      bucket.conclusion = onlySkipped ? "skipped" : "success";
    }

    // Duration is the sum of the category's own step durations, not the
    // span from first start to last end — the runner's "Post …" teardown
    // steps sit at the very end of the run, so a span would claim the
    // teardown category took the whole job.
    let summed = 0;
    let anyTimed = false;
    for (const step of bucket.steps) {
      const start = time(step.startedAt);
      const end = time(step.completedAt);
      if (start !== null && end !== null) {
        summed += Math.max(0, end - start);
        anyTimed = true;
      }
    }
    bucket.durationMs = anyTimed ? summed : null;
  }

  return WORKFLOW_CATEGORIES.map((def) => buckets.get(def.key)!).filter((group) => group.steps.length > 0);
}

/** Overall progress numbers for the header bar. */
export function runProgress(run: WorkflowRunStatus, now: number = Date.now()): RunProgress {
  const steps = run.jobs.flatMap((job) => job.steps);
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const failedSteps = steps.filter(
    (s) => s.status === "completed" && s.conclusion && !["success", "skipped", "neutral"].includes(s.conclusion)
  ).length;
  const skippedSteps = steps.filter((s) => s.conclusion === "skipped").length;

  const isQueued = run.status === "queued";
  const isRunning = run.status === "in_progress" || run.status === "queued";

  // Overall percent: finished steps, with a running step counting as half
  // so the bar still moves during a long crawl.
  const runningSteps = steps.filter((s) => s.status === "in_progress").length;
  const percent = steps.length
    ? Math.min(100, Math.round(((completedSteps + runningSteps * 0.5) / steps.length) * 100))
    : 0;

  const start = time(run.startedAt) ?? time(run.createdAt);
  const end = run.status === "completed" ? time(run.updatedAt) : now;
  const elapsedMs = start !== null && end !== null ? Math.max(0, end - start) : null;

  let etaMs: number | null = null;
  if (isRunning && elapsedMs !== null && completedSteps > 0 && steps.length > completedSteps) {
    const perStep = elapsedMs / completedSteps;
    etaMs = Math.round(perStep * (steps.length - completedSteps));
  }

  const current = steps.find((s) => s.status === "in_progress") ?? null;
  const currentCategory = current ? categorizeStep(current.name).key : null;

  return {
    totalSteps: steps.length,
    completedSteps,
    failedSteps,
    skippedSteps,
    percent: run.status === "completed" && !failedSteps ? 100 : percent,
    elapsedMs,
    etaMs,
    isRunning,
    isQueued,
    currentStepName: current ? categorizeStep(current.name).displayName : null,
    currentCategoryKey: currentCategory,
  };
}

/** "2m 14s" / "48s" / "1h 03m" — short and readable in a dense row. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Single glyph + tone used for a step/category status pill. */
export function statusTone(
  status: string,
  conclusion: string | null
): "success" | "running" | "queued" | "failed" | "skipped" | "neutral" {
  if (status === "in_progress") return "running";
  if (status === "queued") return "queued";
  if (status !== "completed") return "neutral";
  if (conclusion === "success") return "success";
  if (conclusion === "skipped") return "skipped";
  if (!conclusion) return "neutral";
  return "failed";
}
