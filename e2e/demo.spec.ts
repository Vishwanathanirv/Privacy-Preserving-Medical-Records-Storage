import { expect, test, type Page } from "@playwright/test";

async function signInAs(page: Page, name: string) {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByRole("button", { name: /^Account:/ })).toBeVisible({ timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

test("a doctor opens a record: decrypted, verified, and tampering is caught", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signInAs(page, "Dr. Meera Iyer");
  await page.getByRole("link", { name: /Anitha Kumar/ }).click();
  await page.locator('main a[href*="/records/"]').first().click({ position: { x: 40, y: 20 } });
  const sheet = page.getByRole("dialog", { name: "Record" });
  await expect(sheet.getByText("Restored scan is bit-for-bit identical to the original")).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText(/AES-256-GCM [\d.]+ KB/)).toBeVisible();
  await sheet.getByRole("button", { name: "Run tamper test" }).click();
  await expect(sheet.getByText(/^Caught\./)).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a doctor adds a record and it opens straight away", async ({ page }) => {
  await signInAs(page, "Dr. Meera Iyer");
  await page.getByRole("link", { name: /Karthik/ }).click();
  await page.getByRole("button", { name: "New record" }).click();
  const form = page.getByRole("dialog", { name: "New record" });
  await form.getByPlaceholder("Chest X-ray: persistent cough").fill("Follow-up visit");
  await form.locator('input[maxlength="300"]').fill("Recovering well");
  await form.getByRole("button", { name: "Encrypt and save" }).click();
  await expect(page.getByRole("dialog", { name: "Record" }).getByRole("heading", { name: "Follow-up visit" })).toBeVisible({ timeout: 60_000 });
});

test("a patient switches a doctor off and the doctor loses access at once", async ({ page }) => {
  await signInAs(page, "Anitha Kumar");
  const meera = page.getByRole("switch", { name: /Dr. Meera Iyer/ });
  await expect(meera).toHaveAttribute("aria-checked", "true");
  await meera.click();
  await expect(meera).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/revoked a doctor's access/i).first()).toBeVisible();
  await signOut(page);
  await signInAs(page, "Dr. Meera Iyer");
  await expect(page.getByRole("link", { name: /Karthik/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Anitha Kumar/ })).toHaveCount(0);
});

test("the admin can verify the audit chain but cannot read records", async ({ page }) => {
  await signInAs(page, "Asha Admin");
  await expect(page.locator('a[href*="/records/"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByText(/Chain intact: \d+ entries verified/)).toBeVisible({ timeout: 30_000 });
  // Entries name the people involved, not their ids.
  await expect(page.locator("td").filter({ hasText: /^user:/ })).toHaveCount(0);
});

test("a patient lends a record for 15 minutes, the doctor opens it, and taking it back closes it at once", async ({ page }) => {
  await signInAs(page, "Anitha Kumar");
  await page.getByRole("button", { name: "Lend a card" }).click();
  const sheet = page.getByRole("dialog", { name: "Lend a record" });
  await sheet.getByText("Dr. Arjun Rao").click();
  await sheet.getByRole("radio", { name: "15 min" }).click();
  await sheet.getByRole("button", { name: /^Lend to Dr\. Arjun Rao for 15 min/ }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText(/With Dr\. Arjun Rao · 1[45]m \d\ds left/)).toBeVisible();
  await signOut(page);

  await signInAs(page, "Dr. Arjun Rao");
  const lent = page.getByRole("list", { name: "Records lent to you" });
  await lent.getByRole("link", { name: /Head CT/ }).first().click();
  const record = page.getByRole("dialog", { name: "Record" });
  await expect(record.getByText(/Lent to you\. Access ends in/)).toBeVisible({ timeout: 30_000 });
  await expect(record.getByText("Restored scan is bit-for-bit identical to the original")).toBeVisible();
  await page.keyboard.press("Escape");
  await signOut(page);

  await signInAs(page, "Anitha Kumar");
  for (const b of await page.getByRole("button", { name: "Take back" }).all()) await b.click();
  await expect(page.getByRole("button", { name: "Take back" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Access trail for/ }).first().click();
  await expect(page.getByText("Taken back, key destroyed").first()).toBeVisible();
  await signOut(page);

  await signInAs(page, "Dr. Arjun Rao");
  await expect(page.getByRole("list", { name: "Records lent to you" })).toHaveCount(0);
});

test("the browser proves a restored scan is bit-exact against the fingerprint in the signed log", async ({ page }) => {
  await signInAs(page, "Anitha Kumar");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("bit-exact");
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Record" });
  await expect(sheet.getByText("Identical to the fingerprint sealed in the signed log")).toBeVisible({ timeout: 30_000 });
  await expect(sheet.getByText(/Bit-exact: all [\d,]+ pixels match the original/)).toBeVisible();
  await sheet.getByRole("button", { name: "Flip one pixel and look again" }).click();
  await expect(sheet.getByText(/of 64 digits changed/)).toBeVisible();
});
