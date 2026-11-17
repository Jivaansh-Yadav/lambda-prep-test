import { describe, expect, it, afterEach, vi } from "vitest";
import { authHeaders, anonHeaders, githubGet } from "./github-fetch";

type Call = { url: string; headers: Record<string, string> };
type Reply = { status: number; rateLimitRemaining?: string };

function stubFetch(replies: Reply[]) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (url: string, init: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const index = Math.min(calls.length - 1, replies.length - 1);
    const reply = replies[index] ?? { status: 200 };
    const headers = new Headers();
    if (reply.rateLimitRemaining !== undefined) headers.set("x-ratelimit-remaining", reply.rateLimitRemaining);
    return new Response(reply.status === 200 ? "{}" : '{"message":"Bad credentials"}', { status: reply.status, headers });
  }) as unknown as typeof fetch);
  return calls;
}

const URL_UNDER_TEST = "https://api.github.com/repos/o/r/commits/main";

/** Reads one request header, tolerating an index signature and an absent call. */
function header(call: Call | undefined, name: string) {
  return call?.headers[name];
}

afterEach(() => vi.restoreAllMocks());

describe("githubGet", () => {
  it("sends the PAT on the first attempt", async () => {
    const calls = stubFetch([{ status: 200 }]);
    const res = await githubGet(URL_UNDER_TEST, "tok");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(header(calls[0], "Authorization")).toBe("Bearer tok");
  });

  it("retries anonymously when the stored PAT is revoked", async () => {
    const calls = stubFetch([{ status: 401 }, { status: 200 }]);
    const res = await githubGet(URL_UNDER_TEST, "ghp_revoked");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(header(calls[1], "Authorization")).toBeUndefined();
    // The anonymous retry must still be a well-formed GitHub request.
    expect(header(calls[1], "User-Agent")).toBe("lambda-prep-admin");
  });

  it("retries when the PAT lacks the scope for this endpoint", async () => {
    const calls = stubFetch([{ status: 403, rateLimitRemaining: "4999" }, { status: 200 }]);
    const res = await githubGet(URL_UNDER_TEST, "tok");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("does not retry a rate limit — the anonymous limit is lower", async () => {
    const calls = stubFetch([{ status: 403, rateLimitRemaining: "0" }, { status: 200 }]);
    const res = await githubGet(URL_UNDER_TEST, "tok");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(1);
  });

  it("reports the anonymous failure for a repo nobody can read", async () => {
    const calls = stubFetch([{ status: 401 }, { status: 404 }]);
    const res = await githubGet("https://api.github.com/repos/o/private/commits/main", "ghp_revoked");
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(2);
  });

  it("propagates server errors untouched", async () => {
    const calls = stubFetch([{ status: 500 }, { status: 200 }]);
    const res = await githubGet(URL_UNDER_TEST, "tok");
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(1);
  });
});

describe("headers", () => {
  it("keeps Authorization out of the anonymous headers", () => {
    expect(anonHeaders()).not.toHaveProperty("Authorization");
    expect(authHeaders("tok").Authorization).toBe("Bearer tok");
  });
});
