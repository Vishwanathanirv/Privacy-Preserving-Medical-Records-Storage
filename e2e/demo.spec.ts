import { expect, test, type Page } from "@playwright/test";

async function signInAs(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
}

test("a doctor opens a record: decrypted, verified, and tampering is caught", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signInAs(page, "Dr. Meera Iyer");
  await page.getByRole("link", { name: /Anitha Kumar/ }).click();
  await page.locator('main a[href^="/records/"]').first().click();
  await expect(page.getByText("Restored scan is bit-for-bit identical to the original")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/AES-256-GCM [\d.]+ KB/)).toBeVisible();
  await page.getByRole("button", { name: "Run tamper test" }).click();
  await expect(page.getByText(/^Caught\./)).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test("a patient revokes consent and the doctor loses access at once", async ({ page }) => {
  await signInAs(page, "Anitha Kumar");
  await page.getByRole("link", { name: "Access" }).click();
  await page.getByRole("button", { name: "Revoke access" }).first().click();
  await expect(page.getByRole("button", { name: "Revoke access" })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signInAs(page, "Dr. Meera Iyer");
  await expect(page.getByRole("link", { name: /Karthik/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Anitha Kumar/ })).toHaveCount(0);
});

test("the admin can verify the audit chain but cannot read records", async ({ page }) => {
  await signInAs(page, "Asha Admin");
  await expect(page.getByRole("link", { name: "My records" })).toHaveCount(0);
  await page.getByRole("link", { name: "Audit log" }).click();
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByText(/Chain intact: \d+ entries verified/)).toBeVisible({ timeout: 30_000 });
  // Entries name the people involved, not their ids.
  await expect(page.locator("td").filter({ hasText: /^user:/ })).toHaveCount(0);
});
