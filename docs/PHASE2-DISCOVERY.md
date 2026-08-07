# Phase 2 source discovery — what was actually observed

Findings from `scripts/probe-ag-sources.js`, run against the live sites from a
GitHub Actions runner on **2026-08-07**. This file records what the probe
returned, so that parsers are written against observation rather than memory.

Everything below was directly observed in a fetch. Where something is inferred
rather than seen, it says so.

---

## Washington — `wa_ag`

`https://www.atg.wa.gov/data-breach-notifications` — **200**, no redirect,
153,838 bytes. Drupal. robots.txt: 52 wildcard rules, none matching this path,
no crawl-delay.

One table, `class="tablesaw tablesaw-stack cols-5"`, 50 data rows per page.

| Date Reported | Organization Name | Date of Breach | Number of Washingtonians Affected | Information Compromised |
| --- | --- | --- | --- | --- |
| 07/28/2026 | ADT, Inc. | 04/20/2026 | 5129 | Name; Social Security Number; Full Date of Birth |
| 07/27/2026 | JRK Property Holdings, Inc. | 03/26/2026 | 5667 | Name; Social Security Number; Driver s License or Washington ID Card Number; Financial & B… |
| 07/23/2026 | The Moody Bible Institute of Chicago | 06/12/2026 | 8955 | Social Security Number; Driver s License or Washington ID Card Number; Full Date of Birth |

**This is the richest of the three sources**, and the only one that supplies
what the HHS record structurally cannot:

- **`Information Compromised` is semicolon-delimited and reads as a controlled
  vocabulary**, not prose. Values observed so far: `Name`, `Social Security
  Number`, `Driver s License or Washington ID Card Number` (the apostrophe is
  lost in the rendered markup), `Full Date of Birth`, `Financial & B…`
  (truncated by the probe). If the vocabulary is genuinely closed, data classes
  for Washington records come from a lookup table with **no inference at all** —
  which removes the single largest fabrication risk in Phase 2.
  **Not yet established:** the complete vocabulary. It must be enumerated across
  all pages before the mapping is written, and any unmapped token has to fail
  loudly rather than be dropped.
- **Every row links to that breach's own notification letter**, e.g.
  `https://agportal-s3bucket.s3.amazonaws.com/databreach/BreachA42014.pdf`,
  hosted on S3 rather than on the AG's own host.
- Affected counts are Washington residents only, not the national total. A
  record sourced only from here therefore knows how many Washingtonians were
  affected and **not** how many people were affected overall. Those are
  different facts and must not be conflated.

Pagination: `?page=0`, `?page=1`, … The page states no total, so the end of the
listing has to be detected by walking until a page yields no rows.

Two Drupal search forms (`search_api_fulltext`, `keys`) POST to the same path.
Not needed if pagination is walked directly.

No machine-readable form: `?format=json` returns HTML; `.json`, `/api/databreach`
and `/export` all 404.

---

## California — `ca_ag`

`https://oag.ca.gov/privacy/databreach/list` — **200**, no redirect, 88,490
bytes. Drupal. **robots.txt sets `Crawl-delay: 10`** for `*`; no rule matches
this path.

One table, `class="views-table cols-3"`, 50 data rows per page.

| Organization Name | Date(s) of Breach | Reported Date |
| --- | --- | --- |
| Station Casinos, LLC | 03/05/2026 | 08/05/2026 |
| New York City Regional Center, LLC | 03/30/2026 , 04/27/2026 | 08/05/2026 |
| Robert Arshagouni | 01/12/2026 , 02/25/2026 | 08/05/2026 |

Pagination runs to `?page=104`, so **roughly 5,250 records** at 50 per page.

**California's listing carries no affected count and no data categories.** Its
three columns are an organization, one or more breach dates, and a reported
date. Note also that `Date(s) of Breach` can hold *several* dates in one cell,
comma-separated — a single record can describe a breach spanning discontinuous
periods, which the current schema's single `breach_start_date` /
`breach_end_date` pair does not obviously represent.

A filter form GETs the same path with `field_sb24_org_name_value`,
`field_sb24_breach_date_value[min][date]` and `[max][date]`.

The four PDFs linked from the list page are annual statistical reports
(2012/2014/2016 Data Breach Report), **not** notification letters.

No machine-readable form: `?download=csv` returns HTML, and `.csv`, `.json`,
`/api/databreach/list` all 404.

---

## Maine — `maine_ag` — **not located**

`https://www.maine.gov/ag/consumer/identity_theft/` — **404**. This is the URL
`docs/SOURCES.md` publishes on `/sources` as the Maine endpoint, so that page
is currently citing a dead address.

Probed and failed:

| URL | Result |
| --- | --- |
| `apps.web.maine.gov/online/aeviewer/ME/40/list.shtml` | 404 |
| `apps.web.maine.gov/online/aeviewer/ME/40/list.html` | 404 |
| `www.maine.gov/ag/consumer/identity_theft.shtml` | 404 |
| `www.maine.gov/ag/consumer/identity_theft/breach_notices.shtml` | 404 |
| `www.maine.gov/ag/consumer/identity_theft/index.shtml` | redirects to `…/consumer-protection/consumer-help-topics/privacy-and-identity-theft` — 0 tables |
| `www.maine.gov/ag/consumer/` and `/index.shtml` | redirect to `/ag/about-us/consumer-protection` — 0 tables |

The landing page those redirects arrive at carries 116 links, and **none of
them** mention a breach, a notification, or identity theft in either the href
or the link text — only skip-navigation anchors. The `aeviewer` application
that historically served Maine's notification letters is gone.

**Conclusion: the Maine AG site was reorganised and its breach listing is not
reachable from its documented endpoint or from any obvious successor.** Whether
it still exists at another address is an open question. Until it is found and
verified, Maine cannot be ingested, and `/sources` must stop citing a dead URL.

---

## What this changes about Phase 2

1. **The three sources are not equivalent, and the plan should stop treating
   them as three instances of one job.** Washington supplies data categories,
   affected counts and notification letters. California supplies an
   organization and dates. Maine supplies nothing until it is found.
2. **Washington is the source that actually extends the record**, because it
   carries the two things every HHS record structurally lacks: which categories
   of data were exposed, and a copy of the notice.
3. **A California-only record would carry an organization name, a date, and
   nothing else.** Whether that clears the thin-content bar — and what a
   severity score computed from no data classes would even mean — is a real
   question, not a detail.
4. **`Crawl-delay: 10` on oag.ca.gov is binding on us**, because `/sources`
   states that robots.txt is respected. At ten seconds per request, walking
   105 list pages takes about 18 minutes before any detail page is fetched.
   `packages/ingest/fetch-util.js` implements a fixed 1 request/second per host
   and does not read robots.txt at all, so that published claim is not
   currently true of the code.
5. **No machine-readable feed exists on any of them**, so HTML parsing is
   unavoidable, and every parser needs the "did the structure change" guard the
   HHS CSV parser has.
