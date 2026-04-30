const levenshtein = require("fast-levenshtein");
const { KEYWORDS, CONFIG } = require("./config");

// =========================
// UTILITY FUNCTIONS
// =========================

function normalizeText(text) {
  return (text || "").trim().toLowerCase();
}

function fuzzyMatch(userInput, keywords, maxDistance = 2) {
  const cleanInput = normalizeText(userInput);

  // First try exact match
  if (keywords.has(cleanInput)) {
    return true;
  }

  // Then try fuzzy match
  for (const keyword of keywords) {
    const distance = levenshtein.get(cleanInput, keyword);
    if (distance <= maxDistance) {
      return true;
    }
  }

  return false;
}

function fuzzyMatchSet(userInput, keywords, maxDistance = 2) {
  const cleanInput = normalizeText(userInput);

  // Create array from Set if needed
  const keywordArray = keywords instanceof Set ? Array.from(keywords) : keywords;

  for (const keyword of keywordArray) {
    const distance = levenshtein.get(cleanInput, keyword);
    if (distance <= maxDistance) {
      return keyword; // Return the matched keyword
    }
  }

  return null;
}

function includesKeyword(userInput, keywords) {
  const cleanInput = normalizeText(userInput);
  if (!cleanInput) return false;

  for (const keyword of keywords) {
    const cleanKeyword = normalizeText(keyword);
    if (!cleanKeyword) continue;

    if (cleanInput === cleanKeyword) return true;
    if (cleanInput.includes(cleanKeyword)) return true;

    const inputWords = cleanInput.split(/\s+/).filter(Boolean);
    const keywordWords = cleanKeyword.split(/\s+/).filter(Boolean);

    if (keywordWords.length > 1 && keywordWords.every((word) => inputWords.includes(word))) {
      return true;
    }
  }

  return false;
}

function seemsLikePhoneNumber(text) {
  const clean = (text || "").replace(/\D/g, "");
  return clean.length >= CONFIG.PHONE_MIN_LENGTH;
}

function seemsLikeQuestion(text) {
  const clean = normalizeText(text);
  return clean.includes("?") || clean.startsWith("que") || clean.startsWith("cómo") || clean.startsWith("como");
}

function extractNumberFromText(text) {
  if (!text) return 0;
  const match = String(text).replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function hasRepeatedDigitRun(text, minLength = 5) {
  return new RegExp(`(\\d)\\1{${minLength - 1},}`).test(String(text || ""));
}

function hasFakeOrPlaceholderWords(text) {
  const clean = normalizeText(text);
  const suspicious = [
    "privado",
    "secreto",
    "no quiero",
    "no te digo",
    "inventado",
    "fake",
    "mentira",
    "asdf",
    "test",
    "prueba"
  ];
  return suspicious.some((word) => clean.includes(word));
}

function hasAddressSignal(text) {
  const clean = normalizeText(text);
  const hasNumber = /\d/.test(clean);
  const addressWords = [
    "calle",
    "av",
    "avenida",
    "col",
    "colonia",
    "fracc",
    "fraccionamiento",
    "privada",
    "boulevard",
    "blvd",
    "casa",
    "numero",
    "número",
    "#",
    "entre"
  ];
  const hasAddressWord = addressWords.some((word) => clean.includes(word));
  const meaningfulWords = clean.split(/\s+/).filter((word) => word.length > 2);
  return clean.length >= 10 && (
    (hasAddressWord && hasNumber && meaningfulWords.length >= 1)
    || (meaningfulWords.length >= 2 && (hasNumber || hasAddressWord))
  );
}

function parseTimePeriodYears(text) {
  const clean = normalizeText(text);
  const amount = extractNumberFromText(clean);
  if (!amount) return 0;
  if (clean.includes("mes")) return amount / 12;
  if (clean.includes("semana")) return amount / 52;
  if (clean.includes("dia") || clean.includes("día")) return amount / 365;
  return amount;
}

function normalizeIncomeToWeekly(text) {
  const amount = extractNumberFromText(text);
  if (!amount) return 0;

  const clean = normalizeText(text);
  if (clean.includes("mes") || clean.includes("mensual")) return amount / 4.33;
  if (clean.includes("quincena") || clean.includes("quincenal")) return amount / 2;
  return amount;
}

function normalizeDebtPaymentToWeekly(text) {
  const clean = normalizeText(text);
  if (!clean || clean === "0" || fuzzyMatch(text, KEYWORDS.NO, 2)) return 0;
  return normalizeIncomeToWeekly(text);
}

function hasUsableDocument(rawValue) {
  if (!rawValue) return false;
  if (rawValue === "SKIPPED") return false;

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed.some((value) => value && value !== "SKIPPED");
    }
  } catch (error) {
    // Older rows may contain a single plain path.
  }

  return Boolean(rawValue);
}

