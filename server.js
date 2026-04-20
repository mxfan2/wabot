require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");

const { CONFIG, MESSAGES, KEYWORDS, DOCUMENTS } = require("./config");
const { fuzzyMatch, shouldRemind } = require("./utils");
const { sendTextMessage, downloadMedia, notifyAdvisor } = require("./whatsapp");
const {
  getClient,
  getClientsWithLastMessage,
  getMessagesByClient,
  createClientIfNotExists,
  updateClient,
  saveMessage,
  resetToStage1,
  discardClientApplication,
  closeDatabase
} = require("./database");
const {
  handleStage1,
  handleStage2,
  handleQualificationFlow,
  handleDocumentsStage,
  handleUnderReview,
  handleContacted,
  handleClosed,
  getNextDocumentKey,
  getDocumentFieldName,
  appendDocumentValue,
  hasUsableDocumentValue,
  isDoneCommand,
  isSkipCommand,
  remindCurrentStep,
  resolvePendingAction,
  beginNewApplicationConfirmation,
  advanceDocumentsFlow,
  sendStatusMessage,
  QUESTION_FLOW,
  getStoredDocumentValues,
  getQuestionIndexByStep,
  getDocumentProgress
} = require("./flow");

const app = express();
app.use(express.json({ limit: "20mb" }));

// Create runtime folders up front so media downloads and local data storage
// do not fail later when the first request arrives.
if (!fs.existsSync("./downloads")) fs.mkdirSync("./downloads", { recursive: true });
if (!fs.existsSync("./data")) fs.mkdirSync("./data", { recursive: true });

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const QUALIFICATION_FIELDS = [
  { field: "full_name", label: "Nombre completo" },
  { field: "age", label: "Edad" },
  { field: "personal_phone_confirmed", label: "¿Este es su celular personal?" },
  { field: "personal_phone_number", label: "Celular personal" },
  { field: "marital_status", label: "Estado civil" },
  { field: "debt_with_lender", label: "¿Tiene deuda con prestamista?" },
  { field: "job_name", label: "Trabajo / empresa" },
  { field: "income_proof_available", label: "¿Tiene comprobante de ingresos?" },
  { field: "work_address", label: "Dirección de trabajo" },
  { field: "work_phone", label: "Teléfono de trabajo" },
  { field: "years_at_job", label: "Antigüedad en el trabajo" },
  { field: "home_address", label: "Dirección de domicilio" },
  { field: "average_income", label: "Ingreso promedio" },
  { field: "years_at_home", label: "Tiempo en domicilio" },
  { field: "home_owner_name", label: "Titular de la vivienda" },
  { field: "address_proof_name", label: "Titular del comprobante de domicilio" }
];

const DOCUMENT_LABELS = {
  ine_front: "INE frente",
  ine_back: "INE reverso",
  proof_of_address: "Comprobante de domicilio",
  house_front: "Fachada del domicilio",
  income_proof: "Comprobante de ingresos"
};

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "Pendiente";
  if (value === "OMITIDO") return "Omitido";
  if (value === "SKIPPED") return "Omitido";
  return String(value);
}

function buildQualificationSummary(client) {
  const answers = QUALIFICATION_FIELDS.map(({ field, label }) => ({
    field,
    label,
    value: client[field],
    displayValue: formatValue(client[field]),
    answered: client[field] !== null && client[field] !== undefined && client[field] !== ""
  }));

  const answeredCount = answers.filter((item) => item.answered).length;
  const totalCount = answers.length;
  const currentIndex = getQuestionIndexByStep(client.question_step);
  const currentQuestion = currentIndex >= 0 ? QUESTION_FLOW[currentIndex] : null;
  const complete = client.stage === "awaiting_documents"
    || client.stage === "under_review"
    || client.stage === "contacted"
    || client.status === "pending_documents"
    || client.status === "documents_uploaded"
    || client.status === "under_review"
    || client.status === "advisor_contacted";

  return {
    complete,
    answeredCount,
    totalCount,
    currentStep: client.question_step || null,
    currentQuestion: currentQuestion ? currentQuestion.question.split("\n")[0] : null,
    answers
  };
}

function buildDocumentSummary(client) {
  const items = DOCUMENTS.ORDER.map((docKey) => {
    const fieldName = DOCUMENTS.FIELDS[docKey];
    const values = getStoredDocumentValues(client[fieldName]);
    const usableValues = values.filter((value) => value && value !== "SKIPPED");
    const skipped = values.includes("SKIPPED");

    return {
      key: docKey,
      label: DOCUMENT_LABELS[docKey] || docKey,
      prompt: DOCUMENTS.PROMPTS[docKey] || "",
      status: usableValues.length > 0 ? "uploaded" : (skipped ? "skipped" : "pending"),
      files: usableValues.map((filePath) => ({
        name: path.basename(filePath),
        path: filePath,
        urlPath: String(filePath).replace(/\\/g, "/"),
        isImage: /\.(png|jpe?g|gif|webp|bmp)$/i.test(filePath),
        isPdf: /\.pdf$/i.test(filePath)
      }))
    };
  });

  const progress = getDocumentProgress(client);
  return {
    completed: progress.completed,
    total: progress.total,
    expectedDocument: client.expected_document || null,
    items
  };
}

function buildClientOverview(client) {
  const qualification = buildQualificationSummary(client);
  const documents = buildDocumentSummary(client);
  const displayName = client.full_name || client.profile_name || client.wa_id;

  return {
    displayName,
    quickStatus: qualification.complete ? "qualification_complete" : (client.stage === "section_1" || client.stage === "section_2" ? "qualification_incomplete" : client.stage || "unknown"),
    qualification,
    documents
  };
}

function renderDashboardPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Loan Ops Dashboard</title>
  <style>
    :root {
      --bg: #f4f0e8;
      --panel: rgba(255, 252, 247, 0.95);
      --panel-alt: #f6ede0;
      --panel-accent: #f0f7f4;
      --line: #dbcdb8;
      --text: #2f2419;
      --muted: #75624f;
      --accent: #0f766e;
      --accent-strong: #115e59;
      --accent-soft: #def2ed;
      --warn: #b45309;
      --warn-soft: #fff1df;
      --danger: #b91c1c;
      --danger-soft: #fee8e8;
      --success: #166534;
      --success-soft: #e5f7ea;
      --inbound: #efe4d3;
      --outbound: #d8f2eb;
      --shadow: 0 22px 48px rgba(75, 56, 37, 0.11);
      --radius: 20px;
      --font-ui: "Segoe UI", "Trebuchet MS", sans-serif;
      --font-display: Georgia, "Times New Roman", serif;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font-ui);
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 25%),
        radial-gradient(circle at bottom right, rgba(180, 83, 9, 0.12), transparent 28%),
        linear-gradient(180deg, #f8f4ec 0%, var(--bg) 100%);
      min-height: 100vh;
    }

    .shell {
      display: flex;
      flex-direction: column;
      gap: 18px;
      min-height: 100vh;
      padding: 18px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid rgba(217, 204, 184, 0.9);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
      min-height: 0;
    }

    .hero {
      padding: 22px;
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: end;
      background:
        radial-gradient(circle at top left, rgba(15, 118, 110, 0.12), transparent 30%),
        radial-gradient(circle at bottom right, rgba(180, 83, 9, 0.12), transparent 32%),
        linear-gradient(135deg, rgba(255,255,255,0.68), rgba(246,237,224,0.92));
    }

    .hero-copy {
      max-width: 720px;
    }

    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
    }

    h1, h2, h3 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 700;
      line-height: 1.05;
    }

    h1 { font-size: 28px; }
    h2 { font-size: 26px; }
    h3 { font-size: 22px; }

    .hero-subtitle, .section-subtitle, .chat-subtitle {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
    }

    .hero-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .layout {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 18px;
      min-height: 0;
      flex: 1;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar-header, .detail-header {
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--line);
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .summary-card {
      background: rgba(255,255,255,0.72);
      border: 1px solid rgba(217, 204, 184, 0.9);
      border-radius: 18px;
      padding: 14px 16px;
    }

    .summary-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    .summary-value {
      margin-top: 6px;
      font-size: 28px;
      font-weight: 700;
      color: var(--text);
    }

    .summary-foot {
      margin-top: 6px;
      font-size: 13px;
      color: var(--muted);
    }

    .search-wrap {
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, rgba(255,255,255,0.8), rgba(247,241,231,0.8));
    }

    .search {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 12px 14px;
      background: #fff;
      color: var(--text);
      font: inherit;
      outline: none;
    }

    .queue-section {
      padding: 14px 12px 16px;
      border-bottom: 1px solid rgba(217, 204, 184, 0.7);
    }

    .queue-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      padding: 0 6px 10px;
    }

    .queue-title {
      font-weight: 700;
      font-size: 14px;
    }

    .queue-count {
      padding: 4px 8px;
      border-radius: 999px;
      background: var(--panel-alt);
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
    }

    .clients {
      overflow: auto;
      padding: 0 8px 6px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 34vh;
    }

    .client-item {
      border: 1px solid transparent;
      border-radius: 16px;
      padding: 12px;
      background: transparent;
      cursor: pointer;
      transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
    }

    .client-item:hover {
      transform: translateY(-1px);
      background: rgba(247, 241, 231, 0.9);
      border-color: var(--line);
    }

    .client-item.active {
      background: linear-gradient(135deg, var(--accent-soft), #f8fffd);
      border-color: rgba(15, 118, 110, 0.25);
    }

    .client-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: baseline;
    }

    .client-name {
      font-weight: 700;
      font-size: 15px;
    }

    .client-phone {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
    }

    .client-meta {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }

    .client-preview {
      margin-top: 8px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    .detail {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .detail-header-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: start;
    }

    .pill-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }

    .pill {
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--panel-alt);
      color: var(--muted);
      font-size: 12px;
      border: 1px solid var(--line);
    }

    .detail-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .button {
      border: 1px solid rgba(15, 118, 110, 0.25);
      background: linear-gradient(135deg, #f9fffd, #e8f8f4);
      color: var(--accent);
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
    }

    .button.primary {
      background: linear-gradient(135deg, #0f766e, #115e59);
      color: #fff;
      border-color: rgba(17, 94, 89, 0.7);
    }

    .detail-body {
      flex: 1;
      overflow: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 18px;
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 18px;
      min-width: 0;
    }

    .section-card {
      border: 1px solid rgba(217, 204, 184, 0.95);
      border-radius: 18px;
      padding: 16px;
      background: linear-gradient(180deg, rgba(255,255,255,0.85), rgba(247,241,231,0.9));
    }

    .mini-stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .mini-stat {
      padding: 12px;
      border-radius: 16px;
      background: rgba(255,255,255,0.76);
      border: 1px solid rgba(217, 204, 184, 0.9);
    }

    .mini-stat strong {
      display: block;
      font-size: 22px;
      margin-top: 6px;
    }

    .answer-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-top: 16px;
    }

    .answer-item {
      border: 1px solid rgba(217, 204, 184, 0.9);
      border-radius: 16px;
      padding: 12px;
      background: rgba(255,255,255,0.72);
    }

    .answer-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }

    .answer-value {
      margin-top: 8px;
      font-size: 14px;
      line-height: 1.45;
      word-break: break-word;
    }

    .docs-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 16px;
    }

    .doc-card {
      border-radius: 16px;
      border: 1px solid rgba(217, 204, 184, 0.9);
      padding: 12px;
      background: rgba(255,255,255,0.78);
    }

    .doc-card.uploaded { background: var(--success-soft); }
    .doc-card.pending { background: rgba(255,255,255,0.78); }
    .doc-card.skipped { background: var(--warn-soft); }

    .doc-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: start;
    }

    .status-chip {
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      border: 1px solid transparent;
      white-space: nowrap;
    }

    .status-chip.uploaded {
      background: rgba(22, 101, 52, 0.12);
      border-color: rgba(22, 101, 52, 0.2);
      color: var(--success);
    }

    .status-chip.pending {
      background: rgba(117, 98, 79, 0.08);
      border-color: rgba(117, 98, 79, 0.12);
      color: var(--muted);
    }

    .status-chip.skipped {
      background: rgba(180, 83, 9, 0.12);
      border-color: rgba(180, 83, 9, 0.18);
      color: var(--warn);
    }

    .doc-files {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    .doc-link {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255,255,255,0.82);
      border: 1px solid rgba(217, 204, 184, 0.9);
      color: var(--accent-strong);
      text-decoration: none;
      font-size: 13px;
    }

    .doc-thumb {
      width: 100%;
      max-height: 180px;
      object-fit: cover;
      border-radius: 12px;
      margin-top: 12px;
      border: 1px solid rgba(217, 204, 184, 0.9);
    }

    .composer {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .composer textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 14px;
      font: inherit;
      background: #fff;
      color: var(--text);
    }

    .composer-footer {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }

    .helper-text {
      font-size: 13px;
      color: var(--muted);
    }

    .flash {
      padding: 10px 12px;
      border-radius: 14px;
      font-size: 13px;
    }

    .flash.ok {
      background: var(--success-soft);
      color: var(--success);
      border: 1px solid rgba(22, 101, 52, 0.16);
    }

    .flash.error {
      background: var(--danger-soft);
      color: var(--danger);
      border: 1px solid rgba(185, 28, 28, 0.14);
    }

    .messages {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 520px;
      overflow: auto;
      margin-top: 16px;
      padding: 4px;
      background:
        linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0)),
        repeating-linear-gradient(
          180deg,
          rgba(217, 204, 184, 0.12),
          rgba(217, 204, 184, 0.12) 1px,
          transparent 1px,
          transparent 38px
        );
    }

    .message {
      max-width: min(720px, 82%);
      padding: 12px 14px;
      border-radius: 18px;
      border: 1px solid rgba(47, 36, 25, 0.08);
      box-shadow: 0 10px 24px rgba(59, 42, 23, 0.08);
      animation: fadeIn 180ms ease;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .message.in {
      align-self: flex-start;
      background: var(--inbound);
      border-top-left-radius: 6px;
    }

    .message.out {
      align-self: flex-end;
      background: var(--outbound);
      border-top-right-radius: 6px;
    }

    .message-meta {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 8px;
      font-size: 12px;
      color: var(--muted);
    }

    .message-body {
      font-size: 14px;
      line-height: 1.45;
    }

    .empty {
      margin: auto;
      text-align: center;
      color: var(--muted);
      max-width: 520px;
      padding: 20px;
    }

    .empty strong {
      display: block;
      color: var(--text);
      font-size: 20px;
      font-family: var(--font-display);
      margin-bottom: 10px;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 1180px) {
      .summary-grid,
      .mini-stats,
      .detail-grid,
      .answer-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 980px) {
      .shell {
        padding: 14px;
      }

      .hero {
        flex-direction: column;
        align-items: stretch;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .clients {
        max-height: none;
      }

      .messages {
        max-height: none;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel hero">
      <div class="hero-copy">
        <div class="eyebrow">Loan Ops Dashboard</div>
        <h1>Qualification queue, document review, and manual outreach in one place.</h1>
        <div class="hero-subtitle">Use the quick queues to spot completed and incomplete applications, open a profile for full answers and uploaded files, and send a custom WhatsApp message without leaving the dashboard.</div>
        <div id="summaryGrid" class="summary-grid"></div>
      </div>
      <div class="hero-actions">
        <button id="refreshBtn" class="button" type="button">Refresh</button>
      </div>
    </section>

    <div class="layout">
      <aside class="panel sidebar">
        <div class="sidebar-header">
          <div class="eyebrow">Queues</div>
          <h2>Applicants</h2>
          <div class="section-subtitle">Search the full list or jump straight to completed and incomplete qualification queues.</div>
        </div>
        <div class="search-wrap">
          <input id="clientSearch" class="search" type="search" placeholder="Search by name, number, stage, or answer" />
        </div>
        <section class="queue-section">
          <div class="queue-head">
            <div class="queue-title">Completed qualification</div>
            <div id="completedCount" class="queue-count">0</div>
          </div>
          <div id="completedList" class="clients"></div>
        </section>
        <section class="queue-section">
          <div class="queue-head">
            <div class="queue-title">Incomplete qualification</div>
            <div id="incompleteCount" class="queue-count">0</div>
          </div>
          <div id="incompleteList" class="clients"></div>
        </section>
        <section class="queue-section" style="border-bottom:0;">
          <div class="queue-head">
            <div class="queue-title">All conversations</div>
            <div id="allCount" class="queue-count">0</div>
          </div>
          <div id="clientList" class="clients"></div>
        </section>
      </aside>

      <main class="panel detail">
        <div class="detail-header">
          <div class="detail-header-top">
            <div>
              <div class="eyebrow">Applicant Detail</div>
              <h2 id="chatTitle">Select a client</h2>
              <div id="chatSubtitle" class="chat-subtitle">Open an applicant from the left to review qualification answers, documents, and message history.</div>
              <div id="chatPills" class="pill-row"></div>
            </div>
            <div class="detail-actions">
              <button id="jumpCompletedBtn" class="button" type="button">Next completed</button>
              <button id="jumpIncompleteBtn" class="button" type="button">Next incomplete</button>
            </div>
          </div>
        </div>
        <section id="detailBody" class="detail-body">
          <div class="empty">
            <strong>No applicant selected</strong>
            Pick a contact on the left to load qualification progress, uploaded documents, and the conversation timeline.
          </div>
        </section>
      </main>
    </div>
  </div>

  <script>
    const state = {
      clients: [],
      selectedClientId: null,
      selectedClient: null,
      selectedDetail: null,
      search: "",
      flash: null
    };

    const summaryGridEl = document.getElementById("summaryGrid");
    const clientListEl = document.getElementById("clientList");
    const completedListEl = document.getElementById("completedList");
    const incompleteListEl = document.getElementById("incompleteList");
    const completedCountEl = document.getElementById("completedCount");
    const incompleteCountEl = document.getElementById("incompleteCount");
    const allCountEl = document.getElementById("allCount");
    const detailBodyEl = document.getElementById("detailBody");
    const chatTitleEl = document.getElementById("chatTitle");
    const chatSubtitleEl = document.getElementById("chatSubtitle");
    const chatPillsEl = document.getElementById("chatPills");
    const clientSearchEl = document.getElementById("clientSearch");
    const refreshBtnEl = document.getElementById("refreshBtn");
    const jumpCompletedBtnEl = document.getElementById("jumpCompletedBtn");
    const jumpIncompleteBtnEl = document.getElementById("jumpIncompleteBtn");

    function formatDate(value) {
      if (!value) return "";

      const normalized = String(value).replace(" ", "T");
      const date = /Z$|[+-]\\d{2}:?\\d{2}$/.test(normalized)
        ? new Date(normalized)
        : new Date(normalized + "Z");

      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function getDisplayName(client) {
      return client.full_name || client.profile_name || client.wa_id || "Unnamed client";
    }

    function isCompletedQualification(client) {
      return client.stage === "awaiting_documents"
        || client.stage === "under_review"
        || client.stage === "contacted"
        || client.status === "pending_documents"
        || client.status === "documents_uploaded"
        || client.status === "under_review"
        || client.status === "advisor_contacted";
    }

    function isIncompleteQualification(client) {
      return client.stage === "section_1" || client.stage === "section_2";
    }

    function getFilteredClients() {
      const query = state.search.trim().toLowerCase();
      if (!query) return state.clients;

      return state.clients.filter((client) => {
        const haystack = [
          client.profile_name,
          client.full_name,
          client.wa_id,
          client.last_message_text,
          client.stage,
          client.status,
          client.question_step
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      });
    }

    function buildSummary(filteredClients) {
      const completed = filteredClients.filter(isCompletedQualification);
      const incomplete = filteredClients.filter(isIncompleteQualification);
      const underReview = filteredClients.filter((client) => client.stage === "under_review").length;
      const contacted = filteredClients.filter((client) => client.stage === "contacted").length;
      const avgScore = completed.length
        ? Math.round(completed.reduce((sum, client) => sum + (Number(client.score) || 0), 0) / completed.length)
        : 0;

      return [
        {
          label: "Total applicants",
          value: filteredClients.length,
          foot: "All conversations currently stored"
        },
        {
          label: "Completed qualification",
          value: completed.length,
          foot: "Ready for docs or already under review"
        },
        {
          label: "Incomplete qualification",
          value: incomplete.length,
          foot: "Still answering qualification questions"
        },
        {
          label: "Average score",
          value: avgScore,
          foot: underReview + " under review, " + contacted + " contacted"
        }
      ];
    }

    function renderSummary(filteredClients) {
      const cards = buildSummary(filteredClients);
      summaryGridEl.innerHTML = cards.map((card) => \`
        <article class="summary-card">
          <div class="summary-label">\${escapeHtml(card.label)}</div>
          <div class="summary-value">\${escapeHtml(card.value)}</div>
          <div class="summary-foot">\${escapeHtml(card.foot)}</div>
        </article>
      \`).join("");
    }

    function renderClientButtons(targetEl, clients, emptyTitle, emptyBody) {
      if (clients.length === 0) {
        targetEl.innerHTML = '<div class="empty"><strong>' + escapeHtml(emptyTitle) + '</strong>' + escapeHtml(emptyBody) + '</div>';
        return;
      }

      targetEl.innerHTML = clients.map((client) => {
        const activeClass = client.wa_id === state.selectedClientId ? "active" : "";
        const preview = client.last_message_text || "[" + (client.last_message_type || "no messages") + "]";
        const label = getDisplayName(client);
        const metaRight = client.last_message_at || client.updated_at;

        return \`
          <button class="client-item \${activeClass}" type="button" data-client-id="\${escapeHtml(client.wa_id)}">
            <div class="client-row">
              <div>
                <div class="client-name">\${escapeHtml(label)}</div>
                <div class="client-phone">\${escapeHtml(client.wa_id)}</div>
              </div>
              <div class="client-meta">\${escapeHtml(formatDate(metaRight))}</div>
            </div>
            <div class="client-preview">\${escapeHtml(preview)}</div>
          </button>
        \`;
      }).join("");

      targetEl.querySelectorAll("[data-client-id]").forEach((button) => {
        button.addEventListener("click", () => {
          const waId = button.getAttribute("data-client-id");
          selectClient(waId);
        });
      });
    }

    function renderQueues() {
      const filtered = getFilteredClients();
      const completed = filtered.filter(isCompletedQualification);
      const incomplete = filtered.filter(isIncompleteQualification);

      completedCountEl.textContent = completed.length;
      incompleteCountEl.textContent = incomplete.length;
      allCountEl.textContent = filtered.length;

      renderSummary(filtered);
      renderClientButtons(completedListEl, completed, "No completed files", "No applicants match this filter.");
      renderClientButtons(incompleteListEl, incomplete, "No incomplete files", "No applicants are mid-qualification right now.");
      renderClientButtons(clientListEl, filtered, "No matches", "Try another search term.");
    }

    function renderHeader(client, detail) {
      if (!client || !detail) {
        chatTitleEl.textContent = "Select a client";
        chatSubtitleEl.textContent = "Open an applicant from the left to review qualification answers, documents, and message history.";
        chatPillsEl.innerHTML = "";
        return;
      }

      chatTitleEl.textContent = detail.overview.displayName;
      chatSubtitleEl.textContent = client.wa_id;

      const pills = [
        "Stage: " + (client.stage || "unknown"),
        "Status: " + (client.status || "unknown"),
        "Score: " + (Number(client.score) || 0) + "/100",
        "Qualification: " + detail.overview.qualification.answeredCount + "/" + detail.overview.qualification.totalCount,
        "Documents: " + detail.overview.documents.completed + "/" + detail.overview.documents.total,
        "Updated: " + formatDate(client.updated_at)
      ];

      chatPillsEl.innerHTML = pills.map((pill) => '<span class="pill">' + escapeHtml(pill) + "</span>").join("");
    }

    function renderMessages(messages) {
      if (!messages.length) {
        return '<div class="empty"><strong>No messages yet</strong>This applicant exists, but there is no message history saved yet.</div>';
      }

      return messages.map((message) => {
        const cssClass = message.direction === "out" ? "out" : "in";
        const body = message.message_text
          || (message.file_path ? "File: " + message.file_path : "[" + (message.message_type || "message") + "]");

        return \`
          <article class="message \${cssClass}">
            <div class="message-meta">
              <span>\${message.direction === "out" ? "Bot / Advisor" : "Client"}</span>
              <span>\${escapeHtml(message.message_type || "text")}</span>
              <span>\${escapeHtml(formatDate(message.created_at))}</span>
            </div>
            <div class="message-body">\${escapeHtml(body)}</div>
          </article>
        \`;
      }).join("");
    }

    function renderDocuments(documents) {
      return documents.items.map((doc) => {
        const filesHtml = doc.files.length
          ? doc.files.map((file) => \`
              <div>
                <a class="doc-link" href="/dashboard/file?path=\${encodeURIComponent(file.path)}" target="_blank" rel="noopener noreferrer">
                  <span>Open</span>
                  <span>\${escapeHtml(file.name)}</span>
                </a>
                \${file.isImage ? '<img class="doc-thumb" src="/dashboard/file?path=' + encodeURIComponent(file.path) + '" alt="' + escapeHtml(doc.label) + '" />' : ''}
              </div>
            \`).join("")
          : '<div class="helper-text">' + escapeHtml(doc.status === "pending" ? (doc.prompt || "Waiting for upload.") : "Client skipped this document.") + '</div>';

        return \`
          <article class="doc-card \${escapeHtml(doc.status)}">
            <div class="doc-top">
              <div>
                <div class="client-name">\${escapeHtml(doc.label)}</div>
                <div class="helper-text">\${escapeHtml(doc.prompt)}</div>
              </div>
              <span class="status-chip \${escapeHtml(doc.status)}">\${escapeHtml(doc.status)}</span>
            </div>
            <div class="doc-files">\${filesHtml}</div>
          </article>
        \`;
      }).join("");
    }

    function renderAnswers(qualification) {
      return qualification.answers.map((answer) => \`
        <article class="answer-item">
          <div class="answer-label">\${escapeHtml(answer.label)}</div>
          <div class="answer-value">\${escapeHtml(answer.displayValue)}</div>
        </article>
      \`).join("");
    }

    function renderDetail(client, detail, messages) {
      if (!client || !detail) {
        detailBodyEl.innerHTML = '<div class="empty"><strong>No applicant selected</strong>Pick a contact on the left to load qualification progress, uploaded documents, and the conversation timeline.</div>';
        return;
      }

      const qualification = detail.overview.qualification;
      const documents = detail.overview.documents;
      const flash = state.flash
        ? '<div class="flash ' + escapeHtml(state.flash.type) + '">' + escapeHtml(state.flash.message) + '</div>'
        : '';
      const qualificationState = qualification.complete ? "Completed" : "In progress";
      const currentPrompt = qualification.currentQuestion || "Qualification already finished";
      const nextDocumentLabel = documents.expectedDocument
        ? (documents.items.find((item) => item.key === documents.expectedDocument)?.label || documents.expectedDocument)
        : "No pending document";

      detailBodyEl.innerHTML = \`
        <div class="detail-grid">
          <div class="stack">
            <section class="section-card">
              <div class="eyebrow">Quick View</div>
              <h3>Qualification summary</h3>
              <div class="section-subtitle">Fast operator view for completed and incomplete qualification work.</div>
              <div class="mini-stats">
                <div class="mini-stat">
                  <div class="summary-label">Qualification</div>
                  <strong>\${escapeHtml(qualificationState)}</strong>
                </div>
                <div class="mini-stat">
                  <div class="summary-label">Answers</div>
                  <strong>\${escapeHtml(qualification.answeredCount + "/" + qualification.totalCount)}</strong>
                </div>
                <div class="mini-stat">
                  <div class="summary-label">Score</div>
                  <strong>\${escapeHtml((Number(client.score) || 0) + "/100")}</strong>
                </div>
              </div>
              <div class="mini-stats">
                <div class="mini-stat">
                  <div class="summary-label">Current question</div>
                  <div class="answer-value">\${escapeHtml(currentPrompt)}</div>
                </div>
                <div class="mini-stat">
                  <div class="summary-label">Document progress</div>
                  <div class="answer-value">\${escapeHtml(documents.completed + "/" + documents.total)}</div>
                </div>
                <div class="mini-stat">
                  <div class="summary-label">Next document</div>
                  <div class="answer-value">\${escapeHtml(nextDocumentLabel)}</div>
                </div>
              </div>
            </section>

            <section class="section-card">
              <div class="eyebrow">Detailed View</div>
              <h3>Qualification answers</h3>
              <div class="section-subtitle">Review every collected answer exactly as stored.</div>
              <div class="answer-grid">\${renderAnswers(qualification)}</div>
            </section>

            <section class="section-card">
              <div class="eyebrow">Conversation</div>
              <h3>Message history</h3>
              <div class="messages">\${renderMessages(messages)}</div>
            </section>
          </div>

          <div class="stack">
            <section class="section-card">
              <div class="eyebrow">Documents</div>
              <h3>Uploaded files</h3>
              <div class="section-subtitle">Open the client uploads directly from the file record.</div>
              <div class="docs-list">\${renderDocuments(documents)}</div>
            </section>

            <section class="section-card">
              <div class="eyebrow">Manual Outreach</div>
              <h3>Send custom message</h3>
              <div class="section-subtitle">Write a manual WhatsApp message to this applicant. It will be saved in the conversation history and move completed files into the contacted stage.</div>
              \${flash}
              <form id="manualMessageForm" class="composer">
                <textarea id="manualMessageText" placeholder="Write the custom message you want to send..."></textarea>
                <div class="composer-footer">
                  <div class="helper-text">Sending uses the same WhatsApp delivery flow as the bot.</div>
                  <button class="button primary" type="submit">Send message</button>
                </div>
              </form>
            </section>
          </div>
        </div>
      \`;

      const form = document.getElementById("manualMessageForm");
      const textArea = document.getElementById("manualMessageText");
      if (form && textArea) {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          const body = textArea.value.trim();
          if (!body || !state.selectedClientId) return;

          try {
            const response = await fetch("/dashboard/api/clients/" + encodeURIComponent(state.selectedClientId) + "/message", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ body })
            });

            if (!response.ok) {
              const payload = await response.json().catch(() => ({}));
              throw new Error(payload.error || "Failed to send message");
            }

            state.flash = { type: "ok", message: "Manual message sent successfully." };
            textArea.value = "";
            await refreshAll();
          } catch (error) {
            state.flash = { type: "error", message: error.message || "Failed to send message." };
            renderDetail(state.selectedClient, state.selectedDetail, (state.selectedDetail && state.selectedDetail.messages) || []);
          }
        });
      }
    }

    async function loadClients() {
      const response = await fetch("/dashboard/api/clients");
      const data = await response.json();
      state.clients = data.clients || [];

      if (!state.selectedClientId && state.clients.length > 0) {
        state.selectedClientId = state.clients[0].wa_id;
      }

      if (state.selectedClientId && !state.clients.some((client) => client.wa_id === state.selectedClientId)) {
        state.selectedClientId = state.clients[0]?.wa_id || null;
      }

      renderQueues();
    }

    async function selectClient(waId) {
      state.selectedClientId = waId;
      renderQueues();

      const response = await fetch("/dashboard/api/clients/" + encodeURIComponent(waId));
      if (!response.ok) {
        renderHeader(null, null);
        detailBodyEl.innerHTML = '<div class="empty"><strong>Could not load applicant</strong>Refresh the page and try again.</div>';
        return;
      }

      const data = await response.json();
      state.selectedClient = data.client;
      state.selectedDetail = data;
      renderHeader(data.client, data);
      renderDetail(data.client, data, data.messages || []);
    }

    async function refreshAll() {
      const previousClientId = state.selectedClientId;
      await loadClients();

      if (state.selectedClientId) {
        await selectClient(previousClientId && state.clients.some((client) => client.wa_id === previousClientId)
          ? previousClientId
          : state.selectedClientId);
      } else {
        renderHeader(null, null);
        renderDetail(null, null, []);
      }
    }

    function cycleQueue(predicate) {
      const queue = getFilteredClients().filter(predicate);
      if (!queue.length) return;

      const currentIndex = queue.findIndex((client) => client.wa_id === state.selectedClientId);
      const nextClient = queue[(currentIndex + 1 + queue.length) % queue.length];
      if (nextClient) {
        selectClient(nextClient.wa_id).catch((error) => console.error(error));
      }
    }

    clientSearchEl.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderQueues();
    });

    refreshBtnEl.addEventListener("click", () => {
      refreshAll().catch((error) => {
        console.error(error);
      });
    });

    jumpCompletedBtnEl.addEventListener("click", () => cycleQueue(isCompletedQualification));
    jumpIncompleteBtnEl.addEventListener("click", () => cycleQueue(isIncompleteQualification));

    refreshAll().catch((error) => {
      console.error(error);
      clientListEl.innerHTML = '<div class="empty"><strong>Could not load clients</strong>Check the server console for details.</div>';
    });
  </script>
</body>
</html>`;
}

// =========================
// MAIN MESSAGE HANDLER
// =========================
async function handleIncomingText(from, text, profileName, messageId) {
  // Make sure the sender has a client record before we start routing the message.
  await createClientIfNotExists(from, profileName);

  // Persist every inbound text so the conversation history remains auditable.
  await saveMessage({
    wa_id: from,
    direction: "in",
    message_type: "text",
    message_text: text,
    wa_message_id: messageId
  });

  let client = await getClient(from);

  if (await resolvePendingAction(client, text, from, profileName)) {
    return;
  }

  // Global restart/new application command
  if (fuzzyMatch(text, KEYWORDS.RESTART, 2) || fuzzyMatch(text, KEYWORDS.NEW_APPLICATION, 2)) {
    if (!client || client.stage === "stage_1") {
      await resetToStage1(from, profileName);
      await sendTextMessage(from, MESSAGES.MENU);
      return;
    }

    await beginNewApplicationConfirmation(client, from);
    return;
  }

  // Global status check
  if (fuzzyMatch(text, KEYWORDS.STATUS, 2)) {
    await sendStatusMessage(from, client);
    return;
  }

  // Send a light "welcome back" message when the user returns after a period
  // of inactivity, but continue from their current stage.
  if (client && shouldRemind(client.updated_at, CONFIG.WELCOME_BACK_HOURS)) {
    await sendTextMessage(from, MESSAGES.WELCOME_BACK);
  }

  // If the conversation state is missing or corrupted, rebuild it from the menu.
  if (!client || !client.stage) {
    await resetToStage1(from, profileName);
    await sendTextMessage(from, MESSAGES.MENU);
    return;
  }

  // Route the message to the handler that owns the user's current workflow stage.
  let handled = false;

  switch (client.stage) {
    case "stage_1":
      handled = await handleStage1(client, text, from, profileName);
      break;
    case "stage_2":
      handled = await handleStage2(client, text, from, profileName);
      break;
    case "section_1":
    case "section_2":
      handled = await handleQualificationFlow(client, text, from);
      break;
    case "awaiting_documents":
      handled = await handleDocumentsStage(client, text, from);
      break;
    case "under_review":
      handled = await handleUnderReview(client, text, from, profileName);
      break;
    case "contacted":
      handled = await handleContacted(client, text, from, profileName);
      break;
    case "closed":
      handled = await handleClosed(client, text, from, profileName);
      break;
    default:
      // Unknown stages are treated as recoverable state issues.
      await resetToStage1(from, profileName);
      await sendTextMessage(from, MESSAGES.MENU);
      handled = true;
  }

  // If a stage handler declines the message, fall back to the main menu so the
  // user is never left in a dead end.
  if (!handled) {
    await resetToStage1(from, profileName);
    await sendTextMessage(from, MESSAGES.MENU);
  }
}

// =========================
// MEDIA HANDLER
// =========================
async function handleIncomingMedia(from, profileName, messageId, type, mediaId, extension, originalFileName = null) {
  await createClientIfNotExists(from, profileName);

  const client = await getClient(from);

  if (client?.pending_action) {
    await saveMessage({
      wa_id: from,
      direction: "in",
      message_type: type,
      media_id: mediaId,
      wa_message_id: messageId
    });

    await sendTextMessage(from, "Antes de continuar, por favor responda *si* o *no* a la confirmación de nueva solicitud.");
    return;
  }

  if (!client || client.stage !== "awaiting_documents" || !client.expected_document) {
    await saveMessage({
      wa_id: from,
      direction: "in",
      message_type: type,
      media_id: mediaId,
      wa_message_id: messageId
    });

    await sendTextMessage(from, "Aun no necesito archivos. Por favor continúe con el paso actual.");
    await remindCurrentStep(from, client);
    return;
  }

  // Download the media first so we can store a durable local reference in the DB.
  const filePath = await downloadMedia(mediaId, from, extension);

  // Keep the raw media event in message history even if the file is not expected
  // at the current stage.
  await saveMessage({
    wa_id: from,
    direction: "in",
    message_type: type,
    media_id: mediaId,
    file_path: filePath,
    wa_message_id: messageId
  });

  // Map the expected document key to the database field where its file path lives.
  const currentDoc = client.expected_document;
  const fieldName = getDocumentFieldName(currentDoc);

  if (!fieldName) {
    await sendTextMessage(from, "No fue posible identificar el documento esperado.");
    return;
  }

  if (currentDoc === "income_proof") {
    const nextValue = appendDocumentValue(client[fieldName], filePath);
    await updateClient(from, {
      [fieldName]: nextValue
    });

    await sendTextMessage(from, "Comprobante recibido correctamente. Si desea enviar otro archivo, puede hacerlo ahora. Cuando termine, escriba *listo*. Si desea continuar sin enviar más, escriba *omitir*.");
    return;
  }

  await updateClient(from, {
    [fieldName]: filePath
  });

  // Advance to the next required document, or close the upload phase if this was
  // the final file the client needed to send.
  const nextDoc = getNextDocumentKey(currentDoc);

  if (nextDoc) {
    // More documents needed
    await updateClient(from, {
      expected_document: nextDoc
    });
    await sendTextMessage(from, "Documento recibido correctamente.");
    await sendTextMessage(from, require("./config").DOCUMENTS.PROMPTS[nextDoc]);
  } else {
    const shouldNotifyAdvisor = !(await advanceDocumentsFlow(from, currentDoc, filePath));

    if (shouldNotifyAdvisor) {
      const updatedClient = await getClient(from);
      await notifyAdvisor(updatedClient);
    }
  }
}

// =========================
// WEBHOOK ENDPOINTS
// =========================
app.get("/dashboard", (req, res) => {
  res.type("html").send(renderDashboardPage());
});

app.get("/dashboard/api/clients", async (req, res) => {
  try {
    const clients = await getClientsWithLastMessage();
    res.json({ clients });
  } catch (error) {
    console.error("Dashboard clients error:", error);
    res.status(500).json({ error: "Failed to load clients" });
  }
});

app.get("/dashboard/api/clients/:waId", async (req, res) => {
  try {
    const client = await getClient(req.params.waId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const messages = await getMessagesByClient(req.params.waId);
    res.json({
      client,
      messages,
      overview: buildClientOverview(client)
    });
  } catch (error) {
    console.error("Dashboard conversation error:", error);
    res.status(500).json({ error: "Failed to load conversation" });
  }
});

app.get("/dashboard/file", async (req, res) => {
  try {
    const relativePath = String(req.query.path || "");
    if (!relativePath) {
      return res.status(400).send("Missing file path");
    }

    const downloadsRoot = path.resolve("./downloads");
    const requestedPath = path.resolve(relativePath);

    if (!requestedPath.startsWith(downloadsRoot + path.sep) && requestedPath !== downloadsRoot) {
      return res.status(403).send("Forbidden");
    }

    if (!fs.existsSync(requestedPath)) {
      return res.status(404).send("File not found");
    }

    return res.sendFile(requestedPath);
  } catch (error) {
    console.error("Dashboard file error:", error);
    return res.status(500).send("Failed to load file");
  }
});

app.post("/dashboard/api/clients/:waId/message", async (req, res) => {
  try {
    const client = await getClient(req.params.waId);
    if (!client) {
      return res.status(404).json({ error: "Client not found" });
    }

    const body = String(req.body?.body || "").trim();
    if (!body) {
      return res.status(400).json({ error: "Message body is required" });
    }

    await sendTextMessage(client.wa_id, body);
    if (client.stage === "under_review" || client.stage === "awaiting_documents" || client.status === "documents_uploaded" || client.status === "under_review") {
      await updateClient(client.wa_id, {
        stage: "contacted",
        status: "advisor_contacted",
        advisor_contacted: 1
      });
    }
    const updatedClient = await getClient(client.wa_id);
    const messages = await getMessagesByClient(client.wa_id);

    res.json({
      ok: true,
      client: updatedClient,
      messages,
      overview: buildClientOverview(updatedClient)
    });
  } catch (error) {
    console.error("Dashboard manual message error:", error.response?.data || error.message || error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // WhatsApp/Meta uses this handshake to confirm the webhook endpoint.
  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  // Acknowledge immediately so Meta does not retry while we process the payload.
  res.sendStatus(200);

  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry) {
      for (const change of entry.changes) {
        if (change.field !== "messages") continue;

        const messages = Array.isArray(change.value?.messages)
          ? change.value.messages
          : [];

        // Process each inbound message independently because a single webhook
        // payload can contain multiple events.
        for (const message of messages) {
          const from = message.from;
          const messageId = message.id;

          if (message.type === "text") {
            const text = message.text.body;
            const profileName = change.value.contacts?.[0]?.profile?.name;

            await handleIncomingText(from, text, profileName, messageId);

          } else if (["image", "document", "video"].includes(message.type)) {
            const mediaId = message[message.type].id;
            const profileName = change.value.contacts?.[0]?.profile?.name;

            // Normalize the extension so downloaded files have usable names.
            let extension = "bin";
            if (message.type === "image") extension = "jpg";
            else if (message.type === "document") {
              const filename = message.document?.filename || "";
              const extMatch = filename.match(/\.(\w+)$/);
              extension = extMatch ? extMatch[1] : "pdf";
            } else if (message.type === "video") extension = "mp4";

            await handleIncomingMedia(from, profileName, messageId, message.type, mediaId, extension);
          }
        }
      }
    }
  } catch (error) {
    console.error("Webhook error:", error);
  }
});

// =========================
// SERVER STARTUP
// =========================
const server = app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`🚀 WhatsApp Loan Bot running on ${CONFIG.HOST}:${CONFIG.PORT}`);
  console.log(`📱 Advisor phone: ${CONFIG.ADVISOR_PHONE}`);
  console.log(`💾 Database: ./data/bot.db`);
  console.log(`📁 Downloads: ./downloads/`);
});

server.on("error", (error) => {
  console.error("Server startup/runtime error:", error);
});

server.on("close", () => {
  console.log("HTTP server closed.");
});

// Close the database cleanly so pending writes are not lost when the process stops.
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  server.close();
  await closeDatabase();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down gracefully...");
  server.close();
  await closeDatabase();
  process.exit(0);
});

process.on("beforeExit", (code) => {
  console.log(`Process beforeExit with code ${code}`);
});

process.on("exit", (code) => {
  console.log(`Process exit with code ${code}`);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
