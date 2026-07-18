import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
  HEARING_START_SCHEMA_VERSION,
  HearingRuntimeViewV1Schema,
} from "@/domain/hearing-runtime";
import {
  CASE_OWNER_COOKIE_NAME,
  resolveCaseOwnerSession,
} from "@/server/case-api";

import { GET as readHearing } from "./[trialId]/route";
import { POST as commandHearing } from "./[trialId]/commands/route";
import { POST as startHearing } from "./route";

const PUBLIC_ORIGIN = "https://suits.test";
const SESSION_SECRET = "test-session-secret-that-is-longer-than-thirty-two-characters";
const SERVICE_SECRET = "test-convex-service-secret-longer-than-thirty-two-characters";
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";
const TRIAL_ID = `trial_${REQUEST_ID.replaceAll("-", "")}`;

const VIEW = HearingRuntimeViewV1Schema.parse({
  schemaVersion: "hearing-runtime-view.v1",
  case: {
    caseId: "case_redwood_signal_v1",
    version: 1,
    title: "Rina Shah v. Redwood Signal Systems",
    summary: "A fictional workplace retaliation simulation.",
    educationalDisclaimer: "Educational simulation only; not legal advice.",
    jurisdiction: {
      profileId: "jurisdiction_fictional_civil",
      name: "Fictional Civil Court",
      rulesVersion: "rules.v1",
      governingLaw: "Fictional civil law",
      burdenOfProof: "preponderance",
    },
    issues: [],
  },
  trial: {
    trialId: TRIAL_ID,
    phase: "case_in_chief",
    status: "active",
    version: 3,
    sequence: 3,
    lastEventId: "event:action:phase-case-in-chief",
    userSide: "user",
  },
  activeAppearance: null,
  activeQuestion: null,
  capabilities: {
    canAskQuestion: false,
    canFinishExamination: false,
    canFinishTrial: true,
  },
  witnesses: [],
  player: {
    actorId: "actor:counsel:party_rina_shah",
    actorRole: "user_counsel",
    side: "user",
    partyId: "party_rina_shah",
    facts: [],
    evidence: [],
    settlement: null,
  },
  transcript: [],
  permittedObjectionGrounds: ["relevance"],
});

function configureEnvironment(): void {
  vi.stubEnv("SUITS_PUBLIC_ORIGIN", PUBLIC_ORIGIN);
  vi.stubEnv("SUITS_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://convex.test");
}

function sessionCookie(): string {
  return resolveCaseOwnerSession(undefined, {
    secret: SESSION_SECRET,
    createSessionId: () => SESSION_ID,
  }).cookieValue;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hearing BFF routes", () => {
  it("creates a signed anonymous session and forwards only server-derived ownership", async () => {
    configureEnvironment();
    let forwarded: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      expect(new URL(rawUrl).pathname).toBe(
        "/service/hearings/start",
      );
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${SERVICE_SECRET}`,
      });
      forwarded = JSON.parse(String(init?.body)) as unknown;
      return Response.json(VIEW);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await startHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: PUBLIC_ORIGIN,
        },
        body: JSON.stringify({
          schemaVersion: HEARING_START_SCHEMA_VERSION,
          requestId: REQUEST_ID,
          requestedAt: "2026-07-19T03:00:00.000Z",
          case: { kind: "seeded", slug: "redwood-signal-retaliation" },
          userSide: "user",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(CASE_OWNER_COOKIE_NAME)).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
    });
    expect(forwarded).toMatchObject({
      ownerId: expect.stringMatching(/^owner:[0-9a-f-]{36}$/u),
      request: {
        schemaVersion: HEARING_START_SCHEMA_VERSION,
        requestId: REQUEST_ID,
      },
    });
    expect(JSON.stringify(forwarded)).not.toContain("graphId");
    await expect(response.json()).resolves.toEqual(VIEW);
  });

  it("reads and commands through the same owner cookie without exposing trusted actions", async () => {
    configureEnvironment();
    const requests: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const rawUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        requests.push({
          path: new URL(rawUrl).pathname,
          body: JSON.parse(String(init?.body)) as unknown,
        });
        return Response.json(VIEW);
      }),
    );
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;
    const readResponse = await readHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}`, {
        headers: { Cookie: cookie, Origin: PUBLIC_ORIGIN },
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    expect(readResponse.status).toBe(200);

    const command = {
      schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
      requestId: "323e4567-e89b-42d3-a456-426614174000",
      requestedAt: "2026-07-19T03:01:00.000Z",
      expectedStateVersion: VIEW.trial.version,
      expectedLastEventId: VIEW.trial.lastEventId,
      intent: { type: "call_witness", witnessId: "witness_rina_shah" },
    } as const;
    const commandResponse = await commandHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/commands`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Origin: PUBLIC_ORIGIN,
        },
        body: JSON.stringify(command),
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    expect(commandResponse.status).toBe(200);
    expect(requests).toEqual([
      {
        path: "/service/hearings/read",
        body: { ownerId: `owner:${SESSION_ID}`, trialId: TRIAL_ID },
      },
      {
        path: "/service/hearings/command",
        body: {
          ownerId: `owner:${SESSION_ID}`,
          trialId: TRIAL_ID,
          command,
        },
      },
    ]);
    expect(JSON.stringify(requests)).not.toContain("appendTrusted");
    expect(JSON.stringify(requests)).not.toContain("actor:judge");
  });

  it("rejects resume without the signed owner session before calling Convex", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const response = await readHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}`, {
        headers: { Origin: PUBLIC_ORIGIN },
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a browser-selected counsel actor before calling Convex", async () => {
    configureEnvironment();
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const cookie = `${CASE_OWNER_COOKIE_NAME}=${sessionCookie()}`;
    const response = await commandHearing(
      new NextRequest(`${PUBLIC_ORIGIN}/api/hearings/${TRIAL_ID}/commands`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          Origin: PUBLIC_ORIGIN,
        },
        body: JSON.stringify({
          schemaVersion: HEARING_PLAYER_COMMAND_SCHEMA_VERSION,
          requestId: "423e4567-e89b-42d3-a456-426614174000",
          requestedAt: "2026-07-19T03:02:00.000Z",
          expectedStateVersion: VIEW.trial.version,
          expectedLastEventId: VIEW.trial.lastEventId,
          controlledActorId: "actor:counsel:party_other",
          intent: { type: "call_witness", witnessId: "witness_rina_shah" },
        }),
      }),
      { params: Promise.resolve({ trialId: TRIAL_ID }) },
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
