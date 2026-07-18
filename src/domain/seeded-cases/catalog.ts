import {
  createThreeWitnessCaseGraphV1Fixture,
  type CaseGraphV1,
} from "../case-graph";
import { createGreenlineCaseGraph } from "./greenline";
import { createHarborlightCaseGraph } from "./harborlight";

export type SeededCaseDifficulty = "introductory" | "intermediate" | "advanced";

export type SeededCaseCatalogEntry = {
  catalogId: string;
  slug: string;
  caseId: string;
  title: string;
  summary: string;
  category: string;
  difficulty: SeededCaseDifficulty;
  estimatedHearingMinutes: number;
  witnessCount: number;
  evidenceCount: number;
  issueCount: number;
  educationalDisclaimer: string;
};

type SeededCaseRegistration = {
  catalogId: string;
  slug: string;
  category: string;
  difficulty: SeededCaseDifficulty;
  estimatedHearingMinutes: number;
  createCaseGraph: () => CaseGraphV1;
};

const registrations: readonly SeededCaseRegistration[] = [
  {
    catalogId: "seeded.redwood-retaliation.v1",
    slug: "redwood-signal-retaliation",
    category: "workplace retaliation",
    difficulty: "intermediate",
    estimatedHearingMinutes: 28,
    createCaseGraph: createThreeWitnessCaseGraphV1Fixture,
  },
  {
    catalogId: "seeded.harborlight-rig-negligence.v1",
    slug: "harborlight-rig-negligence",
    category: "premises and equipment negligence",
    difficulty: "introductory",
    estimatedHearingMinutes: 26,
    createCaseGraph: createHarborlightCaseGraph,
  },
  {
    catalogId: "seeded.greenline-cold-chain.v1",
    slug: "greenline-cold-chain",
    category: "commercial contract",
    difficulty: "advanced",
    estimatedHearingMinutes: 32,
    createCaseGraph: createGreenlineCaseGraph,
  },
] as const;

function toCatalogEntry(registration: SeededCaseRegistration): SeededCaseCatalogEntry {
  const graph = registration.createCaseGraph();
  return {
    catalogId: registration.catalogId,
    slug: registration.slug,
    caseId: graph.caseId,
    title: graph.title,
    summary: graph.summary,
    category: registration.category,
    difficulty: registration.difficulty,
    estimatedHearingMinutes: registration.estimatedHearingMinutes,
    witnessCount: graph.witnesses.length,
    evidenceCount: graph.evidence.length,
    issueCount: graph.issues.length,
    educationalDisclaimer: graph.educationalDisclaimer,
  };
}

export function listSeededCases(): SeededCaseCatalogEntry[] {
  return registrations.map(toCatalogEntry);
}

export function listSeededCaseGraphs(): CaseGraphV1[] {
  return registrations.map((registration) => registration.createCaseGraph());
}

export function getSeededCaseBySlug(slug: string): CaseGraphV1 | undefined {
  const normalizedSlug = slug.trim().toLowerCase();
  return registrations.find((registration) => registration.slug === normalizedSlug)?.createCaseGraph();
}

export function getSeededCaseById(caseId: string): CaseGraphV1 | undefined {
  const registration = registrations.find(
    (candidate) => candidate.createCaseGraph().caseId === caseId,
  );
  return registration?.createCaseGraph();
}
