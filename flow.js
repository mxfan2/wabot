// =========================
// IMPORTS
// =========================
const { MESSAGES, KEYWORDS, DOCUMENTS, CONFIG } = require("./config");
const {
  fuzzyMatch,
  includesKeyword,
  normalizeText,
  seemsLikePhoneNumber,
  seemsLikeQuestion,
  shouldRemind,
  calculateClientScore,
  validateAnswer
} = require("./utils");
const { sendTextMessage } = require("./whatsapp");
const { chooseApprovedReply, draftFlexibleReply, classifyFlowAnswer } = require("./aiOperator");
const {
  getClient,
  resetToStage1,
  moveToStage2,
  startQualificationFlow,
  moveToDocumentsStage,
  markNotInterested,
  updateClient,
  discardClientApplication
} = require("./database");

// =========================
// QUESTION FLOW (OPTIMIZED)
// =========================
const QUESTION_FLOW = [
  {
    step: "q1_full_name",
    field: "full_name",
    question: "Perfecto. Para revisar tu solicitud necesito hacerte unas preguntas rápidas.\n\nPrimero, ¿me confirmas tu nombre completo?",
    validationType: "text"
  },
  {
    step: "q2_age",
    field: "age",
    question: "¿Qué edad tienes?",
    validationType: "age"
  },
  {
    step: "q3_personal_phone_confirmed",
    field: "personal_phone_confirmed",
    question: "¿Este número de WhatsApp es tu celular personal?",
    validationType: "yesno"
  },
  {
    step: "q3b_personal_phone_number",
    field: "personal_phone_number",
    question: "¿Cuál es tu número de celular personal?",
    validationType: "phone"
  },
  {
    step: "q4_marital_status",
    field: "marital_status",
    question: "¿Estás soltero(a), casado(a), viudo(a), divorciado(a) o separado(a)?",
    validationType: "marital_status"
  },
  {
    step: "q5_debt_with_lender",
    field: "debt_with_lender",
    preMessage: "Aquí sí necesito que me respondas con confianza:",
    question: "¿Actualmente debes o has quedado a deber en alguna casa de préstamos?",
    validationType: "yesno"
  },
  {
    step: "q6_job_name",
    field: "job_name",
    question: "Ahora vamos con tus ingresos.\n\n¿De dónde viene tu ingreso principal?",
    validationType: "text"
  },
  {
    step: "q6b_income_type",
    field: "income_type",
    question: "¿Es empleo, negocio propio, pensión, apoyo familiar, desempleado u otro?",
    validationType: "income_type"
  },
  {
    step: "q7_income_proof_available",
    field: "income_proof_available",
    question: "¿Tienes comprobante de ingresos?",
    validationType: "yesno"
  },
  {
    step: "q8_work_address",
    field: "work_address",
    question: "¿Cuál es la dirección de tu trabajo?",
    validationType: "address"
  },
  {
    step: "q8b_work_phone",
    field: "work_phone",
    question: "¿Tu trabajo tiene teléfono? ¿Cuál es?",
    validationType: "phone"
  },
  {
    step: "q9_years_at_job",
    field: "years_at_job",
    question: "¿Cuánto tiempo llevas trabajando ahí? (ej: 2 años, 2.5, etc.)",
    validationType: "time_period"
  },
  {
    step: "q10_home_address",
    field: "home_address",
    question: "¿Cuál es la dirección de tu domicilio?",
    validationType: "address"
  },
  {
    step: "q11_average_income",
    field: "average_income",
    question: "¿Cuánto ganas aproximadamente?",
    validationType: "income_amount"
  },
  {
    step: "q11b_income_frequency",
    field: "income_frequency",
    question: "¿Ese ingreso es por semana, quincena o mes?",
    validationType: "income_frequency"
  },
  {
    step: "q11c_extra_household_income_available",
    field: "extra_household_income_available",
    question: "¿En tu casa hay otro ingreso aparte del tuyo?",
    validationType: "yesno"
  },
  {
    step: "q11d_extra_household_income_details",
    field: "extra_household_income_details",
    question: "¿Quién aporta ese ingreso, cuánto aporta y cada cuándo?",
    validationType: "household_income_details"
  },
  {
    step: "q11e_current_debt_payments",
    field: "current_debt_payments",
    question: "¿Cuánto pagas por semana o quincena en otras deudas? Si no tienes, responde *0*.",
    validationType: "debt_payments"
  },
  {
    step: "q12_years_at_home",
    field: "years_at_home",
    question: "¿Cuánto tiempo llevas viviendo en esa casa?",
    validationType: "time_period"
  },
  {
    step: "q13_home_owner_name",
    field: "home_owner_name",
    question: "¿A nombre de quién está la casa donde vives?",
    validationType: "text"
  },
  {
    step: "q14_address_proof_name",
    field: "address_proof_name",
    question: "¿A nombre de quién aparece el comprobante de domicilio?",
    validationType: "text"
  }
];

