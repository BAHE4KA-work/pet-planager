//! Official Sign in with ChatGPT plan-usage OAuth flow.
//! Credentials are kept in Windows Credential Manager, never in frontend settings.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    rand::{SecureRandom, SystemRandom},
    signature,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use url::Url;

const ISSUER: &str = "https://auth.openai.com";
const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPE: &str = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const CREDENTIAL_TARGET: &str = "Planager.Desktop.ChatGPTOAuth";
const CALLBACK_PATH: &str = "/auth/callback";
static OAUTH_GATE: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub email: Option<String>,
    pub subject: String,
    pub client_id: String,
    pub host_id: String,
    pub id_token: String,
    pub access_token: String,
    pub refresh_token: String,
    pub scopes: Vec<String>,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAccount {
    email: Option<String>,
    subject: String,
    client_id: String,
    host_id: String,
    scopes: Vec<String>,
    expires_at: u64,
    token_version: String,
    access_chunks: usize,
    refresh_chunks: usize,
    id_chunks: usize,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    id_token: String,
    #[serde(default)]
    scope: String,
    expires_in: u64,
    #[serde(default)]
    token_type: String,
}

#[derive(Clone, Debug)]
pub struct VerifiedIdentity {
    pub subject: String,
    pub email: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Registration {
    client_id: String,
    subject: String,
    email: Option<String>,
    host_id: String,
}

pub fn status() -> Result<Value, String> {
    let _guard = OAUTH_GATE
        .lock()
        .map_err(|_| "ChatGPT credential lock unavailable")?;
    let Some(account) = read_account()? else {
        return Ok(json!({"connected": false}));
    };
    Ok(json!({"connected": true, "email": account.email, "expiresAt": account.expires_at}))
}

pub fn sign_out(data_dir: &Path) -> Result<bool, String> {
    let _guard = OAUTH_GATE
        .lock()
        .map_err(|_| "ChatGPT credential lock unavailable")?;
    let version = account_version()?;
    let account = read_account()?;
    let revoked = account.as_ref().is_none_or(revoke_session);
    if let Some(account) = account {
        let registration = Registration {
            client_id: account.client_id,
            subject: account.subject,
            email: account.email,
            host_id: account.host_id,
        };
        let bytes = serde_json::to_vec(&registration)
            .map_err(|_| "Could not encode ChatGPT registration".to_string())?;
        std::fs::write(data_dir.join("chatgpt-registration.json"), bytes)
            .map_err(|_| "Could not preserve the ChatGPT client registration".to_string())?;
    }
    crate::settings::credential_delete_target(CREDENTIAL_TARGET)?;
    if let Some(version) = version {
        delete_tokens(&version)?;
    }
    Ok(revoked)
}

pub fn forget_account(data_dir: &Path) -> Result<bool, String> {
    let _guard = OAUTH_GATE
        .lock()
        .map_err(|_| "ChatGPT credential lock unavailable")?;
    let version = account_version()?;
    let revoked = read_account()?.as_ref().is_none_or(revoke_session);
    crate::settings::credential_delete_target(CREDENTIAL_TARGET)?;
    if let Some(version) = version {
        delete_tokens(&version)?;
    }
    let _ = std::fs::remove_file(data_dir.join("chatgpt-registration.json"));
    Ok(revoked)
}

fn revoke_session(account: &Account) -> bool {
    let Ok(discovery) = get_json("https://auth.openai.com/.well-known/openid-configuration") else {
        return false;
    };
    let Some(endpoint) = discovery.get("revocation_endpoint").and_then(Value::as_str) else {
        return false;
    };
    let Ok(parsed) = Url::parse(endpoint) else {
        return false;
    };
    if parsed.scheme() != "https" || parsed.host_str() != Some("auth.openai.com") {
        return false;
    }
    let form = form_body(&[
        ("token", &account.refresh_token),
        ("token_type_hint", "refresh_token"),
        ("client_id", &account.client_id),
    ]);
    for attempt in 0..3 {
        match crate::win_http::post_form(endpoint, Vec::new(), form.as_bytes()) {
            Ok((200, _)) => return true,
            Ok((status, _)) if status < 500 => return false,
            _ if attempt < 2 => std::thread::sleep(Duration::from_millis(250 * (attempt + 1))),
            _ => return false,
        }
    }
    false
}

pub fn models() -> Result<Value, String> {
    let access_token = access_token()?;
    let (status, bytes) = crate::win_http::get_with_headers(
        "https://api.openai.com/v1/models",
        vec![("Authorization".into(), format!("Bearer {access_token}"))],
    )?;
    if !(200..300).contains(&status) {
        return Err(format!("ChatGPT model catalog failed (HTTP {status})"));
    }
    let payload: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "ChatGPT model catalog returned invalid JSON".to_string())?;
    let models = visible_models(&payload)?;
    Ok(json!({"models": models}))
}

