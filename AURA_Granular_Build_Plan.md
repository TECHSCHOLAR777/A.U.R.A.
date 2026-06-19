# AURA - Granular Build & Development Plan

4-day sprint, 5 developers. Anchored on Navchetana (0-3); Aadharshila 3-6 is Phase 2. Every variable locked. This is the build bible — schema, per-feature specs, day-by-day per-dev tasks, interfaces, fallback matrix, and the demo script.

---

## A. Locked Stack

| Area | Decision |
|---|---|
| Anchor | Navchetana (0-3). Star 1 = DSS + milestone pool; Star 2 = the 140-activity bank. Pitch = 0-6 platform, Aadharshila 3-6 = Phase 2. |
| Device | Android 10+, 2-4GB RAM, no WebGPU, ~300MB browser-tab memory ceiling. |
| Generation | Option B — retrieval-only offline (JS template assembly); cloud API (Gemini Flash / Claude Haiku via secure proxy) online only. No on-device LLM. |
| Search | Option C — pure-JS lexical (BM25 / weighted regex), <2ms, near-zero memory. |
| Fallback | Waterfall: last-cached → hardcoded safe-default → unmodified official Navchetana activity. |
| Tracing | Pure-TS BKT (HMM); priors seeded from Navchetana milestones per age band. |
| Bandit | Contextual epsilon-greedy + SGD; reward = tapped-ok / present; local-only (global agg = roadmap). |
| Voice | Web Speech (online) for materials/counts ONLY; names/health/attendance-by-name = tap-only always. |
| Backend | Supabase / Postgres — anonymous room metadata + bandit weights only (Zero-PII). |
| Demo | Live WiFi-off toggle on the target device. CONFIRMED. |

---

## B. Architecture (as built on Navchetana)

**Layer 0** — Navchetana source + local state (offline-native)
- F1 curriculum graph: Navchetana 140-activity bank + DSS + milestone pool
- F3 lexical cache (BM25 / regex, <2ms)
- F6 zero-PII store (per-child UUID state)

**Layer 1** — tap-first input (voice = materials/counts only)
- Room context (age-mix, materials, Divyang flags) + per-child taps

**Layer 2** — intelligence (critical path)
- **Star 1**: DSS screener + BKT tracing (Navchetana milestones) → mastery state
- **Star 2**: retrieve activity → (cloud rewrite) → verify → adapted activity for THIS room + next-day variant
- Parallel / supporting (off critical path): epsilon-greedy bandit (local, reward = ok/present), health flags (Z-score + anomaly)

> Solid = critical path. Dashed = local next-day bandit loop. Dotted = parallel.
> All of Layer 0-2 runs offline; only the optional cloud rewrite needs network.

### Critical Path & Cross-Dev Handoffs

| Day | Handoff |
|---|---|
| D1 AM | Dev3 freezes JSON schema + rule format |
| D1 | Dev4 ingests Navchetana (~60 activities → schema) |
| D1 | Dev4 digitizes DSS + milestone pool |
| D1 | Dev1 PWA shell + IndexedDB + tap-grid |
| D2 | Dev2 lexical retrieval + template assembly |
| D2 | Dev3 symbolic guardrail (15-20 rules) |
| D2 | Dev3 screener logic + BKT engine |
| D2 end | OFFLINE E2E: retrieve → verify → deliver |
| D3 | Cloud proxy + bandit + fallback waterfall |
| D4 | Demo hardening + WiFi-off rehearsal |

> **Red = Day-1 blockers that gate everyone.** Dev3's schema freeze + Dev4's Navchetana ingestion are the project's critical dependency — they must land Day 1.

---

## C. Data Contracts (frozen Day-1 AM by Dev 3)

### C1. Adapted-Activity JSON Schema

