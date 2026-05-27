/**
 * ==============================================================================
 *  A.U.R.A — Early Childhood Education (ECE) Engine
 * ==============================================================================
 *
 * Production client-side module that interfaces with a local Ollama instance
 * running the Qwen 2.5 0.5B Small Language Model (SLM) to generate
 * deterministic, age-appropriate daily briefings for Anganwadi workers.
 *
 * Satisfies:
 *   Feature 5 — Cohort-Scaled Activity Planner (3-4yr / 5-6yr complexity)
 *   Feature 6 — Re-integration Nudge Protocols (attendance/health anomalies)
 *   Feature 7 — Behavioral Voice-Log Adaptation Loop (introverted child roles)
 *
 * SLM Safety:
 *   - Strict Few-Shot Prompting with an exact input/output exemplar baked
 *     into the system message so the 0.5B model never deviates from schema.
 *   - Robust regex-based JSON extraction that strips markdown fences,
 *     conversational preamble, and trailing commentary.
 *   - Guaranteed fallback structure so the frontend UI never crashes.
 *
 * Dependencies:
 *   - A running Ollama server at http://localhost:11434 with qwen2.5:0.5b pulled.
 *   - Node.js 18+ (uses native fetch) or a browser with Fetch API.
 *
 * ==============================================================================
 */

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

const OLLAMA_BASE_URL = 'http://localhost:11434';
const OLLAMA_MODEL    = 'qwen2.5:0.5b';
const OLLAMA_ENDPOINT = `${OLLAMA_BASE_URL}/api/generate`;

// ---------------------------------------------------------------------------
// FEW-SHOT SYSTEM PROMPT
// ---------------------------------------------------------------------------
// The entire system message is crafted to force the 0.5B model into producing
// ONLY a raw JSON object that matches our exact schema.  We embed one complete
// example (input metadata -> perfect output JSON) so the model has an
// unambiguous template to follow.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are A.U.R.A. ECE Engine — a deterministic early-childhood education planner for Indian Anganwadi centers.

CRITICAL RULES:
1. You MUST return ONLY a single raw valid JSON object. No introductory text. No trailing text. No markdown fences. Just the JSON.
2. Scale the 20-minute activity complexity based on the age cohort provided.
3. Build explicit re-integration strategies from the database nudges array.
4. Assign low-pressure roles for introverted or struggling children identified in the voice log.

EXACT JSON SCHEMA YOU MUST FOLLOW:
{
  "cohort": "<age group string>",
  "daily_20min_session": {
    "title": "<activity name>",
    "execution_steps": "<detailed age-appropriate step-by-step group instructions>"
  },
  "reintegration_protocols": [
    { "name": "<student name>", "alert": "<the database flag>", "actionable_cue": "<specific greeting or care cue>" }
  ],
  "behavioral_adaptations": {
    "low_pressure_roles": "<assigned tasks for introverted children based on voice logs>",
    "worker_observation_response": "<how the routine was adapted based on the worker's voice log>"
  }
}

=== FEW-SHOT EXAMPLE ===

INPUT METADATA:
- ageCohort: "3-4 years"
- rawActivity: "Clay and shapes"
- localDatabaseNudges: [{"name":"Rani","flag":"absent_3_days"},{"name":"Suresh","flag":"low_weight_alert"}]
- voiceLogObservations: "Meera was very quiet yesterday and did not join the singing circle. Arjun cried during lunch."

