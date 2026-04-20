const { MESSAGES, KEYWORDS, DOCUMENTS, CONFIG } = require("./config");
const {
  fuzzyMatch,
  includesKeyword,
  normalizeText,
  seemsLikePhoneNumber,
  shouldRemind,
  calculateClientScore,
  validateAnswer
} = require("./utils");
const { sendTextMessage } = require("./whatsapp");
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
// QUESTION FLOW
// =========================
const QUESTION_FLOW = [
  {
    step: "q1_full_name",
    field: "full_name",
    question: "Muy bien, por favor conteste las siguientes preguntas para continuar:\n*---*\n¿Me confirma su nombre completo?",
    validationType: "text"
  },
  {
    step: "q2_age",
    field: "age",
    question: "¿Cuál es su edad?",
    validationType: "numeric"
  },
  {
    step: "q3_personal_phone_confirmed",
    field: "personal_phone_confirmed",
    question: "¿Este sería su celular personal?",
    validationType: "yesno"
  },
  {
    step: "q3b_personal_phone_number",
    field: "personal_phone_number",
    question: "¿Cuál es su número de celular personal?",
    validationType: "phone"
  },
  {
    step: "q4_marital_status",
    field: "marital_status",
    question: "¿Usted se encuentra soltero(a), casado(a), viudo(a), divorciado(a) o separado(a)?",
    validationType: "marital_status"
  },
  {
    step: "q5_debt_with_lender",
    field: "debt_with_lender",
    question: "¿Le debe o le ha quedado a deber a alguna casa de préstamos como nosotros?",
    preMessage: MESSAGES.PRE_QUESTION_5,
    validationType: "yesno"
  },
  {
    step: "q6_job_name",
    field: "job_name",
    question: "Sección 2\n*---*\n¿Dónde trabaja usted?",
    validationType: "text"
  },
  {
    step: "q7_income_proof_available",
    field: "income_proof_available",
    question: "¿Cuenta con comprobante de ingresos?",
    validationType: "yesno"
  },
  {
    step: "q8_work_address",
    field: "work_address",
    question: "¿Qué dirección tiene su trabajo?",
    validationType: "address"
  },
  {
    step: "q8b_work_phone",
    field: "work_phone",
    question: "¿Qué teléfono tiene su trabajo?",
    validationType: "phone"
  },
  {
    step: "q9_years_at_job",
    field: "years_at_job",
    question: `¿Cuántos años tiene trabajando ahí? (ej: 2, 2.5, 2 años y 8 meses)`,
    validationType: "time_period"
  },
  {
    step: "q10_home_address",
    field: "home_address",
    question: "¿Qué dirección tiene su domicilio?",
    validationType: "address"
  },
  {
    step: "q11_average_income",
    field: "average_income",
    question: "¿Qué ingresos promedio tiene?",
    validationType: "numeric"
  },
  {
    step: "q12_years_at_home",
    field: "years_at_home",
    question: `¿Cuántos años tiene viviendo en esa casa? (ej: 3, 3.5, 1 año y 6 meses)`,
    validationType: "time_period"
  },
  {
    step: "q13_home_owner_name",
    field: "home_owner_name",
    question: "¿A nombre de quién está la casa donde vive?",
    validationType: "text"
  },
  {
    step: "q14_address_proof_name",
    field: "address_proof_name",
    question: "¿El comprobante de domicilio a nombre de quién sale?",
    validationType: "text"
  }
];

// =========================
// FLOW HELPERS
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

function isSkipCommand(text) {
  return exactKeywordMatch(text, KEYWORDS.SKIP);
}

function isDoneCommand(text) {
  return exactKeywordMatch(text, KEYWORDS.DONE) || fuzzyMatch(text, KEYWORDS.DONE, 1);
}

