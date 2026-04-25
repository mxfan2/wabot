// =========================
// CONFIGURATION
// =========================
const CONFIG = {
  PORT: process.env.PORT || 3000,
  HOST: process.env.HOST || "127.0.0.1",
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  GRAPH_VERSION: process.env.GRAPH_VERSION || "v23.0",
  ADVISOR_PHONE: process.env.ADVISOR_PHONE || "526441557322",
  MOCK_WHATSAPP_SEND: process.env.MOCK_WHATSAPP_SEND === "true",
  LOCAL_AI_ENABLED: process.env.LOCAL_AI_ENABLED === "true",
  LOCAL_AI_DRY_RUN: process.env.LOCAL_AI_DRY_RUN !== "false",
  LOCAL_AI_MODEL: process.env.LOCAL_AI_MODEL || "qwen3:8b",
  LOCAL_AI_BASE_URL: process.env.LOCAL_AI_BASE_URL || "http://127.0.0.1:11434/v1/chat/completions",
  LOCAL_AI_TIMEOUT_MS: Number(process.env.LOCAL_AI_TIMEOUT_MS || 20000),
  LOCAL_AI_TEMPERATURE: Number(process.env.LOCAL_AI_TEMPERATURE || 0.4),
  LOCAL_AI_ACTION_PROPOSALS: process.env.LOCAL_AI_ACTION_PROPOSALS === "true",
  LOCAL_AI_MAX_TOKENS: Number(process.env.LOCAL_AI_MAX_TOKENS || 256),
  LOCAL_AI_HEALTHCHECK_TOKEN: process.env.LOCAL_AI_HEALTHCHECK_TOKEN || "KBUkB2V8uBPV2ixHLQDsmoE7S8XKXVEJ",
  LOCAL_AI_DEBUG_LOG: process.env.LOCAL_AI_DEBUG_LOG || "./logs/ai-operator.log",
  LOCAL_AI_FLEXIBLE_REPLIES: process.env.LOCAL_AI_FLEXIBLE_REPLIES === "true",
  LOCAL_AI_CONTEXT_DIR: process.env.LOCAL_AI_CONTEXT_DIR || "./ai",

  // Time thresholds (in hours)
  QUESTION_REMINDER_HOURS: 1,
  DOCUMENT_REMINDER_HOURS: 2,
  WELCOME_BACK_HOURS: 4,

  // Scoring weights
  SCORING: {
    PAYMENT_CAPACITY: 25,
    INCOME_PROOF_ANSWER: 10,
    INCOME_PROOF_DOCUMENT: 10,
    JOB_YEARS: { '1-2': 4, '3-5': 7, '6+': 10 },
    WORK_VERIFIABILITY: 5,
    HOME_YEARS: { '1-2': 4, '3-5': 7, '6+': 10 },
    ADDRESS_CONSISTENCY: 5,
    NO_DEBT: 15,
    IDENTITY_DOCUMENTS: 10
  },

  // Validation
  MAX_SCORE: 100,
  PHONE_MIN_LENGTH: 10,
  TEXT_MIN_LENGTH: 2,
  ADDRESS_MIN_LENGTH: 5
};

// =========================
// MESSAGES
// =========================
const MENU_MESSAGE = `*PRÉSTAMOS RÁPIDOS SIN EMPEÑO FÍSICO* Pagas en ✔ 10 semanas ejemplo → $3,000 → $450 semanales. Te interesa? Responde para mas información.`;

