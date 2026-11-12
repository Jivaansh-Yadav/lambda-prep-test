import { describe, expect, it } from "vitest";
import {
  categorizeRun,
  categorizeStep,
  formatDuration,
  runProgress,
  statusTone,
  type WorkflowRunStatus,
  type WorkflowStep,
} from "./workflow-progress";

function step(number: number, name: string, status: string, conclusion: string | null, start: number, end: number | null): WorkflowStep {
  return {
    number,
    name,
    status,
    conclusion,
    startedAt: new Date(start).toISOString(),
    completedAt: end === null ? null : new Date(end).toISOString(),
  };
}

function run(steps: WorkflowStep[], status = "in_progress", conclusion: string | null = null): WorkflowRunStatus {
  return {
    runId: 1,
    runNumber: 9,
    htmlUrl: "https://example.com/run",
    event: "workflow_dispatch",
    headBranch: "main",
    headSha: "abc1234",
    status,
    conclusion,
    createdAt: new Date(0).toISOString(),
    startedAt: new Date(0).toISOString(),
    updatedAt: new Date(10_000).toISOString(),
    jobs: [
      {
        id: 1,
        name: "update-resources",
        status,
        conclusion,
        startedAt: new Date(0).toISOString(),
        completedAt: conclusion ? new Date(10_000).toISOString() : null,
        htmlUrl: null,
        steps,
      },
    ],
  };
}

describe("categorizeStep", () => {
  it("reads the [Category] tag and strips it from the display name", () => {
    expect(categorizeStep("[Crawl] Crawl Google Drive folder tree")).toMatchObject({
      key: "crawl",
      displayName: "Crawl Google Drive folder tree",
    });
    expect(categorizeStep("[InstaRevision] Refresh signed PDF links").key).toBe("instarevision");
    expect(categorizeStep("[Datasets] Count resources across all datasets").key).toBe("datasets");
  });

  it("maps GitHub's own bookkeeping steps to the runner category", () => {
    for (const name of ["Set up job", "Complete job", "Post Checkout", "Post Set up Python"]) {
      expect(categorizeStep(name).key).toBe("runner");
    }
  });

  it("still classifies the pre-[Category] step names of older runs", () => {
    expect(categorizeStep("Checkout").key).toBe("setup");
    expect(categorizeStep("Write Google Drive service-account credentials").key).toBe("setup");
    expect(categorizeStep("Install Drive crawl dependencies").key).toBe("setup");
    expect(categorizeStep("Run full resource pipeline (crawl + transform + split + sort + count)").key).toBe("datasets");
    expect(categorizeStep("Refresh InstaRevision PDF signed links (7-day GCS URLs)").key).toBe("instarevision");
    expect(categorizeStep("Remove service-account credentials before diffing/committing").key).toBe("commit");
    expect(categorizeStep("Commit regenerated datasets").key).toBe("commit");
  });

  it("falls back to Other for an unlabelled step", () => {
    expect(categorizeStep("Some future task").key).toBe("other");
  });
});

describe("categorizeRun", () => {
  it("groups steps in workflow order and sums each category's durations", () => {
    const status = run([
      step(1, "Set up job", "completed", "success", 0, 2_000),
      step(2, "[Setup] Checkout repository", "completed", "success", 2_000, 5_000),
      step(3, "[Crawl] Crawl Google Drive folder tree", "in_progress", null, 5_000, null),
      step(4, "[Commit] Commit regenerated datasets", "queued", null, 0, null),
      step(5, "Complete job", "queued", null, 0, null),
    ]);

    const groups = categorizeRun(status);
    expect(groups.map((group) => group.key)).toEqual(["setup", "crawl", "commit", "runner"]);

    const setup = groups.find((group) => group.key === "setup")!;
    expect(setup.durationMs).toBe(3_000);
    expect(setup.status).toBe("completed");
    expect(setup.conclusion).toBe("success");

    const crawl = groups.find((group) => group.key === "crawl")!;
    expect(crawl.status).toBe("in_progress");
    expect(crawl.conclusion).toBeNull();

    const commit = groups.find((group) => group.key === "commit")!;
    expect(commit.status).toBe("queued");
  });

  it("rolls a failed step up to its category", () => {
    const status = run(
      [
        step(1, "[Datasets] Transform CISCE + Community resources", "completed", "success", 0, 1_000),
        step(2, "[Datasets] Split oversized datasets per subject", "completed", "failure", 1_000, 2_000),
      ],
      "completed",
      "failure"
    );
    const datasets = categorizeRun(status).find((group) => group.key === "datasets")!;
    expect(datasets.status).toBe("completed");
    expect(datasets.conclusion).toBe("failure");
  });

  it("drops categories with no steps", () => {
    const groups = categorizeRun(run([step(1, "[Setup] Checkout repository", "in_progress", null, 0, null)]));
    expect(groups.map((group) => group.key)).toEqual(["setup"]);
  });
});

describe("runProgress", () => {
  it("counts completed steps and reports the running step", () => {
    const status = run([
      step(1, "[Setup] Checkout repository", "completed", "success", 0, 1_000),
      step(2, "[Crawl] Crawl Google Drive folder tree", "in_progress", null, 1_000, null),
      step(3, "[Commit] Commit regenerated datasets", "queued", null, 0, null),
    ]);
    const progress = runProgress(status, 5_000);
    expect(progress.totalSteps).toBe(3);
    expect(progress.completedSteps).toBe(1);
    expect(progress.percent).toBe(50); // one done + one half-credit running
    expect(progress.currentStepName).toBe("Crawl Google Drive folder tree");
    expect(progress.currentCategoryKey).toBe("crawl");
    expect(progress.elapsedMs).toBe(5_000);
    expect(progress.isRunning).toBe(true);
  });

  it("reports 100% for a finished successful run and never estimates an ETA", () => {
    const status = run([step(1, "[Setup] Checkout repository", "completed", "success", 0, 2_000)], "completed", "success");
    const progress = runProgress(status, 99_000);
    expect(progress.percent).toBe(100);
    expect(progress.etaMs).toBeNull();
    expect(progress.isRunning).toBe(false);
  });

  it("treats a queued run as live but not yet started", () => {
    const status = run([step(1, "[Setup] Checkout repository", "queued", null, 0, null)], "queued", null);
    const progress = runProgress(status, 1_000);
    expect(progress.isQueued).toBe(true);
    expect(progress.currentStepName).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatDuration(4_000)).toBe("4s");
    expect(formatDuration(84_000)).toBe("1m 24s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_780_000)).toBe("1h 03m");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("statusTone", () => {
  it("maps GitHub status/conclusion pairs to a tone", () => {
    expect(statusTone("in_progress", null)).toBe("running");
    expect(statusTone("queued", null)).toBe("queued");
    expect(statusTone("completed", "success")).toBe("success");
    expect(statusTone("completed", "failure")).toBe("failed");
    expect(statusTone("completed", "skipped")).toBe("skipped");
    expect(statusTone("completed", "cancelled")).toBe("failed");
  });
});
