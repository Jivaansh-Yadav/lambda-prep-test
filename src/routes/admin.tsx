import { createFileRoute } from '@tanstack/react-router';
import { Fragment, useEffect, useRef, useState } from 'react';
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
import {
  Activity,
  ChevronRight,
  Eye,
  ExternalLink,
  File,
  FileImage,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  GitCommit,
  Loader2,
  MessageSquareText,
  Pencil,
  Share2,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  checkAdminPasscode,
  getAdminTraffic,
  getAdminRum,
  getManageResources,
  triggerDatasetUpdate,
  getDatasetUpdateStatus,
  getAdminResourceStats,
  getAdminLatestCommit,
  uploadResource,
  renameResource,
  deleteResource,
  getDriveWriteCapability,
  type AdminTrafficResult,
  type AdminRumResult,
  type RumBreakdownItem,
  type ManageResourcesResult,
  type AdminResourceStatsResult,
  type AdminLatestCommitResult,
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
  const [openSection, setOpenSection] = useState<'analytics' | 'manage' | 'stats' | null>(null);
  const [rumResult, setRumResult] = useState<AdminRumResult | null>(null);
  const [rumLoading, setRumLoading] = useState(false);

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

  async function loadRum(code: string) {
    setRumLoading(true);
    try {
      const data = await getAdminRum({ data: { passcode: code } });
      setRumResult(data);
    } catch {
      setRumResult({ configured: false, reason: 'Could not load Web Analytics (RUM) data. Try again.' });
    } finally {
      setRumLoading(false);
    }
  }

  // Lazily fetches RUM detail the first time the Deep analytics modal is
  // opened, rather than on every page load — it's a second Cloudflare
  // credential/dataset the admin may not have configured yet.
  useEffect(() => {
    if (openSection === 'analytics' && !rumResult && !rumLoading) {
      void loadRum(adminSessionPasscode ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSection]);


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
          pageLoads: acc.pageLoads + d.pageLoads,
          visits: acc.visits + d.visits,
        }),
        { pageLoads: 0, visits: 0 },
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Admin dashboard</h1>
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

      {/* Top summary: at-a-glance web analytics totals, plus the latest commit.
          Only two real metrics come out of the RUM dataset (page loads and
          visits — no raw request count or unique-visitor count), so there
          are two KPI cards here instead of the old zone-analytics four. */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Page loads (30d)" value={totals ? totals.pageLoads.toLocaleString() : '—'} accent="indigo" />
        <KpiCard label="Visits (30d)" value={totals ? totals.visits.toLocaleString() : '—'} accent="emerald" />
        <LatestCommitCard />
      </div>

      {result && !result.configured && (
        <Card className="mb-8">
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-foreground">Web Analytics not configured</p>
            <p className="mt-2 text-sm text-muted-foreground">{result.reason}</p>
            <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Find the account ID in the Cloudflare dashboard sidebar, and the site token in{' '}
                <span className="font-mono">Web Analytics → Manage site → Beacon</span>.
              </li>
              <li>
                Create an API token under <span className="font-mono">My Profile → API Tokens</span> with{' '}
                <span className="font-mono">Account → Analytics → Read</span> permission.
              </li>
              <li>
                Set <span className="font-mono">CLOUDFLARE_ACCOUNT_ID</span>,{' '}
                <span className="font-mono">CLOUDFLARE_RUM_API_TOKEN</span> and{' '}
                <span className="font-mono">CLOUDFLARE_RUM_SITE_TAG</span> in the server environment, then refresh.
              </li>
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Three clickable cards: each opens its matching section in a
          full-screen modal instead of rendering inline, so the top-level
          page stays a quick-glance summary + three clear entry points. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CategoryCard
          accent="indigo"
          icon={<Activity size={20} />}
          title="Deep analytics"
          description="Traffic charts and section breakdown for the last 30 days."
          onClick={() => setOpenSection('analytics')}
        />
        <CategoryCard
          accent="emerald"
          icon={<FolderOpen size={20} />}
          title="Manage resources"
          description="Browse, upload, rename and delete files in the live Drive folder."
          onClick={() => setOpenSection('manage')}
        />
        <CategoryCard
          accent="amber"
          icon={<Star size={20} />}
          title="Resource stats"
          description="Ratings, feedback, views and shares for every resource file."
          onClick={() => setOpenSection('stats')}
        />
      </div>

      {openSection === 'analytics' && (
        <SectionModal title="Deep analytics" icon={<Activity size={16} />} onClose={() => setOpenSection(null)}>
          {result?.configured && totals ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Traffic — last 30 days</CardTitle>
                </CardHeader>
                <CardContent className="h-80">
                  {result.days.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No data yet — the beacon hasn't recorded any page loads.</p>
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
                        <Line type="monotone" dataKey="pageLoads" name="Page loads" stroke="#6366f1" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="visits" name="Visits" stroke="#22c55e" strokeWidth={2} dot={false} />
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
          ) : (
            <p className="text-sm text-muted-foreground">
              {result ? 'Cloudflare analytics is not configured — see the notice above.' : 'Loading…'}
            </p>
          )}

          <RumAnalyticsSection result={rumResult} loading={rumLoading} />
        </SectionModal>
      )}

      {openSection === 'manage' && (
        <SectionModal title="Manage resources" icon={<FolderOpen size={16} />} onClose={() => setOpenSection(null)}>
          <ManageResourcesCard />
        </SectionModal>
      )}

      {openSection === 'stats' && (
        <SectionModal title="Resource stats" icon={<Star size={16} />} onClose={() => setOpenSection(null)}>
          <ResourceStatsCard />
        </SectionModal>
      )}
    </div>
  );
}

const SECTION_COLORS = ['#6366f1', '#22c55e'];

/** Tailwind utility classes per accent color, used by both KpiCard and
 * CategoryCard so every card in a given category shares one color
 * identity (icon chip + left border) without hand-picking hexes per call
 * site. */
const ACCENT_CLASSES = {
  indigo: { chip: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400', border: 'border-l-indigo-500' },
  emerald: { chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', border: 'border-l-emerald-500' },
  amber: { chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', border: 'border-l-amber-500' },
  rose: { chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400', border: 'border-l-rose-500' },
  sky: { chip: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', border: 'border-l-sky-500' },
} as const;

type Accent = keyof typeof ACCENT_CLASSES;

function KpiCard({ label, value, accent }: { label: string; value: string; accent: Accent }) {
  return (
    <Card className={`border-l-4 ${ACCENT_CLASSES[accent].border}`}>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-3xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  );
}

/** Renders the Web Analytics (RUM) detail panel inside the Deep
 * analytics modal: top pages, countries, device types, browsers and
 * referrers for the last 30 days. Separate from the zone-level traffic
 * chart above it since it's sourced from a different Cloudflare
 * credential/dataset (account-scoped RUM vs zone-scoped httpRequests) —
 * see getAdminRum in admin-server.ts. */
function RumAnalyticsSection({ result, loading }: { result: AdminRumResult | null; loading: boolean }) {
  if (loading && !result) {
    return <p className="mt-6 text-sm text-muted-foreground">Loading Web Analytics (RUM) detail…</p>;
  }

  if (!result) return null;

  if (!result.configured) {
    return (
      <Card className="mt-6">
        <CardContent className="pt-6">
          <p className="text-sm font-medium text-foreground">Web Analytics (RUM) not configured</p>
          <p className="mt-2 text-sm text-muted-foreground">{result.reason}</p>
          <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Find the account ID in the Cloudflare dashboard sidebar, and the site token in{' '}
              <span className="font-mono">Web Analytics → Manage site → Beacon</span>.
            </li>
            <li>
              Create an API token under <span className="font-mono">My Profile → API Tokens</span> with{' '}
              <span className="font-mono">Account → Analytics → Read</span> permission.
            </li>
            <li>
              Set <span className="font-mono">CLOUDFLARE_ACCOUNT_ID</span>,{' '}
              <span className="font-mono">CLOUDFLARE_RUM_API_TOKEN</span> and{' '}
              <span className="font-mono">CLOUDFLARE_RUM_SITE_TAG</span> in the server environment, then refresh.
            </li>
          </ol>
        </CardContent>
      </Card>
    );
  }

  if (result.totalVisits === 0) {
    return (
      <Card className="mt-6">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            No Web Analytics (RUM) visits recorded yet for the last 30 days. The beacon script is live on every
            page — data should start appearing shortly after real visitors load the site.
          </p>
        </CardContent>
      </Card>
    );
  }

  const panels: Array<{ title: string; items: RumBreakdownItem[] }> = [
    { title: 'Top pages', items: result.topPaths },
    { title: 'Top countries', items: result.topCountries },
    { title: 'Device types', items: result.topDeviceTypes },
    { title: 'Browsers', items: result.topBrowsers },
    { title: 'Top referrers', items: result.topReferrers },
  ];

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Web Analytics (RUM) — last 30 days</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          {result.totalVisits.toLocaleString()} real-user page-load visits recorded by the beacon script.
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {panels.map((panel) => (
            <RumBreakdownList key={panel.title} title={panel.title} items={panel.items} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RumBreakdownList({ title, items }: { title: string; items: RumBreakdownItem[] }) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-muted-foreground" title={item.label}>
                {item.label}
              </span>
              <span className="shrink-0 font-mono text-foreground">{item.visits.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A single clickable top-level category card (Deep analytics / Manage
 * resources / Resource stats) that opens its section in a full-screen
 * modal via onClick — replaces the previous always-expanded
 * CategorySection wrapper so the top-level page stays a compact,
 * three-card entry point instead of one long scroll. */
function CategoryCard({
  accent,
  icon,
  title,
  description,
  onClick,
}: {
  accent: Accent;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`admin-category-card admin-category-card-${accent}`}
    >
      <span className="admin-category-icon">{icon}</span>
      <span className="admin-category-text">
        <span className="admin-category-title">{title}</span>
        <span className="admin-category-description">{description}</span>
      </span>
    </button>
  );
}

/** Full-screen modal wrapper used by each of the three category cards'
 * opened section, so the detail content (charts, Drive browser, stats
 * tables) gets room to breathe instead of competing for space on the
 * top-level page. */
function SectionModal({
  title,
  icon,
  onClose,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-4 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="my-8 w-full max-w-4xl rounded-lg border bg-background p-4 shadow-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            {icon} {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
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

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Top-summary card showing the latest Git commit (sha, message, author,
 * relative time) via the already-stored GitHub PAT — no separate Vercel
 * credential, just commit metadata. */
function LatestCommitCard() {
  const [state, setState] = useState<AdminLatestCommitResult | null>(null);

  useEffect(() => {
    getAdminLatestCommit({ data: { passcode: adminSessionPasscode ?? '' } })
      .then(setState)
      .catch(() => setState({ ok: false, reason: 'Could not load the latest commit.' }));
  }, []);

  return (
    <Card className="border-l-4 border-l-sky-500">
      <CardContent className="pt-6">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><GitCommit size={14} /> Latest commit</p>
        {!state && <p className="mt-1 text-sm text-muted-foreground">Loading…</p>}
        {state && !state.ok && <p className="mt-1 text-xs text-muted-foreground">{state.reason}</p>}
        {state?.ok && (
          <>
            <a
              href={state.commit.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 flex items-center gap-1.5 truncate text-sm font-medium text-foreground hover:underline"
              title={state.commit.message}
            >
              <span className="truncate">{state.commit.message}</span>
              <ExternalLink size={13} className="shrink-0 text-muted-foreground" />
            </a>
            <p className="mt-1 text-xs text-muted-foreground">
              <a
                href={state.commit.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:underline hover:text-foreground"
              >
                {state.commit.shortSha}
              </a>{' '}
              · {state.commit.authorName} · {formatRelativeTime(state.commit.authoredAt)}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ManageResourcesCard() {
  const [state, setState] = useState<ManageResourcesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOAuth, setHasOAuth] = useState<boolean | null>(null);

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
  const [showConfirm, setShowConfirm] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Upload: a hidden <input type="file"> triggered by the "+file" button
  // in the header, so the browser's native picker handles file selection.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Rename: at most one row is "in edit mode" at a time, tracked by file
  // id + a draft name seeded from the current name when the pencil icon
  // is clicked.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Delete: the bin icon opens a confirmation modal rather than deleting
  // immediately — Drive trash is recoverable, but an admin still
  // shouldn't be one misclick away from removing a resource everyone
  // else relies on.
  const [deleteTarget, setDeleteTarget] = useState<DriveFileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    getDriveWriteCapability({ data: { passcode: getPasscode() } })
      .then((res) => setHasOAuth(res.hasOAuth))
      .catch(() => setHasOAuth(false));
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
    setShowConfirm(false);
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

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file name later
    if (!file) return;

    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.set('passcode', getPasscode());
      form.set('file', file);
      if (currentFolderId) form.set('folderId', currentFolderId);
      const res = await uploadResource({ data: form });
      if (res.ok) {
        void load(currentFolderId);
      } else {
        setUploadError(res.reason);
      }
    } catch {
      setUploadError('Could not upload the file. Try again.');
    } finally {
      setUploading(false);
    }
  }

  function startRename(f: DriveFileEntry) {
    setRenameError(null);
    setRenamingId(f.id);
    setRenameValue(f.name);
  }

  async function confirmRename(fileId: string) {
    const newName = renameValue.trim();
    if (!newName) {
      setRenameError('Name cannot be empty.');
      return;
    }
    setRenameSaving(true);
    setRenameError(null);
    try {
      const res = await renameResource({ data: { passcode: getPasscode(), fileId, newName } });
      if (res.ok) {
        setRenamingId(null);
        void load(currentFolderId);
      } else {
        setRenameError(res.reason);
      }
    } catch {
      setRenameError('Could not rename the file. Try again.');
    } finally {
      setRenameSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteResource({ data: { passcode: getPasscode(), fileId: deleteTarget.id } });
      if (res.ok) {
        setDeleteTarget(null);
        void load(currentFolderId);
      } else {
        setDeleteError(res.reason);
      }
    } catch {
      setDeleteError('Could not delete the file. Try again.');
    } finally {
      setDeleting(false);
    }
  }

  const isRunning = updateStatus ? updateStatus.status !== 'completed' : updateRunId !== null && !updateError;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Manage resources</CardTitle>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !state?.configured}
            title="Upload a file into the current folder"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />}
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load(currentFolderId)} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          Lists files live from the configured Google Drive folder — not from the committed JSON datasets.
        </p>

        {uploadError && <p className="mb-4 text-sm text-destructive">{uploadError}</p>}

        <div className="mb-6 rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Update resource datasets</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Re-crawls Drive, regenerates the committed JSON datasets, and commits the result — via the{' '}
                <span className="font-mono">update-resources.yml</span> GitHub Actions workflow.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowConfirm(true)} disabled={triggering || isRunning}>
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
            {hasOAuth === false && (
              <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Uploads may fail: no real Google account is configured for Drive writes (only the
                  read-only service account). Set <span className="font-mono">GDRIVE_CLIENT_ID</span>,{' '}
                  <span className="font-mono">GDRIVE_CLIENT_SECRET</span> and{' '}
                  <span className="font-mono">GDRIVE_REFRESH_TOKEN</span> in the server environment for an
                  account with Editor access to this folder.
                </p>
              </div>
            )}

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
                  const isRenaming = renamingId === f.id;
                  return (
                    <div key={f.id} className="doxx-row manage-resources-row manage-resources-row-editable">
                      {isRenaming ? (
                        <span className="manage-resources-row-main">
                          <Icon size={18} strokeWidth={1.6} className="manage-resources-row-icon" />
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void confirmRename(f.id);
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="h-8"
                          />
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="manage-resources-row-main manage-resources-row-open"
                          onClick={() => {
                            if (folder) openFolder(f);
                            else if (f.webViewLink) window.open(f.webViewLink, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          <Icon size={18} strokeWidth={1.6} className="manage-resources-row-icon" />
                          <span className="doxx-row-title">{f.name}</span>
                        </button>
                      )}

                      {!isRenaming && (
                        <>
                          <span className="doxx-row-meta manage-resources-row-meta">
                            {folder ? '—' : formatBytes(f.size)}
                          </span>
                          <span className="doxx-row-meta manage-resources-row-meta">
                            {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : '—'}
                          </span>
                        </>
                      )}

                      <span className="manage-resources-row-actions">
                        {isRenaming ? (
                          <>
                            <button
                              type="button"
                              className="manage-resources-icon-btn"
                              onClick={() => void confirmRename(f.id)}
                              disabled={renameSaving}
                              aria-label="Save name"
                            >
                              {renameSaving ? <Loader2 size={15} className="animate-spin" /> : '✓'}
                            </button>
                            <button
                              type="button"
                              className="manage-resources-icon-btn"
                              onClick={() => setRenamingId(null)}
                              disabled={renameSaving}
                              aria-label="Cancel rename"
                            >
                              <X size={15} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="manage-resources-icon-btn"
                              onClick={() => startRename(f)}
                              aria-label={`Rename ${f.name}`}
                              title="Rename"
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              className="manage-resources-icon-btn manage-resources-icon-btn-danger"
                              onClick={() => setDeleteTarget(f)}
                              aria-label={`Delete ${f.name}`}
                              title="Delete"
                            >
                              <Trash2 size={15} />
                            </button>
                            {!folder && f.webViewLink && (
                              <a
                                href={f.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="manage-resources-icon-btn"
                                aria-label={`Open ${f.name}`}
                                title="Open"
                              >
                                <ExternalLink size={15} />
                              </a>
                            )}
                            {folder && (
                              <button
                                type="button"
                                className="manage-resources-icon-btn"
                                onClick={() => openFolder(f)}
                                aria-label={`Open folder ${f.name}`}
                                title="Open"
                              >
                                <ChevronRight size={15} />
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {renamingId && renameError && <p className="mt-3 text-sm text-destructive">{renameError}</p>}
          </>
        )}
      </CardContent>

      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setShowConfirm(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm dataset update"
          >
            <h3 className="text-base font-semibold text-foreground">Update resource datasets?</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This re-crawls the Google Drive folder below, regenerates every committed JSON dataset, and
              commits the result to the repo. It runs as a GitHub Actions workflow and is{' '}
              <span className="font-medium text-foreground">not stoppable</span> once started — it can take
              several minutes.
            </p>
            <div className="mt-3 rounded-md border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Drive folder to be crawled</p>
              {state?.configured ? (
                <a
                  href={state.rootFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-center gap-1.5 break-all text-sm text-primary hover:underline"
                >
                  {state.rootFolderUrl} <ExternalLink size={13} className="shrink-0" />
                </a>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Unknown — Drive isn't configured.</p>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleTriggerUpdate()}>
                Start update
              </Button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => !deleting && setDeleteTarget(null)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg border bg-background p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Confirm delete"
          >
            <h3 className="text-base font-semibold text-foreground">Delete this file?</h3>
            <p className="mt-2 break-words text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{deleteTarget.name}</span> will be moved to the
              Drive trash. It stays recoverable there for 30 days.
            </p>
            {deleteError && <p className="mt-3 text-sm text-destructive">{deleteError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={() => void confirmDelete()} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

type StatsTab = 'ratings' | 'feedback' | 'views' | 'shares';

const STATS_TABS: Array<{ key: StatsTab; label: string; icon: typeof Star }> = [
  { key: 'ratings', label: 'Ratings', icon: Star },
  { key: 'feedback', label: 'Feedback', icon: MessageSquareText },
  { key: 'views', label: 'Views', icon: Eye },
  { key: 'shares', label: 'Shares', icon: Share2 },
];

/** "Resource stats" panel: a summary row of the four counts (ratings,
 * feedback, views, shares) that opens a modal with one table per
 * category — each table lists every file plus a direct Drive link, so an
 * admin can jump straight to the file being discussed/rated/viewed/shared. */
function ResourceStatsCard() {
  const [state, setState] = useState<AdminResourceStatsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<StatsTab | null>(null);

  function getPasscode() {
    return adminSessionPasscode ?? '';
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminResourceStats({ data: { passcode: getPasscode() } });
      setState(data);
    } catch {
      setError('Could not load resource stats.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Resource stats</CardTitle>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {state && !state.configured && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">{state.reason}</p>
          </div>
        )}

        {state?.configured && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {STATS_TABS.map(({ key, label, icon: Icon }) => {
              const count = state[key].length;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setOpenTab(key)}
                  className="flex flex-col items-start gap-2 rounded-lg border bg-muted/20 p-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Icon size={15} /> {label}
                  </span>
                  <span className="text-2xl font-semibold text-foreground">{count}</span>
                  <span className="text-xs text-muted-foreground">files · tap to open</span>
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      {state?.configured && openTab && (
        <StatsModal tab={openTab} state={state} onClose={() => setOpenTab(null)} />
      )}
    </Card>
  );
}

function StatsModal({
  tab,
  state,
  onClose,
}: {
  tab: StatsTab;
  state: Extract<AdminResourceStatsResult, { configured: true }>;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tabMeta = STATS_TABS.find((t) => t.key === tab)!;
  const Icon = tabMeta.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={tabMeta.label}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Icon size={16} /> {tabMeta.label}
          </h3>
          <button type="button" onClick={onClose} className="rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-auto">
          {tab === 'ratings' && (
            state.ratings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No ratings submitted yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Drive link</TableHead>
                    <TableHead>Average</TableHead>
                    <TableHead>Ratings</TableHead>
                    <TableHead>Last rated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.ratings.map((r) => (
                    <Fragment key={r.fileId}>
                      <TableRow key={r.fileId} className="border-b-0">
                        <TableCell className="max-w-xs truncate" title={r.fileName}>{r.fileName}</TableCell>
                        <TableCell>
                          <a href={r.driveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Open <ExternalLink size={13} />
                          </a>
                        </TableCell>
                        <TableCell>{r.average.toFixed(1)} / 5</TableCell>
                        <TableCell>{r.count}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(r.lastRatedAt)}</TableCell>
                      </TableRow>
                      <TableRow key={`${r.fileId}-class`}>
                        <TableCell colSpan={5} className="pt-0 text-xs text-muted-foreground">{r.classLabel}</TableCell>
                      </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )
          )}

          {tab === 'feedback' && (
            state.feedback.length === 0 ? (
              <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Drive link</TableHead>
                    <TableHead>Feedback</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.feedback.map((f) => (
                    <Fragment key={f.id}>
                      <TableRow key={f.id} className="border-b-0">
                        <TableCell className="max-w-xs truncate" title={f.fileName}>{f.fileName}</TableCell>
                        <TableCell>
                          <a href={f.driveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Open <ExternalLink size={13} />
                          </a>
                        </TableCell>
                        <TableCell className="max-w-sm whitespace-pre-wrap break-words">{f.feedback}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(f.createdAt)}</TableCell>
                      </TableRow>
                      <TableRow key={`${f.id}-class`}>
                        <TableCell colSpan={4} className="pt-0 text-xs text-muted-foreground">{f.classLabel}</TableCell>
                      </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )
          )}

          {tab === 'views' && (
            state.views.length === 0 ? (
              <p className="text-sm text-muted-foreground">No views recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Drive link</TableHead>
                    <TableHead>Views</TableHead>
                    <TableHead>Last viewed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.views.map((v) => (
                    <Fragment key={v.fileId}>
                      <TableRow key={v.fileId} className="border-b-0">
                        <TableCell className="max-w-xs truncate" title={v.fileName}>{v.fileName}</TableCell>
                        <TableCell>
                          <a href={v.driveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Open <ExternalLink size={13} />
                          </a>
                        </TableCell>
                        <TableCell>{v.viewCount.toLocaleString()}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(v.lastViewedAt)}</TableCell>
                      </TableRow>
                      <TableRow key={`${v.fileId}-class`}>
                        <TableCell colSpan={4} className="pt-0 text-xs text-muted-foreground">{v.classLabel}</TableCell>
                      </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )
          )}

          {tab === 'shares' && (
            state.shares.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shares recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>File</TableHead>
                    <TableHead>Drive link</TableHead>
                    <TableHead>Shares</TableHead>
                    <TableHead>Last shared</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.shares.map((s) => (
                    <Fragment key={s.fileId}>
                      <TableRow key={s.fileId} className="border-b-0">
                        <TableCell className="max-w-xs truncate" title={s.fileName}>{s.fileName}</TableCell>
                        <TableCell>
                          <a href={s.driveUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Open <ExternalLink size={13} />
                          </a>
                        </TableCell>
                        <TableCell>{s.shareCount.toLocaleString()}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(s.lastSharedAt)}</TableCell>
                      </TableRow>
                      <TableRow key={`${s.fileId}-class`}>
                        <TableCell colSpan={4} className="pt-0 text-xs text-muted-foreground">{s.classLabel}</TableCell>
                      </TableRow>
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )
          )}
        </div>
      </div>
    </div>
  );
}
