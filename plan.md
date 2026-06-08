PART 1: ACTIVE IMPLEMENTATION PRIORITY
(These are the features to build now, ordered from foundational infrastructure to high-value polish).

Priority 1: The Core Foundation (Infrastructure & UX)

CRDT Survival Engine (cr-sqlite): The absolute first thing to build. If the app can't save data permanently offline and merge it automatically when the network returns, nothing else matters.

Zero-Depth, Time-Contextual UI: Build the shell. Eliminate navigation menus and map the interface to the time of day (Morning Attendance, Hot Meals, etc.).

Semantic Automated Register Routing (SARR): The core AI trick. Set up Qwen2.5-0.5B to turn a single voice note into a structured JSON that updates multiple registers simultaneously.

Bulk Exception Attendance: The easiest, highest-impact UX win. Assume all kids are present and only log the absentees to cut a 45-minute task down to 10 seconds.


Priority 2: The Core Education Engine (The Heart of A.U.R.A.)

5. Offline SLM-Generated ECE Content Engine (Daily Planner): Build the 500-activity offline database and prompt the AI to generate the daily 20-minute group session based on the age cohort.

6. Focus Child & Re-integration Protocol (Data-Driven Nudge): Connect your local attendance/health SQLite tables to the Daily Planner. Have the AI inject specific nudges (like welcoming back a child after a long absence).
7. Introvert Integration (Behavioral Adaptation): Add the prompt layer that gives the worker "low-pressure roles" for shy kids, and allow her to voice-log behavioral observations to influence the next day's activity.


Priority 3: Clinical Safety & Predictive Intelligence

8. Neuro-Symbolic Health Engine: Implement the hardcoded WHO Z-score math to calculate SAM/MAM flags deterministically. Keep the AI completely out of clinical decision-making.

9. Velocity-Based Early Warning System: Train and bundle the lightweight LightGBM model (~80 KB) to predict malnutrition risk 6 to 8 weeks in advance based on weight drops and missed vaccines.

10. Explainable AI Alerts: Ensure every health flag generated gives the worker a plain-language reason (e.g., "weight dropped 3 months + 6 absences") so she understands why the app is warning her.


Priority 4: Safeguards, Trust, & Compliance

11. Three-Tier Confidence Routing: Crucial for voice data. If the AI is unsure about a spoken name (under 91% confidence), force the worker to confirm it before saving.

12. Reflection Audit (Human Gate): Build the final screen where the app summarizes all actions for the day and waits for the worker to tap 'Approve' before committing.

13. Interruption-Safe Checkpointing: Add state-saving logic so the app resumes exactly where it left off if the cheap phone crashes.
14. Visual Headcount & Low-Light Enhancement: Add the Zero-DCE and YOLOv8n pipeline to verify the voice-attendance with a photo.

15. Last-Mile Infrastructure Grievance Portal: Add the simple long-press button for workers to report broken toilets or roofs via voice/photo to the block officer.

16. Print-Ready Register PDF Export: Auto-generate PDFs that match the physical registers so the worker has physical proof of her work for audits.




PART 2: FUTURE SCOPE (Categorized & Justified)
(By moving these out, you save months of development time and avoid bureaucratic roadblocks during the MVP phase).

Category A: Advanced Optical/Hardware Heavy Features
Aadhaar OCR: Uses a local offline scanner to read cards and ledgers to prevent typing errors.
Reverse OCR Paper Workflow: Worker fills a physical register, snaps a photo, and edge-OCR extracts the data.
Why push to future: OCR on budget ₹8,000 Android phones is notoriously brittle. It requires massive testing for bad lighting, crumpled paper, and blurry cameras. The voice-entry system (SARR) solves the data-entry problem faster and with less battery drain for the MVP.

Category B: Complex Analytics & Scale-Dependent Features
Epidemic Early Warning (Epi-AI): Aggregates data from multiple centers to push local disease outbreak warnings.
Federated Privacy Analytics: Analyzes data on-device and sends only anonymous trends centrally to protect privacy.
In-App Time-Motion Analytics: Tracks exactly how much time the app saves the worker behind the scenes.
Why push to future: These features require a massive, active user base to actually be valuable. You don't need federated analytics or epidemic tracking when you only have 1,000 test users in a pilot. Focus on making the app work for one worker first.

Category C: Multi-Stakeholder API Integrations
ABHA ID Integration: Links Anganwadi profiles to the national digital health ID.
ANM/ASHA Coordination Layer: Auto-generates WhatsApp/SMS referrals for local health workers.
Why push to future: Integrating with external government APIs (like ABHA) requires months of security clearances, API key requests, and bureaucratic red tape. Sending automated messages to ASHA workers requires standardizing phone numbers and workflows across different government departments. This is a massive headache for a V1 product.

Category D: Advanced Edge-Case Engineering
Field-Level Merge Policy: Authority-tier logic that decides whose data wins if a doctor and a worker both enter conflicting clinical data.
Multi-Language Localization: Expanding to India's 22 recognized languages beyond Hindi/Hinglish.
Why push to future: Standard "local-wins" offline sync is perfectly fine for the MVP. Complex merge policies are only needed when you have thousands of medical officers actively editing the backend. Similarly, stick to one language (Hindi/Hinglish) to perfect the AI prompts before expanding the acoustic models.