PERFECT OUTPUT (return EXACTLY this format):
{"cohort":"3-4 years","daily_20min_session":{"title":"Clay and Shapes Exploration","execution_steps":"Step 1: Seat children in a circle on the floor mat. Hand each child a small ball of soft clay. Step 2: Demonstrate squeezing, rolling, and flattening the clay using both hands. Encourage tactile play — no precise shapes required at this age. Step 3: Show a circle shape cut-out card. Ask children to try pressing their clay flat like a roti. Step 4: Show a triangle card. Help children roll three small snakes and press them together. Step 5: Let children freely explore for 5 minutes. Walk around and name the shapes they accidentally create. Step 6: Clap together and sing the cleanup song while collecting clay."},"reintegration_protocols":[{"name":"Rani","alert":"absent_3_days","actionable_cue":"Greet Rani at the door by name. Say: 'Rani, we missed you! Come see what we made with clay.' Assign her a seat next to a friendly peer."},{"name":"Suresh","alert":"low_weight_alert","actionable_cue":"Ensure Suresh receives his supplementary nutrition first today. Seat him near the worker during snack time for gentle encouragement."}],"behavioral_adaptations":{"low_pressure_roles":"Meera (quiet/withdrawn): Assign her the role of 'Clay Keeper' — she hands out clay balls to each child. This gives her a defined, non-verbal role that includes her without social pressure. Arjun (emotional distress): Let Arjun sit beside the worker and be the 'Shape Card Holder' who simply holds up the picture cards when asked.","worker_observation_response":"Today's session was adjusted to be fully tactile and non-verbal to accommodate Meera's withdrawal from group singing. The circle seating was arranged so Arjun is beside the worker for proximity comfort."}}

=== END EXAMPLE ===

