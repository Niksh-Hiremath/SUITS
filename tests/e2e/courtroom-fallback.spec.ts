import { chromium, expect, test } from "@playwright/test";

test("retains the hearing controls when WebGL is unavailable", async ({
  baseURL,
}) => {
  if (!baseURL) throw new Error("Playwright baseURL is required");

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-webgl", "--disable-software-rasterizer"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const response = await page.goto(new URL("/hearing/", baseURL).toString());
    expect(response?.ok()).toBe(true);

    await page.getByRole("button", { name: "Begin V3 hearing" }).click();
    const stage = page.getByTestId("courtroom-stage");
    await expect(stage).toHaveAttribute(
      "data-renderer-state",
      "unavailable",
      { timeout: 30_000 },
    );
    await expect(stage).toContainText(
      "3D rendering is unavailable. The hearing controls remain fully usable.",
    );
    await expect(
      page.getByRole("button", { name: "Call witness" }).first(),
    ).toBeEnabled();
  } finally {
    await browser.close();
  }
});
