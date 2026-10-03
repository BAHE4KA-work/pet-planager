mod git;
mod library;
mod oauth;
mod settings;
mod usage;
mod win_http;
mod workspace;

use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Instant,
};
use tauri::{Manager, State};

struct AppState {
    workspace_root: Mutex<PathBuf>,
    workspace_gate: Mutex<()>,
    data_dir: PathBuf,
    usage_gate: Mutex<()>,
    settings_gate: Mutex<()>,
    library_gate: Mutex<()>,
}

fn state_root(state: &AppState) -> Result<PathBuf, String> {
    state
        .workspace_root
        .lock()
        .map(|p| p.clone())
        .map_err(|_| "Workspace lock unavailable".into())
}

fn data_file(state: &AppState, name: &str) -> PathBuf {
    state.data_dir.join(name)
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid application data path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("data.json"),
        uuid::Uuid::new_v4()
    ));
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    Ok(())
}

fn save_settings_transactionally<ReadKey, WriteKey, DeleteKey, WriteSettings>(
    path: &Path,
    value: &Value,
    new_secret: Option<&str>,
    read_key: ReadKey,
    write_key: WriteKey,
    delete_key: DeleteKey,
    write_settings: WriteSettings,
) -> Result<(), String>
where
    ReadKey: FnOnce() -> Result<Option<String>, String>,
    WriteKey: Fn(&str) -> Result<(), String>,
    DeleteKey: FnOnce() -> Result<(), String>,
    WriteSettings: FnOnce(&Path, &Value) -> Result<(), String>,
{
    let previous_secret = if new_secret.is_some() {
        read_key()?
    } else {
        None
    };
    if let Some(secret) = new_secret {
        write_key(secret)?;
    }
    match write_settings(path, value) {
        Ok(()) => Ok(()),
        Err(save_error) => {
            if new_secret.is_some() {
                let rollback = match previous_secret.as_deref() {
                    Some(secret) => write_key(secret),
                    None => delete_key(),
                };
                if let Err(rollback_error) = rollback {
                    return Err(format!(
                        "Settings save failed ({save_error}); restoring the previous API-key state also failed ({rollback_error})"
                    ));
                }
            }
            Err(format!("Settings save failed: {save_error}"))
        }
    }
}

fn activate_root(state: &AppState, root: PathBuf) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    write_json_atomic(
        &data_file(state, "active-workspace.json"),
        &json!({"root": root.to_string_lossy()}),
    )?;
    *state
        .workspace_root
        .lock()
        .map_err(|_| "Workspace lock unavailable")? = root;
    Ok(())
}

#[tauri::command(async)]
fn workspace_load(state: State<'_, AppState>) -> Result<workspace::WorkspaceSnapshot, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    workspace::snapshot(&state_root(&state)?)
}

#[tauri::command]
fn workspace_choose() -> Result<Option<String>, String> {
    let Some(selected) = choose_folder_native()? else {
        return Ok(None);
    };
    Ok(Some(selected.to_string_lossy().into_owned()))
}

#[tauri::command(async)]
fn workspace_open_selected(
    state: State<'_, AppState>,
    selected: String,
) -> Result<workspace::WorkspaceSnapshot, String> {
    let root = fs::canonicalize(selected).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("Selected workspace folder is no longer available".into());
    }
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    let snapshot = workspace::snapshot(&root)?;
    activate_root(&state, root.clone())?;
    Ok(snapshot)
}

#[tauri::command(async)]
fn workspace_save(
    state: State<'_, AppState>,
    files: Vec<workspace::WorkspaceFile>,
    directories: Vec<String>,
    metadata: Map<String, Value>,
    expected_root: Option<String>,
) -> Result<Value, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    let root = state_root(&state)?;
    if let Some(expected) = expected_root {
        let actual = fs::canonicalize(&root).map_err(|e| e.to_string())?;
        if !expected.eq_ignore_ascii_case(&actual.to_string_lossy()) {
            return Err("Workspace changed before save; stale autosave rejected".into());
        }
    }
    workspace::save(&root, files, directories, metadata)?;
    Ok(json!({"saved": true}))
}

#[tauri::command]
fn workspace_reveal(state: State<'_, AppState>, path: String) -> Result<Value, String> {
    let canonical = workspace_reveal_target(&state_root(&state)?, &path)?;
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer.exe");
        if canonical.is_file() {
            command.arg("/select,").arg(canonical);
        } else {
            command.arg(canonical);
        }
        command.spawn().map_err(|e| e.to_string())?;
        Ok(json!({"revealed": true}))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = canonical;
        Err("Reveal is supported on Windows builds only".into())
    }
}

fn workspace_reveal_target(root: &Path, path: &str) -> Result<PathBuf, String> {
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let target = if path.is_empty() {
        canonical_root.clone()
    } else {
        canonical_root.join(workspace::validate_relative(path)?)
    };
    let canonical = fs::canonicalize(target).map_err(|error| error.to_string())?;
    if !canonical.starts_with(&canonical_root) {
        return Err("Path is outside the current workspace".into());
    }
    Ok(canonical)
}

#[cfg(test)]
mod workspace_reveal_tests {
    use super::workspace_reveal_target;
    use std::fs;

    #[test]
    fn reveal_accepts_workspace_root_and_existing_relative_targets_only() {
        let temp = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp.path().join("models")).unwrap();
        fs::write(temp.path().join("models/plan.pgr"), "model").unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();

        assert_eq!(workspace_reveal_target(&root, "").unwrap(), root);
        assert_eq!(
            workspace_reveal_target(&root, "models/plan.pgr").unwrap(),
            fs::canonicalize(root.join("models/plan.pgr")).unwrap()
        );
        assert!(workspace_reveal_target(&root, "../outside").is_err());
        assert!(workspace_reveal_target(&root, "missing.pgr").is_err());
    }
}

#[tauri::command]
fn workspace_import_file() -> Result<Option<workspace::ImportFile>, String> {
    let Some(path) = choose_pgr_import_file()? else {
        return Ok(None);
    };
    workspace::read_import_file(&path).map(Some)
}