// =========================
// HELPERS
// =========================
function getQuestionIndexByStep(step) {
  return QUESTION_FLOW.findIndex((q) => q.step === step);
}

function getNextDocumentKey(current) {
  const index = DOCUMENTS.ORDER.indexOf(current);
  if (index === -1) return null;
  return DOCUMENTS.ORDER[index + 1] || null;
}

function getDocumentFieldName(docKey) {
  return DOCUMENTS.FIELDS[docKey] || null;
}

function exactKeywordMatch(text, keywords) {
  const clean = normalizeText(text);
  return keywords.has(clean);
}

// SOLO ciertas preguntas pueden omitirse
const OPTIONAL_QUESTION_STEPS = new Set([
  "q8b_work_phone"
]);

function isSkipCommand(text) {
  return exactKeywordMatch(text, KEYWORDS.SKIP);
}

function isDoneCommand(text) {
  return exactKeywordMatch(text, KEYWORDS.DONE) || fuzzyMatch(text, KEYWORDS.DONE, 1);
}

function asksToRepeatQuestion(text) {
  const clean = normalizeText(text);
  return [
    "que pregunta",
    "qué pregunta",
    "cual pregunta",
    "cuál pregunta",
    "cual era la pregunta",
    "cuál era la pregunta",
    "repite",
    "repitela",
    "repítela",
    "no entendi",
    "no entendí"
  ].some((phrase) => clean.includes(phrase));
}

async function repeatCurrentQuestion(to, client, userText = "") {
  const currentIndex = getQuestionIndexByStep(client?.question_step);
  const currentQuestion = QUESTION_FLOW[currentIndex];

  if (!currentQuestion) {
    await sendTextMessage(to, "No encontré una pregunta pendiente. Escribe *estado* y revisamos dónde vas.");
    return;
  }

  const prefix = userText ? "Claro, te la repito:" : "Seguimos con esta pregunta:";
  await sendTextMessage(to, `${prefix}\n\n${buildQuestionMessage(currentQuestion)}`);
}
// =========================
// QUESTION SENDER (OPTIMIZED)
// =========================
function buildQuestionMessage(question, prefix = "") {
  const parts = [];

  if (prefix) parts.push(prefix);
  if (question.preMessage) parts.push(question.preMessage);
  parts.push(question.question);

  if (OPTIONAL_QUESTION_STEPS.has(question.step)) {
    parts.push("Si no cuentas con ese dato, escribe *omitir*.");
  }

  return parts.filter(Boolean).join("\n\n");
}

function buildQuestionPrefix(context = {}) {
  if (!context.previousQuestionStep) return "";

  const normalizedAnswer = normalizeText(context.interpretedAnswer || context.userText || "");

  if (normalizedAnswer === "omitir") return "Listo, lo dejamos omitido.";
  if (context.previousQuestionStep === "q5_debt_with_lender") return "Gracias por responder con confianza.";
  if (context.previousQuestionStep === "q6b_income_type") return "Perfecto, entendido.";
  if (context.previousQuestionStep === "q8_work_address") return "Listo, ya tengo la dirección del trabajo.";
  if (context.previousQuestionStep === "q8b_work_phone") return "Listo, seguimos.";

  return "Listo, gracias.";
}

async function sendQuestionByIndex(to, index) {
  const question = QUESTION_FLOW[index];
  if (!question) return;

  await sendTextMessage(to, buildQuestionMessage(question));
}

async function sendHumanizedQuestion(to, index, context = {}) {
  const question = QUESTION_FLOW[index];
  if (!question) return;

  await sendTextMessage(to, buildQuestionMessage(question, buildQuestionPrefix(context)));
}

// =========================
// STAGE 1 (MENÚ)
// =========================
async function handleStage1(client, text, from, profileName) {
  const clean = normalizeText(text);

  const wantsInfo = includesKeyword(clean, KEYWORDS.STAGE1_FAQ);
  const wantsApplication = includesKeyword(clean, KEYWORDS.STAGE2_INTERESTED);

  // 🔥 CAMBIO CLAVE: si ya quiere préstamo → directo a calificación
  if (wantsApplication) {
    await startQualificationFlow(from);
    await sendQuestionByIndex(from, 0);
    return true;
  }

  if (wantsInfo) {
    await moveToStage2(from);
    await sendTextMessage(from, MESSAGES.FAQ);
    return true;
  }

  // fallback
  await resetToStage1(from, profileName);
  await sendTextMessage(from, await chooseApprovedReply("loopback", {
    wa_id: from,
    userText: text,
    stage: client?.stage
  }, MESSAGES.LOOPBACK));

  return true;
}

