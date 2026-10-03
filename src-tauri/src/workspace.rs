use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

fn is_link_or_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    false
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFile {
    pub path: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub root: Option<String>,
    pub files: Vec<WorkspaceFile>,
    pub directories: Vec<String>,
    pub metadata: Map<String, Value>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportFile {
    pub name: String,
    pub content: String,
}

const MAX_IMPORT_BYTES: u64 = 8 * 1024 * 1024;

pub fn read_import_file(path: &Path) -> Result<ImportFile, String> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pgr"))
    {
        return Err("Only .pgr source files can be imported".into());
    }
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_IMPORT_BYTES {
        return Err("PGR import must be a file no larger than 8 MiB".into());
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("PGR filename is not valid Unicode")?
        .to_string();
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return Err("PGR import must be a file no larger than 8 MiB".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| "PGR source must be UTF-8".to_string())?;
    Ok(ImportFile { name, content })
}

pub fn export_file_to(path: &Path, content: &str) -> Result<(), String> {
    if !path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pgr"))
    {
        return Err("Only .pgr files can be exported".into());
    }
    let parent = path.parent().ok_or("Invalid export destination")?;
    let canonical_parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if !canonical_parent.is_dir() {
        return Err("Export destination folder does not exist".into());
    }
    let name = path.file_name().ok_or("Invalid export filename")?;
    let safe_name = validate_relative(&name.to_string_lossy())?;
    let target = canonical_parent.join(safe_name);
    if let Ok(meta) = fs::symlink_metadata(&target) {
        if is_link_or_reparse_point(&meta) || !meta.is_file() {
            return Err("Export destination must be a regular file".into());
        }
    }
    atomic_write(&target, content.as_bytes())
}

pub fn validate_relative(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() || raw.contains('\0') {
        return Err("Workspace path is empty or invalid".into());
    }
    let normalized = raw.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute() {
        return Err("Absolute paths are not allowed in workspace payloads".into());
    }
    let mut clean = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(value) => {
                let name = value.to_string_lossy();
                let upper = name.trim_end_matches([' ', '.']).to_ascii_uppercase();
                if name.contains(':') || name.eq_ignore_ascii_case(".git") {
                    return Err("Workspace path contains a reserved name".into());
                }
                let stem = upper.split('.').next().unwrap_or("");
                if matches!(stem, "CON" | "PRN" | "AUX" | "NUL")
                    || (stem.len() == 4
                        && (stem.starts_with("COM") || stem.starts_with("LPT"))
                        && stem.as_bytes()[3].is_ascii_digit())
                {
                    return Err("Workspace path contains a reserved Windows device name".into());
                }
                clean.push(value)
            }
            _ => return Err("Workspace path traversal is not allowed".into()),
        }
    }
    if clean.as_os_str().is_empty() {
        return Err("Workspace path is empty".into());
    }
    Ok(clean)
}

