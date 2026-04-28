const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { CONFIG, AI_OPERATOR, AI_REPLY_VARIANTS, TONE_BY_STAGE, pickVariant } = require("./config");

function writeAiDebugLog(event) {
  if (!CONFIG.LOCAL_AI_DEBUG_LOG) return;

  try {
    const logPath = path.resolve(CONFIG.LOCAL_AI_DEBUG_LOG);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify({
      ts: new Date().toISOString(),
      ...event
    })}\n`);
  } catch (error) {
    console.warn(`[AI operator] failed to write debug log: ${error.message}`);
  }
}

function inferTone(replyKey, context = {}) {
  if (context?.tone) return context.tone;
  if (context?.toneStage && TONE_BY_STAGE[context.toneStage]) return TONE_BY_STAGE[context.toneStage];

  const keyToStage = {
    document_received: "document_received",
    income_proof_received: "document_received",
    document_required: "document_request",
    no_income_proof_yet: "income_issue",
    income_proof_issue: "income_issue",
    yes_no_only: "validation_error",
    loopback: "menu",
    restart_confirmed: "restart_confirmation",
    keep_current_application: "restart_confirmation",
    confirm_restart_prompt: "restart_confirmation",
    invalid_restart_confirmation: "restart_confirmation",
    not_interested: "close",
    under_review: "under_review",
    update_requires_new_application: "under_review"
  };

  return TONE_BY_STAGE[keyToStage[replyKey]] || "casual";
}

function getApprovedVariants(replyKey, tone = "casual") {
  const variants = AI_REPLY_VARIANTS[replyKey];
  if (!variants) return [];

  if (Array.isArray(variants)) {
    return variants.filter(Boolean);
  }

  const preferred = variants[tone] || variants.casual || variants.directo || [];
  return preferred.filter(Boolean);
}

function getFallbackVariant(replyKey, fallback, tone = "casual") {
  return fallback || pickVariant(replyKey, tone) || "";
}

function isAiAvailable() {
  return Boolean(CONFIG.LOCAL_AI_ENABLED && CONFIG.LOCAL_AI_BASE_URL && CONFIG.LOCAL_AI_MODEL);
}

function readAiContextFiles() {
  const contextDir = path.resolve(CONFIG.LOCAL_AI_CONTEXT_DIR || "./ai");
  const files = [
    "identity.md",
    "loan-facts.md",
    "conversation-rules.md",
    "safety-boundaries.md",
    "flexible-reply-contract.md"
  ];

  return files.map((fileName) => {
    const filePath = path.join(contextDir, fileName);
    try {
      return `--- ${fileName} ---\n${fs.readFileSync(filePath, "utf8")}`;
    } catch (error) {
      return `--- ${fileName} ---\n(Missing context file: ${fileName})`;
    }
  }).join("\n\n");
}

function buildVariantPrompt(replyKey, context, variants) {
  return {
    task: "choose_approved_reply_variant",
    replyKey,
    dryRun: CONFIG.LOCAL_AI_DRY_RUN,
    allowedVariants: variants.map((reply, index) => ({ index, reply })),
    context,
    requiredJsonShape: {
      replyKey,
      variantIndex: 0,
      reply: "exact approved variant text",
      confidence: 0.9,
      escalate: false,
      reason: "short internal reason"
    }
  };
}

function parseJsonObject(content) {
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch (error) {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

function validateVariantChoice(replyKey, result, variants) {
  if (!result || result.replyKey !== replyKey) return null;

  const index = Number(result.variantIndex);
  if (!Number.isInteger(index) || index < 0 || index >= variants.length) {
    return null;
  }

  const selected = variants[index];
  if (result.reply && result.reply !== selected) {
    return null;
  }

  const confidence = Number(result.confidence);
  if (result.escalate === true) {
    return null;
  }

  return {
    reply: selected,
    variantIndex: index,
    confidence: Number.isFinite(confidence) ? confidence : 1,
    reason: String(result.reason || "")
  };
}

async function requestLocalAi(payload) {
  const response = await axios.post(
    CONFIG.LOCAL_AI_BASE_URL,
    {
      model: CONFIG.LOCAL_AI_MODEL,
      messages: [
        { role: "system", content: AI_OPERATOR.SYSTEM_PROMPT },
        { role: "user", content: `/no_think\n${JSON.stringify(payload)}` }
      ],
      temperature: CONFIG.LOCAL_AI_TEMPERATURE,
      max_tokens: CONFIG.LOCAL_AI_MAX_TOKENS,
      reasoning_effort: "none",
      think: false,
      response_format: { type: "json_object" }
    },
    {
      timeout: CONFIG.LOCAL_AI_TIMEOUT_MS,
      headers: { "Content-Type": "application/json" }
    }
  );

  return parseJsonObject(response.data?.choices?.[0]?.message?.content);
}

function validateFlexibleReply(result) {
  if (!result || typeof result.reply !== "string") return null;

  const reply = result.reply.trim();
  if (!reply) return null;
  if (reply.length > 700) return null;

  const lower = reply.toLowerCase();
  const blockedPhrases = [
    "aprobado",
    "aprobada",
    "rechazado",
    "rechazada",
    "garantizado",
    "garantizada",
    "te garantizo",
    "le garantizo",
    "seguro recibe",
    "seguro le damos",
    "no ofrecemos prestamos en",
    "no ofrecemos préstamos en",
    "no prestamos en",
    "si prestamos en",
    "sí prestamos en",
    "prestamos en colombia",
    "préstamos en colombia",
    "contraseña",
    "codigo de verificacion",
    "código de verificación"
  ];

  if (blockedPhrases.some((phrase) => lower.includes(phrase))) {
    return null;
  }

  const confidence = Number(result.confidence);
  return {
    reply,
    escalate: result.escalate === true,
    confidence: Number.isFinite(confidence) ? confidence : 0.8,
    reason: String(result.reason || ""),
    suggestedReplyForAdvisor: String(result.suggestedReplyForAdvisor || "").trim()
  };
}

function formatContextValue(value) {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "string") return value.length > 700 ? `${value.slice(0, 700)}...` : value;
  return JSON.stringify(value).slice(0, 700);
}

async function notifyAdvisorForAiEscalation(context, modelResult, fallbackReply) {
  const waId = context?.wa_id;
  const { CONFIG } = require("./config");
  const { getClient, getMessagesByClient } = require("./database");
  const { sendTextMessage } = require("./whatsapp");

  if (!CONFIG.ADVISOR_PHONE || !waId) {
    return false;
  }

  const client = await getClient(waId).catch(() => null);
  const messages = await getMessagesByClient(waId).catch(() => []);
  const recentMessages = messages.slice(-8).map((message) => {
    const who = message.direction === "out" ? "Bot/Asesor" : "Cliente";
    const body = message.message_text || `[${message.message_type || "mensaje"}]`;
    return `${who}: ${body}`;
  }).join("\n");

  const suggestedReply = modelResult.suggestedReplyForAdvisor || modelResult.reply || fallbackReply || "(sin sugerencia)";
  const advisorMessage =
`AI necesita revisión de asesor.

Cliente: ${client?.full_name || client?.profile_name || waId}
WhatsApp: ${waId}
Etapa: ${context.stage || client?.stage || "(desconocida)"}
Pregunta/Paso: ${context.questionStep || context.expectedDocument || client?.question_step || client?.expected_document || "(desconocido)"}

Mensaje del cliente:
${formatContextValue(context.userText)}

Motivo del AI:
${formatContextValue(modelResult.reason)}

Respuesta sugerida para aprobar o editar:
${formatContextValue(suggestedReply)}

Contexto reciente:
${recentMessages || "(sin historial reciente)"}`;

  await sendTextMessage(CONFIG.ADVISOR_PHONE, advisorMessage);
  return true;
}

async function draftFlexibleReply(context = {}, fallback = null) {
  const startedAt = Date.now();
  const fallbackReply = fallback || "";

  if (!CONFIG.LOCAL_AI_FLEXIBLE_REPLIES || !isAiAvailable()) {
    writeAiDebugLog({
      type: "flexible_reply",
      status: "skipped",
      reason: !CONFIG.LOCAL_AI_FLEXIBLE_REPLIES ? "flexible_replies_disabled" : "ai_unavailable_or_disabled",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: Date.now() - startedAt,
      fallbackReply
    });
    return fallbackReply;
  }

  const payload = {
    task: "draft_grounded_flexible_reply",
    aiUniverse: readAiContextFiles(),
    context,
    fallbackReply,
    requiredJsonShape: {
      reply: "short Spanish WhatsApp reply",
      confidence: 0.9,
      escalate: false,
      reason: "short internal reason"
    }
  };

  try {
    const result = await requestLocalAi(payload);
    const choice = validateFlexibleReply(result);

    if (!choice) {
      console.warn("[AI operator] invalid flexible reply; using fallback");
      writeAiDebugLog({
        type: "flexible_reply",
        status: "invalid_choice",
        model: CONFIG.LOCAL_AI_MODEL,
        durationMs: Date.now() - startedAt,
        context,
        rawResult: result,
        fallbackReply
      });
      return fallbackReply;
    }

    if (choice.escalate) {
      const applicantReply = choice.reply || "Para eso es mejor que lo revise un asesor directamente. En breve le pueden apoyar.";
      let advisorNotified = false;

      try {
        advisorNotified = await notifyAdvisorForAiEscalation(context, choice, fallbackReply);
      } catch (error) {
        console.warn(`[AI operator] advisor escalation failed: ${error.message}`);
      }

      console.log(`[AI operator] flexible reply escalated to advisor (${choice.confidence.toFixed(2)})`);
      writeAiDebugLog({
        type: "flexible_reply",
        status: "escalated_to_advisor",
        model: CONFIG.LOCAL_AI_MODEL,
        durationMs: Date.now() - startedAt,
        confidence: choice.confidence,
        applicantReply,
        suggestedReplyForAdvisor: choice.suggestedReplyForAdvisor,
        reason: choice.reason,
        advisorNotified,
        context
      });

      return applicantReply;
    }

    console.log(`[AI operator] flexible reply (${choice.confidence.toFixed(2)})`);
    writeAiDebugLog({
      type: "flexible_reply",
      status: CONFIG.LOCAL_AI_DRY_RUN ? "dry_run_success" : "success",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: Date.now() - startedAt,
      confidence: choice.confidence,
      selectedReply: choice.reply,
      reason: choice.reason,
      context
    });

    if (CONFIG.LOCAL_AI_DRY_RUN) {
      console.log(`[AI operator dry-run] would send flexible reply: ${choice.reply}`);
      return fallbackReply;
    }

    return choice.reply;
  } catch (error) {
    console.warn(`[AI operator] flexible reply unavailable; using fallback: ${error.message}`);
    writeAiDebugLog({
      type: "flexible_reply",
      status: "error",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: Date.now() - startedAt,
      context,
      error: error.message,
      fallbackReply
    });
    return fallbackReply;
  }
}

async function chooseApprovedReply(replyKey, context = {}, fallback = null) {
  const startedAt = Date.now();
  const tone = inferTone(replyKey, context);
  const variants = getApprovedVariants(replyKey, tone);
  const fallbackReply = getFallbackVariant(replyKey, fallback, tone);

  if (!isAiAvailable() || variants.length === 0) {
    writeAiDebugLog({
      type: "reply_variant",
      status: "skipped",
      reason: !isAiAvailable() ? "ai_unavailable_or_disabled" : "no_approved_variants",
      model: CONFIG.LOCAL_AI_MODEL,
      replyKey,
      tone,
      durationMs: Date.now() - startedAt,
      fallbackReply
    });
    return fallbackReply;
  }

  try {
    const payload = buildVariantPrompt(replyKey, context, variants);
    const result = await requestLocalAi(payload);
    const choice = validateVariantChoice(replyKey, result, variants);

    if (!choice) {
      console.warn(`[AI operator] invalid choice for ${replyKey}; using fallback`);
      writeAiDebugLog({
        type: "reply_variant",
        status: "invalid_choice",
        model: CONFIG.LOCAL_AI_MODEL,
        replyKey,
        tone,
        durationMs: Date.now() - startedAt,
        variantCount: variants.length,
        rawResult: result,
        fallbackReply
      });
      return fallbackReply;
    }

    console.log(`[AI operator] ${replyKey} -> variant ${choice.variantIndex} (${choice.confidence.toFixed(2)})`);
    writeAiDebugLog({
      type: "reply_variant",
      status: CONFIG.LOCAL_AI_DRY_RUN ? "dry_run_success" : "success",
      model: CONFIG.LOCAL_AI_MODEL,
      replyKey,
      tone,
      durationMs: Date.now() - startedAt,
      variantIndex: choice.variantIndex,
      confidence: choice.confidence,
      selectedReply: choice.reply,
      reason: choice.reason
    });

    if (CONFIG.LOCAL_AI_DRY_RUN) {
      console.log(`[AI operator dry-run] would send: ${choice.reply}`);
      return fallbackReply;
    }

    return choice.reply;
  } catch (error) {
    console.warn(`[AI operator] unavailable for ${replyKey}; using fallback: ${error.message}`);
    writeAiDebugLog({
      type: "reply_variant",
      status: "error",
      model: CONFIG.LOCAL_AI_MODEL,
      replyKey,
      tone,
      durationMs: Date.now() - startedAt,
      error: error.message,
      fallbackReply
    });
    return fallbackReply;
  }
}

async function diagnoseLocalAi() {
  const startedAt = Date.now();

  if (!isAiAvailable()) {
    writeAiDebugLog({
      type: "healthcheck",
      status: "skipped",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: 0,
      error: "Local AI is disabled or missing configuration."
    });
    return {
      ok: false,
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: 0,
      error: "Local AI is disabled or missing configuration."
    };
  }

  const replyKey = "document_received";
  const variants = getApprovedVariants(replyKey, "casual");
  const payload = buildVariantPrompt(replyKey, { healthcheck: true }, variants);

  try {
    const result = await requestLocalAi(payload);
    const choice = validateVariantChoice(replyKey, result, variants);
    const durationMs = Date.now() - startedAt;

    if (!choice) {
      writeAiDebugLog({
        type: "healthcheck",
        status: "invalid_choice",
        model: CONFIG.LOCAL_AI_MODEL,
        durationMs,
        rawResult: result
      });
      return {
        ok: false,
        model: CONFIG.LOCAL_AI_MODEL,
        durationMs,
        error: "Model responded, but the reply did not pass approved-variant validation.",
        raw: result
      };
    }

    writeAiDebugLog({
      type: "healthcheck",
      status: "success",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs,
      replyKey,
      variantIndex: choice.variantIndex,
      selectedReply: choice.reply
    });

    return {
      ok: true,
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs,
      replyKey,
      variantIndex: choice.variantIndex,
      reply: choice.reply
    };
  } catch (error) {
    writeAiDebugLog({
      type: "healthcheck",
      status: "error",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
    return {
      ok: false,
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: Date.now() - startedAt,
      error: error.message
    };
  }
}

async function proposeOperatorAction(context = {}) {
  const startedAt = Date.now();
  if (!isAiAvailable()) {
    writeAiDebugLog({
      type: "action_proposal",
      status: "skipped",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: 0,
      reason: "ai_unavailable_or_disabled"
    });
    return { action: "no_action", confidence: 0, dryRun: CONFIG.LOCAL_AI_DRY_RUN };
  }

  const payload = {
    task: "propose_operator_action",
    allowedActions: Array.from(AI_OPERATOR.ALLOWED_ACTIONS),
    context,
    requiredJsonShape: {
      action: "one allowed action",
      confidence: 0.0,
      escalate: false,
      reason: "short internal reason"
    }
  };

  try {
    const result = await requestLocalAi(payload);
    const action = String(result?.action || "");
    const confidence = Number(result?.confidence || 0);

    if (!AI_OPERATOR.ALLOWED_ACTIONS.has(action) || !Number.isFinite(confidence) || confidence < 0.35) {
      writeAiDebugLog({
        type: "action_proposal",
        status: "invalid_choice",
        model: CONFIG.LOCAL_AI_MODEL,
        durationMs: Date.now() - startedAt,
        rawResult: result
      });
      return { action: "no_action", confidence: 0, dryRun: CONFIG.LOCAL_AI_DRY_RUN };
    }

    if (result.escalate === true) {
      writeAiDebugLog({
        type: "action_proposal",
        status: "escalated",
        model: CONFIG.LOCAL_AI_MODEL,
        durationMs: Date.now() - startedAt,
        action: "escalate_to_advisor",
        confidence
      });
      return { action: "escalate_to_advisor", confidence, dryRun: CONFIG.LOCAL_AI_DRY_RUN };
    }

    console.log(`[AI operator] proposed action ${action} (${confidence.toFixed(2)})`);
    writeAiDebugLog({
      type: "action_proposal",
      status: CONFIG.LOCAL_AI_DRY_RUN ? "dry_run_success" : "success",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: Date.now() - startedAt,
      action,
      confidence,
      reason: String(result.reason || "")
    });
    return { action, confidence, dryRun: CONFIG.LOCAL_AI_DRY_RUN, reason: String(result.reason || "") };
  } catch (error) {
    console.warn(`[AI operator] action proposal unavailable: ${error.message}`);
    writeAiDebugLog({
      type: "action_proposal",
      status: "error",
      model: CONFIG.LOCAL_AI_MODEL,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
    return { action: "no_action", confidence: 0, dryRun: CONFIG.LOCAL_AI_DRY_RUN };
  }
}

async function classifyFlowAnswer({ classifier, userText, currentQuestion, client = {} }) {
  const startedAt = Date.now();

  if (!isAiAvailable()) {
    writeAiDebugLog({
      type: "flow_classifier",
      status: "skipped",
      classifier,
      userText,
      reason: "ai_unavailable_or_disabled",
      durationMs: Date.now() - startedAt
    });
    return {
      recognized: false,
      value: null,
      confidence: 0,
      extra: {},
      frustrated: false,
      reason: "ai_unavailable"
    };
  }

  const classifiers = {
    debt_yes_no: {
      allowedValues: ["yes", "no", "unknown"],
      examples: {
        yes: [
          "sí",
          "si debo",
          "tengo deuda",
          "quedé debiendo",
          "debo en una financiera",
          "debo en una casa de préstamos",
          "estoy pagando uno",
          "tengo préstamo activo"
        ],
        no: [
          "no",
          "que no",
          "ya te dije que no",
          "no debo",
          "no le debo",
          "no yo no le debo",
          "para nada",
          "nel",
          "nunca",
          "no he quedado mal"
        ],
        unknown: []
      },
      frustratedPhrases: [
        "ya te dije",
        "otra vez",
        "te estoy diciendo",
        "que no"
      ]
    },
    income_source: {
      allowedValues: ["empleo", "negocio_propio", "pension", "apoyo_familiar", "desempleado", "otro", "unknown"],
      examples: {
        empleo: [
          "trabajo en una empresa",
          "soy empleado",
          "tengo trabajo",
          "trabajo en oficina"
        ],
        negocio_propio: [
          "tengo una estética",
          "vendo comida",
          "tengo un puesto",
          "emprendimiento",
          "negocio personal",
          "trabajo por mi cuenta",
          "soy independiente"
        ],
        pension: [
          "pensión",
          "soy pensionado"
        ],
        apoyo_familiar: [
          "me ayuda mi familia",
          "me apoya mi esposo"
        ],
        desempleado: [
          "no trabajo",
          "desempleado"
        ],
        otro: [],
        unknown: []
      },
      frustratedPhrases: []
    }
  };

  const classifierConfig = classifiers[classifier];
  if (!classifierConfig) {
    writeAiDebugLog({
      type: "flow_classifier",
      status: "invalid_classifier",
      classifier,
      userText,
      durationMs: Date.now() - startedAt
    });
    return {
      recognized: false,
      value: null,
      confidence: 0,
      extra: {},
      frustrated: false,
      reason: "invalid_classifier"
    };
  }

  const payload = {
    task: "classify_flow_answer",
    classifier,
    userText,
    currentQuestion: currentQuestion?.question || "",
    allowedValues: classifierConfig.allowedValues,
    examples: classifierConfig.examples,
    frustratedPhrases: classifierConfig.frustratedPhrases,
    requiredJsonShape: {
      recognized: true,
      value: "one of allowedValues",
      confidence: 0.9,
      extra: {},
      frustrated: false,
      reason: "short internal reason"
    }
  };

  try {
    const result = await requestLocalAi(payload);

    // Validación defensiva
    const recognized = Boolean(result?.recognized);
    const value = String(result?.value || "").trim();
    const confidence = Number(result?.confidence || 0);
    const extra = (typeof result?.extra === "object" && result.extra !== null) ? result.extra : {};
    const frustrated = Boolean(result?.frustrated);
    const reason = String(result?.reason || "ai_response");

    if (!classifierConfig.allowedValues.includes(value)) {
      writeAiDebugLog({
        type: "flow_classifier",
        status: "invalid_choice",
        classifier,
        userText,
        value,
        allowedValues: classifierConfig.allowedValues,
        durationMs: Date.now() - startedAt,
        rawResult: result
      });
      return {
        recognized: false,
        value: null,
        confidence: 0,
        extra: {},
        frustrated: false,
        reason: "invalid_value"
      };
    }

    if (!Number.isFinite(confidence) || confidence < 0.7) {
      writeAiDebugLog({
        type: "flow_classifier",
        status: "low_confidence",
        classifier,
        userText,
        value,
        confidence,
        durationMs: Date.now() - startedAt
      });
      return {
        recognized: false,
        value: null,
        confidence: 0,
        extra: {},
        frustrated: false,
        reason: "low_confidence"
      };
    }

    writeAiDebugLog({
      type: "flow_classifier",
      status: "success",
      classifier,
      userText,
      value,
      confidence,
      frustrated,
      durationMs: Date.now() - startedAt
    });

    return {
      recognized,
      value,
      confidence,
      extra,
      frustrated,
      reason
    };
  } catch (error) {
    console.warn(`[AI operator] flow classifier error: ${error.message}`);
    writeAiDebugLog({
      type: "flow_classifier",
      status: "error",
      classifier,
      userText,
      durationMs: Date.now() - startedAt,
      error: error.message
    });
    return {
      recognized: false,
      value: null,
      confidence: 0,
      extra: {},
      frustrated: false,
      reason: "error"
    };
  }
}

module.exports = {
  chooseApprovedReply,
  draftFlexibleReply,
  diagnoseLocalAi,
  proposeOperatorAction,
  classifyFlowAnswer,
  getApprovedVariants,
  isAiAvailable,
  writeAiDebugLog
};
