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
- Standing disclaimer on every litigation and settlement page: BreachLedger is not a law firm, not a
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

## Sourcing

- Every fact traces to a government or court source, linked and dated, in a citation block that renders as
  first-class page furniture on every breach page — even when there is only one source.
- A breach record with zero sources never renders.
- `dateModified` is bumped only when content actually changed. Fake freshness is a fast way to lose a
  YMYL-adjacent site.
- When sources conflict on records_affected, show both figures and cite each.
- Corrections are never silent. Every correction is logged in `docs/CORRECTIONS.md` with the date and what
  changed, and the affected record's status becomes `corrected`.
