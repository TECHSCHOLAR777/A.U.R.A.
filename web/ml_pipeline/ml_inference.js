/**
 * ==============================================================================
 *  A.U.R.A — SAM Early Warning Offline Inference Engine
 * ==============================================================================
 * 
 * A lightweight, dependency-free JavaScript module to execute LightGBM early 
 * warning models completely offline inside Progressive Web Apps (PWAs), hybrid 
 * apps, or Node.js backends.
 * 
 * Features:
 *   - Custom plain-text LightGBM booster parser (no ONNX or TensorFlow.js needed).
 *   - Supports dynamic feature index mapping via "feature_names" headers.
 *   - Sigmoid activation function for binary classification probability scoring.
 *   - Explainable AI (XAI) dynamic reason generator based on current indicators.
 * 
 * ==============================================================================
 */

/**
 * Parses the raw plain-text LightGBM booster model.
 * 
 * @param {string} modelText - The complete plain-text of the saved LightGBM model file.
 * @returns {Object} Parsed model metadata and tree structures.
 */
function parseLightGBMModel(modelText) {
    const lines = modelText.split(/\r?\n/);
    let featureNames = [];
    const trees = [];
    let currentTree = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse global features names from header
        if (line.startsWith("feature_names=")) {
            featureNames = line.substring("feature_names=".length).split(/\s+/);
            continue;
        }

        // Detect beginning of a tree block
        if (line.startsWith("Tree=")) {
            if (currentTree) {
                trees.push(currentTree);
            }
            currentTree = {
                id: parseInt(line.substring("Tree=".length), 10),
                num_leaves: 0,
                split_feature: [],
                threshold: [],
                left_child: [],
                right_child: [],
                leaf_value: []
            };
            continue;
        }

        // Parse tree properties
        if (currentTree) {
            if (line.startsWith("num_leaves=")) {
                currentTree.num_leaves = parseInt(line.substring("num_leaves=".length), 10);
            } else if (line.startsWith("split_feature=")) {
                currentTree.split_feature = line.substring("split_feature=".length).split(/\s+/).map(Number);
            } else if (line.startsWith("threshold=")) {
                currentTree.threshold = line.substring("threshold=".length).split(/\s+/).map(Number);
            } else if (line.startsWith("left_child=")) {
                currentTree.left_child = line.substring("left_child=".length).split(/\s+/).map(Number);
            } else if (line.startsWith("right_child=")) {
                currentTree.right_child = line.substring("right_child=".length).split(/\s+/).map(Number);
            } else if (line.startsWith("leaf_value=")) {
                currentTree.leaf_value = line.substring("leaf_value=".length).split(/\s+/).map(Number);
            }
        }
    }

    // Push the final tree
    if (currentTree) {
        trees.push(currentTree);
    }

    return {
        featureNames,
        trees
    };
}

/**
 * Standard Sigmoid activation function to map log-odds to binary probability.
 * 
 * @param {number} x - Raw summed tree logit score.
 * @returns {number} Probability between 0.0 and 1.0.
 */
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

/**
 * Generates an Explainable AI (XAI) reason string based on a high-risk child's
 * current wasting severity, velocity drop, attendance levels, and vaccination streak.
 * 
 * @param {Object} childData - The child's current features.
 * @returns {string} Dynamic human-readable reason string.
 */
