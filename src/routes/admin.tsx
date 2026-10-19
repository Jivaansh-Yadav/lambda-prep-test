import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronRight, ExternalLink, File, FileImage, FileSpreadsheet, FileText, Folder } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  checkAdminPasscode,
  getAdminTraffic,
  getManageResources,
  triggerDatasetUpdate,
  getDatasetUpdateStatus,
  type AdminTrafficResult,
  type ManageResourcesResult,
} from '@/lib/admin-server';
import type { WorkflowRunStatus } from '@/lib/github-integration-server';
import type { DriveFileEntry } from '@/lib/drive-integration-server';
import { getFileKind, type FileKind } from '@/lib/resources-data';

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
function isDriveFolder(entry: DriveFileEntry): boolean {
  return entry.mimeType === DRIVE_FOLDER_MIME;
}

export const Route = createFileRoute('/admin')({
  head: () => ({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { title: 'Admin — Lambda Prep' }] }),
  component: AdminPage,
});

// Deliberately in-memory only (no sessionStorage/localStorage): the admin
// unlock must require the passcode again on every full page reload, not
// just when the browser tab is closed. A module-level variable persists
// across client-side route navigation within the same page load (so the
// unlock survives moving around /admin) but resets the moment the page is
// actually reloaded, since that re-evaluates this module from scratch.
let adminSessionPasscode: string | null = null;