function inferStage1Intent(text) {
  const clean = normalizeText(text);
  const hasGreeting = includesKeyword(clean, KEYWORDS.RESTART);
  const wantsInfo = includesKeyword(clean, new Set([
    ...KEYWORDS.STAGE1_FAQ,
    "informes",
    "quiero info",
    "quiero información",
    "more info",
    "mas info",
    "más info"
  ]));
  const wantsApplication = includesKeyword(clean, new Set([
    ...KEYWORDS.STAGE2_INTERESTED,
    "solicitar",
    "tramite",
    "trámite",
    "quiero el prestamo",
    "quiero el préstamo"
  ]));

  if (hasGreeting && wantsInfo) return "faq";
  if (hasGreeting && wantsApplication) return "faq";
  if (wantsInfo) return "faq";
  if (wantsApplication) return "interested";
  return null;
}

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
  const completed = Object.values(docs).filter(path => path).length;

  return { completed, total };
}

async function sendQuestionByIndex(to, index) {
  const question = QUESTION_FLOW[index];
  if (!question) return;

  if (question.preMessage) {
    await sendTextMessage(to, question.preMessage);
  }

  await sendTextMessage(to, `${question.question}\n\nSi desea omitir esta pregunta, escriba *omitir*.`);
}

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

async function advanceDocumentsFlow(from, currentDoc, currentValue = null) {
  const fieldName = getDocumentFieldName(currentDoc);
  const nextDoc = getNextDocumentKey(currentDoc);
  const completionMessage = currentValue === "SKIPPED"
    ? "Documento omitido."
    : "Documento registrado correctamente.";

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

  await sendTextMessage(from, MESSAGES.DOCUMENTS_CLOSE);
  return false;
}

async function beginNewApplicationConfirmation(client, from) {
  if (!client || client.stage === "stage_1") {
    await sendTextMessage(from, MESSAGES.MENU);
    return true;
  }

  await updateClient(from, { pending_action: "confirm_restart" });
  await sendTextMessage(from, MESSAGES.NEW_APPLICATION_WARNING);
  return true;
}

async function resolvePendingAction(client, text, from, profileName) {
  if (!client?.pending_action) return false;

  if (client.pending_action === "confirm_restart") {
    if (fuzzyMatch(text, KEYWORDS.YES, 2)) {
      await discardClientApplication(from, profileName);
      await sendTextMessage(from, "Entendido. Su solicitud anterior fue descartada y comenzaremos una nueva.");
      await sendTextMessage(from, MESSAGES.MENU);
      return true;
    }

    if (fuzzyMatch(text, KEYWORDS.NO, 2)) {
      await updateClient(from, { pending_action: null });
      await sendTextMessage(from, "Perfecto. Conservaremos su trámite actual.");
      const refreshedClient = await getClient(from);
      await remindCurrentStep(from, refreshedClient);
      return true;
    }

    await sendTextMessage(from, "Por favor responda *si* para descartar la solicitud anterior o *no* para conservarla.");
    return true;
  }

  return false;
}

// =========================
// STATUS MANAGEMENT
// =========================

