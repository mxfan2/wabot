# Changelog
## 2026-04-17 22:30:19 - Backup and Change Tracking
- Added this `CHANGELOG.md` to document future project changes.
- Created a backup snapshot in `backups/20260417-223019/` before further modifications.
- Working rule going forward: create a backup snapshot before modifying code and log the change here.

## 2026-04-17 22:33:49 - Git Initialization Prep
- Created a backup snapshot in `backups/20260417-223349/` before preparing the repository for git.
- Added `.gitignore` to exclude dependencies, local databases, downloads, backups, and environment files from version control.

## 2026-04-18 12:05:00 - Message Timezone Fix
- Corrected dashboard message timestamp parsing in `server.js`.
- SQLite `CURRENT_TIMESTAMP` values were being interpreted as local time instead of UTC, which caused message hours to appear shifted.
- The dashboard now marks stored timestamps as UTC before formatting them for the browser locale.

## 2026-04-19 00:00:00 - Dashboard Upgrade and Contacted Stage
- Reworked the dashboard in `server.js` from a simple conversation viewer into an operations dashboard with summary cards, completed qualification quick view, incomplete qualification quick view, detailed qualification answers, uploaded document access, and full message history.
- Added dashboard APIs for richer applicant detail payloads, secure document file serving, and manual custom outbound messages.
- Added a new `contacted` workflow stage and `advisor_contacted` status so completed applicants can be clearly tracked after advisor outreach.
- Manual messages sent from the dashboard now move completed applicants into the contacted stage and mark `advisor_contacted = 1`.
- Expanded dashboard query data in `database.js` so qualification and document progress can be shown without extra lookups.
- Removed synthetic stress-test chat data from the database: 25 fake clients and 210 related messages created by `stress-test.js`.

## 2026-04-19 00:20:00 - Qualification Skip and Phone Flow Fixes
- Tightened qualification skip handling in `flow.js` so only explicit skip commands like `omitir` trigger a skipped answer; short replies such as `si` no longer collide with `skip`.
- Updated qualification question prompts to explicitly remind applicants that they can write `omitir` to skip the current question.
- Moved the personal phone confirmation special-case handling ahead of generic validation so a direct phone number response is captured correctly.
- Improved the work phone question so applicants who do not have an office number are told they can skip instead of getting stuck in repeated phone validation errors.

## 2026-04-24 22:39:00 - Local AI Operator Starter Integration
- Created a backup snapshot in `backups/20260424-223917/` before adding the local AI operator integration.
- Added `aiOperator.js` to call a local OpenAI-compatible Ollama chat endpoint, validate JSON responses, and restrict model output to exact approved reply variants.
- Added local AI configuration flags and approved Spanish reply variants in `config.js`.
- Wired AI-selected reply variation into safe conversation points in `flow.js` and media/document handling in `server.js`.
- Added optional background operator action proposals for observability while preserving the existing deterministic workflow router.
- Enabled local AI production mode in `.env` with `LOCAL_AI_ENABLED=true` and `LOCAL_AI_DRY_RUN=false`.
- Increased the local AI timeout and capped model output tokens after direct Ollama testing showed `qwen3:14b` can take longer than 20 seconds on first JSON replies.
- Disabled Qwen thinking for Ollama OpenAI-compatible chat calls with `reasoning_effort: "none"`/`think: false` so the model returns JSON content instead of spending the response budget on reasoning.
- Switched the local AI operator default from `qwen3:14b` to `qwen3:8b` for faster approved-variant selection, and removed the local `qwen3:14b` model after confirming `qwen3:8b` was installed.
- Adjusted AI reply validation so an exact approved variant is accepted even when a smaller model reports a low confidence number.

## 2026-04-24 23:40:00 - Local AI Health Check Command
- Created a backup snapshot in `backups/20260424-234028/` before adding the AI health-check command.
- Added `LOCAL_AI_HEALTHCHECK_TOKEN` so an exact secret WhatsApp message can test whether the local AI operator is reachable and returning approved variants.
- Added `diagnoseLocalAi()` in `aiOperator.js` and wired the diagnostic reply into `server.js` before normal conversation routing.

