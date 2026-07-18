import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import {
  ConvexCaseServiceError,
  callConvexCaseService,
  readConvexCaseServiceConfig,
} from "./convex-service";

const CONFIG = {
  siteUrl: "https://example.convex.site",
  serviceSecret: "test-only-service-secret-that-is-long-enough",
};

describe("server-only Convex case service client", () => {
  it("sends the secret only in the Authorization header and validates the response", async () => {
    const fetchImplementation = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${CONFIG.serviceSecret}`,
        "Content-Type": "application/json",
      });
      expect(String(init?.body ?? "")).not.toContain(CONFIG.serviceSecret);
      return Response.json({ uploadUrl: "https://upload.example.test" });
    }) as typeof fetch;

    await expect(
      callConvexCaseService({
        path: "/service/case-upload-url",
        responseSchema: z.object({ uploadUrl: z.string().url() }).strict(),
        config: CONFIG,
        fetchImplementation,
      }),
    ).resolves.toEqual({ uploadUrl: "https://upload.example.test" });
  });

  it("returns bounded service codes without exposing remote error messages", async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({ error: "OWNER_MISMATCH", message: "private remote detail" }, { status: 403 }),
    ) as typeof fetch;

    const request = callConvexCaseService({
      path: "/service/case-draft/publish",
      body: {},
      responseSchema: z.object({ published: z.boolean() }),
      config: CONFIG,
      fetchImplementation,
    });
    await expect(request).rejects.toMatchObject({
      code: "OWNER_MISMATCH",
      status: 403,
    } satisfies Partial<ConvexCaseServiceError>);
    await expect(request).rejects.not.toThrow("private remote detail");
  });

  it("fails closed for missing secrets, insecure remote URLs, and malformed success bodies", async () => {
    expect(() => readConvexCaseServiceConfig({ NEXT_PUBLIC_CONVEX_SITE_URL: "https://example.test" })).toThrow(
      "SUITS_CONVEX_SERVICE_SECRET",
    );
    expect(() =>
      readConvexCaseServiceConfig({
        NEXT_PUBLIC_CONVEX_SITE_URL: "http://example.test",
        SUITS_CONVEX_SERVICE_SECRET: CONFIG.serviceSecret,
      }),
    ).toThrow("HTTPS");

    await expect(
      callConvexCaseService({
        path: "/service/case-upload-url",
        responseSchema: z.object({ uploadUrl: z.string().url() }),
        config: CONFIG,
        fetchImplementation: vi.fn(async () => Response.json({ uploadUrl: 42 })) as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "CASE_SERVICE_RESPONSE_INVALID", status: 502 });
  });
});
