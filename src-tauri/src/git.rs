use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitEntry {
    pub hash: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub available: bool,
    pub branch: String,
    pub dirty_files: Vec<String>,
    pub commits: Vec<GitCommitEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranches {
    pub branches: Vec<String>,
    pub current: String,
}

fn run(root: &Path, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Git is a console program. Do not create a visible console for every
        // status/branch/log operation launched by the desktop app.
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    command
        .output()
        .map_err(|e| format!("Unable to start Git: {e}"))
}

fn checked(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = run(root, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn initialize_default(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    if !root.join(".git").exists() {
        checked(root, &["init", "--initial-branch=main"])?;
        let _ = checked(root, &["config", "user.name", "Planager"]);
        let _ = checked(root, &["config", "user.email", "planager@local"]);
    }
    Ok(())
}

pub fn status(root: &Path) -> Result<GitStatus, String> {
    let inside = run(root, &["rev-parse", "--is-inside-work-tree"])?;
    if !inside.status.success() {
        return Ok(GitStatus {
            available: false,
            branch: String::new(),
            dirty_files: Vec::new(),
            commits: Vec::new(),
        });
    }
    let branch = checked(root, &["branch", "--show-current"])?;
    let dirty = checked(root, &["status", "--porcelain", "--untracked-files=all"])?;
    let dirty_files = dirty
        .lines()
        .filter_map(|line| line.get(3..).map(str::trim).map(str::to_string))
        .collect();
    let log = checked(root, &["log", "-30", "--format=%H%x1f%s%x1f%cI"])?;
    let commits = log
        .lines()
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\u{1f}');
            Some(GitCommitEntry {
                hash: parts.next()?.to_string(),
                message: parts.next()?.to_string(),
                timestamp: parts.next()?.to_string(),
            })
        })
        .collect();
    Ok(GitStatus {
        available: true,
        branch,
        dirty_files,
        commits,
    })
}

pub fn branches(root: &Path) -> Result<GitBranches, String> {
    let text = checked(root, &["branch", "--list", "--format=%(refname:short)"])?;
    let current = checked(root, &["branch", "--show-current"])?;
    Ok(GitBranches {
        branches: text
            .lines()
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect(),
        current,
    })
}

fn valid_ref(root: &Path, branch: &str) -> Result<(), String> {
    if branch.is_empty() || branch.len() > 200 || branch.starts_with('-') || branch.contains('\0') {
        return Err("Invalid branch name".into());
    }
    checked(root, &["check-ref-format", "--branch", branch]).map(|_| ())
}

pub fn checkout(root: &Path, branch: &str) -> Result<GitStatus, String> {
    valid_ref(root, branch)?;
    checked(root, &["switch", branch])?;
    status(root)
}

pub fn create_branch(root: &Path, branch: &str) -> Result<GitStatus, String> {
    valid_ref(root, branch)?;
    checked(root, &["switch", "-c", branch])?;
    status(root)
}

pub fn commit(root: &Path, message: &str) -> Result<GitStatus, String> {
    let message = message.trim();
    if message.is_empty() || message.len() > 500 || message.contains('\0') {
        return Err("Commit message must contain 1 to 500 characters".into());
    }
    let mut paths = HashSet::<String>::new();
    let output = run(root, &["ls-files", "-z"])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    for path in output.stdout.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        let path = String::from_utf8_lossy(path).replace('\\', "/");
        if path == ".planager.json" || path.to_ascii_lowercase().ends_with(".pgr") {
            paths.insert(path);
        }
    }
    let mut current = Vec::new();
    let mut dirs = Vec::new();
    crate::workspace::walk_pgr(root, root, &mut current, &mut dirs)?;
    paths.extend(current);
    paths.insert(".planager.json".into());
    let owned = paths.into_iter().collect::<Vec<_>>();
    let pathspecs = owned
        .iter()
        .map(|path| format!(":(literal){path}"))
        .collect::<Vec<_>>();
    let mut args = vec!["add".to_string(), "-A".into(), "--".into()];
    args.extend(pathspecs.iter().cloned());
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run(root, &refs)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let mut commit_args = vec![
        "commit".to_string(),
        "-m".into(),
        message.to_string(),
        "--".into(),
    ];
    commit_args.extend(pathspecs);
    let refs = commit_args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run(root, &refs)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    status(root)
}

pub fn diff(root: &Path, base: &str, path: Option<&str>) -> Result<String, String> {
    if base.is_empty() || base.len() > 200 || base.starts_with('-') || base.contains('\0') {
        return Err("Invalid Git diff base".into());
    }
    checked(root, &["rev-parse", "--verify", base])?;
    let mut args = vec![
        "diff".to_string(),
        "--no-ext-diff".into(),
        base.into(),
        "--".into(),
    ];
    if let Some(path) = path {
        let relative = crate::workspace::validate_relative(path)?;
        if relative
            .extension()
            .is_none_or(|ext| !ext.eq_ignore_ascii_case("pgr"))
            && relative.to_string_lossy() != ".planager.json"
        {
            return Err("Git diff is limited to .pgr workspace files".into());
        }
        args.push(relative.to_string_lossy().into_owned());
    } else {
        args.push("*.pgr".into());
        args.push(".planager.json".into());
    }
    let refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    checked(root, &refs)
}

