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