## 2026-04-24 23:45:00 - AI Operator Debug Log
- Created a backup snapshot in `backups/20260424-234544/` before adding dedicated AI debug logging.
- Added `LOCAL_AI_DEBUG_LOG` and JSON-lines logging to `logs/ai-operator.log` for AI reply selection, health checks, action proposals, fallbacks, and errors.
- Added `logs/` to `.gitignore` so runtime AI debug logs are not tracked.

## 2026-04-25 00:08:00 - Grounded Flexible AI Replies
- Created backup snapshots in `backups/20260424-234544/` and `backups/20260425-000808/` before changing AI behavior.
- Added AI grounding files under `ai/`: `identity.md`, `loan-facts.md`, `conversation-rules.md`, `safety-boundaries.md`, and `flexible-reply-contract.md`.
- Added `draftFlexibleReply()` so the local model can write short natural replies grounded in the AI context files and current conversation state.
- Wired flexible replies into high-friction points such as invalid answers, missing work phone, document confusion, and income-proof questions while keeping scripted fallbacks.

## 2026-04-25 00:13:00 - AI Escalation to Advisor
- Created a backup snapshot in `backups/20260425-001349/` before adding advisor escalation.
- Updated the flexible AI contract so unsure replies can include a suggested response for advisor approval.
- Added AI escalation handling that sends the advisor the client, stage, current question/document context, recent chat history, model reason, and suggested reply.
- Applicant-facing escalation replies stay short and do not expose internal AI policy details.

## 2026-04-25 00:18:00 - Qualification Question Guard
- Created a backup snapshot in `backups/20260425-001824/` before changing qualification routing.
- Added handling so question-like messages during qualification are answered or escalated by the grounded AI and do not get saved as the applicant's answer.
- Updated AI conversation rules to repeat the current qualification question after answering an applicant question.
- Tightened AI loan facts and validation so the model cannot confirm or deny geographic coverage such as service in Colombia unless approved facts are added later.

## 2026-04-25 00:21:00 - Coverage Facts
- Created a backup snapshot in `backups/20260425-002150/` before updating AI loan facts.
- Added current operating coverage to `ai/loan-facts.md`: Mexico, Sonora, currently Guaymas and Ciudad Obregon, with Hermosillo planned soon.
- Updated safety boundaries so location questions use the approved coverage facts instead of escalating every geography question.

## 2026-04-25 00:37:00 - Risk Score V2
- Created a backup snapshot in `backups/20260425-003704/` before changing the scoring model.
- Added `docs/risk-scoring-review.md` with research-backed scoring recommendations and future data-collection guidance.
- Reworked score weights toward repayment capacity, income verification, employment/residence stability, debt exposure, and document completeness.
- Removed positive score points for age and marital status; these fields may still be collected but are no longer used as score advantages.
- Updated the income question to ask applicants to specify whether income is weekly, biweekly, or monthly.
- Recalculate the score after document completion so uploaded documentation contributes to advisor review.

## 2026-04-25 00:53:00 - Income and Debt Detail Questions
- Created a backup snapshot in `backups/20260425-005335/` before expanding qualification questions.
- Added database fields for income type, income frequency, extra household income, extra household income details, and current debt payments.
- Reworked the work/income questions to identify employment, self-employment, pension, household support, unemployment, or other income source.
- Added smart handling for extra household income: full answers are captured in one step; plain yes responses trigger a follow-up asking who contributes, how much, and how often.
- Added current debt payment collection and included debt payments in net weekly household income for scoring.
- Shortened new applicant prompts and split the "omitir" reminder into a separate message to keep WhatsApp replies human-sized.

## 2026-04-25 01:40:00 - Tone-Aware Reply Variants
- Created a backup snapshot in `backups/20260425-014036/` before updating tone-aware reply selection.
- Added `TONE_BY_STAGE` and `pickVariant()` to `config.js`.
- Updated the AI operator to support tone-grouped `AI_REPLY_VARIANTS` such as `casual`, `directo`, and `coloquial`.
- Limited approved-variant prompts to the selected tone group so the model does not drift into a different style.

