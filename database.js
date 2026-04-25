const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

// Initialize database
if (!fs.existsSync("./data")) fs.mkdirSync("./data", { recursive: true });
const db = new sqlite3.Database("./data/bot.db");

db.all(`PRAGMA table_info(clients)`, (err, rows) => {
  if (err) {
    console.error("Error loading client schema:", err);
    return;
  }

  const existingColumns = rows.map((row) => row.name);
  const expectedColumns = [
    { name: "work_address", sql: "TEXT" },
    { name: "work_phone", sql: "TEXT" },
    { name: "score", sql: "INTEGER DEFAULT 0" },
    { name: "personal_phone_number", sql: "TEXT" },
    { name: "pending_action", sql: "TEXT" },
    { name: "advisor_contacted", sql: "INTEGER DEFAULT 0" },
    { name: "income_type", sql: "TEXT" },
    { name: "income_frequency", sql: "TEXT" },
    { name: "extra_household_income_available", sql: "TEXT" },
    { name: "extra_household_income_details", sql: "TEXT" },
    { name: "current_debt_payments", sql: "TEXT" }
  ];

  for (const column of expectedColumns) {
    if (!existingColumns.includes(column.name)) {
      db.run(`ALTER TABLE clients ADD COLUMN ${column.name} ${column.sql}`);
    }
  }
});

// =========================
// DATABASE OPERATIONS
// =========================

function getClient(wa_id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM clients WHERE wa_id = ?`, [wa_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function getClientsWithLastMessage() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT
        c.wa_id,
        c.profile_name,
        c.full_name,
        c.stage,
        c.question_step,
        c.status,
        c.score,
        c.expected_document,
        c.ine_front_path,
        c.ine_back_path,
        c.proof_of_address_path,
        c.house_front_path,
        c.income_proof_path,
        c.advisor_notified,
        c.updated_at,
        last_message.message_type AS last_message_type,
        last_message.message_text AS last_message_text,
        last_message.direction AS last_message_direction,
        last_message.created_at AS last_message_at
      FROM clients c
      LEFT JOIN (
        SELECT m1.*
        FROM messages m1
        INNER JOIN (
          SELECT wa_id, MAX(id) AS max_id
          FROM messages
          GROUP BY wa_id
        ) latest
          ON latest.wa_id = m1.wa_id
         AND latest.max_id = m1.id
      ) last_message
        ON last_message.wa_id = c.wa_id
      ORDER BY COALESCE(last_message.created_at, c.updated_at, c.created_at) DESC, c.id DESC`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

function getMessagesByClient(wa_id) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT
        id,
        wa_id,
        direction,
        message_type,
        message_text,
        media_id,
        file_path,
        wa_message_id,
        created_at
      FROM messages
      WHERE wa_id = ?
      ORDER BY id ASC`,
      [wa_id],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

function createClientIfNotExists(wa_id, profile_name = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO clients (wa_id, profile_name, stage, question_step, status)
       VALUES (?, ?, 'stage_1', NULL, 'active')`,
      [wa_id, profile_name],
      function (err) {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
}

function updateClient(wa_id, updates) {
  return new Promise((resolve, reject) => {
    const keys = Object.keys(updates);
    if (keys.length === 0) return resolve(true);

    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => updates[k]);

    db.run(
      `UPDATE clients
       SET ${setClause}, updated_at = CURRENT_TIMESTAMP
       WHERE wa_id = ?`,
      [...values, wa_id],
      function (err) {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
}

function discardClientApplication(wa_id, profileName = null) {
  return updateClient(wa_id, {
    profile_name: profileName,
    stage: "stage_1",
    question_step: null,
    status: "active",
    pending_action: null,
    expected_document: null,
    full_name: null,
    age: null,
    personal_phone_confirmed: null,
    personal_phone_number: null,
    marital_status: null,
    debt_with_lender: null,
    job_name: null,
    income_type: null,
    income_proof_available: null,
    work_address: null,
    work_phone: null,
    years_at_job: null,
    home_address: null,
    average_income: null,
    income_frequency: null,
    extra_household_income_available: null,
    extra_household_income_details: null,
    current_debt_payments: null,
    years_at_home: null,
    home_owner_name: null,
    address_proof_name: null,
    score: 0,
    ine_front_path: null,
    ine_back_path: null,
    proof_of_address_path: null,
    house_front_path: null,
    income_proof_path: null,
    advisor_notified: 0,
    advisor_contacted: 0
  });
}

function saveMessage({
  wa_id,
  direction,
  message_type,
  message_text = null,
  media_id = null,
  file_path = null,
  wa_message_id = null
}) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO messages
      (wa_id, direction, message_type, message_text, media_id, file_path, wa_message_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [wa_id, direction, message_type, message_text, media_id, file_path, wa_message_id],
      function (err) {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
}

function resetToStage1(wa_id, profileName = null) {
  return updateClient(wa_id, {
    profile_name: profileName,
    stage: "stage_1",
    question_step: null,
    status: "active",
    pending_action: null,
    expected_document: null
  });
}

function moveToStage2(wa_id) {
  return updateClient(wa_id, {
    stage: "stage_2",
    question_step: null,
    status: "active"
  });
}

function startQualificationFlow(wa_id) {
  return updateClient(wa_id, {
    stage: "section_1",
    question_step: "q1_full_name",
    status: "active"
  });
}

function moveToDocumentsStage(wa_id) {
  return updateClient(wa_id, {
    stage: "awaiting_documents",
    question_step: null,
    status: "pending_documents",
    expected_document: "ine_front"
  });
}

function markNotInterested(wa_id) {
  return updateClient(wa_id, {
    stage: "closed",
    question_step: null,
    status: "not_interested",
    expected_document: null
  });
}

function closeDatabase() {
  return new Promise((resolve) => {
    db.close((err) => {
      if (err) console.error("Error closing database:", err);
      resolve();
    });
  });
}

module.exports = {
  getClient,
  getClientsWithLastMessage,
  getMessagesByClient,
  createClientIfNotExists,
  updateClient,
  discardClientApplication,
  saveMessage,
  resetToStage1,
  moveToStage2,
  startQualificationFlow,
  moveToDocumentsStage,
  markNotInterested,
  closeDatabase
};
