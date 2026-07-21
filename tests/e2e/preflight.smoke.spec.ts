import { expect, test } from "@playwright/test";

test("renders the preflight workspace without starting audio checks", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  const response = await page.goto("/preflight/");

  expect(response?.ok()).toBe(true);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Make sure every system can take the stand.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Raw audio bypasses OpenAI and Convex."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run server checks" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Prepare speech runtime" }),
  ).toBeEnabled();
  const visibleText = await page.locator("main").innerText();
  expect(visibleText).not.toMatch(
    /\b(?:local|locally|localhost|loopback)\b|\b(?:this|your) machine\b/iu,
  );
  expect(browserErrors).toEqual([]);
});