## 2026-04-25 01:57:00 - Config/Flow Consistency Pass
- Created a backup snapshot in `backups/20260425-015719/` before reconciling `config.js` and `flow.js`.
- Added missing tone-aware reply variant groups still referenced by the flow and media handlers.
- Updated numeric validation in `config.js` to accept formatted values like `3,000`, matching `utils.js`.
- Restricted skip handling so only optional questions can be omitted; required questions now ask the applicant to answer instead of silently saving `OMITIDO`.

## 2026-04-25 02:05:00 - Trigger Alignment for Short Scripts
- Created a backup snapshot in `backups/20260425-020519/` before changing keyword triggers.
- Moved `iniciar`, `empezar`, and `comenzar` out of global restart intent and into application-start intent.
- Updated FAQ/info triggers to match the shorter menu copy: "más información", "info", "informes", and related phrases.
- Kept legacy `1` for info and `2` for start, but no longer lets `2` collide with FAQ intent.
- Replaced fuzzy global restart matching with exact/phrase matching so `iniciar` is not mistaken for `reiniciar`.

## 2026-04-25 02:12:00 - Underage Gate
- Created a backup snapshot in `backups/20260425-021254/` before adding the age restriction.
- Added an age gate in the qualification flow: age 17 or below closes the application with `status = underage`; age 18 or above continues normally.
- Added a short underage closure message in `config.js`.

## 2026-04-30 - WhatsApp Bot Stabilization, Dashboard PDF, ERP Shell, and Conekta Recurrent SPEI by CODEX
- Updated the active workspace to `C:\Users\caval\wabot` after the project folder was renamed from earlier backup-style paths.
- Added webhook visibility in `server.js` so inbound WhatsApp payloads log object type, entry/message/status counts, message type, sender, and message id without exposing secrets.
- Added `/privacy` and `privacy.html` for Meta app publishing requirements.
- Updated the initial menu message in `config.js` to the newer quick-loan copy:
  - thanks the user for contacting,
  - mentions fast loans without pawn,
  - gives the `$3,000` / `10 weeks` / `$450 weekly` example,
  - invites the applicant to discover qualification through simple questions.
- Added safer WhatsApp Graph sending in `whatsapp.js`:
  - configurable timeout via `WHATSAPP_SEND_TIMEOUT_MS`,
  - configurable retry count via `WHATSAPP_SEND_RETRIES`,
  - retry handling for transient network/API failures,
  - sanitized Axios error summaries so logs do not dump authorization headers.
- Fixed duplicate server startup confusion by checking and restarting the process listening on port `3001`.
- Confirmed webhook health with `npm run test:webhook` after restarts.

### Local AI and Chat Naturalness
- Updated launcher behavior in `start-all.bat` and `start-bot.bat` so Ollama/local AI is warmed before the bot starts and duplicate listeners are detected.
- Added and wired additional AI grounding files:
  - `ai/code-of-conduct.md`
  - `ai/privacy.md`
- Expanded `aiOperator.js` with personalized context from database state and recent conversation history.
- Added advisor-only insight command support through `admin insight ...`, gated to `ADVISOR_PHONE`.
- Added local AI thinking controls:
  - `LOCAL_AI_THINK`
  - `LOCAL_AI_ADMIN_THINK`
- Disabled thinking for normal applicant replies after `qwen2.5:3b` returned Ollama/OpenAI-compatible `400` errors when `think/reasoning_effort` was enabled.
- Updated AI request construction so `think` and `reasoning_effort` are omitted entirely when disabled.
- Added `<think>...</think>` stripping for model responses before JSON parsing.
- Changed `.env` runtime defaults during testing to use:
  - `LOCAL_AI_MODEL=qwen2.5:3b`
  - `LOCAL_AI_TEMPERATURE=0.35`
  - `LOCAL_AI_THINK=false`