const MESSAGES = {
  MENU: MENU_MESSAGE,

  FAQ: `*PREGUNTAS FRECUENTES:*

Requisitos: 
INE, Comprobante de domicilio., Completar formulario por whatsapp.

Procedimiento:
En este mismo chat envia "Iniciar" para comenzar. Recibe su dinero el mismo día de la aprobación.`,

  LOOPBACK: `Lo siento no logro entenderle.

${MENU_MESSAGE}`,

  PRE_QUESTION_5: `La neta`,

  DOCUMENTS_INTRO: `Muy bien. En este punto su solicitud pasa a revisión preliminar.

Para continuar, por favor envíe fotos claras, completas y con buena luz de los siguientes documentos, uno por uno:

1. INE por delante
2. INE por detrás
3. Comprobante de domicilio
4. Foto de la fachada del domicilio
5. Comprobante de ingresos

El comprobante de ingresos puede ser:
- talón de pago
- screenshots de depósitos recibidos de por lo menos los últimos 3 meses
- estado de cuenta

Voy a indicarle cuál enviar en cada paso.`,

  DOCUMENTS_CLOSE: `Gracias. Sus documentos fueron recibidos correctamente.

Su solicitud pasará a revisión por un asesor. En breve nos comunicaremos con usted.`,

  NEW_APPLICATION_WARNING: "Si inicia una nueva solicitud, la anterior se descartará y no podremos recuperarla.\n\nResponda *si* para continuar o *no* para conservar su trámite actual.",

  UNDER_REVIEW: "Su solicitud ya se encuentra en revisión. En breve un asesor se comunicará con usted.\n\n💡 Puede escribir:\n• 'estado' para ver el progreso\n• 'nueva solicitud' para iniciar una aplicación diferente\n• 'actualizar' para información sobre cambios",

  CONTACTED: "Su solicitud ya fue revisada y un asesor ya se puso en contacto con usted.\n\n💡 Puede escribir:\n• 'estado' para ver el progreso\n• 'nueva solicitud' para iniciar una aplicación diferente\n• 'actualizar' para información sobre cambios",

  CLOSED: "Su proceso anterior fue completado. ¿Le gustaría iniciar una nueva solicitud?\n\nEscriba 'nueva solicitud' para comenzar o 'estado' para más información.",

  UNDERAGE: "Por el momento solo podemos continuar solicitudes de personas mayores de 18 años. Gracias por escribirnos.",

  WELCOME_BACK: "¡Bienvenido de vuelta! Continuemos con su solicitud.",

  CONTINUE: "Continuando donde dejó..."
};

// =========================
// KEYWORD SETS
// =========================
const KEYWORDS = {
  RESTART: new Set([
    "hola", "menú", "menu", "reinicio", "reiniciar",
    "volver al menu", "volver al menú", "regresar al inicio",
    "empezar de nuevo", "reiniciar solicitud"
  ]),

  STATUS: new Set([
    "estado", "status", "progreso", "avance", "dónde estoy",
    "donde estoy", "qué sigue", "que sigue"
  ]),

  UPDATE: new Set([
    "actualizar", "cambiar", "modificar", "update", "change", "corregir"
  ]),

  NEW_APPLICATION: new Set([
    "nueva solicitud", "nueva aplicacion", "nuevo prestamo", "empezar de nuevo"
  ]),

  SKIP: new Set([
    "skip", "omitir", "saltar"
  ]),

  DONE: new Set([
    "listo", "lista", "hecho", "hecha", "termine", "terminé", "finalice", "finalicé", "continuar", "continuo", "continuó"
  ]),

  YES: new Set(["si", "sí", "yes", "claro", "va", "ok", "i", "sip", "SII", "ssi"]),

  NO: new Set(["no", "nop", "o", "na", "n", "no gracias", "noo", "nno"]),

  STAGE1_FAQ: new Set([
    "1", "info", "información", "informacion", "mas informacion",
    "más información", "más info", "mas info", "informes",
    "quiero informacion", "quiero información", "quiero info",
    "dame informacion", "dame información", "como funciona", "cómo funciona"
  ]),

  STAGE2_INTERESTED: new Set([
    "2", "iniciar", "inicia", "empezar", "comenzar", "start",
    "quiero iniciar", "quiero empezar", "empezar solicitud",
    "iniciar solicitud", "comenzar solicitud", "solicitud",
    "me interesa", "interesa", "interesado", "interes", "si", "sí", "ok", "va"
  ]),

  STAGE2_NOT_INTERESTED: new Set([
    "2", "no me interesa", "no", "no gracias"
  ])
};

