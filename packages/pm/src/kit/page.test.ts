import { describe, expect, it } from "@effect/vitest";

import { isPmPageSeen, PM_PAGE_THEME_SLOT, preparePmPage, withPmPageTheme } from "./page.ts";

const state = { answered: false, answers: null, answeredAt: null, awaitsSeen: false };

describe("preparePmPage", () => {
  it("puts the kit at the very start of an existing head, before the page's own scripts", () => {
    const html = preparePmPage(
      "<!doctype html><html><head><script>own()</script></head><body>x</body></html>",
      state,
    );
    const head = html.indexOf("<head>") + "<head>".length;
    expect(html.indexOf("Content-Security-Policy")).toBeGreaterThan(head);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("own()"));
    expect(html.indexOf('id="ghostex-kit"')).toBeLessThan(html.indexOf("own()"));
  });

  it("wraps a fragment in a document, and adds a head to a document without one", () => {
    expect(preparePmPage("<p>Pick</p>", state)).toMatch(
      /^<!doctype html><html><head>.*<\/head><body><p>Pick<\/p><\/body><\/html>$/s,
    );
    expect(preparePmPage('<html lang="en"><body>x</body></html>', state)).toMatch(
      /^<html lang="en"><head>/,
    );
  });

  it("forbids outside requests, frames and form posts", () => {
    const html = preparePmPage("<p>x</p>", state);
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("frame-src 'none'");
    expect(html).toContain("form-action 'none'");
  });

  it("hands the kit the page's state without letting stored answers close the script", () => {
    const html = preparePmPage("<p>x</p>", {
      answered: true,
      answers: { Q1: "</script><script>alert(1)</script>" },
      answeredAt: null,
      awaitsSeen: false,
    });
    const stateScript = /window\.ghostex\.__state\((.*?)\);<\/script>/s.exec(html)?.[1] ?? "";
    expect(stateScript).not.toContain("</script>");
    expect(JSON.parse(stateScript)).toMatchObject({
      answered: true,
      answers: { Q1: "</script><script>alert(1)</script>" },
    });
  });
});

describe("withPmPageTheme", () => {
  it("fills the theme slot, and an unfilled slot stays inert", () => {
    const html = preparePmPage("<p>x</p>", state);
    expect(html).toContain(PM_PAGE_THEME_SLOT);
    expect(withPmPageTheme(html, "dark")).toContain('setAttribute("data-gx-theme","dark")');
    expect(withPmPageTheme(html, "dark")).not.toContain(PM_PAGE_THEME_SLOT);
    expect(withPmPageTheme(html, "dark")).not.toContain("ReactNativeWebView");
  });

  it("relays a native host's submissions to the app before the kit's own script runs", () => {
    const html = withPmPageTheme(preparePmPage("<p>x</p>", state), "light", "native");
    expect(html.indexOf("ReactNativeWebView.postMessage")).toBeGreaterThan(0);
    expect(html.indexOf("ReactNativeWebView.postMessage")).toBeLessThan(
      html.indexOf("window.ghostex="),
    );
  });
});

describe("isPmPageSeen", () => {
  it("tells the Mark as seen answers from question answers", () => {
    expect(isPmPageSeen({ seen: true, reply: "ok" })).toBe(true);
    expect(isPmPageSeen({ Q1: "A" })).toBe(false);
    expect(isPmPageSeen(null)).toBe(false);
  });
});