- Added contradiction guards so AI replies cannot ask for "si o no" when the current question expects another answer type, such as address or marital status.
- Reduced AI control over qualification questions after it generated an invalid prompt like "Como puedo ayudarte con la direccion de tu domicilio?"
- Changed `flow.js` so actual form questions are now sent from deterministic question text, with only small deterministic transition prefixes. AI can still help with clarifications and validation errors, but it no longer rewrites core form questions.

### Qualification Flow and Validation Fixes
- Fixed validation type mismatches:
  - `q2_age` now validates with `age`.
  - `q11_average_income` now validates with `income_amount`.
- Tightened `utils.js` validation for:
  - age,
  - income amount,
  - address,
  - time period,
  - debt payment amount,
  - placeholder/fake answers,
  - repeated digit spam.
- Relaxed address validation enough to accept realistic short references such as `Av 12 y calzada`, while still rejecting fake answers like `es privado 666`.
- Added `sendHumanizedQuestion()` in `flow.js`, later restricted to deterministic question text for safety.
- Added `asksToRepeatQuestion()` and `repeatCurrentQuestion()` so users can ask "que pregunta", "cual era la pregunta", "repite", or "no entendi" and get the exact current question again.
- Added recovery for pending restart confirmations when users ask what question they were on, allowing the bot to return to the saved application step instead of looping on restart confirmation.
- Reprocessed a stuck test conversation so `Av 12 y calzada` was saved as `work_address` and the user advanced to the next step.
- Corrected a live invalid AI-generated question by resending the exact prompt `Cual es la direccion de tu domicilio?`.
- Created `preguntas-formulario.txt` containing only the current form questions for external review.

### Dashboard and Compact PDF Card
- Added a compact printable/PDF applicant card in `server.js`:
  - `GET /dashboard/clients/:waId/compact-card`
  - `GET /dashboard/clients/:waId/compact-card.pdf`
- Installed `puppeteer` and added it to `package.json` / `package-lock.json` for server-side PDF generation.
- Added a **Compact PDF** button to the existing dashboard applicant detail header.
- Compact PDF includes:
  - applicant header,
  - qualification summary,
  - all stored answers,
  - document images,
  - no conversation history.
- PDF image sizing:
  - INE front/back: `280 x 180`,
  - comprobante de domicilio: approx. `400 x 800`,
  - fachada del domicilio: approx. `400 x 800`,
  - other images use a compact preview size.
- Verified PDF generation returns `application/pdf` and that webhook tests still pass after adding Puppeteer.

### ERP Planning and Initial Shell
- Added initial `/erp` route in `server.js` as a separate operations surface from the conversation dashboard.
- ERP shell currently includes planned navigation for:
  - Resumen,
  - Solicitudes aprobadas,
  - Cuentas activas,
  - Pagos de hoy,
  - Conciliacion Conekta,
  - Atrasos,
  - Reportes.
- ERP design direction:
  - dashboard remains for conversations, applications, documents, and applicant review;
  - ERP will own loans, active accounts, payment schedules, payment reconciliation, overdue accounts, and reporting.
- Documented intended procedure:
  - approve application,
  - create loan/account,
  - create Conekta customer and recurrent SPEI payment source,
  - issue payment CLABE/ficha,
  - receive Conekta webhook,
  - match payment to order/loan/installment,
  - apply payment,
  - update balance,
  - send receipt by WhatsApp.

### Conekta Integration
- Added `conekta.js` for Conekta API operations.
- Added Conekta configuration in `config.js`:
  - `CONEKTA_ENABLED`
  - `CONEKTA_API_KEY`
  - `CONEKTA_API_BASE_URL`
  - `CONEKTA_API_VERSION`
  - `CONEKTA_DEFAULT_EMAIL`
  - `CONEKTA_WEBHOOK_SECRET`
  - `CONEKTA_WEBHOOK_PUBLIC_KEY`
- Replaced the initial one-off SPEI assumption with the documented Conekta recurrent SPEI flow:
  - create customer,
  - create `payment_source` with `type: "spei_recurrent"`,
  - store reusable CLABE/reference and bank,
  - create orders using `reuse_customer_clabe: true`,
  - use Checkout integration metadata/url where returned.