function generateXAIReason(childData) {
    const concerns = [];

    // 1. Z-Score (wasting status)
    if (childData.zwfl < -3.0) {
        concerns.push(`critical wasting detected (Z-Score: ${childData.zwfl.toFixed(2)})`);
    } else if (childData.zwfl < -2.0) {
        concerns.push(`moderate wasting detected (Z-Score: ${childData.zwfl.toFixed(2)})`);
    }

    // 2. Velocity drop
    if (childData.z_velocity < -0.3) {
        concerns.push("Z-Score dropping rapidly");
    } else if (childData.z_velocity < -0.15) {
        concerns.push("declining growth trajectory");
    }

    // 3. Attendance Rate
    if (childData.attendance_rate < 0.5) {
        concerns.push(`attendance is below 50% (currently ${(childData.attendance_rate * 100).toFixed(0)}%)`);
    } else if (childData.attendance_rate < 0.7) {
        concerns.push(`low Anganwadi attendance (${(childData.attendance_rate * 100).toFixed(0)}%)`);
    }

    // 4. Immunization Streak
    if (childData.missed_vaccine_streak >= 2) {
        concerns.push(`missed vaccine streak (${childData.missed_vaccine_streak} missed)`);
    }

    // 5. Migrant Status
    if (childData.migrant_flag === 1) {
        concerns.push("vulnerable migrant status");
    }

    if (concerns.length > 0) {
        // Format sentence-style: capitalize first letter, join list grammatically
        const formatted = concerns.map((c, idx) => idx === 0 ? c.charAt(0).toUpperCase() + c.slice(1) : c);
        if (formatted.length === 1) {
            return `High Risk: ${formatted[0]}.`;
        } else if (formatted.length === 2) {
            return `High Risk: ${formatted[0]} and ${formatted[1]}.`;
        } else {
            return `High Risk: ${formatted.slice(0, -1).join(", ")}, and ${formatted[formatted.length - 1]}.`;
        }
    }

    return "High Risk: Multiple marginal indicators suggest declining growth trajectory.";
}

/**
 * Predicts Severe Acute Malnutrition (SAM) risk in the next quarter for a child.
 * Executes fully offline using a custom, high-speed LightGBM text tree parser.
 * 
 * @param {Object} childData - Input variables: { zwfl, z_velocity, attendance_rate, missed_vaccine_streak, migrant_flag }
 *                             (And optional features like: z_acceleration, zwfl_min_3, cumulative_low_visits)
 * @param {string} modelText - Raw plain-text string of the trained model file.
 * @returns {Object} Object containing risk assessment, probability score, and XAI reason.
 */
function predictMalnutritionRisk(childData, modelText) {
    // 1. Parse booster tree definitions
    const { featureNames, trees } = parseLightGBMModel(modelText);

    if (trees.length === 0) {
        throw new Error("Invalid model text or empty trees parsed.");
    }

    let logOdds = 0.0;

    // 2. Iterate and evaluate each tree
    for (let t = 0; t < trees.length; t++) {
        const tree = trees[t];
        let currentNode = 0; // Starts at root node

        // Traversal loop: negative value indicates leaf reached
        while (currentNode >= 0) {
            const splitFeatureIdx = tree.split_feature[currentNode];
            const featureName = featureNames[splitFeatureIdx];
            
            // Safe fallback to 0.0 if the input object lacks this feature
            const childFeatureVal = childData[featureName] !== undefined ? childData[featureName] : 0.0;
            const threshold = tree.threshold[currentNode];

            // LightGBM standard traversal condition: left if value <= threshold, else right
            if (childFeatureVal <= threshold) {
                currentNode = tree.left_child[currentNode];
            } else {
                currentNode = tree.right_child[currentNode];
            }
        }

        // Retrieve leaf value (bitwise NOT matches LightGBM leaf indexing convention: leafIndex = ~currentNode)
        const leafIndex = ~currentNode;
        const leafVal = tree.leaf_value[leafIndex];
        logOdds += leafVal;
    }

    // 3. Apply Sigmoid transformation to compute final probability
    const probability = sigmoid(logOdds);

    // 4. Return formatted XAI results based on target 0.70 threshold
    if (probability > 0.70) {
        return {
            isHighRisk: true,
            riskScore: probability,
            reason: generateXAIReason(childData)
        };
    } else {
        return {
            isHighRisk: false,
            riskScore: probability,
            reason: "Trajectory is currently stable."
        };
    }
}

// Export for ES Modules, CommonJS, and Global script compatibility
if (typeof exports !== "undefined") {
    module.exports = { predictMalnutritionRisk, parseLightGBMModel };
} else if (typeof define === "function" && define.amd) {
    define([], () => ({ predictMalnutritionRisk, parseLightGBMModel }));
} else {
    globalThis.predictMalnutritionRisk = predictMalnutritionRisk;
}
