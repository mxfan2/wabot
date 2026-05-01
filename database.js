const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

// Initialize database
if (!fs.existsSync("./data")) fs.mkdirSync("./data", { recursive: true });
const db = new sqlite3.Database("./data/bot.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      principal_cents INTEGER NOT NULL,
      total_payable_cents INTEGER NOT NULL,
      weekly_payment_cents INTEGER NOT NULL,
      term_weeks INTEGER NOT NULL,
      amount_paid_cents INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'MXN',
      status TEXT DEFAULT 'active',
      disbursement_date TEXT,
      first_due_date TEXT,
      notes TEXT,
      conekta_customer_id TEXT,
      conekta_spei_source_id TEXT,
      conekta_spei_clabe TEXT,
      conekta_spei_bank TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL,
      wa_id TEXT NOT NULL,
      installment_number INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      amount_due_cents INTEGER NOT NULL,
      amount_paid_cents INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'MXN',
      status TEXT DEFAULT 'pending',
      provider_order_id TEXT,
      paid_at INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loan_id, installment_number)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      loan_id INTEGER,
      installment_id INTEGER,
      provider TEXT NOT NULL,
      provider_order_id TEXT NOT NULL UNIQUE,
      provider_charge_id TEXT,
      amount_cents INTEGER NOT NULL,
      currency TEXT DEFAULT 'MXN',
      status TEXT DEFAULT 'pending',
      clabe TEXT,
      bank TEXT,
      expires_at INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_event_id TEXT NOT NULL UNIQUE,
      provider_order_id TEXT,
      provider_charge_id TEXT,
      wa_id TEXT,
      amount_cents INTEGER,
      currency TEXT DEFAULT 'MXN',
      paid_at INTEGER,
      status TEXT DEFAULT 'received',
      raw_payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

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
    { name: "current_debt_payments", sql: "TEXT" },
    { name: "conekta_customer_id", sql: "TEXT" },
    { name: "conekta_spei_source_id", sql: "TEXT" },
    { name: "conekta_spei_clabe", sql: "TEXT" },
    { name: "conekta_spei_bank", sql: "TEXT" },
    { name: "archived_at", sql: "DATETIME" },
    { name: "deleted_at", sql: "DATETIME" }
  ];

  for (const column of expectedColumns) {
    if (!existingColumns.includes(column.name)) {
      db.run(`ALTER TABLE clients ADD COLUMN ${column.name} ${column.sql}`);
    }
  }
});

db.all(`PRAGMA table_info(payment_orders)`, (err, rows) => {
  if (err) {
    console.error("Error loading payment_orders schema:", err);
    return;
  }

  const existingColumns = rows.map((row) => row.name);
  const expectedColumns = [
    { name: "loan_id", sql: "INTEGER" },
    { name: "installment_id", sql: "INTEGER" },
    { name: "checkout_id", sql: "TEXT" },
    { name: "checkout_url", sql: "TEXT" },
    { name: "checkout_status", sql: "TEXT" },
    { name: "reusable_clabe", sql: "INTEGER DEFAULT 0" }
  ];

  for (const column of expectedColumns) {
    if (!existingColumns.includes(column.name)) {
      db.run(`ALTER TABLE payment_orders ADD COLUMN ${column.name} ${column.sql}`);
    }
  }
});

db.all(`PRAGMA table_info(payment_transactions)`, (err, rows) => {
  if (err) {
    console.error("Error loading payment_transactions schema:", err);
    return;
  }

  const existingColumns = rows.map((row) => row.name);
  const expectedColumns = [
    { name: "loan_id", sql: "INTEGER" },
    { name: "installment_id", sql: "INTEGER" },
    { name: "applied_amount_cents", sql: "INTEGER" }
  ];

  for (const column of expectedColumns) {
    if (!existingColumns.includes(column.name)) {
      db.run(`ALTER TABLE payment_transactions ADD COLUMN ${column.name} ${column.sql}`);
    }
  }
});

// =========================
// DATABASE OPERATIONS
// =========================

