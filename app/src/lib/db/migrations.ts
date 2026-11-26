// Versioned SQL migrations. Applied in order, each recorded in schema_migrations.
// Run against Supabase with `npm run db:sql > schema.sql` and paste into the SQL editor, or let the app apply them.

export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_core",
    sql: `
-- ---------- provenance: raw source preserved, never edited ----------
CREATE TABLE IF NOT EXISTS source_imports (
  id            serial PRIMARY KEY,
  file_name     text NOT NULL,
  sha256        text NOT NULL UNIQUE,
  imported_at   timestamptz NOT NULL DEFAULT now(),
  row_counts    jsonb NOT NULL,
  dedupe_log    jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS raw_records (
  sheet         text NOT NULL,
  source_id     text NOT NULL,
  import_id     integer NOT NULL REFERENCES source_imports(id),
  payload       jsonb NOT NULL,
  PRIMARY KEY (sheet, source_id)
);

-- ---------- reference ----------
CREATE TABLE IF NOT EXISTS event (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  event_name       text NOT NULL,
  history_start    timestamptz NOT NULL,
  history_end      timestamptz NOT NULL,
  event_starts_at  timestamptz NOT NULL,
  event_ends_at    timestamptz NOT NULL,
  timezone         text NOT NULL,
  currency         text NOT NULL
);
CREATE TABLE IF NOT EXISTS team_members (
  id    text PRIMARY KEY,
  name  text NOT NULL
);

-- ---------- operational entities (origin = 'source' | 'app') ----------
CREATE TABLE IF NOT EXISTS brands (
  brand_id    text PRIMARY KEY,
  brand_name  text NOT NULL,
  industry    text NOT NULL,
  owner_id    text REFERENCES team_members(id),
  created_at  timestamptz NOT NULL,
  origin      text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app')),
  notes       text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contacts (
  contact_id    text PRIMARY KEY,
  brand_id      text NOT NULL REFERENCES brands(brand_id),
  contact_name  text NOT NULL,
  job_title     text,
  email         text,
  created_at    timestamptz NOT NULL,
  origin        text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app'))
);
CREATE INDEX IF NOT EXISTS contacts_brand_idx ON contacts(brand_id);

CREATE TABLE IF NOT EXISTS campaigns (
  sponsor_campaign_id  text PRIMARY KEY,
  campaign_name        text NOT NULL,
  channel              text NOT NULL CHECK (channel IN ('email','linkedin','introduction','web_inbound','event','other')),
  objective            text,
  audience             text,
  owner_id             text REFERENCES team_members(id),
  planned_start_at     timestamptz,
  planned_end_at       timestamptz,
  created_at           timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','paused','stopped')),
  budget_inr           integer CHECK (budget_inr IS NULL OR budget_inr >= 0),
  initiative_id        text,
  origin               text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app'))
);
CREATE TABLE IF NOT EXISTS campaign_spend (
  id           serial PRIMARY KEY,
  campaign_id  text NOT NULL REFERENCES campaigns(sponsor_campaign_id),
  amount_inr   integer NOT NULL CHECK (amount_inr > 0),
  spent_on     timestamptz NOT NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interactions (
  interaction_id         text PRIMARY KEY,
  attempt_id             text NOT NULL,
  origin_interaction_id  text,
  brand_id               text NOT NULL REFERENCES brands(brand_id),
  contact_id             text REFERENCES contacts(contact_id),
  campaign_id            text REFERENCES campaigns(sponsor_campaign_id),
  owner_id               text,
  channel                text NOT NULL,
  event_type             text NOT NULL CHECK (event_type IN ('outreach_sent','delivered','replied','meeting_booked','meeting_held','opt_out','introduction_received','web_inbound')),
  outcome                text,
  summary                text,
  occurred_at            timestamptz NOT NULL,
  origin                 text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app'))
);
CREATE INDEX IF NOT EXISTS interactions_brand_idx ON interactions(brand_id);
CREATE INDEX IF NOT EXISTS interactions_campaign_idx ON interactions(campaign_id);
CREATE INDEX IF NOT EXISTS interactions_time_idx ON interactions(occurred_at);

-- full-state histories: append-only, latest version <= as-of wins
CREATE TABLE IF NOT EXISTS qualification_history (
  history_id     text PRIMARY KEY,
  brand_id       text NOT NULL REFERENCES brands(brand_id),
  status         text NOT NULL CHECK (status IN ('unreviewed','engaged','qualified','unqualified','dormant')),
  reason         text,
  campaign_id    text REFERENCES campaigns(sponsor_campaign_id),
  effective_at   timestamptz NOT NULL,
  origin         text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app'))
);
CREATE INDEX IF NOT EXISTS qh_brand_time_idx ON qualification_history(brand_id, effective_at);

CREATE TABLE IF NOT EXISTS opportunities (
  opportunity_id      text PRIMARY KEY,
  opportunity_name    text NOT NULL,
  brand_id            text NOT NULL REFERENCES brands(brand_id),
  primary_contact_id  text REFERENCES contacts(contact_id),
  campaign_id         text REFERENCES campaigns(sponsor_campaign_id),
  support_type        text NOT NULL CHECK (support_type IN ('cash','in_kind')),
  created_at          timestamptz NOT NULL,
  origin              text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app'))
);
CREATE INDEX IF NOT EXISTS opp_brand_idx ON opportunities(brand_id);

CREATE TABLE IF NOT EXISTS opportunity_history (
  history_id           text PRIMARY KEY,
  opportunity_id       text NOT NULL REFERENCES opportunities(opportunity_id),
  stage                text NOT NULL CHECK (stage IN ('prospecting','contacted','proposal_sent','negotiating','partner_confirmed','lost','withdrawn')),
  proposed_value_inr   integer CHECK (proposed_value_inr IS NULL OR proposed_value_inr >= 0),
  confirmed_value_inr  integer NOT NULL DEFAULT 0 CHECK (confirmed_value_inr >= 0),
  owner_id             text,
  effective_at         timestamptz NOT NULL,
  note                 text,
  origin               text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app')),
  CHECK (stage = 'partner_confirmed' OR confirmed_value_inr = 0)
);
CREATE INDEX IF NOT EXISTS oh_opp_time_idx ON opportunity_history(opportunity_id, effective_at);

CREATE TABLE IF NOT EXISTS activations (
  activation_id           text PRIMARY KEY,
  opportunity_id          text NOT NULL REFERENCES opportunities(opportunity_id),
  brand_id                text NOT NULL REFERENCES brands(brand_id),
  attendee_campaign_id    text,
  attendee_campaign_name  text,
  activation_note         text,
  linked_at               timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS targets (
  id                            serial PRIMARY KEY,
  effective_at                  timestamptz NOT NULL,
  target_version                text NOT NULL,
  qualified_brands_goal         integer,
  confirmed_partnerships_goal   integer,
  cash_collection_goal_inr      integer,
  basis                         text,
  origin                        text NOT NULL DEFAULT 'app' CHECK (origin IN ('source','app')),
  UNIQUE (effective_at, target_version)
);

-- ---------- cash: no historical source rows exist; only app-created records ----------
CREATE TABLE IF NOT EXISTS payment_milestones (
  id              serial PRIMARY KEY,
  opportunity_id  text NOT NULL REFERENCES opportunities(opportunity_id),
  label           text NOT NULL,
  amount_inr      integer NOT NULL CHECK (amount_inr > 0),
  due_at          timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','invoiced','cancelled')),
  invoice_number  text,
  invoiced_at     timestamptz,
  basis           text NOT NULL DEFAULT 'user' CHECK (basis IN ('user','policy_generated')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pm_opp_idx ON payment_milestones(opportunity_id);
CREATE TABLE IF NOT EXISTS receipts (
  id              serial PRIMARY KEY,
  opportunity_id  text NOT NULL REFERENCES opportunities(opportunity_id),
  milestone_id    integer REFERENCES payment_milestones(id),
  amount_inr      integer NOT NULL CHECK (amount_inr > 0),
  received_at     timestamptz NOT NULL,
  reference       text NOT NULL,
  verified        boolean NOT NULL DEFAULT false,
  is_test         boolean NOT NULL DEFAULT false,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_opp_idx ON receipts(opportunity_id);

-- ---------- execution ----------
CREATE TABLE IF NOT EXISTS initiatives (
  id           text PRIMARY KEY,
  rank         integer NOT NULL,
  name         text NOT NULL,
  owner_id     text REFERENCES team_members(id),
  budget_inr   integer NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','scaled','changed','stopped')),
  definition   jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS kpi_thresholds (
  id          serial PRIMARY KEY,
  scope       text NOT NULL CHECK (scope IN ('initiative','campaign_rule')),
  scope_id    text NOT NULL,
  metric_key  text NOT NULL,
  label       text NOT NULL,
  direction   text NOT NULL CHECK (direction IN ('higher_better','lower_better')),
  scale_at    double precision NOT NULL,
  stop_at     double precision NOT NULL,
  min_sample  integer NOT NULL DEFAULT 0,
  unit        text NOT NULL DEFAULT 'ratio',
  UNIQUE (scope, scope_id, metric_key)
);
CREATE TABLE IF NOT EXISTS recommendations (
  id               serial PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  source           text NOT NULL CHECK (source IN ('readiness','threshold','ai','user')),
  issue            text NOT NULL,
  evidence         jsonb NOT NULL,
  diagnosis        text,
  action           text NOT NULL,
  expected_impact  text,
  status           text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  decided_at       timestamptz,
  decision_note    text,
  task_id          integer,
  outcome          text
);
CREATE TABLE IF NOT EXISTS tasks (
  id                 serial PRIMARY KEY,
  title              text NOT NULL,
  description        text,
  owner_id           text REFERENCES team_members(id),
  due_at             timestamptz,
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  opportunity_id     text REFERENCES opportunities(opportunity_id),
  brand_id           text REFERENCES brands(brand_id),
  campaign_id        text REFERENCES campaigns(sponsor_campaign_id),
  initiative_id      text REFERENCES initiatives(id),
  recommendation_id  integer REFERENCES recommendations(id),
  created_by         text NOT NULL DEFAULT 'user' CHECK (created_by IN ('user','ai_confirmed','readiness_confirmed')),
  outcome            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);

CREATE TABLE IF NOT EXISTS scenarios (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  level       text NOT NULL,
  overrides   jsonb NOT NULL,
  result      jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
  key    text PRIMARY KEY,
  value  jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id         serial PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  actor      text NOT NULL,
  entity     text NOT NULL,
  entity_id  text NOT NULL,
  action     text NOT NULL,
  before     jsonb,
  after      jsonb
);
CREATE TABLE IF NOT EXISTS chat_log (
  id               serial PRIMARY KEY,
  conversation_id  text NOT NULL,
  role             text NOT NULL,
  content          text NOT NULL,
  tools_used       jsonb,
  provider         text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
`,
  },
];
