/**
 * Validation Test for A.U.R.A Deterministic Clinical Engine
 */

const { calculateWHOZScore, getClinicalDiagnosis } = require('./clinical_engine');

console.log("======================================================================");
console.log(" A.U.R.A Deterministic Clinical Standards Validation Tests");
console.log("======================================================================");

// Case 1: Boy at 70.0 cm weighing exactly the WHO Median (M = 8.4227 kg)
console.log("\n[Test 1] Median Weight Evaluation (Expected Z = 0.0, NORMAL):");
try {
    const z = calculateWHOZScore(8.4227, 70.0, 'boys');
    const diag = getClinicalDiagnosis(z);
    console.log(`  Z-Score: ${z}`);
    console.log(`  Diagnosis: ${diag}`);
    if (Math.abs(z) < 1e-4 && diag === 'NORMAL') {
        console.log("  => TEST 1 PASSED");
    } else {
        console.error("  => TEST 1 FAILED");
    }
} catch (err) {
    console.error("  => TEST 1 ERROR:", err);
}

// Case 2: Boy at 70.0 cm weighing 7.00 kg (MAM Range)
console.log("\n[Test 2] Moderate Malnutrition (Expected Z approx -2.32, MAM):");
try {
    const z = calculateWHOZScore(7.00, 70.0, 'boys');
    const diag = getClinicalDiagnosis(z);
    console.log(`  Z-Score: ${z}`);
    console.log(`  Diagnosis: ${diag}`);
    if (z === -2.3232 && diag === 'MAM') {
        console.log("  => TEST 2 PASSED");
    } else {
        console.error("  => TEST 2 FAILED");
    }
} catch (err) {
    console.error("  => TEST 2 ERROR:", err);
}

// Case 3: Boy at 69.8 cm (rounding to 70.0 cm) weighing 6.2 kg (SAM Range)
console.log("\n[Test 3] Length Rounding & Severe Malnutrition (Expected Z approx -3.93, SAM):");
try {
    const z = calculateWHOZScore(6.20, 69.8, 'boys'); // Should round to 70.0 cm in LMS lookup
    const diag = getClinicalDiagnosis(z);
    console.log(`  Z-Score: ${z}`);
    console.log(`  Diagnosis: ${diag}`);
    if (z === -3.9314 && diag === 'SAM') {
        console.log("  => TEST 3 PASSED");
    } else {
        console.error("  => TEST 3 FAILED");
    }
} catch (err) {
    console.error("  => TEST 3 ERROR:", err);
}

// Case 4: Invalid parameters testing
console.log("\n[Test 4] Out-of-bounds WHO range error throwing validation:");
try {
    calculateWHOZScore(5.00, 120.0, 'girls'); // 120 cm is not in the JSON (supported range is 65-80 cm)
    console.error("  => TEST 4 FAILED (Should have thrown range error)");
} catch (err) {
    console.log(`  Caught expected range error: "${err.message}"`);
    console.log("  => TEST 4 PASSED");
}

console.log("\n======================================================================");
console.log(" Deterministic Engine Verification Complete.");
console.log("======================================================================");