function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

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
        c.archived_at,
        c.deleted_at,
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
      WHERE c.deleted_at IS NULL
      ORDER BY COALESCE(last_message.created_at, c.updated_at, c.created_at) DESC, c.id DESC`,
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

function createOrRestoreClient(wa_id, profile_name = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO clients (wa_id, profile_name, stage, question_step, status, archived_at, deleted_at)
       VALUES (?, ?, 'stage_1', NULL, 'active', NULL, NULL)
       ON CONFLICT(wa_id) DO UPDATE SET
         profile_name = COALESCE(excluded.profile_name, clients.profile_name),
         archived_at = NULL,
         deleted_at = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [wa_id, profile_name],
      function (err) {
        if (err) reject(err);
        else resolve(true);
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
      `INSERT INTO clients (wa_id, profile_name, stage, question_step, status, archived_at, deleted_at)
       VALUES (?, ?, 'stage_1', NULL, 'active', NULL, NULL)
       ON CONFLICT(wa_id) DO UPDATE SET
         profile_name = COALESCE(excluded.profile_name, clients.profile_name),
         archived_at = NULL,
         deleted_at = NULL,
         updated_at = CURRENT_TIMESTAMP`,
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

function archiveClient(wa_id) {
  return updateClient(wa_id, {
    archived_at: new Date().toISOString(),
    status: "archived"
  });
}

function unarchiveClient(wa_id) {
  return updateClient(wa_id, {
    archived_at: null,
    status: "active"
  });
}

function softDeleteClient(wa_id) {
  return updateClient(wa_id, {
    deleted_at: new Date().toISOString(),
    archived_at: new Date().toISOString(),
    status: "deleted"
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

function addDays(dateText, days) {
  const date = dateText ? new Date(`${dateText}T00:00:00Z`) : new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createLoanWithSchedule(input) {
  const principalCents = Number(input.principal_cents);
  const totalPayableCents = Number(input.total_payable_cents);
  const weeklyPaymentCents = Number(input.weekly_payment_cents);
  const termWeeks = Number(input.term_weeks);

  if (!input.wa_id || !principalCents || !totalPayableCents || !weeklyPaymentCents || !termWeeks) {
    throw new Error("Missing required loan fields");
  }

  await runQuery("BEGIN IMMEDIATE TRANSACTION");
  try {
    const loanResult = await runQuery(
      `INSERT INTO loans
        (wa_id, principal_cents, total_payable_cents, weekly_payment_cents, term_weeks, currency, status, disbursement_date, first_due_date, notes, conekta_customer_id, conekta_spei_source_id, conekta_spei_clabe, conekta_spei_bank)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.wa_id,
        principalCents,
        totalPayableCents,
        weeklyPaymentCents,
        termWeeks,
        input.currency || "MXN",
        input.disbursement_date || new Date().toISOString().slice(0, 10),
        input.first_due_date,
        input.notes || null,
        input.conekta_customer_id || null,
        input.conekta_spei_source_id || null,
        input.conekta_spei_clabe || null,
        input.conekta_spei_bank || null
      ]
    );

    const loanId = loanResult.lastID;
    for (let i = 1; i <= termWeeks; i += 1) {
      const dueDate = addDays(input.first_due_date, (i - 1) * 7);
      const amountDue = i === termWeeks
        ? totalPayableCents - (weeklyPaymentCents * (termWeeks - 1))
        : weeklyPaymentCents;

      await runQuery(
        `INSERT INTO payment_schedule
          (loan_id, wa_id, installment_number, due_date, amount_due_cents, currency, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [loanId, input.wa_id, i, dueDate, amountDue, input.currency || "MXN"]
      );
    }

    await updateClient(input.wa_id, {
      stage: "loan_active",
      status: "loan_active",
      advisor_contacted: 1
    });

    await runQuery("COMMIT");
    return getLoanDetail(loanId);
  } catch (error) {
    await runQuery("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function getLoanDetail(loanId) {
  const loan = await getQuery(`SELECT * FROM loans WHERE id = ?`, [loanId]);
  if (!loan) return null;

  const schedule = await allQuery(
    `SELECT * FROM payment_schedule WHERE loan_id = ? ORDER BY installment_number ASC`,
    [loanId]
  );

  return { loan, schedule };
}

async function getActiveLoanByWaId(waId) {
  return getQuery(
    `SELECT * FROM loans
     WHERE wa_id = ?
       AND status = 'active'
     ORDER BY id DESC
     LIMIT 1`,
    [waId]
  );
}

async function updateLoanEditableFields(loanId, updates = {}) {
  const allowed = [
    "principal_cents",
    "total_payable_cents",
    "weekly_payment_cents",
    "term_weeks",
    "amount_paid_cents",
    "status",
    "disbursement_date",
    "first_due_date",
    "notes"
  ];
  const keys = allowed.filter((key) => Object.prototype.hasOwnProperty.call(updates, key));
  if (!keys.length) return getLoanDetail(loanId);

  const setClause = keys.map((key) => `${key} = ?`).join(", ");
  await runQuery(
    `UPDATE loans SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...keys.map((key) => updates[key]), loanId]
  );
  return getLoanDetail(loanId);
}