fn git_paths(root: &Path, args: &[&str]) -> Result<HashSet<PathBuf>, String> {
    let output = run(root, args)?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(output
        .stdout
        .split(|b| *b == 0)
        .filter(|p| !p.is_empty())
        .filter_map(|p| {
            let name = String::from_utf8(p.to_vec()).ok()?;
            (name == ".planager.json" || name.to_ascii_lowercase().ends_with(".pgr"))
                .then(|| PathBuf::from(name))
        })
        .collect())
}

pub fn restore(root: &Path, hash: &str) -> Result<GitStatus, String> {
    restore_with(root, hash, |relative, hash| {
        let path = relative.to_str().ok_or("Invalid path")?;
        checked(
            root,
            &["restore", "--source", hash, "--worktree", "--", path],
        )?;
        Ok(())
    })
}

fn restore_with<F>(root: &Path, hash: &str, mut restore_file: F) -> Result<GitStatus, String>
where
    F: FnMut(&Path, &str) -> Result<(), String>,
{
    if hash.is_empty() || hash.len() > 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid commit hash".into());
    }
    checked(root, &["rev-parse", "--verify", hash])?;
    let target = git_paths(root, &["ls-tree", "-r", "-z", "--name-only", hash])?;
    let tracked = git_paths(root, &["ls-files", "-z"])?;
    let to_delete = tracked
        .difference(&target)
        .map(|path| {
            let relative = crate::workspace::validate_relative(&path.to_string_lossy())?;
            let full = crate::workspace::checked_file_target(root, &relative)?;
            Ok((relative, full))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let to_restore = target
        .iter()
        .map(|path| {
            let relative = crate::workspace::validate_relative(&path.to_string_lossy())?;
            let full = crate::workspace::checked_file_target(root, &relative)?;
            Ok((relative, full))
        })
        .collect::<Result<Vec<_>, String>>()?;
    restore_files_transactionally(root, &to_delete, &to_restore, |relative| {
        restore_file(relative, hash)
    })?;
    status(root)
}

fn restore_files_transactionally<F>(
    root: &Path,
    to_delete: &[(PathBuf, PathBuf)],
    to_restore: &[(PathBuf, PathBuf)],
    mut restore_file: F,
) -> Result<(), String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    let backup_root = root.join(format!(".planager-git-restore-{}", Uuid::new_v4()));
    fs::create_dir(&backup_root).map_err(|error| error.to_string())?;
    let mut backups = Vec::<(PathBuf, Option<PathBuf>)>::new();

    for (relative, full) in to_delete.iter().chain(to_restore) {
        match fs::symlink_metadata(full) {
            Ok(_) => {
                let backup = backup_root.join(relative);
                if let Some(parent) = backup.parent() {
                    if let Err(error) = fs::create_dir_all(parent) {
                        let rollback = rollback_restore_files(&backup_root, &backups);
                        return Err(restore_error(error.to_string(), rollback));
                    }
                }
                if let Err(error) = fs::rename(full, &backup) {
                    let rollback = rollback_restore_files(&backup_root, &backups);
                    return Err(restore_error(error.to_string(), rollback));
                }
                backups.push((full.clone(), Some(backup)));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                backups.push((full.clone(), None));
            }
            Err(error) => {
                let rollback = rollback_restore_files(&backup_root, &backups);
                return Err(restore_error(error.to_string(), rollback));
            }
        }
    }

    for (relative, _) in to_restore {
        if let Err(error) = restore_file(relative) {
            let rollback = rollback_restore_files(&backup_root, &backups);
            return Err(restore_error(error, rollback));
        }
    }

    fs::remove_dir_all(&backup_root).map_err(|error| {
        format!(
            "Git restore completed, but its recovery directory could not be removed ({}): {error}",
            backup_root.display()
        )
    })
}