// =========================
// DOCUMENT CONFIG
// =========================
const DOCUMENTS = {
  ORDER: ["ine_front", "ine_back", "proof_of_address", "house_front", "income_proof"],

  PROMPTS: {
    ine_front: "Por favor envíe una foto *clara y completa* de su *INE por delante*.",
    ine_back: "Ahora envíe una foto *clara y completa* de su *INE por detrás*.",
    proof_of_address: "Ahora envíe una foto *clara y completa* de su *comprobante de domicilio*.",
    house_front: "Ahora envíe una foto *clara* de la *fachada del domicilio*.",
    income_proof: "Ahora envíe su *comprobante de ingresos*.\n\nPuede ser:\n- talón de pago\n- screenshots de depósitos recibidos de por lo menos los últimos 3 meses\n- estado de cuenta\n\nSi necesita enviar varios archivos, puede mandarlos uno por uno.\nCuando termine, escriba *listo*.\nSi desea continuar sin este documento, escriba *omitir*."
  },

  FIELDS: {
    ine_front: "ine_front_path",
    ine_back: "ine_back_path",
    proof_of_address: "proof_of_address_path",
    house_front: "house_front_path",
    income_proof: "income_proof_path"
  }
};

const AI_OPERATOR = {
  ALLOWED_ACTIONS: new Set([
    "send_menu",
    "answer_faq",
    "continue_current_question",
    "clarify_document",
    "send_status",
    "request_restart_confirmation",
    "escalate_to_advisor",
    "no_action"
  ]),

  SYSTEM_PROMPT: `/no_think
Eres un operador local para un bot de WhatsApp de prestamos.
Reglas obligatorias:
- Responde solamente con JSON valido.
- No expliques tu razonamiento.
- No apruebes, rechaces, prometas ni garantices prestamos.
- No cambies montos, tasas, plazos, requisitos ni politicas.
- No pidas datos sensibles fuera del flujo aprobado.
- Usa solamente las variantes de texto aprobadas que se te entregan.
- Si eliges una variante, el campo reply debe ser exactamente esa variante.
- Si hay duda, baja confianza o un tema fuera del flujo, marca escalate true.`
};