async function updateInstallmentEditableFields(installmentId, updates = {}) {
  const allowed = ["due_date", "amount_due_cents", "amount_paid_cents", "status", "paid_at"];
  const keys = allowed.filter((key) => Object.prototype.hasOwnProperty.call(updates, key));
  if (!keys.length) {
    return getQuery(`SELECT * FROM payment_schedule WHERE id = ?`, [installmentId]);
  }

  const setClause = keys.map((key) => `${key} = ?`).join(", ");
  await runQuery(
    `UPDATE payment_schedule SET ${setClause}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [...keys.map((key) => updates[key]), installmentId]
  );
  return getQuery(`SELECT * FROM payment_schedule WHERE id = ?`, [installmentId]);
}

async function updateLoanConektaInfo(loanId, updates) {
  await runQuery(
    `UPDATE loans
     SET conekta_customer_id = COALESCE(?, conekta_customer_id),
         conekta_spei_source_id = COALESCE(?, conekta_spei_source_id),
         conekta_spei_clabe = COALESCE(?, conekta_spei_clabe),
         conekta_spei_bank = COALESCE(?, conekta_spei_bank),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      updates.conekta_customer_id || null,
      updates.conekta_spei_source_id || null,
      updates.conekta_spei_clabe || null,
      updates.conekta_spei_bank || null,
      loanId
    ]
  );
}

