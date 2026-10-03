use serde_json::Value;
use std::{fs, path::Path};
use uuid::Uuid;

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid library path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_file_name(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("library.json"),
        Uuid::new_v4()
    ));
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(error.to_string());
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<Vec<Value>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let value: Value = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    value
        .as_array()
        .cloned()
        .ok_or("Library storage is not an array".into())
}

pub fn save(path: &Path, items: Vec<Value>) -> Result<(), String> {
    if items.len() > 10_000 {
        return Err("Library item limit exceeded".into());
    }
    write_json(path, &Value::Array(items))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        },
        thread,
    };
    #[test]
    fn persistent_items_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let items = vec![serde_json::json!({"unitId":"u1","title":"Reusable"})];
        save(&path, items.clone()).unwrap();
        assert_eq!(load(&path).unwrap(), items);
    }

    #[test]
    fn concurrent_serialized_saves_leave_valid_last_value_without_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let gate = Mutex::new(());
        let next = AtomicUsize::new(0);
        thread::scope(|scope| {
            let mut workers = Vec::new();
            for _ in 0..24 {
                let path = path.clone();
                let gate = &gate;
                let next = &next;
                workers.push(scope.spawn(move || {
                    let _guard = gate.lock().unwrap();
                    let value = next.fetch_add(1, Ordering::SeqCst) + 1;
                    save(&path, vec![serde_json::json!({"save": value})]).unwrap();
                }));
            }
            for worker in workers {
                worker.join().unwrap();
            }
        });
        assert_eq!(load(&path).unwrap(), vec![serde_json::json!({"save": 24})]);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
