/**
 * Validated write operations. Used by API routes and by user-confirmed AI actions.
 * Source history is never rewritten: changes append new full-state versions stamped at the operating clock.
 */
import { z } from "zod";
import { audit, type Db } from "./db/client";
import { DEFAULT_SETTINGS } from "./db/config-seed";
import { ms } from "./analytics/state";

export class ValidationError extends Error { status = 400; }
const fail = (m: string): never => { throw new ValidationError(m); };

export async function getSetting<T>(db: Db, key: string): Promise<T> {
  const r = await db.query<{ value: string }>(`SELECT value::text AS value FROM settings WHERE key = $1`, [key]);
  return (r.length ? JSON.parse(r[0].value) : DEFAULT_SETTINGS[key]) as T;
}
export async function clock(db: Db): Promise<number> { return ms(await getSetting<string>(db, "as_of")); }
const iso = (t: number) => new Date(t).toISOString();

async function nextId(db: Db, table: string, col: string, prefix: string, width: number) {
  const r = await db.query<{ id: string }>(`SELECT ${col} AS id FROM ${table} WHERE ${col} LIKE $1 ORDER BY ${col} DESC LIMIT 1`, [`${prefix}%`]);
  const n = r.length ? parseInt(r[0].id.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(width, "0");
}
async function exists(db: Db, table: string, col: string, id: unknown) {
  return (await db.query(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [id])).length > 0;
}
async function mustExist(db: Db, table: string, col: string, id: unknown, what: string) {
  if (id != null && !(await exists(db, table, col, id))) fail(`${what} '${id}' not found`);
}

// ---------------------------------------------------------------- settings / targets
export const SettingsInput = z.object({
  as_of: z.string().datetime({ offset: true }).optional(),
  stale_days: z.number().int().min(1).max(120).optional(),
  forecast_collection_probability: z.number().min(0).max(1).optional(),
  collection_policy: z.object({ advance_pct: z.number().min(0).max(1), advance_due_days_after_signing: z.number().int().min(0).max(60), balance_due_days_before_festival: z.number().int().min(0).max(60) }).optional(),
});
export async function updateSettings(db: Db, input: unknown, actor = "user") {
  const v = SettingsInput.parse(input);
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined) continue;
    const before = await getSetting(db, k);
    await db.query(`INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [k, JSON.stringify(val)]);
    await audit(db, actor, "settings", k, "update", before, val);
  }
  return v;
}

export const TargetInput = z.object({
  qualified_brands_goal: z.number().int().min(0).nullable(), confirmed_partnerships_goal: z.number().int().min(0).nullable(),
  cash_collection_goal_inr: z.number().int().min(0).nullable(), target_version: z.string().min(1).max(80), basis: z.string().max(500).optional(),
});
export async function setTargets(db: Db, input: unknown, actor = "user") {
  const v = TargetInput.parse(input);
  const at = await clock(db);
  const r = await db.query<{ id: number }>(
    `INSERT INTO targets(effective_at, target_version, qualified_brands_goal, confirmed_partnerships_goal, cash_collection_goal_inr, basis, origin) VALUES ($1,$2,$3,$4,$5,$6,'app') RETURNING id`,
    [iso(at), v.target_version, v.qualified_brands_goal, v.confirmed_partnerships_goal, v.cash_collection_goal_inr, v.basis ?? "[USER] set in SponsorOS"],
  );
  await audit(db, actor, "targets", String(r[0].id), "create", null, v);
  return r[0];
}

// ---------------------------------------------------------------- brands & contacts
const INDUSTRIES = ["Food and beverage", "Consumer products", "Mobility", "Education", "Media", "Personal care", "Fintech", "Gaming", "Other"] as const;
export const BrandInput = z.object({ brand_name: z.string().trim().min(2).max(120), industry: z.enum(INDUSTRIES), owner_id: z.string().nullable().optional(), notes: z.string().max(2000).optional() });
export async function createBrand(db: Db, input: unknown, actor = "user") {
  const v = BrandInput.parse(input);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  return db.tx(async (t) => {
    const id = await nextId(t, "brands", "brand_id", "AX", 4);
    const at = iso(await clock(t));
    await t.query(`INSERT INTO brands(brand_id, brand_name, industry, owner_id, created_at, origin, notes) VALUES ($1,$2,$3,$4,$5,'app',$6)`, [id, v.brand_name, v.industry, v.owner_id ?? null, at, v.notes ?? null]);
    const hid = await nextId(t, "qualification_history", "history_id", "BQA", 6);
    await t.query(`INSERT INTO qualification_history(history_id, brand_id, status, reason, effective_at, origin) VALUES ($1,$2,'unreviewed','Brand added in SponsorOS',$3,'app')`, [hid, id, at]);
    await audit(t, actor, "brand", id, "create", null, v);
    return { brand_id: id };
  });
}
export const BrandPatch = BrandInput.partial();
export async function updateBrand(db: Db, id: string, input: unknown, actor = "user") {
  const v = BrandPatch.parse(input);
  const [before] = await db.query(`SELECT * FROM brands WHERE brand_id = $1`, [id]);
  if (!before) fail(`Brand '${id}' not found`);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  await db.query(
    `UPDATE brands SET brand_name = COALESCE($2, brand_name), industry = COALESCE($3, industry), owner_id = CASE WHEN $4::boolean THEN $5 ELSE owner_id END, notes = COALESCE($6, notes), updated_at = now() WHERE brand_id = $1`,
    [id, v.brand_name ?? null, v.industry ?? null, v.owner_id !== undefined, v.owner_id ?? null, v.notes ?? null],
  );
  await audit(db, actor, "brand", id, "update", before, v);
  return { brand_id: id };
}
export const QualInput = z.object({ status: z.enum(["unreviewed", "engaged", "qualified", "unqualified", "dormant"]), reason: z.string().trim().min(3).max(500) });
export async function setQualification(db: Db, brandId: string, input: unknown, actor = "user") {
  const v = QualInput.parse(input);
  await mustExist(db, "brands", "brand_id", brandId, "Brand");
  const at = await clock(db);
  const [last] = await db.query<{ t: unknown }>(`SELECT max(effective_at) t FROM qualification_history WHERE brand_id = $1`, [brandId]);
  if (last?.t && ms(last.t) > at) fail(`Operating clock (${iso(at)}) is earlier than this brand's latest qualification version (${iso(ms(last.t))}). Move the clock forward to record a new version.`);
  const hid = await nextId(db, "qualification_history", "history_id", "BQA", 6);
  await db.query(`INSERT INTO qualification_history(history_id, brand_id, status, reason, effective_at, origin) VALUES ($1,$2,$3,$4,$5,'app')`, [hid, brandId, v.status, v.reason, iso(at)]);
  await audit(db, actor, "qualification", brandId, "new_version", null, v);
  return { history_id: hid };
}
export const ContactInput = z.object({ brand_id: z.string(), contact_name: z.string().trim().min(2).max(120), job_title: z.string().max(120).optional(), email: z.string().email().optional().or(z.literal("")) });
export async function createContact(db: Db, input: unknown, actor = "user") {
  const v = ContactInput.parse(input);
  await mustExist(db, "brands", "brand_id", v.brand_id, "Brand");
  const id = await nextId(db, "contacts", "contact_id", "SCONX", 4);
  await db.query(`INSERT INTO contacts(contact_id, brand_id, contact_name, job_title, email, created_at, origin) VALUES ($1,$2,$3,$4,$5,$6,'app')`, [id, v.brand_id, v.contact_name, v.job_title ?? null, v.email || null, iso(await clock(db))]);
  await audit(db, actor, "contact", id, "create", null, v);
  return { contact_id: id };
}
export const InteractionInput = z.object({
  brand_id: z.string(), contact_id: z.string().nullable().optional(), campaign_id: z.string().nullable().optional(),
  event_type: z.enum(["outreach_sent", "introduction_received", "web_inbound", "replied", "meeting_booked", "meeting_held", "opt_out"]),
  outcome: z.string().max(40).optional(), summary: z.string().max(1000).optional(),
});
export async function logInteraction(db: Db, input: unknown, actor = "user") {
  const v = InteractionInput.parse(input);
  await mustExist(db, "brands", "brand_id", v.brand_id, "Brand");
  await mustExist(db, "contacts", "contact_id", v.contact_id, "Contact");
  await mustExist(db, "campaigns", "sponsor_campaign_id", v.campaign_id, "Campaign");
  const at = iso(await clock(db));
  const isRoot = ["outreach_sent", "introduction_received", "web_inbound"].includes(v.event_type);
  let attempt: string, origin: string | null = null, campaign = v.campaign_id ?? null, channel = "other";
  if (isRoot) attempt = await nextId(db, "interactions", "attempt_id", "SAA", 5);
  else {
    const [root] = await db.query<{ interaction_id: string; attempt_id: string; campaign_id: string | null; channel: string }>(
      `SELECT interaction_id, attempt_id, campaign_id, channel FROM interactions WHERE brand_id = $1 AND origin_interaction_id IS NULL AND occurred_at <= $2 ${v.campaign_id ? "AND campaign_id = $3" : ""} ORDER BY occurred_at DESC LIMIT 1`,
      v.campaign_id ? [v.brand_id, at, v.campaign_id] : [v.brand_id, at],
    );
    if (!root) fail("No earlier outreach/intro/inbound touch exists for this brand; log the root touch first.");
    attempt = root.attempt_id; origin = root.interaction_id; campaign = root.campaign_id; channel = root.channel;
  }
  if (campaign) { const [c] = await db.query<{ channel: string }>(`SELECT channel FROM campaigns WHERE sponsor_campaign_id = $1`, [campaign]); channel = c?.channel ?? channel; }
  const id = await nextId(db, "interactions", "interaction_id", "SIA", 5);
  const outcome = v.outcome ?? ({ outreach_sent: "sent", introduction_received: "introduced", web_inbound: "interest_submitted", replied: "positive", meeting_booked: "scheduled", meeting_held: "attended", opt_out: "do_not_contact" } as Record<string, string>)[v.event_type];
  await db.query(
    `INSERT INTO interactions(interaction_id, attempt_id, origin_interaction_id, brand_id, contact_id, campaign_id, channel, event_type, outcome, summary, occurred_at, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'app')`,
    [id, attempt, origin, v.brand_id, v.contact_id ?? null, campaign, channel, v.event_type, outcome, v.summary ?? null, at],
  );
  await audit(db, actor, "interaction", id, "create", null, v);
  return { interaction_id: id };
}

// ---------------------------------------------------------------- opportunities
const STAGES = ["prospecting", "contacted", "proposal_sent", "negotiating", "partner_confirmed", "lost", "withdrawn"] as const;
export const OppInput = z.object({
  brand_id: z.string(), opportunity_name: z.string().trim().max(160).optional(), primary_contact_id: z.string().nullable().optional(),
  campaign_id: z.string().nullable().optional(), support_type: z.enum(["cash", "in_kind"]), proposed_value_inr: z.number().int().min(0).max(100_000_000),
  owner_id: z.string().nullable().optional(), stage: z.enum(STAGES).default("prospecting"),
});
export async function createOpportunity(db: Db, input: unknown, actor = "user") {
  const v = OppInput.parse(input);
  const [b] = await db.query<{ brand_name: string }>(`SELECT brand_name FROM brands WHERE brand_id = $1`, [v.brand_id]);
  if (!b) fail(`Brand '${v.brand_id}' not found`);
  await mustExist(db, "contacts", "contact_id", v.primary_contact_id, "Contact");
  await mustExist(db, "campaigns", "sponsor_campaign_id", v.campaign_id, "Campaign");
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  if (v.primary_contact_id) {
    const [c] = await db.query<{ brand_id: string }>(`SELECT brand_id FROM contacts WHERE contact_id = $1`, [v.primary_contact_id]);
    if (c.brand_id !== v.brand_id) fail("Primary contact belongs to a different brand");
  }
  return db.tx(async (t) => {
    const id = await nextId(t, "opportunities", "opportunity_id", "OX", 4);
    const at = iso(await clock(t));
    await t.query(`INSERT INTO opportunities(opportunity_id, opportunity_name, brand_id, primary_contact_id, campaign_id, support_type, created_at, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,'app')`,
      [id, v.opportunity_name || `${b.brand_name} festival partnership`, v.brand_id, v.primary_contact_id ?? null, v.campaign_id ?? null, v.support_type, at]);
    const hid = await nextId(t, "opportunity_history", "history_id", "OHA", 6);
    await t.query(`INSERT INTO opportunity_history(history_id, opportunity_id, stage, proposed_value_inr, confirmed_value_inr, owner_id, effective_at, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,'app')`,
      [hid, id, v.stage, v.proposed_value_inr, v.stage === "partner_confirmed" ? v.proposed_value_inr : 0, v.owner_id ?? null, at]);
    await audit(t, actor, "opportunity", id, "create", null, v);
    return { opportunity_id: id };
  });
}
export const OppPatch = z.object({ stage: z.enum(STAGES).optional(), proposed_value_inr: z.number().int().min(0).max(100_000_000).optional(), confirmed_value_inr: z.number().int().min(0).max(100_000_000).optional(), owner_id: z.string().nullable().optional(), support_type: z.enum(["cash", "in_kind"]).optional(), note: z.string().max(500).optional() });
export async function updateOpportunity(db: Db, id: string, input: unknown, actor = "user") {
  const v = OppPatch.parse(input);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  return db.tx(async (t) => {
    const [cur] = await t.query<{ stage: string; proposed_value_inr: number; confirmed_value_inr: number; owner_id: string | null; effective_at: unknown }>(
      `SELECT stage, proposed_value_inr, confirmed_value_inr, owner_id, effective_at FROM opportunity_history WHERE opportunity_id = $1 ORDER BY effective_at DESC, history_id DESC LIMIT 1`, [id]);
    if (!cur) fail(`Opportunity '${id}' not found`);
    const at = await clock(t);
    if (ms(cur.effective_at) > at) fail(`Operating clock (${iso(at)}) is earlier than this opportunity's latest version (${iso(ms(cur.effective_at))}). Move the clock forward to record a change.`);
    const stage = v.stage ?? cur.stage;
    const proposed = v.proposed_value_inr ?? Number(cur.proposed_value_inr);
    const confirmed = stage === "partner_confirmed" ? (v.confirmed_value_inr ?? (cur.stage === "partner_confirmed" ? Number(cur.confirmed_value_inr) : proposed)) : 0;
    if (v.confirmed_value_inr != null && stage !== "partner_confirmed") fail("confirmed_value_inr can only be set when stage is partner_confirmed");
    if (v.support_type) await t.query(`UPDATE opportunities SET support_type = $2 WHERE opportunity_id = $1`, [id, v.support_type]);
    const hid = await nextId(t, "opportunity_history", "history_id", "OHA", 6);
    const owner = v.owner_id !== undefined ? v.owner_id : cur.owner_id;
    await t.query(`INSERT INTO opportunity_history(history_id, opportunity_id, stage, proposed_value_inr, confirmed_value_inr, owner_id, effective_at, note, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'app')`,
      [hid, id, stage, proposed, confirmed, owner, iso(at), v.note ?? null]);
    await audit(t, actor, "opportunity", id, "new_version", cur, { stage, proposed, confirmed, owner, note: v.note });
    return { history_id: hid, stage, confirmed_value_inr: confirmed };
  });
}

// ---------------------------------------------------------------- campaigns
export const CampaignInput = z.object({
  campaign_name: z.string().trim().min(3).max(120), channel: z.enum(["email", "linkedin", "introduction", "web_inbound", "event", "other"]),
  objective: z.string().max(300).optional(), audience: z.string().max(300).optional(), owner_id: z.string().nullable().optional(),
  planned_start_at: z.string().datetime({ offset: true }).optional(), planned_end_at: z.string().datetime({ offset: true }).optional(),
  budget_inr: z.number().int().min(0).nullable().optional(), initiative_id: z.string().nullable().optional(), status: z.enum(["planned", "active", "paused", "stopped"]).default("planned"),
});
export async function createCampaign(db: Db, input: unknown, actor = "user") {
  const v = CampaignInput.parse(input);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  await mustExist(db, "initiatives", "id", v.initiative_id, "Initiative");
  const id = await nextId(db, "campaigns", "sponsor_campaign_id", "SCX", 3);
  await db.query(`INSERT INTO campaigns(sponsor_campaign_id, campaign_name, channel, objective, audience, owner_id, planned_start_at, planned_end_at, created_at, status, budget_inr, initiative_id, origin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'app')`,
    [id, v.campaign_name, v.channel, v.objective ?? null, v.audience ?? null, v.owner_id ?? null, v.planned_start_at ?? null, v.planned_end_at ?? null, iso(await clock(db)), v.status, v.budget_inr ?? null, v.initiative_id ?? null]);
  await audit(db, actor, "campaign", id, "create", null, v);
  return { sponsor_campaign_id: id };
}
export const CampaignPatch = z.object({ status: z.enum(["planned", "active", "paused", "stopped"]).optional(), budget_inr: z.number().int().min(0).nullable().optional(), owner_id: z.string().nullable().optional(), initiative_id: z.string().nullable().optional(), objective: z.string().max(300).optional() });
export async function updateCampaign(db: Db, id: string, input: unknown, actor = "user") {
  const v = CampaignPatch.parse(input);
  const [before] = await db.query(`SELECT * FROM campaigns WHERE sponsor_campaign_id = $1`, [id]);
  if (!before) fail(`Campaign '${id}' not found`);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  await mustExist(db, "initiatives", "id", v.initiative_id, "Initiative");
  const sets: string[] = []; const params: unknown[] = [id];
  for (const [k, val] of Object.entries(v)) if (val !== undefined) { params.push(val); sets.push(`${k} = $${params.length}`); }
  if (sets.length) await db.query(`UPDATE campaigns SET ${sets.join(", ")} WHERE sponsor_campaign_id = $1`, params);
  await audit(db, actor, "campaign", id, "update", before, v);
  return { sponsor_campaign_id: id };
}
export const SpendInput = z.object({ amount_inr: z.number().int().positive().max(10_000_000), spent_on: z.string().datetime({ offset: true }).optional(), note: z.string().max(300).optional() });
export async function addSpend(db: Db, campaignId: string, input: unknown, actor = "user") {
  const v = SpendInput.parse(input);
  await mustExist(db, "campaigns", "sponsor_campaign_id", campaignId, "Campaign");
  const [r] = await db.query<{ id: number }>(`INSERT INTO campaign_spend(campaign_id, amount_inr, spent_on, note) VALUES ($1,$2,$3,$4) RETURNING id`, [campaignId, v.amount_inr, v.spent_on ?? iso(await clock(db)), v.note ?? null]);
  await audit(db, actor, "campaign_spend", String(r.id), "create", null, { campaignId, ...v });
  return r;
}

// ---------------------------------------------------------------- cash
async function confirmedCash(db: Db, oppId: string) {
  const [h] = await db.query<{ stage: string; confirmed_value_inr: number; effective_at: unknown }>(
    `SELECT h.stage, h.confirmed_value_inr, h.effective_at FROM opportunity_history h WHERE h.opportunity_id = $1 AND h.effective_at <= $2 ORDER BY h.effective_at DESC, h.history_id DESC LIMIT 1`, [oppId, iso(await clock(db))]);
  const [o] = await db.query<{ support_type: string }>(`SELECT support_type FROM opportunities WHERE opportunity_id = $1`, [oppId]);
  if (!o) fail(`Opportunity '${oppId}' not found`);
  return { isConfirmedCash: h?.stage === "partner_confirmed" && o.support_type === "cash", value: Number(h?.confirmed_value_inr ?? 0), confirmedAt: h ? ms(h.effective_at) : null, support: o.support_type };
}
export const MilestoneInput = z.object({ opportunity_id: z.string(), label: z.string().trim().min(2).max(80), amount_inr: z.number().int().positive(), due_at: z.string().datetime({ offset: true }) });
export async function createMilestone(db: Db, input: unknown, actor = "user") {
  const v = MilestoneInput.parse(input);
  const c = await confirmedCash(db, v.opportunity_id);
  if (!c.isConfirmedCash) fail("Payment milestones can only be created for confirmed cash-type partnerships (in-kind is never cash).");
  const [{ s }] = await db.query<{ s: number }>(`SELECT COALESCE(sum(amount_inr),0)::int s FROM payment_milestones WHERE opportunity_id = $1 AND status <> 'cancelled'`, [v.opportunity_id]);
  if (Number(s) + v.amount_inr > c.value) fail(`Scheduled total would be ₹${(Number(s) + v.amount_inr).toLocaleString("en-IN")}, above the confirmed value ₹${c.value.toLocaleString("en-IN")}.`);
  const [r] = await db.query<{ id: number }>(`INSERT INTO payment_milestones(opportunity_id, label, amount_inr, due_at, basis) VALUES ($1,$2,$3,$4,'user') RETURNING id`, [v.opportunity_id, v.label, v.amount_inr, v.due_at]);
  await audit(db, actor, "payment_milestone", String(r.id), "create", null, v);
  return r;
}
export async function generateSchedule(db: Db, oppId: string, actor = "user") {
  const c = await confirmedCash(db, oppId);
  if (!c.isConfirmedCash) fail("Only confirmed cash-type partnerships can be scheduled.");
  const existing = await db.query(`SELECT 1 FROM payment_milestones WHERE opportunity_id = $1 AND status <> 'cancelled'`, [oppId]);
  if (existing.length) fail("This partnership already has an active payment schedule; edit or cancel milestones instead.");
  const pol = await getSetting<{ advance_pct: number; advance_due_days_after_signing: number; balance_due_days_before_festival: number }>(db, "collection_policy");
  const [ev] = await db.query<{ event_starts_at: unknown }>(`SELECT event_starts_at FROM event WHERE id = 1`);
  const now = await clock(db), fest = ms(ev.event_starts_at), D = 86_400_000;
  const advDue = Math.max(now, c.confirmedAt ?? now) + pol.advance_due_days_after_signing * D;
  const balDue = Math.max(advDue, fest - pol.balance_due_days_before_festival * D);
  const adv = Math.round(c.value * pol.advance_pct);
  const rows: [string, number, number][] = adv > 0 && adv < c.value ? [["Advance (policy)", adv, advDue], ["Balance (policy)", c.value - adv, balDue]] : [["Full payment (policy)", c.value, advDue]];
  const ids: number[] = [];
  for (const [label, amt, due] of rows) {
    const [r] = await db.query<{ id: number }>(`INSERT INTO payment_milestones(opportunity_id, label, amount_inr, due_at, basis) VALUES ($1,$2,$3,$4,'policy_generated') RETURNING id`, [oppId, label, amt, iso(due)]);
    ids.push(r.id);
  }
  await audit(db, actor, "payment_milestone", oppId, "generate_schedule", null, { policy: pol, rows });
  return { milestone_ids: ids, note: "[ASSUMPTION] Planned schedule from the collection policy; not an invoice or a receipt." };
}
export const MilestonePatch = z.object({ status: z.enum(["planned", "invoiced", "cancelled"]).optional(), invoice_number: z.string().max(60).optional(), amount_inr: z.number().int().positive().optional(), due_at: z.string().datetime({ offset: true }).optional(), label: z.string().max(80).optional() });
export async function updateMilestone(db: Db, id: number, input: unknown, actor = "user") {
  const v = MilestonePatch.parse(input);
  const [before] = await db.query<{ opportunity_id: string; amount_inr: number }>(`SELECT * FROM payment_milestones WHERE id = $1`, [id]);
  if (!before) fail(`Milestone ${id} not found`);
  if (v.status === "invoiced" && !v.invoice_number) fail("An invoice number is required to mark a milestone invoiced.");
  if (v.amount_inr) {
    const c = await confirmedCash(db, before.opportunity_id);
    const [{ s }] = await db.query<{ s: number }>(`SELECT COALESCE(sum(amount_inr),0)::int s FROM payment_milestones WHERE opportunity_id = $1 AND status <> 'cancelled' AND id <> $2`, [before.opportunity_id, id]);
    if (Number(s) + v.amount_inr > c.value) fail("Scheduled total would exceed the confirmed value.");
  }
  await db.query(`UPDATE payment_milestones SET status = COALESCE($2,status), invoice_number = COALESCE($3,invoice_number), invoiced_at = CASE WHEN $2 = 'invoiced' THEN $7::timestamptz ELSE invoiced_at END, amount_inr = COALESCE($4,amount_inr), due_at = COALESCE($5,due_at), label = COALESCE($6,label) WHERE id = $1`,
    [id, v.status ?? null, v.invoice_number ?? null, v.amount_inr ?? null, v.due_at ?? null, v.label ?? null, iso(await clock(db))]);
  await audit(db, actor, "payment_milestone", String(id), "update", before, v);
  return { id };
}
export const ReceiptInput = z.object({
  opportunity_id: z.string(), milestone_id: z.number().int().nullable().optional(), amount_inr: z.number().int().positive().max(100_000_000),
  received_at: z.string().datetime({ offset: true }).optional(), reference: z.string().trim().min(3).max(80), verified: z.boolean().default(false),
  is_test: z.boolean().default(false), note: z.string().max(300).optional(),
});
export async function recordReceipt(db: Db, input: unknown, actor = "user") {
  const v = ReceiptInput.parse(input);
  if (actor.startsWith("ai")) fail("The AI analyst cannot record receipts. Receipts must be entered by a person from bank evidence.");
  const c = await confirmedCash(db, v.opportunity_id);
  if (c.support !== "cash") fail("In-kind partnerships cannot have cash receipts.");
  if (v.milestone_id != null) {
    const [m] = await db.query<{ opportunity_id: string }>(`SELECT opportunity_id FROM payment_milestones WHERE id = $1`, [v.milestone_id]);
    if (!m || m.opportunity_id !== v.opportunity_id) fail("Milestone does not belong to this opportunity");
  }
  const [r] = await db.query<{ id: number }>(`INSERT INTO receipts(opportunity_id, milestone_id, amount_inr, received_at, reference, verified, is_test, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [v.opportunity_id, v.milestone_id ?? null, v.amount_inr, v.received_at ?? iso(await clock(db)), v.reference, v.verified, v.is_test, v.note ?? null]);
  await audit(db, actor, "receipt", String(r.id), "create", null, v);
  return { id: r.id, warning: !c.isConfirmedCash ? "Opportunity is not currently confirmed; receipt is flagged as orphan cash." : undefined };
}
export async function verifyReceipt(db: Db, id: number, verified: boolean, actor = "user") {
  const [before] = await db.query(`SELECT * FROM receipts WHERE id = $1`, [id]);
  if (!before) fail(`Receipt ${id} not found`);
  await db.query(`UPDATE receipts SET verified = $2 WHERE id = $1`, [id, verified]);
  await audit(db, actor, "receipt", String(id), verified ? "verify" : "unverify", before, { verified });
  return { id };
}

// ---------------------------------------------------------------- tasks & recommendations
export const TaskInput = z.object({
  title: z.string().trim().min(3).max(200), description: z.string().max(2000).optional(), owner_id: z.string().nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(), priority: z.enum(["high", "medium", "low"]).default("medium"),
  opportunity_id: z.string().nullable().optional(), brand_id: z.string().nullable().optional(), campaign_id: z.string().nullable().optional(), initiative_id: z.string().nullable().optional(),
});
export async function createTask(db: Db, input: unknown, actor = "user", extra: { recommendation_id?: number; created_by?: string } = {}) {
  const v = TaskInput.parse(input);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  await mustExist(db, "opportunities", "opportunity_id", v.opportunity_id, "Opportunity");
  await mustExist(db, "brands", "brand_id", v.brand_id, "Brand");
  await mustExist(db, "campaigns", "sponsor_campaign_id", v.campaign_id, "Campaign");
  await mustExist(db, "initiatives", "id", v.initiative_id, "Initiative");
  const [r] = await db.query<{ id: number }>(
    `INSERT INTO tasks(title, description, owner_id, due_at, priority, opportunity_id, brand_id, campaign_id, initiative_id, recommendation_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [v.title, v.description ?? null, v.owner_id ?? null, v.due_at ?? null, v.priority, v.opportunity_id ?? null, v.brand_id ?? null, v.campaign_id ?? null, v.initiative_id ?? null, extra.recommendation_id ?? null, extra.created_by ?? "user"],
  );
  await audit(db, actor, "task", String(r.id), "create", null, { ...v, ...extra });
  return { id: r.id };
}
export const TaskPatch = z.object({ status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(), owner_id: z.string().nullable().optional(), due_at: z.string().datetime({ offset: true }).nullable().optional(), priority: z.enum(["high", "medium", "low"]).optional(), outcome: z.string().max(1000).optional(), title: z.string().min(3).max(200).optional() });
export async function updateTask(db: Db, id: number, input: unknown, actor = "user") {
  const v = TaskPatch.parse(input);
  const [before] = await db.query<{ recommendation_id: number | null }>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!before) fail(`Task ${id} not found`);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  const sets: string[] = []; const params: unknown[] = [id];
  for (const [k, val] of Object.entries(v)) if (val !== undefined) { params.push(val); sets.push(`${k} = $${params.length}`); }
  if (v.status === "done") sets.push(`completed_at = now()`);
  if (sets.length) await db.query(`UPDATE tasks SET ${sets.join(", ")} WHERE id = $1`, params);
  if (v.outcome && before.recommendation_id) await db.query(`UPDATE recommendations SET outcome = $2 WHERE id = $1`, [before.recommendation_id, v.outcome]);
  await audit(db, actor, "task", String(id), "update", before, v);
  return { id };
}

export const RecommendationInput = z.object({
  source: z.enum(["readiness", "threshold", "ai", "user"]), issue: z.string().min(3).max(500), evidence: z.record(z.unknown()),
  diagnosis: z.string().max(1000).optional(), action: z.string().min(3).max(500), expected_impact: z.string().max(500).optional(),
});
/** Evidence -> decision -> task, in one transaction. Approve creates the task; reject records the decision only. */
export async function decideRecommendation(db: Db, input: { recommendation: unknown; decision: "approved" | "rejected"; note?: string; task?: unknown }, actor = "user") {
  const rec = RecommendationInput.parse(input.recommendation);
  return db.tx(async (t) => {
    const [r] = await t.query<{ id: number }>(
      `INSERT INTO recommendations(source, issue, evidence, diagnosis, action, expected_impact, status, decided_at, decision_note) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8) RETURNING id`,
      [rec.source, rec.issue, JSON.stringify(rec.evidence), rec.diagnosis ?? null, rec.action, rec.expected_impact ?? null, input.decision, input.note ?? null],
    );
    let taskId: number | null = null;
    if (input.decision === "approved") {
      if (!input.task) fail("Approving a recommendation requires a task (owner, due date).");
      const task = await createTask(t, input.task, actor, { recommendation_id: r.id, created_by: actor.startsWith("ai") ? "ai_confirmed" : rec.source === "readiness" ? "readiness_confirmed" : "user" });
      taskId = task.id;
      await t.query(`UPDATE recommendations SET task_id = $2 WHERE id = $1`, [r.id, taskId]);
    }
    await audit(t, actor, "recommendation", String(r.id), input.decision, null, { ...rec, task_id: taskId });
    return { recommendation_id: r.id, task_id: taskId, status: input.decision };
  });
}

// ---------------------------------------------------------------- thresholds / initiatives / scenarios
export const ThresholdPatch = z.object({ scale_at: z.number().optional(), stop_at: z.number().optional(), min_sample: z.number().int().min(0).optional() });
export async function updateThreshold(db: Db, id: number, input: unknown, actor = "user") {
  const v = ThresholdPatch.parse(input);
  const [before] = await db.query(`SELECT * FROM kpi_thresholds WHERE id = $1`, [id]);
  if (!before) fail(`Threshold ${id} not found`);
  await db.query(`UPDATE kpi_thresholds SET scale_at = COALESCE($2,scale_at), stop_at = COALESCE($3,stop_at), min_sample = COALESCE($4,min_sample) WHERE id = $1`, [id, v.scale_at ?? null, v.stop_at ?? null, v.min_sample ?? null]);
  await audit(db, actor, "kpi_threshold", String(id), "update", before, v);
  return { id };
}
export async function updateInitiative(db: Db, id: string, input: unknown, actor = "user") {
  const v = z.object({ status: z.enum(["active", "scaled", "changed", "stopped"]).optional(), owner_id: z.string().nullable().optional(), budget_inr: z.number().int().min(0).optional() }).parse(input);
  const [before] = await db.query(`SELECT * FROM initiatives WHERE id = $1`, [id]);
  if (!before) fail(`Initiative ${id} not found`);
  await mustExist(db, "team_members", "id", v.owner_id, "Owner");
  await db.query(`UPDATE initiatives SET status = COALESCE($2,status), owner_id = CASE WHEN $3::boolean THEN $4 ELSE owner_id END, budget_inr = COALESCE($5,budget_inr) WHERE id = $1`, [id, v.status ?? null, v.owner_id !== undefined, v.owner_id ?? null, v.budget_inr ?? null]);
  await audit(db, actor, "initiative", id, "update", before, v);
  return { id };
}
export async function saveScenario(db: Db, input: { name: string; level: string; overrides: unknown; result: unknown }, actor = "user") {
  const v = z.object({ name: z.string().min(2).max(80), level: z.enum(["base", "stretch"]), overrides: z.record(z.unknown()), result: z.record(z.unknown()) }).parse(input);
  const [r] = await db.query<{ id: number }>(`INSERT INTO scenarios(name, level, overrides, result) VALUES ($1,$2,$3,$4) RETURNING id`, [v.name, v.level, JSON.stringify(v.overrides), JSON.stringify(v.result)]);
  await audit(db, actor, "scenario", String(r.id), "create", null, { name: v.name, level: v.level, overrides: v.overrides });
  return r;
}

/** Restore the operational layer to the imported source state (keeps raw_records and source rows). */
export async function resetToSource(db: Db) {
  await db.tx(async (t) => {
    for (const sql of [
      `DELETE FROM tasks`, `DELETE FROM recommendations`, `DELETE FROM receipts`, `DELETE FROM payment_milestones`, `DELETE FROM campaign_spend`, `DELETE FROM scenarios`, `DELETE FROM chat_log`,
      `DELETE FROM opportunity_history WHERE origin = 'app'`, `DELETE FROM activations WHERE opportunity_id IN (SELECT opportunity_id FROM opportunities WHERE origin='app')`,
      `DELETE FROM opportunities WHERE origin = 'app'`, `DELETE FROM qualification_history WHERE origin = 'app'`, `DELETE FROM interactions WHERE origin = 'app'`,
      `DELETE FROM contacts WHERE origin = 'app'`, `DELETE FROM targets WHERE origin = 'app'`, `DELETE FROM brands WHERE origin = 'app'`,
      `DELETE FROM campaigns WHERE origin = 'app'`, `UPDATE campaigns SET status = 'active', budget_inr = NULL, initiative_id = NULL`,
      `DELETE FROM kpi_thresholds`, `DELETE FROM initiatives`, `DELETE FROM settings`,
    ]) await t.query(sql);
  });
  // restore source brand fields edited in-app
  const raw = await db.query<{ payload: Record<string, unknown> }>(`SELECT payload FROM raw_records WHERE sheet = 'Brands'`);
  for (const { payload: p } of raw) await db.query(`UPDATE brands SET brand_name=$2, industry=$3, owner_id=$4, notes=NULL WHERE brand_id=$1`, [p.brand_id, p.brand_name, p.industry, p.owner_id]);
  const { seedOperationalConfig } = await import("./db/config-seed");
  await seedOperationalConfig(db);
  await audit(db, "user", "system", "all", "reset_to_source", null, null);
}
