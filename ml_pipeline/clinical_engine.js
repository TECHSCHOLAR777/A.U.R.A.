/**
 * ==============================================================================
 *  A.U.R.A — Deterministic Clinical Diagnosis Engine (Symbolic Layer)
 * ==============================================================================
 * 
 * Implements the strictly deterministic World Health Organization (WHO) Child 
 * Growth Standards. Computesrecumbent length-for-weight standard deviation scores 
 * (Z-scores) using the LMS methodology to ensure clinical classification (SAM/MAM/NORMAL) 
 * is driven entirely by certified medical math—free from heuristic AI variance.
 * 
 * LMS Methodology Explanation:
 *   - L (Lambda): Skewness parameter (Box-Cox power transformation coefficient).
 *                 Adjusts for non-normal weight distributions at different lengths.
 *   - M (Mu): Median weight. The target reference standard for a given length.
 *   - S (Sigma): Coefficient of variation. Measures the dispersion of weight.
 * 
 * Formula:
 *   Z-score = ((Weight / M)^L - 1) / (L * S)      [for L !== 0]
 *   Z-score = ln(Weight / M) / S                  [for L === 0]
 * 
 * ==============================================================================
 */

const whoStandards = require('./who_standards.json');

/**
 * Calculates the WHO Weight-for-Length Z-Score for a child.
 * 
 * @param {number} weight - Weight of the child in kilograms (kg).
 * @param {number} length - Length of the child in centimeters (cm).
 * @param {string} gender - Gender of the child ('boys' or 'girls', case-insensitive).
 * @returns {number} The exact calculated WHO Z-Score.
 */
function calculateWHOZScore(weight, length, gender) {
    if (typeof weight !== 'number' || isNaN(weight) || weight <= 0) {
        throw new Error('Weight must be a positive number.');
    }
    if (typeof length !== 'number' || isNaN(length) || length <= 0) {
        throw new Error('Length must be a positive number.');
    }
    if (!gender || typeof gender !== 'string') {
        throw new Error('Gender must be a valid string ("boys" or "girls").');
    }

    // Standardize gender key to match JSON format
    const genderKey = gender.toLowerCase().trim();
    if (genderKey !== 'boys' && genderKey !== 'girls') {
        throw new Error('Gender must be either "boys" or "girls".');
    }

    // 1. Format length to the nearest 0.5cm increment as per WHO standards
    const roundedLength = Math.round(length * 2) / 2;
    const lengthKey = roundedLength.toFixed(1); // Converts 65.5 to "65.5" to match JSON keys

    // 2. Fetch the gender table
    const genderTable = whoStandards[genderKey];
    if (!genderTable) {
        throw new Error(`Standard data for gender "${genderKey}" not found in database.`);
    }

    // 3. Fetch LMS parameters for the matching length
    const lms = genderTable[lengthKey];
    if (!lms) {
        // Find supported bounds for helpful error reporting
        const keys = Object.keys(genderTable).map(Number).sort((a, b) => a - b);
        const minLen = keys[0];
        const maxLen = keys[keys.length - 1];
        throw new Error(`Length ${length} cm (rounded to ${lengthKey} cm) is out of supported WHO standards range [${minLen} - ${maxLen} cm].`);
    }

    const { L, M, S } = lms;

    // 4. Apply the WHO LMS Box-Cox power transformation formula
    let zScore;
    if (Math.abs(L) < 1e-9) {
        // Special logarithmic case for L = 0
        zScore = Math.log(weight / M) / S;
    } else {
        // Standard power transformation case
        zScore = (Math.pow(weight / M, L) - 1) / (L * S);
    }

    // Return the calculated Z-score rounded to 4 decimal places
    return Math.round(zScore * 10000) / 10000;
}

/**
 * Categorizes a Z-score into a clinical nutrition classification based on WHO guidelines.
 * 
 * @param {number} zScore - The weight-for-length WHO Z-score.
 * @returns {string} Clinical classification: 'SAM' (Severe Acute Malnutrition),
 *                   'MAM' (Moderate Acute Malnutrition), or 'NORMAL'.
 */
function getClinicalDiagnosis(zScore) {
    if (typeof zScore !== 'number' || isNaN(zScore)) {
        throw new Error('Z-score must be a valid number.');
    }

    // WHO Nutritional Status cut-offs:
    // - Z-Score below -3.0 indicates Severe Acute Malnutrition (SAM)
    // - Z-Score between -3.0 and -2.0 indicates Moderate Acute Malnutrition (MAM)
    // - Z-Score at or above -2.0 is considered normal nutritional status
    if (zScore < -3.0) {
        return 'SAM';
    } else if (zScore >= -3.0 && zScore < -2.0) {
        return 'MAM';
    } else {
        return 'NORMAL';
    }
}

// Export module functions
module.exports = {
    calculateWHOZScore,
    getClinicalDiagnosis
};