async function linkInstallmentPaymentOrder(installmentId, providerOrderId) {
  await runQuery(
    `UPDATE payment_schedule
     SET provider_order_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [providerOrderId, installmentId]
  );
}

async function listErpEligibleClients() {
  return allQuery(
    `SELECT c.*
     FROM clients c
     LEFT JOIN loans l
       ON l.wa_id = c.wa_id
      AND l.status IN ('active', 'paid')
     WHERE l.id IS NULL
       AND (
         c.stage IN ('awaiting_documents', 'under_review', 'contacted')
         OR c.status IN ('pending_documents', 'documents_uploaded', 'under_review', 'advisor_contacted')
       )
     ORDER BY c.score DESC, c.updated_at DESC`
  );
}

async function listErpLoans() {
  return allQuery(
    `SELECT
       l.*,
       c.profile_name,
       c.full_name,
       c.score,
       MIN(CASE WHEN ps.status != 'paid' THEN ps.due_date END) AS next_due_date,
       SUM(CASE WHEN ps.status != 'paid' AND ps.due_date < date('now') THEN 1 ELSE 0 END) AS overdue_count,
       SUM(CASE WHEN ps.status != 'paid' AND ps.due_date < date('now') THEN ps.amount_due_cents - ps.amount_paid_cents ELSE 0 END) AS overdue_cents,
       SUM(CASE WHEN ps.status != 'paid' THEN ps.amount_due_cents - ps.amount_paid_cents ELSE 0 END) AS balance_cents
     FROM loans l
     LEFT JOIN clients c ON c.wa_id = l.wa_id
     LEFT JOIN payment_schedule ps ON ps.loan_id = l.id
     GROUP BY l.id
     ORDER BY l.status = 'active' DESC, COALESCE(next_due_date, l.created_at) ASC`
  );
}

async function listErpPayments() {
  return allQuery(
    `SELECT
       ps.*,
       l.total_payable_cents,
       c.full_name,
       c.profile_name,
       po.checkout_url,
       po.clabe,
       po.bank
     FROM payment_schedule ps
     INNER JOIN loans l ON l.id = ps.loan_id
     LEFT JOIN clients c ON c.wa_id = ps.wa_id
     LEFT JOIN payment_orders po ON po.provider_order_id = ps.provider_order_id
     ORDER BY ps.due_date ASC, ps.installment_number ASC`
  );
}

async function getErpSummary() {
  const loanSummary = await getQuery(
    `SELECT
       COUNT(*) AS active_loans,
       COALESCE(SUM(total_payable_cents - amount_paid_cents), 0) AS active_balance_cents
     FROM loans
     WHERE status = 'active'`
  );

  const scheduleSummary = await getQuery(
    `SELECT
       COALESCE(SUM(CASE WHEN status != 'paid' AND due_date = date('now') THEN amount_due_cents - amount_paid_cents ELSE 0 END), 0) AS due_today_cents,
       COUNT(CASE WHEN status != 'paid' AND due_date = date('now') THEN 1 END) AS due_today_count,
       COALESCE(SUM(CASE WHEN status != 'paid' AND due_date < date('now') THEN amount_due_cents - amount_paid_cents ELSE 0 END), 0) AS overdue_cents,
       COUNT(CASE WHEN status != 'paid' AND due_date < date('now') THEN 1 END) AS overdue_count
     FROM payment_schedule`
  );

  const unmatched = await getQuery(
    `SELECT COUNT(*) AS unmatched_count
     FROM payment_transactions
     WHERE status = 'unmatched_order'`
  );

  return {
    active_loans: loanSummary?.active_loans || 0,
    active_balance_cents: loanSummary?.active_balance_cents || 0,
    due_today_cents: scheduleSummary?.due_today_cents || 0,
    due_today_count: scheduleSummary?.due_today_count || 0,
    overdue_cents: scheduleSummary?.overdue_cents || 0,
    overdue_count: scheduleSummary?.overdue_count || 0,
    unmatched_count: unmatched?.unmatched_count || 0
  };
}

async function applyPaymentToLoan({ loanId, installmentId, amountCents, paidAt }) {
  let remaining = Number(amountCents || 0);
  if (!loanId || remaining <= 0) return { appliedAmountCents: 0, installmentId: installmentId || null };

  const candidates = [];
  if (installmentId) {
    const direct = await getQuery(`SELECT * FROM payment_schedule WHERE id = ? AND loan_id = ?`, [installmentId, loanId]);
    if (direct) candidates.push(direct);
  }

  const openInstallments = await allQuery(
    `SELECT * FROM payment_schedule
     WHERE loan_id = ?
       AND status != 'paid'
       AND (? IS NULL OR id != ?)
     ORDER BY due_date ASC, installment_number ASC`,
    [loanId, installmentId || null, installmentId || null]
  );
  candidates.push(...openInstallments);

  let applied = 0;
  let firstAppliedInstallmentId = installmentId || null;

  for (const installment of candidates) {
    if (remaining <= 0) break;
    const pending = Math.max(0, Number(installment.amount_due_cents || 0) - Number(installment.amount_paid_cents || 0));
    if (pending <= 0) continue;

    const amountForInstallment = Math.min(remaining, pending);
    const newPaid = Number(installment.amount_paid_cents || 0) + amountForInstallment;
    const newStatus = newPaid >= Number(installment.amount_due_cents || 0) ? "paid" : "partial";

    await runQuery(
      `UPDATE payment_schedule
       SET amount_paid_cents = ?,
           status = ?,
           paid_at = CASE WHEN ? = 'paid' THEN COALESCE(?, strftime('%s','now')) ELSE paid_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newPaid, newStatus, newStatus, paidAt || null, installment.id]
    );

    remaining -= amountForInstallment;
    applied += amountForInstallment;
    if (!firstAppliedInstallmentId) firstAppliedInstallmentId = installment.id;
  }

  await runQuery(
    `UPDATE loans
     SET amount_paid_cents = amount_paid_cents + ?,
         status = CASE WHEN amount_paid_cents + ? >= total_payable_cents THEN 'paid' ELSE status END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [applied, applied, loanId]
  );

  return { appliedAmountCents: applied, installmentId: firstAppliedInstallmentId };
}

function createPaymentOrder(order) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO payment_orders
        (wa_id, loan_id, installment_id, provider, provider_order_id, provider_charge_id, amount_cents, currency, status, clabe, bank, expires_at, checkout_id, checkout_url, checkout_status, reusable_clabe, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_order_id) DO UPDATE SET
        loan_id = excluded.loan_id,
        installment_id = excluded.installment_id,
        provider_charge_id = excluded.provider_charge_id,
        amount_cents = excluded.amount_cents,
        currency = excluded.currency,
        status = excluded.status,
        clabe = excluded.clabe,
        bank = excluded.bank,
        expires_at = excluded.expires_at,
        checkout_id = excluded.checkout_id,
        checkout_url = excluded.checkout_url,
        checkout_status = excluded.checkout_status,
        reusable_clabe = excluded.reusable_clabe,
        metadata = excluded.metadata,
        updated_at = CURRENT_TIMESTAMP`,
      [
        order.wa_id,
        order.loan_id || null,
        order.installment_id || null,
        order.provider,
        order.provider_order_id,
        order.provider_charge_id || null,
        order.amount_cents,
        order.currency || "MXN",
        order.status || "pending",
        order.clabe || null,
        order.bank || null,
        order.expires_at || null,
        order.checkout_id || null,
        order.checkout_url || null,
        order.checkout_status || null,
        order.reusable_clabe ? 1 : 0,
        order.metadata ? JSON.stringify(order.metadata) : null
      ],
      function (err) {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
}

function getPaymentOrderByProviderOrderId(provider, providerOrderId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM payment_orders WHERE provider = ? AND provider_order_id = ?`,
      [provider, providerOrderId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

function markPaymentOrderPaid(provider, providerOrderId, updates = {}) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE payment_orders
       SET status = 'paid',
           provider_charge_id = COALESCE(?, provider_charge_id),
           amount_cents = COALESCE(?, amount_cents),
           currency = COALESCE(?, currency),
           updated_at = CURRENT_TIMESTAMP
       WHERE provider = ? AND provider_order_id = ?`,
      [
        updates.provider_charge_id || null,
        updates.amount_cents || null,
        updates.currency || null,
        provider,
        providerOrderId
      ],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes);
      }
    );
  });
}