#[tauri::command]
fn workspace_export_file(
    state: State<'_, AppState>,
    path: String,
) -> Result<Option<Value>, String> {
    let relative = workspace::validate_relative(&path)?;
    if !relative
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pgr"))
    {
        return Err("Only managed .pgr workspace files can be exported".into());
    }
    let (name, content) = {
        let _guard = state
            .workspace_gate
            .lock()
            .map_err(|_| "Workspace operation lock unavailable")?;
        let root = fs::canonicalize(state_root(&state)?).map_err(|e| e.to_string())?;
        let source = root.join(&relative);
        let metadata = fs::symlink_metadata(&source).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("Only regular managed workspace files can be exported".into());
        }
        let canonical = fs::canonicalize(&source).map_err(|e| e.to_string())?;
        if !canonical.starts_with(&root) {
            return Err("Workspace export source escaped its root".into());
        }
        let name = source
            .file_name()
            .and_then(|part| part.to_str())
            .ok_or("Invalid workspace source filename")?
            .to_string();
        let content = fs::read_to_string(canonical).map_err(|e| e.to_string())?;
        (name, content)
    };
    let Some(destination) = choose_pgr_export_file(&name)? else {
        return Ok(None);
    };
    workspace::export_file_to(&destination, &content)?;
    Ok(Some(json!({"exported": true})))
}

#[tauri::command(async)]
fn settings_load(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state
        .settings_gate
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    let settings = settings::load(&data_file(&state, "settings.json"));
    settings::migrate_legacy_credential(&settings.ai_provider.provider)?;
    let has_key = settings::credential_read_for(&settings.ai_provider.provider)?.is_some();
    let key_status = json!({
        "gemini": settings::credential_read_for("gemini")?.is_some(),
        "custom": settings::credential_read_for("custom")?.is_some(),
    });
    Ok(json!({"settings": settings::frontend(settings, has_key), "apiKeyStatus": key_status}))
}

#[tauri::command(async)]
fn settings_save(
    state: State<'_, AppState>,
    settings: Value,
    secret: Option<String>,
) -> Result<Value, String> {
    let _guard = state
        .settings_gate
        .lock()
        .map_err(|_| "Settings lock unavailable")?;
    let previous = settings::load(&data_file(&state, "settings.json"));
    settings::migrate_legacy_credential(&previous.ai_provider.provider)?;
    let mut parsed: settings::AppSettings =
        serde_json::from_value(settings).map_err(|_| "Invalid settings payload".to_string())?;
    if !["system", "dark", "classic", "light"].contains(&parsed.theme_mode.as_str()) {
        parsed.theme_mode = "system".into();
    }
    if !["ru", "en"].contains(&parsed.locale.as_str()) {
        parsed.locale = "ru".into();
    }
    if !["gemini", "custom", "chatgpt"].contains(&parsed.ai_provider.provider.as_str()) {
        return Err("Unknown AI provider".into());
    }
    parsed.rate_limits.rpm = parsed.rate_limits.rpm.min(1_000_000);
    parsed.rate_limits.rpd = parsed.rate_limits.rpd.min(10_000_000);
    parsed.rate_limits.tpm = parsed.rate_limits.tpm.min(100_000_000);
    parsed.rate_limits.total_tokens = parsed.rate_limits.total_tokens.min(10_000_000_000);
    if parsed.ai_provider.provider == "chatgpt"
        && secret
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("ChatGPT uses OAuth and does not accept an API key".into());
    }
    let key_provider = parsed.ai_provider.provider.clone();
    let value = serde_json::to_value(parsed).map_err(|e| e.to_string())?;
    let secret = secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    save_settings_transactionally(
        &data_file(&state, "settings.json"),
        &value,
        secret,
        || settings::credential_read_for(&key_provider),
        |value| settings::credential_write_for(&key_provider, value),
        || settings::credential_delete_for(&key_provider),
        write_json_atomic,
    )?;
    let has_key = settings::credential_read_for(&key_provider)?.is_some();
    let key_status = json!({
        "gemini": settings::credential_read_for("gemini")?.is_some(),
        "custom": settings::credential_read_for("custom")?.is_some(),
    });
    Ok(json!({"saved": true, "hasKey": has_key, "apiKeyStatus": key_status}))
}

#[tauri::command]
async fn openai_connect(state: State<'_, AppState>) -> Result<Value, String> {
    let data_dir = state.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || oauth::connect(&data_dir))
        .await
        .map_err(|_| "ChatGPT sign-in task failed".to_string())?
}

#[tauri::command]
fn openai_status() -> Result<Value, String> {
    oauth::status()
}

#[tauri::command]
async fn openai_models() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(oauth::models)
        .await
        .map_err(|_| "ChatGPT model catalog task failed".to_string())?
}

#[tauri::command]
async fn openai_sign_out(state: State<'_, AppState>) -> Result<Value, String> {
    let data_dir = state.data_dir.clone();
    let revoked = tauri::async_runtime::spawn_blocking(move || oauth::sign_out(&data_dir))
        .await
        .map_err(|_| "ChatGPT sign-out task failed".to_string())??;
    Ok(
        json!({"connected": false, "revoked": revoked, "warning": if revoked { Value::Null } else { json!("ChatGPT did not confirm remote token revocation. Local credentials were cleared; you can disconnect Planager in ChatGPT Settings.") }}),
    )
}

#[tauri::command]
async fn openai_forget_account(state: State<'_, AppState>) -> Result<Value, String> {
    let data_dir = state.data_dir.clone();
    let revoked = tauri::async_runtime::spawn_blocking(move || oauth::forget_account(&data_dir))
        .await
        .map_err(|_| "ChatGPT account removal task failed".to_string())??;
    Ok(
        json!({"connected": false, "revoked": revoked, "warning": if revoked { Value::Null } else { json!("ChatGPT did not confirm remote token revocation. Local credentials were cleared; you can disconnect Planager in ChatGPT Settings.") }}),
    )
}

#[tauri::command(async)]
fn library_load(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state
        .library_gate
        .lock()
        .map_err(|_| "Library lock unavailable")?;
    Ok(json!({"items": library::load(&data_file(&state, "library.json"))?}))
}

#[tauri::command(async)]
fn library_save(state: State<'_, AppState>, items: Vec<Value>) -> Result<Value, String> {
    let _guard = state
        .library_gate
        .lock()
        .map_err(|_| "Library lock unavailable")?;
    library::save(&data_file(&state, "library.json"), items)?;
    Ok(json!({"saved": true}))
}

#[tauri::command(async)]
fn git_status(state: State<'_, AppState>) -> Result<git::GitStatus, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    git::status(&state_root(&state)?)
}

#[tauri::command(async)]
fn git_branches(state: State<'_, AppState>) -> Result<git::GitBranches, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    git::branches(&state_root(&state)?)
}

#[tauri::command(async)]
fn git_checkout(state: State<'_, AppState>, branch: String) -> Result<git::GitStatus, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    git::checkout(&state_root(&state)?, &branch)
}

