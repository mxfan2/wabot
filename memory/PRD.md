# Wabot · Production version

## Original problem statement
> "build production version of project" — proyecto: wabot (bot de WhatsApp Cloud API en Node.js + SQLite + Puppeteer + Conekta + IA local).

## User decisions
- **Production = (b) migrar stack a algo robusto + (c) dashboard React de administración**.
- Despliegue: **(b) propio VPS / Windows server** (no Emergent K8s).
- Mantener **SQLite** (no migrar DB).
- LLM del bot: cambiar la **lógica de respuesta** porque "responde fuera de contexto" → migrar de qwen local a **Claude Sonnet 4.5** vía Emergent Universal Key.
- Dashboard React servido por el **mismo Express** como build estático.

## Architecture (final)
```
[WhatsApp Cloud API] ⇄ Express (server.js)
                         │
                         ├── /webhook (entradas)
                         ├── /payments/conekta/webhook
                         ├── /api/admin/login (JWT bcrypt)
                         ├── /dashboard/api/* (protegidos JWT)
                         ├── /dashboard/file (protegido JWT)
                         ├── /erp/api/* (protegido JWT)
                         └── /  ← React SPA estático (public/)
                         
SQLite (data/bot.db) · Downloads (downloads/) · Logs · ai/ knowledge

aiOperator.js → Claude Sonnet 4.5 vía https://integrations.emergentagent.com/llm/chat/completions
                (OpenAI-compat, Bearer sk-emergent-…)
                Fallback: variantes aprobadas en config.js
```

## Implemented
- **2026-01**: Migrado código a /app/wabot, recompilado sqlite3 para Linux.
- **LLM swap**: `aiOperator.requestLocalAi()` patcheado para soportar Bearer auth, omitir `response_format` cuando el provider es Anthropic/Claude, e inyectar instrucción "Respond with ONLY valid JSON" reforzada.
- **Auth admin**: `auth.js` (bcryptjs + jsonwebtoken). Endpoints `/api/admin/login`, `/api/admin/me`. Middleware JWT protegiendo `/dashboard/api`, `/dashboard/file`, `/erp/api`.
- **React Dashboard** (Vite, React 18, react-router): login, lista de clientes con búsqueda, detalle (resumen calificación, documentos con miniaturas, chat history), composer mensaje manual, iniciar conversación, archivar/eliminar. Buildeado a `/app/wabot/public`. Tema oscuro custom (no purple gradient slop).
- **Express integration**: SPA servido en `/`, fallback de rutas SPA, `/dashboard` redirige al SPA si hay build, legacy HTML conservado de fallback si no.
- **Demo seed**: `scripts/seed-demo.js` carga "María Demo López" (5215550001234) con calificación casi completa.
- **Config**: `.env` con MOCK_WHATSAPP_SEND=true para pruebas, `.env.example` documentado, EMERGENT_LLM_KEY embebida.
- **README_PRODUCCION.md** completo: requisitos, instalación, env vars, generación bcrypt, PM2 Linux, NSSM Windows, configuración webhook Meta, cambio de LLM, backup, troubleshooting.

### Smoke tests pasados
- ✅ `POST /api/admin/login` → token JWT
- ✅ `GET /api/admin/me` con Bearer token
- ✅ `GET /dashboard/api/clients` (1 cliente seeded)
- ✅ `GET /dashboard/api/clients/:waId` (resumen + 3 mensajes + 21 campos)
- ✅ `POST /dashboard/api/clients/:waId/message` (en MOCK mode, persiste en BD, mueve a stage `contacted`)
- ✅ `GET /` (HTML React)
- ✅ `GET /assets/*` (JS+CSS bundle)
- ✅ Sin token → 401
- ✅ Claude Sonnet 4.5 vía proxy Emergent responde JSON correctamente
- ✅ UI: login → dashboard → detalle cliente (3 screenshots Playwright OK)

## Tech stack
- Backend: Node.js 20, Express 5, SQLite3, bcryptjs, jsonwebtoken, axios
- Frontend: React 18 + Vite 5 + react-router-dom 6
- LLM: Claude Sonnet 4.5 (anthropic) via Emergent Universal Key
- WhatsApp: Cloud API v23.0
- Pagos (opcional): Conekta SPEI

## P0 / P1 / P2 backlog (Fase 3)

### Done in Fase 2
- ✅ ERP en React: Resumen ejecutivo (saldo activo, vencidos, vence hoy, por aprobar, no conciliados) + tabs Listos para préstamo / Préstamos / Cuotas. Aprobación de préstamo con form (capital, pago semanal, plazo, primer venc.). Cobranza Conekta automática (cuando `CONEKTA_ENABLED=true`). Marcar cuota pagada manualmente. Editar notas de préstamo.
- ✅ WebSocket en vivo (Socket.IO): la sidebar y el detalle se actualizan solos cuando entra mensaje o cambia un cliente. Indicador `● Live` con pulso verde.
- ✅ PWA instalable: `manifest.webmanifest`, `sw.js` (network-first SPA, cache-first assets, no-cache APIs), íconos 192/512.
- ✅ Capacitor scaffolding (`capacitor.config.json`) + `ANDROID.md` con guía paso a paso para empaquetar como APK Android usando Android Studio en Windows. Caso de uso: asesor en calle.

### P0 (siguiente sesión)
- Compact PDF del expediente desde la nueva UI (botón ya existe en tab "Listos para préstamo", abre el endpoint legacy — verificar que `?token=` en query funcione bien con `requireAuth`).
- Multiusuario admin con roles (asesor / supervisor) — hoy es 1 admin del .env.
- Métricas: % calificación completada, tiempo promedio de respuesta, score promedio.

### P1
- Captura nativa de fotos en la app Android (Capacitor Camera) para que el asesor suba INE/comprobantes en sitio.
- FCM push notifications para asesores cuando llega un lead nuevo.
- Subir documentos manualmente desde el dashboard (drag & drop).

### P2
- Migración a PostgreSQL (si crece el volumen).
- Login biométrico en Android.
- Auditoría / log de acciones de admin.

## Files of note
- `/app/wabot/server.js` — Express principal (3200 líneas, embedded HTML legacy preservado)
- `/app/wabot/auth.js` — JWT + bcrypt
- `/app/wabot/aiOperator.js` línea 230 — `requestLocalAi` (LLM-agnóstico)
- `/app/wabot/config.js` — keywords, validación, prompts, AI variants
- `/app/wabot/dashboard/src/Dashboard.jsx` — UI principal
- `/app/wabot/README_PRODUCCION.md` — guía de despliegue VPS/Windows
- `/app/wabot/.env.example` — plantilla de variables
- `/app/memory/test_credentials.md` — credenciales admin para pruebas

## Test credentials
- Admin user: `admin`
- Admin password: `admin123` (cambia en producción usando bcrypt hash)
