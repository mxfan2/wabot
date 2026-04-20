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