#[tauri::command(async)]
fn git_commit(state: State<'_, AppState>, message: String) -> Result<git::GitStatus, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    git::commit(&state_root(&state)?, &message)
}

#[tauri::command(async)]
fn git_diff(
    state: State<'_, AppState>,
    base: String,
    path: Option<String>,
) -> Result<Value, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    Ok(json!({"diff": git::diff(&state_root(&state)?, &base, path.as_deref())?}))
}

#[tauri::command(async)]
fn git_restore(state: State<'_, AppState>, hash: String) -> Result<git::GitStatus, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    git::restore(&state_root(&state)?, &hash)
}

#[tauri::command(async)]
fn git_create_branch(state: State<'_, AppState>, name: String) -> Result<git::GitStatus, String> {
    let _guard = state
        .workspace_gate
        .lock()
        .map_err(|_| "Workspace operation lock unavailable")?;
    git::create_branch(&state_root(&state)?, &name)
}

#[tauri::command(async)]
fn usage_list(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state
        .usage_gate
        .lock()
        .map_err(|_| "Usage ledger lock unavailable")?;
    Ok(json!({"events": usage::list(&data_file(&state, "usage.json"))?}))
}

#[tauri::command(async)]
fn usage_reset_total(state: State<'_, AppState>) -> Result<Value, String> {
    let _guard = state
        .usage_gate
        .lock()
        .map_err(|_| "Usage ledger lock unavailable")?;
    usage::reset_total(&data_file(&state, "usage.json"))?;
    Ok(json!({"ok": true}))
}