fn visible_models(payload: &Value) -> Result<Vec<Value>, String> {
    let models = payload
        .get("models")
        .and_then(Value::as_array)
        .ok_or("ChatGPT model catalog did not include a models list")?
        .iter()
        .filter(|model| model.get("visibility").and_then(Value::as_str) == Some("list"))
        .filter_map(|model| {
            let slug = model.get("slug")?.as_str()?;
            let display_name = model.get("display_name")?.as_str()?;
            Some(json!({"slug": slug, "displayName": display_name}))
        })
        .collect::<Vec<_>>();
    Ok(models)
}

pub fn connect(data_dir: &Path) -> Result<Value, String> {
    let _guard = OAUTH_GATE
        .lock()
        .map_err(|_| "ChatGPT credential lock unavailable")?;
    let host_id = load_or_create_host_id(data_dir)?;
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Could not start the OAuth callback listener: {e}"))?;
    listener.set_nonblocking(false).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let state = random_token(32)?;
    let nonce = random_token(32)?;
    let verifier = random_token(48)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let saved = read_account()?;
    let registration = std::fs::read(data_dir.join("chatgpt-registration.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Registration>(&bytes).ok());
    let is_new = saved.is_none() && registration.is_none();
    let client_id = saved
        .as_ref()
        .map(|a| a.client_id.clone())
        .or_else(|| registration.as_ref().map(|r| r.client_id.clone()))
        .unwrap_or_else(|| "dynamic_agent_client".into());
    let mut authorize = Url::parse("https://auth.openai.com/api/accounts/authorize").unwrap();
    {
        let mut q = authorize.query_pairs_mut();
        q.append_pair("client_id", &client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("scope", SCOPE)
            .append_pair("resource", RESOURCE)
            .append_pair("state", &state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &challenge)
            .append_pair("ext_agent_host_id", &host_id);
        if is_new {
            q.append_pair("agent_name_hint", "Planager");
        } else if let Some(a) = saved.as_ref() {
            q.append_pair("id_token_hint", &a.id_token);
            if let Some(email) = &a.email {
                q.append_pair("login_hint", email);
            }
        } else if let Some(registration) = registration.as_ref() {
            if let Some(email) = &registration.email {
                q.append_pair("login_hint", email);
            }
        }
    }
    open_system_browser(authorize.as_str())?;
    let callback = receive_callback(listener)?;
    if callback.get("state").map(String::as_str) != Some(state.as_str()) {
        return Err("ChatGPT OAuth state did not match this sign-in attempt".into());
    }
    if let Some(error) = callback.get("error") {
        return Err(if error == "access_denied" {
            "ChatGPT sign-in was cancelled or plan access was denied".into()
        } else {
            "ChatGPT sign-in failed".into()
        });
    }
    let code = callback
        .get("code")
        .ok_or("ChatGPT callback did not include an authorization code")?;
    let issued_client_id = if is_new {
        callback
            .get("client_id")
            .filter(|v| !v.is_empty() && *v != "dynamic_agent_client")
            .cloned()
            .ok_or("ChatGPT registration did not return an issued client ID")?
    } else {
        let expected = saved
            .as_ref()
            .map(|a| a.client_id.as_str())
            .or_else(|| registration.as_ref().map(|r| r.client_id.as_str()))
            .ok_or("Saved ChatGPT registration is unavailable")?;
        if callback.get("client_id").is_some_and(|v| v != expected) {
            return Err("ChatGPT returned a different client ID than the selected account".into());
        }
        expected.to_string()
    };
    if is_new {
        let registration = Registration {
            client_id: issued_client_id.clone(),
            subject: String::new(),
            email: None,
            host_id: host_id.clone(),
        };
        let bytes = serde_json::to_vec(&registration)
            .map_err(|_| "Could not encode ChatGPT registration".to_string())?;
        std::fs::write(data_dir.join("chatgpt-registration.json"), bytes)
            .map_err(|_| "Could not preserve the issued ChatGPT client ID".to_string())?;
    }
    let form = form_body(&[
        ("grant_type", "authorization_code"),
        ("client_id", &issued_client_id),
        ("code", code),
        ("code_verifier", &verifier),
        ("redirect_uri", &redirect_uri),
        ("resource", RESOURCE),
    ]);
    let tokens = exchange(&form)?;
    let granted: Vec<String> = tokens.scope.split_whitespace().map(str::to_owned).collect();
    if !granted.iter().any(|s| s == "chatgpt.tokens.use.direct") {
        return Err("ChatGPT did not grant the required plan-usage permission".into());
    }
    let identity = verify_id_token(&tokens.id_token, &issued_client_id, &nonce)?;
    if let Some(previous_subject) = saved.as_ref().map(|a| a.subject.as_str()).or_else(|| {
        registration
            .as_ref()
            .map(|r| r.subject.as_str())
            .filter(|subject| !subject.is_empty())
    }) {
        if previous_subject != identity.subject {
            return Err("The signed-in ChatGPT account did not match the selected account".into());
        }
    }
    let expires_at = now_secs().saturating_add(tokens.expires_in);
    let account = Account {
        email: identity.email,
        subject: identity.subject,
        client_id: issued_client_id,
        host_id,
        id_token: tokens.id_token,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scopes: granted,
        expires_at,
    };
    write_account(&account)?;
    Ok(json!({"connected": true, "email": account.email, "expiresAt": account.expires_at}))
}

pub fn access_token() -> Result<String, String> {
    let _guard = OAUTH_GATE
        .lock()
        .map_err(|_| "ChatGPT credential lock unavailable")?;
    let mut account = read_account()?.ok_or("Connect a ChatGPT account in Settings first")?;
    if account.expires_at > now_secs().saturating_add(90) {
        return Ok(account.access_token);
    }
    let body = form_body(&[
        ("grant_type", "refresh_token"),
        ("client_id", &account.client_id),
        ("refresh_token", &account.refresh_token),
        ("resource", RESOURCE),
    ]);
    let tokens = exchange(&body)?;
    let granted: Vec<String> = if tokens.scope.trim().is_empty() {
        account.scopes.clone()
    } else {
        tokens.scope.split_whitespace().map(str::to_owned).collect()
    };
    if !granted.iter().any(|s| s == "chatgpt.tokens.use.direct") {
        return Err("Refreshed ChatGPT credentials lack the required plan-usage permission".into());
    }
    let identity = verify_id_token(&tokens.id_token, &account.client_id, "")?;
    if identity.subject != account.subject {
        return Err("Refreshed ChatGPT credentials identify a different account".into());
    }
    account.access_token = tokens.access_token;
    account.refresh_token = tokens.refresh_token;
    account.id_token = tokens.id_token;
    account.expires_at = now_secs().saturating_add(tokens.expires_in);
    account.scopes = granted;
    write_account(&account)?;
    Ok(account.access_token)
}

fn token_key(version: &str, part: &str) -> String {
    format!("{CREDENTIAL_TARGET}.{version}.{part}")
}

fn account_version() -> Result<Option<String>, String> {
    let Some(raw) = crate::settings::credential_read_target(CREDENTIAL_TARGET)? else {
        return Ok(None);
    };
    let stored: StoredAccount = serde_json::from_str(&raw)
        .map_err(|_| "Saved ChatGPT credential metadata is invalid".to_string())?;
    if !stored
        .scopes
        .iter()
        .any(|scope| scope == "chatgpt.tokens.use.direct")
    {
        return Err(
            "Saved ChatGPT credentials do not include the required plan-usage permission".into(),
        );
    }
    Ok(Some(stored.token_version))
}

fn read_account() -> Result<Option<Account>, String> {
    let Some(raw) = crate::settings::credential_read_target(CREDENTIAL_TARGET)? else {
        return Ok(None);
    };
    let stored: StoredAccount = serde_json::from_str(&raw)
        .map_err(|_| "Saved ChatGPT credential metadata is invalid".to_string())?;
    let read_part = |part: &str, count: usize| -> Result<String, String> {
        if count == 0 || count > 32 {
            return Err("Saved ChatGPT token chunk metadata is invalid".into());
        }
        let mut token = String::new();
        for index in 0..count {
            token.push_str(
                &crate::settings::credential_read_target(&token_key(
                    &stored.token_version,
                    &format!("{part}.{index}"),
                ))?
                .ok_or_else(|| "Saved ChatGPT credentials are incomplete".to_string())?,
            );
        }
        Ok(token)
    };
    let account = Account {
        email: stored.email,
        subject: stored.subject,
        client_id: stored.client_id,
        host_id: stored.host_id,
        scopes: stored.scopes,
        expires_at: stored.expires_at,
        access_token: read_part("access", stored.access_chunks)?,
        refresh_token: read_part("refresh", stored.refresh_chunks)?,
        id_token: read_part("id", stored.id_chunks)?,
    };
    Ok(Some(account))
}

fn write_account(account: &Account) -> Result<(), String> {
    for token in [
        &account.access_token,
        &account.refresh_token,
        &account.id_token,
    ] {
        token_chunks(token, 2000)?;
    }
    let previous = account_version()?;
    let version = uuid::Uuid::new_v4().to_string();
    let mut written_keys: Vec<String> = Vec::new();
    let mut write_part = |part: &str, token: &str| -> Result<usize, String> {
        let chunks = token_chunks(token, 2000)?;
        for (index, piece) in chunks.iter().enumerate() {
            let key = token_key(&version, &format!("{part}.{index}"));
            if let Err(error) = crate::settings::credential_write_target(&key, piece) {
                for previous in &written_keys {
                    let _ = crate::settings::credential_delete_target(previous);
                }
                return Err(error);
            }
            written_keys.push(key);
        }
        Ok(chunks.len())
    };
    let access_chunks = write_part("access", &account.access_token)?;
    let refresh_chunks = write_part("refresh", &account.refresh_token)?;
    let id_chunks = write_part("id", &account.id_token)?;
    let stored = StoredAccount {
        email: account.email.clone(),
        subject: account.subject.clone(),
        client_id: account.client_id.clone(),
        host_id: account.host_id.clone(),
        scopes: account.scopes.clone(),
        expires_at: account.expires_at,
        token_version: version.clone(),
        access_chunks,
        refresh_chunks,
        id_chunks,
    };
    let metadata = serde_json::to_string(&stored)
        .map_err(|_| "Could not encode ChatGPT credential metadata".to_string())?;
    if let Err(error) = crate::settings::credential_write_target(CREDENTIAL_TARGET, &metadata) {
        for key in &written_keys {
            let _ = crate::settings::credential_delete_target(key);
        }
        return Err(error);
    }
    if let Some(previous) = previous {
        let _ = delete_tokens(&previous);
    }
    Ok(())
}

fn token_chunks(token: &str, max_bytes: usize) -> Result<Vec<String>, String> {
    if token.is_empty()
        || token.len() > 64 * 1024
        || !token.is_ascii()
        || max_bytes == 0
        || max_bytes > 2560
    {
        return Err("A ChatGPT token is empty, too large, or malformed".into());
    }
    Ok(token
        .as_bytes()
        .chunks(max_bytes)
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect())
}

fn delete_tokens(version: &str) -> Result<(), String> {
    for part in ["access", "refresh", "id"] {
        for index in 0..32 {
            crate::settings::credential_delete_target(&token_key(
                version,
                &format!("{part}.{index}"),
            ))?;
        }
    }
    Ok(())
}

fn exchange(form: &str) -> Result<TokenResponse, String> {
    let (status, bytes) = crate::win_http::post_form(TOKEN_URL, Vec::new(), form.as_bytes())?;
    if !(200..300).contains(&status) {
        return Err(format!(
            "ChatGPT OAuth token exchange failed (HTTP {status})"
        ));
    }
    let tokens: TokenResponse = serde_json::from_slice(&bytes)
        .map_err(|_| "ChatGPT OAuth returned invalid token data".to_string())?;
    if tokens.token_type.to_lowercase() != "bearer"
        || tokens.access_token.is_empty()
        || tokens.refresh_token.is_empty()
        || tokens.id_token.is_empty()
    {
        return Err("ChatGPT OAuth token response is incomplete".into());
    }
    Ok(tokens)
}

fn verify_id_token(token: &str, audience: &str, nonce: &str) -> Result<VerifiedIdentity, String> {
    let mut parts = token.split('.');
    let header = parts.next().ok_or("Invalid ID token")?;
    let claims_part = parts.next().ok_or("Invalid ID token")?;
    let signature_part = parts.next().ok_or("Invalid ID token")?;
    if parts.next().is_some() {
        return Err("Invalid ID token".into());
    }
    let header: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(header)
            .map_err(|_| "Invalid ID token header")?,
    )
    .map_err(|_| "Invalid ID token header")?;
    if header.get("alg").and_then(Value::as_str) != Some("RS256") {
        return Err("Unsupported ChatGPT ID token signature algorithm".into());
    }
    let kid = header
        .get("kid")
        .and_then(Value::as_str)
        .ok_or("ChatGPT ID token is missing its signing key ID")?;
    let claims: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(claims_part)
            .map_err(|_| "Invalid ID token claims")?,
    )
    .map_err(|_| "Invalid ID token claims")?;
    let discovery = get_json("https://auth.openai.com/.well-known/openid-configuration")?;
    if discovery.get("issuer").and_then(Value::as_str) != Some(ISSUER) {
        return Err("ChatGPT identity issuer did not match".into());
    }
    let jwks_url = discovery
        .get("jwks_uri")
        .and_then(Value::as_str)
        .ok_or("ChatGPT identity keys URL is unavailable")?;
    let parsed = Url::parse(jwks_url).map_err(|_| "ChatGPT identity keys URL is invalid")?;
    if parsed.scheme() != "https" || parsed.host_str() != Some("auth.openai.com") {
        return Err("ChatGPT identity keys host is invalid".into());
    }
    let jwks = get_json(jwks_url)?;
    let key = jwks
        .get("keys")
        .and_then(Value::as_array)
        .and_then(|keys| {
            keys.iter().find(|k| {
                k.get("kid").and_then(Value::as_str) == Some(kid)
                    && k.get("kty").and_then(Value::as_str) == Some("RSA")
                    && k.get("alg")
                        .and_then(Value::as_str)
                        .is_none_or(|v| v == "RS256")
            })
        })
        .ok_or("ChatGPT ID token signing key was not found")?;
    let n = URL_SAFE_NO_PAD
        .decode(
            key.get("n")
                .and_then(Value::as_str)
                .ok_or("Invalid ChatGPT signing key")?,
        )
        .map_err(|_| "Invalid ChatGPT signing key")?;
    let e = URL_SAFE_NO_PAD
        .decode(
            key.get("e")
                .and_then(Value::as_str)
                .ok_or("Invalid ChatGPT signing key")?,
        )
        .map_err(|_| "Invalid ChatGPT signing key")?;
    let der = rsa_public_key_der(&n, &e);
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_part)
        .map_err(|_| "Invalid ID token signature")?;
    signature::UnparsedPublicKey::new(&signature::RSA_PKCS1_2048_8192_SHA256, der)
        .verify(
            format!("{header}.{claims_part}").as_bytes(),
            &signature_bytes,
        )
        .map_err(|_| "ChatGPT ID token signature verification failed")?;
    validate_claims(&claims, audience, nonce, now_secs())
}

