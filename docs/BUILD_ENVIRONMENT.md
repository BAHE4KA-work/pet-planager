# Windows Tauri 2 build environment

Verified on 2026-10-02 for the Windows MSVC host. npm dependencies are installed. `tauri build --no-bundle` compiles the frontend and native application and produces `src-tauri/target/release/planager.exe`. The product owner has deferred installer and uninstaller packaging beyond the MVP, so NSIS bundling is not part of the current acceptance target.

## Environment and commands

| Component | Observed state |
| --- | --- |
| Node.js | `C:\Program Files\nodejs\node.exe`, v24.17.0; an NVM Node 22.20.0 is also installed |
| npm CLI | `C:\Program Files\nodejs\npm.cmd`, npm 11.13.0; invoke this shim directly because the ordinary Codex-session `npm` shim points at a missing Roaming CLI |
| Rust | rustc/cargo 1.98.1, stable MSVC; `x86_64-pc-windows-msvc` target installed |
| Visual Studio | VS 2022 Community 17.14.37628.2, MSVC 14.44 and Windows SDK 10.0.26100; `cl.exe` requires the VS environment to be initialized for C/C++ builds |
| WebView2 | Evergreen runtime 153.0.4234.48 installed |
| Tauri Rust crates | Tauri 2.11.6 and dependencies available in the local Cargo cache |
| JavaScript packages | Installed from the project manifest; `node_modules` and `package-lock.json` present |

Use these explicit paths in PowerShell without modifying machine npm settings:

```powershell
$npm = 'C:\Program Files\nodejs\npm.cmd'
& $npm --version
& $npm install
& $npm run lint
& $npm run build:desktop
```

In the Codex PowerShell session, the ordinary npm shim resolves to a missing Roaming CLI, so verification uses the explicit Node/npm paths shown above. The user also confirmed that `npm i` succeeded in their ordinary PowerShell session. Earlier registry attempts failed before TLS setup and no system proxy/TLS settings were changed. Rust checks can be run offline:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --offline
cargo build --manifest-path src-tauri/Cargo.toml --release --offline
```

Current verification (2026-10-02): TypeScript no-emit passed; frontend tests passed 59/59; Rust formatting and strict Clippy passed; native tests passed 40/40, including retired Gemini-model migration, provider-specific credential migration and selection, failed-Git-restore rollback, and workspace reveal path validation. The Vite production build passed with a 494.64 kB initial JavaScript chunk and lazy-loaded Settings, Canvas, PGR editor, and AI workflow dialog chunks; the initial bundle is below Vite's 500 kB advisory. Git restore regression coverage restores nested PGR files while preserving unrelated files. The earlier production-preview UI smoke created all six element types and checked their structured fields against serialized PGR, inheritance and parallel `has`/`uses` graph links, edge visibility filters, canvas zoom, undo/redo, raw/structured PGR synchronization, RU/EN switching, and the empty unit library. Import/export, credentials, Git, and provider operations correctly identify their Tauri-only boundary in Browser preview. Regression tests also cover line-range validation and Russian-to-English PGR parser diagnostics. For the launch-stability fix, Git subprocesses now suppress console windows and terminal prompts; workspace/Git/storage commands that perform filesystem or process work run away from the WebView main thread; Git status refreshes are debounced until editing and autosave are idle; and failure to initialize optional Git no longer prevents startup. `tauri build --no-bundle` produced `src-tauri/target/release/planager.exe` (10,388,992 bytes). The executable has not been launched for native runtime acceptance. Installer and uninstaller packaging are explicitly outside this MVP per the product owner's decision.

The 40 Rust tests exercise workspace round trips and path safety, Explorer reveal target validation, successful and rolled-back local Git operations, secret-safe settings persistence, provider-specific credential migration and selection, library persistence, deterministic usage limits, simulation separation, local-only provider wire behavior and parsing, and failed usage-reservation cleanup. Loopback HTTP tests use dummy credentials and never contact a live provider.

## Native persistence and networking

Tauri 2 provides narrow native commands through `src/services/desktop.ts`. Workspace `.pgr` files and editor metadata live in the selected project folder; editor metadata is stored in `.planager.json` and excluded from model listings. The default workspace, settings, library, usage ledger, and selected-workspace pointer use Tauri's per-user app data directory. Gemini and custom endpoint API keys use separate Windows Credential Manager entries; a legacy key migrates to the provider selected in saved settings. Keys are not returned to the frontend or written to project files/logs. Native Git invokes the installed Git executable and limits app commits/restores to Planager model and metadata paths.

The Windows AI HTTP transport uses WinHTTP, enforces HTTPS for remote custom endpoints (loopback HTTP is allowed for local testing), sends Gemini credentials in `x-goog-api-key`, limits responses to 8 MB, and uses bounded timeouts. This avoids a WebView network dependency and avoids shipping credentials in renderer JavaScript. Generative requests use the currently selected non-secret provider configuration and its matching stored key; `test_provider` checks the saved provider because Settings saves before testing. Native tests use a loopback fake server and never contact a live provider. The optional official open-source ChatGPT OAuth provider uses Windows Credential Manager, account model discovery, Responses streaming, and token revocation. It does not read local Codex credential files.

## Official references

- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) — Windows C++ build tools, WebView2, Rust MSVC target, and frontend runtime.
- [Tauri command guide](https://v2.tauri.app/develop/calling-rust/) — synchronous commands run on the main thread by default; async commands are recommended for work that could freeze the UI.
- [Tauri 2 Vite configuration](https://v2.tauri.app/start/frontend/vite/) — Vite integration.
- [Tauri 2 Windows installer](https://v2.tauri.app/distribute/windows-installer/) — Windows packaging requirements and targets.
- [Tauri 2 application data paths](https://v2.tauri.app/plugin/path/) and [Store plugin](https://v2.tauri.app/plugin/store/) — app data location and small key/value storage options.
- [Tauri 2 HTTP plugin](https://v2.tauri.app/plugin/http-client/) — native HTTP client and capability URL allowlists; this MVP uses Windows WinHTTP directly.
- [OpenAI Codex app-server sign-in](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) — official OAuth token exchange and app-server integration outline.
