import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./client.ts", import.meta.url), "utf8");

describe("browser speech privacy boundary", () => {
  it("has no remote, persistence, analytics, or logging sink for local audio", () => {
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/\bsendBeacon\b/);
    expect(source).not.toMatch(/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/);
    expect(source).not.toMatch(/\bconsole\s*\./);
    expect(source).not.toMatch(/\bconvex\b/i);
    expect(source).not.toMatch(/\bopenai\b/i);
    expect(source).not.toMatch(/audioBase64|base64Audio|JSON\.stringify\s*\(\s*pcm/i);
  });

  it("depends only on the local strict protocol module", () => {
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (match) => match[1],
    );
    expect(imports).toEqual(["./protocol"]);
  });
});
