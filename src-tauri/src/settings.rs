use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiProvider {
    pub provider: String,
    pub gemini_model: String,
    pub custom_endpoint: String,
    pub custom_model: String,
    pub chatgpt_model: String,
}

impl Default for AiProvider {
    fn default() -> Self {
        Self {
            provider: "gemini".into(),
            gemini_model: "gemini-3.8-flash".into(),
            custom_endpoint: String::new(),
            custom_model: "gpt-4o-mini".into(),
            chatgpt_model: String::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RateLimits {
    pub rpm: u64,
    pub rpd: u64,
    pub tpm: u64,
    pub total_tokens: u64,
}

impl Default for RateLimits {
    fn default() -> Self {
        Self {
            rpm: 30,
            rpd: 500,
            tpm: 60_000,
            total_tokens: 250_000,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme_mode: String,
    pub positive_palette: String,
    pub negative_palette: String,
    pub locale: String,
    pub git_enabled: bool,
    pub ai_provider: AiProvider,
    pub rate_limits: RateLimits,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme_mode: "dark".into(),
            positive_palette: "emerald".into(),
            negative_palette: "crimson".into(),
            locale: "ru".into(),
            git_enabled: true,
            ai_provider: AiProvider::default(),
            rate_limits: RateLimits::default(),
        }
    }
}

pub fn load(path: &Path) -> AppSettings {
    let mut settings = fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<AppSettings>(&b).ok())
        .unwrap_or_default();
    if settings.ai_provider.gemini_model == "gemini-3.1-flash-lite-preview" {
        settings.ai_provider.gemini_model = "gemini-3.1-flash-lite".into();
    }
    settings
}

pub fn frontend(settings: AppSettings, has_key: bool) -> Value {
    let mut value = serde_json::to_value(settings).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert("hasKey".into(), Value::Bool(has_key));
    }
    value
}

const LEGACY_API_KEY_TARGET: &str = "Planager.Desktop.AIKey";

pub fn credential_target_for(provider: &str) -> Option<&'static str> {
    match provider {
        "gemini" => Some("Planager.Desktop.AIKey.gemini"),
        "custom" => Some("Planager.Desktop.AIKey.custom"),
        _ => None,
    }
}

pub fn credential_read_for(provider: &str) -> Result<Option<String>, String> {
    credential_target_for(provider)
        .map(credential_read_target)
        .unwrap_or(Ok(None))
}

pub fn credential_write_for(provider: &str, secret: &str) -> Result<(), String> {
    let target = credential_target_for(provider)
        .ok_or("ChatGPT uses OAuth and does not accept an API key")?;
    credential_write_target(target, secret)
}

pub fn credential_delete_for(provider: &str) -> Result<(), String> {
    let target = credential_target_for(provider)
        .ok_or("ChatGPT uses OAuth and does not have an API key to remove")?;
    credential_delete_target(target)
}

pub fn migrate_legacy_credential(provider: &str) -> Result<(), String> {
    let Some(target) = credential_target_for(provider) else {
        return Ok(());
    };
    migrate_legacy_credential_with(
        target,
        credential_read_target,
        credential_write_target,
        credential_delete_target,
    )
}

fn migrate_legacy_credential_with<Read, Write, Delete>(
    target: &str,
    mut read: Read,
    mut write: Write,
    mut delete: Delete,
) -> Result<(), String>
where
    Read: FnMut(&str) -> Result<Option<String>, String>,
    Write: FnMut(&str, &str) -> Result<(), String>,
    Delete: FnMut(&str) -> Result<(), String>,
{
    let Some(legacy_secret) = read(LEGACY_API_KEY_TARGET)? else {
        return Ok(());
    };
    if read(target)?.is_none() {
        write(target, &legacy_secret)?;
    }
    delete(LEGACY_API_KEY_TARGET)
        .map_err(|_| "Legacy provider credential could not be removed from the OS vault".into())
}

#[cfg(target_os = "windows")]
pub fn credential_read_target(target_name: &str) -> Result<Option<String>, String> {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target: *mut u16,
        comment: *mut u16,
        written: FileTime,
        size: u32,
        blob: *mut u8,
        persist: u32,
        attrs: u32,
        attributes: *mut c_void,
        alias: *mut u16,
        username: *mut u16,
    }
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn CredReadW(target: *const u16, kind: u32, flags: u32, out: *mut *mut Credential) -> i32;
        fn CredFree(p: *mut c_void);
    }
    let target: Vec<u16> = format!("{target_name}\0").encode_utf16().collect();
    let mut ptr: *mut Credential = ptr::null_mut();
    let ok = unsafe { CredReadW(target.as_ptr(), 1, 0, &mut ptr) };
    if ok == 0 {
        return Ok(None);
    }
    let cred = unsafe { &*ptr };
    let bytes = unsafe { std::slice::from_raw_parts(cred.blob, cred.size as usize) };
    let result = String::from_utf8(bytes.to_vec())
        .map_err(|_| "Stored API key is invalid UTF-8".to_string());
    unsafe {
        CredFree(ptr.cast());
    }
    result.map(Some)
}

