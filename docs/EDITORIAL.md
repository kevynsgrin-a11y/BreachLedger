# Editorial and compliance rules

These rules are build-blocking. A page that violates them does not ship. If a build decision is ambiguous,
choose the option that makes the site look more like a government record and less like a lead-gen page.

## Tone

- Report, do not alarm. Write "This breach exposed Social Security numbers" — never "Your identity is at
  risk right now."
- No countdown-timer urgency on anything except actual legal deadlines (claim deadlines, opt-out deadlines).
- No "you may be owed $X" headlines unless X is the documented payout in the settlement agreement, cited.
- Never imply the reader is definitely affected by any breach.
- No emoji anywhere in rendered output. This is enforced by the build (`site/build.js` fails on emoji).
- No alarm red in the palette. Amber is reserved for actual legal deadlines only.

## Legal

- No legal advice. Banned constructions: "you should" (in an entitlement/advice sense), "you are entitled
  to," "we can file for you," "you should sue." Use "the settlement agreement provides," "state law requires."
- Standing disclaimer on every litigation and settlement page: BreachBook is not a law firm, not a
  settlement administrator, and cannot process or advise on claims. A settlement page without this
  disclaimer does not ship.
- Never accept claim information. Every settlement page deep-links to the official administrator's domain —
  never a form on ours. The build asserts `official_claim_url` is not on our domain and fails otherwise.
- Affiliate disclosure conforming to FTC 16 CFR Part 255, above the fold, on any page carrying an
  affiliate link.

## Privacy

- No email-lookup tool. The HIBP terms of service prohibit building a substantially similar breach search
  on their API; independently, an email-lookup tool would collect exactly the PII this site exists to
  document the exposure of. Link out to HIBP; never proxy it. Re-read their terms before adding any
  email-based feature.
- No PII collection beyond alert subscriptions. Subscriber records store email + preferences only. No
  profiling, no enrichment.
- Double opt-in before any alert send; one-click unsubscribe in every send.
- Privacy policy covering CCPA/CPRA ships before any subscription form goes live.

### Records from the 42 CFR Part 2 listing

HHS publishes a breach listing for federally assisted substance use disorder treatment
programs, separate from its HIPAA listing. These records name organizations, not people —
the same shape as every other record here — but an organization's name can itself be
disclosing in a way a hospital's is not. The rules below are settled and are not to be
reopened case by case.

- **They are published, on the same terms as every other record.** Omitting them would build a
  two-tier record: the one population whose breach carries the heaviest consequences would be
  the only one with no page, no severity, and no remediation guidance. Omission also cannot be
  silent, because this site states its own coverage — so the alternative is announcing that a
  category is too shameful to list, which is worse than including it plainly.
- **The regime appears on the page, never in the metadata.** A breach page from this listing
  carries one flat provenance note saying which listing published it and what the rule is. It
  does not appear in `<title>`, `<meta name="description">`, or any og tag. A reader who opens
  the page learns the context; a search result under the organization's name does not carry it.
- **No new severity weight, ever, on this basis.** A weighted substance-use class would be a
  stigma judgement rendered as arithmetic — the site asserting this diagnosis is worse to
  expose than any other, which no source says. It would also be detectable only from which
  listing published the row, so a hospital filing an identical incident under HIPAA would score
  lower than a standalone program filing it under Part 2: the number would stop measuring the
  breach and start measuring the filer's corporate structure. It would additionally sort these
  records toward the top of severity-ranked views, buying more prominence for exactly the
  records this section exists to be careful with.
- **No index, filter, sector, or tag grouping breaches by type of treatment.** These records are
  reachable the way every other record is: by organization, by year, by sector. A browsable page
  of substance use disorder program breaches would assemble something the government does not
  publish.
- **Language.** Use "substance use disorder", the term the statute and HHS use — never "substance
  abuse", "addiction", "rehab", or "drug treatment". Say "individuals", not "patients of this
  program". Do not describe these records as sensitive, specially protected, or protected beyond
  HIPAA: each reads as a ranking of whose medical condition matters more. Do not name the
  downstream harm channel — employment, custody, licensure, housing — because it is unsourced
  speculation and naming it is itself the amplifier. The listing is a report, never a finding:
  the program is not said to have violated anything.

## Sourcing

- Every fact traces to a government or court source, linked and dated, in a citation block that renders as
  first-class page furniture on every breach page — even when there is only one source.
- A breach record with zero sources never renders.
- `dateModified` is bumped only when content actually changed. Fake freshness is a fast way to lose a
  YMYL-adjacent site.
- When sources conflict on records_affected, show both figures and cite each.
- Corrections are never silent. Every correction is logged in `docs/CORRECTIONS.md` with the date and what
  changed, and the affected record's status becomes `corrected`.