function getHoursSince(date) {
  if (!date) return 0;
  const lastUpdate = new Date(date);
  const now = new Date();
  return (now - lastUpdate) / (1000 * 60 * 60);
}

function shouldRemind(lastUpdate, thresholdHours) {
  return getHoursSince(lastUpdate) > thresholdHours;
}

// =========================
// VALIDATION FUNCTIONS
// =========================

const VALIDATION_RULES = {
  text: {
    validate: (value) => {
      const clean = (value || "").trim();
      if (clean.length < CONFIG.TEXT_MIN_LENGTH) return false;
      if (hasRepeatedDigitRun(clean, 5)) return false;
      if (/^\d+$/.test(clean)) return false;
      return true;
    },
    errorMsg: "Por favor introduce un valor de texto válido (mínimo 2 caracteres)."
  },

  age: {
    validate: (value) => {
      const clean = normalizeText(value || "");
      if (hasRepeatedDigitRun(clean, 3)) return false;
      const age = extractNumberFromText(clean);
      return Number.isFinite(age) && age >= 18 && age <= 99;
    },
    errorMsg: "Por favor introduce una edad real entre 18 y 99 años."
  },

  numeric: {
    validate: (value) => {
      const num = extractNumberFromText(value);
      if (hasRepeatedDigitRun(value, 5)) return false;
      return !isNaN(num) && num > 0 && num <= 1000000;
    },
    errorMsg: "Por favor introduzca un valor numérico válido."
  },

  income_amount: {
    validate: (value) => {
      const clean = normalizeText(value || "");
      const amount = extractNumberFromText(clean);
      if (!Number.isFinite(amount) || amount <= 0) return false;
      if (hasRepeatedDigitRun(clean, 5)) return false;
      if (amount < 100 || amount > 200000) return false;
      if (clean.includes("dolar") || clean.includes("usd")) return false;
      return true;
    },
    errorMsg: "Por favor indica un ingreso aproximado real en pesos. Ejemplo: 3500 por semana, 8000 quincenal o 15000 mensual."
  },

  phone: {
    validate: (value) => {
      const clean = (value || "").replace(/\D/g, "");
      return clean.length >= CONFIG.PHONE_MIN_LENGTH;
    },
    errorMsg: `Por favor introduzca un número de teléfono válido (${CONFIG.PHONE_MIN_LENGTH} dígitos).`
  },

  address: {
    validate: (value) => {
      const clean = (value || "").trim();
      if (clean.length < CONFIG.ADDRESS_MIN_LENGTH) return false;
      if (hasFakeOrPlaceholderWords(clean)) return false;
      if (hasRepeatedDigitRun(clean, 4)) return false;
      if (/^(si|sí|no|ok|va|claro)(\s+\1)*\s*\d*$/i.test(clean)) return false;
      return hasAddressSignal(clean);
    },
    errorMsg: "Por favor escribe una dirección real con calle/colonia y número o referencia. Ejemplo: Calle Reforma 123, Col. Centro."
  },

  income_type: {
    validate: (value) => {
      const clean = normalizeText(value || "");
      const options = [
        "empleado", "empleada", "empresa", "trabajo", "negocio", "propio",
        "independiente", "pension", "pensión", "pensionado", "pensionada",
        "apoyo", "ama de casa", "desempleado", "desempleada", "otro"
      ];
      return options.some(opt => clean.includes(opt));
    },
    errorMsg: "Por favor indique si es empleado(a), negocio propio, pensionado(a), apoyo familiar/ama de casa, desempleado(a) u otro."
  },

  income_frequency: {
    validate: (value) => {
      const clean = normalizeText(value || "");
      return clean.includes("semana") || clean.includes("quincena") || clean.includes("mes") || clean.includes("mensual");
    },
    errorMsg: "Por favor indique si el ingreso es por semana, por quincena o por mes."
  },

  household_income_details: {
    validate: (value) => {
      const clean = (value || "").trim();
      if (hasRepeatedDigitRun(clean, 5)) return false;
      return clean.length >= 8 && /\d/.test(clean);
    },
    errorMsg: "Por favor indique quién aporta, cuánto aporta y cada cuándo. Ejemplo: mi esposo gana 8000 a la semana."
  },

  debt_payments: {
    validate: (value) => {
      const clean = normalizeText(value || "");
      if (hasRepeatedDigitRun(clean, 5)) return false;
      const amount = extractNumberFromText(clean);
      return fuzzyMatch(value, KEYWORDS.NO, 2) || clean === "0" || (amount >= 0 && amount <= 50000 && /\d/.test(clean));
    },
    errorMsg: "Por favor indique cuánto paga por semana o quincena en otras deudas. Si no tiene pagos, responda 0 o no."
  },

  marital_status: {
    validate: (value) => {
      const clean = normalizeText(value || "");
      const options = ["soltero", "casado", "viudo", "divorciado", "separado"];
      // Exact substring match or fuzzy match for each option
      return options.some(opt => clean.includes(opt) || levenshtein.get(clean, opt) <= 2);
    },
    errorMsg: "Por favor seleccione una opción válida: soltero(a), casado(a), viudo(a), divorciado(a) o separado(a)."
  },

  yesno: {
    validate: (value) => {
      return fuzzyMatch(value, KEYWORDS.YES, 2) || fuzzyMatch(value, KEYWORDS.NO, 2);
    },
    errorMsg: "Por favor responda solo sí o no."
  },

  time_period: {
    validate: (value) => {
      const clean = normalizeText(value || "");
      if (hasRepeatedDigitRun(clean, 4)) return false;
      const years = parseTimePeriodYears(clean);
      return years > 0 && years <= 80;
    },
    errorMsg: "Por favor introduce un tiempo real. Ejemplo: 8 meses, 2 años o 2.5 años."
  }
};

