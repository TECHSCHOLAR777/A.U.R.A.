# AURA Backend Intelligence Layer (Dev 3)

Welcome to the **AURA Backend Intelligence Layer**. This module processes curriculum activities retrieved from Dev 2, applies rigorous safety/inclusion guardrails, and feeds into Dev 1 for UI delivery. It also handles Bayesian Knowledge Tracing (BKT) for child mastery, Developmental Screening (DSS), and WHO Z-score health tracking.

This code is designed to run entirely **offline-first** on constrained Android devices (2-4GB RAM). It is strictly typed, has zero external runtime dependencies, and handles all operations deterministically.

---

## 🏗️ Architecture & Modules

This repository is split into four core engines, all exporting through a strict schema contract boundary (`src/core/schema/index.ts`). **Do not mutate the schema contracts without cross-team sign-off.**

### 1. Guardrail Engine (`src/core/guardrail/`)
Evaluates activities against safety, inclusion, age-appropriateness, and VAST rules.
- **Rule Definitions**: `src/core/rules/*.json`
- **Evaluator**: `condition-evaluator.ts` runs a custom Abstract Syntax Tree (AST). It is **purely declarative** and safely executes rules without ever using `eval()` or `Function()`.
- **Output**: Returns a `GuardrailResult` that dictates whether Dev 2 needs to regenerate the activity, or if it can safely pass to Dev 1.

### 2. Bayesian Knowledge Tracing (BKT) (`src/core/bkt/`)
Tracks child mastery progression using a 4-parameter Hidden Markov Model (HMM).
- **Engine**: `engine.ts` implements an `O(1)` state update calculating Slip, Guess, Transition, and Mastery.
- **Data Privacy**: Strictly utilizes anonymous `child_uuid`s. Zero PII is processed.
- **Room Aggregate**: `room-aggregate.ts` performs a single-pass `O(n)` calculation to feed Dev 2's bandit context vector.

### 3. Developmental Screening System (DSS) (`src/core/dss/`)
Deterministic rule-matching engine for developmental red flags.
- **Screener**: `screener.ts` cross-references worker inputs with cutoff thresholds.
- **Output**: Issues an explainable verdict (`typical`, `monitor`, or `refer_to_deic`).

### 4. Health Metrics (`src/core/health/`)
Calculates growth metrics based on WHO standards.
- **Z-Score**: Uses the WHO LMS method (`Z = [ (X/M)^L - 1 ] / (L*S)`) to map child anthropometrics to standard deviations.
- **Anomaly Detection**: `anomaly.ts` analyzes historical Z-scores to spot faltering growth, stunting, and rapid weight gain.

---

## 🚀 Getting Started

### Prerequisites
- Node.js `v18+`
- `npm` or `yarn`

### Installation
```bash
npm install
```

### Running the Live Demo
We have included a live demonstration script that pipes mock data through all 4 intelligence layers so you can see the AST evaluator, BKT math, and DSS verdicts in action.
```bash
npx tsx src/demo.ts
```

### Running Tests
The codebase currently has 100% test coverage for its logic across 50+ Vitest cases.
```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test:watch
```

---

## ⚠️ Strict Constraints for Future Contributors

If you are committing to this repository, you must adhere to the following strict constraints:

1. **No `any` Types**: This project uses `strict: true`. Do not cast to `any`. Validate unknown inputs at the boundary using `validateC1()` or `validateC2Rule()`.
2. **Offline-First**: Do not add modules that require runtime HTTP calls. This engine executes locally on Android web-views.
3. **No `eval()`**: The `condition-evaluator` parses JSON rule trees natively to prevent arbitrary code execution vulnerabilities. Never bypass this.
4. **Immutability**: All states (especially BKT) must be treated as immutable. `updateMastery` returns a brand new state object. Do not mutate inputs.
5. **No PII**: Never add child names, PII, or PHI to these models. Always use opaque UUIDs.