```json
{
  "schema_version": "1.0",
  "activity_id": "string",                    // FK -> Navchetana activity node
  "source": "cloud_llm | local_template | last_cache | safe_default | official_unmodified",
  "targeted_domain": "cognitive | language | motor | socio_emotional",
  "age_band_months": "0-3 | 3-6 | 6-9 | 9-12 | 12-18 | 18-24 | 24-36",
  "milestone_targeted": "string",             // the Navchetana milestone this builds toward
  "adapted_title": "string",
  "step_by_step_instructions": ["string", "..."],
  "required_materials": ["string", "..."],
  "safety_guard_applied": true,
  "inclusion_modifications": {
    "vast_parameter": "visibility | attunement | safety | togetherness | none",
    "instruction_override": "string"          // hardcoded PBPB-derived swap, or ""
  },
  "provenance": {
    "generated_offline": true,
    "rules_fired": ["rule_id", "..."],        // render this on-screen (the safety proof)
    "cache_key": "string",                    // hash of the constraint profile
    "fallback_tier": "none | last_cache | safe_default | official"
  }
}
```

### C2. Symbolic Rule-Table Entry (Dev 3 authors 15-20 of these Day 1-2)

```json
{
  "rule_id": "SAFE_CHOKE_01",
  "type": "safety",
  "trigger": {
    "age_band_months": ["0-3", "3-6", "6-9", "9-12", "12-18"],
    "material": ["pebbles", "beads", "small_stones"]
  },
  "condition": "material in SMALL_PARTS and min(age_months) < 24",
  "action": "reject_regenerate | flag_modify | block_and_substitute",
  "message": "Choking hazard for under-3: small parts not permitted."
}

{
  "rule_id": "INC_ATTUNE_01",
  "type": "inclusion",
  "trigger": { "vast_parameter": "attunement" },
  "condition": "child.non_verbal and activity.requires_verbal_response",
  "action": "reject_regenerate",
  "message": "Non-verbal child: provide a gesture/visual response path."
}
```

### C3. BKT Default Parameters

| Parameter | Value |
|---|---|
| P(L0) — prior mastery | Seeded per milestone & age band (~0.10–0.30) |
| P(T) — learn | 0.15 (fixed) |
| P(G) — guess | 0.20 (fixed) |
| P(S) — slip | 0.10 (fixed) |

> Only P(L0) is informed by the curriculum; the rest are fixed (no fitting data in 4 days). Label as such in the deck.

---

## D. Per-Feature Build Specs

### D1. Navchetana Curriculum Graph [Dev 4]

**I/O:** in = Navchetana PDF (parseable). out = local JSON tree, ~60 activity nodes indexed into IndexedDB.

**Impl:** Hand-structure ~60 of the 140 activities into the C1-compatible node shape (age band × domain × milestone × materials × steps); also extract the DSS items + the milestone pool.

**Offline:** Bundled static asset, loaded once. Query: filter, not search.

**Done when:** ~60 schema-valid nodes + DSS JSON + milestone-prior table exist in the repo and load into IndexedDB on first run.

---

### D2. Offline Store + Zero-PII Sync [Dev 1 store / Dev 4 sync]

**Impl:** IndexedDB (Dexie) with per-child local UUIDs (no names to cloud); service worker cache-first shell; Supabase pushes only aggregate room-state + bandit weights when online.

**Offline:** Default mode; queue-and-sync.

**Done when:** App fully usable offline; on reconnect, only anonymous aggregates sync; no child PII leaves the device (verified by Dev 5).

---

### D3. Star 1a — DSS Screener [Dev 3 logic / Dev 1 UI]

**I/O:** in = DSS responses via tap UI. out = typical / monitor / refer-to-DEIC + which red flags fired.

**Impl:** Deterministic branching/checklist scored against Navchetana DSS thresholds. No model.

**Offline:** Fully native.

**Done when:** A child run produces a correct, explainable result with the red-flags listed, offline.

---

### D4. Star 1b — BKT Knowledge Tracing [Dev 3 engine / Dev 1 tap-grid]

**I/O:** in = tap-grid (which children met the milestone). out = per-child mastery state + trajectory flag.

**Impl:** Pure-TS 4-param HMM update; priors from D1 milestone table.

**Offline:** Native.

**Done when:** Tapping success updates mastery, the next adaptation reflects it ("upgrade Group A"), and an off-trajectory child raises a flag.

---

### D5. Star 2 — Room-Aware Adapter [Dev 2 retrieve+assembly / Dev 3 guardrail / Dev 4 cloud proxy]

**Pipeline (retrieve → generate residual → verify always):**

