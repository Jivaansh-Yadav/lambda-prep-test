import { createFileRoute } from '@tanstack/react-router';
import { SITE_URL } from '@/lib/lambda';

/** Every crawlable route, independent of the domain it's served from. Only
 * the path, priority and lastmod live here — the actual `<loc>` is built at
 * request time from SITE_URL (see the handler below), never hardcoded, so
 * there's one source of truth for the canonical domain across the sitemap,
 * canonical tags and OG tags. Dates are each route's last-content-change
 * date; bump them when a page's visible content meaningfully changes. */
const SITEMAP_ENTRIES: ReadonlyArray<{ path: string; priority: string; lastmod: string }> = [
  { path: '/', priority: '1.0', lastmod: '2026-10-23' },
  { path: '/doxxmarks', priority: '0.8', lastmod: '2026-10-22' },
  { path: '/resources', priority: '0.9', lastmod: '2026-10-23' },
  { path: '/resources/cisce', priority: '0.7', lastmod: '2026-10-22' },
  { path: '/resources/community', priority: '0.7', lastmod: '2026-10-23' },
  { path: '/contribute', priority: '0.6', lastmod: '2026-10-23' },
  { path: '/classes/icse-9', priority: '0.8', lastmod: '2026-10-23' },
  { path: '/classes/icse-10', priority: '0.8', lastmod: '2026-10-23' },
  { path: '/classes/isc-11', priority: '0.8', lastmod: '2026-10-23' },
  { path: '/classes/isc-12', priority: '0.8', lastmod: '2026-10-23' },
];

/** Deliberately always derived from the fixed SITE_URL config value, never
 * from the incoming request's Host header. Google requires every <loc> in
 * a sitemap to share the sitemap file's own host, and this app already
 * declares SITE_URL as its one canonical domain via og:url/canonical tags
 * elsewhere — a request-host-derived sitemap would emit different URLs to
 * different requesters and conflict with that fixed canonical signal. */
function buildSitemapXml(): string {
  const urls = SITEMAP_ENTRIES.map(entry => `  <url>
    <loc>${SITE_URL}${entry.path}</loc>
    <priority>${entry.priority}</priority>
    <lastmod>${entry.lastmod}</lastmod>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export const Route = createFileRoute('/sitemap.xml')({
  server: {
    handlers: {
      GET: async () =>
        new Response(buildSitemapXml(), {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600',
          },
        }),
    },
  },
});