Now generate the briefing for the actual input metadata provided below. Return ONLY the JSON.`;

// ---------------------------------------------------------------------------
// UTILITY: Robust JSON Extraction
// ---------------------------------------------------------------------------
// The 0.5B SLM may occasionally wrap output in markdown fences, prepend
// conversational text like "Here is your plan:", or append trailing
// commentary.  This utility aggressively strips everything to isolate the
// JSON object.
// ---------------------------------------------------------------------------

/**
 * Attempts to extract and parse a JSON object from potentially noisy SLM
 * output text.  Tries multiple strategies in order of strictness.
 *
 * @param {string} rawText - Raw text returned by the Ollama generate API.
 * @returns {Object|null} Parsed JSON object, or null if all extraction fails.
 */
function extractJSON(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;

    let cleaned = rawText.trim();

    // Strategy 1: Strip markdown code fences (```json ... ``` or ``` ... ```)
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }

    // Strategy 2: Remove any leading non-JSON conversational text.
    // Find the first '{' and the last '}' and slice.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace  = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    // Strategy 3: Direct parse
    try {
        return JSON.parse(cleaned);
    } catch (_e1) {
        // Strategy 4: Attempt to fix common SLM quirks —
        // trailing commas before closing braces/brackets
        try {
            const fixedTrailing = cleaned.replace(/,\s*([}\]])/g, '$1');
            return JSON.parse(fixedTrailing);
        } catch (_e2) {
            // Strategy 5: Try to fix single quotes used instead of double quotes
            try {
                const fixedQuotes = cleaned.replace(/'/g, '"');
                return JSON.parse(fixedQuotes);
            } catch (_e3) {
                return null;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// UTILITY: Fallback Briefing Structure
// ---------------------------------------------------------------------------
// Guarantees the frontend UI receives a valid, renderable object even if
// the SLM produces completely unparseable output.
// ---------------------------------------------------------------------------

/**
 * Builds a safe fallback briefing when JSON extraction fails.
 *
 * @param {string} ageCohort - The requested age cohort.
 * @param {string} rawActivity - The raw activity topic.
 * @param {Array}  nudges - The database nudge entries.
 * @returns {Object} A minimal but valid briefing object.
 */
function buildFallbackBriefing(ageCohort, rawActivity, nudges) {
    return {
        cohort: ageCohort || 'Unknown',
        daily_20min_session: {
            title: rawActivity || 'Free Play Session',
            execution_steps: 'The AI planner could not generate detailed steps for this session. Please conduct a free-play or storytelling session appropriate for the age group while the system reconnects.'
        },
        reintegration_protocols: (nudges || []).map(n => ({
            name: n.name || 'Unknown Child',
            alert: n.flag || 'general_check',
            actionable_cue: `Please give special attention to ${n.name || 'this child'} today and check on their wellbeing.`
        })),
        behavioral_adaptations: {
            low_pressure_roles: 'No specific voice-log adaptations could be generated. Observe children during free play and note any who seem withdrawn.',
            worker_observation_response: 'Fallback mode active — voice log observations could not be processed. Please re-run the briefing generator when connectivity to the local model is restored.'
        },
        _fallback: true
    };
}

// ---------------------------------------------------------------------------
// UTILITY: Build User Prompt from Input Metadata
// ---------------------------------------------------------------------------

/**
 * Constructs the user-facing prompt string from the structured input
 * metadata, formatted to match the few-shot example's input pattern.
 *
 * @param {Object} params - The generateDailyBriefing input parameters.
 * @returns {string} Formatted user prompt string.
 */
function buildUserPrompt({ ageCohort, rawActivity, localDatabaseNudges, voiceLogObservations }) {
    const nudgesStr = JSON.stringify(localDatabaseNudges || []);

    return [
        `INPUT METADATA:`,
        `- ageCohort: "${ageCohort}"`,
        `- rawActivity: "${rawActivity}"`,
        `- localDatabaseNudges: ${nudgesStr}`,
        `- voiceLogObservations: "${voiceLogObservations || 'No observations recorded.'}"`,
        ``,
        `Generate the JSON briefing now.`
    ].join('\n');
}

// ---------------------------------------------------------------------------
// MAIN EXPORT: generateDailyBriefing
// ---------------------------------------------------------------------------

/**
 * Generates a complete daily ECE briefing by querying the local Ollama
 * Qwen 2.5 0.5B SLM with a few-shot structured prompt.
 *
 * @param {Object} params
 * @param {string} params.ageCohort - Target age group (e.g. "3-4 years", "5-6 years").
 * @param {string} params.rawActivity - Topic or theme for the 20-minute session.
 * @param {Array}  params.localDatabaseNudges - Array of { name, flag } objects from SQLite.
 * @param {string} params.voiceLogObservations - Transcribed voice log text from the worker.
 *
 * @returns {Promise<Object>} The structured daily briefing JSON object.
 */
async function generateDailyBriefing({ ageCohort, rawActivity, localDatabaseNudges, voiceLogObservations }) {
    const userPrompt = buildUserPrompt({ ageCohort, rawActivity, localDatabaseNudges, voiceLogObservations });

    // Construct the Ollama /api/generate request payload
    const payload = {
        model: OLLAMA_MODEL,
        prompt: userPrompt,
        system: SYSTEM_PROMPT,
        stream: false,                // Wait for the complete response
        options: {
            temperature: 0.3,         // Low temperature for deterministic output
            top_p: 0.9,
            num_predict: 1024,        // Sufficient tokens for the full JSON
            stop: ['\n\n\n']          // Stop on triple newline to prevent rambling
        }
    };

    try {
        const response = await fetch(OLLAMA_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            console.error(`Ollama API returned status ${response.status}: ${response.statusText}`);
            return buildFallbackBriefing(ageCohort, rawActivity, localDatabaseNudges);
        }

        const data = await response.json();
        const rawModelOutput = data.response || '';

        // Attempt robust JSON extraction from the SLM output
        const parsed = extractJSON(rawModelOutput);

        if (parsed && typeof parsed === 'object' && parsed.cohort && parsed.daily_20min_session) {
            // Successfully parsed a valid briefing
            return parsed;
        }

        // Extraction succeeded but schema is malformed — return fallback
        console.warn('SLM returned parseable JSON but schema was incomplete. Using fallback.');
        return buildFallbackBriefing(ageCohort, rawActivity, localDatabaseNudges);

    } catch (error) {
        // Network error, Ollama not running, timeout, etc.
        console.error('Failed to reach local Ollama instance:', error.message || error);
        return buildFallbackBriefing(ageCohort, rawActivity, localDatabaseNudges);
    }
}

// ---------------------------------------------------------------------------
// MODULE EXPORTS
// ---------------------------------------------------------------------------
// Compatible with both CommonJS (Node/Electron) and ES Module (PWA bundler)
// environments.
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { generateDailyBriefing };
} else {
    // Browser / ES Module global fallback
    globalThis.generateDailyBriefing = generateDailyBriefing;
}
