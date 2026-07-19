import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
  HearingCommandPreparationSchema,
} from "@/domain/hearing-runtime";
import { ConvexCaseServiceError } from "@/server/case-api";
import { createOpponentPlannerRequestFixture } from "@/server/courtroom-ai/opponent-planner.test-fixtures";

import { prepareCourtroomContinuationForOwner } from "./durable-service";

const OWNER_ID = "owner:123e4567-e89b-42d3-a456-426614174000";
const TRIAL_ID = "trial_continuation_recovery";
const SERVICE_SECRET =
  "test-convex-service-secret-longer-than-thirty-two-characters";

function configureEnvironment(): void {
  vi.stubEnv("SUITS_CONVEX_SERVICE_SECRET", SERVICE_SECRET);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_SITE_URL", "https://convex.test");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("courtroom continuation durable service", () => {
  it("fetches the owner-bound continuation without actor or command authority", async () => {
    configureEnvironment();
    const preparation = HearingCommandPreparationSchema.parse({
      schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
      status: "model_required",
      request: createOpponentPlannerRequestFixture(),
    });
    let forwarded: unknown;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(new URL(input instanceof Request ? input.url : input).pathname).toBe(
        "/service/hearings/continuation/prepare",
      );
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${SERVICE_SECRET}`,
      });
      forwarded = JSON.parse(String(init?.body)) as unknown;
      return Response.json(preparation);
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await expect(
      prepareCourtroomContinuationForOwner({
        ownerId: OWNER_ID,
        trialId: TRIAL_ID,
        signal: controller.signal,
      }),
    ).resolves.toEqual(preparation);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(forwarded).toEqual({ ownerId: OWNER_ID, trialId: TRIAL_ID });
    expect(JSON.stringify(forwarded)).not.toContain("actor");
    expect(JSON.stringify(forwarded)).not.toContain("command");
  });

  it("fails closed when Convex returns a malformed continuation", async () => {
    configureEnvironment();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json({
          schemaVersion: HEARING_COMMAND_PREPARATION_SCHEMA_VERSION,
          status: "completed",
          view: { trial: { trialId: TRIAL_ID } },
        }),
      ),
    );

    const recovery = prepareCourtroomContinuationForOwner({
      ownerId: OWNER_ID,
      trialId: TRIAL_ID,
    });
    await expect(recovery).rejects.toMatchObject({
      code: "CASE_SERVICE_RESPONSE_INVALID",
      status: 502,
    } satisfies Partial<ConvexCaseServiceError>);
  });
});
