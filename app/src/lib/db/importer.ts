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

  await db.tx(async (t) => {
    const [{ id: importId }] = await t.query<{ id: number }>(
      `INSERT INTO source_imports(file_name, sha256, row_counts, dedupe_log) VALUES ($1,$2,$3,$4) RETURNING id`,
      [seed.file_name, seed.sha256, JSON.stringify(counts), JSON.stringify(log)],
    );
    for (const [sheet, rows] of Object.entries(clean)) {
      for (const r of rows) {
        await t.query(`INSERT INTO raw_records(sheet, source_id, import_id, payload) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [
          sheet, String(r[SHEET_KEYS[sheet]]), importId, JSON.stringify(r),
        ]);
      }
    }
    const ev = clean.Event[0];
    await t.query(
      `INSERT INTO event(id, event_name, history_start, history_end, event_starts_at, event_ends_at, timezone, currency)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
      [ev.event_name, ev.history_start, ev.history_end, ev.event_starts_at, ev.event_ends_at, ev.timezone, ev.currency],
    );
    // team members from every sheet that carries owner_id + owner_name
    const team = new Map<string, string>();
    for (const sheet of ["Brands", "Sponsor campaigns", "Opportunity history"])
      for (const r of clean[sheet]) if (r.owner_id && r.owner_name) team.set(String(r.owner_id), String(r.owner_name));
    for (const [id, name] of team) await t.query(`INSERT INTO team_members(id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, name]);
    // interactions carry owner_id without a name (e.g. T04?) - add placeholder only if referenced and unknown
    for (const r of clean["Sponsor interactions"]) {
      const id = r.owner_id ? String(r.owner_id) : null;
      if (id && !team.has(id)) {
        team.set(id, `Team member ${id}`);
        await t.query(`INSERT INTO team_members(id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, `Team member ${id}`]);
      }
    }

    for (const r of clean.Brands)
      await t.query(
        `INSERT INTO brands(brand_id, brand_name, industry, owner_id, created_at, origin) VALUES ($1,$2,$3,$4,$5,'source') ON CONFLICT DO NOTHING`,
        [r.brand_id, r.brand_name, r.industry, r.owner_id, r.created_at],
      );
    for (const r of clean["Sponsor contacts"])
      await t.query(
        `INSERT INTO contacts(contact_id, brand_id, contact_name, job_title, created_at, origin) VALUES ($1,$2,$3,$4,$5,'source') ON CONFLICT DO NOTHING`,
        [r.contact_id, r.brand_id, r.contact_name, r.job_title, r.created_at],
      );
    for (const r of clean["Sponsor campaigns"])
      await t.query(
        `INSERT INTO campaigns(sponsor_campaign_id, campaign_name, channel, objective, audience, owner_id, planned_start_at, planned_end_at, created_at, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'source') ON CONFLICT DO NOTHING`,
        [r.sponsor_campaign_id, r.campaign_name, r.channel, r.objective, r.audience, r.owner_id, r.planned_start_at, r.planned_end_at, r.created_at],
      );
    for (const r of clean["Sponsor interactions"])
      await t.query(
        `INSERT INTO interactions(interaction_id, attempt_id, origin_interaction_id, brand_id, contact_id, campaign_id, owner_id, channel, event_type, outcome, summary, occurred_at, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'source') ON CONFLICT DO NOTHING`,
        [r.interaction_id, r.attempt_id, r.origin_interaction_id, r.brand_id, r.contact_id, r.sponsor_campaign_id, r.owner_id, r.channel, r.event_type, r.outcome, r.summary, r.occurred_at],
      );
    for (const r of clean["Brand qualification"])
      await t.query(
        `INSERT INTO qualification_history(history_id, brand_id, status, reason, campaign_id, effective_at, origin) VALUES ($1,$2,$3,$4,$5,$6,'source') ON CONFLICT DO NOTHING`,
        [r.history_id, r.brand_id, r.qualification_status, r.reason, r.sponsor_campaign_id, r.effective_at],
      );
    for (const r of clean["Partner opportunities"])
      await t.query(
        `INSERT INTO opportunities(opportunity_id, opportunity_name, brand_id, primary_contact_id, campaign_id, support_type, created_at, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'source') ON CONFLICT DO NOTHING`,
        [r.opportunity_id, r.opportunity_name, r.brand_id, r.primary_contact_id, r.sponsor_campaign_id, r.support_type, r.created_at],
      );
    for (const r of clean["Opportunity history"])
      await t.query(
        `INSERT INTO opportunity_history(history_id, opportunity_id, stage, proposed_value_inr, confirmed_value_inr, owner_id, effective_at, origin)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'source') ON CONFLICT DO NOTHING`,
        [r.history_id, r.opportunity_id, r.stage, r.proposed_value_inr, r.confirmed_value_inr ?? 0, r.owner_id, r.effective_at],
      );
    for (const r of clean["Sponsor activations"])
      await t.query(
        `INSERT INTO activations(activation_id, opportunity_id, brand_id, attendee_campaign_id, attendee_campaign_name, activation_note, linked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [r.activation_id, r.opportunity_id, r.brand_id, r.attendee_campaign_id, r.attendee_campaign_name, r.activation_note, r.linked_at],
      );
    for (const r of clean.Targets)
      await t.query(
        `INSERT INTO targets(effective_at, target_version, qualified_brands_goal, confirmed_partnerships_goal, basis, origin)
         VALUES ($1,$2,$3,$4,'[SOURCE] Targets sheet','source') ON CONFLICT DO NOTHING`,
        [r.effective_at, r.target_version, r.qualified_brands_goal, r.confirmed_partnerships_goal],
      );
  });
  return { imported: true, retries: log };
}