const AI_REPLY_VARIANTS = {
  document_received: {
    casual: [
      "Listo, ya recibí el documento.",
      "Perfecto, ya quedó registrado.",
      "Va, documento recibido."
    ],
    directo: [
      "Documento recibido.",
      "Ya tengo ese documento.",
      "Documento registrado."
    ],
    coloquial: [
      "Ya cayó ese documento.",
      "Listo, ya quedó ese.",
      "Va, ese ya quedó."
    ]
  },

  income_proof_received: {
    casual: [
      "Listo, ya recibí el comprobante. Si tienes otro, mándalo. Cuando termines escribe *listo*.",
      "Perfecto, ya tengo ese comprobante. Puedes enviar otro o escribir *listo* si ya terminaste.",
      "Va, comprobante recibido. Si falta otro, mándalo; si no, escribe *listo*."
    ],
    directo: [
      "Comprobante recibido. Envíe otro si hace falta. Cuando termine, escriba *listo*.",
      "Ya recibí el comprobante. Si no enviará más, escriba *listo*.",
      "Archivo recibido. Para cerrar este paso, escriba *listo*."
    ],
    coloquial: [
      "Ya cayó el comprobante. Si traes otro, mándalo; si no, pon *listo*.",
      "Va, ese ya quedó. Si tienes más comprobantes, mándalos. Si no, escribe *listo*.",
      "Recibido. Si ya no vas a mandar más, pon *listo*."
    ]
  },

  document_required: {
    casual: [
      "Para avanzar necesito que me mandes el documento solicitado.",
      "Ahorita estoy esperando ese documento para poder seguir.",
      "Mándame el documento que sigue para continuar con tu solicitud."
    ],
    directo: [
      "Para continuar necesito el documento solicitado.",
      "En este paso debe enviar el documento correspondiente.",
      "Estoy esperando el documento de este paso."
    ],
    coloquial: [
      "Aquí sí necesito que me pases ese documento para seguir.",
      "Falta ese documento para poder avanzar.",
      "Mándame ese documento y seguimos."
    ]
  },

  no_income_proof_yet: {
    casual: [
      "Todavía no recibo comprobante de ingresos. Puedes mandarlo ahora o escribir *omitir*.",
      "Me falta el comprobante de ingresos. Si no lo tienes, escribe *omitir* y seguimos.",
      "Aún falta ese comprobante. Puedes enviarlo o poner *omitir*."
    ],
    directo: [
      "No tengo comprobante de ingresos registrado. Envíelo o escriba *omitir*.",
      "Falta comprobante de ingresos. Puede enviarlo ahora o escribir *omitir*.",
      "Para continuar, envíe comprobante de ingresos o escriba *omitir*."
    ],
    coloquial: [
      "Todavía no cae el comprobante de ingresos. Mándalo o pon *omitir*.",
      "Falta el comprobante. Si no lo tienes, pon *omitir* y avanzamos.",
      "Aquí falta ingresos. Si no hay comprobante, escribe *omitir*."
    ]
  },

  income_proof_issue: {
    casual: [
      "No pasa nada si no tienes talón. Puedes mandar capturas de depósitos, estado de cuenta o escribir *omitir*.",
      "Si te pagan en efectivo, puedes mandar capturas de depósitos o estado de cuenta. Si no tienes nada, escribe *omitir*.",
      "No hay problema. Manda lo que tengas de ingresos; si no cuentas con comprobante, escribe *omitir*."
    ],
    directo: [
      "Puede enviar capturas de depósitos, estado de cuenta o escribir *omitir* si no cuenta con comprobante.",
      "Si no tiene talón, puede usar capturas de depósitos o estado de cuenta.",
      "Para este paso aceptamos comprobantes alternativos. Si no tiene, escriba *omitir*."
    ],
    coloquial: [
      "No te atora si no tienes talón. Manda capturas, estado de cuenta o pon *omitir*.",
      "Si te pagan en efectivo, manda lo que tengas como respaldo. Si no hay, pon *omitir*.",
      "Sin talón también se puede avanzar. Manda capturas o escribe *omitir*."
    ]
  },

  yes_no_only: {
    casual: [
      "Respóndeme solo con *sí* o *no*, por favor.",
      "Para esta pregunta necesito únicamente *sí* o *no*.",
      "Aquí solo ocupamos respuesta de *sí* o *no*."
    ],
    directo: [
      "Responda únicamente *sí* o *no*.",
      "Para continuar, responda *sí* o *no*.",
      "Necesito una respuesta válida: *sí* o *no*."
    ],
    coloquial: [
      "Aquí va fácil: *sí* o *no*.",
      "Solo dime *sí* o *no* y seguimos.",
      "Con un *sí* o *no* queda."
    ]
  },

  loopback: {
    casual: [
      `Perdón, no me quedó claro.\n\n${MENU_MESSAGE}`,
      `No logré entender bien tu mensaje.\n\n${MENU_MESSAGE}`,
      `Creo que no entendí la respuesta.\n\n${MENU_MESSAGE}`
    ],
    directo: [
      `No pude interpretar su respuesta.\n\n${MENU_MESSAGE}`,
      `Respuesta no reconocida.\n\n${MENU_MESSAGE}`,
      `Para continuar, elija una opción válida.\n\n${MENU_MESSAGE}`
    ],
    coloquial: [
      `No agarré bien la respuesta.\n\n${MENU_MESSAGE}`,
      `Ahí sí no te entendí bien.\n\n${MENU_MESSAGE}`,
      `Se me cruzó la respuesta, vamos otra vez.\n\n${MENU_MESSAGE}`
    ]
  },

  restart_confirmed: {
    casual: [
      "Listo, vamos a empezar una nueva solicitud.",
      "Perfecto, dejamos la anterior y comenzamos de nuevo.",
      "Va, iniciamos una solicitud nueva."
    ],
    directo: [
      "Solicitud anterior descartada. Iniciamos una nueva.",
      "Se descartó la solicitud previa. Comenzamos nuevamente.",
      "Nueva solicitud iniciada."
    ],
    coloquial: [
      "Va, borrón y cuenta nueva. Empezamos otra.",
      "Listo, arrancamos de nuevo.",
      "Sale, dejamos esa y empezamos otra."
    ]
  },

  keep_current_application: {
    casual: [
      "Perfecto, seguimos con tu solicitud actual.",
      "Muy bien, conservamos tu trámite como está.",
      "Va, continuamos con el trámite actual."
    ],
    directo: [
      "Se conserva la solicitud actual.",
      "Continuaremos con el trámite actual.",
      "Solicitud actual conservada."
    ],
    coloquial: [
      "Va, seguimos con la que ya traías.",
      "Listo, no movemos la solicitud actual.",
      "Sale, seguimos donde íbamos."
    ]
  },

  confirm_restart_prompt: {
    casual: [
      "Si empiezas una nueva solicitud, la anterior se va a descartar.\n\nResponde *si* para empezar de nuevo o *no* para conservar la actual.",
      "Para hacer otra solicitud necesitamos cerrar la anterior.\n\nResponde *si* para continuar o *no* para dejarla como está.",
      "Si arrancamos otra solicitud, la anterior ya no se recupera.\n\nResponde *si* o *no*."
    ],
    directo: [
      "Si inicia una nueva solicitud, la anterior se descartará.\n\nResponda *si* para continuar o *no* para conservarla.",
      "Para iniciar otra solicitud debemos descartar la actual.\n\nResponda *si* o *no*.",
      "Confirme: *si* para nueva solicitud o *no* para conservar la actual."
    ],
    coloquial: [
      "Ojo: si empezamos otra, la anterior se borra.\n\nPon *si* para empezar otra o *no* para seguir con esta.",
      "Si arrancamos de nuevo, la solicitud anterior ya no sigue.\n\nResponde *si* o *no*.",
      "Aquí hay que confirmar: *si* para empezar otra, *no* para seguir igual."
    ]
  },

  invalid_restart_confirmation: {
    casual: [
      "Necesito que me confirmes con *si* o *no*.",
      "Para seguir, respóndeme solo *si* o *no*.",
      "Confírmame con *si* para empezar de nuevo o *no* para conservar tu trámite."
    ],
    directo: [
      "Responda solamente *si* o *no*.",
      "Confirmación inválida. Responda *si* o *no*.",
      "Para continuar debe responder *si* o *no*."
    ],
    coloquial: [
      "Aquí solo necesito *si* o *no*.",
      "Con un *si* o *no* avanzamos.",
      "Nada más confírmame: *si* o *no*."
    ]
  },

  not_interested: {
    casual: [
      "Gracias por responder. Quedamos a tus órdenes.",
      "Entendido, muchas gracias por tu tiempo.",
      "Gracias por avisarnos. Aquí estamos si más adelante te interesa."
    ],
    directo: [
      "Gracias por su respuesta.",
      "Entendido. Quedamos a sus órdenes.",
      "Muchas gracias por su tiempo."
    ],
    coloquial: [
      "Va, gracias por responder.",
      "Sale, gracias por tu tiempo.",
      "Entendido, aquí andamos por si después te interesa."
    ]
  },

  under_review: {
    casual: [
      "Tu solicitud ya está en revisión. En breve un asesor se comunica contigo.",
      "Ya tenemos tu solicitud en revisión. Mantente pendiente, por favor.",
      "Listo, tu trámite ya está en revisión con un asesor."
    ],
    directo: [
      "Su solicitud ya se encuentra en revisión. Un asesor se comunicará en breve.",
      "Solicitud en revisión. Espere contacto de un asesor.",
      "El trámite ya fue enviado a revisión."
    ],
    coloquial: [
      "Ya está en revisión. Nomás mantente pendiente.",
      "Ya quedó en revisión con asesor.",
      "Va, ya está del lado de revisión."
    ]
  },

  update_requires_new_application: {
    casual: [
      "Para cambiar datos necesitamos iniciar una nueva solicitud. Escribe *nueva solicitud* y actualizamos todo desde el inicio.",
      "Si quieres modificar información, hay que empezar una nueva solicitud para revisar todo bien.",
      "Para actualizar tus datos, escribe *nueva solicitud*."
    ],
    directo: [
      "Para actualizar información debe iniciar una nueva solicitud.",
      "Los cambios requieren una nueva solicitud.",
      "Para modificar datos, escriba *nueva solicitud*."
    ],
    coloquial: [
      "Para mover datos hay que arrancar otra solicitud.",
      "Si quieres cambiar información, toca hacer una nueva.",
      "Para corregir datos, escribe *nueva solicitud* y lo hacemos bien desde cero."
    ]
  },

  omitted_answer: {
    casual: [
      "Listo, seguimos.",
      "Va, pasamos esa.",
      "De acuerdo, continuamos."
    ],
    directo: [
      "Respuesta omitida.",
      "Omitido. Continuamos.",
      "Se omitió la respuesta."
    ],
    coloquial: [
      "Va, esa la brincamos.",
      "Sale, seguimos con la siguiente.",
      "Listo, nos vamos a la que sigue."
    ]
  },

  personal_phone_saved: {
    casual: [
      "Listo, tomaré ese número como tu celular personal.",
      "Perfecto, usaré ese como tu celular personal.",
      "Va, registro ese número como tu celular personal."
    ],
    directo: [
      "Número personal registrado.",
      "Se registró ese número como celular personal.",
      "Usaré ese número como celular personal."
    ],
    coloquial: [
      "Va, ese queda como tu celular.",
      "Listo, ese número queda registrado.",
      "Sale, tomo ese como tu celular."
    ]
  },

  missing_expected_document: {
    casual: [
      "No encontré qué documento seguía. Retomemos tu paso actual.",
      "Parece que se me cruzó el documento pendiente. Te recuerdo el paso.",
      "No tengo claro qué documento seguía. Retomamos el flujo."
    ],
    directo: [
      "No encontré el documento pendiente. Retomemos el paso actual.",
      "Documento pendiente no identificado. Retomamos el flujo.",
      "No fue posible identificar el documento esperado."
    ],
    coloquial: [
      "Se me cruzó qué documento seguía. Vamos al paso actual.",
      "No ubico cuál documento tocaba. Retomamos.",
      "Vamos a retomar porque no veo el documento pendiente."
    ]
  },

  income_proof_instruction: {
    casual: [
      "Puedes enviar uno o varios comprobantes. Cuando termines, escribe *listo*.",
      "Manda tus comprobantes de ingresos. Al terminar escribe *listo*.",
      "Puedes mandar más de un archivo. Cuando acabes, escribe *listo*."
    ],
    directo: [
      "Envíe el comprobante de ingresos. Cuando termine, escriba *listo*.",
      "Puede enviar varios comprobantes. Al terminar, escriba *listo*.",
      "Para cerrar este paso, envíe comprobante o escriba *omitir*."
    ],
    coloquial: [
      "Manda lo que tengas de ingresos. Cuando termines pon *listo*.",
      "Puedes mandar varios. Ya que acabes, pon *listo*.",
      "Si traes más comprobantes, mándalos; si no, escribe *listo*."
    ]
  },

  pending_restart_media: {
    casual: [
      "Antes de seguir, respóndeme *si* o *no* sobre la nueva solicitud.",
      "Primero necesito confirmar si quieres empezar de nuevo: *si* o *no*.",
      "Para continuar, confirma con *si* o *no*."
    ],
    directo: [
      "Antes de continuar, responda *si* o *no*.",
      "Confirme la nueva solicitud con *si* o *no*.",
      "Pendiente confirmación: responda *si* o *no*."
    ],
    coloquial: [
      "Primero dime *si* o *no* para lo de empezar otra.",
      "Aquí falta confirmar: *si* o *no*.",
      "Con un *si* o *no* seguimos."
    ]
  },

  files_not_needed: {
    casual: [
      "Aún no necesito archivos. Sigamos con el paso actual.",
      "Por ahora no ocupamos archivos. Continuemos con la pregunta.",
      "Todavía no estamos en documentos. Te recuerdo el paso."
    ],
    directo: [
      "Aún no necesito archivos. Continúe con el paso actual.",
      "Archivo no requerido en este paso.",
      "Por ahora continúe con la pregunta actual."
    ],
    coloquial: [
      "Todavía no toca mandar archivos. Seguimos con la pregunta.",
      "Ahorita no ocupamos archivo. Vamos con el paso actual.",
      "Ese archivo todavía no toca. Te recuerdo qué sigue."
    ]
  },

  unknown_document_expected: {
    casual: [
      "No pude identificar qué documento correspondía.",
      "No me quedó claro qué documento esperaba el sistema.",
      "Tuve problema identificando ese documento."
    ],
    directo: [
      "No fue posible identificar el documento esperado.",
      "Documento esperado no identificado.",
      "No se identificó el documento correspondiente."
    ],
    coloquial: [
      "No ubiqué qué documento tocaba.",
      "Se me cruzó el documento esperado.",
      "No pude ver cuál documento seguía."
    ]
  }
};

