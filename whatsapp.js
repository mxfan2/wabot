const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { CONFIG } = require("./config");
const { saveMessage } = require("./database");

// =========================
// WHATSAPP API SERVICE
// =========================

async function sendTextMessage(to, body) {
  const url = `https://graph.facebook.com/${CONFIG.GRAPH_VERSION}/${CONFIG.PHONE_NUMBER_ID}/messages`;

  try {
    if (CONFIG.MOCK_WHATSAPP_SEND) {
      console.log(`[MOCK SEND] -> ${to}: ${body.slice(0, 80)}`);

      await saveMessage({
        wa_id: to,
        direction: "out",
        message_type: "text",
        message_text: body
      });

      return true;
    }

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
          Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
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

    return true;
  } catch (error) {
    console.error("Error sending text message:", error.response?.data || error.message);
    throw error;
  }
}

async function downloadMedia(mediaId, wa_id, extension = "bin") {
  const metaUrl = `https://graph.facebook.com/${CONFIG.GRAPH_VERSION}/${mediaId}`;

  try {
    const metaRes = await axios.get(metaUrl, {
      headers: {
        Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`
      }
    });

    const mediaUrl = metaRes.data.url;
    const clientFolder = path.join("downloads", wa_id);

    if (!fs.existsSync(clientFolder)) {
      fs.mkdirSync(clientFolder, { recursive: true });
    }

    const fileName = `${Date.now()}.${extension}`;
    const filePath = path.join(clientFolder, fileName);

    const mediaRes = await axios.get(mediaUrl, {
      responseType: "stream",
      headers: {
        Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`
      }
    });

    const writer = fs.createWriteStream(filePath);

    await new Promise((resolve, reject) => {
      mediaRes.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    return filePath;
  } catch (error) {
    console.error("Error downloading media:", error.response?.data || error.message);
    throw error;
  }
}

async function notifyAdvisor(client) {
  if (!client) {
    console.warn("notifyAdvisor: No client provided");
    return;
  }

  if (!CONFIG.ADVISOR_PHONE) {
    console.error("notifyAdvisor: ADVISOR_PHONE not configured");
    return;
  }

  const message =
`Nueva solicitud lista para revisión.

Cliente: ${client.full_name || "(sin nombre)"}
WhatsApp: ${client.wa_id}
Puntuación: ${client.score || 0}/100

Sección 1 y 2 completadas.
Documentos recibidos:
- INE frente
- INE reverso
- comprobante de domicilio
- fachada del domicilio
- comprobante de ingresos

Revise el expediente.`;

  try {
    console.log(`notifyAdvisor: Sending notification to ${CONFIG.ADVISOR_PHONE} for client ${client.wa_id}`);
    await sendTextMessage(CONFIG.ADVISOR_PHONE, message);
    await require("./database").updateClient(client.wa_id, { advisor_notified: 1, status: "under_review" });
    console.log(`notifyAdvisor: Successfully notified advisor for client ${client.wa_id}`);
  } catch (error) {
    console.error(`notifyAdvisor: Failed to notify advisor:`, {
      clientId: client.wa_id,
      advisorPhone: CONFIG.ADVISOR_PHONE,
      error: error.response?.data || error.message,
      status: error.response?.status
    });
  }
}

module.exports = {
  sendTextMessage,
  downloadMedia,
  notifyAdvisor
};