#[tauri::command(async)]
fn usage_simulate(state: State<'_, AppState>, count: Option<usize>) -> Result<Value, String> {
    let _guard = state
        .usage_gate
        .lock()
        .map_err(|_| "Usage ledger lock unavailable")?;
    let limits = {
        let _settings_guard = state
            .settings_gate
            .lock()
            .map_err(|_| "Settings lock unavailable")?;
        settings::load(&data_file(&state, "settings.json")).rate_limits
    };
    Ok(
        json!({"events": usage::simulate(&data_file(&state, "usage.json"), count.unwrap_or(10), &limits)?}),
    )
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRequest {
    action: String,
    prompt: String,
    #[serde(default)]
    system_instruction: String,
    schema: Option<Value>,
    provider_config: Option<settings::AiProvider>,
}

fn effective_ai_provider(
    request: &AiRequest,
    saved: &settings::AiProvider,
) -> Result<settings::AiProvider, String> {
    let provider = if request.action == "test_provider" {
        saved.clone()
    } else {
        request
            .provider_config
            .clone()
            .unwrap_or_else(|| saved.clone())
    };
    if !["gemini", "custom", "chatgpt"].contains(&provider.provider.as_str()) {
        return Err("Unknown AI provider".into());
    }
    Ok(provider)
}

#[derive(Debug)]
struct AiCallFailure {
    message: String,
    http_status: Option<u16>,
    prompt_tokens: u64,
    completion_tokens: u64,
    usage_known: bool,
}

fn ai_failure(message: impl Into<String>, http_status: Option<u16>) -> AiCallFailure {
    AiCallFailure {
        message: message.into(),
        http_status,
        prompt_tokens: 0,
        completion_tokens: 0,
        usage_known: false,
    }
}

fn ai_failure_with_usage(
    message: impl Into<String>,
    http_status: Option<u16>,
    prompt_tokens: u64,
    completion_tokens: u64,
) -> AiCallFailure {
    AiCallFailure {
        message: message.into(),
        http_status,
        prompt_tokens,
        completion_tokens,
        usage_known: true,
    }
}

fn ai_failure_with_partial_usage(
    message: impl Into<String>,
    http_status: Option<u16>,
    prompt_tokens: u64,
    completion_tokens: u64,
) -> AiCallFailure {
    AiCallFailure {
        message: message.into(),
        http_status,
        prompt_tokens,
        completion_tokens,
        usage_known: false,
    }
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AiUsage {
    prompt_tokens: u64,
    completion_tokens: u64,
}

#[tauri::command]
async fn ai_request(state: State<'_, AppState>, request: AiRequest) -> Result<Value, String> {
    if ![
        "analyze",
        "interview",
        "interview_answer",
        "transform",
        "test_provider",
    ]
    .contains(&request.action.as_str())
    {
        return Err("Unsupported AI action".into());
    }
    if request.prompt.len() > 1_000_000 || request.system_instruction.len() > 250_000 {
        return Err("AI request is too large".into());
    }
    let _gate = state
        .usage_gate
        .lock()
        .map_err(|_| "Usage ledger lock unavailable")?;
    let (prefs, provider_config, key) = {
        let _settings_guard = state
            .settings_gate
            .lock()
            .map_err(|_| "Settings lock unavailable")?;
        let prefs = settings::load(&data_file(&state, "settings.json"));
        settings::migrate_legacy_credential(&prefs.ai_provider.provider)?;
        let provider_config = effective_ai_provider(&request, &prefs.ai_provider)?;
        let key = settings::credential_read_for(&provider_config.provider)?.unwrap_or_default();
        (prefs, provider_config, key)
    };
    let (provider, model, key) = if provider_config.provider == "chatgpt" {
        let model = provider_config.chatgpt_model.trim();
        if model.is_empty()
            || model.len() > 200
            || !model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err("Set a valid ChatGPT model in Settings".into());
        }
        (
            "chatgpt".to_string(),
            model.to_string(),
            oauth::access_token()?,
        )
    } else if provider_config.provider == "custom" {
        let endpoint = provider_config.custom_endpoint.trim();
        if endpoint.len() > 2048 {
            return Err("Set a valid custom AI endpoint in Settings".into());
        }
        let parsed = url::Url::parse(endpoint)
            .map_err(|_| "Set a valid HTTP(S) custom AI endpoint in Settings".to_string())?;
        let local_http = parsed.scheme() == "http"
            && parsed.host_str().is_some_and(|host| {
                host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
            });
        if parsed.scheme() != "https" && !local_http {
            return Err("Custom AI endpoints must use HTTPS; HTTP is allowed only for loopback test servers".into());
        }
        let model = provider_config.custom_model.trim();
        if model.is_empty() || model.len() > 200 {
            return Err("Set a valid custom AI model in Settings".into());
        }
        ("custom".to_string(), model.to_string(), key)
    } else {
        if key.is_empty() {
            return Err("Add a provider API key in Settings first".into());
        }
        let model = provider_config.gemini_model.trim();
        if model.is_empty()
            || model.len() > 160
            || !model
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        {
            return Err("Set a valid Gemini model in Settings".into());
        }
        ("gemini".to_string(), model.to_string(), key)
    };
    let output_reservation = if request.action == "test_provider" {
        24
    } else {
        2048
    };
    let prompt_tokens = ((request.prompt.len() + request.system_instruction.len()) as u64)
        .div_ceil(3)
        .saturating_add(16);
    let usage_path = data_file(&state, "usage.json");
    let usage_id = usage::reserve(
        &usage_path,
        &request.action,
        &provider,
        &model,
        prompt_tokens,
        output_reservation,
        &prefs.rate_limits,
    )?;
    drop(_gate);
    let started = Instant::now();
    let endpoint = provider_config.custom_endpoint.clone();
    let provider_result = provider.clone();
    let model_result = model.clone();
    let answer = map_ai_task_result(
        tauri::async_runtime::spawn_blocking(move || {
            send_ai_request(
                &request,
                &provider,
                &model,
                &key,
                &endpoint,
                output_reservation,
            )
        })
        .await,
    );
    let latency = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    let _gate = state
        .usage_gate
        .lock()
        .map_err(|_| "Usage ledger lock unavailable")?;
    match answer {
        Ok((data, actual_prompt, actual_completion, status)) => {
            usage::finish(
                &usage_path,
                &usage_id,
                actual_prompt,
                actual_completion,
                latency,
                "completed",
                Some(status),
            )?;
            Ok(
                json!({"data": data, "providerUsed": provider_result, "modelUsed": model_result, "usage": AiUsage { prompt_tokens: actual_prompt, completion_tokens: actual_completion }, "latencyMs": latency}),
            )
        }
        Err(failure) => {
            usage::finish_with_usage_known(
                &usage_path,
                &usage_id,
                usage::UsageCompletion {
                    prompt_tokens: failure.prompt_tokens,
                    completion_tokens: failure.completion_tokens,
                    latency_ms: latency,
                    status: "failed",
                    http_status: failure.http_status,
                    usage_known: failure.usage_known,
                },
            )?;
            Err(failure.message)
        }
    }
}

fn send_ai_request(
    request: &AiRequest,
    provider: &str,
    model: &str,
    key: &str,
    custom_endpoint: &str,
    max_tokens: u64,
) -> Result<(Value, u64, u64, u16), AiCallFailure> {
    send_ai_request_with_gemini_base(
        request,
        provider,
        model,
        key,
        custom_endpoint,
        max_tokens,
        None,
    )
}

fn map_ai_task_result<T, E>(
    result: Result<Result<T, AiCallFailure>, E>,
) -> Result<T, AiCallFailure> {
    result.map_err(|_| ai_failure("Native AI request task failed", None))?
}

fn send_ai_request_with_gemini_base(
    request: &AiRequest,
    provider: &str,
    model: &str,
    key: &str,
    custom_endpoint: &str,
    max_tokens: u64,
    gemini_base: Option<&str>,
) -> Result<(Value, u64, u64, u16), AiCallFailure> {
    let prompt = if request.action == "test_provider" {
        "Return exactly this JSON object and no other text: {\"ok\":true}"
    } else {
        &request.prompt
    };
    let system = format!(
        "{}\nReturn a valid JSON object only. Do not wrap it in Markdown.",
        request.system_instruction
    );
    if provider == "chatgpt" {
        return send_chatgpt_request(request, model, key, &system, prompt, max_tokens);
    }
    let (url, headers, body, is_gemini) = if provider == "gemini" {
        let schema = request.schema.clone();
        let mut generation = json!({"responseMimeType":"application/json", "temperature":0.3, "maxOutputTokens":max_tokens});
        if let Some(schema) = schema {
            generation["responseJsonSchema"] = schema;
        }
        let body = json!({"systemInstruction":{"parts":[{"text":system}]}, "contents":[{"role":"user","parts":[{"text":prompt}]}], "generationConfig":generation});
        let url = match gemini_base {
            Some(base) => format!(
                "{}/models/{model}:generateContent",
                base.trim_end_matches('/')
            ),
            None => format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            ),
        };
        (
            url,
            vec![("x-goog-api-key".to_string(), key.to_string())],
            body,
            true,
        )
    } else {
        let body = json!({"model":model, "messages":[{"role":"system","content":system},{"role":"user","content":prompt}], "response_format":{"type":"json_object"}, "max_tokens":max_tokens, "temperature":0.3});
        let endpoint = custom_endpoint.to_string();
        let endpoint = if endpoint
            .trim_end_matches('/')
            .ends_with("/chat/completions")
        {
            endpoint
        } else {
            format!("{}/chat/completions", endpoint.trim_end_matches('/'))
        };
        let headers = if key.is_empty() {
            vec![]
        } else {
            vec![("Authorization".to_string(), format!("Bearer {key}"))]
        };
        (endpoint, headers, body, false)
    };
    let bytes = serde_json::to_vec(&body)
        .map_err(|_| ai_failure("AI request could not be encoded", None))?;
    let (status_code, response_bytes) =
        win_http::post_json(&url, headers, &bytes).map_err(|error| ai_failure(error, None))?;
    if !(200..300).contains(&status_code) {
        return Err(ai_failure(
            format!("AI provider returned HTTP {status_code}"),
            Some(status_code),
        ));
    }
    let json: Value = serde_json::from_slice(&response_bytes)
        .map_err(|_| ai_failure("AI provider returned invalid JSON", Some(status_code)))?;
    let (content, prompt_tokens, completion_tokens) = if is_gemini {
        (
            json.pointer("/candidates/0/content/parts/0/text")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ai_failure_with_usage(
                        "Gemini response did not include JSON content",
                        Some(status_code),
                        json.pointer("/usageMetadata/promptTokenCount")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        json.pointer("/usageMetadata/candidatesTokenCount")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                    )
                })?
                .to_string(),
            json.pointer("/usageMetadata/promptTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            json.pointer("/usageMetadata/candidatesTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        )
    } else {
        (
            json.pointer("/choices/0/message/content")
                .or_else(|| json.pointer("/message/content"))
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    ai_failure_with_usage(
                        "Custom provider response did not include JSON content",
                        Some(status_code),
                        json.pointer("/usage/prompt_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                        json.pointer("/usage/completion_tokens")
                            .and_then(Value::as_u64)
                            .unwrap_or(0),
                    )
                })?
                .to_string(),
            json.pointer("/usage/prompt_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            json.pointer("/usage/completion_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        )
    };
    let parsed = serde_json::from_str::<Value>(
        content
            .trim()
            .trim_start_matches("```json")
            .trim_end_matches("```")
            .trim(),
    )
    .map_err(|_| {
        ai_failure_with_usage(
            "AI provider response content was not a JSON object",
            Some(status_code),
            prompt_tokens,
            completion_tokens,
        )
    })?;
    if !parsed.is_object() {
        return Err(ai_failure_with_usage(
            "AI provider response was not a JSON object",
            Some(status_code),
            prompt_tokens,
            completion_tokens,
        ));
    }
    let data = if request.action == "test_provider" {
        if parsed.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(ai_failure_with_usage(
                "Provider test response was missing ok:true",
                Some(status_code),
                prompt_tokens,
                completion_tokens,
            ));
        }
        json!({"ok":true})
    } else {
        parsed
    };
    let prompt_tokens = if prompt_tokens == 0 {
        ((request.prompt.len() + request.system_instruction.len()) as u64)
            .div_ceil(3)
            .saturating_add(16)
    } else {
        prompt_tokens
    };
    let completion_tokens = if completion_tokens == 0 {
        (content.len() as u64).div_ceil(3)
    } else {
        completion_tokens
    };
    Ok((data, prompt_tokens, completion_tokens, status_code))
}

