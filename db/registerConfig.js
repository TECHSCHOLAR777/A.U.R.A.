/**
 * Centralized configuration for physical ICDS register generation.
 * Maps UI table headers to database object keys.
 */

const REGISTER_CONFIGS = {
    REGISTER_2: {
        title: 'Register No. 2: Supplementary Food Stock Ledger',
        columns: ['Date', 'Item Name', 'Inbound Qty (kg/units)', 'Outbound Qty (kg/units)', 'Closing Balance'],
        dataKeys: ['date', 'item_name', 'inbound_qty', 'outbound_qty', 'closing_balance']
    },
    REGISTER_3: {
        title: 'Register No. 3: Supplementary Food Distribution',
        columns: ['Date', 'Beneficiary Name', 'Category', 'Ration Type', 'Quantity Given'],
        dataKeys: ['date', 'child_name', 'type', 'ration_type', 'qty_given'] // Assumes JOIN with beneficiary_directory
    },
    REGISTER_4: {
        title: 'Register No. 4: Pre-School Education Attendance',
        columns: ['Child Name', 'Age (Yrs)', 'Total Days Attended', 'Activities Participated (Days)'],
        dataKeys: ['child_name', 'age', 'total_attendance_days', 'total_activity_days']
    },
    REGISTER_6: {
        title: 'Register No. 6: Daily Attendance & Supplementary Nutrition (3-6 Years)',
        columns: ['Child Name', 'Age (Yrs)', 'Total Days Attended', 'Morning Snacks (Days)', 'Hot Cooked Meal (Days)'],
        dataKeys: ['child_name', 'age', 'total_attendance_days', 'total_snacks_days', 'total_hcm_days']
    },
    REGISTER_11: {
        title: 'Register No. 11: Growth Monitoring Weight & Height',
        columns: ['Date', 'Child Name', 'Gender', 'Weight (kg)', 'Height (cm)', 'Z-Score', 'Nutrition Status'],
        dataKeys: ['date', 'child_name', 'gender', 'weight_kg', 'height_cm', 'z_score', 'sam_mam_status']
    },
    REGISTER_15: {
        title: 'Register No. 15: Severe Acute Malnutrition (SAM) Tracking & Referral',
        columns: ['Visit Date', 'Child Name', 'Weight (kg)', 'Z-Score', 'Counseling Notes', 'Referred to CHC'],
        dataKeys: ['visit_date', 'child_name', 'weight_kg', 'z_score', 'counseling_notes', 'referred_to_chc']
    }
};

module.exports = { REGISTER_CONFIGS };
