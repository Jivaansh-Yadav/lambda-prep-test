import { createFileRoute } from '@tanstack/react-router';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useGoBack } from '@/hooks/use-go-back';
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
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
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
  HeartHandshake,
  Link2,
  Loader2,
  Mail,
  MessageSquareText,
  MinusCircle,
  Pencil,
  RefreshCw,
  Share2,
  Star,
  Trash2,
  TrendingUp,
  UploadCloud,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  checkAdminPasscode,
  getAdminTraffic,
  getAdminRum,
  getManageResources,
  triggerDatasetUpdate,
  getDatasetUpdateStatus,
  getDatasetUpdateOverview,
  getAdminResourceStats,
  getAdminLatestCommit,
  uploadResource,
  renameResource,
  deleteResource,
  getDriveWriteCapability,
  ADMIN_RANGES,
  ADMIN_RANGE_LABEL,
  type AdminRange,
  type AdminTrafficResult,
  type AdminRumResult,
  type HostBreakdownItem,
  type RumBreakdownItem,
  type ManageResourcesResult,
  type AdminResourceStatsResult,
  type AdminLatestCommitResult,
} from '@/lib/admin-server';
import {
  getAdminContributions,
  updateContributionStatus,
  type AdminContributionRow,
  type AdminContributionsResult,
  type ContributionStatus,
} from '@/lib/contribute-server';
import {
  getAdminContactMessages,
  updateContactMessageStatus,
  type AdminContactMessageRow,
  type AdminContactMessagesResult,
  type ContactMessageStatus,
} from '@/lib/contact-server';
import {
  WORKFLOW_CATEGORIES,
  categorizeRun,
  formatDuration,
  runProgress,
  statusTone,
  type CategoryGroup,
  type WorkflowRunStatus,
  type WorkflowRunSummary,
  type WorkflowStep,
} from '@/lib/workflow-progress';
import type { DriveFileEntry } from '@/lib/drive-integration-server';
import { getFileKind, type FileKind } from '@/lib/resources-data';

const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
function isDriveFolder(entry: DriveFileEntry): boolean {
  return entry.mimeType === DRIVE_FOLDER_MIME;
}

type AdminSection = 'analytics' | 'manage' | 'stats' | 'contributions' | 'messages';
const ADMIN_SECTIONS: AdminSection[] = ['analytics', 'manage', 'stats', 'contributions', 'messages'];

interface AdminSearch {
  section?: AdminSection | undefined;
}

