# Planager

Planager is a Windows desktop workspace for designing and organizing project plans as `.pgr` files.

## Run and build on Windows

Install Node.js, Rust with the `x86_64-pc-windows-msvc` target, Visual Studio C++ Build Tools, and the Microsoft Edge WebView2 Runtime. Install dependencies and run the frontend checks from the repository root:

```powershell
npm install
npm run lint
npm run build
npm test
```

Run the desktop app during development or build the standalone Windows MVP executable:

```powershell
npm run dev:desktop
npm run build:desktop
```

The executable is emitted at `src-tauri/target/release/planager.exe`. Installer packaging is deferred beyond the MVP. The app uses the native Tauri command bridge; the Vite dev server is only its frontend development server. Native command tests run with:

```powershell
npm run test:native
```

## Data and Git

The selected project folder contains the `.pgr` models and `.planager.json` editor metadata. Planager stores settings, reusable library items, usage history, and the selected folder in its per-user application data directory. Provider API keys use Windows Credential Manager. Git features require Git for Windows on `PATH`; app commits and restores apply to `.pgr` models and Planager metadata.

Tauri retains a Windows NSIS target for a later release, but the MVP desktop build uses --no-bundle. Other operating systems and installer formats are not configured.
