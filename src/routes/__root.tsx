import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { Header, Footer, ContactMessageDialog } from "@/components/lambda/shell";
import { SITE_URL, OG_IMAGE } from "@/lib/lambda";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nProvider, useI18n } from "../lib/i18n";
import { ThemeProvider, themeBootstrapScript } from "../lib/theme";

/** A torn-page book glyph for the 404 state — drawn by hand instead of
 * pulled from the icon set so the ripped corner reads clearly at this size. */
function TornBookIcon() {
  return (
    <svg
      width="88"
      height="88"
      viewBox="0 0 88 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="notfound-icon"
    >
      <path
        d="M44 16c-7-5-18-7-28-5v54c10-2 21 0 28 5"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M44 16c7-5 18-7 28-5v54c-10-2-21 0-28 5"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M44 16v54" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
      <path
        d="M58 30l5 3-6 2 6 3-7 2 6 4-9 1"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M66 48l9-3-6 8 8-1-11 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="notfound-icon-tear"
      />
    </svg>
  );
}

const NOTFOUND_MESSAGE_KEYS: readonly string[] = [
  'notfound.text',
  'notfound.text2',
  'notfound.text3',
  'notfound.text4',
  'notfound.text5',
  'notfound.text6',
  'notfound.text7',
  'notfound.text8',
  'notfound.text9',
  'notfound.text10',
  'notfound.text11',
  'notfound.text12',
];

function NotFoundComponent() {
  const { t } = useI18n();
  const [contactOpen, setContactOpen] = useState(false);
  // Picked once per mount so the message doesn't shuffle on re-renders.
  const [messageKey] = useState<string>(() => NOTFOUND_MESSAGE_KEYS[Math.floor(Math.random() * NOTFOUND_MESSAGE_KEYS.length)] ?? 'notfound.text');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <TornBookIcon />
        <h1 className="mt-4 text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t('notfound.title')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(messageKey)}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            to="/resources"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('notfound.exploreResources')}
          </Link>
          <Link
            to="/doxxmarks"
            search={{}}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t('notfound.openDoxxmarks')}
          </Link>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setContactOpen(true)}
            className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
          >
            {t('notfound.sendMessage')}
          </button>
        </div>
      </div>
      <ContactMessageDialog open={contactOpen} onOpenChange={setContactOpen} />
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const { t } = useI18n();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t('error.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('error.text')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('error.tryAgain')}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t('error.goHome')}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Lambda Prep" },
      { name: "description", content: "Curated ICSE and ISC resources for clearer understanding." },
      { name: "author", content: "Lambda Education Pvt. Ltd." },
      { property: "og:title", content: "Lambda Prep" },
      { property: "og:description", content: "Curated ICSE and ISC resources for clearer understanding." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Lambda Prep" },
      { name: "twitter:description", content: "Curated ICSE and ISC resources for clearer understanding." },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "sitemap", type: "application/xml", href: "/sitemap.xml" },
      // Preconnect to the font host before the stylesheet request below so the
      // DNS/TLS handshake overlaps with other critical-path work instead of
      // adding latency once the browser reaches this link.
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=Manrope:wght@400;500;600;650;700;750;800&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const WEBSITE_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Lambda Prep",
  url: SITE_URL,
  description: "Curated ICSE and ISC resources for clearer understanding.",
  publisher: {
    "@type": "Organization",
    name: "Lambda Education Pvt. Ltd.",
  },
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: WEBSITE_JSON_LD }}
        />
        {/* Applies the stored/system theme class before first paint to prevent a light->dark flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        {/* Cloudflare Web Analytics (RUM) beacon — client-side only, collects
            real visitor page-load/performance data keyed by the site token
            below. Server-side GraphQL queries against this same token power
            the admin "Deep analytics" panel; see admin-server.ts. */}
        <script
          type="module"
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token": "a9d4d976f92b48ed89669f9959c889de"}'
        ></script>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
          <Header />
          <Outlet />
          <Footer />
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