fn ensure_safe_parent(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let mut at = root.to_path_buf();
    let components = relative.components().collect::<Vec<_>>();
    for component in components.iter().take(components.len().saturating_sub(1)) {
        if let Component::Normal(part) = component {
            at.push(part);
            match fs::symlink_metadata(&at) {
                Ok(metadata) => {
                    if is_link_or_reparse_point(&metadata)
                        || !fs::canonicalize(&at)
                            .map_err(|e| e.to_string())?
                            .starts_with(root)
                    {
                        return Err("Refusing to follow a linked workspace directory".into());
                    }
                    if !metadata.is_dir() {
                        return Err("A file blocks a workspace directory".into());
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    Ok(at)
}

pub(crate) fn checked_file_target(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let relative = validate_relative(&relative.to_string_lossy())?;
    let _ = ensure_safe_parent(&canonical_root, &relative)?;
    let target = canonical_root.join(relative);
    match fs::symlink_metadata(&target) {
        Ok(metadata) => {
            if is_link_or_reparse_point(&metadata) || !metadata.is_file() {
                return Err("Workspace file target must be a regular file".into());
            }
            if !fs::canonicalize(&target)
                .map_err(|error| error.to_string())?
                .starts_with(&canonical_root)
            {
                return Err("Workspace file target escaped its root".into());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(target)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid target path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid target name")?;
    let tmp = parent.join(format!(".{file_name}.{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

pub(crate) fn walk_pgr(
    root: &Path,
    at: &Path,
    files: &mut Vec<String>,
    dirs: &mut Vec<String>,
) -> Result<(), String> {
    let entries = fs::read_dir(at).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if is_link_or_reparse_point(&metadata) {
            continue;
        }
        let ty = metadata.file_type();
        if entry.file_name().to_str().is_none() {
            return Err("Workspace filenames must be valid UTF-8".into());
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if ty.is_dir() {
            if relative == ".git" || relative.starts_with(".git/") || relative == "target" {
                continue;
            }
            dirs.push(relative);
            walk_pgr(root, &path, files, dirs)?;
        } else if ty.is_file()
            && path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("pgr"))
        {
            files.push(relative);
        }
    }
    Ok(())
}

pub fn snapshot(root: &Path) -> Result<WorkspaceSnapshot, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    let mut directories = Vec::new();
    walk_pgr(
        &canonical_root,
        &canonical_root,
        &mut paths,
        &mut directories,
    )?;
    paths.sort();
    directories.sort();
    let mut files = Vec::with_capacity(paths.len());
    for relative in paths {
        let safe = validate_relative(&relative)?;
        let path = canonical_root.join(safe);
        if !path.starts_with(&canonical_root) {
            return Err("Workspace path escaped its root".into());
        }
        files.push(WorkspaceFile {
            path: relative,
            content: fs::read_to_string(path).map_err(|e| e.to_string())?,
        });
    }
    let meta_path = canonical_root.join(".planager.json");
    let metadata = match fs::symlink_metadata(&meta_path) {
        Ok(meta) => {
            // Unlike the recursive PGR walk, metadata is read explicitly below. Do
            // not let a workspace-controlled link make snapshot() read a file
            // outside the workspace (and return its contents to the renderer).
            if is_link_or_reparse_point(&meta) || !meta.is_file() {
                return Err(".planager.json must be a regular workspace file".into());
            }
            let parsed: Value =
                serde_json::from_slice(&fs::read(meta_path).map_err(|e| e.to_string())?)
                    .map_err(|e| format!("Invalid .planager.json: {e}"))?;
            parsed
                .as_object()
                .cloned()
                .ok_or(".planager.json must contain an object")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Map::new(),
        Err(error) => return Err(error.to_string()),
    };
    Ok(WorkspaceSnapshot {
        root: Some(canonical_root.to_string_lossy().into_owned()),
        files,
        directories,
        metadata,
    })
}

pub fn save(
    root: &Path,
    files: Vec<WorkspaceFile>,
    directories: Vec<String>,
    metadata: Map<String, Value>,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let canonical_root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut incoming = HashSet::<String>::new();
    let mut folded = HashSet::new();
    let mut staged = Vec::new();
    for file in files {
        let relative = validate_relative(&file.path)?;
        if relative
            .extension()
            .is_none_or(|ext| !ext.eq_ignore_ascii_case("pgr"))
        {
            return Err(format!("Only .pgr files can be saved: {}", file.path));
        }
        let key = relative.to_string_lossy().replace('\\', "/").to_lowercase();
        if !folded.insert(key) {
            return Err("Workspace payload contains duplicate paths".into());
        }
        let target = canonical_root.join(&relative);
        if !target.starts_with(&canonical_root) {
            return Err("Workspace path escaped its root".into());
        }
        let parent = ensure_safe_parent(&canonical_root, &relative)?;
        fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        if !fs::canonicalize(&parent)
            .map_err(|e| e.to_string())?
            .starts_with(&canonical_root)
        {
            return Err("Workspace parent escaped its root".into());
        }
        match fs::symlink_metadata(&target) {
            Ok(target_meta) => {
                if is_link_or_reparse_point(&target_meta)
                    || !target_meta.is_file()
                    || !fs::canonicalize(&target)
                        .map_err(|e| e.to_string())?
                        .starts_with(&canonical_root)
                {
                    return Err("Refusing to replace a linked or non-file workspace target".into());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        incoming.insert(relative.to_string_lossy().replace('\\', "/").to_lowercase());
        staged.push((target, file.content.into_bytes()));
    }
    let mut dir_folded = HashSet::new();
    for directory in directories {
        let relative = validate_relative(&directory)?;
        let key = relative.to_string_lossy().replace('\\', "/").to_lowercase();
        if !dir_folded.insert(key.clone()) || incoming.contains(&key) {
            return Err("Workspace payload contains duplicate paths".into());
        }
        let parent = ensure_safe_parent(&canonical_root, &relative)?;
        if !fs::canonicalize(&parent)
            .map_err(|e| e.to_string())?
            .starts_with(&canonical_root)
        {
            return Err("Workspace parent escaped its root".into());
        }
        let target = canonical_root.join(relative);
        match fs::symlink_metadata(&target) {
            Ok(metadata) if is_link_or_reparse_point(&metadata) => {
                return Err("Refusing to follow a linked workspace directory".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        if !fs::canonicalize(target)
            .map_err(|e| e.to_string())?
            .starts_with(&canonical_root)
        {
            return Err("Workspace directory escaped its root".into());
        }
    }
    let mut existing = Vec::new();
    let mut ignored_dirs = Vec::new();
    walk_pgr(
        &canonical_root,
        &canonical_root,
        &mut existing,
        &mut ignored_dirs,
    )?;
    let meta_bytes =
        serde_json::to_vec_pretty(&Value::Object(metadata)).map_err(|e| e.to_string())?;
    staged.push((canonical_root.join(".planager.json"), meta_bytes));
    let deletes = existing
        .into_iter()
        .filter_map(|relative| {
            let key = relative.replace('\\', "/").to_lowercase();
            (!incoming.contains(&key)).then(|| canonical_root.join(relative))
        })
        .collect::<Vec<_>>();
    let transaction = Uuid::new_v4();
    let mut staged_paths = Vec::new();
    for (target, bytes) in staged {
        let parent = target.parent().ok_or("Invalid target path")?;
        let file_name = target
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Invalid target name")?;
        let temporary = parent.join(format!(".{file_name}.{transaction}.stage"));
        let staged_result = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|e| e.to_string())?;
            file.write_all(&bytes).map_err(|e| e.to_string())?;
            file.sync_all().map_err(|e| e.to_string())
        })();
        if let Err(error) = staged_result {
            let _ = fs::remove_file(&temporary);
            for (_, pending) in &staged_paths {
                let _ = fs::remove_file(pending);
            }
            return Err(error);
        }
        staged_paths.push((target, temporary));
    }
    let mut backups: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut installed = Vec::new();
    let mut commit_error = None;
    for (target, temporary) in &staged_paths {
        if target.exists() {
            let Some(file_name) = target.file_name().and_then(|n| n.to_str()) else {
                commit_error = Some("Invalid backup target".into());
                break;
            };
            let backup = target.with_file_name(format!(".{file_name}.{transaction}.backup"));
            if let Err(error) = fs::rename(target, &backup) {
                commit_error = Some(error.to_string());
                break;
            }
            backups.push((target.clone(), backup));
        }
        if let Err(error) = fs::rename(temporary, target) {
            commit_error = Some(error.to_string());
            break;
        }
        installed.push(target.clone());
    }
    if commit_error.is_none() {
        for target in deletes {
            if target.exists() {
                let Some(file_name) = target.file_name().and_then(|n| n.to_str()) else {
                    commit_error = Some("Invalid delete target".into());
                    break;
                };
                let backup = target.with_file_name(format!(".{file_name}.{transaction}.backup"));
                if let Err(error) = fs::rename(&target, &backup) {
                    commit_error = Some(error.to_string());
                    break;
                }
                backups.push((target, backup));
            }
        }
    }
    if let Some(error) = commit_error {
        for path in installed.iter().rev() {
            let _ = fs::remove_file(path);
        }
        for (original, backup) in backups.iter().rev() {
            let _ = fs::rename(backup, original);
        }
        for (_, temporary) in &staged_paths {
            let _ = fs::remove_file(temporary);
        }
        return Err(format!("Workspace save rolled back: {error}"));
    }
    for (_, backup) in backups {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nested_round_trip_rename_delete_and_keep_unrelated_files() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::create_dir_all(root.join("old")).unwrap();
        fs::write(root.join("old/a.pgr"), "old model").unwrap();
        fs::write(root.join("notes.md"), "keep me").unwrap();
        fs::write(root.join("settings.json"), "keep too").unwrap();
        let mut metadata = Map::new();
        metadata.insert("positions".into(), serde_json::json!({"node": {"x": 10}}));
        save(
            root,
            vec![WorkspaceFile {
                path: "nested/new.pgr".into(),
                content: "new model".into(),
            }],
            vec!["nested".into()],
            metadata,
        )
        .unwrap();
        let loaded = snapshot(root).unwrap();
        assert_eq!(
            loaded.files,
            vec![WorkspaceFile {
                path: "nested/new.pgr".into(),
                content: "new model".into()
            }]
        );
        assert!(loaded.directories.contains(&"nested".into()));
        assert_eq!(loaded.metadata["positions"]["node"]["x"], 10);
        assert!(!root.join("old/a.pgr").exists());
        assert_eq!(
            fs::read_to_string(root.join("notes.md")).unwrap(),
            "keep me"
        );
        assert_eq!(
            fs::read_to_string(root.join("settings.json")).unwrap(),
            "keep too"
        );
        assert!(!loaded.files.iter().any(|f| f.path == ".planager.json"));
    }

    #[test]
    fn rejects_absolute_and_parent_paths() {
        assert!(validate_relative("../outside.pgr").is_err());
        assert!(validate_relative("C:/outside.pgr").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_rejects_metadata_symlink_outside_workspace() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let secret = outside.path().join("secret.json");
        fs::write(&secret, r#"{"token":"must not leak"}"#).unwrap();
        std::os::unix::fs::symlink(&secret, workspace.path().join(".planager.json")).unwrap();

        let error = snapshot(workspace.path()).unwrap_err();
        assert!(error.contains("regular workspace file"));
    }

    #[cfg(unix)]
    #[test]
    fn checked_file_target_rejects_linked_directories_and_dangling_file_links() {
        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let external_dir = outside.path().join("external");
        fs::create_dir(&external_dir).unwrap();
        std::os::unix::fs::symlink(&external_dir, workspace.path().join("linked")).unwrap();
        assert!(checked_file_target(workspace.path(), Path::new("linked/model.pgr")).is_err());

        let missing = outside.path().join("missing.pgr");
        std::os::unix::fs::symlink(&missing, workspace.path().join("dangling.pgr")).unwrap();
        assert!(checked_file_target(workspace.path(), Path::new("dangling.pgr")).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn snapshot_ignores_ntfs_junctions_and_file_targets_reject_them() {
        use std::process::Command;

        let workspace = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("outside.pgr"), "must not be loaded").unwrap();
        let junction = workspace.path().join("linked");
        let quote_path = |path: &Path| path.to_string_lossy().replace('\'', "''");
        let command = format!(
            "New-Item -ItemType Junction -Path '{}' -Target '{}' | Out-Null",
            quote_path(&junction),
            quote_path(outside.path())
        );
        let output = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &command,
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "Could not create junction: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );

        assert!(snapshot(workspace.path()).unwrap().files.is_empty());
        assert!(checked_file_target(workspace.path(), Path::new("linked/outside.pgr")).is_err());
    }

    #[test]
    fn import_preserves_malformed_utf8_source_text_and_export_writes_it_exactly() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("broken.pgr");
        let content = "## Unknown: keep editable\r\nraw: value\r\n";
        fs::write(&source, content).unwrap();
        let imported = read_import_file(&source).unwrap();
        assert_eq!(imported.name, "broken.pgr");
        assert_eq!(imported.content, content);

        let destination = temp.path().join("exported.pgr");
        export_file_to(&destination, &imported.content).unwrap();
        assert_eq!(fs::read_to_string(destination).unwrap(), content);
    }

    #[test]
    fn import_export_reject_non_pgr_and_export_keeps_unrelated_files() {
        let temp = tempfile::tempdir().unwrap();
        let text = temp.path().join("notes.txt");
        fs::write(&text, "unrelated").unwrap();
        assert!(read_import_file(&text).is_err());
        assert!(export_file_to(&text, "not allowed").is_err());
        assert_eq!(fs::read_to_string(text).unwrap(), "unrelated");
    }
}