- Added Conekta helper functions:
  - `createCustomer()`
  - `createSpeiRecurrentPaymentSource()`
  - `createReusableClabeOrder()`
  - `extractSpeiPaymentInfo()`
  - `extractCheckoutInfo()`
  - `summarizeConektaError()`
- Added database fields on `clients` for Conekta linkage:
  - `conekta_customer_id`
  - `conekta_spei_source_id`
  - `conekta_spei_clabe`
  - `conekta_spei_bank`
- Added payment tables in `database.js`:
  - `payment_orders`
  - `payment_transactions`
- Added schema migration support for `payment_orders` fields:
  - `checkout_id`
  - `checkout_url`
  - `checkout_status`
  - `reusable_clabe`
- Added database helpers:
  - `createPaymentOrder()`
  - `getPaymentOrderByProviderOrderId()`
  - `markPaymentOrderPaid()`
  - `savePaymentTransaction()`
- Added route to create a Conekta recurrent SPEI order for an existing client:
  - `POST /dashboard/api/clients/:waId/conekta/spei-order`
- Added Conekta webhook route:
  - `POST /payments/conekta/webhook`
- Webhook handling currently:
  - verifies signature,
  - stores ignored events for audit,
  - processes `order.paid`,
  - attempts to match by stored `provider_order_id`,
  - marks matched orders as paid,
  - stores unmatched paid orders as `unmatched_order`,
  - sends WhatsApp receipt for matched orders with a known `wa_id`.
- Confirmed the first provided Conekta key was a public tokenization key and caused `401 Acceso no autorizado`.
- Replaced it in `.env` with the private test API key provided later.
- Successfully tested the private key:
  - customer creation succeeded,
  - `spei_recurrent` payment source creation succeeded,
  - reusable CLABE was returned,
  - order with `reuse_customer_clabe: true` was created,
  - checkout id/url were present,
  - `charges` can be absent initially, which matches Conekta's recurrent SPEI behavior.
- Added Conekta webhook signature verification:
  - captures raw webhook body using `express.json({ verify })`,
  - stores the public webhook key in `CONEKTA_WEBHOOK_PUBLIC_KEY`,
  - formats single-line PEM values back into valid PEM,
  - verifies `DIGEST` header with RSA-SHA256,
  - rejects unsigned/invalid webhook calls with `401`.
- Verified unsigned fake webhook is rejected.
- Verified real Conekta signed events were received and stored.
- Observed test payments received from Conekta:
  - `order.paid` SPEI event for `$750.00 MXN`,
  - related `charge.created`, `charge.paid`, `order.created`, and `order.pending_payment` events.
- The test payment was stored as `unmatched_order` because it was created outside Wabot/ERP and did not match any stored `payment_orders.provider_order_id`, `wa_id`, `loan_id`, or `installment_id`.
- Identified that future ERP-generated payment orders must include metadata such as:
  - `wa_id`,
  - `loan_id`,
  - `installment_id`,
  - Conekta customer id,
  - recurrent CLABE/source id.

### Known Current Gaps / Next Work
- Build real ERP loan models:
  - `loans`,
  - `payment_schedule`,
  - formal balance tracking,
  - overdue states,
  - payment application rules.
- Add ERP UI flows:
  - approve application,
  - create active loan,
  - generate payment schedule,
  - create Conekta recurrent SPEI setup,
  - send CLABE/ficha to client,
  - view active account.
- Improve payment matching:
  - match by stored order id first,
  - then by metadata,
  - then by Conekta customer id,
  - then by recurrent CLABE,
  - send low-confidence matches to an "unmatched payments" queue.
- Implement automatic application of matched payments to the oldest due installment, with support for partial payments, overpayments, and credit balance.
- Add daily reconciliation job against Conekta so missed webhooks can be recovered.
- Add ERP queues:
  - pagos de hoy,
  - pagos vencidos,
  - pagos recibidos,
  - pagos no identificados,
  - cuentas al corriente,
  - cuentas atrasadas.
