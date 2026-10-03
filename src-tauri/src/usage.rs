use crate::settings::RateLimits;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEvent {
    pub id: String,
    pub timestamp: String,
    pub action: String,
    pub provider: String,
    pub model: String,
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    #[serde(default)]
    pub reserved_prompt_tokens: u64,
    #[serde(default)]
    pub reserved_completion_tokens: u64,
    pub latency_ms: u64,
    pub status: String,
    pub http_status: Option<u16>,
    pub simulation: bool,
    #[serde(default = "default_usage_known")]
    pub usage_known: bool,
}

fn default_usage_known() -> bool {
    true
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ledger {
    events: Vec<UsageEvent>,
    total_reset_at: Option<String>,
}

fn read(path: &Path) -> Result<Ledger, String> {
    if !path.exists() {
        return Ok(Ledger::default());
    }
    let value: serde_json::Value =
        serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if value.is_array() {
        let events = serde_json::from_value(value).map_err(|e| e.to_string())?;
        Ok(Ledger {
            events,
            total_reset_at: None,
        })
    } else {
        serde_json::from_value(value).map_err(|e| e.to_string())
    }
}

fn write(path: &Path, ledger: &Ledger) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid usage path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(ledger).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn event_time(event: &UsageEvent) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&event.timestamp)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

fn budget_tokens(event: &UsageEvent) -> u64 {
    let actual = event.prompt_tokens.saturating_add(event.completion_tokens);
    if event.usage_known {
        actual
    } else {
        actual.max(
            event
                .reserved_prompt_tokens
                .saturating_add(event.reserved_completion_tokens),
        )
    }
}

#[cfg(test)]
pub fn check_limits(
    events: &[UsageEvent],
    limits: &RateLimits,
    prompt: u64,
    output_reservation: u64,
    now: DateTime<Utc>,
) -> Result<(), String> {
    check_limits_mode(events, limits, prompt, output_reservation, now, false, None)
}

fn check_limits_mode(
    events: &[UsageEvent],
    limits: &RateLimits,
    prompt: u64,
    output_reservation: u64,
    now: DateTime<Utc>,
    simulation: bool,
    reset_at: Option<DateTime<Utc>>,
) -> Result<(), String> {
    let relevant: Vec<&UsageEvent> = events
        .iter()
        .filter(|event| {
            event.status != "counter-reset"
                && event.status != "limited"
                && (!event.simulation || (simulation && event.status == "simulation-admitted"))
        })
        .collect();
    let minute = now - Duration::minutes(1);
    let day = now - Duration::hours(24);
    let recent_minute: Vec<&&UsageEvent> = relevant
        .iter()
        .filter(|event| event_time(event).is_some_and(|time| time >= minute && time <= now))
        .collect();
    let recent_day = relevant
        .iter()
        .filter(|event| event_time(event).is_some_and(|time| time >= day && time <= now))
        .count() as u64;
    if limits.rpm > 0 && recent_minute.len() as u64 >= limits.rpm {
        return Err("RPM limit reached".into());
    }
    if limits.rpd > 0 && recent_day >= limits.rpd {
        return Err("RPD limit reached".into());
    }
    let minute_tokens: u64 = recent_minute.iter().map(|event| budget_tokens(event)).sum();
    if limits.tpm > 0
        && minute_tokens
            .saturating_add(prompt)
            .saturating_add(output_reservation)
            > limits.tpm
    {
        return Err("TPM limit would be exceeded".into());
    }
    let total_tokens: u64 = relevant
        .iter()
        .filter(|event| match event_time(event) {
            Some(at) => at <= now && reset_at.is_none_or(|reset| at > reset),
            None => reset_at.is_none(),
        })
        .map(|event| budget_tokens(event))
        .sum();
    if limits.total_tokens > 0
        && total_tokens
            .saturating_add(prompt)
            .saturating_add(output_reservation)
            > limits.total_tokens
    {
        return Err("Total token limit would be exceeded".into());
    }
    Ok(())
}

