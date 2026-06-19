# AURA: Anganwadi Unified Resource Assistant

A Progressive Web App (PWA) runtime and local intelligence engine serving Anganwadi Workers (AWWs) with real-time early childhood stimulation guidelines, disability screening schedules, and clinical tracking under harsh, offline-native field environments.

---

## System Architecture

AURA is structured as a decoupled, multi-layered architecture designed to operate with sub-300MB memory usage, near-zero startup lag, and full offline-native integrity.

* **Layer 0: Ingested Data and State Manager**
  * Contains the static curriculum database derived from the Navchetana Early Childhood Stimulation guidelines.
  * Encapsulates IndexedDB and Dexie.js schemas for child profiles, BKT mastery logs, and synchronization queues.
* **Layer 1: Input and UI Surface**
  * Serves as a responsive, dual-language (Hindi/English) interface optimized for low-end mobile devices.
  * Captures child registrations, daily attendance registers, and voice triggers (Web Speech API) restricted to non-PII parameters like material keywords and child counts.
* **Layer 2: Intelligence Engines**
  * **Bayesian Knowledge Tracing (BKT) Engine**: Computes per-child skill mastery states using Hidden Markov Model equations.
  * **Symbolic Guardrail Engine**: Runs programmatic validation of activities against safety constraints and child inclusion profiles.
  * **Contextual Bandit Engine**: Dynamically adapts and ranks optimal activities based on historical rewards using stochastic gradient descent.

---

## Core Intelligence Engines

### 1. Bayesian Knowledge Tracing (BKT) Engine
Located in [bkt_engine.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/bkt_engine.js), the system computes real-time mastery probabilities $P(L_t)$ for each child-milestone intersection.

#### Mathematical Model
The model updates the prior probability of learning $P(L_{t-1})$ to posterior $P(L_t)$ based on observations (Correct/Incorrect response):
* If the child demonstrates mastery (Got It = true):
  $$P(L_{t|Obs}) = \frac{P(L_{t-1})(1 - P(S))}{P(L_{t-1})(1 - P(S)) + (1 - P(L_{t-1}))P(G)}$$
* If the child requires assistance (Got It = false):
  $$P(L_{t|Obs}) = \frac{P(L_{t-1})P(S)}{P(L_{t-1})P(S) + (1 - P(L_{t-1}))(1 - P(G))}$$
* Transitions account for the probability of learning $P(T)$ at each step:
  $$P(L_t) = P(L_{t|Obs}) + (1 - P(L_{t|Obs}))P(T)$$

#### Hardcoded Hyperparameters
* $P(G)$ (Probability of Guess): `0.20`
* $P(S)$ (Probability of Slip): `0.10`
* $P(T)$ (Probability of Transition): `0.15`
* $P(L_0)$ (Initial prior): Seeded dynamically from [milestone_priors.json](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/data/milestone_priors.json) based on age band. Falls back to `0.15`.
* **Mastery Threshold**: `0.80`. A child is marked as `mastered` when $P(L_t) \ge 0.80$.

#### Trajectory Classification
The BKT engine maintains a rolling history window of 5 updates to categorize learning trajectories:
* `mastered`: Current $P(L_t) \ge 0.80$.
* `at_risk`: History has at least 3 points, the last three deltas are negative ($\Delta < -0.01$), and current $P(L_t) < 0.50$.
* `stalled`: History has at least 3 points, the absolute deltas of the last 3 points are below stability threshold ($|\Delta| < 0.01$), and current $P(L_t) < 0.80$.
* `rising`: Default state when none of the above conditions apply.

---

### 2. Symbolic Guardrail Engine
Implemented in [guardrail_engine.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/guardrail_engine.js), this engine executes a suite of 15 declarative rules against each candidate activity before presentation to prevent safety hazards or inclusion mismatches.

