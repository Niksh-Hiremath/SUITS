import { defineConfig, devices } from "@playwright/test";

const LOCAL_BASE_URL = "http://127.0.0.1:3100";
const LOCAL_SPEECH_HEALTH_URL = "http://127.0.0.1:18765/healthz";
const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = configuredBaseUrl || LOCAL_BASE_URL;
const fakeMediaArgs = [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
  "--mute-audio",
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: fakeMediaArgs },
      },
    },
  ],
  webServer: configuredBaseUrl
    ? undefined
    : [
        {
          command:
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-e2e-speech.ps1",
          url: LOCAL_SPEECH_HEALTH_URL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
        {
          command:
            "powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/run-e2e-next.ps1",
          url: LOCAL_BASE_URL,
          env: {
            ...process.env,
            NEXT_PUBLIC_SUITS_SPEECH_URL:
              "ws://127.0.0.1:18765/v1/speech",
            SUITS_E2E_FINAL_BOUND_SCENARIO: "overruled-resume",
          },
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
});