// =========================
// STAGE 2 (FAQ → INTERÉS)
// =========================
async function handleStage2(client, text, from, profileName) {

  // interesado → iniciar flujo
  if (includesKeyword(text, KEYWORDS.STAGE2_INTERESTED)) {
    await startQualificationFlow(from);
    await sendQuestionByIndex(from, 0);
    return true;
  }

  // no interesado
  if (includesKeyword(text, KEYWORDS.STAGE2_NOT_INTERESTED)) {
    await markNotInterested(from);
    await sendTextMessage(from, await chooseApprovedReply("not_interested", {
      wa_id: from,
      userText: text
    }, "Gracias por tu tiempo."));
    return true;
  }

  // fallback
  await resetToStage1(from, profileName);
  await sendTextMessage(from, await chooseApprovedReply("loopback", {
    wa_id: from,
    userText: text,
    stage: client?.stage
  }, MESSAGES.LOOPBACK));

  return true;
}

// =========================
// QUALIFICATION FLOW (CORE)
// =========================
async function handleQualificationFlow(client, text, from) {
  const currentIndex = getQuestionIndexByStep(client.question_step);

  if (currentIndex === -1) {
    await startQualificationFlow(from);
    await sendQuestionByIndex(from, 0);
    return true;
  }

  const currentQuestion = QUESTION_FLOW[currentIndex];

  // =========================
  // CLASIFICADORES IA PARA RESPUESTAS NATURALES
  // =========================
  if (currentQuestion.step === "q5_debt_with_lender") {
    const classified = await classifyFlowAnswer({ classifier: "debt_yes_no", userText: text, currentQuestion, client });
    if (classified.recognized && classified.confidence >= 0.7 && (classified.value === "yes" || classified.value === "no")) {
      const debtValue = classified.value === "yes" ? "si" : "no";
      await updateClient(from, { debt_with_lender: debtValue });
      const nextIndex = currentIndex + 1;
      const nextQuestion = QUESTION_FLOW[nextIndex];
      await updateClient(from, {
        question_step: nextQuestion.step,
        stage: nextIndex <= 5 ? "section_1" : "section_2"
      });
      await sendHumanizedQuestion(from, nextIndex, {
        stage: nextIndex <= 5 ? "section_1" : "section_2",
        previousQuestionStep: currentQuestion.step,
        userText: text,
        interpretedAnswer: debtValue
      });
      return true;
    }
  }

  if (currentQuestion.step === "q6_job_name") {
    const classified = await classifyFlowAnswer({ classifier: "income_source", userText: text, currentQuestion, client });
    if (classified.recognized && classified.confidence >= 0.7 && classified.value !== "unknown") {
      const updates = {
        job_name: text,
        income_type: classified.value
      };
      await updateClient(from, updates);
      const nextIndex = getQuestionIndexByStep("q7_income_proof_available");
      const nextQuestion = QUESTION_FLOW[nextIndex];
      await updateClient(from, {
        question_step: nextQuestion.step,
        stage: "section_2"
      });
      await sendHumanizedQuestion(from, nextIndex, {
        stage: "section_2",
        previousQuestionStep: currentQuestion.step,
        userText: text,
        interpretedAnswer: classified.value
      });
      return true;
    }
  }

  if (currentQuestion.step === "q6b_income_type") {
    const classified = await classifyFlowAnswer({ classifier: "income_source", userText: text, currentQuestion, client });
    if (classified.recognized && classified.confidence >= 0.7 && classified.value !== "unknown") {
      const updates = {
        income_type: classified.value
      };
      await updateClient(from, updates);
      const nextIndex = currentIndex + 1;
      const nextQuestion = QUESTION_FLOW[nextIndex];
      await updateClient(from, {
        question_step: nextQuestion.step,
        stage: "section_2"
      });
      await sendTextMessage(from, await draftFlexibleReply({
        situation: "acknowledge_income_type",
        wa_id: from,
        stage: client.stage,
        questionStep: currentQuestion.step,
        userText: text,
        interpretedIncomeType: classified.value,
        desiredOutcome: "Confirm the income type naturally and briefly."
      }, "Perfecto, entendido."));
      await sendHumanizedQuestion(from, nextIndex, {
        stage: "section_2",
        previousQuestionStep: currentQuestion.step,
        userText: text,
        interpretedAnswer: classified.value
      });
      return true;
    }
  }

  // =========================
  // SI EL USUARIO HACE PREGUNTA
  // =========================
  if (seemsLikeQuestion(text)) {
    if (asksToRepeatQuestion(text)) {
      await repeatCurrentQuestion(from, client, text);
      return true;
    }

    const fallbackReply = `Te ayudo, pero primero necesito esta respuesta para seguir:\n\n${currentQuestion.question}`;

    await sendTextMessage(from, await draftFlexibleReply({
      situation: "user_asked_question_mid_flow",
      wa_id: from,
      stage: client.stage,
      questionStep: currentQuestion.step,
      currentQuestion: currentQuestion.question,
      userText: text
    }, fallbackReply));

    return true;
  }

  // =========================
  // OMITIR
  // =========================
  if (isSkipCommand(text)) {
    if (!OPTIONAL_QUESTION_STEPS.has(currentQuestion.step)) {
      await sendTextMessage(from, await draftFlexibleReply({
        situation: "skip_not_allowed_for_required_question",
        wa_id: from,
        stage: client.stage,
        questionStep: currentQuestion.step,
        currentQuestion: currentQuestion.question,
        userText: text,
        desiredOutcome: "Explain briefly that this question is needed and ask the applicant to answer it."
      }, "Esta pregunta sí la necesito para continuar. ¿Me puedes responder, por favor?"));
      return true;
    }

    await updateClient(from, { [currentQuestion.field]: "OMITIDO" });

    const nextIndex = currentIndex + 1;

    if (nextIndex < QUESTION_FLOW.length) {
      const nextQuestion = QUESTION_FLOW[nextIndex];

      await updateClient(from, {
        question_step: nextQuestion.step,
        stage: nextIndex <= 5 ? "section_1" : "section_2"
      });

      await sendHumanizedQuestion(from, nextIndex, {
        stage: nextIndex <= 5 ? "section_1" : "section_2",
        previousQuestionStep: currentQuestion.step,
        userText: text,
        interpretedAnswer: "omitir"
      });
      return true;
    }

    // fin → documentos
    const updatedClient = await getClient(from);
    const score = calculateClientScore(updatedClient);

    await updateClient(from, { score });
    await moveToDocumentsStage(from);

    await sendTextMessage(from, MESSAGES.DOCUMENTS_INTRO);
    await sendTextMessage(from, DOCUMENTS.PROMPTS.ine_front);

    return true;
  }
  // =========================
  // TELÉFONO PERSONAL
  // =========================
  if (currentQuestion.step === "q2_age") {
    const age = parseInt(String(text || "").replace(/\D/g, ""), 10);

    if (!Number.isNaN(age) && age <= 17) {
      await updateClient(from, {
        age: text,
        stage: "closed",
        question_step: null,
        status: "underage",
        expected_document: null
      });

      await sendTextMessage(from, MESSAGES.UNDERAGE);
      return true;
    }
  }

  // =========================
  // TELÉFONO PERSONAL
  // =========================
  if (currentQuestion.step === "q3_personal_phone_confirmed") {
    if (seemsLikePhoneNumber(text)) {
      const nextIndex = getQuestionIndexByStep("q4_marital_status");
      const nextQuestion = QUESTION_FLOW[nextIndex];

      await updateClient(from, {
        personal_phone_confirmed: "no",
        personal_phone_number: text,
        question_step: nextQuestion.step,
        stage: "section_1"
      });

      await sendTextMessage(from, await chooseApprovedReply("personal_phone_saved", {
        wa_id: from,
        questionStep: currentQuestion.step
      }, "Listo, tomaré ese número como tu celular personal."));

      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    if (exactKeywordMatch(text, KEYWORDS.YES)) {
      const nextIndex = getQuestionIndexByStep("q4_marital_status");
      const nextQuestion = QUESTION_FLOW[nextIndex];

      await updateClient(from, {
        personal_phone_confirmed: text,
        question_step: nextQuestion.step,
        stage: "section_1"
      });

      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    if (exactKeywordMatch(text, KEYWORDS.NO)) {
      const nextIndex = getQuestionIndexByStep("q3b_personal_phone_number");
      const nextQuestion = QUESTION_FLOW[nextIndex];

      await updateClient(from, {
        personal_phone_confirmed: text,
        question_step: nextQuestion.step,
        stage: "section_1"
      });

      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    await sendTextMessage(from, await chooseApprovedReply("yes_no_only", {
      wa_id: from,
      questionStep: currentQuestion.step,
      userText: text
    }, "Aquí solo necesito que me respondas *sí* o *no*."));

    return true;
  }

  // =========================
  // INGRESO EXTRA EN EL HOGAR
  // =========================
  if (currentQuestion.step === "q11c_extra_household_income_available") {
    if (hasHouseholdIncomeDetails(text)) {
      const nextIndex = getQuestionIndexByStep("q11e_current_debt_payments");
      const nextQuestion = QUESTION_FLOW[nextIndex];

      await updateClient(from, {
        extra_household_income_available: "si",
        extra_household_income_details: text,
        question_step: nextQuestion.step,
        stage: "section_2"
      });

      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    if (exactKeywordMatch(text, KEYWORDS.YES)) {
      const nextIndex = getQuestionIndexByStep("q11d_extra_household_income_details");
      const nextQuestion = QUESTION_FLOW[nextIndex];

      await updateClient(from, {
        extra_household_income_available: text,
        question_step: nextQuestion.step,
        stage: "section_2"
      });

      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    if (exactKeywordMatch(text, KEYWORDS.NO)) {
      const nextIndex = getQuestionIndexByStep("q11e_current_debt_payments");
      const nextQuestion = QUESTION_FLOW[nextIndex];

      await updateClient(from, {
        extra_household_income_available: text,
        extra_household_income_details: null,
        question_step: nextQuestion.step,
        stage: "section_2"
      });

      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    await sendTextMessage(from, await draftFlexibleReply({
      situation: "unclear_extra_household_income_answer",
      wa_id: from,
      stage: client.stage,
      questionStep: currentQuestion.step,
      currentQuestion: currentQuestion.question,
      userText: text,
      desiredOutcome: "Ask clearly if there is extra household income. If yes, ask who contributes, how much, and how often."
    }, "Si sí, dime quién aporta, cuánto y cada cuándo. Si no, responde *no*."));

    return true;
  }

  // =========================
  // TELÉFONO DE TRABAJO NO DISPONIBLE
  // =========================
  if (currentQuestion.step === "q8b_work_phone" && inferMissingWorkPhone(text)) {
    await sendTextMessage(from, await draftFlexibleReply({
      situation: "applicant_says_work_has_no_phone",
      wa_id: from,
      stage: client.stage,
      questionStep: currentQuestion.step,
      currentQuestion: currentQuestion.question,
      userText: text,
      desiredOutcome: "Tell the applicant they can write omitir if there is no work phone."
    }, "No hay problema. Si tu trabajo no tiene teléfono, escribe *omitir* y seguimos."));

    return true;
  }

  // =========================
  // VALIDACIÓN NORMAL
  // =========================
  const validation = validateAnswer(text, currentQuestion.validationType);

  if (!validation.valid) {
    const reminder = OPTIONAL_QUESTION_STEPS.has(currentQuestion.step)
      ? `${validation.errorMsg}\n\nSi no cuentas con ese dato, escribe *omitir*.`
      : validation.errorMsg;

    await sendTextMessage(from, await draftFlexibleReply({
      situation: "invalid_or_unclear_answer_to_current_question",
      wa_id: from,
      stage: client.stage,
      questionStep: currentQuestion.step,
      currentQuestion: currentQuestion.question,
      validationType: currentQuestion.validationType,
      validationError: validation.errorMsg,
      userText: text,
      desiredOutcome: "Help the applicant understand what answer is needed without sounding robotic."
    }, reminder));

    return true;
  }

  // =========================
  // GUARDAR RESPUESTA Y AVANZAR
  // =========================
  await updateClient(from, { [currentQuestion.field]: text });

  const nextIndex = currentIndex + 1;

  if (nextIndex < QUESTION_FLOW.length) {
    const nextQuestion = QUESTION_FLOW[nextIndex];

    await updateClient(from, {
      question_step: nextQuestion.step,
      stage: nextIndex <= 5 ? "section_1" : "section_2"
    });

    await sendHumanizedQuestion(from, nextIndex, {
      stage: nextIndex <= 5 ? "section_1" : "section_2",
      previousQuestionStep: currentQuestion.step,
      userText: text
    });
    return true;
  }

  // =========================
  // TERMINA CALIFICACIÓN → DOCUMENTOS
  // =========================
  const updatedClient = await getClient(from);
  const score = calculateClientScore(updatedClient);

  console.log(`Client ${from} completed qualification. Score: ${score}/100`);

  await updateClient(from, { score });
  await moveToDocumentsStage(from);

  await sendTextMessage(from, MESSAGES.DOCUMENTS_INTRO);
  await sendTextMessage(from, DOCUMENTS.PROMPTS.ine_front);

  return true;
}
// =========================
// INTENT HELPERS
// =========================
function inferIncomeProofIssue(text) {
  const clean = normalizeText(text);
  const phrases = [
    "no tengo",
    "no cuento con",
    "me pagan en efectivo",
    "pagan en efectivo",
    "en efectivo",
    "no me depositan",
    "no tengo comprobante",
    "no manejo banco",
    "me pagan cash"
  ];

  return phrases.some((phrase) => clean.includes(phrase));
}

function inferMissingWorkPhone(text) {
  const clean = normalizeText(text);
  const phrases = [
    "no tengo numero",
    "no tengo número",
    "no cuento con numero",
    "no cuento con número",
    "sin numero",
    "sin número",
    "no hay telefono",
    "no hay teléfono",
    "no tiene telefono",
    "no tiene teléfono"
  ];

  return phrases.some((phrase) => clean.includes(phrase));
}

function hasHouseholdIncomeDetails(text) {
  const clean = normalizeText(text);
  const hasAmount = /\d/.test(clean);
  const hasFrequency =
    clean.includes("semana") ||
    clean.includes("quincena") ||
    clean.includes("mes") ||
    clean.includes("mensual");

  const hasContributor = [
    "esposo", "esposa", "pareja", "mama", "mamá", "papa", "papá",
    "hijo", "hija", "hermano", "hermana", "familia", "yo", "negocio"
  ].some((word) => clean.includes(word));

  return hasAmount && hasFrequency && hasContributor;
}

// =========================
// DOCUMENT HELPERS
// =========================
function getStoredDocumentValues(rawValue) {
  if (!rawValue) return [];
  if (rawValue === "SKIPPED") return ["SKIPPED"];

  try {
    const parsed = JSON.parse(rawValue);
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean);
    }
  } catch (error) {
    // Older rows may still contain a single plain path.
  }

  return [rawValue];
}

function appendDocumentValue(rawValue, nextValue) {
  const values = getStoredDocumentValues(rawValue).filter((value) => value !== "SKIPPED");
  values.push(nextValue);
  return JSON.stringify(values);
}

function hasUsableDocumentValue(rawValue) {
  return getStoredDocumentValues(rawValue).some((value) => value && value !== "SKIPPED");
}

function getDocumentProgress(client) {
  const docs = {
    ine_front: client.ine_front_path,
    ine_back: client.ine_back_path,
    proof_of_address: client.proof_of_address_path,
    house_front: client.house_front_path,
    income_proof: client.income_proof_path
  };

  const total = Object.keys(docs).length;
  const completed = Object.values(docs).filter((path) => path).length;

  return { completed, total };
}

// =========================
// REMIND CURRENT STEP
// =========================
async function remindCurrentStep(to, client) {
  if (!client || !client.stage) {
    await sendTextMessage(to, MESSAGES.MENU);
    return;
  }

  switch (client.stage) {
    case "stage_1":
      await sendTextMessage(to, MESSAGES.MENU);
      return;

    case "stage_2":
      await sendTextMessage(to, MESSAGES.FAQ);
      return;

    case "section_1":
    case "section_2": {
      const currentIndex = getQuestionIndexByStep(client.question_step);
      if (currentIndex === -1) {
        await sendQuestionByIndex(to, 0);
        return;
      }

      await sendQuestionByIndex(to, currentIndex);
      return;
    }

    case "awaiting_documents":
      if (client.expected_document && DOCUMENTS.PROMPTS[client.expected_document]) {
        await sendTextMessage(to, DOCUMENTS.PROMPTS[client.expected_document]);
        return;
      }

      await sendTextMessage(to, MESSAGES.DOCUMENTS_INTRO);
      return;

    case "under_review":
      await sendTextMessage(to, MESSAGES.UNDER_REVIEW);
      return;

    case "contacted":
      await sendTextMessage(to, MESSAGES.CONTACTED);
      return;

    case "closed":
      await sendTextMessage(to, MESSAGES.CLOSED);
      return;

    default:
      await sendTextMessage(to, MESSAGES.MENU);
  }
}

// =========================
// ADVANCE DOCUMENTS
// =========================
async function advanceDocumentsFlow(from, currentDoc, currentValue = null) {
  const fieldName = getDocumentFieldName(currentDoc);
  const nextDoc = getNextDocumentKey(currentDoc);

  const completionMessage = currentValue === "SKIPPED"
    ? "Documento omitido."
    : await chooseApprovedReply("document_received", {
        wa_id: from,
        expectedDocument: currentDoc
      }, "Listo, documento recibido.");

  if (nextDoc) {
    await updateClient(from, {
      [fieldName]: currentValue,
      expected_document: nextDoc
    });

    await sendTextMessage(from, completionMessage);
    await sendTextMessage(from, DOCUMENTS.PROMPTS[nextDoc]);
    return true;
  }

  await updateClient(from, {
    [fieldName]: currentValue,
    stage: "under_review",
    expected_document: null,
    status: "documents_uploaded"
  });

  const finalClient = await getClient(from);

  if (finalClient) {
    await updateClient(from, { score: calculateClientScore(finalClient) });
  }

  await sendTextMessage(from, MESSAGES.DOCUMENTS_CLOSE);
  return false;
}

// =========================
// NEW APPLICATION CONFIRMATION
// =========================
async function beginNewApplicationConfirmation(client, from) {
  if (!client || client.stage === "stage_1") {
    await sendTextMessage(from, MESSAGES.MENU);
    return true;
  }

  await updateClient(from, { pending_action: "confirm_restart" });

  await sendTextMessage(from, await chooseApprovedReply("confirm_restart_prompt", {
    wa_id: from,
    stage: client.stage,
    status: client.status
  }, MESSAGES.NEW_APPLICATION_WARNING));

  return true;
}

// =========================
// PENDING ACTIONS
// =========================
async function resolvePendingAction(client, text, from, profileName) {
  if (!client?.pending_action) return false;

  if (client.pending_action === "confirm_restart") {
    if (asksToRepeatQuestion(text) && (client.stage === "section_1" || client.stage === "section_2")) {
      await updateClient(from, { pending_action: null });
      const refreshedClient = await getClient(from);
      await repeatCurrentQuestion(from, refreshedClient, text);
      return true;
    }

    if (exactKeywordMatch(text, KEYWORDS.YES)) {
      await discardClientApplication(from, profileName);

      await sendTextMessage(from, await chooseApprovedReply("restart_confirmed", {
        wa_id: from,
        userText: text
      }, "Listo, vamos a empezar una nueva solicitud."));

      await sendTextMessage(from, MESSAGES.MENU);
      return true;
    }

    if (exactKeywordMatch(text, KEYWORDS.NO)) {
      await updateClient(from, { pending_action: null });

      await sendTextMessage(from, await chooseApprovedReply("keep_current_application", {
        wa_id: from,
        userText: text,
        stage: client.stage
      }, "Perfecto, seguimos con tu solicitud actual."));

      const refreshedClient = await getClient(from);
      await remindCurrentStep(from, refreshedClient);
      return true;
    }

    await sendTextMessage(from, await chooseApprovedReply("invalid_restart_confirmation", {
      wa_id: from,
      userText: text,
      stage: client.stage,
      questionStep: client.question_step,
      pendingAction: client.pending_action,
      expectedAnswer: "yes_or_no_for_restart_confirmation"
    }, "Aquí solo necesito que me respondas *sí* o *no*."));

    return true;
  }

  return false;
}
// =========================
// STATUS MANAGEMENT
// =========================
async function sendStatusMessage(to, client) {
  if (!client) {
    await sendTextMessage(to, "No tengo información de tu proceso actual.");
    return;
  }

  let statusMessage = `*ESTADO DE TU SOLICITUD*\n\n`;

  switch (client.stage) {
    case "stage_1":
      statusMessage += `📍 Estás en el menú principal\n`;
      statusMessage += `Siguiente paso: elegir una opción del menú`;
      break;

    case "stage_2":
      statusMessage += `📍 Estás revisando la información del préstamo\n`;
      statusMessage += `Siguiente paso: indicar si quieres continuar`;
      break;

    case "section_1":
    case "section_2": {
      const currentIndex = getQuestionIndexByStep(client.question_step);
      const totalQuestions = QUESTION_FLOW.length;
      const completed = currentIndex >= 0 ? currentIndex : 0;
      const remaining = currentIndex >= 0 ? totalQuestions - currentIndex : totalQuestions;

      statusMessage += `📍 Contestando preguntas de calificación\n`;
      statusMessage += `Progreso: ${completed}/${totalQuestions} preguntas completadas\n`;
      statusMessage += `Faltan: ${remaining} preguntas\n`;

      if (currentIndex >= 0 && currentIndex < QUESTION_FLOW.length) {
        const currentQuestion = QUESTION_FLOW[currentIndex];
        statusMessage += `Pregunta actual: ${currentQuestion.question.split("\n").pop()}`;
      }

      break;
    }

    case "awaiting_documents": {
      const docProgress = getDocumentProgress(client);

      statusMessage += `📍 Enviando documentos\n`;
      statusMessage += `Progreso: ${docProgress.completed}/${docProgress.total} documentos enviados\n`;

      if (client.expected_document && DOCUMENTS.PROMPTS[client.expected_document]) {
        statusMessage += `Documento pendiente:\n${DOCUMENTS.PROMPTS[client.expected_document]}`;
      } else {
        statusMessage += `Documento pendiente: documento específico`;
      }

      break;
    }

    case "under_review":
      statusMessage += `📍 Tu solicitud ya está en revisión\n`;
      statusMessage += `Estado: esperando contacto de un asesor\n`;
      statusMessage += `Documentos: ${getDocumentProgress(client).completed}/5 completados\n\n`;
      statusMessage += `Si necesitas iniciar otra solicitud, escribe *nueva solicitud*.`;
      break;

    case "contacted":
      statusMessage += `📍 Un asesor ya se puso en contacto contigo\n`;
      statusMessage += `Estado: seguimiento posterior al contacto\n`;
      statusMessage += `Documentos: ${getDocumentProgress(client).completed}/5 completados\n\n`;
      statusMessage += `Si necesitas iniciar otra solicitud, escribe *nueva solicitud*.`;
      break;

    case "closed":
      statusMessage += `📍 Proceso finalizado\n`;
      statusMessage += `Puedes iniciar otra solicitud escribiendo *nueva solicitud*.`;
      break;

    default:
      statusMessage += `📍 Estado desconocido`;
  }

  await sendTextMessage(to, statusMessage);
}

// =========================
// DOCUMENTS STAGE
// =========================
async function handleDocumentsStage(client, text, from) {
  if (!client?.expected_document) {
    await sendTextMessage(from, await chooseApprovedReply("missing_expected_document", {
      wa_id: from,
      stage: client?.stage,
      userText: text
    }, "No encontré el documento pendiente. Retomemos tu flujo actual."));

    await remindCurrentStep(from, client);
    return true;
  }

  if (isSkipCommand(text)) {
    const fieldName = getDocumentFieldName(client.expected_document);
    const currentValue = client[fieldName];
    const valueToStore = hasUsableDocumentValue(currentValue) ? currentValue : "SKIPPED";

    const shouldContinue = await advanceDocumentsFlow(from, client.expected_document, valueToStore);

    if (!shouldContinue) {
      const updatedClient = await getClient(from);
      await require("./whatsapp").notifyAdvisor(updatedClient);
    }

    return true;
  }

  if (client.expected_document === "income_proof" && isDoneCommand(text)) {
    const currentValue = client.income_proof_path;

    if (!hasUsableDocumentValue(currentValue)) {
      await sendTextMessage(from, await chooseApprovedReply("no_income_proof_yet", {
        wa_id: from,
        stage: client.stage,
        expectedDocument: client.expected_document,
        userText: text
      }, "Todavía no recibo comprobante de ingresos. Puedes mandarlo ahora o escribir *omitir*."));

      return true;
    }

    const updatedClient = await getClient(from);
    const shouldContinue = await advanceDocumentsFlow(
      from,
      client.expected_document,
      updatedClient.income_proof_path
    );

    if (!shouldContinue) {
      const finalClient = await getClient(from);
      await require("./whatsapp").notifyAdvisor(finalClient);
    }

    return true;
  }

  if (client.expected_document === "income_proof" && inferIncomeProofIssue(text)) {
    await sendTextMessage(from, await chooseApprovedReply("income_proof_issue", {
      wa_id: from,
      stage: client.stage,
      expectedDocument: client.expected_document,
      userText: text
    }, "No pasa nada si no tienes talón. Puedes mandar capturas de depósitos, estado de cuenta o escribir *omitir*."));

    return true;
  }

  if (shouldRemind(client.updated_at, CONFIG.DOCUMENT_REMINDER_HOURS)) {
    const prompt = DOCUMENTS.PROMPTS[client.expected_document];

    if (prompt) {
      await sendTextMessage(from, `Recordatorio:\n\n${prompt}`);
      return true;
    }
  }

  if (client.expected_document === "income_proof") {
    await sendTextMessage(from, await chooseApprovedReply("income_proof_instruction", {
      wa_id: from,
      stage: client.stage,
      expectedDocument: client.expected_document,
      userText: text
    }, "Puedes enviar uno o varios comprobantes. Cuando termines, escribe *listo*. Si no tienes comprobante, escribe *omitir*."));

    return true;
  }

  await sendTextMessage(from, await chooseApprovedReply("document_required", {
    wa_id: from,
    stage: client.stage,
    expectedDocument: client.expected_document,
    userText: text
  }, "Para continuar necesito que mandes el documento solicitado."));

  return true;
}

// =========================
// UNDER REVIEW
// =========================
async function handleUnderReview(client, text, from, profileName) {
  if (fuzzyMatch(text, KEYWORDS.STATUS, 2)) {
    await sendStatusMessage(from, client);
    return true;
  }

  if (fuzzyMatch(text, KEYWORDS.NEW_APPLICATION, 2)) {
    return beginNewApplicationConfirmation(client, from);
  }

  if (fuzzyMatch(text, KEYWORDS.UPDATE, 2)) {
    await sendTextMessage(from, await chooseApprovedReply("update_requires_new_application", {
      wa_id: from,
      stage: client.stage,
      userText: text
    }, "Para actualizar tu información, inicia una nueva solicitud escribiendo *nueva solicitud*."));

    return true;
  }

  await sendTextMessage(from, await chooseApprovedReply("under_review", {
    wa_id: from,
    stage: client.stage,
    userText: text
  }, MESSAGES.UNDER_REVIEW));

  return true;
}

// =========================
// CONTACTED
// =========================
async function handleContacted(client, text, from, profileName) {
  if (fuzzyMatch(text, KEYWORDS.STATUS, 2)) {
    await sendStatusMessage(from, client);
    return true;
  }

  if (fuzzyMatch(text, KEYWORDS.NEW_APPLICATION, 2)) {
    return beginNewApplicationConfirmation(client, from);
  }

  if (fuzzyMatch(text, KEYWORDS.UPDATE, 2)) {
    await sendTextMessage(from, await chooseApprovedReply("update_requires_new_application", {
      wa_id: from,
      stage: client.stage,
      userText: text
    }, "Para actualizar tu información, inicia una nueva solicitud escribiendo *nueva solicitud*."));

    return true;
  }

  await sendTextMessage(from, MESSAGES.CONTACTED);
  return true;
}

// =========================
// CLOSED
// =========================
async function handleClosed(client, text, from, profileName) {
  if (fuzzyMatch(text, KEYWORDS.NEW_APPLICATION, 2)) {
    return beginNewApplicationConfirmation(client, from);
  }

  await sendTextMessage(from, MESSAGES.CLOSED);
  return true;
}

// =========================
// EXPORTS
// =========================
module.exports = {
  QUESTION_FLOW,
  getQuestionIndexByStep,
  getNextDocumentKey,
  getDocumentFieldName,
  getDocumentProgress,
  getStoredDocumentValues,
  appendDocumentValue,
  hasUsableDocumentValue,
  isSkipCommand,
  isDoneCommand,
  sendQuestionByIndex,
  remindCurrentStep,
  resolvePendingAction,
  beginNewApplicationConfirmation,
  advanceDocumentsFlow,
  sendStatusMessage,
  handleStage1,
  handleStage2,
  handleQualificationFlow,
  handleDocumentsStage,
  handleUnderReview,
  handleContacted,
  handleClosed
};
