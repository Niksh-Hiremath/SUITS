/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as artifacts from "../artifacts.js";
import type * as autonomous from "../autonomous.js";
import type * as caseCompileClaims from "../caseCompileClaims.js";
import type * as caseCompileQuota from "../caseCompileQuota.js";
import type * as caseCompileReplay from "../caseCompileReplay.js";
import type * as caseDrafts from "../caseDrafts.js";
import type * as caseServiceBoundary from "../caseServiceBoundary.js";
import type * as caseStorageReconciler from "../caseStorageReconciler.js";
import type * as caseUploadCleanup from "../caseUploadCleanup.js";
import type * as caseUploads from "../caseUploads.js";
import type * as cases from "../cases.js";
import type * as courtRecords from "../courtRecords.js";
import type * as courtroomGeneratedArtifacts from "../courtroomGeneratedArtifacts.js";
import type * as courtroomModelCalls from "../courtroomModelCalls.js";
import type * as crons from "../crons.js";
import type * as evals from "../evals.js";
import type * as events from "../events.js";
import type * as finalBoundInterruptionClaims from "../finalBoundInterruptionClaims.js";
import type * as hearingAudioAudits from "../hearingAudioAudits.js";
import type * as hearingRuntime from "../hearingRuntime.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as participatory from "../participatory.js";
import type * as publishedCases from "../publishedCases.js";
import type * as storageIntegrity from "../storageIntegrity.js";
import type * as traces from "../traces.js";
import type * as trialEvents from "../trialEvents.js";
import type * as trials from "../trials.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  artifacts: typeof artifacts;
  autonomous: typeof autonomous;
  caseCompileClaims: typeof caseCompileClaims;
  caseCompileQuota: typeof caseCompileQuota;
  caseCompileReplay: typeof caseCompileReplay;
  caseDrafts: typeof caseDrafts;
  caseServiceBoundary: typeof caseServiceBoundary;
  caseStorageReconciler: typeof caseStorageReconciler;
  caseUploadCleanup: typeof caseUploadCleanup;
  caseUploads: typeof caseUploads;
  cases: typeof cases;
  courtRecords: typeof courtRecords;
  courtroomGeneratedArtifacts: typeof courtroomGeneratedArtifacts;
  courtroomModelCalls: typeof courtroomModelCalls;
  crons: typeof crons;
  evals: typeof evals;
  events: typeof events;
  finalBoundInterruptionClaims: typeof finalBoundInterruptionClaims;
  hearingAudioAudits: typeof hearingAudioAudits;
  hearingRuntime: typeof hearingRuntime;
  http: typeof http;
  migrations: typeof migrations;
  participatory: typeof participatory;
  publishedCases: typeof publishedCases;
  storageIntegrity: typeof storageIntegrity;
  traces: typeof traces;
  trialEvents: typeof trialEvents;
  trials: typeof trials;
  voice: typeof voice;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