fn send_chatgpt_request(
    request: &AiRequest,
    model: &str,
    access_token: &str,
    system: &str,
    prompt: &str,
    _max_tokens: u64,
) -> Result<(Value, u64, u64, u16), AiCallFailure> {
    let body = chatgpt_response_body(model, system, prompt, request.schema.as_ref());
    let bytes = serde_json::to_vec(&body)
        .map_err(|_| ai_failure("AI request could not be encoded", None))?;
    let (status, stream) = win_http::post_json(
        "https://api.openai.com/v1/responses",
        vec![("Authorization".into(), format!("Bearer {access_token}"))],
        &bytes,
    )
    .map_err(|error| ai_failure(error, None))?;
    if !(200..300).contains(&status) {
        return Err(ai_failure(
            format!("ChatGPT plan provider returned HTTP {status}"),
            Some(status),
        ));
    }
    let response = parse_responses_stream(&stream).map_err(|failure| {
        if let Some((prompt_tokens, completion_tokens)) = failure.usage {
            ai_failure_with_usage(
                failure.message,
                Some(status),
                prompt_tokens,
                completion_tokens,
            )
        } else {
            ai_failure(failure.message, Some(status))
        }
    })?;
    let usage = response.get("usage").ok_or_else(|| {
        ai_failure(
            "ChatGPT completed response did not include token usage",
            Some(status),
        )
    })?;
    let input_tokens = usage
        .get("input_tokens")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            ai_failure(
                "ChatGPT completed response did not include input token usage",
                Some(status),
            )
        })?;
    let output_tokens = usage
        .get("output_tokens")
        .and_then(Value::as_u64)
        .ok_or_else(|| {
            ai_failure_with_partial_usage(
                "ChatGPT completed response did not include output token usage",
                Some(status),
                input_tokens,
                0,
            )
        })?;
    let content = response
        .get("output_text")
        .and_then(Value::as_str)
        .or_else(|| {
            response
                .pointer("/output/0/content/0/text")
                .and_then(Value::as_str)
        })
        .ok_or_else(|| {
            ai_failure_with_usage(
                "ChatGPT Responses API completed without JSON output",
                Some(status),
                input_tokens,
                output_tokens,
            )
        })?;
    let parsed = serde_json::from_str::<Value>(content.trim()).map_err(|_| {
        ai_failure_with_usage(
            "ChatGPT response content was not valid JSON",
            Some(status),
            input_tokens,
            output_tokens,
        )
    })?;
    if !parsed.is_object() {
        return Err(ai_failure_with_usage(
            "ChatGPT response was not a JSON object",
            Some(status),
            input_tokens,
            output_tokens,
        ));
    }
    let data = if request.action == "test_provider" {
        if parsed.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(ai_failure_with_usage(
                "Provider test response was missing ok:true",
                Some(status),
                input_tokens,
                output_tokens,
            ));
        }
        json!({"ok":true})
    } else {
        parsed
    };
    Ok((data, input_tokens, output_tokens, status))
}

fn chatgpt_response_body(model: &str, system: &str, prompt: &str, schema: Option<&Value>) -> Value {
    let instructions = schema.map_or_else(
        || system.to_owned(),
        |schema| {
            format!(
                "{system}\nReturn a JSON object matching this schema:\n{}",
                schema
            )
        },
    );
    json!({
        "model": model,
        "instructions": instructions,
        "input": [{"role": "user", "content": prompt}],
        "store": false,
        "stream": true
    })
}

#[derive(Debug)]
struct StreamFailure {
    message: String,
    usage: Option<(u64, u64)>,
}

fn response_usage(response: &Value) -> Option<(u64, u64)> {
    let usage = response.get("usage")?;
    Some((
        usage.get("input_tokens")?.as_u64()?,
        usage.get("output_tokens")?.as_u64()?,
    ))
}

fn parse_responses_stream(bytes: &[u8]) -> Result<Value, StreamFailure> {
    let text = std::str::from_utf8(bytes).map_err(|_| StreamFailure {
        message: "ChatGPT stream was not valid UTF-8".into(),
        usage: None,
    })?;
    let mut event_name = String::new();
    let mut data_lines = Vec::new();
    let mut completed = None;
    let mut observed_usage = None;
    for line in text.lines().chain(std::iter::once("")) {
        if line.is_empty() {
            if !data_lines.is_empty() {
                let payload = data_lines.join("\n");
                let event: Value = serde_json::from_str(&payload).map_err(|_| StreamFailure {
                    message: "ChatGPT stream contained invalid event JSON".into(),
                    usage: observed_usage,
                })?;
                let kind = event
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or(&event_name);
                observed_usage = event
                    .get("response")
                    .and_then(response_usage)
                    .or(observed_usage);
                match kind {
                    "response.completed" => {
                        completed = event.get("response").cloned();
                        if completed.is_none() {
                            return Err(StreamFailure {
                                message: "ChatGPT completion event did not include a response"
                                    .into(),
                                usage: observed_usage,
                            });
                        }
                    }
                    "response.failed" => {
                        return Err(StreamFailure {
                            message: "ChatGPT response failed before completion".into(),
                            usage: observed_usage,
                        })
                    }
                    "response.incomplete" => {
                        return Err(StreamFailure {
                            message: "ChatGPT response ended incomplete".into(),
                            usage: observed_usage,
                        })
                    }
                    _ => {}
                }
            }
            event_name.clear();
            data_lines.clear();
        } else if let Some(value) = line.strip_prefix("event:") {
            event_name = value.trim().to_string();
        } else if let Some(value) = line.strip_prefix("data:") {
            data_lines.push(value.trim_start().to_string());
        }
    }
    completed.ok_or_else(|| StreamFailure {
        message: "ChatGPT stream ended without response.completed".into(),
        usage: observed_usage,
    })
}