fn validate_claims(
    claims: &Value,
    audience: &str,
    nonce: &str,
    now: u64,
) -> Result<VerifiedIdentity, String> {
    if claims.get("iss").and_then(Value::as_str) != Some(ISSUER) {
        return Err("ChatGPT identity issuer did not match".into());
    }
    let aud_ok = claims.get("aud").is_some_and(|aud| {
        aud.as_str() == Some(audience)
            || aud
                .as_array()
                .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(audience)))
    });
    if !aud_ok {
        return Err("ChatGPT ID token audience did not match the registered client".into());
    }
    let exp = claims
        .get("exp")
        .and_then(Value::as_u64)
        .ok_or("ChatGPT ID token has no valid expiry")?;
    if exp <= now {
        return Err("ChatGPT ID token has expired".into());
    }
    if !nonce.is_empty() && claims.get("nonce").and_then(Value::as_str) != Some(nonce) {
        return Err("ChatGPT ID token nonce did not match".into());
    }
    let subject = claims
        .get("sub")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("ChatGPT ID token has no subject")?
        .to_owned();
    let email = claims
        .get("email")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(VerifiedIdentity { subject, email })
}

fn get_json(url: &str) -> Result<Value, String> {
    let (status, bytes) = crate::win_http::get(url)?;
    if !(200..300).contains(&status) {
        return Err(format!("ChatGPT identity endpoint failed (HTTP {status})"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "ChatGPT identity endpoint returned invalid JSON".into())
}

fn rsa_public_key_der(n: &[u8], e: &[u8]) -> Vec<u8> {
    fn integer(bytes: &[u8]) -> Vec<u8> {
        let first = bytes.iter().position(|b| *b != 0).unwrap_or(bytes.len());
        let bytes = &bytes[first..];
        let mut out = vec![0x02];
        let len = bytes.len() + usize::from(bytes.first().is_some_and(|b| b & 0x80 != 0));
        der_len(&mut out, len);
        if bytes.first().is_some_and(|b| b & 0x80 != 0) {
            out.push(0);
        }
        out.extend_from_slice(bytes);
        out
    }
    fn der_len(out: &mut Vec<u8>, len: usize) {
        if len < 128 {
            out.push(len as u8);
        } else {
            let bytes = len.to_be_bytes();
            let first = bytes.iter().position(|b| *b != 0).unwrap();
            out.push(0x80 | (bytes.len() - first) as u8);
            out.extend_from_slice(&bytes[first..]);
        }
    }
    let mut content = integer(n);
    content.extend(integer(e));
    let mut out = vec![0x30];
    der_len(&mut out, content.len());
    out.extend(content);
    out
}

fn random_token(bytes: usize) -> Result<String, String> {
    let mut data = vec![0u8; bytes];
    SystemRandom::new()
        .fill(&mut data)
        .map_err(|_| "Secure random generator is unavailable".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(data))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn form_body(fields: &[(&str, &str)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in fields {
        serializer.append_pair(key, value);
    }
    serializer.finish()
}

fn load_or_create_host_id(data_dir: &Path) -> Result<String, String> {
    let path = data_dir.join("chatgpt-host-id.txt");
    if let Ok(bytes) = std::fs::read(data_dir.join("chatgpt-registration.json")) {
        if let Ok(registration) = serde_json::from_slice::<Registration>(&bytes) {
            if registration.host_id.starts_with("urn:uuid:") {
                return Ok(registration.host_id);
            }
        }
    }
    if let Ok(id) = std::fs::read_to_string(&path) {
        let id = id.trim();
        if id.starts_with("urn:uuid:") && id.len() == 45 {
            return Ok(id.to_owned());
        }
    }
    let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    std::fs::write(&path, &id).map_err(|_| "Could not save the ChatGPT host ID".to_string())?;
    Ok(id)
}

fn receive_callback(
    listener: TcpListener,
) -> Result<std::collections::HashMap<String, String>, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + Duration::from_secs(300);
    let mut stream = loop {
        match listener.accept() {
            Ok((s, addr)) if addr.ip().is_loopback() => break s,
            Ok(_) => continue,
            Err(e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    && std::time::Instant::now() < deadline =>
            {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                return Err("ChatGPT sign-in timed out".into())
            }
            Err(e) => return Err(format!("OAuth callback failed: {e}")),
        }
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let mut request = [0u8; 8192];
    let count = stream
        .read(&mut request)
        .map_err(|_| "Could not read the ChatGPT sign-in callback")?;
    let first = std::str::from_utf8(&request[..count])
        .map_err(|_| "ChatGPT callback was invalid")?
        .lines()
        .next()
        .ok_or("ChatGPT callback was empty")?;
    let target = first
        .split_whitespace()
        .nth(1)
        .ok_or("ChatGPT callback request was invalid")?;
    let parsed = Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "ChatGPT callback URL was invalid")?;
    if parsed.path() != CALLBACK_PATH {
        return Err("ChatGPT callback path did not match".into());
    }
    let params: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();
    let page = "<!doctype html><meta charset=utf-8><title>Planager</title><p>Sign-in response received. You can return to Planager.</p>";
    let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", page.len(), page);
    let _ = stream.write_all(response.as_bytes());
    if params.is_empty() {
        return Err("ChatGPT callback did not include OAuth parameters".into());
    }
    Ok(params)
}

#[cfg(target_os = "windows")]
fn open_system_browser(url: &str) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut c_void,
            op: *const u16,
            file: *const u16,
            params: *const u16,
            dir: *const u16,
            show: i32,
        ) -> isize;
    }
    let op: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = format!("{url}\0").encode_utf16().collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result <= 32 {
        return Err("Could not open the system browser for ChatGPT sign-in".into());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_system_browser(_url: &str) -> Result<(), String> {
    Err("ChatGPT sign-in is supported on Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_and_form_encoding_are_deterministic() {
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(b"abc")),
            "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0"
        );
        let encoded = form_body(&[
            ("code", "a b&c"),
            ("redirect_uri", "http://127.0.0.1:1455/auth/callback"),
        ]);
        assert!(encoded.contains("code=a+b%26c"));
        assert!(encoded.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback"));
    }
    #[test]
    fn rsa_jwk_conversion_has_der_sequence_and_integer_markers() {
        let der = rsa_public_key_der(&[0x80, 0x01], &[0x03]);
        assert_eq!(der[0], 0x30);
        assert!(der
            .windows(5)
            .any(|window| window == [0x02, 0x03, 0x00, 0x80, 0x01]));
        assert!(der.ends_with(&[0x02, 0x01, 0x03]));
    }
    #[test]
    fn token_scopes_require_explicit_plan_permission() {
        let scopes = "openid email chatgpt.tokens.use.direct"
            .split_whitespace()
            .collect::<Vec<_>>();
        assert!(scopes.contains(&"chatgpt.tokens.use.direct"));
        assert!(!"openid email resource.invoke"
            .split_whitespace()
            .any(|s| s == "chatgpt.tokens.use.direct"));
    }

    #[test]
    fn model_catalog_uses_documented_shape_and_keeps_only_listed_models() {
        let payload = serde_json::json!({"models":[
            {"slug":"gpt-listed","display_name":"GPT Listed","visibility":"list"},
            {"slug":"gpt-hidden","display_name":"GPT Hidden","visibility":"hidden"}
        ]});
        let models = visible_models(&payload).unwrap();
        assert_eq!(
            models,
            vec![serde_json::json!({"slug":"gpt-listed","displayName":"GPT Listed"})]
        );
        assert!(visible_models(&serde_json::json!({"data":[]})).is_err());
    }

    #[test]
    fn revocation_form_contains_refresh_token_hint_and_issued_client() {
        let encoded = form_body(&[
            ("token", "refresh+secret"),
            ("token_type_hint", "refresh_token"),
            ("client_id", "oaiapp_registered"),
        ]);
        assert!(encoded.contains("token=refresh%2Bsecret"));
        assert!(encoded.contains("token_type_hint=refresh_token"));
        assert!(encoded.contains("client_id=oaiapp_registered"));
    }

    #[test]
    fn token_chunks_stay_under_credential_manager_blob_limit_and_round_trip() {
        let token = "a".repeat(5301);
        let chunks = token_chunks(&token, 2000).unwrap();
        assert_eq!(
            chunks.iter().map(String::len).collect::<Vec<_>>(),
            vec![2000, 2000, 1301]
        );
        assert!(chunks.iter().all(|chunk| chunk.len() <= 2560));
        assert_eq!(chunks.concat(), token);
    }

    #[test]
    fn id_token_claims_check_issuer_audience_expiry_nonce_and_subject() {
        let claims = serde_json::json!({"iss":ISSUER,"aud":["registered-client"],"exp":500,"nonce":"attempt-nonce","sub":"verified-subject","email":"a@example.test"});
        let identity = validate_claims(&claims, "registered-client", "attempt-nonce", 400).unwrap();
        assert_eq!(identity.subject, "verified-subject");
        assert_eq!(identity.email.as_deref(), Some("a@example.test"));
        assert!(validate_claims(&claims, "wrong-client", "attempt-nonce", 400).is_err());
        assert!(validate_claims(&claims, "registered-client", "wrong-nonce", 400).is_err());
        assert!(validate_claims(&claims, "registered-client", "attempt-nonce", 500).is_err());
        let wrong_issuer = serde_json::json!({"iss":"https://example.test","aud":"registered-client","exp":500,"nonce":"attempt-nonce","sub":"subject"});
        assert!(validate_claims(&wrong_issuer, "registered-client", "attempt-nonce", 400).is_err());
    }
}
