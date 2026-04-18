require("dotenv").config();
const axios = require("axios");

const configuredBaseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
const url = new URL(configuredBaseUrl);
if (url.hostname === "localhost") url.hostname = "127.0.0.1";

const baseUrl = url.toString().replace(/\/$/, "");
const verifyToken = process.env.VERIFY_TOKEN;

async function main() {
  try {
    const challenge = "codex-test-challenge";

    const verifyResponse = await axios.get(`${baseUrl}/webhook`, {
      params: {
        "hub.mode": "subscribe",
        "hub.verify_token": verifyToken,
        "hub.challenge": challenge
      },
      validateStatus: () => true
    });

    console.log("GET /webhook");
    console.log("status:", verifyResponse.status);
    console.log("body:", verifyResponse.data);

    const pingResponse = await axios.post(
      `${baseUrl}/webhook`,
      { object: "codex_test" },
      {
        headers: { "Content-Type": "application/json" },
        validateStatus: () => true
      }
    );

    console.log("POST /webhook");
    console.log("status:", pingResponse.status);
    console.log("body:", pingResponse.data || "<empty>");

    const verificationOk =
      verifyResponse.status === 200 && String(verifyResponse.data) === challenge;
    const webhookOk = pingResponse.status === 200;

    if (!verificationOk || !webhookOk) {
      process.exitCode = 1;
      console.error("Webhook test failed.");
      return;
    }

    console.log("Webhook test passed.");
  } catch (error) {
    process.exitCode = 1;

    if (error.code === "ECONNREFUSED") {
      console.error(`No se pudo conectar a ${baseUrl}. Asegurese de ejecutar node server.js primero.`);
      return;
    }

    console.error("Test error:", error.message);
  }
}

main();