#[cfg(test)]
mod chatgpt_stream_tests {
    use super::{chatgpt_response_body, parse_responses_stream};

    #[test]
    fn requests_use_the_chatgpt_preview_wire_contract() {
        let schema = serde_json::json!({"type":"object","properties":{"ok":{"type":"boolean"}}});
        let body = chatgpt_response_body("gpt-account-model", "system", "prompt", Some(&schema));
        assert_eq!(body["store"], false);
        assert_eq!(body["stream"], true);
        assert_eq!(body["model"], "gpt-account-model");
        assert!(body["input"].is_array());
        assert!(body.get("max_output_tokens").is_none());
        assert!(body.get("temperature").is_none());
        assert!(body.get("text").is_none());
        assert!(body["instructions"]
            .as_str()
            .unwrap()
            .contains(&schema.to_string()));
    }

    #[test]
    fn only_completed_responses_are_accepted_and_usage_is_preserved() {
        let stream = b"event: response.created\ndata: {\"type\":\"response.created\"}\n\nevent: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"{\\\"ok\\\":true}\"}\n\nevent: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output_text\":\"{\\\"ok\\\":true}\",\"usage\":{\"input_tokens\":12,\"output_tokens\":4}}}\n\n";
        let response = parse_responses_stream(stream).unwrap();
        assert_eq!(response["usage"]["input_tokens"], 12);
        assert_eq!(response["usage"]["output_tokens"], 4);
        assert!(response["output_text"].as_str().unwrap().contains("ok"));
    }

    #[test]
    fn failed_incomplete_and_truncated_streams_are_rejected() {
        assert!(parse_responses_stream(
            b"event: response.incomplete\ndata: {\"type\":\"response.incomplete\"}\n\n"
        )
        .is_err());
        assert!(parse_responses_stream(
            b"event: response.failed\ndata: {\"type\":\"response.failed\"}\n\n"
        )
        .is_err());
        assert!(parse_responses_stream(b"event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\"}\n\n").is_err());
    }

    #[test]
    fn failed_response_usage_is_kept_as_a_known_failed_event() {
        let stream = b"event: response.failed\ndata: {\"type\":\"response.failed\",\"response\":{\"usage\":{\"input_tokens\":31,\"output_tokens\":9}}}\n\n";
        let failure = parse_responses_stream(stream).unwrap_err();
        assert_eq!(failure.usage, Some((31, 9)));

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage.json");
        let id = crate::usage::reserve(
            &path,
            "analyze",
            "chatgpt",
            "account-model",
            20,
            100,
            &crate::settings::RateLimits::default(),
        )
        .unwrap();
        crate::usage::finish_with_usage_known(
            &path,
            &id,
            crate::usage::UsageCompletion {
                prompt_tokens: failure.usage.unwrap().0,
                completion_tokens: failure.usage.unwrap().1,
                latency_ms: 12,
                status: "failed",
                http_status: Some(200),
                usage_known: true,
            },
        )
        .unwrap();
        let event = crate::usage::list(&path).unwrap().remove(0);
        assert_eq!(event.status, "failed");
        assert_eq!((event.prompt_tokens, event.completion_tokens), (31, 9));
        assert!(event.usage_known);
    }
}

#[cfg(target_os = "windows")]
fn choose_folder_native() -> Result<Option<PathBuf>, String> {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct BrowseInfo {
        owner: *mut c_void,
        root: *mut c_void,
        display: *mut u16,
        title: *const u16,
        flags: u32,
        callback: *mut c_void,
        param: isize,
        image: i32,
    }
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHBrowseForFolderW(info: *mut BrowseInfo) -> *mut c_void;
        fn SHGetPathFromIDListW(item: *mut c_void, path: *mut u16) -> i32;
    }
    #[link(name = "ole32")]
    unsafe extern "system" {
        fn CoTaskMemFree(mem: *mut c_void);
    }
    let title: Vec<u16> = "Выберите папку проекта Planager\0".encode_utf16().collect();
    let mut display = [0u16; 32768];
    let mut info = BrowseInfo {
        owner: ptr::null_mut(),
        root: ptr::null_mut(),
        display: display.as_mut_ptr(),
        title: title.as_ptr(),
        flags: 0x0001 | 0x0040 | 0x0020,
        callback: ptr::null_mut(),
        param: 0,
        image: 0,
    };
    let item = unsafe { SHBrowseForFolderW(&mut info) };
    if item.is_null() {
        return Ok(None);
    }
    let mut path = [0u16; 32768];
    let ok = unsafe { SHGetPathFromIDListW(item, path.as_mut_ptr()) };
    unsafe {
        CoTaskMemFree(item);
    }
    if ok == 0 {
        return Err("Selected folder could not be read".into());
    }
    let len = path.iter().position(|c| *c == 0).unwrap_or(path.len());
    Ok(Some(PathBuf::from(String::from_utf16_lossy(&path[..len]))))
}

#[cfg(target_os = "windows")]
fn choose_pgr_import_file() -> Result<Option<PathBuf>, String> {
    show_pgr_file_dialog(false, None)
}

#[cfg(target_os = "windows")]
fn choose_pgr_export_file(default_name: &str) -> Result<Option<PathBuf>, String> {
    show_pgr_file_dialog(true, Some(default_name))
}