async function sendStatusMessage(to, client) {
  if (!client) {
    await sendTextMessage(to, "No tengo información de su proceso actual.");
    return;
  }

  let statusMessage = `*ESTADO DE SU SOLICITUD*\n\n`;

  switch (client.stage) {
    case "stage_1":
      statusMessage += `📍 Está en el menú principal\n`;
      statusMessage += `Próximo paso: Elegir una opción del menú`;
      break;

    case "stage_2":
      statusMessage += `📍 Viendo preguntas frecuentes\n`;
      statusMessage += `Próximo paso: Indicar si está interesado`;
      break;

    case "section_1":
    case "section_2":
      const currentIndex = getQuestionIndexByStep(client.question_step);
      const totalQuestions = QUESTION_FLOW.length;
      const completed = currentIndex;
      const remaining = totalQuestions - currentIndex;

      statusMessage += `📍 Contestando preguntas de calificación\n`;
      statusMessage += `Progreso: ${completed}/${totalQuestions} preguntas completadas\n`;
      statusMessage += `Faltan: ${remaining} preguntas\n`;

      if (currentIndex >= 0 && currentIndex < QUESTION_FLOW.length) {
        const currentQuestion = QUESTION_FLOW[currentIndex];
        statusMessage += `Pregunta actual: ${currentQuestion.question.split('\n')[0]}`;
      }
      break;

    case "awaiting_documents":
      statusMessage += `📍 Enviando documentos\n`;
      const docProgress = getDocumentProgress(client);
      statusMessage += `Progreso: ${docProgress.completed}/${docProgress.total} documentos enviados\n`;
      statusMessage += `Documento pendiente: ${DOCUMENTS.PROMPTS[client.expected_document] || "Documento específico"}`;
      break;

    case "under_review":
      statusMessage += `📍 Solicitud en revisión por asesor\n`;
      statusMessage += `Estado: Esperando contacto del asesor\n`;
      statusMessage += `Documentos: ${getDocumentProgress(client).completed}/5 completados\n\n`;
      statusMessage += `💡 Si necesita iniciar una nueva solicitud, escriba 'nueva solicitud'`;
      break;

    case "contacted":
      statusMessage += `📍 Asesor ya contactó al solicitante\n`;
      statusMessage += `Estado: Seguimiento posterior al contacto\n`;
      statusMessage += `Documentos: ${getDocumentProgress(client).completed}/5 completados\n\n`;
      statusMessage += `💡 Si necesita iniciar una nueva solicitud, escriba 'nueva solicitud'`;
      break;

    case "closed":
      statusMessage += `📍 Proceso finalizado\n`;
      statusMessage += `Puede iniciar una nueva solicitud escribiendo "hola"`;
      break;

    default:
      statusMessage += `📍 Estado desconocido`;
  }

  await sendTextMessage(to, statusMessage);
}

// =========================
// MAIN FLOW HANDLERS
// =========================

async function handleStage1(client, text, from, profileName) {
  const inferredIntent = inferStage1Intent(text);

  if (inferredIntent === "faq" || fuzzyMatch(text, KEYWORDS.STAGE1_FAQ, 2) || includesKeyword(text, KEYWORDS.STAGE1_FAQ)) {
    await moveToStage2(from);
    await sendTextMessage(from, MESSAGES.FAQ);
    return true;
  }

  if (inferredIntent === "interested") {
    await moveToStage2(from);
    await sendTextMessage(from, MESSAGES.FAQ);
    return true;
  }

  await resetToStage1(from, profileName);
  await sendTextMessage(from, MESSAGES.LOOPBACK);
  return true;
}

async function handleStage2(client, text, from, profileName) {
  if (fuzzyMatch(text, KEYWORDS.STAGE2_INTERESTED, 2) || includesKeyword(text, KEYWORDS.STAGE2_INTERESTED)) {
    await startQualificationFlow(from);
    await sendQuestionByIndex(from, 0);
    return true;
  }

  if (fuzzyMatch(text, KEYWORDS.STAGE2_NOT_INTERESTED, 2) || includesKeyword(text, KEYWORDS.STAGE2_NOT_INTERESTED)) {
    await markNotInterested(from);
    await sendTextMessage(from, "Muchas gracias por su interés.");
    return true;
  }

  await resetToStage1(from, profileName);
  await sendTextMessage(from, MESSAGES.LOOPBACK);
  return true;
}