pub fn list(path: &Path) -> Result<Vec<UsageEvent>, String> {
    Ok(read(path)?.events)
}

pub fn reset_total(path: &Path) -> Result<(), String> {
    let mut ledger = read(path)?;
    let timestamp = Utc::now().to_rfc3339();
    ledger.total_reset_at = Some(timestamp.clone());
    ledger.events.push(UsageEvent {
        id: format!("reset-{}", Uuid::new_v4()),
        timestamp,
        action: "total_reset".into(),
        provider: "local".into(),
        model: "usage-counter".into(),
        prompt_tokens: 0,
        completion_tokens: 0,
        reserved_prompt_tokens: 0,
        reserved_completion_tokens: 0,
        latency_ms: 0,
        status: "counter-reset".into(),
        http_status: None,
        simulation: false,
        usage_known: true,
    });
    write(path, &ledger)
}

pub fn simulate(path: &Path, count: usize, limits: &RateLimits) -> Result<Vec<UsageEvent>, String> {
    let mut ledger = read(path)?;
    let count = count.clamp(1, 100);
    let reset_at = ledger
        .total_reset_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    let mut trial = Vec::new();
    let real = ledger
        .events
        .iter()
        .filter(|event| !event.simulation)
        .cloned()
        .collect::<Vec<_>>();
    for i in 0..count {
        let mut history = real.clone();
        history.extend(trial.iter().cloned());
        let status =
            if check_limits_mode(&history, limits, 100, 100, Utc::now(), true, reset_at).is_ok() {
                "simulation-admitted"
            } else {
                "simulation-limited"
            };
        trial.push(UsageEvent {
            id: format!("simulation-{}", Uuid::new_v4()),
            timestamp: Utc::now().to_rfc3339(),
            action: format!("simulation_{}", i + 1),
            provider: "simulation".into(),
            model: "rate-limit-test".into(),
            prompt_tokens: if status == "simulation-admitted" {
                100
            } else {
                0
            },
            completion_tokens: if status == "simulation-admitted" {
                100
            } else {
                0
            },
            reserved_prompt_tokens: 0,
            reserved_completion_tokens: 0,
            latency_ms: 0,
            status: status.into(),
            http_status: None,
            simulation: true,
            usage_known: true,
        });
    }
    ledger.events.extend(trial);
    write(path, &ledger)?;
    Ok(ledger
        .events
        .into_iter()
        .filter(|event| event.simulation)
        .collect())
}

pub fn reserve(
    path: &Path,
    action: &str,
    provider: &str,
    model: &str,
    prompt: u64,
    output: u64,
    limits: &RateLimits,
) -> Result<String, String> {
    let mut ledger = read(path)?;
    let now = Utc::now();
    for event in ledger
        .events
        .iter_mut()
        .filter(|event| !event.simulation && event.status == "pending")
    {
        if event_time(event).is_some_and(|at| at < now - Duration::minutes(10)) {
            event.status = "abandoned".into();
            event.prompt_tokens = 0;
            event.completion_tokens = 0;
        }
    }
    let reset_at = ledger
        .total_reset_at
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.with_timezone(&Utc));
    if let Err(reason) =
        check_limits_mode(&ledger.events, limits, prompt, output, now, false, reset_at)
    {
        ledger.events.push(UsageEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: now.to_rfc3339(),
            action: action.into(),
            provider: provider.into(),
            model: model.into(),
            prompt_tokens: 0,
            completion_tokens: 0,
            reserved_prompt_tokens: 0,
            reserved_completion_tokens: 0,
            latency_ms: 0,
            status: "limited".into(),
            http_status: None,
            simulation: false,
            usage_known: true,
        });
        write(path, &ledger)?;
        return Err(reason);
    }
    let id = Uuid::new_v4().to_string();
    ledger.events.push(UsageEvent {
        id: id.clone(),
        timestamp: now.to_rfc3339(),
        action: action.into(),
        provider: provider.into(),
        model: model.into(),
        prompt_tokens: prompt,
        completion_tokens: output,
        reserved_prompt_tokens: prompt,
        reserved_completion_tokens: output,
        latency_ms: 0,
        status: "pending".into(),
        http_status: None,
        simulation: false,
        usage_known: false,
    });
    write(path, &ledger)?;
    Ok(id)
}