function savePaymentTransaction(transaction) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO payment_transactions
        (provider, provider_event_id, provider_order_id, provider_charge_id, wa_id, loan_id, installment_id, amount_cents, applied_amount_cents, currency, paid_at, status, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transaction.provider,
        transaction.provider_event_id,
        transaction.provider_order_id || null,
        transaction.provider_charge_id || null,
        transaction.wa_id || null,
        transaction.loan_id || null,
        transaction.installment_id || null,
        transaction.amount_cents || null,
        transaction.applied_amount_cents || null,
        transaction.currency || "MXN",
        transaction.paid_at || null,
        transaction.status || "received",
        transaction.raw_payload ? JSON.stringify(transaction.raw_payload) : null
      ],
      function (err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      }
    );
  });
}

function updatePaymentTransactionApplication(provider, providerEventId, updates = {}) {
  return runQuery(
    `UPDATE payment_transactions
     SET loan_id = COALESCE(?, loan_id),
         installment_id = COALESCE(?, installment_id),
         applied_amount_cents = COALESCE(?, applied_amount_cents),
         status = COALESCE(?, status)
     WHERE provider = ? AND provider_event_id = ?`,
    [
      updates.loan_id || null,
      updates.installment_id || null,
      updates.applied_amount_cents || null,
      updates.status || null,
      provider,
      providerEventId
    ]
  );
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
  createOrRestoreClient,
  createClientIfNotExists,
  updateClient,
  archiveClient,
  unarchiveClient,
  softDeleteClient,
  discardClientApplication,
  saveMessage,
  resetToStage1,
  moveToStage2,
  startQualificationFlow,
  moveToDocumentsStage,
  markNotInterested,
  createLoanWithSchedule,
  getLoanDetail,
  getActiveLoanByWaId,
  updateLoanEditableFields,
  updateInstallmentEditableFields,
  updateLoanConektaInfo,
  linkInstallmentPaymentOrder,
  listErpEligibleClients,
  listErpLoans,
  listErpPayments,
  getErpSummary,
  applyPaymentToLoan,
  createPaymentOrder,
  getPaymentOrderByProviderOrderId,
  markPaymentOrderPaid,
  savePaymentTransaction,
  updatePaymentTransactionApplication,
  closeDatabase
};