fn rollback_restore_files(
    backup_root: &Path,
    backups: &[(PathBuf, Option<PathBuf>)],
) -> Result<(), String> {
    let mut errors = Vec::new();
    for (full, backup) in backups.iter().rev() {
        match fs::symlink_metadata(full) {
            Ok(_) => {
                if let Err(error) = fs::remove_file(full) {
                    errors.push(format!("could not remove {}: {error}", full.display()));
                    continue;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                errors.push(format!("could not inspect {}: {error}", full.display()));
                continue;
            }
        }
        if let Some(backup) = backup {
            if let Some(parent) = full.parent() {
                if let Err(error) = fs::create_dir_all(parent) {
                    errors.push(format!("could not recreate {}: {error}", parent.display()));
                    continue;
                }
            }
            if let Err(error) = fs::rename(backup, full) {
                errors.push(format!("could not restore {}: {error}", full.display()));
            }
        }
    }
    if errors.is_empty() {
        fs::remove_dir_all(backup_root).map_err(|error| error.to_string())
    } else {
        Err(format!(
            "rollback incomplete; recovery files remain in {}: {}",
            backup_root.display(),
            errors.join("; ")
        ))
    }
}

fn restore_error(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => format!("Git restore failed and workspace was rolled back: {error}"),
        Err(rollback_error) => format!("Git restore failed: {error}; {rollback_error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(root: &Path, args: &[&str]) {
        let output = run(root, args).unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn real_git_branch_diff_commit_and_safe_restore() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        git(root, &["init", "--initial-branch=main"]);
        git(root, &["config", "user.name", "Planager Test"]);
        git(root, &["config", "user.email", "planager-test@local"]);
        fs::write(root.join("model.pgr"), "version one\n").unwrap();
        fs::write(root.join("README.source"), "preserve\n").unwrap();
        git(root, &["add", "--", "README.source"]);
        crate::workspace::save(
            root,
            vec![
                crate::workspace::WorkspaceFile {
                    path: "model.pgr".into(),
                    content: "version one\n".into(),
                },
                crate::workspace::WorkspaceFile {
                    path: "nested/model.pgr".into(),
                    content: "nested version one\n".into(),
                },
            ],
            vec![],
            Default::default(),
        )
        .unwrap();
        let first = commit(root, "initial model").unwrap();
        assert_eq!(
            checked(root, &["diff", "--cached", "--name-only"]).unwrap(),
            "README.source"
        );
        let first_hash = first.commits[0].hash.clone();
        let branch = create_branch(root, "feature/native").unwrap();
        assert_eq!(branch.branch, "feature/native");
        crate::workspace::save(
            root,
            vec![
                crate::workspace::WorkspaceFile {
                    path: "model.pgr".into(),
                    content: "version two\n".into(),
                },
                crate::workspace::WorkspaceFile {
                    path: "nested/model.pgr".into(),
                    content: "nested version two\n".into(),
                },
            ],
            vec![],
            Default::default(),
        )
        .unwrap();
        let second = commit(root, "change model").unwrap();
        assert!(second.commits[0].hash != first_hash);
        assert!(diff(root, &first_hash, Some("model.pgr"))
            .unwrap()
            .contains("version two"));
        restore(root, &first_hash).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("model.pgr"))
                .unwrap()
                .replace("\r\n", "\n"),
            "version one\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("nested/model.pgr"))
                .unwrap()
                .replace("\r\n", "\n"),
            "nested version one\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("README.source")).unwrap(),
            "preserve\n"
        );
        assert_eq!(
            checked(root, &["diff", "--cached", "--name-only"]).unwrap(),
            "README.source"
        );
        assert!(branches(root)
            .unwrap()
            .branches
            .contains(&"feature/native".into()));
    }

    #[test]
    fn failed_restore_rolls_back_every_workspace_file() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        git(root, &["init", "--initial-branch=main"]);
        git(root, &["config", "user.name", "Planager Test"]);
        git(root, &["config", "user.email", "planager-test@local"]);
        fs::write(root.join("model.pgr"), "version one\n").unwrap();
        git(root, &["add", "--", "model.pgr"]);
        git(root, &["commit", "-m", "initial"]);
        let first_hash = checked(root, &["rev-parse", "HEAD"]).unwrap();

        fs::write(root.join("model.pgr"), "working tree version\n").unwrap();
        fs::write(root.join("added.pgr"), "added after snapshot\n").unwrap();
        git(root, &["add", "--", "model.pgr", "added.pgr"]);
        git(root, &["commit", "-m", "later"]);

        let error = restore_with(root, &first_hash, |relative, _| {
            fs::write(root.join(relative), "partially restored\n").map_err(|e| e.to_string())?;
            Err("simulated Git restore failure".into())
        })
        .unwrap_err();

        assert!(error.contains("workspace was rolled back"));
        assert_eq!(
            fs::read_to_string(root.join("model.pgr")).unwrap(),
            "working tree version\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("added.pgr")).unwrap(),
            "added after snapshot\n"
        );
        assert!(!fs::read_dir(root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".planager-git-restore-")));
    }

    #[cfg(unix)]
    #[test]
    fn restore_refuses_to_follow_a_linked_workspace_directory() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("workspace");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        git(&root, &["init", "--initial-branch=main"]);
        git(&root, &["config", "user.name", "Planager Test"]);
        git(&root, &["config", "user.email", "planager-test@local"]);
        crate::workspace::save(
            &root,
            vec![crate::workspace::WorkspaceFile {
                path: "nested/model.pgr".into(),
                content: "inside workspace\n".into(),
            }],
            vec![],
            Default::default(),
        )
        .unwrap();
        let commit = commit(&root, "initial nested model").unwrap();
        let hash = commit.commits[0].hash.clone();

        fs::remove_file(root.join("nested/model.pgr")).unwrap();
        fs::remove_dir(root.join("nested")).unwrap();
        fs::write(outside.join("model.pgr"), "outside data\n").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("nested")).unwrap();

        assert!(restore(&root, &hash).is_err());
        assert_eq!(
            fs::read_to_string(outside.join("model.pgr")).unwrap(),
            "outside data\n"
        );
    }
}
