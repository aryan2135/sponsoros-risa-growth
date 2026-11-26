import fs from "node:fs";
import path from "node:path";
import type { Db } from "./client";

type Rec = Record<string, unknown>;
interface Seed { file_name: string; sha256: string; sheets: Record<string, Rec[]> }

export const SHEET_KEYS: Record<string, string> = {
  Brands: "brand_id",
  "Sponsor contacts": "contact_id",
  "Sponsor campaigns": "sponsor_campaign_id",
  "Sponsor interactions": "interaction_id",
  "Brand qualification": "history_id",
  "Partner opportunities": "opportunity_id",
  "Opportunity history": "history_id",
  "Sponsor activations": "activation_id",
  Targets: "target_version",
  Event: "event_name",
};

export function loadSeed(file?: string): Seed {
  const p = file ?? process.env.SOURCE_SEED_PATH ?? path.join(process.cwd(), "data", "source_seed.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

/** Exact duplicate rows with the same stable ID are import retries -> keep one.
 *  Same ID with a different payload is a conflict -> import aborts (never silently picks one). */
export function dedupe(sheet: string, rows: Rec[]) {
  const key = SHEET_KEYS[sheet];
  const seen = new Map<string, string>();
  const out: Rec[] = [];
  const retries: string[] = [];
  for (const r of rows) {
    const id = String(r[key]);
    const body = JSON.stringify(r);
    if (seen.has(id)) {
      if (seen.get(id) !== body) throw new Error(`Conflicting payload for ${sheet} ${id}`);
      retries.push(id);
      continue;
    }
    seen.set(id, body);
    out.push(r);
  }
  return { rows: out, retries };
}

export async function importSourceIfNeeded(db: Db, seed: Seed = loadSeed()) {
  const exists = await db.query(`SELECT id FROM source_imports WHERE sha256 = $1`, [seed.sha256]);
  if (exists.length) return { imported: false };

  const clean: Record<string, Rec[]> = {};
  const log: Record<string, string[]> = {};
  const counts: Record<string, number> = {};
  for (const [sheet, rows] of Object.entries(seed.sheets)) {
    counts[sheet] = rows.length;
    if (!SHEET_KEYS[sheet]) continue;
    const d = dedupe(sheet, rows);
    clean[sheet] = d.rows;
    log[sheet] = d.retries;
  }

  // Bulk inserts: one statement per table via jsonb_to_recordset (fast over high-latency links, e.g. Supabase pooler)
  const bulk = async (t: Db, table: string, cols: [string, string][], rows: Rec[], extra = "") => {
    if (!rows.length) return;
    const names = cols.map(([c]) => c).join(", ");
    await t.query(`INSERT INTO ${table}(${names}${extra ? ", " + extra.split("=")[0] : ""}) SELECT ${names}${extra ? ", " + extra.split("=")[1] : ""} FROM jsonb_to_recordset($1::jsonb) AS x(${cols.map(([c, ty]) => `${c} ${ty}`).join(", ")}) ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
  };
  const pick = (rows: Rec[], map: Record<string, string>) => rows.map((r) => Object.fromEntries(Object.entries(map).map(([to, from]) => [to, r[from] ?? null])));

  await db.tx(async (t) => {
    const [{ id: importId }] = await t.query<{ id: number }>(
      `INSERT INTO source_imports(file_name, sha256, row_counts, dedupe_log) VALUES ($1,$2,$3,$4) RETURNING id`,
      [seed.file_name, seed.sha256, JSON.stringify(counts), JSON.stringify(log)],
    );
    const raw: Rec[] = [];
    for (const [sheet, rows] of Object.entries(clean)) for (const r of rows) raw.push({ sheet, source_id: String(r[SHEET_KEYS[sheet]]), payload: r });
    await bulk(t, "raw_records", [["sheet", "text"], ["source_id", "text"], ["payload", "jsonb"]], raw, `import_id=${Number(importId)}`);
    const ev = clean.Event[0];
    await t.query(
      `INSERT INTO event(id, event_name, history_start, history_end, event_starts_at, event_ends_at, timezone, currency)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [ev.event_name, ev.history_start, ev.history_end, ev.event_starts_at, ev.event_ends_at, ev.timezone, ev.currency],
    );
    const team = new Map<string, string>();
    for (const sheet of ["Brands", "Sponsor campaigns", "Opportunity history"])
      for (const r of clean[sheet]) if (r.owner_id && r.owner_name) team.set(String(r.owner_id), String(r.owner_name));
    for (const r of clean["Sponsor interactions"]) if (r.owner_id && !team.has(String(r.owner_id))) team.set(String(r.owner_id), `Team member ${r.owner_id}`);
    await bulk(t, "team_members", [["id", "text"], ["name", "text"]], [...team].map(([id, name]) => ({ id, name })));
    const T = "timestamptz";
    await bulk(t, "brands", [["brand_id", "text"], ["brand_name", "text"], ["industry", "text"], ["owner_id", "text"], ["created_at", T]], clean.Brands, "origin='source'");
    await bulk(t, "contacts", [["contact_id", "text"], ["brand_id", "text"], ["contact_name", "text"], ["job_title", "text"], ["created_at", T]], clean["Sponsor contacts"], "origin='source'");
    await bulk(t, "campaigns", [["sponsor_campaign_id", "text"], ["campaign_name", "text"], ["channel", "text"], ["objective", "text"], ["audience", "text"], ["owner_id", "text"], ["planned_start_at", T], ["planned_end_at", T], ["created_at", T]], clean["Sponsor campaigns"], "origin='source'");
    await bulk(t, "interactions", [["interaction_id", "text"], ["attempt_id", "text"], ["origin_interaction_id", "text"], ["brand_id", "text"], ["contact_id", "text"], ["campaign_id", "text"], ["owner_id", "text"], ["channel", "text"], ["event_type", "text"], ["outcome", "text"], ["summary", "text"], ["occurred_at", T]],
      pick(clean["Sponsor interactions"], { interaction_id: "interaction_id", attempt_id: "attempt_id", origin_interaction_id: "origin_interaction_id", brand_id: "brand_id", contact_id: "contact_id", campaign_id: "sponsor_campaign_id", owner_id: "owner_id", channel: "channel", event_type: "event_type", outcome: "outcome", summary: "summary", occurred_at: "occurred_at" }), "origin='source'");
    await bulk(t, "qualification_history", [["history_id", "text"], ["brand_id", "text"], ["status", "text"], ["reason", "text"], ["campaign_id", "text"], ["effective_at", T]],
      pick(clean["Brand qualification"], { history_id: "history_id", brand_id: "brand_id", status: "qualification_status", reason: "reason", campaign_id: "sponsor_campaign_id", effective_at: "effective_at" }), "origin='source'");
    await bulk(t, "opportunities", [["opportunity_id", "text"], ["opportunity_name", "text"], ["brand_id", "text"], ["primary_contact_id", "text"], ["campaign_id", "text"], ["support_type", "text"], ["created_at", T]],
      pick(clean["Partner opportunities"], { opportunity_id: "opportunity_id", opportunity_name: "opportunity_name", brand_id: "brand_id", primary_contact_id: "primary_contact_id", campaign_id: "sponsor_campaign_id", support_type: "support_type", created_at: "created_at" }), "origin='source'");
    await bulk(t, "opportunity_history", [["history_id", "text"], ["opportunity_id", "text"], ["stage", "text"], ["proposed_value_inr", "integer"], ["confirmed_value_inr", "integer"], ["owner_id", "text"], ["effective_at", T]],
      clean["Opportunity history"].map((r) => ({ ...r, confirmed_value_inr: r.confirmed_value_inr ?? 0 })), "origin='source'");
    await bulk(t, "activations", [["activation_id", "text"], ["opportunity_id", "text"], ["brand_id", "text"], ["attendee_campaign_id", "text"], ["attendee_campaign_name", "text"], ["activation_note", "text"], ["linked_at", T]], clean["Sponsor activations"]);
    await bulk(t, "targets", [["effective_at", T], ["target_version", "text"], ["qualified_brands_goal", "integer"], ["confirmed_partnerships_goal", "integer"]], clean.Targets, "basis, origin='[SOURCE] Targets sheet', 'source'");
  });
  return { imported: true, retries: log };
}
