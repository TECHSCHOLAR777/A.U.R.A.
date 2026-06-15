# Navchetana Data Layer (Dev 4 — Parv)

Source-of-truth data for AURA's **Star 1** (screening + tracking) and **Star 2** (activity adapter),
ingested from the government **Navchetana — National Framework for Early Childhood Stimulation
(0–3 years), 2024**. All content traces back to that PDF — nothing is invented.

## Files

| File | Feeds | What it is |
|------|-------|-----------|
| `activity_bank.json` | Star 2 (Dev 2) | 60 stimulation activities, C1-schema-compliant, across all 5 domains and age bands 0–36 months. Each carries `inclusion_modifications` per Navchetana §4.3 (VAKT downgrade principle). |
| `dss.json` | Star 1 (Dev 3) | The Disability Screening Schedule — yes/no red-flag items with scoring + result logic. |
| `milestone_priors.json` | Star 1 / BKT (Dev 3) | One `P(L0)` prior per milestone × age band, plus the fixed BKT params. |
| `../schema/c1_activity.schema.json` | contract | The frozen activity-node schema. Do not change without sign-off. |
| `../../validate.py` | gate | Validates the activity bank against the schema. |

## Schema contract (C1)

Every activity node has: `activity_id`, `source` (`official_unmodified` for all base nodes),
`targeted_domain` (cognitive / language / motor_physical / socio_emotional / creative),
`age_band_months` (0-3 / 3-6 / 6-9 / 9-12 / 12-18 / 18-24 / 24-36), `milestone_targeted`,
`adapted_title`, `step_by_step_instructions[]`, `required_materials[]`, `safety_guard_applied`,
`inclusion_modifications { vast_parameter, instruction_override }`, and `provenance`.

## How to test / validate

From the repo root:

    pip install jsonschema
    cp web/schema/c1_activity.schema.json .
    python3 validate.py web/data/activity_bank.json

Passing output: `60 node(s) checked, 0 error(s).` (exit code 0).
Any schema violation or duplicate `activity_id` prints the offending node and exits 1.

### DSS scoring logic
- Any "yes" to a red-flag item → that item is a red flag.
- 0 red flags → typical; 1 → monitor; 2 or more → refer (RBSK → District Early Intervention Centre).

### Milestone priors
- `P_L0` = prior probability a child of that age has already attained the milestone (seeds BKT).
- Fixed params apply to every skill: `P_T_learn=0.15`, `P_G_guess=0.20`, `P_S_slip=0.10`.

## Handoff
- **Dev 2:** index `activity_bank.json` for lexical retrieval (BM25 / weighted regex on materials + domain + age band).
- **Dev 3:** load `dss.json` for the screener; seed BKT from `milestone_priors.json`.

## Provenance note
Age bands, domains, and inclusion overrides were corrected against the actual PDF ranges during
ingestion (e.g. months 22–23 activities moved into 18–24; three domain reclassifications to fill
gaps; one milestone entry added to cover a 9–12 socio-emotional gap).