const TONE_BY_STAGE = {
  menu: "casual",
  faq: "casual",
  question: "directo",
  validation_error: "casual",
  document_request: "directo",
  document_received: "casual",
  income_issue: "coloquial",
  restart_confirmation: "directo",
  under_review: "casual",
  close: "coloquial"
};

function pickVariant(group, tone = "casual") {
  const variants = AI_REPLY_VARIANTS[group];

  if (!variants) return null;

  if (Array.isArray(variants)) {
    return variants[Math.floor(Math.random() * variants.length)];
  }

  const options = variants[tone] || variants.casual || variants.directo || [];
  return options[Math.floor(Math.random() * options.length)];
}


// =========================
// VALIDATION RULES
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
      const match = String(value || "").replace(/,/g, "").match(/(\d+(\.\d+)?)/);
      const num = match ? parseFloat(match[1]) : 0;
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
  income_type: {
    validate: (value) => {
      const clean = (value || "").toLowerCase().trim();
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
      const clean = (value || "").toLowerCase().trim();
      return clean.includes("semana") || clean.includes("quincena") || clean.includes("mes") || clean.includes("mensual");
    },
    errorMsg: "Por favor indique si el ingreso es por semana, por quincena o por mes."
  },
  household_income_details: {
    validate: (value) => {
      const clean = (value || "").trim();
      return clean.length >= 3 && /\d/.test(clean);
    },
    errorMsg: "Por favor indique quién aporta, cuánto aporta y cada cuándo. Ejemplo: mi esposo gana 8000 a la semana."
  },
  debt_payments: {
    validate: (value) => {
      const clean = (value || "").toLowerCase().trim();
      return KEYWORDS.NO.has(clean) || clean === "0" || /\d/.test(clean);
    },
    errorMsg: "Por favor indique cuánto paga por semana o quincena en otras deudas. Si no tiene pagos, responda 0 o no."
  },
  marital_status: {
    validate: (value) => {
      const clean = (value || "").toLowerCase().trim();
      const options = ["soltero", "casado", "viudo", "divorciado", "separado"];
      return options.some(opt => clean.includes(opt));
    },
    errorMsg: "Por favor seleccione una opción válida: soltero(a), casado(a), viudo(a), divorciado(a) o separado(a)."
  },
  yesno: {
    validate: (value) => {
      const clean = (value || "").toLowerCase().trim();
      return KEYWORDS.YES.has(clean) || KEYWORDS.NO.has(clean);
    },
    errorMsg: "Por favor responda solo sí o no."
  },
  time_period: {
    validate: (value) => {
      const clean = (value || "").toLowerCase().trim();
      const hasNumber = /\d/.test(clean);
      return hasNumber && clean.length >= 1;
    },
    errorMsg: "Por favor introduzca el tiempo (ej: 2 años, 2 años y 8 meses, 2.5)"
  }
};

module.exports = {
  CONFIG,
  MESSAGES,
  KEYWORDS,
  DOCUMENTS,
  VALIDATION_RULES,
  AI_OPERATOR,
  AI_REPLY_VARIANTS,
  TONE_BY_STAGE,
  pickVariant
};
