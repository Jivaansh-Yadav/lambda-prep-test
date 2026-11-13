import { describe, expect, it } from "vitest";
import { readCampaignTouch } from "./campaign-tracking";
import { normalizeCampaignValue } from "./campaign-server";

// The query string is the only attribution signal available for Reddit,
// Discord, Slack and Gmail links (they strip the referrer, and Cloudflare's
// RUM dataset drops query strings), so these parsing rules are the feature.

describe("readCampaignTouch", () => {
  it("reads the standard utm parameters", () => {
    expect(readCampaignTouch("?utm_source=reddit&utm_medium=post&utm_campaign=class10")).toEqual({
      source: "reddit",
      medium: "post",
      campaign: "class10",
      content: null,
      term: null,
    });
  });

  it("returns null when there is no source tag", () => {
    expect(readCampaignTouch("")).toBeNull();
    expect(readCampaignTouch("?class=9&subject=maths")).toBeNull();
    expect(readCampaignTouch("?utm_medium=post")).toBeNull();
  });

  it("treats ?ref= as a shorthand for utm_source", () => {
    expect(readCampaignTouch("?ref=rd")?.source).toBe("rd");
    expect(readCampaignTouch("?ref=rd&utm_source=reddit")?.source).toBe("reddit");
  });

  it("keeps untouched values (normalising happens server-side)", () => {
    expect(readCampaignTouch("?utm_source=Reddit%20Post")?.source).toBe("Reddit Post");
  });
});

describe("normalizeCampaignValue", () => {
  it("lowercases, trims and strips anything that could break rendering", () => {
    expect(normalizeCampaignValue("  Reddit ", 64)).toBe("reddit");
    expect(normalizeCampaignValue('<script>alert("x")</script>', 64)).toBe("scriptalertx/script");
    expect(normalizeCampaignValue("class-10 / maths.v2", 64)).toBe("class-10/maths.v2");
  });

  it("truncates to the supplied length and rejects empties", () => {
    expect(normalizeCampaignValue("abcdef", 3)).toBe("abc");
    expect(normalizeCampaignValue("   ", 10)).toBeNull();
    expect(normalizeCampaignValue(null, 10)).toBeNull();
    expect(normalizeCampaignValue(42, 10)).toBeNull();
  });
});
