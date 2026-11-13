import { recordCampaignVisit } from "./campaign-server";

// ---------------------------------------------------------------------
// First-touch campaign capture, run once per session from RootComponent.
//
// Only the query string can tell us where a visit came from: Reddit, Discord,
// Slack and Gmail send no referrer, and Cloudflare's Web Analytics dataset
// drops query strings, so `?utm_source=…` is invisible to it. This reads the
// tag itself and reports it to recordCampaignVisit, which is what the admin
// "Campaign sources" panel reports on.
//
// Guards: browser only (no window during SSR), and at most one write per
// distinct set of utm values per session, so internal navigation and reloads
// don't inflate the numbers into page views.
// ---------------------------------------------------------------------

/** The utm parameters we read, in the order they appear in the admin table. */
export const CAMPAIGN_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;

export type CampaignTouch = {
  source: string;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
};

const SESSION_KEY_PREFIX = "lp.campaign:";

function readParam(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)?.trim();
  return value ? value : null;
}

/** Parses a query string into a touch, or null when there is no usable
 * `utm_source`. Exported so the parsing rules can be tested without a DOM.
 *
 * `ref` is accepted as an alias for `utm_source`: short links people actually
 * type (`?ref=rd`) get recorded too, and the shorthand wins only when
 * `utm_source` is absent. */
export function readCampaignTouch(search: string): CampaignTouch | null {
  const params = new URLSearchParams(search);
  const source = readParam(params, "utm_source") ?? readParam(params, "ref");
  if (!source) return null;
  return {
    source,
    medium: readParam(params, "utm_medium"),
    campaign: readParam(params, "utm_campaign"),
    content: readParam(params, "utm_content"),
    term: readParam(params, "utm_term"),
  };
}

/** Reads the current URL, and if it carries a campaign tag records it once for
 * this session. Safe to call on every mount: it no-ops when the URL is untagged
 * or when this exact link has already been recorded in this session. */
export function captureCampaignTouch(): void {
  if (typeof window === "undefined") return;

  let touch: CampaignTouch | null = null;
  try {
    touch = readCampaignTouch(window.location.search);
  } catch {
    return;
  }
  if (!touch) return;

  const key = `${SESSION_KEY_PREFIX}${[touch.source, touch.medium, touch.campaign, touch.content, touch.term].join("|")}`;
  try {
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
  } catch {
    // Private mode / storage disabled: record it anyway rather than losing the
    // arrival. The per-IP brake on the server is the real backstop.
  }

  let referrerHost: string | null = null;
  try {
    referrerHost = document.referrer ? new URL(document.referrer).hostname : null;
  } catch {
    referrerHost = null;
  }

  void recordCampaignVisit({
    data: { ...touch, landingPath: window.location.pathname, referrerHost },
  }).catch((error) => {
    // Never let attribution break the page; the row simply doesn't exist.
    console.error("[campaign] could not record visit", error);
  });
}
