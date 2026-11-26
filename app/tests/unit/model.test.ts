import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resolve, expected, allEnabled, waterfall, runScenario, monteCarlo } from "@/lib/model/engine";

const root = path.resolve(__dirname, "../../..");
const py = JSON.parse(fs.readFileSync(path.join(root, "outputs/model/forecast_summary.json"), "utf-8"));

describe("financial model", () => {
  it("app assumptions are an exact copy of model/assumptions.json", () => {
    const a = fs.readFileSync(path.join(root, "model/assumptions.json"), "utf-8").replace(/\r\n/g, "\n");
    const b = fs.readFileSync(path.join(root, "app/data/model_assumptions.json"), "utf-8").replace(/\r\n/g, "\n");
    expect(b).toBe(a);
  });
  for (const level of ["base", "stretch"] as const) {
    it(`TS expected values match Python (${level})`, () => {
      const t = expected(resolve(level, allEnabled())).totals;
      for (const k of ["collected_inr", "signed", "committed_inr", "cash_type_inr", "in_kind_inr", "net_cash_inr", "proposals"] as const)
        expect(t[k]).toBeCloseTo(py[level].totals[k], 3);
    });
    it(`waterfall increments sum exactly to the forecast (${level})`, () => {
      const w = waterfall(level);
      const sum = w.reduce((a, r) => a + r.increment_inr, 0);
      expect(sum).toBeCloseTo(w.at(-1)!.collected_inr, 6);
      w.forEach((r, i) => expect(r.collected_inr).toBeCloseTo(py[level].waterfall[i].collected_inr, 3));
    });
  }
  it("in-kind never enters cash: cash_share 0 => zero collected", () => {
    expect(runScenario("base", { cash_share: 0 }).totals.collected_inr).toBe(0);
  });
  it("collection -10pp lowers forecast by the expected amount", () => {
    const a = runScenario("base").totals.collected_inr, b = runScenario("base", { collection_prob_delta: -0.1 }).totals.collected_inr;
    expect(a - b).toBeCloseTo(py.base.totals.collected_inr - 3364676.288, -1);
  });
  it("Monte Carlo is centred near the expected value", () => {
    const mc = monteCarlo(resolve("base", allEnabled()), 1500);
    expect(Math.abs(mc.mean / py.base.totals.collected_inr - 1)).toBeLessThan(0.06);
    expect(mc.p10).toBeLessThan(mc.p50); expect(mc.p50).toBeLessThan(mc.p90);
  });
});
