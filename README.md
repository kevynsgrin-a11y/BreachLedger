# BreachLedger

A structured public record of disclosed U.S. data breaches, paired with a remediation engine keyed to the
data classes exposed, and tracking of the litigation and settlements that follow. **Every published fact
traces to a citable government or court source.**

Stack: Utility Engine monorepo → Cloudflare Pages (static site) + Workers (ingest-cron, alerts, api) +
D1 (canonical store) + KV (hot-path reads).

## What this site is not

- **Not an email-lookup / "have I been breached" tool.** That is [Have I Been Pwned](https://haveibeenpwned.com/);
  we link out and never proxy or replicate it (their ToS prohibits it, and it would collect the PII this
  site exists to document the exposure of).
- **Not a law firm or legal advisor.** The record is reported; no legal advice is given.
- **Not a claims processor.** Settlement pages deep-link to the official administrator only.
- **Not a fear-marketing funnel.** See `docs/EDITORIAL.md` — the rules there are build-blocking.

## Repository layout

```
packages/ingest/      per-source parsers + normalize/entity-resolve/dedupe/validate pipeline
packages/severity/    versioned scoring rubric (published at /severity) + scoring engine
packages/schema/      D1 migrations + seed data (data classes, state rights, remediation modules)
site/                 templates, assets, build-time D1 export, static build (site/build.js)
workers/              ingest-cron (daily 06:00 UTC + hourly), alerts (Phase 5), api
docs/                 SOURCES.md, EDITORIAL.md, CORRECTIONS.md — all published on-site
```

## Development

```
npm install
npm run db:migrate      # apply D1 migrations to local database
npm run db:seed         # load seed tables (data_classes, state_rights, remediation_modules)
npm run db:verify       # row counts per table
npm run build           # static build -> dist/
npm test                # unit tests (severity scoring, entity resolution)
```

`wrangler.toml` carries placeholder D1/KV ids; run `wrangler d1 create breachledger` and
`wrangler kv namespace create HOT` against the production account and substitute the real ids before the
first remote deploy.

## Build phases

| Phase | Days | Scope | Status |
| --- | --- | --- | --- |
| 0 | 1–4 | Scaffold, migrations, seed tables, empty-but-valid build | **done** |
| 1 | 5–12 | HHS OCR ingest (CSV, cleanest source) | pending |
| 2 | 13–25 | Maine/CA/WA AG ingest, entity resolution, dedupe | pending |
| 3 | 26–40 | Severity pages, remediation assembly, 51 state-rights pages | pending |
| 4 | 41–58 | CourtListener, settlements, deadline calendar, KV countdowns | pending |
| 5 | 59–70 | Alerts: double opt-in subscriptions, sector/entity filters | pending |
| 6 | 71–90 | Texas/SEC parsers, schema.org, sitemaps, IndexNow, monetization | pending |

## Schema notes (deviations from the build spec)

Documented decisions where the implementation had to fill a gap or deviate from the spec's section 3:

1. **`data_classes.permanence` for "Name only"** — the section 5 weight table marks its permanence as "—",
   but the column is `NOT NULL` with enum `permanent|semi_permanent|rotatable`. Stored as `permanent`
   (a legal name is not rotatable). The rubric page renders the label from this table.
2. **`data_classes.remediation_ids` is computed, not hand-authored** — `seed/data-classes.json` mirrors the
   section 5 weight table exactly (code, label, permanence, weight); the loader derives `remediation_ids`
   as the inverse of `remediation_modules.applies_to`, ordered by module priority, so the module library is
   the single source of truth and the two can never drift.
3. **Remediation-gap modifier, 12–23 months** — the spec defines 10 / 5 (<12 mo) / 0 (>=24 mo) and leaves
   12–23 months undefined; rubric v1.0 sets it to 2. Monitoring offered with unknown duration scores 5
   (missing data is not rewarded with 0). Both rules are published in `rubric.json`.
4. **Additive indexes** — `idx_sources_breach` and `idx_litigation_breach` (join-path indexes the spec's
   DDL omits). No spec'd column, type, or index was altered or removed.
5. **"≥1 source per breach" is enforced procedurally** — SQLite cannot express the constraint declaratively;
   it is enforced in `packages/ingest/validate.js` (reject at ingest) and again in `site/build.js`
   (zero-source records never render).
6. **Scale-band boundary convention** — the spec's band table is boundary-ambiguous (10k appears in both the
   "1k–10k" and "10k–100k" bands). Rubric v1.0 publishes all bands as lower-inclusive/upper-exclusive, which
   places exactly 10,000,000 records in the 15-point band rather than the 12-point band a literal ">10M"
   reading would give.
7. **Unknown-data defaults** — the spec is silent on missing inputs. Rubric v1.0 publishes: undisclosed
   `records_affected` scores 0 (flagged "not disclosed" in the breakdown; a disclosed-but-invalid value is
   flagged "invalid value"); missing or calendar-invalid discovery/notification dates score 0 (flagged);
   monitoring offered with unknown duration scores 5, so missing data is never rewarded.
