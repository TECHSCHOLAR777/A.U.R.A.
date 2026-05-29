/**
 * Validation Test for A.U.R.A offline JavaScript inference engine
 */

const fs = require('fs');
const path = require('path');
const { predictMalnutritionRisk } = require('./ml_inference');

const modelPath = path.join(__dirname, 'aura_sam_predictor_80kb.txt');

if (!fs.existsSync(modelPath)) {
    console.error(`Error: Model file not found at ${modelPath}. Please train the model first.`);
    process.exit(1);
}

const modelText = fs.readFileSync(modelPath, 'utf8');

console.log("======================================================================");
console.log(" A.U.R.A Offline Inference Validation Tests");
console.log("======================================================================");

// Case 1: Healthy stable child
const stableChild = {
    zwfl: 0.5,
    z_velocity: 0.05,
    attendance_rate: 0.95,
    missed_vaccine_streak: 0,
    migrant_flag: 0,
    z_acceleration: 0.0,
    zwfl_min_3: 0.3,
    cumulative_low_visits: 0
};

console.log("\n[Test 1] Stable/Healthy Child Trajectory:");
console.log(stableChild);
try {
    const result1 = predictMalnutritionRisk(stableChild, modelText);
    console.log("Result:");
    console.log(`  Probability Score: ${(result1.riskScore * 100).toFixed(2)}%`);
    console.log(`  Is High Risk?     : ${result1.isHighRisk}`);
    console.log(`  Dynamic Reason    : "${result1.reason}"`);
    
    if (result1.isHighRisk === false && result1.riskScore < 0.20) {
        console.log("  => TEST 1 PASSED (Low-risk correctly predicted)");
    } else {
        console.error("  => TEST 1 FAILED");
    }
} catch (err) {
    console.error("Error in Test 1:", err);
}

// Case 2: Extremely severe acute wasting + dropping velocity + low attendance child
const atRiskChild = {
    zwfl: -2.8,
    z_velocity: -0.45,
    attendance_rate: 0.30,
    missed_vaccine_streak: 3,
    migrant_flag: 1,
    z_acceleration: -0.2,
    zwfl_min_3: -2.8,
    cumulative_low_visits: 4
};

console.log("\n[Test 2] High-Risk Malnutrition Trajectory:");
console.log(atRiskChild);
try {
    const result2 = predictMalnutritionRisk(atRiskChild, modelText);
    console.log("Result:");
    console.log(`  Probability Score: ${(result2.riskScore * 100).toFixed(2)}%`);
    console.log(`  Is High Risk?     : ${result2.isHighRisk}`);
    console.log(`  Dynamic Reason    : "${result2.reason}"`);
    
    if (result2.isHighRisk === true && result2.riskScore > 0.70) {
        console.log("  => TEST 2 PASSED (High-risk correctly identified with dynamic reason)");
    } else {
        console.error("  => TEST 2 FAILED");
    }
} catch (err) {
    console.error("Error in Test 2:", err);
}

console.log("\n======================================================================");
console.log(" Validation Complete.");
console.log("======================================================================");
