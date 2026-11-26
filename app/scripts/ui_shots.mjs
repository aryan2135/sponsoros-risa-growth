// Dev helper: screenshot pages of a running SponsorOS (default http://localhost:3000)
//   node scripts/ui_shots.mjs <outDir> [overview,cash,...]
import { chromium } from "@playwright/test";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? ".";
const only = process.argv[3]?.split(",");
const pages = [["overview", "/"], ["cash", "/cash"], ["pipeline", "/pipeline"], ["crm", "/sponsors"], ["campaigns", "/campaigns"], ["tasks", "/tasks"], ["simulator", "/simulator"], ["analyst", "/analyst"], ["data", "/data"]];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "msedge" });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: 900 } });
for (const [name, path] of pages.filter(([n]) => !only || only.includes(n))) {
  await page.goto(base + path, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("h1", { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: process.env.FULL !== "0" });
  console.log("shot", name);
}
await browser.close();