export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>): AdminSearch => ({
    section: ADMIN_SECTIONS.includes(search['section'] as AdminSection) ? (search['section'] as AdminSection) : undefined,
  }),
  head: () => ({ meta: [{ name: 'robots', content: 'noindex, nofollow' }, { title: 'Lambda Prep | Admin' }] }),
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
  const [range, setRange] = useState<AdminRange>('30d');
  const { section: openSection } = Route.useSearch();
  const navigate = Route.useNavigate();
  function setOpenSection(next: AdminSection | null) {
    void navigate({ search: (prev) => ({ ...prev, section: next ?? undefined }) });
  }
  // Opening a section pushes `?section=...` onto this tab's own history
  // (see the onClick handlers below), so the browser's own Back always
  // undoes that — falling back to clearing the param only when there's
  // nowhere left to go back to (e.g. a bookmarked/deep `?section=` URL).
  const { canGoBack, goBack } = useGoBack();
  function closeSection() {
    if (canGoBack) goBack();
    else setOpenSection(null);
  }
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
        // Drop anything fetched before the passcode existed (a deep link to
        // ?section=analytics mounts this component unauthenticated, so its
        // effects can fire with an empty passcode and set sticky errors).
        setResult(null);
        setRumResult(null);
        setAuthed(true);
        await loadTraffic(passcode, range);
      } else if (check.lockedOutSeconds) {
        setError(`Too many attempts. Try again in ${check.lockedOutSeconds}s.`);
      } else {
        setError('Incorrect passcode.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : '';
      setError(
        message && message.length <= 200 ? `Could not verify the passcode: ${message}` : 'Something went wrong. Try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadTraffic(code: string, forRange: AdminRange) {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminTraffic({ data: { passcode: code, range: forRange } });
      setResult(data);
    } catch (error) {
      // Surface what actually failed. Server functions throw for a rejected
      // passcode ("Unauthorized") but also for a Neon/Cloudflare failure, and
      // a single opaque message for both sends you looking in the wrong place.
      const message = error instanceof Error ? error.message.trim() : '';
      const unauthorized = /unauthor/i.test(message);
      setError(
        unauthorized
          ? 'Passcode rejected — unlock again.'
          : message && message.length <= 200
            ? `Could not load analytics: ${message}`
            : 'Could not load analytics. Try unlocking again.',
      );
      setAuthed(false);
      adminSessionPasscode = null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed && !result && !loading) {
      void loadTraffic(adminSessionPasscode ?? '', range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  async function loadRum(code: string, forRange: AdminRange) {
    setRumLoading(true);
    try {
      const data = await getAdminRum({ data: { passcode: code, range: forRange } });
      setRumResult(data);
    } catch (error) {
      const message = error instanceof Error ? error.message.trim() : '';
      if (/unauthor/i.test(message)) {
        // Same passcode as the traffic panel; if this one is rejected the
        // session is gone, so show the unlock form again rather than a
        // "not configured" card with setup instructions that don't apply.
        setError('Passcode rejected — unlock again.');
        setAuthed(false);
        adminSessionPasscode = null;
        setRumResult(null);
        return;
      }
      setRumResult({
        configured: false,
        reason:
          message && message.length <= 200
            ? `Could not load Web Analytics (RUM) data: ${message}`
            : 'Could not load Web Analytics (RUM) data. Try again.',
      });
    } finally {
      setRumLoading(false);
    }
  }

  // Lazily fetches RUM detail the first time the Deep analytics modal is
  // opened, rather than on every page load — it's a second Cloudflare
  // credential/dataset the admin may not have configured yet.
  useEffect(() => {
    if (!authed || !adminSessionPasscode) return;
    if (openSection === 'analytics' && !rumResult && !rumLoading) {
      void loadRum(adminSessionPasscode, range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSection, authed]);

  // Changing the range re-fetches both datasets for the new window and
  // discards the previous range's data (rather than keeping stale numbers
  // visible) — both come from the same per-range Neon cache on the
  // server, so this is usually a cheap cache hit rather than a live
  // Cloudflare call.
  function handleRangeChange(next: AdminRange) {
    setRange(next);
    setResult(null);
    setRumResult(null);
    if (authed) {
      void loadTraffic(adminSessionPasscode ?? '', next);
      if (openSection === 'analytics') {
        void loadRum(adminSessionPasscode ?? '', next);
      }
    }
  }


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

  // Every host Cloudflare recorded page loads for in this window, versus the
  // single host these numbers are filtered to (TRACKED_HOST, derived from
  // SITE_URL in admin-server.ts). If the panel is counting a host that no
  // longer receives traffic while another one in the account does, the domain
  // moved and SITE_URL needs to follow — say so instead of showing a bare zero.
  const hostRows = result?.configured ? (result.hosts ?? []) : [];
  const trackedHost = result?.configured ? result.trackedHost : undefined;
  const untrackedHosts = trackedHost ? hostRows.filter((h) => h.host !== trackedHost) : [];
  const busiestUntracked = untrackedHosts.reduce<HostBreakdownItem | null>(
    (best, h) => (best === null || h.visits > best.visits ? h : best),
    null,
  );
  const hostDrift =
    trackedHost !== undefined && (totals?.visits ?? 0) === 0 && (busiestUntracked?.visits ?? 0) > 0
      ? busiestUntracked
      : null;

  // A section is a full-width page (driven by the ?section= query param)
  // rather than a capped-height modal, so charts, the Drive browser and
  // stats tables all get the full viewport width to work with instead of
  // being squeezed into a max-w-4xl box.
  if (openSection) {
    const SECTION_META: Record<AdminSection, { title: string; icon: React.ReactNode }> = {
      analytics: { title: 'Deep analytics', icon: <Activity size={18} /> },
      manage: { title: 'Manage resources', icon: <FolderOpen size={18} /> },
      stats: { title: 'Resource stats', icon: <Star size={18} /> },
      contributions: { title: 'Contributed resources', icon: <HeartHandshake size={18} /> },
      messages: { title: 'Contact messages', icon: <Mail size={18} /> },
    };
    const meta = SECTION_META[openSection];
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-10">
        <button
          type="button"
          onClick={closeSection}
          className="mb-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={15} /> Admin dashboard
        </button>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            {meta.icon} {meta.title}
          </h1>
          {openSection === 'analytics' && <RangeSelect value={range} onChange={handleRangeChange} />}
        </div>

        {openSection === 'analytics' && (
          <>
            {result?.configured && totals ? (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Traffic — {ADMIN_RANGE_LABEL[range]}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80 sm:h-96">
                    {result.days.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No page loads recorded for this window yet. If the Cloudflare dashboard shows traffic for
                        this site, check that the <span className="font-mono">cloudflare_integration</span> row's
                        account ID is the one that owns it.
                      </p>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={result.days}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(v: string) =>
                              range === '24h'
                                ? new Date(v).toLocaleTimeString([], { hour: 'numeric' })
                                : new Date(v).toLocaleDateString([], { month: 'short', day: 'numeric' })
                            }
                            tick={{ fontSize: 12 }}
                          />
                          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                          <Tooltip
                            labelFormatter={(v: string) =>
                              range === '24h'
                                ? new Date(v).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })
                                : new Date(v).toLocaleDateString()
                            }
                          />
                          <Line type="monotone" dataKey="pageLoads" name="Page loads" stroke="#6366f1" strokeWidth={2} dot={false} />
                          <Line type="monotone" dataKey="visits" name="Visits" stroke="#22c55e" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                    </div>
                    {hostRows.length > 0 && (
                      <div className="mt-4 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                          <span className="font-medium text-foreground">Collected from</span>
                          {hostRows.map((h) => (
                            <span key={h.host} className={h.host === trackedHost ? '' : 'opacity-60'}>
                              <span className="font-mono text-foreground">{h.host}</span> —{' '}
                              {h.pageLoads.toLocaleString()} loads · {h.visits.toLocaleString()} visits
                              {h.host === trackedHost ? '' : ' (not counted)'}
                            </span>
                          ))}
                        </div>
                        {hostDrift ? (
                          <p className="mt-2 text-amber-600 dark:text-amber-400">
                            Every visit in this window landed on <span className="font-mono">{hostDrift.host}</span>,
                            but this panel reports on <span className="font-mono">{trackedHost}</span>. Point{' '}
                            <span className="font-mono">SITE_URL</span> in{' '}
                            <span className="font-mono">src/lib/lambda-prep.ts</span> at the domain actually
                            serving the app.
                          </p>
                        ) : untrackedHosts.length > 0 && trackedHost ? (
                          <p className="mt-2">
                            Counted host: <span className="font-mono">{trackedHost}</span>. Other hosts in this
                            Cloudflare account are listed for context but excluded from the totals above.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="mt-6">
                  <CardHeader>
                    <CardTitle>Visits by section — {ADMIN_RANGE_LABEL[range]}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="h-64 sm:h-72">
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

            <RumAnalyticsSection result={rumResult} loading={rumLoading} range={range} />
          </>
        )}

        {openSection === 'manage' && <ManageResourcesCard />}

        {openSection === 'stats' && <ResourceStatsCard />}

        {openSection === 'contributions' && <ContributedResourcesCard />}

        {openSection === 'messages' && <ContactMessagesCard />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-foreground">Admin dashboard</h1>
        <div className="flex items-center gap-3">
          {result?.configured && (
            <span className="text-xs text-muted-foreground">
              {result.cache.hit ? 'Cached' : 'Live'} ·{' '}
              {new Date(result.cache.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <RangeSelect value={range} onChange={handleRangeChange} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadTraffic(adminSessionPasscode ?? '', range)}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {/* Group 1: Analytics — at-a-glance numbers (KpiCard/LatestCommitCard,
          read-only) plus the one clickable drill-down into full charts
          (Deep analytics) that naturally belongs with the rest of the
          analytics data rather than the Manage row below it. All four
          sit in a single row so the group reads as one glance, not two
          stacked rows. Cool blue/violet/indigo accents mark this whole
          group as "analytics", distinct from the warm, action-oriented
          Manage group below. */}
      <p className="admin-group-label">Analytics</p>
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={`Page loads (${range})`}
          value={totals ? totals.pageLoads.toLocaleString() : '—'}
          accent="indigo"
          icon={<TrendingUp size={20} />}
        />
        <KpiCard
          label={`Visits (${range})`}
          value={totals ? totals.visits.toLocaleString() : '—'}
          accent="violet"
          icon={<Users size={20} />}
        />
        <LatestCommitCard />
        <CategoryCard
          accent="indigo-deep"
          icon={<Activity size={20} />}
          title="Deep analytics"
          onClick={() => setOpenSection('analytics')}
        />
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
                Set <span className="font-mono">account_id</span> and{' '}
                <span className="font-mono">rum_api_token</span> on the{' '}
                <span className="font-mono">cloudflare_integration</span> row in Neon, then refresh.
              </li>
              <li>
                No site token or site tag is needed — the queries filter by the request hostname taken
                from <span className="font-mono">SITE_URL</span>, so a new domain or Pages project reports
                as soon as traffic lands on it.
              </li>
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Group 2: Manage — every card here is clickable and opens a
          full-width page (?section=...). Warm emerald/amber/rose/teal
          accents and a trailing chevron mark the whole row as actionable,
          visually distinct from the read-only/analytics group above. */}
      <p className="admin-group-label">Manage</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <CategoryCard
          accent="emerald"
          icon={<FolderOpen size={20} />}
          title="Manage resources"
          onClick={() => setOpenSection('manage')}
        />
        <CategoryCard
          accent="amber"
          icon={<Star size={20} />}
          title="Resource stats"
          onClick={() => setOpenSection('stats')}
        />
        <CategoryCard
          accent="rose"
          icon={<HeartHandshake size={20} />}
          title="Contributed resources"
          onClick={() => setOpenSection('contributions')}
        />
        <CategoryCard
          accent="teal"
          icon={<Mail size={20} />}
          title="Contact messages"
          onClick={() => setOpenSection('messages')}
        />
      </div>
    </div>
  );
}

const SECTION_COLORS = ['#6366f1', '#22c55e'];

/** Accent color identity shared by every top-level tile (KpiCard,
 * LatestCommitCard, CategoryCard) via the admin-category-card-{accent}
 * CSS variants in styles.css. The Analytics group (KpiCard/LatestCommitCard)
 * uses cool blue/violet/sky accents; the Manage group (CategoryCard) uses a
 * deeper indigo plus warm emerald/amber — distinct palettes so the two
 * show-only vs clickable rows read as separate categories at a glance. */
type Accent = 'indigo' | 'violet' | 'sky' | 'indigo-deep' | 'emerald' | 'amber' | 'rose' | 'teal';

/** The analytics lookback-window toggle shown next to the top-level
 * dashboard header and again inside the Deep analytics page — a single
 * Radix Select backs both, driven by the same `range` state so switching
 * it in either place re-fetches the traffic + RUM data for the new
 * window (see handleRangeChange in AdminPage). */
function RangeSelect({ value, onChange }: { value: AdminRange; onChange: (next: AdminRange) => void }) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as AdminRange)}>
      <SelectTrigger className="h-9 w-[132px] text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ADMIN_RANGES.map((r) => (
          <SelectItem key={r} value={r}>
            {ADMIN_RANGE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function KpiCard({
  label,
  value,
  accent,
  icon,
}: {
  label: string;
  value: string;
  accent: Accent;
  icon: React.ReactNode;
}) {
  return (
    <div className={`admin-category-card admin-kpi-card admin-category-card-${accent}`}>
      <span className="admin-category-icon">{icon}</span>
      <span className="admin-category-text">
        <span className="admin-kpi-label">{label}</span>
        <span className="admin-kpi-value">{value}</span>
      </span>
    </div>
  );
}

/** Renders the Web Analytics (RUM) detail panel inside the Deep
 * analytics modal: top pages, countries, device types, browsers and
 * referrers for the selected lookback window. Separate from the
 * zone-level traffic chart above it since it's sourced from a different
 * Cloudflare credential/dataset (account-scoped RUM vs zone-scoped
 * httpRequests) — see getAdminRum in admin-server.ts. */
function RumAnalyticsSection({
  result,
  loading,
  range,
}: {
  result: AdminRumResult | null;
  loading: boolean;
  range: AdminRange;
}) {
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
              Set <span className="font-mono">account_id</span> and{' '}
              <span className="font-mono">rum_api_token</span> on the{' '}
              <span className="font-mono">cloudflare_integration</span> row in Neon, then refresh.
            </li>
            <li>
              No site token or site tag is needed — the queries filter by the request hostname taken from{' '}
              <span className="font-mono">SITE_URL</span>, so a new domain or Pages project reports as soon
              as traffic lands on it.
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
            No Web Analytics (RUM) visits recorded yet for the {ADMIN_RANGE_LABEL[range]}. Cloudflare Pages
            reports page loads for the project's own hostname automatically, so traffic usually shows up on the
            Pages dashboard first and here within a few minutes of the next visitor.
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
        <CardTitle>Web Analytics (RUM) — {ADMIN_RANGE_LABEL[range]}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          {result.totalVisits.toLocaleString()} real-user page-load visits Cloudflare recorded for this site.
        </p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
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
  onClick,
}: {
  accent: Accent;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`admin-category-card admin-category-card-clickable admin-category-card-${accent}`}
    >
      <span className="admin-category-icon">{icon}</span>
      <span className="admin-category-title">{title}</span>
      <ChevronRight size={18} className="admin-category-chevron" />
    </button>
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
    <div className="admin-category-card admin-kpi-card admin-category-card-sky">
      <span className="admin-category-icon">
        <GitCommit size={20} />
      </span>
      <span className="admin-category-text">
        <span className="admin-kpi-label">Latest commit</span>
        {!state && <span className="text-sm text-muted-foreground">Loading…</span>}
        {state && !state.ok && <span className="text-xs text-muted-foreground">{state.reason}</span>}
        {state?.ok && (
          <>
            <a
              href={state.commit.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground hover:underline"
              title={state.commit.message}
            >
              <span className="truncate">{state.commit.message}</span>
              <ExternalLink size={13} className="shrink-0 text-muted-foreground" />
            </a>
            <span className="text-xs text-muted-foreground">
              <a
                href={state.commit.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:underline hover:text-foreground"
              >
                {state.commit.shortSha}
              </a>{' '}
              · {state.commit.authorName} · {formatRelativeTime(state.commit.authoredAt)}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

type DatasetWorkflowPanelProps = {
  getPasscode: () => string;
  rootFolderUrl: string | null;
  /** Called when a tracked run reaches a terminal state, so the caller can
   * refresh the Drive listing it just rebuilt. */
  onFinished: () => void;
};

const WORKFLOW_TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  running: 'text-primary',
  queued: 'text-muted-foreground',
  failed: 'text-destructive',
  skipped: 'text-muted-foreground/70',
  neutral: 'text-muted-foreground',
};

const WORKFLOW_BADGE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  running: 'border-primary/30 bg-primary/10 text-primary',
  queued: 'border-border bg-muted text-muted-foreground',
  failed: 'border-destructive/30 bg-destructive/10 text-destructive',
  skipped: 'border-border bg-muted text-muted-foreground',
  neutral: 'border-border bg-muted text-muted-foreground',
};

function WorkflowStatusIcon({ status, conclusion, size = 14 }: { status: string; conclusion: string | null; size?: number }) {
  const tone = statusTone(status, conclusion);
  if (tone === 'running') return <Loader2 size={size} className="animate-spin text-primary" />;
  if (tone === 'success') return <CheckCircle2 size={size} className="text-emerald-600 dark:text-emerald-400" />;
  if (tone === 'failed') return <XCircle size={size} className="text-destructive" />;
  if (tone === 'skipped') return <MinusCircle size={size} className="text-muted-foreground/70" />;
  return <CircleDashed size={size} className="text-muted-foreground" />;
}

function workflowConclusionLabel(status: string, conclusion: string | null): string {
  if (status === 'queued') return 'Queued';
  if (status === 'in_progress') return 'Running';
  if (conclusion === 'success') return 'Completed';
  if (conclusion === 'skipped') return 'Skipped';
  if (conclusion === 'cancelled') return 'Cancelled';
  if (conclusion) return conclusion.replace(/_/g, ' ');
  return 'Finished';
}

function stepDuration(step: WorkflowStep, now: number): string {
  // A queued step hasn't started yet — GitHub reports no timestamps for it,
  // so don't invent a duration from the run's start time.
  if (step.status === 'queued' || !step.startedAt) return '—';
  const start = new Date(step.startedAt).getTime();
  const end = step.completedAt ? new Date(step.completedAt).getTime() : now;
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';
  return formatDuration(Math.max(0, end - start));
}

function CategoryRow({ group, now }: { group: CategoryGroup; now: number }) {
  const [open, setOpen] = useState(group.key !== 'runner');
  const completed = group.steps.filter((step) => step.status === 'completed').length;
  const hasFailure = group.steps.some(
    (step) => step.conclusion && !['success', 'skipped', 'neutral'].includes(step.conclusion)
  );
  const tone = statusTone(group.status, group.conclusion);

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={13} className="shrink-0 text-muted-foreground" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground" />}
        <WorkflowStatusIcon status={group.status} conclusion={group.conclusion} />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{group.label}</span>
        <span className={`shrink-0 text-[11px] ${hasFailure ? 'text-destructive' : 'text-muted-foreground'}`}>
          {completed}/{group.steps.length} · {formatDuration(group.durationMs)}
        </span>
        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${WORKFLOW_BADGE_CLASS[tone]}`}>
          {workflowConclusionLabel(group.status, group.conclusion)}
        </span>
      </button>

      {open && (
        <ul className="space-y-1 pb-2 pl-9 pr-3">
          {group.steps.map((step) => (
            <li key={`${step.categoryKey}-${step.number}-${step.name}`} className="flex items-center gap-2 text-[11px]">
              <WorkflowStatusIcon status={step.status} conclusion={step.conclusion} size={12} />
              <span
                className={
                  step.status === 'in_progress'
                    ? 'min-w-0 flex-1 truncate font-medium text-foreground'
                    : step.conclusion && !['success', 'skipped', 'neutral'].includes(step.conclusion)
                      ? 'min-w-0 flex-1 truncate text-destructive'
                      : 'min-w-0 flex-1 truncate text-muted-foreground'
                }
                title={`${step.name}${step.conclusion ? ` — ${step.conclusion.replace(/_/g, ' ')}` : ''}`}
              >
                {step.displayName}
              </span>
              <span className={`shrink-0 font-mono ${WORKFLOW_TONE_CLASS[statusTone(step.status, step.conclusion)]}`}>
                {stepDuration(step, now)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Live GitHub Actions tracker for the dataset refresh workflow.
 *
 * GitHub only exposes step-level status while a run is in flight (logs
 * arrive after it finishes), so the detail here comes from the workflow
 * being split into `[Category]` steps. The panel attaches to whichever run
 * is newest on mount — including a scheduled one it didn't start — and
 * keeps polling until the run finishes.
 */
function DatasetWorkflowPanel({ getPasscode, rootFolderUrl, onFinished }: DatasetWorkflowPanelProps) {
  const [run, setRun] = useState<WorkflowRunStatus | null>(null);
  const [history, setHistory] = useState<WorkflowRunSummary[]>([]);
  const [meta, setMeta] = useState<{ repo: string; workflowFile: string } | null>(null);
  const [trackedRunId, setTrackedRunId] = useState<number | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const finishedRunRef = useRef<number | null>(null);

  const isRunning = run ? run.status === 'queued' || run.status === 'in_progress' : false;
  const progress = run ? runProgress(run, now) : null;
  const groups = run ? categorizeRun(run) : [];

  // Re-render once a second while a run is live so the elapsed clock and
  // step durations tick between the 3s polls.
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isRunning]);

  async function loadOverview() {
    setLoadingOverview(true);
    try {
      const res = await getDatasetUpdateOverview({ data: { passcode: getPasscode() } }).catch(() => null);
      if (!res) {
        setError('Could not reach the GitHub integration.');
        return;
      }
      if (!res.ok) {
        setError(res.reason);
        return;
      }
      setError(null);
      setHistory(res.history);
      setMeta({ repo: res.repo, workflowFile: res.workflowFile });
      const shown = res.active ?? res.latest;
      if (shown) {
        setRun(shown);
        setNow(Date.now());
      }
      setTrackedRunId(res.active ? res.active.runId : null);
    } finally {
      setLoadingOverview(false);
    }
  }

  useEffect(() => {
    void loadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Self-scheduling poll: one status call, then 3s later the next, so a slow
  // GitHub response can't stack up overlapping requests the way setInterval
  // does. Stops as soon as the run leaves queued/in_progress.
  useEffect(() => {
    if (trackedRunId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const res = await getDatasetUpdateStatus({
        data: { passcode: getPasscode(), runId: trackedRunId },
      }).catch(() => null);
      if (cancelled) return;
      if (!res || !res.ok) {
        setError(res ? res.reason : 'Lost connection while checking workflow status.');
        setTrackedRunId(null);
        return;
      }
      setRun(res.status);
      setNow(Date.now());
      if (res.status.status === 'completed') {
        setTrackedRunId(null);
        if (finishedRunRef.current !== res.status.runId) {
          finishedRunRef.current = res.status.runId;
          onFinished();
        }
        void loadOverview();
        return;
      }
      timer = setTimeout(tick, 3000);
    };

    timer = setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedRunId]);

  async function handleTrigger() {
    setShowConfirm(false);
    setTriggering(true);
    setError(null);
    try {
      const res = await triggerDatasetUpdate({ data: { passcode: getPasscode() } });
      if (!res.ok) {
        setError(res.reason);
        // A run was already going — track it instead of dead-ending on the
        // error, since that's almost certainly what the admin wanted to see.
        if (res.activeRunId) {
          setTrackedRunId(res.activeRunId);
          const status = await getDatasetUpdateStatus({
            data: { passcode: getPasscode(), runId: res.activeRunId },
          }).catch(() => null);
          if (status?.ok) setRun(status.status);
        }
        return;
      }
      setRun(null);
      setTrackedRunId(res.runId);
    } catch {
      setError('Could not trigger the workflow. Try again.');
    } finally {
      setTriggering(false);
    }
  }

  const overallTone = progress ? statusTone(run?.status ?? 'queued', run?.conclusion ?? null) : 'neutral';
  const headline = !run
    ? null
    : progress?.isQueued
      ? 'Queued — waiting for a runner'
      : progress?.isRunning
        ? progress.currentStepName
          ? `${groups.find((group) => group.key === progress.currentCategoryKey)?.label ?? 'Working'}: ${progress.currentStepName}`
          : 'Starting…'
        : workflowConclusionLabel(run.status, run.conclusion);

  return (
    <div className="mb-6 rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Update resource datasets</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Re-crawls Drive, regenerates the committed JSON datasets, and commits the result — via the{' '}
            <span className="font-mono">{meta?.workflowFile ?? 'update-resources.yml'}</span> GitHub Actions workflow.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadOverview()} disabled={loadingOverview}>
            {loadingOverview ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Status
          </Button>
          <Button size="sm" onClick={() => setShowConfirm(true)} disabled={triggering || isRunning}>
            {triggering ? 'Starting…' : isRunning ? 'Running…' : 'Update resource datasets'}
          </Button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      {trackedRunId !== null && !run && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={13} className="animate-spin" /> Dispatching run… waiting for GitHub to queue it.
        </p>
      )}

      {run && progress && (
        <div className="mt-4 overflow-hidden rounded-lg border bg-background/70">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <a
                href={run.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono font-medium text-primary hover:underline"
              >
                Run #{run.runNumber || run.runId}
              </a>
              <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {run.event === 'schedule' ? 'scheduled' : run.event === 'workflow_dispatch' ? 'manual' : run.event}
              </span>
              <span className="text-muted-foreground">
                started {formatRelativeTime(run.startedAt ?? run.createdAt)}
              </span>
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${WORKFLOW_BADGE_CLASS[overallTone]}`}>
              {workflowConclusionLabel(run.status, run.conclusion)}
            </span>
          </div>

          <div className="space-y-1.5 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3 text-[11px]">
              <span className={`min-w-0 truncate ${progress.isRunning ? 'text-foreground' : 'text-muted-foreground'}`} title={headline ?? ''}>
                {progress.isRunning && <Loader2 size={11} className="mr-1 inline animate-spin align-[-1px]" />}
                {headline}
              </span>
              <span className="shrink-0 font-mono text-muted-foreground">
                {progress.completedSteps}/{progress.totalSteps} steps · {formatDuration(progress.elapsedMs)}
                {progress.isRunning && progress.etaMs !== null ? ` · ~${formatDuration(progress.etaMs)} left` : ''}
              </span>
            </div>
            <Progress value={progress.percent} className="h-1.5" />
          </div>

          <ul className="divide-y border-t">
            {groups.map((group) => (
              <CategoryRow key={group.key} group={group} now={now} />
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <a href={run.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
              Open run on GitHub <ExternalLink size={11} />
            </a>
            <span className="font-mono">
              {meta ? `${meta.repo} · ${meta.workflowFile}` : `sha ${run.headSha.slice(0, 7)}`}
            </span>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <p className="text-[11px] font-medium text-muted-foreground">Recent runs</p>
          <ul className="mt-1 divide-y rounded-lg border bg-background/60">
            {history.map((entry) => {
              const tone = statusTone(entry.status, entry.conclusion);
              const active = run?.runId === entry.runId;
              return (
                <li key={entry.runId} className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${active ? 'bg-muted/40' : ''}`}>
                  <a href={entry.htmlUrl} target="_blank" rel="noreferrer" className="font-mono text-primary hover:underline">
                    #{entry.runNumber || entry.runId}
                  </a>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {entry.event === 'schedule' ? 'scheduled' : entry.event === 'workflow_dispatch' ? 'manual' : entry.event} ·{' '}
                    {formatRelativeTime(entry.createdAt)}
                  </span>
                  <span className={`shrink-0 ${WORKFLOW_TONE_CLASS[tone]}`}>
                    {workflowConclusionLabel(entry.status, entry.conclusion)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
              {rootFolderUrl ? (
                <a
                  href={rootFolderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 flex items-center gap-1.5 break-all text-sm text-primary hover:underline"
                >
                  {rootFolderUrl} <ExternalLink size={13} className="shrink-0" />
                </a>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Unknown — Drive isn't configured.</p>
              )}
            </div>
            {meta && (
              <div className="mt-3 rounded-md border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">Workflow category breakdown</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {WORKFLOW_CATEGORIES.filter((category) => category.key !== 'runner' && category.key !== 'other')
                    .map((category) => category.label)
                    .join(' → ')}
                </p>
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void handleTrigger()}>
                Start update
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
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

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-end gap-2">
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

        <DatasetWorkflowPanel
          getPasscode={getPasscode}
          rootFolderUrl={state?.configured ? state.rootFolderUrl : null}
          onFinished={() => void load(currentFolderIdRef.current)}
        />

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
                  read-only service account). Set <span className="font-mono">oauth_client_id</span>,{' '}
                  <span className="font-mono">oauth_client_secret</span> and{' '}
                  <span className="font-mono">oauth_refresh_token</span> on the <span className="font-mono">drive_integration</span> row in Neon for an
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
      <CardHeader className="flex flex-row items-center justify-end gap-4">
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

const CONTRIBUTION_STATUS_META: Record<ContributionStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'contribution-badge-pending' },
  approved: { label: 'Approved', className: 'contribution-badge-approved' },
  rejected: { label: 'Rejected', className: 'contribution-badge-rejected' },
};

/** "Contributed resources" panel: lists every row from resource_contributions
 * (newest first) submitted via the public /contribute form, with a status
 * badge, the submitted details, a link to the uploaded Drive file or the
 * contributor's own shared link, and inline approve/reject actions. Doesn't
 * touch Drive or the live resource datasets itself — approving here is just
 * a review decision; actually folding an approved resource into the public
 * library is still the admin's existing "Manage resources" / "Update
 * resource datasets" workflow. */
function ContributedResourcesCard() {
  const [state, setState] = useState<AdminContributionsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ContributionStatus | 'all'>('all');
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function getPasscode() {
    return adminSessionPasscode ?? '';
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminContributions({ data: { passcode: getPasscode() } });
      setState(data);
    } catch {
      setError('Could not load contributions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(row: AdminContributionRow, status: ContributionStatus) {
    setUpdatingId(row.id);
    try {
      const res = await updateContributionStatus({ data: { passcode: getPasscode(), id: row.id, status } });
      if (res.ok) {
        setState((prev) =>
          prev && prev.configured
            ? { ...prev, contributions: prev.contributions.map((c) => (c.id === row.id ? { ...c, status } : c)) }
            : prev,
        );
      } else {
        setError(res.reason);
      }
    } catch {
      setError('Could not update this contribution. Try again.');
    } finally {
      setUpdatingId(null);
    }
  }

  const rows = state?.configured ? state.contributions : [];
  const visibleRows = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const counts = {
    all: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {(['all', 'pending', 'approved', 'rejected'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`contribution-filter-tab shrink-0 ${filter === key ? 'is-active' : ''}`}
            >
              {key === 'all' ? 'All' : CONTRIBUTION_STATUS_META[key].label} · {counts[key]}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          Every submission from the public <span className="font-mono">/contribute</span> form — review the
          file or link, then approve or reject. Approving doesn't publish it automatically; fold it into the
          real resource folders via Manage resources, then re-run Update resource datasets.
        </p>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {state && !state.configured && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">{state.reason}</p>
          </div>
        )}

        {state?.configured && visibleRows.length === 0 && (
          <p className="text-sm text-muted-foreground">No contributions {filter === 'all' ? 'yet' : `with status "${filter}"`}.</p>
        )}

        {state?.configured && visibleRows.length > 0 && (
          <div className="space-y-3">
            {visibleRows.map((row) => {
              const badge = CONTRIBUTION_STATUS_META[row.status];
              const expanded = expandedId === row.id;
              return (
                <div key={row.id} className="contribution-row">
                  <button
                    type="button"
                    className="contribution-row-main"
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                  >
                    <span className="contribution-row-icon">
                      {row.submissionType === 'upload' ? <UploadCloud size={16} /> : <Link2 size={16} />}
                    </span>
                    <span className="contribution-row-title">
                      <span className="contribution-row-filename" title={row.fileName}>{row.fileName}</span>
                      <span className="contribution-row-meta">
                        {row.classLabel} · {row.subject} · {formatDateTime(row.createdAt)}
                      </span>
                    </span>
                    <span className={`contribution-badge ${badge.className}`}>{badge.label}</span>
                  </button>

                  {expanded && (
                    <div className="contribution-row-detail">
                      {row.description && (
                        <p className="contribution-detail-line">
                          <span className="contribution-detail-label">Description</span> {row.description}
                        </p>
                      )}
                      {row.contributorAlias && (
                        <p className="contribution-detail-line">
                          <span className="contribution-detail-label">From</span> {row.contributorAlias}
                        </p>
                      )}
                      <p className="contribution-detail-line">
                        <span className="contribution-detail-label">Contact</span> {row.contactMethod}
                      </p>
                      <p className="contribution-detail-line">
                        <span className="contribution-detail-label">File</span>{' '}
                        {row.driveFileLink ? (
                          <a href={row.driveFileLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            Uploaded file <ExternalLink size={13} />
                          </a>
                        ) : row.sharedDriveLink ? (
                          <a href={row.sharedDriveLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline break-all">
                            {row.sharedDriveLink} <ExternalLink size={13} />
                          </a>
                        ) : (
                          '—'
                        )}
                      </p>

                      <div className="contribution-actions">
                        <Button
                          size="sm"
                          variant={row.status === 'approved' ? 'secondary' : 'default'}
                          disabled={updatingId === row.id}
                          onClick={() => void setStatus(row, 'approved')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant={row.status === 'rejected' ? 'secondary' : 'outline'}
                          disabled={updatingId === row.id}
                          onClick={() => void setStatus(row, 'rejected')}
                        >
                          Reject
                        </Button>
                        {row.status !== 'pending' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={updatingId === row.id}
                            onClick={() => void setStatus(row, 'pending')}
                          >
                            Reset to pending
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CONTACT_MESSAGE_STATUS_META: Record<ContactMessageStatus, { label: string; className: string }> = {
  unread: { label: 'Unread', className: 'contribution-badge-pending' },
  read: { label: 'Read', className: 'contribution-badge-approved' },
  archived: { label: 'Archived', className: 'contribution-badge-rejected' },
};

/** "Contact messages" panel: lists every row from contact_messages
 * (newest first) submitted via the footer's "Send us a message" popup,
 * with a status badge and inline mark-as-read/archive actions. Mirrors
 * ContributedResourcesCard's shape (filter tabs, expandable rows) but for
 * the simpler name/email/subject/message fields instead of file
 * submissions. */
function ContactMessagesCard() {
  const [state, setState] = useState<AdminContactMessagesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ContactMessageStatus | 'all'>('all');
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function getPasscode() {
    return adminSessionPasscode ?? '';
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminContactMessages({ data: { passcode: getPasscode() } });
      setState(data);
    } catch {
      setError('Could not load messages.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setStatus(row: AdminContactMessageRow, status: ContactMessageStatus) {
    setUpdatingId(row.id);
    try {
      const res = await updateContactMessageStatus({ data: { passcode: getPasscode(), id: row.id, status } });
      if (res.ok) {
        setState((prev) =>
          prev && prev.configured
            ? { ...prev, messages: prev.messages.map((m) => (m.id === row.id ? { ...m, status } : m)) }
            : prev,
        );
      } else {
        setError(res.reason);
      }
    } catch {
      setError('Could not update this message. Try again.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function openRow(row: AdminContactMessageRow) {
    const expanding = expandedId !== row.id;
    setExpandedId(expanding ? row.id : null);
    if (expanding && row.status === 'unread') void setStatus(row, 'read');
  }

  const rows = state?.configured ? state.messages : [];
  const visibleRows = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const counts = {
    all: rows.length,
    unread: rows.filter((r) => r.status === 'unread').length,
    read: rows.filter((r) => r.status === 'read').length,
    archived: rows.filter((r) => r.status === 'archived').length,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
          {(['all', 'unread', 'read', 'archived'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`contribution-filter-tab shrink-0 ${filter === key ? 'is-active' : ''}`}
            >
              {key === 'all' ? 'All' : CONTACT_MESSAGE_STATUS_META[key].label} · {counts[key]}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void load()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-muted-foreground">
          Every submission from the footer's "Send us a message" popup. Opening a message marks it read;
          archive it once you've followed up.
        </p>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

        {state && !state.configured && (
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="text-sm font-medium text-foreground">{state.reason}</p>
          </div>
        )}

        {state?.configured && visibleRows.length === 0 && (
          <p className="text-sm text-muted-foreground">No messages {filter === 'all' ? 'yet' : `with status "${filter}"`}.</p>
        )}

        {state?.configured && visibleRows.length > 0 && (
          <div className="space-y-3">
            {visibleRows.map((row) => {
              const badge = CONTACT_MESSAGE_STATUS_META[row.status];
              const expanded = expandedId === row.id;
              return (
                <div key={row.id} className="contribution-row">
                  <button
                    type="button"
                    className="contribution-row-main"
                    onClick={() => void openRow(row)}
                  >
                    <span className="contribution-row-icon">
                      <Mail size={16} />
                    </span>
                    <span className="contribution-row-title">
                      <span className="contribution-row-filename" title={row.subject}>{row.subject}</span>
                      <span className="contribution-row-meta">
                        {row.name} · {row.email} · {formatDateTime(row.createdAt)}
                      </span>
                    </span>
                    <span className={`contribution-badge ${badge.className}`}>{badge.label}</span>
                  </button>

                  {expanded && (
                    <div className="contribution-row-detail">
                      <p className="contribution-detail-line" style={{ whiteSpace: 'pre-wrap' }}>
                        {row.message}
                      </p>
                      {row.socialHandle && (
                        <p className="contribution-detail-line">
                          <span className="contribution-detail-label">Discord/Reddit</span> {row.socialHandle}
                        </p>
                      )}
                      <p className="contribution-detail-line">
                        <span className="contribution-detail-label">Reply to</span>{' '}
                        <a href={`mailto:${row.email}`} className="text-primary hover:underline">{row.email}</a>
                      </p>

                      <div className="contribution-actions">
                        {row.status !== 'archived' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updatingId === row.id}
                            onClick={() => void setStatus(row, 'archived')}
                          >
                            Archive
                          </Button>
                        )}
                        {row.status !== 'unread' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={updatingId === row.id}
                            onClick={() => void setStatus(row, 'unread')}
                          >
                            Mark as unread
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
