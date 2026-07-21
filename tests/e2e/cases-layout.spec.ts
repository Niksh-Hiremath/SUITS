import { expect, test, type Locator, type Page } from "@playwright/test";

const DESCRIPTION =
  "Every seeded matter has multiple witnesses, isolated knowledge, source-linked facts, disputed evidence, and private settlement positions.";

async function verticalGap(heading: Locator, paragraph: Locator): Promise<number> {
  const [headingBox, paragraphBox] = await Promise.all([
    heading.boundingBox(),
    paragraph.boundingBox(),
  ]);
  expect(headingBox).not.toBeNull();
  expect(paragraphBox).not.toBeNull();
  return paragraphBox!.y - (headingBox!.y + headingBox!.height);
}

async function openCases(page: Page): Promise<void> {
  const response = await page.goto("/cases/");
  expect(response?.ok()).toBe(true);
}

test("keeps the case-library description clear of its display title", async ({
  page,
}) => {
  for (const viewport of [
    { width: 2_048, height: 552 },
    { width: 1_280, height: 800 },
    { width: 900, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await openCases(page);

    const heading = page.getByRole("heading", {
      level: 1,
      name: "Choose the record you’ll argue.",
    });
    const description = page.getByText(DESCRIPTION, { exact: true });

    await expect(heading).toBeVisible();
    await expect(description).toBeVisible();
    expect(await verticalGap(heading, description)).toBeGreaterThanOrEqual(20);
  }
});
