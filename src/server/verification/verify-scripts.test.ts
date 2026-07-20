import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const VERIFY_SCRIPT = fileURLToPath(
  new URL("../../../scripts/verify.ps1", import.meta.url),
);
const BOUNDARY_SCRIPT = fileURLToPath(
  new URL("../../../scripts/verify-production-boundary.ps1", import.meta.url),
);
const PACKAGE_JSON = fileURLToPath(
  new URL("../../../package.json", import.meta.url),
);
const ENV_EXAMPLE = fileURLToPath(
  new URL("../../../.env.example", import.meta.url),
);
const VITEST_EXECUTABLE = fileURLToPath(
  new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url),
);
const LIVE_CASE_COMPILER_TEST = fileURLToPath(
  new URL(
    "../case-compiler/case-compiler.live.test.ts",
    import.meta.url,
  ),
);

const temporaryDirectories: string[] = [];

function run(
  executable: string,
  args: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Readonly<{ status: number | null; output: string }> {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    windowsHide: true,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function requiredRun(executable: string, args: readonly string[], cwd: string): void {
  const result = run(executable, args, cwd);
  if (result.status !== 0) {
    throw new Error(`${executable} failed (${result.status}): ${result.output}`);
  }
}

function fixtureRepository(): Readonly<{
  root: string;
  clientAssets: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "suits-verifier-"));
  temporaryDirectories.push(root);
  const clientAssets = join(root, ".next", "static", "chunks");
  mkdirSync(clientAssets, { recursive: true });
  writeFileSync(join(root, ".env.example"), "OPENAI_API_KEY=\n", "utf8");
  writeFileSync(join(root, "safe.txt"), "fictional educational simulation\n", "utf8");
  writeFileSync(join(clientAssets, "app.js"), "console.log('safe production fixture');\n", "utf8");
  requiredRun("git", ["init", "--quiet"], root);
  requiredRun("git", ["add", "--all"], root);
  return { root, clientAssets: join(root, ".next", "static") };
}

