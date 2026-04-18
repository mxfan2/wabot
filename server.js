require("dotenv").config();
const express = require("express");
const fs = require("fs");

const { CONFIG, MESSAGES, KEYWORDS } = require("./config");
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
  sendStatusMessage
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

function renderDashboardPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bot Conversations</title>
  <style>
    :root {
      --bg: #f4efe6;
      --panel: #fffdf8;
      --panel-alt: #f7f1e7;
      --line: #d9ccb8;
      --text: #2f2419;
      --muted: #7b6a57;
      --accent: #0f766e;
      --accent-soft: #dff4ef;
      --inbound: #efe4d3;
      --outbound: #d9f1ec;
      --shadow: 0 18px 40px rgba(75, 56, 37, 0.12);
      --radius: 18px;
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
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 18px;
      height: 100vh;
      padding: 18px;
    }

    .panel {
      background: rgba(255, 253, 248, 0.92);
      border: 1px solid rgba(217, 204, 184, 0.9);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      backdrop-filter: blur(10px);
      min-height: 0;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .sidebar-header, .chat-header {
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--line);
    }

    .eyebrow {
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
    }

    h1, h2 {
      margin: 0;
      font-family: var(--font-display);
      font-weight: 700;
      line-height: 1.05;
    }

    h1 { font-size: 28px; }
    h2 { font-size: 26px; }

    .sidebar-subtitle, .chat-subtitle {
      margin-top: 8px;
      color: var(--muted);
      font-size: 14px;
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

    .clients {
      overflow: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
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

    .chat {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .chat-header-top {
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

    .chat-actions {
      display: flex;
      gap: 10px;
      align-items: center;
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

    .messages {
      flex: 1;
      overflow: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
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

    @media (max-width: 900px) {
      .shell {
        grid-template-columns: 1fr;
        height: auto;
        min-height: 100vh;
      }

      .sidebar {
        max-height: 45vh;
      }

      .chat {
        min-height: 55vh;
      }

      .message {
        max-width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="panel sidebar">
      <div class="sidebar-header">
        <div class="eyebrow">Conversation Desk</div>
        <h1>Clients</h1>
        <div class="sidebar-subtitle">Switch between conversations and inspect every message in sequence.</div>
      </div>
      <div class="search-wrap">
        <input id="clientSearch" class="search" type="search" placeholder="Search by name or WhatsApp number" />
      </div>
      <div id="clientList" class="clients"></div>
    </aside>

    <main class="panel chat">
      <div class="chat-header">
        <div class="chat-header-top">
          <div>
            <div class="eyebrow">Conversation Viewer</div>
            <h2 id="chatTitle">Select a client</h2>
            <div id="chatSubtitle" class="chat-subtitle">Open any conversation from the list to see messages in order.</div>
            <div id="chatPills" class="pill-row"></div>
          </div>
          <div class="chat-actions">
            <button id="refreshBtn" class="button" type="button">Refresh</button>
          </div>
        </div>
      </div>
      <section id="messageList" class="messages">
        <div class="empty">
          <strong>No client selected</strong>
          Choose a contact on the left to load the conversation history.
        </div>
      </section>
    </main>
  </div>

  <script>
    const state = {
      clients: [],
      selectedClientId: null,
      search: ""
    };

    const clientListEl = document.getElementById("clientList");
    const messageListEl = document.getElementById("messageList");
    const chatTitleEl = document.getElementById("chatTitle");
    const chatSubtitleEl = document.getElementById("chatSubtitle");
    const chatPillsEl = document.getElementById("chatPills");
    const clientSearchEl = document.getElementById("clientSearch");
    const refreshBtnEl = document.getElementById("refreshBtn");

    function formatDate(value) {
      if (!value) return "";
      const date = new Date(value.replace(" ", "T"));
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

    function getFilteredClients() {
      const query = state.search.trim().toLowerCase();
      if (!query) return state.clients;

      return state.clients.filter((client) => {
        const haystack = [
          client.profile_name,
          client.wa_id,
          client.last_message_text,
          client.stage,
          client.status
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(query);
      });
    }

    function renderClients() {
      const filtered = getFilteredClients();

      if (filtered.length === 0) {
        clientListEl.innerHTML = '<div class="empty"><strong>No matches</strong>Try another name or number.</div>';
        return;
      }

      clientListEl.innerHTML = filtered.map((client) => {
        const activeClass = client.wa_id === state.selectedClientId ? "active" : "";
        const preview = client.last_message_text || "[" + (client.last_message_type || "no messages") + "]";
        const label = client.profile_name || "Unnamed client";

        return \`
          <button class="client-item \${activeClass}" type="button" data-client-id="\${escapeHtml(client.wa_id)}">
            <div class="client-row">
              <div>
                <div class="client-name">\${escapeHtml(label)}</div>
                <div class="client-phone">\${escapeHtml(client.wa_id)}</div>
              </div>
              <div class="client-meta">\${escapeHtml(formatDate(client.last_message_at || client.updated_at))}</div>
            </div>
            <div class="client-preview">\${escapeHtml(preview)}</div>
          </button>
        \`;
      }).join("");

      clientListEl.querySelectorAll("[data-client-id]").forEach((button) => {
        button.addEventListener("click", () => {
          const waId = button.getAttribute("data-client-id");
          selectClient(waId);
        });
      });
    }

    function renderHeader(client, messages) {
      if (!client) {
        chatTitleEl.textContent = "Select a client";
        chatSubtitleEl.textContent = "Open any conversation from the list to see messages in order.";
        chatPillsEl.innerHTML = "";
        return;
      }

      chatTitleEl.textContent = client.profile_name || client.wa_id;
      chatSubtitleEl.textContent = client.wa_id;

      const pills = [
        "Stage: " + (client.stage || "unknown"),
        "Status: " + (client.status || "unknown"),
        "Messages: " + messages.length,
        "Updated: " + formatDate(client.updated_at)
      ];

      chatPillsEl.innerHTML = pills.map((pill) => '<span class="pill">' + escapeHtml(pill) + "</span>").join("");
    }

    function renderMessages(messages) {
      if (messages.length === 0) {
        messageListEl.innerHTML = '<div class="empty"><strong>No messages yet</strong>This client exists, but there is no message history saved yet.</div>';
        return;
      }

      messageListEl.innerHTML = messages.map((message) => {
        const cssClass = message.direction === "out" ? "out" : "in";
        const body = message.message_text
          || (message.file_path ? "File: " + message.file_path : "[" + (message.message_type || "message") + "]");

        return \`
          <article class="message \${cssClass}">
            <div class="message-meta">
              <span>\${message.direction === "out" ? "Bot" : "Client"}</span>
              <span>\${escapeHtml(message.message_type || "text")}</span>
              <span>\${escapeHtml(formatDate(message.created_at))}</span>
            </div>
            <div class="message-body">\${escapeHtml(body)}</div>
          </article>
        \`;
      }).join("");

      messageListEl.scrollTop = messageListEl.scrollHeight;
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

      renderClients();
    }

    async function selectClient(waId) {
      state.selectedClientId = waId;
      renderClients();

      const response = await fetch("/dashboard/api/clients/" + encodeURIComponent(waId));
      if (!response.ok) {
        renderHeader(null, []);
        messageListEl.innerHTML = '<div class="empty"><strong>Could not load conversation</strong>Refresh the page and try again.</div>';
        return;
      }

      const data = await response.json();
      renderHeader(data.client, data.messages || []);
      renderMessages(data.messages || []);
    }

    async function refreshAll() {
      const previousClientId = state.selectedClientId;
      await loadClients();

      if (state.selectedClientId) {
        await selectClient(previousClientId && state.clients.some((client) => client.wa_id === previousClientId)
          ? previousClientId
          : state.selectedClientId);
      }
    }

    clientSearchEl.addEventListener("input", (event) => {
      state.search = event.target.value;
      renderClients();
    });

    refreshBtnEl.addEventListener("click", () => {
      refreshAll().catch((error) => {
        console.error(error);
      });
    });

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
    res.json({ client, messages });
  } catch (error) {
    console.error("Dashboard conversation error:", error);
    res.status(500).json({ error: "Failed to load conversation" });
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
