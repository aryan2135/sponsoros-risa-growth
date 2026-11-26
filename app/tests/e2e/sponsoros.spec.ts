import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// expected simulator figures come from the validated model outputs (never hard-coded)
const MODEL = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../outputs/model/forecast_summary.json"), "utf-8"));
const SENS = fs.readFileSync(path.resolve(__dirname, "../../../outputs/model/sensitivity_base.csv"), "utf-8").split(String.fromCharCode(10)).find((l) => l.startsWith("Collection probabilities -10 pp"))!;
const lakh = (v: number) => `₹${(v / 1e5).toFixed(1)} L`;

const shot = (page: Page, name: string) => page.screenshot({ path: `../docs/screenshots/${name}.png`, fullPage: true });

test.describe.serial("SponsorOS end-to-end", () => {
  test("overview answers the five questions from live data", async ({ page }) => {
    // safety: e2e must run on a throwaway PGlite DB with the deterministic analyst, never on Supabase / a live LLM
    const h = await (await page.request.get("/api/health")).json();
    expect(h).toEqual({ status: "ok" });
    const m = await (await page.request.get("/api/meta")).json();
    expect(m).toMatchObject({ db: "pglite", ai_provider: "local" });
    await page.goto("/");
    await expect(page.getByText("1 · Cash actually received")).toBeVisible();
    await expect(page.getByText("Cash collected in the 2025 source data is unknown")).toBeVisible();
    await expect(page.getByText("₹20.0 L").first()).toBeVisible();
    await expect(page.getByText("4 · Prioritise today")).toBeVisible();
    await expect(page.getByText("5 · Which campaigns deserve investment")).toBeVisible();
    await shot(page, "01-overview");
  });

  test("every module renders", async ({ page }) => {
    const pages: [string, string, string][] = [["/cash", "Cash Control Tower", "02-cash"], ["/pipeline", "Opportunity pipeline", "03-pipeline"], ["/sponsors", "Sponsor CRM", "04-crm"], ["/campaigns", "Campaigns & initiative playbook", "05-campaigns"], ["/tasks", "Tasks & decisions", "06-tasks"], ["/simulator", "Scenario simulator", "07-simulator"], ["/analyst", "AI Growth Analyst", "08-analyst"], ["/data", "Data sources & assumptions", "09-data"]];
    for (const [path, text, name] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: text, level: 1 })).toBeVisible();
      await page.waitForTimeout(800);
      await shot(page, name);
    }
  });

  test("change a deal stage in the UI -> persisted -> dashboard updates after reload", async ({ page }) => {
    await page.goto("/pipeline");
    await page.getByLabel("Stage filter").selectOption("partner_confirmed");
    await page.getByRole("row", { name: /Beardo/ }).first().click();
    await page.getByLabel("Stage", { exact: true }).selectOption("withdrawn");
    await page.getByLabel("Note").fill("e2e: sponsor withdrew");
    await page.getByRole("button", { name: "Save version" }).click();
    await expect(page.getByText("New opportunity version saved")).toBeVisible();
    await page.goto("/");
    await page.reload();
    await expect(page.getByText("₹18.0 L").first()).toBeVisible();
  });

  test("cash: generate schedule, TEST receipt excluded, verified receipt counted", async ({ page }) => {
    await page.goto("/cash");
    await page.getByRole("row", { name: /Mosaic Mobility/ }).click();
    await page.getByRole("button", { name: "Generate schedule from policy" }).click();
    await expect(page.getByText("Payment schedule generated from policy")).toBeVisible();
    await page.getByLabel("Amount", { exact: true }).fill("75000");
    await page.getByLabel("Bank ref / UTR").fill("E2E-TEST-001");
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(page.getByText("Test receipt recorded (excluded from cash totals)")).toBeVisible();
    await expect(page.getByText(/ref E2E-TEST-001/)).toBeVisible();
    await expect(page.getByLabel("Bank ref / UTR")).toHaveValue("");
    await page.getByLabel("Amount", { exact: true }).fill("75000");
    await page.getByLabel("Bank ref / UTR").fill("E2E-DEMO-UTR-002");
    await page.getByText("Verified against bank statement").click();
    await page.getByText("Test / demo receipt (excluded from totals)").click();
    await page.getByRole("button", { name: "Record receipt" }).click();
    await expect(page.getByText("Receipt recorded", { exact: true })).toBeVisible();
    await page.reload();
    const tile = page.locator(".card", { hasText: "Verified received" }).first();
    await expect(tile).toContainText("₹75K");
    await expect(tile).toContainText("test ₹75K");
    await shot(page, "10-cash-after-receipt");
  });

  test("AI analyst: honest unknowns, then insight -> proposed task -> confirm -> persisted", async ({ page }) => {
    await page.goto("/analyst");
    const input = page.getByLabel("Message");
    await input.fill("What was the historical ROI of Brand Discovery Email?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/cannot be calculated/i).first()).toBeVisible();
    await input.fill("Which sponsors require immediate intervention?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText(/Top \d+ interventions by urgency/)).toBeVisible();
    await input.fill("Create a task for the top one");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Proposed task · not saved")).toBeVisible();
    await shot(page, "11-analyst-proposal");
    await page.getByRole("button", { name: "Confirm & create task" }).click();
    await expect(page.getByText(/Task #\d+ created/)).toBeVisible();
    await page.goto("/tasks");
    await expect(page.getByText(/ai confirmed/).first()).toBeVisible();
    await expect(page.getByText("approved").first()).toBeVisible();
    await shot(page, "12-tasks-decision-log");
  });

  test("task lifecycle in the UI persists across reload", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByLabel("Task title").fill("E2E follow up with Juniper Foods");
    await page.getByRole("button", { name: "Add task" }).click();
    await expect(page.getByText("Task created")).toBeVisible();
    await page.reload();
    const row = page.getByRole("row", { name: /E2E follow up with Juniper Foods/ });
    await expect(row).toBeVisible();
    await row.getByLabel("Status").selectOption("done");
    await expect(page.getByText("Task done")).toBeVisible();
    await page.getByLabel("Status filter").selectOption("done");
    await expect(page.getByRole("row", { name: /E2E follow up with Juniper Foods/ })).toBeVisible();
  });

  test("simulator responds to levers and never touches actuals", async ({ page }) => {
    await page.goto("/simulator");
    const stat = page.locator(".card", { hasText: "Forecast cash collected pre-festival" }).first();
    await expect(stat).toContainText(lakh(MODEL.base.totals.collected_inr));
    await page.getByLabel("Collection probability shift").fill("-0.1");
    await expect(stat).toContainText(lakh(Number(SENS.split(",")[1])));
    await page.goto("/");
    await expect(page.getByText("₹18.0 L").first()).toBeVisible();
  });

  test("sponsor CRM: create brand, add contact; brand count updates", async ({ page }) => {
    await page.goto("/sponsors");
    await page.getByRole("button", { name: "+ New brand" }).click();
    await page.getByRole("dialog").getByRole("textbox").first().fill("E2E Filter Coffee");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText("Brand created")).toBeVisible();
    await page.getByLabel("Contact name").fill("Ravi E2E");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Contact added")).toBeVisible();
    await page.reload();
    await expect(page.getByText(/181 brands/).first()).toBeVisible();
  });
});