function runBoundary(root: string, clientAssets: string) {
  return run(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      BOUNDARY_SCRIPT,
      "-RepositoryRoot",
      root,
      "-ClientAssetsPath",
      clientAssets,
    ],
    root,
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Milestone 9 verification scripts", () => {
  it("orchestrates every required non-billable gate and classifies optional live checks", () => {
    const source = readFileSync(VERIFY_SCRIPT, "utf8");
    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
      scripts: Record<string, string>;
    };
    const environmentExample = readFileSync(ENV_EXAMPLE, "utf8");

    expect(packageJson.scripts.verify).toBe(
      "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1",
    );
    expect(environmentExample).toContain("RUN_OPENAI_LIVE_INJECTION=0");
    for (const required of [
      '[switch]$LiveOpenAI',
      '[switch]$LiveCudaSmoke',
      'Invoke-RequiredCommand "Root ESLint"',
      'Invoke-RequiredCommand "Root TypeScript"',
      'Invoke-RequiredCommand "Convex TypeScript"',
      'Invoke-RequiredCommand "Root unit and integration tests"',
      'Invoke-RequiredCommand "Deterministic evaluations"',
      'Invoke-RequiredCommand "Exact deployed Convex public surface"',
      'Invoke-RequiredCommand "Locked speech dependency sync"',
      'Invoke-RequiredCommand "Speech Ruff format"',
      'Invoke-RequiredCommand "Speech Ruff lint"',
      'Invoke-RequiredCommand "Speech strict mypy"',
      'Invoke-RequiredCommand "Speech pytest"',
      'Invoke-RequiredCommand "Production build"',
      'Invoke-RequiredCommand "Tracked-secret and production client boundary"',
      'Invoke-RequiredCommand "Chromium end-to-end tests"',
      'Write-ResultSection "PASSED"',
      'Write-ResultSection "FAILED"',
      'Write-ResultSection "SKIPPED-OPENAI"',
      'Write-ResultSection "SKIPPED-GPU"',
      'numPendingTestSuites',
      'numPendingTests',
      'status -eq "passed"',
      'if ($failed.Count -gt 0)',
      'Resolve-LiveCourtroomConvexServiceSecret',
      '$captured = @(& npx convex env get SUITS_CONVEX_SERVICE_SECRET 2>$null)',
      'linked Convex service secret unavailable',
    ]) {
      expect(source).toContain(required);
    }
    expect(source).toContain('"--locked", "--no-python-downloads", "--extra", "dev"');
    expect(source).toContain('RUN_OPENAI_LIVE_INJECTION = "1"');
    expect(source).toContain('SUITS_RUN_LIVE_SPEECH_SMOKE = "1"');
    expect(source).not.toContain(
      'IsNullOrWhiteSpace($env:OPENAI_API_KEY)',
    );
    expect(source).not.toMatch(/Write-(?:Host|Output).*convexServiceSecret/iu);
    expect(source).not.toMatch(/Write-(?:Host|Output).*\$captured/iu);
    expect(source).not.toMatch(/@\(\s*"ci"/u);
  });

  it("keeps the production build sentinels synchronized with the boundary audit", () => {
    const verifier = readFileSync(VERIFY_SCRIPT, "utf8");
    const boundary = readFileSync(BOUNDARY_SCRIPT, "utf8");
    for (const sentinel of [
      "SUITS_VERIFY_OPENAI_SENTINEL_DO_NOT_SHIP_20260720",
      "SUITS_VERIFY_CONVEX_SENTINEL_DO_NOT_SHIP_20260720",
      "SUITS_VERIFY_SESSION_SENTINEL_DO_NOT_SHIP_20260720",
    ]) {
      expect(verifier).toContain(sentinel);
      expect(boundary).toContain(sentinel);
    }
  });

  it("proves a skipped live Vitest suite exits zero but reports pending tests", () => {
    const fixture = fixtureRepository();
    const reportPath = join(fixture.root, "vitest-live-skip.json");
    const result = run(
      process.execPath,
      [
        VITEST_EXECUTABLE,
        "run",
        LIVE_CASE_COMPILER_TEST,
        "--reporter=json",
        `--outputFile=${reportPath}`,
      ],
      fileURLToPath(new URL("../../../", import.meta.url)),
      {
        ...process.env,
        OPENAI_API_KEY: "",
        RUN_OPENAI_LIVE: "0",
      },
    );
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      numPendingTestSuites: number;
      numPendingTests: number;
      success: boolean;
    };

    expect(result.status, result.output).toBe(0);
    expect(report.success).toBe(true);
    expect(report.numPendingTestSuites + report.numPendingTests).toBeGreaterThan(0);
  });

  it("passes a safe tracked repository and production client fixture", () => {
    const fixture = fixtureRepository();
    const result = runBoundary(fixture.root, fixture.clientAssets);

    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Production boundary verification PASSED");
  });

  it("fails closed for tracked environment files", () => {
    const fixture = fixtureRepository();
    writeFileSync(join(fixture.root, ".env.local"), "OPENAI_API_KEY=\n", "utf8");
    requiredRun("git", ["add", "--all"], fixture.root);
    const result = runBoundary(fixture.root, fixture.clientAssets);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Tracked environment file is not allowlisted: .env.local");
  });

  it("reports tracked secret locations without echoing secret values", () => {
    const fixture = fixtureRepository();
    const token = `${"sk"}-${"a".repeat(32)}`;
    writeFileSync(join(fixture.root, "leak.txt"), `${token}\n`, "utf8");
    requiredRun("git", ["add", "--all"], fixture.root);
    const result = runBoundary(fixture.root, fixture.clientAssets);

    expect(result.status).toBe(1);
    expect(result.output).toContain("Tracked secret pattern 'OpenAI-style API key' matched: leak.txt");
    expect(result.output).not.toContain(token);
  });

  it("rejects production bundles containing server or typed-input markers", () => {
    const fixture = fixtureRepository();
    writeFileSync(
      join(fixture.clientAssets, "chunks", "app.js"),
      "const key = 'OPENAI_API_KEY'; const label = 'Developer-only typed question';\n",
      "utf8",
    );
    const result = runBoundary(fixture.root, fixture.clientAssets);

    expect(result.status).toBe(1);
    expect(result.output).toContain("OpenAI server environment name");
    expect(result.output).toContain("Developer typed-input label");
  });

  it("fails closed when production client assets are absent", () => {
    const fixture = fixtureRepository();
    const missingAssets = join(fixture.root, "missing-client-assets");
    const result = runBoundary(fixture.root, missingAssets);

    expect(result.status).toBe(1);
    expect(result.output).toContain(
      "Production client assets are missing; run the production build first.",
    );
  });
});
