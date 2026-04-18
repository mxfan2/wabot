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
  const match = text.match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
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
      return clean.length >= CONFIG.TEXT_MIN_LENGTH;
    },
    errorMsg: "Por favor introduce un valor de texto válido (mínimo 2 caracteres)."
  },

  numeric: {
    validate: (value) => {
      const num = parseInt(value, 10);
      return !isNaN(num) && num > 0;
    },
    errorMsg: "Por favor introduzca un valor numérico válido."
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
      return clean.length >= CONFIG.ADDRESS_MIN_LENGTH;
    },
    errorMsg: `Por favor introduzca una dirección válida (mínimo ${CONFIG.ADDRESS_MIN_LENGTH} caracteres).`
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
      // Accept: "2", "2 años", "2 años y 8 meses", etc.
      const hasNumber = /\d/.test(clean);
      return hasNumber && clean.length >= 1;
    },
    errorMsg: "Por favor introduzca el tiempo (ej: 2 años, 2 años y 8 meses, 2.5)"
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

  // Scoring criteria:
  // +20: Income proof available (yes)
  // +5/+10/+20: Years at job (1-2/3-5/6+ years)
  // +5/+10/+20: Years at home (1-2/3-5/6+ years)
  // +15: Home owner name matches full name
  // +15: No debt with lender
  // +5/+10: Marital status (married/single)
  // +10: Age 25-55 (prime working age)
  // Max score: 100

  // Income proof available (+20 if yes)
  if (fuzzyMatch(client.income_proof_available, KEYWORDS.YES, 2)) {
    score += CONFIG.SCORING.INCOME_PROOF;
  }

  // Years at job (parse numbers from text)
  const jobYears = extractNumberFromText(client.years_at_job);
  if (jobYears >= 6) score += CONFIG.SCORING.JOB_YEARS['6+'];
  else if (jobYears >= 3) score += CONFIG.SCORING.JOB_YEARS['3-5'];
  else if (jobYears >= 1) score += CONFIG.SCORING.JOB_YEARS['1-2'];

  // Years at home
  const homeYears = extractNumberFromText(client.years_at_home);
  if (homeYears >= 6) score += CONFIG.SCORING.HOME_YEARS['6+'];
  else if (homeYears >= 3) score += CONFIG.SCORING.HOME_YEARS['3-5'];
  else if (homeYears >= 1) score += CONFIG.SCORING.HOME_YEARS['1-2'];

  // Home owner name (if matches full name)
  if (client.home_owner_name && client.full_name) {
    const ownerClean = normalizeText(client.home_owner_name);
    const nameClean = normalizeText(client.full_name);
    if (ownerClean.includes(nameClean) || nameClean.includes(ownerClean)) {
      score += CONFIG.SCORING.HOME_OWNERSHIP;
    }
  }

  // Debt with lender (no debt = good)
  if (fuzzyMatch(client.debt_with_lender, KEYWORDS.NO, 2)) {
    score += CONFIG.SCORING.NO_DEBT;
  }

  // Marital status (married = stable, single = flexible)
  if (client.marital_status) {
    const status = normalizeText(client.marital_status);
    if (status.includes('casado')) score += CONFIG.SCORING.MARITAL_STATUS.married;
    else if (status.includes('soltero')) score += CONFIG.SCORING.MARITAL_STATUS.single;
  }

  // Age (prime working age)
  const age = parseInt(client.age);
  if (!isNaN(age) && age >= CONFIG.SCORING.AGE_RANGE.min && age <= CONFIG.SCORING.AGE_RANGE.max) {
    score += CONFIG.SCORING.AGE_RANGE.points;
  }

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
  getHoursSince,
  shouldRemind,
  validateAnswer,
  calculateClientScore
};
