require("dotenv").config();
const axios = require("axios");

const configuredBaseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
const url = new URL(configuredBaseUrl);
if (url.hostname === "localhost") url.hostname = "127.0.0.1";

const baseUrl = url.toString().replace(/\/$/, "");
const totalRequests = Number(process.env.STRESS_TOTAL_REQUESTS || 100);
const concurrency = Number(process.env.STRESS_CONCURRENCY || 10);
const uniqueUsers = Number(process.env.STRESS_UNIQUE_USERS || 25);
const messageText = process.env.STRESS_MESSAGE_TEXT || "hola";

function buildPayload(index) {
  const userIndex = index % uniqueUsers;
  const waId = `521000000${String(userIndex).padStart(4, "0")}`;

  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "stress-test-entry",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "stress-test",
                phone_number_id: process.env.PHONE_NUMBER_ID || "stress-test-phone-id"
              },
              contacts: [
                {
                  profile: { name: `Stress User ${userIndex}` },
                  wa_id: waId
                }
              ],
              messages: [
                {
                  from: waId,
                  id: `stress-msg-${Date.now()}-${index}`,
                  timestamp: `${Math.floor(Date.now() / 1000)}`,
                  text: { body: messageText },
                  type: "text"
                }
              ]
            }
          }
        ]
      }
    ]
  };
}

async function sendOne(index) {
  const startedAt = process.hrtime.bigint();

  try {
    const response = await axios.post(`${baseUrl}/webhook`, buildPayload(index), {
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
      validateStatus: () => true
    });

    const endedAt = process.hrtime.bigint();
    const durationMs = Number(endedAt - startedAt) / 1e6;

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      durationMs
    };
  } catch (error) {
    const endedAt = process.hrtime.bigint();
    const durationMs = Number(endedAt - startedAt) / 1e6;

    return {
      ok: false,
      status: error.code || "REQUEST_ERROR",
      durationMs
    };
  }
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

async function main() {
  console.log(`Stress target: ${baseUrl}/webhook`);
  console.log(`Requests: ${totalRequests}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Unique users: ${uniqueUsers}`);
  console.log(`Message text: ${JSON.stringify(messageText)}`);
  console.log("Tip: use MOCK_WHATSAPP_SEND=true for local stress tests without hitting Meta.");

  const startedAt = Date.now();
  const results = [];
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= totalRequests) return;
      results.push(await sendOne(currentIndex));
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker())
  );

  const totalDurationMs = Date.now() - startedAt;
  const okCount = results.filter((result) => result.ok).length;
  const errorCount = results.length - okCount;
  const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
  const requestsPerSecond = results.length / Math.max(totalDurationMs / 1000, 0.001);

  const statusCounts = results.reduce((acc, result) => {
    const key = String(result.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  console.log("");
  console.log("Results");
  console.log("-------");
  console.log(`Completed: ${results.length}`);
  console.log(`Success: ${okCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Wall time: ${totalDurationMs} ms`);
  console.log(`Throughput: ${requestsPerSecond.toFixed(2)} req/s`);
  console.log(`Latency min: ${durations[0]?.toFixed(2) || "0.00"} ms`);
  console.log(`Latency p50: ${percentile(durations, 50).toFixed(2)} ms`);
  console.log(`Latency p90: ${percentile(durations, 90).toFixed(2)} ms`);
  console.log(`Latency p99: ${percentile(durations, 99).toFixed(2)} ms`);
  console.log(`Latency max: ${durations[durations.length - 1]?.toFixed(2) || "0.00"} ms`);
  console.log(`Status counts: ${JSON.stringify(statusCounts)}`);

  if (errorCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.exitCode = 1;
  console.error("Stress test failed:", error.message);
});
