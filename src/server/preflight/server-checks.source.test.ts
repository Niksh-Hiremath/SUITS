import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CONVEX_HTTP_PATH = fileURLToPath(
  new URL("../../../convex/http.ts", import.meta.url),
);
const NEXT_ROUTE_PATH = fileURLToPath(
  new URL("../../app/api/preflight/route.ts", import.meta.url),
);

describe("preflight source boundary", () => {
  it("keeps the durable health probe secret-protected and read-only", async () => {
    const source = await readFile(CONVEX_HTTP_PATH, "utf8");
    const start = source.indexOf("const serviceHealth = httpAction");
    const end = source.indexOf("const acquirePreflightPermit = httpAction", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = source.slice(start, end);

    expect(section).toContain("authorizeCaseServiceRequest(");
    expect(section).toContain("DurableServiceHealthRequestSchema");
    expect(section).toContain("DurableServiceHealthResponseSchema.parse");
    expect(section).not.toMatch(/ctx\.run|\.query\(|\.insert\(|\.patch\(|\.delete\(/u);
    expect(source).toContain(
      'http.route({ path: "/service/health", method: "POST", handler: serviceHealth })',
    );
  });

  it("durably gates billable probes behind the protected Convex quota", async () => {
    const source = await readFile(CONVEX_HTTP_PATH, "utf8");
    const start = source.indexOf("const acquirePreflightPermit = httpAction");
    const end = source.indexOf("const http = httpRouter()", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const section = source.slice(start, end);

    expect(section).toContain("authorizeCaseServiceRequest(");
    expect(section).toContain("DurablePreflightPermitRequestSchema");
    expect(section).toContain("ctx.runMutation(acquirePreflightPermitReference");
    expect(source).toContain(
      'http.route({ path: "/service/preflight-permit/acquire", method: "POST", handler: acquirePreflightPermit })',
    );
  });

  it("keeps model credentials server-only and returns only strict safe output", async () => {
    const source = await readFile(NEXT_ROUTE_PATH, "utf8");

    expect(source).toContain("process.env.OPENAI_API_KEY");
    expect(source).toContain("serverPreflightCache.get");
    expect(source).toContain("acquireDurablePreflightPermit()");
    expect(source).toContain("client.responses.create(");
    expect(source).not.toContain("client.models.retrieve(");
    expect(source).toContain("ServerPreflightResponseSchema.parse(result)");
    expect(source).toContain('headers: { "Cache-Control": "no-store" }');
    expect(source).not.toContain("NEXT_PUBLIC_OPENAI");
    expect(source).not.toMatch(/apiKey\s*[:,]\s*result|JSON\.stringify\(process\.env/iu);
  });
});
