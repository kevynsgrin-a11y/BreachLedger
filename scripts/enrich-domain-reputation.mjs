#!/usr/bin/env node
// Build-time enrichment: resolves each curated breach-entity domain's VirusTotal
// verdict from the TrueAPI ingest worker's WARM cache (ingest.oakandmain.dev) and
// writes site/data/domain-reputation.json. No VirusTotal key here, no runtime API
// calls — the site renders committed data only.
//
// Domains the ingest worker has not warmed simply do not appear; nothing is invented.
// Refresh: node scripts/enrich-domain-reputation.mjs  (after the weekly VT cron warms)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const INGEST = 'https://ingest.oakandmain.dev/data/virustotal/domains/'
const MAP_PATH = join(HERE, 'entity-domains.json')
const OUT = join(HERE, '..', 'site', 'data', 'domain-reputation.json')

const { entity_domains: map } = JSON.parse(readFileSync(MAP_PATH, 'utf8'))
const domains = [...new Set(Object.values(map))]
const byDomain = {}
let fetched = 0

for (const domain of domains) {
  try {
    const response = await fetch(INGEST + domain, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) continue // cache miss: omit, never guess
    const envelope = await response.json()
    const attrs = envelope?.data?.data?.attributes
    if (!attrs?.last_analysis_stats) continue
    byDomain[domain] = {
      reputation: attrs.reputation ?? null,
      malicious: attrs.last_analysis_stats.malicious ?? 0,
      suspicious: attrs.last_analysis_stats.suspicious ?? 0,
      harmless: attrs.last_analysis_stats.harmless ?? 0,
      undetected: attrs.last_analysis_stats.undetected ?? 0,
      fetchedAt: envelope.fetchedAt,
    }
    fetched += 1
  } catch {
    // Network hiccup: skip this domain this run.
  }
}

const covered = Object.entries(map).filter(([, d]) => byDomain[d]).map(([entity, d]) => [entity, d])
const entities = Object.fromEntries(covered)
writeFileSync(OUT, JSON.stringify({
  source: 'VirusTotal API v3 (Public) via TrueAPI ingest warm cache',
  fetchedAt: new Date().toISOString(),
  counts: { domainsResolved: fetched, entitiesCovered: covered.length },
  domains: byDomain,
  entities,
}, null, 1))
console.log(`${OUT}: ${fetched}/${domains.length} domains resolved, ${covered.length} entities covered`)