function AdminPage() {
  const [authed, setAuthed] = useState(() => adminSessionPasscode !== null);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AdminTrafficResult | null>(null);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const check = await checkAdminPasscode({ data: { passcode } });
      if (check.ok) {
        adminSessionPasscode = passcode;
        setAuthed(true);
        await loadTraffic(passcode);
      } else if (check.lockedOutSeconds) {
        setError(`Too many attempts. Try again in ${check.lockedOutSeconds}s.`);
      } else {
        setError('Incorrect passcode.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  async function loadTraffic(code: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminTraffic({ data: { passcode: code } });
      setResult(data);
    } catch {
      setError('Could not load analytics. Try unlocking again.');
      setAuthed(false);
      adminSessionPasscode = null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed && !result && !loading) {
      void loadTraffic(adminSessionPasscode ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);


  if (!authed) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center px-4">
        <form onSubmit={handleUnlock} className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6 shadow">
          <h1 className="text-lg font-semibold text-foreground">Admin access</h1>
          <p className="text-sm text-muted-foreground">Enter the admin passcode to view analytics.</p>
          <Input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            autoFocus
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Checking…' : 'Unlock'}
          </Button>
        </form>
      </div>
    );
  }

  const totals = result?.configured
    ? result.days.reduce(
        (acc, d) => ({
          requests: acc.requests + d.requests,
          pageViews: acc.pageViews + d.pageViews,
          uniques: acc.uniques + d.uniques,
          threats: acc.threats + d.threats,
        }),
        { requests: 0, pageViews: 0, uniques: 0, threats: 0 },
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Analytics</h1>
        <div className="flex items-center gap-3">
          {result?.configured && (
            <span className="text-xs text-muted-foreground">
              {result.cache.hit ? 'Cached' : 'Live'} ·{' '}
              {new Date(result.cache.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadTraffic(adminSessionPasscode ?? '')}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {result && !result.configured && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-foreground">Cloudflare analytics not configured</p>
            <p className="mt-2 text-sm text-muted-foreground">{result.reason}</p>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Open the Cloudflare dashboard for this domain's zone and copy the Zone ID from the overview page.</li>
              <li>
                Create an API token under <span className="font-mono">My Profile → API Tokens</span> with{' '}
                <span className="font-mono">Zone → Analytics → Read</span> permission.
              </li>
              <li>
                Set <span className="font-mono">CLOUDFLARE_ZONE_ID</span> and{' '}
                <span className="font-mono">CLOUDFLARE_API_TOKEN</span> in the server environment, then refresh.
              </li>
            </ol>
          </CardContent>
        </Card>
      )}

      <ManageResourcesCard />

      {result?.configured && totals && (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Total requests (30d)" value={totals.requests.toLocaleString()} />
            <KpiCard label="Page views (30d)" value={totals.pageViews.toLocaleString()} />
            <KpiCard label="Unique visitors (30d)" value={totals.uniques.toLocaleString()} />
            <KpiCard label="Threats blocked (30d)" value={totals.threats.toLocaleString()} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Traffic — last 30 days</CardTitle>
            </CardHeader>
            <CardContent className="h-80">
              {result.days.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet for this zone.</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.days}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(v: string) => new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip labelFormatter={(v: string) => new Date(v).toLocaleDateString()} />
                    <Line type="monotone" dataKey="pageViews" name="Page views" stroke="#6366f1" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="uniques" name="Unique visitors" stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="threats" name="Threats blocked" stroke="#f97316" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Visits by section — last 30 days</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                {result.sections.every((s) => s.visits === 0) ? (
                  <p className="text-sm text-muted-foreground">No section visits recorded yet.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={result.sections} layout="vertical" margin={{ left: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} width={90} />
                      <Tooltip />
                      <Bar dataKey="visits" name="Visits" radius={4}>
                        {result.sections.map((s, i) => (
                          <Cell key={s.path} fill={SECTION_COLORS[i % SECTION_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Shows top-level visits to <span className="font-mono">/doxxmarks</span> vs{' '}
                <span className="font-mono">/resources</span>. Class, subject and chapter choices on these pages
                live in the URL's query string (e.g. <span className="font-mono">?class=...&amp;subject=...</span>),
                and Cloudflare's analytics path dimension doesn't include query strings — so a subcategory
                breakdown isn't available from this data source alone.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

const SECTION_COLORS = ['#6366f1', '#22c55e'];

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatBytes(size: string | null): string {
  if (!size) return '—';
  const n = Number(size);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const FILE_KIND_ICON: Record<FileKind, typeof FileText> = {
  pdf: FileText,
  docx: File,
  xlsx: FileSpreadsheet,
  pptx: File,
  image: FileImage,
  other: FileText,
};

function stepIcon(status: string, conclusion: string | null): string {
  if (status === 'completed') {
    if (conclusion === 'success') return '✅';
    if (conclusion === 'skipped') return '⏭️';
    return '❌';
  }
  if (status === 'in_progress') return '🔄';
  return '⏳';
}

function ManageResourcesCard() {
  const [state, setState] = useState<ManageResourcesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drill-down path into Drive subfolders: an empty array means the
  // configured root folder. Each entry is the folder clicked to get there,
  // so breadcrumbs can jump back to any ancestor level.
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([]);
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const currentFolderId = path.length ? path[path.length - 1]!.id : undefined;
  const currentFolderIdRef = useRef<string | undefined>(undefined);
  currentFolderIdRef.current = currentFolderId;

  const [triggering, setTriggering] = useState(false);
  const [updateRunId, setUpdateRunId] = useState<number | null>(null);
  const [updateStatus, setUpdateStatus] = useState<WorkflowRunStatus | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function getPasscode() {
    return adminSessionPasscode ?? '';
  }

  async function load(folderId?: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await getManageResources({ data: { passcode: getPasscode(), folderId } });
      setState(data);
    } catch {
      setError('Could not load resources.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openFolder(folder: DriveFileEntry) {
    setDirection('in');
    setPath((p) => [...p, { id: folder.id, name: folder.name }]);
    void load(folder.id);
  }

  function goToCrumb(index: number) {
    // index -1 = jump back to the root folder.
    setDirection('out');
    const next = index < 0 ? [] : path.slice(0, index + 1);
    setPath(next);
    void load(next.length ? next[next.length - 1]!.id : undefined);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(runId: number) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await getDatasetUpdateStatus({ data: { passcode: getPasscode(), runId } });
        if (!res.ok) {
          setUpdateError(res.reason);
          stopPolling();
          return;
        }
        setUpdateStatus(res.status);
        if (res.status.status === 'completed') {
          stopPolling();
          if (res.status.conclusion === 'success') {
            void load(currentFolderIdRef.current);
          }
        }
      } catch {
        setUpdateError('Lost connection while checking workflow status.');
        stopPolling();
      }
    }, 3000);
  }

  useEffect(() => stopPolling, []);

  async function handleTriggerUpdate() {
    setTriggering(true);
    setUpdateError(null);
    setUpdateStatus(null);
    setUpdateRunId(null);
    try {
      const res = await triggerDatasetUpdate({ data: { passcode: getPasscode() } });
      if (res.ok) {
        setUpdateRunId(res.runId);
        startPolling(res.runId);
      } else {
        setUpdateError(res.reason);
      }
    } catch {
      setUpdateError('Could not trigger the workflow. Try again.');
    } finally {
      setTriggering(false);
    }
  }

  const isRunning = updateStatus ? updateStatus.status !== 'completed' : updateRunId !== null && !updateError;

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Manage resources</CardTitle>
        <Button variant="outline" size="sm" onClick={() => void load(currentFolderId)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          Lists files live from the configured Google Drive folder via the service account — not from the
          committed JSON datasets.
        </p>

        <div className="mb-6 rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Update resource datasets</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Re-crawls Drive, regenerates the committed JSON datasets, and commits the result — via the{' '}
                <span className="font-mono">update-resources.yml</span> GitHub Actions workflow.
              </p>
            </div>
            <Button size="sm" onClick={() => void handleTriggerUpdate()} disabled={triggering || isRunning}>
              {triggering ? 'Starting…' : isRunning ? 'Running…' : 'Update resource datasets'}
            </Button>
          </div>

          {updateError && <p className="mt-3 text-sm text-destructive">{updateError}</p>}

          {updateRunId && !updateError && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Run{' '}
                  {updateStatus?.htmlUrl ? (
                    <a href={updateStatus.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">
                      #{updateRunId}
                    </a>
                  ) : (
                    <span className="font-mono">#{updateRunId}</span>
                  )}
                </span>
                <span>
                  {updateStatus?.status === 'completed'
                    ? updateStatus.conclusion === 'success'
                      ? '✅ Completed'
                      : `❌ ${updateStatus.conclusion ?? 'failed'}`
                    : updateStatus?.status
                      ? `⏳ ${updateStatus.status.replace('_', ' ')}`
                      : '⏳ Starting…'}
                </span>
              </div>

              {updateStatus && updateStatus.steps.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">
                  {updateStatus.steps.map((step) => (
                    <li key={step.name} className="flex items-center gap-2 text-muted-foreground">
                      <span>{stepIcon(step.status, step.conclusion)}</span>
                      <span className={step.status === 'in_progress' ? 'font-medium text-foreground' : ''}>
                        {step.name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {state && !state.configured && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">Drive integration not configured</p>
            <p className="mt-2 text-sm text-muted-foreground">{state.reason}</p>
          </div>
        )}

        {state?.configured && (
          <>
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Uploads are disabled: this folder is shared with Editor access, but Google only lets service
                accounts create new files inside a <span className="font-medium">Shared Drive</span> (storage
                owned by the Drive, not the account) — a plain "shared with me" folder still rejects uploads
                with <span className="font-mono">storageQuotaExceeded</span>. Move this folder into a Shared
                Drive to enable uploads here.
              </p>
            </div>

            {path.length > 0 && (
              <nav className="doxx-breadcrumb manage-resources-breadcrumb" aria-label="Breadcrumb">
                <button type="button" onClick={() => goToCrumb(-1)} className={path.length === 0 ? 'crumb-current' : ''}>
                  Root
                </button>
                {path.map((crumb, i) => (
                  <span key={crumb.id} style={{ display: 'contents' }}>
                    <ChevronRight size={14} />
                    <button
                      type="button"
                      onClick={() => goToCrumb(i)}
                      className={i === path.length - 1 ? 'crumb-current' : ''}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}

            {state.files.length === 0 ? (
              <p className="text-sm text-muted-foreground">This folder is empty.</p>
            ) : (
              <div key={path.map((p) => p.id).join('/')} className={`doxx-list manage-resources-list slide-${direction}`}>
                {state.files.map((f) => {
                  const folder = isDriveFolder(f);
                  const Icon = folder ? Folder : FILE_KIND_ICON[getFileKind(f.name)];
                  return (
                    <button
                      type="button"
                      key={f.id}
                      className="doxx-row manage-resources-row"
                      onClick={() => {
                        if (folder) openFolder(f);
                        else if (f.webViewLink) window.open(f.webViewLink, '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <span className="manage-resources-row-main">
                        <Icon size={18} strokeWidth={1.6} className="manage-resources-row-icon" />
                        <span className="doxx-row-title">{f.name}</span>
                      </span>
                      <span className="doxx-row-meta manage-resources-row-meta">
                        {folder ? '—' : formatBytes(f.size)}
                      </span>
                      <span className="doxx-row-meta manage-resources-row-meta">
                        {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}
                      </span>
                      {folder ? <ChevronRight size={18} /> : <ExternalLink size={16} />}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

