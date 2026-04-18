const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

if (!fs.existsSync("./data")) fs.mkdirSync("./data", { recursive: true });

const db = new sqlite3.Database("./data/bot.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT UNIQUE,
      profile_name TEXT,

      stage TEXT DEFAULT 'stage_1',
      question_step TEXT,
      status TEXT DEFAULT 'active',

      full_name TEXT,
      age TEXT,
      personal_phone_confirmed TEXT,
      personal_phone_number TEXT,
      marital_status TEXT,
      debt_with_lender TEXT,

      job_name TEXT,
      income_proof_available TEXT,
      work_address TEXT,
      work_phone TEXT,
      years_at_job TEXT,
      home_address TEXT,
      average_income TEXT,
      years_at_home TEXT,
      home_owner_name TEXT,
      address_proof_name TEXT,

      score INTEGER DEFAULT 0,

      pending_action TEXT,
      expected_document TEXT,
      ine_front_path TEXT,
      ine_back_path TEXT,
      proof_of_address_path TEXT,
      house_front_path TEXT,
      income_proof_path TEXT,

      advisor_notified INTEGER DEFAULT 0,

      advisor_contacted INTEGER DEFAULT 0,

      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT,
      direction TEXT,
      message_type TEXT,
      message_text TEXT,
      media_id TEXT,
      file_path TEXT,
      wa_message_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.all(`PRAGMA table_info(clients)`, (err, rows) => {
    if (err) throw err;

    const existingColumns = rows.map((row) => row.name);

    const expectedColumns = [
      { name: "work_address", sql: "TEXT" },
      { name: "work_phone", sql: "TEXT" },
      { name: "score", sql: "INTEGER DEFAULT 0" },
      { name: "personal_phone_number", sql: "TEXT" },
      { name: "pending_action", sql: "TEXT" },
      { name: "advisor_contacted", sql: "INTEGER DEFAULT 0" }
    ];

    for (const column of expectedColumns) {
      if (!existingColumns.includes(column.name)) {
        db.run(`ALTER TABLE clients ADD COLUMN ${column.name} ${column.sql}`);
      }
    }

    db.close();
  });
});
console.log("Base de datos lista.");