function validateAnswer(value, validationType) {
  if (!validationType) return { valid: true };

  const rule = VALIDATION_RULES[validationType];
  if (!rule) return { valid: true };

  const isValid = rule.validate(value);
  return {
    valid: isValid,
    errorMsg: rule.errorMsg
  };
}

// =========================
// SCORING SYSTEM
// =========================

function calculateClientScore(client) {
  let score = 0;

  // V2 scoring criteria:
  // +25: Declared income capacity against the highest weekly payment in the current product table
  // +20: Income proof answer + uploaded income document
  // +15: Employment stability and work verifiability
  // +15: Residence stability and address consistency
  // +15: No existing debt with similar lender
  // +10: Identity/address/house document completeness
  // Age and marital status are collected but do not add score points.

  // Payment capacity. Until desired loan amount is collected, use the highest
  // listed weekly payment ($750) as a conservative benchmark.
  const weeklyIncome = normalizeIncomeToWeekly(`${client.average_income || ""} ${client.income_frequency || ""}`);
  const extraWeeklyIncome = fuzzyMatch(client.extra_household_income_available, KEYWORDS.YES, 2)
    ? normalizeIncomeToWeekly(client.extra_household_income_details)
    : 0;
  const weeklyDebtPayments = normalizeDebtPaymentToWeekly(client.current_debt_payments);
  const netWeeklyHouseholdIncome = Math.max(weeklyIncome + extraWeeklyIncome - weeklyDebtPayments, 0);

  if (netWeeklyHouseholdIncome > 0) {
    const ratio = netWeeklyHouseholdIncome / 750;
    if (ratio >= 4) score += CONFIG.SCORING.PAYMENT_CAPACITY;
    else if (ratio >= 3) score += 20;
    else if (ratio >= 2) score += 14;
    else if (ratio >= 1) score += 7;
  }

  // Income proof availability and uploaded proof.
  if (fuzzyMatch(client.income_proof_available, KEYWORDS.YES, 2)) {
    score += CONFIG.SCORING.INCOME_PROOF_ANSWER;
  }
  if (hasUsableDocument(client.income_proof_path)) {
    score += CONFIG.SCORING.INCOME_PROOF_DOCUMENT;
  }

  // Employment stability.
  const jobYears = extractNumberFromText(client.years_at_job);
  if (jobYears >= 6) score += CONFIG.SCORING.JOB_YEARS['6+'];
  else if (jobYears >= 3) score += CONFIG.SCORING.JOB_YEARS['3-5'];
  else if (jobYears >= 1) score += CONFIG.SCORING.JOB_YEARS['1-2'];

  // Work verifiability.
  let workScore = 0;
  if (client.job_name && client.job_name !== "OMITIDO") workScore += 1;
  if (client.income_type && client.income_type !== "OMITIDO") {
    const incomeType = normalizeText(client.income_type);
    if (incomeType.includes("emple") || incomeType.includes("empresa") || incomeType.includes("negocio") || incomeType.includes("propio") || incomeType.includes("pension") || incomeType.includes("pensión")) {
      workScore += 1;
    }
  }
  if (client.work_address && client.work_address !== "OMITIDO") workScore += 2;
  if (client.work_phone && client.work_phone !== "OMITIDO") workScore += 2;
  else if (client.work_phone === "OMITIDO") workScore += 1;
  score += Math.min(workScore, CONFIG.SCORING.WORK_VERIFIABILITY);

  // Residence stability.
  const homeYears = extractNumberFromText(client.years_at_home);
  if (homeYears >= 6) score += CONFIG.SCORING.HOME_YEARS['6+'];
  else if (homeYears >= 3) score += CONFIG.SCORING.HOME_YEARS['3-5'];
  else if (homeYears >= 1) score += CONFIG.SCORING.HOME_YEARS['1-2'];

  // Address consistency is a weak verification signal, not a property-ownership reward.
  if (client.full_name) {
    const nameClean = normalizeText(client.full_name);
    const homeOwnerClean = normalizeText(client.home_owner_name);
    const proofNameClean = normalizeText(client.address_proof_name);
    if (
      (homeOwnerClean && (homeOwnerClean.includes(nameClean) || nameClean.includes(homeOwnerClean))) ||
      (proofNameClean && (proofNameClean.includes(nameClean) || nameClean.includes(proofNameClean)))
    ) {
      score += CONFIG.SCORING.ADDRESS_CONSISTENCY;
    }
  }

  // Existing debt exposure with similar lender.
  if (fuzzyMatch(client.debt_with_lender, KEYWORDS.NO, 2)) {
    score += CONFIG.SCORING.NO_DEBT;
  }

  // Identity and residence documents. Income proof is scored above.
  const identityDocs = [
    client.ine_front_path,
    client.ine_back_path,
    client.proof_of_address_path,
    client.house_front_path
  ];
  const identityDocScore = identityDocs.filter(hasUsableDocument).length * 2.5;
  score += Math.min(identityDocScore, CONFIG.SCORING.IDENTITY_DOCUMENTS);

  return Math.min(score, CONFIG.MAX_SCORE); // Cap at 100
}

module.exports = {
  normalizeText,
  fuzzyMatch,
  fuzzyMatchSet,
  includesKeyword,
  seemsLikePhoneNumber,
  seemsLikeQuestion,
  extractNumberFromText,
  normalizeIncomeToWeekly,
  normalizeDebtPaymentToWeekly,
  getHoursSince,
  shouldRemind,
  validateAnswer,
  calculateClientScore
};
