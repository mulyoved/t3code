import { describe, expect, it } from "vitest";

import {
  buildDifitProxyBasePath,
  matchDifitProxyPath,
  rewriteDifitDocumentHtml,
  rewriteDifitTextAsset,
} from "./difitProxy";

describe("difitProxy", () => {
  it("matches proxied difit paths", () => {
    expect(matchDifitProxyPath("/__difit/rev-1/api/diff")).toEqual({
      sessionRevision: "rev-1",
      targetPath: "/api/diff",
    });
    expect(matchDifitProxyPath("/assets/index.js")).toBeNull();
  });

  it("rewrites html document roots and injects proxy shim", () => {
    const proxyBasePath = buildDifitProxyBasePath("rev-1");
    const html = `<!doctype html><head><link rel="icon" href="/favicon.svg"></head><body><script src="/assets/app.js"></script></body>`;
    const rewritten = rewriteDifitDocumentHtml(html, proxyBasePath);

    expect(rewritten).toContain(`${proxyBasePath}/favicon.svg`);
    expect(rewritten).toContain(`${proxyBasePath}/assets/app.js`);
    expect(rewritten).toContain("XMLHttpRequest.prototype.open");
  });

  it("rewrites text assets with root-relative api paths", () => {
    const rewritten = rewriteDifitTextAsset(
      `fetch("/api/diff"); import("/assets/app.js");`,
      buildDifitProxyBasePath("rev-1"),
      "text/javascript",
    );

    expect(rewritten).toContain(`fetch("/__difit/rev-1/api/diff")`);
    expect(rewritten).toContain(`import("/__difit/rev-1/assets/app.js")`);
  });
});
