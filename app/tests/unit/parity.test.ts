import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { testDb, PRE, END } from "./helpers";
import { loadState, type State } from "@/lib/analytics/state";
import { computeSnapshot } from "@/lib/analytics/snapshot";
import { importSourceIfNeeded } from "@/lib/db/importer";
import type { Db } from "@/lib/db/client";

// Python audit output = independent implementation of the same rules
const csv = fs.readFileSync(path.resolve(__dirname, "../../../outputs/audit/historical_kpis.csv"), "utf-8").trim().split(/\r?\n/);
const head = csv[0].split(",");
const py: Record<string, Record<string, number | null>> = {};
for (const line of csv.slice(1)) {
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ""));
  const r = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  (py[r.snapshot] ??= {})[r.metric] = r.value === "" ? null : Number(r.value);
}

let db: Db; let S: State;
beforeAll(async () => { db = await testDb(); S = await loadState(db); });

describe("import", () => {
  it("dedupes exact import retries and preserves raw rows", async () => {
    const c = await db.query<{ n: number }>(`SELECT count(*)::int n FROM interactions`);
    expect(c[0].n).toBe(950);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM opportunity_history`))[0].n).toBe(228);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM qualification_history`))[0].n).toBe(433);
    expect(S.source?.dedupe_log["Sponsor interactions"].sort()).toEqual(["SI00001", "SI00019", "SI00110"]);
  });
  it("is idempotent: importing the same workbook again changes nothing", async () => {
    const before = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM raw_records`))[0].n;
    const r = await importSourceIfNeeded(db);
    expect(r.imported).toBe(false);
    expect((await db.query<{ n: number }>(`SELECT count(*)::int n FROM raw_records`))[0].n).toBe(before);
  });
});

describe("snapshot parity with Python audit", () => {
  const cases: [string, number][] = [["pre_festival", PRE], ["history_end", END]];
  for (const [label, t] of cases) {
    it(`matches ${label}`, () => {
      const s = computeSnapshot(S, t);
      const P = py[label];
      const pairs: [string, number | null][] = [
        ["unique_attempts", s.funnel.attempts], ["brands_touched", s.funnel.brands_touched], ["brands_replied", s.funnel.brands_replied],
        ["brands_positive_reply", s.funnel.brands_positive], ["meetings_held", s.funnel.meetings_held], ["brands_met", s.funnel.brands_met],
        ["brands_qualified", s.qualification.qualified], ["brands_dormant", s.qualification.dormant], ["brands_engaged", s.qualification.engaged],
        ["opportunities", s.funnel.opportunities], ["confirmed_opportunities", s.funnel.confirmed], ["opps_negotiating", s.stages.find((x) => x.stage === "negotiating")!.count],
        ["opps_lost", s.stages.find((x) => x.stage === "lost")!.count], ["opps_withdrawn", s.stages.find((x) => x.stage === "withdrawn")!.count],
        ["confirmed_cash_type_inr", s.deals.confirmed_cash_inr], ["confirmed_in_kind_inr", s.deals.confirmed_in_kind_inr],
        ["open_pipeline_proposed_inr", s.deals.open_pipeline_inr], ["opt_out_brands", s.funnel.opt_out_brands],
        ["median_confirmed_cash_deal_inr", s.deals.median_confirmed_cash_inr], ["open_opps_stale_14d", s.deals.open_stale_count],
        ["win_rate_closed", s.win_rate_closed.value],
      ];
      for (const [k, v] of pairs) expect([k, v == null ? null : Number(v.toFixed(4))]).toEqual([k, P[k] == null ? null : Number(P[k]!.toFixed(4))]);
    });
  }
  it("has no receipts, so cash received is zero and flagged as no history", () => {
    const s = computeSnapshot(S, PRE);
    expect(s.cash.received_verified_inr).toBe(0);
    expect(s.cash.historical_receipts_available).toBe(false);
    expect(s.cash.unscheduled_confirmed_inr).toBe(2_000_000);
  });
  it("never leaks post-cutoff records into the pre-festival snapshot", () => {
    const s = computeSnapshot(S, PRE);
    expect(s.opps.every((o) => o.versions.every((v) => v.effective_at <= PRE))).toBe(true);
    expect(s.funnel.attempts).toBe(369); // the 13-Apr Kindred Pantry outreach is excluded
  });
});