#[cfg(target_os = "windows")]
fn show_pgr_file_dialog(save: bool, default_name: Option<&str>) -> Result<Option<PathBuf>, String> {
    use std::ffi::c_void;
    #[repr(C)]
    struct OpenFileNameW {
        struct_size: u32,
        owner: *mut c_void,
        instance: *mut c_void,
        filter: *const u16,
        custom_filter: *mut u16,
        max_custom_filter: u32,
        filter_index: u32,
        file: *mut u16,
        max_file: u32,
        file_title: *mut u16,
        max_file_title: u32,
        initial_dir: *const u16,
        title: *const u16,
        flags: u32,
        file_offset: u16,
        file_extension: u16,
        default_extension: *const u16,
        custom_data: isize,
        hook: *mut c_void,
        template_name: *const u16,
        reserved: *mut c_void,
        reserved_value: u32,
        flags_ex: u32,
    }
    #[link(name = "comdlg32")]
    unsafe extern "system" {
        fn GetOpenFileNameW(info: *mut OpenFileNameW) -> i32;
        fn GetSaveFileNameW(info: *mut OpenFileNameW) -> i32;
        fn CommDlgExtendedError() -> u32;
    }
    let mut filter: Vec<u16> = "Planager source files (*.pgr)\0*.pgr\0\0"
        .encode_utf16()
        .collect();
    let title_text = if save {
        "Export Planager source file\0"
    } else {
        "Import Planager source file\0"
    };
    let title: Vec<u16> = title_text.encode_utf16().collect();
    let default_extension: Vec<u16> = "pgr\0".encode_utf16().collect();
    let mut file = vec![0u16; 32768];
    if let Some(name) = default_name {
        for (slot, value) in file.iter_mut().zip(name.encode_utf16()) {
            *slot = value;
        }
    }
    let mut info = OpenFileNameW {
        struct_size: std::mem::size_of::<OpenFileNameW>() as u32,
        owner: std::ptr::null_mut(),
        instance: std::ptr::null_mut(),
        filter: filter.as_mut_ptr(),
        custom_filter: std::ptr::null_mut(),
        max_custom_filter: 0,
        filter_index: 1,
        file: file.as_mut_ptr(),
        max_file: file.len() as u32,
        file_title: std::ptr::null_mut(),
        max_file_title: 0,
        initial_dir: std::ptr::null(),
        title: title.as_ptr(),
        flags: 0x00000008 | 0x00000800 | 0x00080000 | if save { 0x00000002 } else { 0x00001000 },
        file_offset: 0,
        file_extension: 0,
        default_extension: default_extension.as_ptr(),
        custom_data: 0,
        hook: std::ptr::null_mut(),
        template_name: std::ptr::null(),
        reserved: std::ptr::null_mut(),
        reserved_value: 0,
        flags_ex: 0,
    };
    let accepted = unsafe {
        if save {
            GetSaveFileNameW(&mut info)
        } else {
            GetOpenFileNameW(&mut info)
        }
    };
    if accepted == 0 {
        let error = unsafe { CommDlgExtendedError() };
        if error == 0 {
            return Ok(None);
        }
        return Err(format!("Windows PGR file dialog failed ({error:#x})"));
    }
    let len = file
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(file.len());
    let path = PathBuf::from(String::from_utf16_lossy(&file[..len]));
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pgr"))
    {
        return Err("Only .pgr files can be selected".into());
    }
    Ok(Some(path))
}

#[cfg(not(target_os = "windows"))]
fn choose_pgr_import_file() -> Result<Option<PathBuf>, String> {
    Err("PGR file dialogs are implemented for Windows only".into())
}

#[cfg(not(target_os = "windows"))]
fn choose_pgr_export_file(_default_name: &str) -> Result<Option<PathBuf>, String> {
    Err("PGR file dialogs are implemented for Windows only".into())
}