#[cfg(not(target_os = "windows"))]
pub fn credential_read_target(_target_name: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "windows")]
pub fn credential_write_target(target_name: &str, secret: &str) -> Result<(), String> {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target: *mut u16,
        comment: *mut u16,
        written: FileTime,
        size: u32,
        blob: *mut u8,
        persist: u32,
        attrs: u32,
        attributes: *mut c_void,
        alias: *mut u16,
        username: *mut u16,
    }
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn CredWriteW(cred: *const Credential, flags: u32) -> i32;
    }
    // Windows Credential Manager caps each credential blob at 5 * 512 bytes.
    if secret.len() > 2560 {
        return Err("API key is too long".into());
    }
    let mut target: Vec<u16> = format!("{target_name}\0").encode_utf16().collect();
    let mut username: Vec<u16> = "provider-key\0".encode_utf16().collect();
    let mut blob = secret.as_bytes().to_vec();
    let cred = Credential {
        flags: 0,
        kind: 1,
        target: target.as_mut_ptr(),
        comment: ptr::null_mut(),
        written: FileTime { low: 0, high: 0 },
        size: blob.len() as u32,
        blob: blob.as_mut_ptr(),
        persist: 2,
        attrs: 0,
        attributes: ptr::null_mut(),
        alias: ptr::null_mut(),
        username: username.as_mut_ptr(),
    };
    if unsafe { CredWriteW(&cred, 0) } == 0 {
        return Err("Windows Credential Manager could not save the API key".into());
    }
    blob.fill(0);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn credential_write_target(_target_name: &str, _secret: &str) -> Result<(), String> {
    Err("Secure credential storage is available on Windows builds only".into())
}

#[cfg(target_os = "windows")]
pub fn credential_delete_target(target_name: &str) -> Result<(), String> {
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
    }
    let target: Vec<u16> = format!("{target_name}\0").encode_utf16().collect();
    if unsafe { CredDeleteW(target.as_ptr(), 1, 0) } == 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(1168) {
            return Ok(());
        }
        return Err(
            "Windows Credential Manager could not restore the previous API-key state".into(),
        );
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn credential_delete_target(_target_name: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontend_settings_never_contain_provider_secret() {
        let value = frontend(AppSettings::default(), true);
        let serialized = serde_json::to_string(&value).unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("APIKey"));
        assert_eq!(value["hasKey"], true);
        assert!(value.get("providerKey").is_none());
    }

    #[test]
    fn settings_migrate_retired_gemini_model_and_preserve_other_preferences() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        fs::write(
            &path,
            r#"{"locale":"en","aiProvider":{"geminiModel":"gemini-3.1-flash-lite-preview"}}"#,
        )
        .unwrap();

        let settings = load(&path);
        assert_eq!(settings.ai_provider.gemini_model, "gemini-3.1-flash-lite");
        assert_eq!(settings.locale, "en");
    }

    #[test]
    fn provider_api_keys_use_distinct_vault_targets() {
        assert_ne!(
            credential_target_for("gemini"),
            credential_target_for("custom")
        );
        assert_eq!(credential_target_for("chatgpt"), None);
        assert_eq!(credential_read_for("chatgpt").unwrap(), None);
    }

    #[test]
    fn legacy_api_key_migrates_only_to_the_saved_provider_target() {
        use std::{cell::RefCell, collections::HashMap};

        let values = RefCell::new(HashMap::from([(
            LEGACY_API_KEY_TARGET.to_string(),
            "legacy-gemini-key".to_string(),
        )]));
        migrate_legacy_credential_with(
            "Planager.Desktop.AIKey.gemini",
            |target| Ok(values.borrow().get(target).cloned()),
            |target, secret| {
                values
                    .borrow_mut()
                    .insert(target.to_string(), secret.to_string());
                Ok(())
            },
            |target| {
                values.borrow_mut().remove(target);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(
            values.borrow().get("Planager.Desktop.AIKey.gemini"),
            Some(&"legacy-gemini-key".to_string())
        );
        assert!(!values.borrow().contains_key(LEGACY_API_KEY_TARGET));
        assert!(!values
            .borrow()
            .contains_key("Planager.Desktop.AIKey.custom"));
    }
}
