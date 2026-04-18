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

  // Time thresholds (in hours)
  QUESTION_REMINDER_HOURS: 1,
  DOCUMENT_REMINDER_HOURS: 2,
  WELCOME_BACK_HOURS: 4,

  // Scoring weights
  SCORING: {
    INCOME_PROOF: 20,
    JOB_YEARS: { '1-2': 5, '3-5': 10, '6+': 20 },
    HOME_YEARS: { '1-2': 5, '3-5': 10, '6+': 20 },
    HOME_OWNERSHIP: 15,
    NO_DEBT: 15,
    MARITAL_STATUS: { married: 5, single: 10 },
    AGE_RANGE: { min: 25, max: 55, points: 10 }
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
const MENU_MESSAGE = `*PRÉSTAMOS RÁPIDOS Y SENCILLOS*
*SIN DEJAR EMPEÑO FÍSICO*
*---*
Plazos de pago flexibles:
✔ 10 semanas
✔ 5 quincenas

*_UNA VEZ LIQUIDADO, PUEDE VOLVER A SOLICITAR OTRO PRÉSTAMO O, A PARTIR DEL 6.º PAGO, PUEDE RENOVAR._*
*---*
*SI PIDES | PAGAS A LA SEMANA*

$2,000 → $350
$3,000 → $450
$4,000 → $600
$5,000 → $750
*---*
*POR FAVOR ELEGIR UNA DE LAS SIGUIENTES OPCIONES*

*1) QUIERO MÁS INFORMACIÓN*
*2) ME INTERESA*`;

const MESSAGES = {
  MENU: MENU_MESSAGE,

  FAQ: `*PREGUNTAS FRECUENTES:*

*• Requisitos:*
INE y comprobante de domicilio a su nombre (predial o agua).

*• Tiempo de proceso:*
Máximo 2 horas. Recibe su dinero el mismo día.

*• ¿Cómo se realiza?*
Todo el trámite es por WhatsApp. No necesita acudir a ningún lugar. Entrega a domicilio en efectivo.

*• ¿Revisan Buró de Crédito?*
No. Solo se solicita informar si cuenta con deudas pendientes.
*---*
*1) ME INTERESA*
*2) NO ME INTERESA*`,

  LOOPBACK: `Lo siento no logro entenderle.

${MENU_MESSAGE}`,

  PRE_QUESTION_5: `La respuesta de la siguiente pregunta me va a salir en el sistema, pero es muy importante que nos diga la verdad para que coincida y no sea rechazada su solicitud.`,

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

  CLOSED: "Su proceso anterior fue completado. ¿Le gustaría iniciar una nueva solicitud?\n\nEscriba 'nueva solicitud' para comenzar o 'estado' para más información.",

  WELCOME_BACK: "¡Bienvenido de vuelta! Continuemos con su solicitud.",

  CONTINUE: "Continuando donde dejó..."
};

// =========================
// KEYWORD SETS
// =========================
const KEYWORDS = {
  RESTART: new Set([
    "hola", "menú", "menu", "reinicio", "reiniciar", "iniciar",
    "empezar", "comenzar", "volver a empezar", "regresar al inicio"
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
    "1", "2", "info", "información", "informacion", "mas informacion",
    "más información", "me interesa", "interesa", "interesado", "interes", "si", "sí"
  ]),

  STAGE2_INTERESTED: new Set([
    "1", "me interesa", "si", "sí", "ok", "va"
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

module.exports = { CONFIG, MESSAGES, KEYWORDS, DOCUMENTS, VALIDATION_RULES };