async function handleQualificationFlow(client, text, from) {
  const currentIndex = getQuestionIndexByStep(client.question_step);

  if (currentIndex === -1) {
    await startQualificationFlow(from);
    await sendQuestionByIndex(from, 0);
    return true;
  }

  // Check if user might need a reminder
  if (shouldRemind(client.updated_at, CONFIG.QUESTION_REMINDER_HOURS)) {
    const currentQuestion = QUESTION_FLOW[currentIndex];
    await sendTextMessage(from, MESSAGES.CONTINUE);
    await sendQuestionByIndex(from, currentIndex);
    return true;
  }

  const currentQuestion = QUESTION_FLOW[currentIndex];

  if (isSkipCommand(text)) {
    await updateClient(from, { [currentQuestion.field]: "OMITIDO" });

    const nextIndex = currentQuestion.step === "q3_personal_phone_confirmed"
      ? getQuestionIndexByStep("q4_marital_status")
      : currentIndex + 1;

    if (nextIndex < QUESTION_FLOW.length) {
      const nextQuestion = QUESTION_FLOW[nextIndex];
      const nextStage = nextIndex <= 5 ? "section_1" : "section_2";

      await updateClient(from, {
        question_step: nextQuestion.step,
        stage: nextStage
      });

      await sendTextMessage(from, "Respuesta omitida.");
      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    const updatedClient = await getClient(from);
    const score = calculateClientScore(updatedClient);

    console.log(`Client ${from} completed qualification. Score: ${score}/100`);
    await updateClient(from, { score });
    await moveToDocumentsStage(from);
    await sendTextMessage(from, "Respuesta omitida.");
    await sendTextMessage(from, MESSAGES.DOCUMENTS_INTRO);
    await sendTextMessage(from, DOCUMENTS.PROMPTS.ine_front);
    return true;
  }

  // Special logic for phone confirmation question
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
      await sendTextMessage(from, "Tomaré ese número como su celular personal.");
      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    if (fuzzyMatch(text, KEYWORDS.YES, 2)) {
      await updateClient(from, { [currentQuestion.field]: text });
      const nextIndex = getQuestionIndexByStep("q4_marital_status");
      const nextQuestion = QUESTION_FLOW[nextIndex];
      await updateClient(from, {
        question_step: nextQuestion.step,
        stage: "section_1"
      });
      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    if (fuzzyMatch(text, KEYWORDS.NO, 2)) {
      await updateClient(from, { [currentQuestion.field]: text });
      const nextIndex = getQuestionIndexByStep("q3b_personal_phone_number");
      const nextQuestion = QUESTION_FLOW[nextIndex];
      await updateClient(from, {
        question_step: nextQuestion.step,
        stage: "section_1"
      });
      await sendQuestionByIndex(from, nextIndex);
      return true;
    }

    await sendTextMessage(from, "Por favor responda solo sí o no.");
    return true;
  }

  if (currentQuestion.step === "q8b_work_phone" && inferMissingWorkPhone(text)) {
    await sendTextMessage(from, "Si no cuenta con teléfono de trabajo, puede escribir *omitir* y paso a la siguiente pregunta.");
    return true;
  }

  // Validate answer
  const validation = validateAnswer(text, currentQuestion.validationType);
  if (!validation.valid) {
    const reminder = currentQuestion.step === "q8b_work_phone"
      ? `${validation.errorMsg}\n\nSi no cuenta con teléfono de trabajo, escriba *omitir*.`
      : `${validation.errorMsg}\n\nSi desea omitir esta pregunta, escriba *omitir*.`;
    await sendTextMessage(from, reminder);
    return true;
  }

  // Save answer and move to next question
  await updateClient(from, { [currentQuestion.field]: text });

  const nextIndex = currentIndex + 1;

  if (nextIndex < QUESTION_FLOW.length) {
    const nextQuestion = QUESTION_FLOW[nextIndex];
    const nextStage = nextIndex <= 5 ? "section_1" : "section_2";

    await updateClient(from, {
      question_step: nextQuestion.step,
      stage: nextStage
    });

    await sendQuestionByIndex(from, nextIndex);
    return true;
  }

  // Complete qualification - calculate score and move to documents
  const updatedClient = await getClient(from);
  const score = calculateClientScore(updatedClient);

  console.log(`Client ${from} completed qualification. Score: ${score}/100`);
  await updateClient(from, { score });
  await moveToDocumentsStage(from);
  await sendTextMessage(from, MESSAGES.DOCUMENTS_INTRO);
  await sendTextMessage(from, DOCUMENTS.PROMPTS.ine_front);
  return true;
}

async function handleDocumentsStage(client, text, from) {
  if (!client?.expected_document) {
    await sendTextMessage(from, "No encontré el documento pendiente. Retomemos su flujo actual.");
    await remindCurrentStep(from, client);
    return true;
  }

  if (isSkipCommand(text)) {
    const fieldName = getDocumentFieldName(client.expected_document);
    const currentValue = client[fieldName];
    const valueToStore = hasUsableDocumentValue(currentValue) ? currentValue : "SKIPPED";
    const shouldNotifyAdvisor = !(await advanceDocumentsFlow(from, client.expected_document, valueToStore));

    if (shouldNotifyAdvisor) {
      const updatedClient = await getClient(from);
      await require("./whatsapp").notifyAdvisor(updatedClient);
    }
    return true;
  }

  if (client.expected_document === "income_proof" && isDoneCommand(text)) {
    const currentValue = client.income_proof_path;
    if (!hasUsableDocumentValue(currentValue)) {
      await sendTextMessage(from, "Aún no tengo ningún comprobante de ingresos. Puede enviarlo ahora o escribir *omitir* para continuar sin este documento.");
      return true;
    }

    const updatedClient = await getClient(from);
    const shouldNotifyAdvisor = !(await advanceDocumentsFlow(from, client.expected_document, updatedClient.income_proof_path));

    if (shouldNotifyAdvisor) {
      const finalClient = await getClient(from);
      await require("./whatsapp").notifyAdvisor(finalClient);
    }
    return true;
  }

  if (client.expected_document === "income_proof" && inferIncomeProofIssue(text)) {
    await sendTextMessage(from, "Si le pagan en efectivo o no tiene talón, todavía puede continuar. Puede enviar screenshots de depósitos de los últimos 3 meses o un estado de cuenta. Si de plano no cuenta con eso, escriba *omitir* y seguimos con su solicitud.");
    return true;
  }

  // Check if user might need a reminder
  if (shouldRemind(client.updated_at, CONFIG.DOCUMENT_REMINDER_HOURS)) {
    const prompt = DOCUMENTS.PROMPTS[client.expected_document];
    if (prompt) {
      await sendTextMessage(from, `Recordatorio: ${prompt}`);
      return true;
    }
  }

  if (client.expected_document === "income_proof") {
    await sendTextMessage(from, "En este paso puede enviar uno o varios comprobantes de ingresos. Cuando termine, escriba *listo*. Si desea continuar sin este documento, escriba *omitir*.");
    return true;
  }

  await sendTextMessage(from, "En este paso necesito que envíe la imagen o archivo del documento solicitado. Si desea omitirlo, escriba *omitir*. Si tiene duda sobre qué documento sigue, escriba *estado*.");
  return true;
}

async function handleUnderReview(client, text, from, profileName) {
  // Allow status check
  if (fuzzyMatch(text, KEYWORDS.STATUS, 2)) {
    await sendStatusMessage(from, client);
    return true;
  }

  // Allow new application
  if (fuzzyMatch(text, KEYWORDS.NEW_APPLICATION, 2)) {
    return beginNewApplicationConfirmation(client, from);
  }

  // Allow update requests
  if (fuzzyMatch(text, KEYWORDS.UPDATE, 2)) {
    await sendTextMessage(from, "Para actualizar su información, por favor inicie una nueva solicitud escribiendo 'nueva solicitud'. Esto nos permitirá revisar toda su información actualizada.");
    return true;
  }

  await sendTextMessage(from, MESSAGES.UNDER_REVIEW);
  return true;
}

async function handleContacted(client, text, from, profileName) {
  if (fuzzyMatch(text, KEYWORDS.STATUS, 2)) {
    await sendStatusMessage(from, client);
    return true;
  }

  if (fuzzyMatch(text, KEYWORDS.NEW_APPLICATION, 2)) {
    return beginNewApplicationConfirmation(client, from);
  }

  if (fuzzyMatch(text, KEYWORDS.UPDATE, 2)) {
    await sendTextMessage(from, "Para actualizar su información, por favor inicie una nueva solicitud escribiendo 'nueva solicitud'. Esto nos permitirá revisar toda su información actualizada.");
    return true;
  }

  await sendTextMessage(from, MESSAGES.CONTACTED);
  return true;
}

async function handleClosed(client, text, from, profileName) {
  if (fuzzyMatch(text, KEYWORDS.NEW_APPLICATION, 2)) {
    return beginNewApplicationConfirmation(client, from);
  }

  await sendTextMessage(from, MESSAGES.CLOSED);
  return true;
}

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