* **AST Parser**: Evaluates structured rule criteria (e.g. `material in SMALL_PARTS and min(age_months) < 24`) against current child profiles and activity tags.
* **Safety Rules**: Restricts items like beads, pebbles, and hot water for kids under 2 years, enforcing automated alternative recommendations.
* **Inclusion Adaptation**: Maps child inclusion profiles (mobility impaired, selective mutism, motor delay, visual impaired, shy) to specialized activity instructions, updating the VAST (Visibility, Attunement, Safety, Togetherness) parameters.

---

### 3. Contextual Bandit Adaptive Loop
Located in [bandit_engine.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/bandit_engine.js), the bandit acts as a client-side reinforcement learning layer to rank activities.

* **Exploration Rate ($\epsilon$)**: Defaults to `0.15` (15% exploration, 85% exploitation).
* **Linear Model**: Predicts the reward score $R$ for a candidate variant $v$ given contextual features $x$:
  $$\hat{R}(v, x) = w^T \phi(v, x)$$
* **Feature Extraction**: Features are derived from the room state: age distribution mix, available materials list, and active domains.
* **Stochastic Gradient Descent (SGD)**: Weights are updated locally on the client using the tapped reward signal:
  $$w \leftarrow w + \alpha (R - \hat{R}(v, x)) \phi(v, x)$$
  * Learning rate $\alpha$: `0.10`.
  * Reward $R$: `1.0` if AWW marks the activity variant as successful, else `0.0`.

---

## Project Structure

* [package.json](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/package.json): Root configuration defining build scripts and primary runtime dependencies.
* [tsconfig.json](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/tsconfig.json): Compiler variables for compiling the TypeScript reference engine.
* [validate.py](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/validate.py): Python utility to validate output formats against schemas.
* [src/](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/src/): Reference TypeScript implementation of AURA core systems.
* [web/](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/): Web runtime directory.
  * [index.html](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/index.html): Main PWA markup, styled interface screens, and DOM event wiring.
  * [server.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/server.js): Node.js Express REST API serving activities and processing room statistics.
  * [aura-api.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/aura-api.js): Orchestrates Dexie database transactions, network states, and sync requests.
  * [bkt_engine.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/bkt_engine.js): Pure ES6 module execution of the Bayesian updates.
  * [bandit_engine.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/bandit_engine.js): Local contextual bandit updates and weight arrays.
  * [guardrail_engine.js](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/guardrail_engine.js): Fast symbolic rule engine and inclusions map.
  * [data/](file:///c:/Users/HP/OneDrive/RISHI%20GARG%20LAB/A.U.R.A/web/data/): Ingested curicular profiles, milestone difficulty scores, and developmental screening questions.

---

## Execution and Setup

### 1. Local Run
Install root dependencies and start the server:
```bash
npm install
npm start
```
The server binds to `0.0.0.0` and listens on port `3000` by default. Access the client PWA directly via `http://localhost:3000`.

### 2. Activity Data Validation
Ensure that any new curriculum entries match the schema contract using the schema validator:
```bash
pip install jsonschema
python validate.py web/data/activity_bank.json
```

---

## Verification & Testing

AURA maintains two decoupled test suites to guarantee core execution limits and boundary compliance:

### 1. PWA Engine Unit and Property-Based Tests (Node.js Test Runner)
Run native Node tests inside the `/web` subdirectory to verify BKT monotonicity updates, trajectory transition criteria, and guardrail checks:
```bash
cd web
npm test
```
Executes unit tests and property-based tests using the Node.js native test runner.

### 2. TypeScript Reference Verification (Vitest Suite)
Run the root test suite to verify TS compiler outputs, Z-score mathematics, and AST evaluation engines:
```bash
npm test
```
Launches Vitest to execute verification tests.

---

## Offline Security Matrix & Data Sovereignty

* **Zero-PII Compliance**: No names or PII leave the device. IndexedDB child records use opaque, local UUID strings.
* **Cryptographic Credentials**: The worker profile is secured locally using client-side SHA-256 password hashing. Plaintext PINs and verification keys are never transmitted to the network.
* **Sync Pipeline**: Synchronization triggers only when the network interface is online. Pushes anonymous, aggregated bandit parameter vectors and telemetry events only, fully guaranteeing data sovereignty.
