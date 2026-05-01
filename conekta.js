const axios = require("axios");
const { CONFIG } = require("./config");

function assertConektaReady() {
  if (!CONFIG.CONEKTA_ENABLED) {
    throw new Error("Conekta integration is disabled");
  }

  if (!CONFIG.CONEKTA_API_KEY) {
    throw new Error("Conekta API key is missing");
  }
}

function getConektaHeaders() {
  return {
    Accept: `application/vnd.conekta-v${CONFIG.CONEKTA_API_VERSION}+json`,
    "Content-Type": "application/json",
    Authorization: `Bearer ${CONFIG.CONEKTA_API_KEY}`
  };
}

function normalizePhone(phone) {
  const clean = String(phone || "").replace(/\D/g, "");
  return clean || "5555555555";
}

function normalizeEmail(email) {
  const clean = String(email || "").trim();
  return clean.includes("@") ? clean : CONFIG.CONEKTA_DEFAULT_EMAIL;
}

function normalizeName(name, fallback = "Cliente Wabot") {
  const clean = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 .'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (clean || fallback).slice(0, 120);
}

function extractPrimaryCharge(order = {}) {
  const charges = order.charges?.data || order.charges || [];
  return Array.isArray(charges) ? charges[0] : null;
}

function extractCheckoutInfo(order = {}) {
  const checkout = order.checkout || {};
  return {
    checkoutId: checkout.id || null,
    checkoutUrl: checkout.url || (checkout.id ? `https://pay.conekta.com/checkout/${checkout.id}` : null),
    checkoutStatus: checkout.status || null,
    checkoutType: checkout.type || null,
    expiresAt: checkout.expires_at || null
  };
}

function extractSpeiPaymentInfo(order = {}) {
  const charge = extractPrimaryCharge(order);
  const paymentMethod = charge?.payment_method || {};
  const checkoutInfo = extractCheckoutInfo(order);

  return {
    orderId: order.id || null,
    chargeId: charge?.id || null,
    status: order.payment_status || charge?.status || null,
    amountCents: Number(order.amount || charge?.amount || 0),
    currency: order.currency || charge?.currency || "MXN",
    clabe: paymentMethod.clabe || paymentMethod.receiving_account_number || null,
    bank: paymentMethod.bank || paymentMethod.receiving_account_bank || null,
    expiresAt: paymentMethod.expires_at || checkoutInfo.expiresAt || null,
    checkoutId: checkoutInfo.checkoutId,
    checkoutUrl: checkoutInfo.checkoutUrl,
    checkoutStatus: checkoutInfo.checkoutStatus,
    checkoutType: checkoutInfo.checkoutType,
    paidAt: charge?.paid_at || order.updated_at || null
  };
}

async function createCustomer({ waId, name, email, phone }) {
  assertConektaReady();

  const response = await axios.post(
    `${CONFIG.CONEKTA_API_BASE_URL}/customers`,
    {
      name: normalizeName(name || waId),
      email: normalizeEmail(email),
      phone: normalizePhone(phone),
      metadata: {
        source: "wabot",
        wa_id: String(waId || "")
      }
    },
    {
      timeout: 30000,
      headers: getConektaHeaders()
    }
  );

  return response.data;
}

async function createSpeiRecurrentPaymentSource(customerId) {
  assertConektaReady();

  if (!customerId) {
    throw new Error("customerId is required");
  }

  const response = await axios.post(
    `${CONFIG.CONEKTA_API_BASE_URL}/customers/${encodeURIComponent(customerId)}/payment_sources`,
    {
      type: "spei_recurrent"
    },
    {
      timeout: 30000,
      headers: getConektaHeaders()
    }
  );

  return response.data;
}

async function createSpeiOrder({
  waId,
  name,
  email,
  phone,
  amountCents,
  description = "Pago semanal",
  metadata = {}
}) {
  assertConektaReady();

  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("amountCents must be a positive integer");
  }

  const body = {
    currency: "MXN",
      customer_info: {
      name: normalizeName(name || waId),
      email: normalizeEmail(email),
      phone: normalizePhone(phone)
    },
    line_items: [
      {
        name: normalizeName(description, "Pago semanal"),
        unit_price: amount,
        quantity: 1
      }
    ],
    charges: [
      {
        payment_method: {
          type: "spei"
        }
      }
    ],
    metadata: {
      source: "wabot",
      wa_id: String(waId || ""),
      ...metadata
    }
  };

  const response = await axios.post(
    `${CONFIG.CONEKTA_API_BASE_URL}/orders`,
    body,
    {
      timeout: 30000,
      headers: getConektaHeaders()
    }
  );

  return response.data;
}

async function createReusableClabeOrder({
  customerId,
  waId,
  amountCents,
  description = "Pago semanal",
  metadata = {}
}) {
  assertConektaReady();

  const amount = Number(amountCents);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("amountCents must be a positive integer");
  }

  if (!customerId) {
    throw new Error("customerId is required");
  }

  const body = {
    currency: "MXN",
    reuse_customer_clabe: true,
    customer_info: {
      customer_id: customerId
    },
    line_items: [
      {
        name: normalizeName(description, "Pago semanal"),
        unit_price: amount,
        quantity: 1
      }
    ],
    checkout: {
      type: "Integration",
      allowed_payment_methods: ["bank_transfer"]
    },
    metadata: {
      source: "wabot",
      wa_id: String(waId || ""),
      reuse_customer_clabe: true,
      ...metadata
    }
  };

  const response = await axios.post(
    `${CONFIG.CONEKTA_API_BASE_URL}/orders`,
    body,
    {
      timeout: 30000,
      headers: getConektaHeaders()
    }
  );

  return response.data;
}

function summarizeConektaError(error) {
  const details = error.response?.data || {};
  return {
    status: error.response?.status || null,
    code: details.code || error.code || null,
    message: details.message || details.details?.[0]?.message || error.message
  };
}

module.exports = {
  createCustomer,
  createSpeiRecurrentPaymentSource,
  createReusableClabeOrder,
  createSpeiOrder,
  extractSpeiPaymentInfo,
  extractCheckoutInfo,
  summarizeConektaError
};
