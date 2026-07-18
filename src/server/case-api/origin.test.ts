import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { isTrustedRequestOrigin } from "./origin";

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers });
}

describe("isTrustedRequestOrigin", () => {
  it("accepts requests without a browser Origin header", () => {
    expect(isTrustedRequestOrigin(request("https://suits.test/api/cases/session"), {})).toBe(true);
  });

  it("accepts a direct same-origin request", () => {
    expect(
      isTrustedRequestOrigin(
        request("https://suits.test/api/cases/session", {
          host: "suits.test",
          origin: "https://suits.test",
        }),
        { SUITS_PUBLIC_ORIGIN: "https://suits.test" },
      ),
    ).toBe(true);
  });

  it("uses the external Host when Next retains an internal URL hostname", () => {
    expect(
      isTrustedRequestOrigin(
        request("http://localhost:3000/api/cases/session", {
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000",
        }),
        {},
      ),
    ).toBe(true);
  });

  it("rejects an arbitrary matching Host without a configured public origin", () => {
    expect(
      isTrustedRequestOrigin(
        request("https://attacker.example/api/cases/session", {
          host: "attacker.example",
          origin: "https://attacker.example",
        }),
        {},
      ),
    ).toBe(false);
  });

  it("rejects cross-host and cross-scheme origins", () => {
    const base = "https://suits.test/api/cases/session";
    expect(
      isTrustedRequestOrigin(
        request(base, { host: "suits.test", origin: "https://attacker.test" }),
        {},
      ),
    ).toBe(false);
    expect(
      isTrustedRequestOrigin(
        request(base, { host: "suits.test", origin: "http://suits.test" }),
        {},
      ),
    ).toBe(false);
  });

  it("rejects malformed and opaque origins", () => {
    expect(
      isTrustedRequestOrigin(
        request("https://suits.test/api/cases/session", { host: "suits.test", origin: "null" }),
        {},
      ),
    ).toBe(false);
    expect(
      isTrustedRequestOrigin(
        request("https://suits.test/api/cases/session", {
          host: "suits.test",
          origin: "https://suits.test/path",
        }),
        {},
      ),
    ).toBe(false);
  });

  it("supports an explicit public origin for trusted reverse-proxy deployments", () => {
    const proxied = request("http://internal:3000/api/cases/session", {
      host: "internal:3000",
      origin: "https://suits.example",
    });
    expect(isTrustedRequestOrigin(proxied, { SUITS_PUBLIC_ORIGIN: "https://suits.example/" })).toBe(
      true,
    );
    expect(isTrustedRequestOrigin(proxied, { SUITS_PUBLIC_ORIGIN: "https://other.example" })).toBe(
      false,
    );
  });

  it("requires HTTPS for configured non-loopback origins", () => {
    const insecure = request("http://internal:3000/api/cases/session", {
      host: "internal:3000",
      origin: "http://suits.example",
    });
    expect(isTrustedRequestOrigin(insecure, { SUITS_PUBLIC_ORIGIN: "http://suits.example" })).toBe(
      false,
    );
  });

  it("normalizes a loopback default port", () => {
    expect(
      isTrustedRequestOrigin(
        request("http://localhost/api/cases/session", {
          host: "127.0.0.1:80",
          origin: "http://127.0.0.1",
        }),
        {},
      ),
    ).toBe(true);
  });
});
