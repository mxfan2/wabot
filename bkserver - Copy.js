require("dotenv").config();
const express = require("express");
const axios = require("axios");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GRAPH_VERSION = process.env.GRAPH_VERSION || "v23.0";

if (!fs.existsSync("./downloads")) fs.mkdirSync("./downloads", { recursive: true });
if (!fs.existsSync("./data")) fs.mkdirSync("./data", { recursive: true });

const db = new sqlite3.Database("./data/bot.db");

function getClient(wa_id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM clients WHERE wa_id = ?`, [wa_id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function createClient(wa_id, name = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR IGNORE INTO clients (wa_id, name, flow_step) VALUES (?, ?, 'start')`,
      [wa_id, name],
      function (err) {
        if (err) reject(err);
        else resolve(true);
      }
    );
  });
}

function updateClientStep(wa_id, step, name = null) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE clients
       SET flow_step = ?, name = COALESCE(?, name), updated_at = CURRENT_TIMESTAMP
       WHERE wa_id = ?`,
      [step, name, wa_id],
      function (err) {
        if (err) reject(err);
        else resolve(true);
      }
    );
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

async function sendTextMessage(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  await saveMessage({
    wa_id: to,
    direction: "out",
    message_type: "text",
    message_text: body
  });
}

async function downloadMedia(mediaId, wa_id, extension = "bin") {
  const metaUrl = `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`;

  const metaRes = await axios.get(metaUrl, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });

  const mediaUrl = metaRes.data.url;
  const fileName = `${wa_id}_${Date.now()}.${extension}`;
  const filePath = path.join("downloads", fileName);

  const mediaRes = await axios.get(mediaUrl, {
    responseType: "stream",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });

  const writer = fs.createWriteStream(filePath);

  await new Promise((resolve, reject) => {
    mediaRes.data.pipe(writer);
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return filePath;
}

async function handleIncomingText(from, text, profileName, messageId) {
  const clean = (text || "").trim().toLowerCase();

  await createClient(from, profileName);
  let client = await getClient(from);

  await saveMessage({
    wa_id: from,
    direction: "in",
    message_type: "text",
    message_text: text,
    wa_message_id: messageId
  });

  if (["hola", "menu", "reinicio", "inicio"].includes(clean)) {
    await updateClientStep(from, "menu");
    await sendTextMessage(
      from,
      "PRÉSTAMOS RÁPIDOS Y SENCILLOS\n\n1. Solicitar préstamo\n2. Información\n3. Requisitos\n\nEscribe solo el número de opción."
    );
    return;
  }

  client = await getClient(from);

  if (client.flow_step === "menu" || client.flow_step === "start") {
    if (clean === "1") {
      await updateClientStep(from, "ask_name");
      await sendTextMessage(from, "Perfecto. Envíame tu nombre completo.");
      return;
    }
    if (clean === "2") {
      await sendTextMessage(from, "Ofrecemos préstamos con pagos flexibles. Escribe 1 para iniciar tu solicitud.");
      return;
    }
    if (clean === "3") {
      await sendTextMessage(from, "Para iniciar ocupamos algunos datos básicos. Escribe 1 para comenzar.");
      return;
    }

    await sendTextMessage(from, "No entendí tu mensaje. Escribe: hola, menu o reinicio.");
    return;
  }

  if (client.flow_step === "ask_name") {
    await updateClientStep(from, "ask_city", text);
    await sendTextMessage(from, "Gracias. Ahora dime tu ciudad.");
    return;
  }

  if (client.flow_step === "ask_city") {
    await updateClientStep(from, "ask_amount");
    await sendTextMessage(from, "¿Qué monto necesitas solicitar?");
    return;
  }

  if (client.flow_step === "ask_amount") {
    await updateClientStep(from, "completed");
    await sendTextMessage(from, "Gracias. Ya registré tus datos básicos. En breve continúa la validación.");
    return;
  }

  await sendTextMessage(from, "Escribe menu para volver al inicio.");
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const body = req.body;
    const value = body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) return;

    const from = message.from;
    const profileName = contact?.profile?.name || null;
    const messageId = message.id;
    const type = message.type;

    if (type === "text") {
      await handleIncomingText(from, message.text?.body || "", profileName, messageId);
      return;
    }

    if (type === "image") {
      const mediaId = message.image?.id;
      const mime = message.image?.mime_type || "";
      const extension = mime.split("/")[1] || "jpg";

      const filePath = await downloadMedia(mediaId, from, extension);

      await saveMessage({
        wa_id: from,
        direction: "in",
        message_type: "image",
        media_id: mediaId,
        file_path: filePath,
        wa_message_id: messageId
      });

      await sendTextMessage(from, "Imagen recibida correctamente.");
      return;
    }

    if (type === "document") {
      const mediaId = message.document?.id;
      const fileName = message.document?.filename || "archivo";
      const extension = fileName.includes(".") ? fileName.split(".").pop() : "bin";

      const filePath = await downloadMedia(mediaId, from, extension);

      await saveMessage({
        wa_id: from,
        direction: "in",
        message_type: "document",
        media_id: mediaId,
        file_path: filePath,
        wa_message_id: messageId
      });

      await sendTextMessage(from, "Documento recibido correctamente.");
      return;
    }

    await saveMessage({
      wa_id: from,
      direction: "in",
      message_type: type,
      wa_message_id: messageId
    });

    await sendTextMessage(from, "Tipo de mensaje recibido, pero todavía no está manejado por el sistema.");
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message);
  }
});

app.get("/", (req, res) => {
  res.send("Bot activo");
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});