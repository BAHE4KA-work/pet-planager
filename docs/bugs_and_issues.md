# Project Audit Report
Date: 2026-10-02 Europe/Moscow
Auditor: AI Agent (project-review skill)
Project: Planager
Commit/Branch: 4caf5d5 / main (working tree contains uncommitted changes)

---

## Summary

| Category | Count |
|----------|-------|
| 🔴 Blockers | 0 |
| 🟠 Critical | 0 |
| 🟡 Warnings | 2 |
| 🔵 Info / environment limitations | 2 |

**Tests:** 99 passed / 0 failed / 0 skipped (coverage was not collected).
**Endpoints tested:** No HTTP application server is configured. Native Tauri command boundaries were exercised by the Rust unit suite; live OAuth/provider requests were not made.

The current working tree typechecks, builds the Vite production bundle with a 494.64 kB initial JavaScript chunk, passes all 59 frontend tests and all 40 native Rust tests, and produces the Windows executable with `tauri build --no-bundle` (10,388,992 bytes). Settings, Canvas, PGR editor, and AI workflow dialogs are lazy-loaded; the initial chunk is below Vite's 500 kB advisory. Browser-preview smoke checks cover all six PGR element types, structured-field serialization, inheritance and parallel graph links, edge filtering, zoom, undo/redo, raw/structured PGR synchronization, RU/EN switching, an empty unit library, and native-only action states. Latest regression tests also cover selectable PGR line ranges and English parser diagnostics. Native regression tests cover Gemini model migration, provider-specific key migration and selection, recursive Git restore, rollback after a mid-restore failure, workspace reveal path validation, and NTFS junction traversal protection. `git diff --check` reports only line-ending conversion notices. npm install reported 0 vulnerabilities. These checks do not establish full GUI or live-provider acceptance.

## Resolved during the stability review

### RESOLVED: Git status launched a burst of visible console processes after saves
- **Where:** `src/hooks/useGitWorkspace.ts`, `src-tauri/src/git.rs`, and synchronous Tauri filesystem/Git commands in `src-tauri/src/lib.rs`.
- **What:** Every autosave toggled `workspaceSaving`, which refreshed Git status. One refresh launched several separate Git processes; Windows could show a console for each. Those synchronous Tauri commands also ran on the UI thread, so scanning or saving a large workspace could make the window stop responding.
- **Fix:** Debounce status refresh until editing and autosave are idle; set `CREATE_NO_WINDOW` and disable terminal prompts for Git; run workspace load/save and Git/storage commands away from the WebView main thread; keep folder selection on the UI thread but scan the selected project asynchronously; allow normal startup when Git is not installed.
- **Verification:** TypeScript, 59 frontend tests, 40 Rust tests, Rust formatting, strict Clippy, and a fresh Windows `tauri build --no-bundle` passed. The native app was not launched for interactive confirmation; that final check remains with the product owner.

## 🔴 Blockers

None found in the tested paths.

## 🟠 Critical

None found in the tested paths.

## 🟡 Warnings

### WARN-001: ChatGPT account switching removes the currently registered account
- **Where:** Settings → ChatGPT plan (OAuth); `src/App.tsx` account-forget handler and `src-tauri/src/oauth.rs` registration lifecycle.
- **What:** The app supports one active OAuth registration. “Remove account and connect another” revokes/deletes the current registration before the user signs in again, so users cannot retain and switch among several accounts.
- **Expected:** Keep registrations isolated and offer account selection when multi-account support is required.
- **Reproduce:** Connect an account, choose “Remove account and connect another,” then sign in with a second account. The first registration is no longer available to switch back to.
- **Evidence:** Independent OAuth review confirmed the single-registration lifecycle. This is a known scope limitation, not a hidden action; the UI now describes removal explicitly.

### WARN-002: Windows GUI and live provider acceptance remain unverified
- **Where:** Packaged `src-tauri/target/release/planager.exe`; ChatGPT Settings and provider flow.
- **What:** The executable compiles successfully, but was not launched for end-to-end GUI acceptance. OAuth redirect, real account model catalog, refresh/revocation, a real Responses stream, and live Gemini/custom endpoint calls have not been exercised with authorized test credentials.
- **Expected:** Verify native startup and key workspace flows in the packaged app; exercise OAuth only in an authorized test environment before release.
- **Reproduce:** Launch the produced executable and perform the relevant native UI/provider workflows.
- **Evidence:** `tauri build --no-bundle` succeeded; automated tests cover protocol construction, token validation, model catalog parsing, stream parsing, and usage accounting, but use no live account.

## 🔵 Info / Environment limitations

### INFO-001: NSIS installer packaging is deferred beyond MVP
- **Where:** `npm run build:desktop` / Tauri NSIS bundling.
- **What:** The product owner clarified that MVP means the working desktop application, not its installer or uninstaller. Previous installer attempts could not fetch the official NSIS archive due socket denial, unexpected EOF, and a TLS handshake failure. The current Windows executable builds without bundling.
- **Reproduce:** No installer command is part of current MVP verification; packaging can be revisited for a release build.
- **Evidence:** `tauri build --no-bundle` produced `src-tauri/target/release/planager.exe` on 2026-10-02. Installer and uninstaller packaging are explicitly deferred.

### INFO-002: No coverage report or live application endpoint suite is available
- **Where:** Repository test/build setup.
- **What:** Tests run under Node's built-in test runner and Rust's test harness; no coverage threshold/reporting task or HTTP server/API endpoint exists for this desktop-native architecture.
- **Expected:** Add coverage instrumentation or native UI acceptance automation if release policy requires measured coverage or full desktop flow evidence.
- **Evidence:** `package.json` defines `test`, `test:native`, `lint`, and build scripts; no HTTP application service is declared.

## Test Results

### Failed Tests

None. Latest verified frontend tests: 59/59 passed. Latest verified native tests: 40/40 passed. TypeScript no-emit, Rust formatting, strict Clippy with warnings denied, Vite production build, and `tauri build --no-bundle` passed.

### Skipped / xfail without reason

None reported.

### Coverage by Module

Not collected. The repository does not currently configure coverage instrumentation.

## Endpoint Coverage

Not applicable: this is a Tauri desktop app without an HTTP application server. The AI provider HTTP clients use external services and were not sent live credentials or requests during this audit. Local loopback provider tests use dummy credentials.

## Environment Issues

### Dependency vulnerabilities

The user's successful `npm i` reported 0 vulnerabilities during npm's install audit.

### Installer prerequisite

NSIS 3.11 previously could not be fetched in the current environment: the sandbox denied the socket (Windows error 10013), the network-permitted build ended with unexpected EOF, and a direct TLS probe failed its handshake. Installer packaging is outside this MVP by the product owner's decision. No system proxy or registry settings were changed by the audit.

## Recommendations (Top 3)

1. Run a packaged native GUI acceptance pass for workspace create/open/save, import/export, Git, and Settings; record the tested Windows runtime.
2. Exercise the documented ChatGPT OAuth flow with an authorized test account and confirm sign-in, visible model catalog, a completed response, refresh, sign-out, and revocation-warning behavior.
3. Decide whether multi-account switching belongs in a later release; the current MVP clearly removes the connected account before connecting another one.