- Add WhatsApp receipt and payment status messages once loans/payment schedules exist.
- Add dashboard/ERP controls for resending current question, correcting current step, and reviewing stuck chatbot conversations.

## 2026-04-30 - Real ERP Loan Ledger and Conekta Payment Application by CODEX
- Created a backup snapshot in `backups/20260430-104544/` before modifying ERP/payment code.
- Added real ERP loan tables in `database.js`:
  - `loans`
  - `payment_schedule`
- Expanded payment tracking so `payment_orders` and `payment_transactions` can store:
  - `loan_id`
  - `installment_id`
  - applied payment amount.
- Added ERP database helpers for:
  - creating a loan with weekly schedule,
  - listing eligible applications,
  - listing active loans,
  - listing scheduled payments,
  - calculating ERP summary metrics,
  - linking Conekta orders to installments,
  - applying paid orders to loan balances and installment status.
- Replaced the `/erp` shell with a data-backed operations UI:
  - daily summary,
  - application approval queue,
  - active accounts,
  - payment calendar,
  - overdue indicators,
  - unmatched Conekta count.
- Added ERP API routes:
  - `GET /erp/api/overview`
  - `POST /erp/api/clients/:waId/approve-loan`
- Approval flow now:
  - creates a loan,
  - generates weekly installments,
  - creates Conekta recurrent SPEI orders tied to `loan_id` and `installment_id`,
  - links each provider order back to the installment,
  - stores the reusable CLABE/bank on the loan,
  - sends the borrower a WhatsApp approval/payment instruction message when CLABE is available.
- Updated Conekta `order.paid` webhook handling so matched paid orders automatically:
  - mark the Conekta payment order as paid,
  - apply the amount to the linked installment/loan,
  - handle partial and overpay-forward application to oldest open installments,
  - update loan paid balance and paid status,
  - store payment transaction application metadata,
  - send a WhatsApp receipt for newly processed events.
- Verified:
  - `node --check database.js`
  - `node --check server.js`
  - ERP summary DB helpers against the current SQLite database,
  - `npm run test:webhook`,
  - `GET /erp/api/overview` on a temporary local server at port `3002`.

## 2026-04-30 - Bot Restart After ERP Changes by CODEX
- Restarted the Wabot server on port `3001` so the new ERP loan and payment routes are active.
- Confirmed the restarted process is listening on `0.0.0.0:3001`.
- Verified `GET /erp/api/overview` returns `200` on port `3001`.
- Re-ran `npm run test:webhook` successfully after restart.

## 2026-04-30 - ERP Summary Count Fix by CODEX
- Fixed `/erp` summary totals that were multiplied by the number of scheduled installments because the aggregate query joined `loans` to `payment_schedule`.
- `Cuentas activas` and `Cartera activa` now aggregate directly from `loans`.
- `Pagos hoy` and `Atrasos` still aggregate from `payment_schedule`.
- Updated ERP approval copy to clarify that the reusable CLABE SPEI is generated automatically through the Conekta API during loan approval; no manual capture in Conekta is needed.
- Verified the current database now reports `1` active loan and `$4,500.00 MXN` active balance instead of `10` and `$45,000.00 MXN`.
- Re-ran:
  - `node --check database.js`
  - `node --check server.js`
  - `npm run test:webhook`

## 2026-04-30 - Fixed Public Webhook Domain via Caddy by CODEX
- Confirmed `wabot.kvlaurb.com` resolves publicly to `177.229.134.26`.
- Confirmed Caddy on the Windows Server serves `https://wabot.kvlaurb.com` and reverse-proxies to the local Wabot service on `192.168.0.100:3001`.
- Verified:
  - `https://wabot.kvlaurb.com/erp/api/overview` returns `200`.
  - `http://wabot.kvlaurb.com/erp/api/overview` redirects to HTTPS with `308`.
- Updated `.env` `BASE_URL` to `https://wabot.kvlaurb.com`.
- Restarted the Wabot process on port `3001`.
- Re-ran `npm run test:webhook` successfully after the public domain change.