1. **Retrieve [Dev 2]:** Lexical match the constraint profile (age-mix, materials, domain) against the 60-node bank → best-fit activity variant. Cache check first.
2. **Generate residual [Dev 4]:** Only if no variant fits AND online → cloud LLM via secure proxy, output forced into the C1 schema. Offline → template-assembly matrix (Dev 2) builds schema-valid JSON from pre-verified blocks.
3. **Verify [Dev 3]:** Guardrail tests the JSON against the 15-20 rules; reject+regenerate or fall back per the waterfall; record `rules_fired`.

**Done when:** The same Navchetana activity reshapes for a mixed-age room incl. a non-verbal child, offline, with the guardrail chip visibly firing; cloud path works online.

---

### D6. Contextual Bandit [Dev 2]

**Impl:** Epsilon-greedy (eps=0.1) over a linear reward model updated by SGD; context = age-mix vector + materials + domain; reward = tapped-ok / present. Local-only; weights optionally synced as anonymous aggregates (roadmap framing).

**Done when:** The next-day variant selection responds to logged outcomes locally (no crash, bounded reward).

---

### D7. Health & Nutrition Flags [Dev 3]

> ⚠️ **P2 — cut first if behind.**

**Impl:** Deterministic WHO Z-scores + own-trajectory anomaly. No ML.

---

### D8. Tap-First UI + Voice [Dev 1]

**Impl:** Age-mix chips, materials icon-grid, attendance tap-absentees-then-confirm, child-success tap-grid. Web Speech (online) wired ONLY to materials/counts fields; voice omitted from name/health/roster fields and disabled entirely offline.

**Done when:** Full room context entered in <30s by tap; voice never appears on a PII field; offline locks to tap-only.

---

## E. Day-by-Day Plan

### Day 1 — Foundation & Contracts (unblock everyone)

| Dev | Tasks |
|---|---|
| **Dev 4 (CRITICAL)** | Ingest ~60 Navchetana activities into C1 schema; digitize DSS items + cutoffs; extract milestone-prior table; stand up Supabase schema. Hand off activity-bank JSON + DSS JSON by EOD — Dev 2 and Dev 3 are blocked on it. |
| **Dev 3** | Freeze C1 schema + C2 rule format (AM); begin the 15-20 rule extraction; build the BKT engine skeleton (HMM math). |
| **Dev 1** | PWA skeleton + service worker (cache-first shell); IndexedDB schema (UUID store, room state); tap-grid component shell. |
| **Dev 2** | Lexical indexer + template-assembly scaffold against a stub bank; define the constraint-token vocabulary (materials/age/domain). |
| **Dev 5** | Repo + CI; online/offline state interceptor harness; fallback-chain test matrix skeleton. |

**Day-1 milestone:** Schema frozen; activity-bank v1 + DSS v1 in repo; PWA shell runs offline; rule extraction started.

---

### Day 2 — Core Features, Offline E2E

| Dev | Tasks |
|---|---|
| **Dev 4** | Finish full bank + DSS; wire Supabase sync; deliver milestone-prior table to Dev 3. |
| **Dev 1** | Tap-grid fully functional; Web Speech on materials/counts only; offline voice lockdown. |
| **Dev 2** | Lexical retrieval on real bank (<2ms); template-assembly producing schema-valid JSON offline; consume Dev 1 constraints. |
| **Dev 3** | BKT updating from tap-grid; guardrail validating JSON vs the rule table (reject/regenerate/flag); finish rules. |
| **Dev 5** | Wire interceptor; first E2E happy-path (input → retrieve → verify → deliver). |

**Day-2 milestone:** OFFLINE adaptation works end-to-end (retrieve → verify → deliver); BKT updates; screener scores.

> 🚨 This is the project's de-risking moment — if it's not green by EOD Day 2, start cutting (Part I).

---

### Day 3 — Online Path, Bandit, Fallback, Integration

| Dev | Tasks |
|---|---|
| **Dev 4** | Secure cloud-LLM proxy (Flash/Haiku) for online residual; test Supabase sync. |
| **Dev 1** | DSS screener UI flow → refer/monitor/typical; render the `rules_fired` chip (the visible guardrail moment). |
| **Dev 2** | Bandit integration (eps-greedy + SGD, reward wiring); next-day variant selection. |
| **Dev 3** | Guardrail across both offline (template) and online (cloud) outputs; finalize regenerate loop. |
| **Dev 5** | Full waterfall test (cache-miss → last-cache → safe-default → official); offline-drop simulation; first live WiFi-off rehearsal. |