#[cfg(not(target_os = "windows"))]
fn choose_folder_native() -> Result<Option<PathBuf>, String> {
    Err("Folder selection is implemented for Windows only".into())
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            fs::create_dir_all(&data_dir)?;
            let default_root = data_dir.join("default-workspace");
            fs::create_dir_all(&default_root)?;
            let persisted = fs::read(data_dir.join("active-workspace.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                .and_then(|v| v.get("root").and_then(Value::as_str).map(PathBuf::from));
            let root = persisted
                .filter(|path| path.is_dir())
                .unwrap_or(default_root);
            if root == data_dir.join("default-workspace") {
                // Git is optional for opening and editing a workspace. A
                // missing Git installation must not abort application startup.
                let _ = git::initialize_default(&root);
            }
            app.manage(AppState {
                workspace_root: Mutex::new(fs::canonicalize(root)?),
                workspace_gate: Mutex::new(()),
                data_dir,
                usage_gate: Mutex::new(()),
                settings_gate: Mutex::new(()),
                library_gate: Mutex::new(()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace_load,
            workspace_choose,
            workspace_open_selected,
            workspace_save,
            workspace_reveal,
            workspace_import_file,
            workspace_export_file,
            settings_load,
            settings_save,
            library_load,
            library_save,
            git_status,
            git_branches,
            git_checkout,
            git_commit,
            git_diff,
            git_restore,
            git_create_branch,
            usage_list,
            usage_reset_total,
            usage_simulate,
            ai_request,
            openai_connect,
            openai_status,
            openai_models,
            openai_sign_out,
            openai_forget_account
        ])
        .run(tauri::generate_context!())
        .expect("Planager desktop runtime failed");
}

#[cfg(test)]
mod ai_wire_tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    fn generative_requests_can_use_selected_provider_config_without_saving_it() {
        let saved = settings::AiProvider::default();
        let mut request: AiRequest = serde_json::from_value(json!({
            "action": "analyze",
            "prompt": "test",
            "providerConfig": {
                "provider": "custom",
                "customEndpoint": "https://example.test/v1",
                "customModel": "custom-model"
            }
        }))
        .unwrap();

        let selected = effective_ai_provider(&request, &saved).unwrap();
        assert_eq!(selected.provider, "custom");
        assert_eq!(selected.custom_model, "custom-model");

        request.provider_config = None;
        assert_eq!(
            effective_ai_provider(&request, &saved).unwrap().provider,
            "gemini"
        );
    }

    #[test]
    fn provider_test_uses_saved_config_and_unknown_override_is_rejected() {
        let saved = settings::AiProvider::default();
        let request = AiRequest {
            action: "test_provider".into(),
            prompt: "test".into(),
            system_instruction: String::new(),
            schema: None,
            provider_config: Some(settings::AiProvider {
                provider: "custom".into(),
                ..settings::AiProvider::default()
            }),
        };
        assert_eq!(
            effective_ai_provider(&request, &saved).unwrap().provider,
            "gemini"
        );

        let mut invalid = request;
        invalid.action = "analyze".into();
        invalid.provider_config.as_mut().unwrap().provider = "unknown".into();
        assert_eq!(
            effective_ai_provider(&invalid, &saved).unwrap_err(),
            "Unknown AI provider"
        );
    }

    #[test]
    fn gemini_wire_uses_api_key_header_and_parses_content_and_usage() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            let header_end = loop {
                let n = stream.read(&mut chunk).unwrap();
                assert_ne!(n, 0, "request closed before headers arrived");
                request.extend_from_slice(&chunk[..n]);
                if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                    break end;
                }
            };
            let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
            assert!(headers.starts_with("POST /v1beta/models/test-model:generateContent "));
            assert!(headers
                .to_ascii_lowercase()
                .contains("x-goog-api-key: dummy-loopback-key"));
            let content_length = headers
                .lines()
                .skip(1)
                .filter_map(|line| line.split_once(':'))
                .find(|(name, _)| name.trim().eq_ignore_ascii_case("content-length"))
                .and_then(|(_, value)| value.trim().parse::<usize>().ok())
                .expect("POST request should include a valid Content-Length");
            let request_length = header_end + 4 + content_length;
            while request.len() < request_length {
                let n = stream.read(&mut chunk).unwrap();
                assert_ne!(n, 0, "request closed before its complete body arrived");
                request.extend_from_slice(&chunk[..n]);
            }
            let body: Value =
                serde_json::from_slice(&request[header_end + 4..request_length]).unwrap();
            assert_eq!(
                body["contents"][0]["parts"][0]["text"],
                "gemini test prompt"
            );
            assert_eq!(
                body["systemInstruction"]["parts"][0]["text"],
                "test system\nReturn a valid JSON object only. Do not wrap it in Markdown."
            );
            assert_eq!(
                body["generationConfig"]["responseJsonSchema"]["type"],
                "object"
            );
            let response = r#"{"candidates":[{"content":{"parts":[{"text":"{\"ok\":true}"}]}}],"usageMetadata":{"promptTokenCount":42,"candidatesTokenCount":7}}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            stream.flush().unwrap();
        });

        let request = AiRequest {
            action: "analyze".into(),
            prompt: "gemini test prompt".into(),
            system_instruction: "test system".into(),
            schema: Some(json!({"type":"object","properties":{"ok":{"type":"boolean"}}})),
            provider_config: None,
        };
        let result = send_ai_request_with_gemini_base(
            &request,
            "gemini",
            "test-model",
            "dummy-loopback-key",
            "",
            128,
            Some(&format!("http://{address}/v1beta")),
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(result.0, json!({"ok": true}));
        assert_eq!((result.1, result.2, result.3), (42, 7, 200));
    }

    #[test]
    fn blocking_task_join_failure_maps_to_failed_usage_event() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage.json");
        let limits = settings::RateLimits::default();
        let id = usage::reserve(&path, "analyze", "gemini", "test-model", 20, 40, &limits).unwrap();
        type AiTaskJoinResult = Result<Result<(Value, u64, u64, u16), AiCallFailure>, &'static str>;
        let answer: AiTaskJoinResult = Err("simulated join failure");
        let mapped = map_ai_task_result(answer);
        let failure = mapped.unwrap_err();
        usage::finish_with_usage_known(
            &path,
            &id,
            usage::UsageCompletion {
                prompt_tokens: failure.prompt_tokens,
                completion_tokens: failure.completion_tokens,
                latency_ms: 3,
                status: "failed",
                http_status: failure.http_status,
                usage_known: failure.usage_known,
            },
        )
        .unwrap();

        assert_eq!(failure.message, "Native AI request task failed");
        let event = usage::list(&path).unwrap().remove(0);
        assert_eq!(event.status, "failed");
        assert_eq!(event.http_status, None);
        assert_eq!(event.latency_ms, 3);
        assert_eq!((event.prompt_tokens, event.completion_tokens), (0, 0));
    }

    #[test]
    fn custom_provider_test_action_uses_local_wire_and_validates_result() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let n = stream.read(&mut chunk).unwrap();
                request.extend_from_slice(&chunk[..n]);
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                    let length = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            let text = String::from_utf8_lossy(&request).to_ascii_lowercase();
            assert!(text.starts_with("post /chat/completions "));
            assert!(text.contains("authorization: bearer localhost-test-key"));
            let response = r#"{"choices":[{"message":{"content":"{\"ok\":true}"}}],"usage":{"prompt_tokens":4,"completion_tokens":3}}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
        });
        let request = AiRequest {
            action: "test_provider".into(),
            prompt: "ignored by test action".into(),
            system_instruction: String::new(),
            schema: None,
            provider_config: None,
        };
        let result = send_ai_request(
            &request,
            "custom",
            "test-model",
            "localhost-test-key",
            &format!("http://{address}"),
            24,
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(result.0, json!({"ok": true}));
        assert_eq!((result.1, result.2), (4, 3));
    }
}

#[cfg(test)]
mod data_write_tests {
    use super::*;
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn serialized_atomic_settings_saves_have_unique_temps_and_last_save_wins() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let gate = Mutex::new(());
        let next = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            let mut workers = Vec::new();
            for _ in 0..24 {
                let path = path.clone();
                let next = &next;
                let gate = &gate;
                workers.push(scope.spawn(move || {
                    let _guard = gate.lock().unwrap();
                    let value = next.fetch_add(1, Ordering::SeqCst) + 1;
                    write_json_atomic(&path, &json!({"save": value})).unwrap();
                }));
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        let persisted: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(persisted["save"], 24);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_settings_write_rolls_back_new_credential_without_exposing_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let stored_key = RefCell::new(Some("old-key".to_string()));
        let result = save_settings_transactionally(
            &path,
            &json!({"themeMode":"dark"}),
            Some("new-key"),
            || Ok(stored_key.borrow().clone()),
            |value| {
                *stored_key.borrow_mut() = Some(value.to_string());
                Ok(())
            },
            || {
                *stored_key.borrow_mut() = None;
                Ok(())
            },
            |_, _| Err("simulated disk failure".into()),
        );
        assert!(result
            .as_ref()
            .unwrap_err()
            .contains("simulated disk failure"));
        assert!(!result.unwrap_err().contains("new-key"));
        assert_eq!(stored_key.borrow().as_deref(), Some("old-key"));
        assert!(!path.exists());
    }

    #[test]
    fn failed_first_settings_save_attempts_credential_delete_and_hides_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let stored_key = RefCell::new(None::<String>);
        let delete_called = std::cell::Cell::new(false);
        let result = save_settings_transactionally(
            &path,
            &json!({"themeMode":"dark"}),
            Some("first-key"),
            || Ok(stored_key.borrow().clone()),
            |value| {
                *stored_key.borrow_mut() = Some(value.to_string());
                Ok(())
            },
            || {
                delete_called.set(true);
                Err("simulated credential-delete failure".into())
            },
            |_, _| Err("simulated disk failure".into()),
        );
        let error = result.unwrap_err();
        assert!(delete_called.get());
        assert!(error.contains("simulated disk failure"));
        assert!(error.contains("simulated credential-delete failure"));
        assert!(!error.contains("first-key"));
    }
}