pub fn finish(
    path: &Path,
    id: &str,
    prompt: u64,
    completion: u64,
    latency: u64,
    status: &str,
    http_status: Option<u16>,
) -> Result<(), String> {
    finish_with_usage_known(
        path,
        id,
        UsageCompletion {
            prompt_tokens: prompt,
            completion_tokens: completion,
            latency_ms: latency,
            status,
            http_status,
            usage_known: true,
        },
    )
}

pub struct UsageCompletion<'a> {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    pub latency_ms: u64,
    pub status: &'a str,
    pub http_status: Option<u16>,
    pub usage_known: bool,
}

pub fn finish_with_usage_known(
    path: &Path,
    id: &str,
    completion: UsageCompletion<'_>,
) -> Result<(), String> {
    let mut ledger = read(path)?;
    let event = ledger
        .events
        .iter_mut()
        .find(|event| event.id == id)
        .ok_or("Usage reservation disappeared")?;
    event.timestamp = Utc::now().to_rfc3339();
    event.prompt_tokens = completion.prompt_tokens;
    event.completion_tokens = completion.completion_tokens;
    event.latency_ms = completion.latency_ms;
    event.status = completion.status.into();
    event.http_status = completion.http_status;
    event.usage_known = completion.usage_known;
    write(path, &ledger)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn event(at: DateTime<Utc>, prompt: u64, output: u64, simulation: bool) -> UsageEvent {
        UsageEvent {
            id: Uuid::new_v4().to_string(),
            timestamp: at.to_rfc3339(),
            action: "analyze".into(),
            provider: "custom".into(),
            model: "test".into(),
            prompt_tokens: prompt,
            completion_tokens: output,
            reserved_prompt_tokens: prompt,
            reserved_completion_tokens: output,
            latency_ms: 4,
            status: "completed".into(),
            http_status: Some(200),
            simulation,
            usage_known: true,
        }
    }

    #[test]
    fn limit_crossing_uses_deterministic_time_and_ignores_simulation() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 12, 0, 0).unwrap();
        let limits = RateLimits {
            rpm: 2,
            rpd: 3,
            tpm: 100,
            total_tokens: 150,
        };
        let history = vec![
            event(now - Duration::seconds(30), 20, 20, false),
            event(now - Duration::seconds(3), 0, 0, true),
        ];
        assert!(check_limits(&history, &limits, 20, 20, now).is_ok());
        let crossing = vec![
            event(now - Duration::seconds(30), 20, 20, false),
            event(now - Duration::seconds(4), 20, 20, false),
        ];
        assert_eq!(
            check_limits(&crossing, &limits, 20, 20, now).unwrap_err(),
            "RPM limit reached"
        );
        let tpm = RateLimits {
            rpm: 10,
            rpd: 10,
            tpm: 80,
            total_tokens: 500,
        };
        assert_eq!(
            check_limits(&history, &tpm, 25, 20, now).unwrap_err(),
            "TPM limit would be exceeded"
        );
    }

    #[test]
    fn future_events_do_not_consume_rate_or_total_limits() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 12, 0, 0).unwrap();
        let future = event(now + Duration::minutes(5), 100, 100, false);
        let limits = RateLimits {
            rpm: 1,
            rpd: 1,
            tpm: 2,
            total_tokens: 2,
        };

        assert!(check_limits(std::slice::from_ref(&future), &limits, 1, 1, now).is_ok());
        assert!(check_limits_mode(
            &[future],
            &limits,
            1,
            1,
            now,
            false,
            Some(now - Duration::hours(1)),
        )
        .is_ok());
    }

    #[test]
    fn simulated_events_stay_separate_and_reset_preserves_them() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage.json");
        let real = event(Utc::now(), 10, 5, false);
        write(
            &path,
            &Ledger {
                events: vec![real],
                total_reset_at: None,
            },
        )
        .unwrap();
        let limits = RateLimits {
            rpm: 2,
            rpd: 2,
            tpm: 1_000,
            total_tokens: 1_000,
        };
        let simulated = simulate(&path, 3, &limits).unwrap();
        assert_eq!(
            simulated
                .iter()
                .filter(|e| e.status == "simulation-admitted")
                .count(),
            1
        );
        assert_eq!(
            simulated
                .iter()
                .filter(|e| e.status == "simulation-limited")
                .count(),
            2
        );
        reset_total(&path).unwrap();
        let remaining = list(&path).unwrap();
        assert_eq!(remaining.len(), 5);
        assert!(remaining
            .iter()
            .any(|e| !e.simulation && e.status == "completed"));
        assert_eq!(
            remaining
                .iter()
                .filter(|e| e.status == "simulation-admitted")
                .count(),
            1
        );
        assert_eq!(
            remaining
                .iter()
                .filter(|e| e.status == "simulation-limited")
                .count(),
            2
        );
    }

    #[test]
    fn rate_limited_attempt_is_recorded_without_consuming_request_or_token_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage.json");
        let limits = RateLimits {
            rpm: 1,
            rpd: 1,
            tpm: 1,
            total_tokens: 1,
        };
        reserve(&path, "analyze", "gemini", "test-model", 1, 0, &limits).unwrap();

        assert_eq!(
            reserve(&path, "transform", "gemini", "test-model", 1, 0, &limits).unwrap_err(),
            "RPM limit reached"
        );
        let events = list(&path).unwrap();
        assert_eq!(events.len(), 2);
        let limited = events
            .iter()
            .find(|event| event.status == "limited")
            .unwrap();
        assert_eq!(limited.action, "transform");
        assert_eq!(limited.prompt_tokens + limited.completion_tokens, 0);
        assert!(limited.usage_known);

        let relaxed = RateLimits {
            rpm: 3,
            rpd: 3,
            tpm: 10,
            total_tokens: 10,
        };
        assert!(reserve(&path, "analyze", "gemini", "test-model", 1, 0, &relaxed).is_ok());
    }

    #[test]
    fn total_reset_does_not_reset_rate_windows() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 12, 0, 0).unwrap();
        let limits = RateLimits {
            rpm: 1,
            rpd: 1,
            tpm: 100,
            total_tokens: 200,
        };
        let history = vec![event(now - Duration::seconds(10), 100, 50, false)];
        let reset = Some(now - Duration::seconds(2));
        assert_eq!(
            check_limits_mode(&history, &limits, 1, 1, now, false, reset).unwrap_err(),
            "RPM limit reached"
        );
        let relaxed = RateLimits {
            rpm: 10,
            rpd: 10,
            tpm: 10_000,
            total_tokens: 200,
        };
        assert!(check_limits_mode(&history, &relaxed, 1, 1, now, false, reset).is_ok());
    }

    #[test]
    fn unknown_usage_keeps_reserved_budget_for_future_limit_checks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("usage.json");
        let limits = RateLimits::default();
        let id = reserve(&path, "analyze", "chatgpt", "test-model", 30, 70, &limits).unwrap();
        finish_with_usage_known(
            &path,
            &id,
            UsageCompletion {
                prompt_tokens: 0,
                completion_tokens: 0,
                latency_ms: 20,
                status: "failed",
                http_status: Some(200),
                usage_known: false,
            },
        )
        .unwrap();

        let event = list(&path).unwrap().remove(0);
        assert!(!event.usage_known);
        assert_eq!((event.prompt_tokens, event.completion_tokens), (0, 0));
        assert_eq!(
            (
                event.reserved_prompt_tokens,
                event.reserved_completion_tokens
            ),
            (30, 70)
        );

        let strict_total = RateLimits {
            rpm: 0,
            rpd: 0,
            tpm: 0,
            total_tokens: 150,
        };
        assert_eq!(
            check_limits(&[event], &strict_total, 40, 20, Utc::now()).unwrap_err(),
            "Total token limit would be exceeded"
        );
    }
}