**Day-3 milestone:** Full system integrated online+offline; bandit runs locally; fallback chain validated; WiFi-off demo works.

---

### Day 4 — Demo Hardening + Buffer

| Dev | Tasks |
|---|---|
| **All** | Bug bash; demo-script rehearsal; polish the guardrail chip; build the knowledge-graph viz for the deck; edge cases. |
| **Dev 5** | Final E2E + exact demo choreography (Part H); lock the offline toggle and the live guardrail-block moment. |

> Reserve the back half of Day 4 as buffer. **No new features after Day-4 AM.**

**Day-4 milestone:** Demo-ready and rehearsed, WiFi-off + guardrail-firing moments locked.

---

## F. Cross-Dev Interface Contracts (agree Day-1 AM)

| Producer | Consumer | Contract |
|---|---|---|
| Dev 4 | Dev 2 | Activity-bank JSON array of C1-shaped nodes (without provenance). |
| Dev 4 | Dev 3 | DSS items + cutoffs JSON; milestone-prior table `{milestone, age_band, P(L0)}`. |
| Dev 1 | Dev 2 | Constraint profile: `{age_mix:[{band,count}], materials:[], inclusion_flags:[]}`. |
| Dev 3 | Dev 2 | Mastery state per child + room aggregate (feeds bandit context). |
| Dev 2/3 | Dev 1 | Final C1 activity object incl. `provenance.rules_fired` (for the chip). |
| Dev 2 | Dev 4 | Anonymous bandit weight vector for sync. |

---

## G. Integration & Fallback Test Matrix [Dev 5]

| Scenario | Expected |
|---|---|
| Online, variant fits | retrieve → verify → deliver (`source=local_template` or `cloud`) |
| Online, no variant fits | cloud rewrite → guardrail → deliver (`source=cloud_llm`) |
| Offline, cache hit | instant cached activity (`source=last_cache`) |
| Offline, variant fits | template assembly → verify → deliver (`source=local_template`) |
| Offline, cache miss + no fit | waterfall: `last_cache` → `safe_default` → `official_unmodified` |
| Guardrail violation | reject+regenerate; if exhausted, fall back; `rules_fired` recorded |
| PII leak probe | no child name/health ever reaches Web Speech or Supabase |
| Live WiFi-off mid-session | seamless switch to offline path; no blank screen, no crash |

---

## H. Demo Script (the live run)

1. Open AURA (online). Today's Navchetana activity shows for the room.
2. Enter room context by tap: age-mix (e.g. 4 kids 12-18mo, 3 kids 18-24mo), materials by voice ("twigs, leaves" — shows non-PII voice), flag one child non-verbal.
3. Adapt → cloud reshapes for the age-mix + non-verbal child → guardrail chip fires on screen (`INC_ATTUNE_01 applied`) — the responsible-AI proof.
4. Run the DSS screener on a child → "monitor/refer to DEIC" with the red flags listed.
5. Tap-grid the successes → BKT updates → next suggestion upgrades the mastered group.
6. **THE MOMENT:** Turn WiFi off on the device. Request another adaptation → template assembly delivers offline; force a cache miss to show the waterfall.
7. Try a choking-hazard material for under-3s → guardrail blocks it live (`SAFE_CHOKE_01`).
8. Close on the knowledge-graph viz + Phase-2 roadmap (3-6 Aadharshila, cross-center federated bandit, TDSC licensing).

---

## I. Cut List / Contingency (in order, if behind)

1. Drop the online cloud path → demo offline-only (retrieval + template). Still a complete story.
2. Drop visible bandit learning → static best-fit retrieval; bandit becomes a roadmap slide.
3. Drop health flags (D7) — parallel, non-core.
4. Drop Supabase sync → local-only + mocked sync (Zero-PII story intact).
5. Shrink the bank from ~60 to ~20 nodes covering exactly the demo scenarios.

> **Never cut:** the adapter (retrieve → verify → deliver), the visible `rules_fired` guardrail chip, the DSS screener, and the live offline toggle. **Those four are the pitch.**
