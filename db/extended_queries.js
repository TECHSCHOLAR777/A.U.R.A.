/**
 * Extended query functions to fetch and aggregate data for physical registers.
 * These functions match the dataKeys required by the universal_pdf_generator.
 */

/**
 * Register 2: Food Stock Ledger
 */
async function fetchRegister2Data(db, month, year) {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();

    const stmt = db.prepare(`
        SELECT date, item_name, inbound_qty, outbound_qty, closing_balance
        FROM inventory_ledger
        WHERE strftime('%m', date) = ? AND strftime('%Y', date) = ?
        ORDER BY date ASC, item_name ASC
    `);

    return stmt.all(monthStr, yearStr);
}

/**
 * Register 3: Supplementary Food Distribution
 */
async function fetchRegister3Data(db, month, year) {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();

    const stmt = db.prepare(`
        SELECT r.date, b.child_name, b.type, r.ration_type, r.qty_given
        FROM ration_distribution r
        JOIN beneficiary_directory b ON r.beneficiary_id = b.beneficiary_id
        WHERE strftime('%m', r.date) = ? AND strftime('%Y', r.date) = ?
        ORDER BY r.date ASC, b.child_name ASC
    `);

    return stmt.all(monthStr, yearStr);
}

/**
 * Register 4: Pre-School Education Attendance
 * Aggregates attendance and activity_participated (ECE).
 */
async function fetchRegister4Data(db, month, year) {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();

    const stmt = db.prepare(`
        SELECT 
            b.child_name,
            CAST(strftime('%Y.%m%d', 'now') - strftime('%Y.%m%d', b.dob) AS INTEGER) AS age,
            SUM(t.attendance) AS total_attendance_days,
            SUM(t.activity_participated) AS total_activity_days
        FROM beneficiary_directory b
        JOIN daily_tracking t ON b.beneficiary_id = t.beneficiary_id
        WHERE strftime('%m', t.record_date) = ? AND strftime('%Y', t.record_date) = ?
        GROUP BY b.beneficiary_id
        ORDER BY b.child_name ASC
    `);

    return stmt.all(monthStr, yearStr);
}

/**
 * Register 11: Growth Monitoring
 */
async function fetchRegister11Data(db, month, year) {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();

    const stmt = db.prepare(`
        SELECT g.date, b.child_name, b.gender, g.weight_kg, g.height_cm, g.z_score, g.sam_mam_status
        FROM growth_monitoring g
        JOIN beneficiary_directory b ON g.beneficiary_id = b.beneficiary_id
        WHERE strftime('%m', g.date) = ? AND strftime('%Y', g.date) = ?
        ORDER BY g.date ASC, b.child_name ASC
    `);

    return stmt.all(monthStr, yearStr);
}

/**
 * Register 15: SAM Tracking & Referrals
 * Strictly filters children identified as 'SAM' and joins their referral notes.
 */
async function fetchRegister15Data(db, month, year) {
    const monthStr = month.toString().padStart(2, '0');
    const yearStr = year.toString();

    const stmt = db.prepare(`
        SELECT 
            COALESCE(h.visit_date, 'No Visit Logged') AS visit_date, 
            b.child_name, 
            g.weight_kg, 
            g.z_score, 
            COALESCE(h.counseling_notes, '-') AS counseling_notes, 
            COALESCE(h.referred_to_chc, 0) AS referred_to_chc
        FROM growth_monitoring g
        JOIN beneficiary_directory b ON g.beneficiary_id = b.beneficiary_id
        LEFT JOIN home_visits_and_referrals h ON b.beneficiary_id = h.beneficiary_id 
             AND strftime('%m', h.visit_date) = ? AND strftime('%Y', h.visit_date) = ?
        WHERE g.sam_mam_status = 'SAM'
          AND strftime('%m', g.date) = ? AND strftime('%Y', g.date) = ?
        ORDER BY b.child_name ASC
    `);

    return stmt.all(monthStr, yearStr, monthStr, yearStr);
}

module.exports = {
    fetchRegister2Data,
    fetchRegister3Data,
    fetchRegister4Data,
    fetchRegister11Data,
    fetchRegister15Data
};
