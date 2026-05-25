'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, 'aura_local.db');

/**
 * All-in-one setup script for the AURA local database.
 * 
 * 1. Initializes aura_local.db
 * 2. Creates the full 8-table normalized schema
 * 3. Seeds the beneficiary directory with diverse profiles
 * 4. Seeds all relational tracking and inventory tables
 */
function setupDatabase() {
    const db = new Database(DB_PATH, { verbose: null });

    // Enable WAL for concurrency and enforce foreign keys
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // ========================================================================
    // 1. CREATE FULL NORMALIZED SCHEMA
    // ========================================================================
    db.exec(`
        CREATE TABLE IF NOT EXISTS beneficiary_directory (
            beneficiary_id  TEXT    NOT NULL,
            child_name      TEXT    NOT NULL,
            gender          TEXT    NOT NULL CHECK (gender IN ('M', 'F', 'O')),
            dob             DATE    NOT NULL,
            family_id       TEXT,
            type            TEXT    DEFAULT 'child' CHECK (type IN ('child', 'pregnant', 'lactating', 'adolescent')),
            created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (beneficiary_id)
        );

        CREATE TABLE IF NOT EXISTS daily_tracking (
            tracking_id            TEXT     NOT NULL,
            beneficiary_id         TEXT     NOT NULL,
            record_date            DATE     NOT NULL,
            attendance             BOOLEAN  NOT NULL DEFAULT 0,
            morning_snacks         BOOLEAN  NOT NULL DEFAULT 0,
            hot_cooked_meal        BOOLEAN  NOT NULL DEFAULT 0,
            activity_participated  BOOLEAN  NOT NULL DEFAULT 0,
            created_at             TEXT     NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (tracking_id),
            FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_directory(beneficiary_id) ON UPDATE CASCADE ON DELETE RESTRICT,
            UNIQUE (beneficiary_id, record_date)
        );
        CREATE INDEX IF NOT EXISTS idx_daily_tracking_date ON daily_tracking(record_date);
        CREATE INDEX IF NOT EXISTS idx_daily_tracking_beneficiary ON daily_tracking(beneficiary_id);

        CREATE TABLE IF NOT EXISTS growth_monitoring (
            id TEXT PRIMARY KEY,
            beneficiary_id TEXT NOT NULL,
            date DATE NOT NULL,
            weight_kg REAL,
            height_cm REAL,
            z_score REAL,
            sam_mam_status TEXT,
            FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_directory(beneficiary_id) ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE TABLE IF NOT EXISTS health_and_vaccines (
            id TEXT PRIMARY KEY,
            beneficiary_id TEXT NOT NULL,
            date DATE NOT NULL,
            vaccine_type TEXT,
            vitamin_a_dose BOOLEAN DEFAULT 0,
            deworming_pill BOOLEAN DEFAULT 0,
            FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_directory(beneficiary_id) ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE TABLE IF NOT EXISTS inventory_ledger (
            id TEXT PRIMARY KEY,
            date DATE NOT NULL,
            item_name TEXT NOT NULL,
            inbound_qty REAL DEFAULT 0,
            outbound_qty REAL DEFAULT 0,
            closing_balance REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS ration_distribution (
            id TEXT PRIMARY KEY,
            beneficiary_id TEXT NOT NULL,
            date DATE NOT NULL,
            ration_type TEXT NOT NULL,
            qty_given REAL NOT NULL,
            FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_directory(beneficiary_id) ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pregnancy_delivery (
            id TEXT PRIMARY KEY,
            beneficiary_id TEXT NOT NULL,
            anc_check_date DATE,
            delivery_date DATE,
            birth_weight REAL,
            FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_directory(beneficiary_id) ON DELETE CASCADE ON UPDATE CASCADE
        );

        CREATE TABLE IF NOT EXISTS home_visits_and_referrals (
            id TEXT PRIMARY KEY,
            beneficiary_id TEXT NOT NULL,
            visit_date DATE NOT NULL,
            counseling_notes TEXT,
            referred_to_chc BOOLEAN DEFAULT 0,
            FOREIGN KEY (beneficiary_id) REFERENCES beneficiary_directory(beneficiary_id) ON DELETE CASCADE ON UPDATE CASCADE
        );
    `);

    // Verify FK enforcement is active
    const fkStatus = db.pragma('foreign_keys', { simple: true });
    if (fkStatus !== 1) {
        throw new Error('Failed to enable FOREIGN KEY constraints.');
    }

    // ========================================================================
    // 2. SEED DATA
    // ========================================================================
    const seedTransaction = db.transaction(() => {
        // --- Beneficiaries ---
        const insertBeneficiary = db.prepare(`INSERT OR IGNORE INTO beneficiary_directory (beneficiary_id, child_name, gender, dob, type) VALUES (?, ?, ?, ?, ?)`);
        insertBeneficiary.run('JH-001', 'Rahul Munda',   'M', '2020-04-12', 'child');
        insertBeneficiary.run('JH-002', 'Priya Soren',   'F', '2021-08-25', 'child');
        insertBeneficiary.run('JH-003', 'Suresh Oraon',  'M', '2022-01-10', 'child');
        insertBeneficiary.run('JH-004', 'Anita Toppo',   'F', '2022-11-05', 'child');
        insertBeneficiary.run('JH-005', 'Kavita Hansda', 'F', '2023-05-20', 'child');
        insertBeneficiary.run('JH-006', 'Sunita Munda',  'F', '1998-05-10', 'pregnant');
        insertBeneficiary.run('JH-007', 'Malti Murmu',   'F', '1995-11-20', 'lactating');
        insertBeneficiary.run('JH-008', 'Rupa Kujur',    'F', '2010-02-15', 'adolescent');

        // --- Daily Tracking (October 2026, 20 Days for 5 children) ---
        const insertTracking = db.prepare(`INSERT OR IGNORE INTO daily_tracking (tracking_id, beneficiary_id, record_date, attendance, morning_snacks, hot_cooked_meal, activity_participated) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const chance = (prob) => Math.random() < prob ? 1 : 0;
        const childIds = ['JH-001', 'JH-002', 'JH-003', 'JH-004', 'JH-005'];
        
        for (const childId of childIds) {
            for (let day = 1; day <= 20; day++) {
                const dateStr = `2026-10-${day.toString().padStart(2, '0')}`;
                const trackingId = `TRK-${childId}-${dateStr.replace(/-/g, '')}`;
                
                const attendance = chance(0.9);
                let snacks = 0, hcm = 0, activity = 0;
                
                if (attendance) {
                    snacks = chance(0.95);
                    hcm = chance(0.85);
                    activity = chance(0.80);
                }
                
                insertTracking.run(trackingId, childId, dateStr, attendance, snacks, hcm, activity);
            }
        }

        // --- Growth Monitoring ---
        const insertGrowth = db.prepare(`INSERT OR IGNORE INTO growth_monitoring (id, beneficiary_id, date, weight_kg, height_cm, z_score, sam_mam_status) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        insertGrowth.run('GM-001', 'JH-001', '2026-10-05', 18.5, 110.2, -0.5, 'Normal');
        insertGrowth.run('GM-002', 'JH-002', '2026-10-05', 15.2, 105.0, -1.0, 'Normal');
        insertGrowth.run('GM-003', 'JH-003', '2026-10-05', 10.1, 95.5, -3.5, 'SAM'); // SAM child
        insertGrowth.run('GM-004', 'JH-004', '2026-10-05', 14.8, 102.1, -1.2, 'Normal');
        insertGrowth.run('GM-005', 'JH-005', '2026-10-05', 13.5, 98.0, -0.8, 'Normal');

        // --- Health & Vaccines ---
        const insertHealth = db.prepare(`INSERT OR IGNORE INTO health_and_vaccines (id, beneficiary_id, date, vaccine_type, vitamin_a_dose, deworming_pill) VALUES (?, ?, ?, ?, ?, ?)`);
        insertHealth.run('HV-001', 'JH-001', '2026-10-10', null, 1, 1);
        insertHealth.run('HV-002', 'JH-003', '2026-10-10', null, 1, 1);

        // --- Inventory Ledger ---
        const insertInventory = db.prepare(`INSERT OR IGNORE INTO inventory_ledger (id, date, item_name, inbound_qty, outbound_qty, closing_balance) VALUES (?, ?, ?, ?, ?, ?)`);
        insertInventory.run('INV-001', '2026-10-01', 'Rice (kg)', 50.0, 0.0, 50.0);
        insertInventory.run('INV-002', '2026-10-01', 'Dal (kg)', 20.0, 0.0, 20.0);
        insertInventory.run('INV-003', '2026-10-01', 'Take Home Ration (THR) Packets', 100.0, 0.0, 100.0);
        insertInventory.run('INV-004', '2026-10-06', 'Take Home Ration (THR) Packets', 0.0, 10.0, 90.0);

        // --- Ration Distribution ---
        const insertRation = db.prepare(`INSERT OR IGNORE INTO ration_distribution (id, beneficiary_id, date, ration_type, qty_given) VALUES (?, ?, ?, ?, ?)`);
        insertRation.run('RD-001', 'JH-006', '2026-10-06', 'THR Packets', 2.0); // Pregnant
        insertRation.run('RD-002', 'JH-007', '2026-10-06', 'THR Packets', 2.0); // Lactating
        insertRation.run('RD-003', 'JH-008', '2026-10-06', 'THR Packets', 1.0); // Adolescent
        insertRation.run('RD-004', 'JH-003', '2026-10-06', 'Therapeutic Food / Double THR (SAM)', 4.0); // SAM child

        // --- Pregnancy & Delivery ---
        const insertPregnancy = db.prepare(`INSERT OR IGNORE INTO pregnancy_delivery (id, beneficiary_id, anc_check_date, delivery_date, birth_weight) VALUES (?, ?, ?, ?, ?)`);
        insertPregnancy.run('PD-001', 'JH-006', '2026-10-15', null, null); 
        insertPregnancy.run('PD-002', 'JH-007', null, '2026-06-10', 2.8); 

        // --- Home Visits & Referrals ---
        const insertVisit = db.prepare(`INSERT OR IGNORE INTO home_visits_and_referrals (id, beneficiary_id, visit_date, counseling_notes, referred_to_chc) VALUES (?, ?, ?, ?, ?)`);
        insertVisit.run('HV-REF-001', 'JH-006', '2026-10-12', 'ANC checkup advised, blood pressure normal, diet counseling provided.', 0);
        insertVisit.run('HV-REF-002', 'JH-003', '2026-10-07', 'Child identified as SAM during growth monitoring. Referred immediately to Malnutrition Treatment Center (MTC) at CHC.', 1);
    });

    seedTransaction();

    console.log('Database successfully initialized and seeded.');
    return db;
}

if (require.main === module) {
    try {
        const db = setupDatabase();
        db.close();
    } catch (err) {
        console.error('[SETUP ERROR]', err);
    }
}

module.exports = { setupDatabase, initDatabase: setupDatabase, DB_PATH };
