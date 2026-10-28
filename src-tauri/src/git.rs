//! Portable Git operations. Preview/commit preparation never rewrites the real index.
use serde::Serialize;
use std::collections::BTreeSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const DIFF_LIMIT: usize = 160_000;
const DIFF_LINE_LIMIT: usize = 2_000;

pub fn command() -> Command {
    let mut cmd = Command::new("git");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd.arg("--literal-pathspecs");
    // Do not accidentally operate on a different repository/index inherited from a launcher.
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_COMMON_DIR",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ] {
        cmd.env_remove(key);
    }
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(test)]
    {
        cmd.env("GIT_CONFIG_NOSYSTEM", "1");
        cmd.env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        );
    }
    cmd
}

fn checked(cmd: &mut Command) -> Result<Output, String> {
    let output = cmd
        .output()
        .map_err(|e| format!("Could not run Git: {e}. Is Git installed?"))?;
    if output.status.success() {
        Ok(output)
    } else {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        Err(if error.is_empty() {
            "Git operation failed.".into()
        } else {
            error
        })
    }
}

fn utf8(bytes: &[u8]) -> Result<String, String> {
    String::from_utf8(bytes.to_vec()).map_err(|_| {
        "This repository contains a non-UTF-8 filename, which GitPop cannot safely display yet."
            .into()
    })
}

#[derive(Debug, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub original_path: Option<String>,
    pub status: String,
    pub staged: bool,
    pub conflicted: bool,
}

#[derive(Debug, Default, Serialize)]
pub struct Repository {
    pub path: String,
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
    pub unborn: bool,
    pub files: Vec<FileStatus>,
}

fn parse_status(bytes: &[u8]) -> Result<Repository, String> {
    let mut repo = Repository::default();
    let mut records = bytes.split(|b| *b == 0).filter(|r| !r.is_empty());
    while let Some(record) = records.next() {
        let text = utf8(record)?;
        if let Some(value) = text.strip_prefix("# branch.head ") {
            repo.detached = value == "(detached)";
            repo.branch = if repo.detached {
                "Detached HEAD".into()
            } else {
                value.into()
            };
        } else if let Some(value) = text.strip_prefix("# branch.oid ") {
            repo.unborn = value == "(initial)";
        } else if let Some(value) = text.strip_prefix("# branch.upstream ") {
            repo.upstream = Some(value.into());
        } else if let Some(value) = text.strip_prefix("# branch.ab ") {
            let mut counts = value.split_whitespace();
            repo.ahead = counts
                .next()
                .and_then(|s| s.strip_prefix('+'))
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
            repo.behind = counts
                .next()
                .and_then(|s| s.strip_prefix('-'))
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);
        } else if let Some(path) = text.strip_prefix("? ") {
            repo.files.push(FileStatus {
                path: path.into(),
                original_path: None,
                status: "?".into(),
                staged: false,
                conflicted: false,
            });
        } else if matches!(record.first(), Some(b'1' | b'2' | b'u')) {
            let fields = match record[0] {
                b'1' => 9,
                b'2' => 10,
                _ => 11,
            };
            let parts: Vec<_> = text.splitn(fields, ' ').collect();
            if parts.len() != fields || parts[1].len() != 2 {
                return Err("Git returned an unexpected status record.".into());
            }
            let xy = parts[1].as_bytes();
            let conflicted = record[0] == b'u';
            let code = if conflicted {
                'U'
            } else if xy[0] != b'.' {
                xy[0] as char
            } else {
                xy[1] as char
            };
            let original_path = if record[0] == b'2' {
                Some(utf8(
                    records
                        .next()
                        .ok_or("Git returned an incomplete rename record.")?,
                )?)
            } else {
                None
            };
            repo.files.push(FileStatus {
                path: parts[fields - 1].into(),
                original_path,
                status: code.to_string(),
                staged: xy[0] != b'.',
                conflicted,
            });
        }
    }
    Ok(repo)
}

pub fn repository(path: &str) -> Result<Repository, String> {
    let root = checked(
        command()
            .current_dir(path)
            .args(["rev-parse", "--show-toplevel"]),
    )?;
    // Git appends one newline; do not trim spaces that belong to the directory name.
    let root_text = utf8(&root.stdout)?;
    let root = root_text
        .strip_suffix('\n')
        .unwrap_or(&root_text)
        .to_owned();
    let output = checked(command().current_dir(&root).args([
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=all",
    ]))?;
    let mut repo = parse_status(&output.stdout)?;
    repo.path = root;
    Ok(repo)
}

fn selection(repo: &Repository, files: &[String]) -> Result<Vec<String>, String> {
    if files.is_empty() {
        return Err("Select at least one changed file.".into());
    }
    let mut paths = BTreeSet::new();
    for path in files {
        let file = repo
            .files
            .iter()
            .find(|f| f.path == *path)
            .ok_or_else(|| format!("{path} is no longer changed. Refresh the repository."))?;
        if file.conflicted {
            return Err("Resolve merge conflicts before preparing a commit.".into());
        }
        paths.insert(file.path.clone());
        if let Some(old) = &file.original_path {
            paths.insert(old.clone());
        }
    }
    Ok(paths.into_iter().collect())
}

struct PreparedIndex {
    _directory: tempfile::TempDir,
    path: PathBuf,
    objects: Option<PathBuf>,
    alternates: Option<String>,
    pathspec: PathBuf,
}

impl PreparedIndex {
    fn command(&self, repo: &Repository) -> Command {
        let mut cmd = command();
        cmd.current_dir(&repo.path)
            .env("GIT_INDEX_FILE", &self.path);
        if let Some(objects) = &self.objects {
            cmd.env("GIT_OBJECT_DIRECTORY", objects);
        }
        if let Some(alternates) = &self.alternates {
            cmd.env("GIT_ALTERNATE_OBJECT_DIRECTORIES", alternates);
        }
        cmd
    }
}

fn prepare(
    repo: &Repository,
    paths: &[String],
    temporary_objects: bool,
) -> Result<PreparedIndex, String> {
    let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
    let (objects, alternates) = if temporary_objects {
        let output = checked(command().current_dir(&repo.path).args([
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "objects",
        ]))?;
        let path = utf8(&output.stdout)?;
        // Git accepts C-quoted entries, including directory names containing ':' or newlines.
        let alternates = serde_json::to_string(path.strip_suffix('\n').unwrap_or(&path))
            .map_err(|e| e.to_string())?;
        let objects = directory.path().join("objects");
        std::fs::create_dir(&objects).map_err(|e| e.to_string())?;
        (Some(objects), Some(alternates))
    } else {
        (None, None)
    };
    let index = PreparedIndex {
        path: directory.path().join("index"),
        pathspec: directory.path().join("paths"),
        _directory: directory,
        objects,
        alternates,
    };
    let paths: Vec<u8> = paths
        .iter()
        .flat_map(|path| path.as_bytes().iter().copied().chain(std::iter::once(0)))
        .collect();
    std::fs::write(&index.pathspec, paths).map_err(|e| e.to_string())?;
    let mut read = index.command(repo);
    read.arg("read-tree");
    read.arg(if repo.unborn { "--empty" } else { "HEAD" });
    checked(&mut read)?;
    checked(
        index
            .command(repo)
            .args([
                "add",
                "--all",
                "--pathspec-file-nul",
                "--pathspec-from-file",
            ])
            .arg(&index.pathspec),
    )?;
    Ok(index)
}

pub fn truncate_utf8(text: &mut String, limit: usize) -> bool {
    if text.len() <= limit {
        return false;
    }
    let mut boundary = limit;
    while !text.is_char_boundary(boundary) {
        boundary -= 1;
    }
    text.truncate(boundary);
    true
}

pub fn diff(path: &str, files: &[String]) -> Result<String, String> {
    let repo = repository(path)?;
    let paths = selection(&repo, files)?;
    for path in &paths {
        if std::fs::symlink_metadata(Path::new(&repo.path).join(path))
            .is_ok_and(|m| m.is_file() && m.len() > 8 * 1024 * 1024)
        {
            return Err("Preview omitted for files larger than 8 MiB. You can still commit them with your own message.".into());
        }
    }
    let index = prepare(&repo, &paths, true)?;
    // Drain stderr to a temporary file, not a pipe that could deadlock on large errors.
    let mut errors = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut child = index
        .command(&repo)
        .args([
            "diff",
            "--cached",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--stat",
            "--patch",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(errors.try_clone().map_err(|e| e.to_string())?)
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let read = child
        .stdout
        .take()
        .ok_or("Could not read Git output.")?
        .take((DIFF_LIMIT + 1) as u64)
        .read_to_end(&mut bytes);
    if let Err(error) = read {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error.to_string());
    }
    let mut truncated = bytes.len() > DIFF_LIMIT;
    if truncated {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    if !status.success() && !truncated {
        use std::io::{Seek, SeekFrom};
        errors.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut error = String::new();
        errors
            .take(8192)
            .read_to_string(&mut error)
            .map_err(|e| e.to_string())?;
        return Err(error);
    }
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if let Some((boundary, _)) = text.match_indices('\n').nth(DIFF_LINE_LIMIT - 1) {
        text.truncate(boundary);
        truncated = true;
    }
    if truncated {
        truncate_utf8(&mut text, DIFF_LIMIT);
        text.push_str(
            "\n\n[Preview truncated. The commit still includes the complete selected files.]",
        );
    }
    Ok(text)
}

pub fn commit(path: &str, message: &str, files: &[String]) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Write a commit message first, or request an AI suggestion.".into());
    }
    let repo = repository(path)?;
    if repo.files.iter().any(|f| f.conflicted) {
        return Err("Resolve merge conflicts before committing.".into());
    }
    let git_dir = checked(
        command()
            .current_dir(&repo.path)
            .args(["rev-parse", "--absolute-git-dir"]),
    )?;
    let git_dir = utf8(&git_dir.stdout)?;
    let git_dir = Path::new(git_dir.strip_suffix('\n').unwrap_or(&git_dir));
    if [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    ]
    .iter()
    .any(|name| git_dir.join(name).exists())
    {
        return Err("Finish the in-progress merge, rebase, cherry-pick, or revert in Git before committing selected files.".into());
    }
    let paths = selection(&repo, files)?;
    let index = prepare(&repo, &paths, false)?;
    checked(
        command()
            .current_dir(&repo.path)
            .env("GIT_INDEX_FILE", &index.path)
            .args(["commit", "-m", message]),
    )?;
    // The commit advanced HEAD. Reconcile only its selected paths in the real index;
    // unrelated staged work remains exactly as it was. No working-tree files are reset.
    if let Err(error) = checked(
        command()
            .current_dir(&repo.path)
            .args([
                "reset",
                "--quiet",
                "--pathspec-file-nul",
                "--pathspec-from-file",
            ])
            .arg(&index.pathspec)
            .arg("HEAD"),
    ) {
        return Err(format!("The commit was created, but the index could not be refreshed: {error}. Do not commit again; inspect `git status`."));
    }
    let output = checked(
        command()
            .current_dir(&repo.path)
            .args(["rev-parse", "--short", "HEAD"]),
    )?;
    Ok(String::from_utf8_lossy(&output.stdout).trim().into())
}

pub fn push(path: &str) -> Result<(), String> {
    let repo = repository(path)?;
    if repo.detached {
        return Err("Check out a branch before pushing.".into());
    }
    let mut cmd = command();
    cmd.current_dir(&repo.path).arg("push");
    if repo.upstream.is_none() {
        cmd.args(["--set-upstream", "origin"])
            .arg(format!("HEAD:refs/heads/{}", repo.branch));
    }
    checked(&mut cmd)?;
    Ok(())
}

pub fn init(path: &str, remote: Option<&str>) -> Result<(), String> {
    if !Path::new(path).is_dir() {
        return Err("Choose an existing folder first.".into());
    }
    if repository(path).is_ok() {
        return Err("This folder already belongs to a Git repository.".into());
    }
    checked(command().current_dir(path).args(["init"]))?;
    if let Some(url) = remote.map(str::trim).filter(|s| !s.is_empty()) {
        checked(
            command()
                .current_dir(path)
                .args(["remote", "add", "origin", url]),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        checked(
            command()
                .current_dir(dir.path())
                .args(["init", "-b", "main"]),
        )
        .unwrap();
        for pair in [
            ["user.name", "GitPop Test"],
            ["user.email", "test@example.invalid"],
            ["commit.gpgsign", "false"],
            ["core.autocrlf", "false"],
        ] {
            checked(
                command()
                    .current_dir(dir.path())
                    .args(["config", pair[0], pair[1]]),
            )
            .unwrap();
        }
        dir
    }
    fn seed(dir: &Path) {
        fs::write(dir.join("first.txt"), "before\n").unwrap();
        fs::write(dir.join("other.txt"), "before\n").unwrap();
        checked(command().current_dir(dir).args(["add", "."])).unwrap();
        checked(command().current_dir(dir).args(["commit", "-m", "initial"])).unwrap();
    }
    #[test]
    fn preview_preserves_index_and_unrelated_staging() {
        let dir = repo();
        seed(dir.path());
        fs::write(dir.path().join("first.txt"), "selected\n").unwrap();
        fs::write(dir.path().join("other.txt"), "staged\n").unwrap();
        checked(command().current_dir(dir.path()).args(["add", "other.txt"])).unwrap();
        let before = fs::read(dir.path().join(".git/index")).unwrap();
        let preview = diff(dir.path().to_str().unwrap(), &["first.txt".into()]).unwrap();
        assert!(preview.contains("+selected"));
        assert!(!preview.contains("+staged"));
        assert_eq!(before, fs::read(dir.path().join(".git/index")).unwrap());
    }

    #[test]
    fn preview_does_not_accumulate_objects_in_the_repository() {
        let dir = repo();
        seed(dir.path());
        fs::write(dir.path().join("new.txt"), "brand new contents\n").unwrap();
        let before = checked(
            command()
                .current_dir(dir.path())
                .args(["count-objects", "-v"]),
        )
        .unwrap()
        .stdout;
        diff(dir.path().to_str().unwrap(), &["new.txt".into()]).unwrap();
        let after = checked(
            command()
                .current_dir(dir.path())
                .args(["count-objects", "-v"]),
        )
        .unwrap()
        .stdout;
        assert_eq!(before, after);
    }

    #[test]
    fn large_selections_do_not_depend_on_os_command_line_limits() {
        let dir = repo();
        let names: Vec<_> = (0..1000)
            .map(|number| format!("long_file_name_{number:04}_for_native_batch.txt"))
            .collect();
        assert!(names.iter().map(String::len).sum::<usize>() > 32767);
        for name in &names {
            fs::write(dir.path().join(name), "contents\n").unwrap();
        }
        commit(dir.path().to_str().unwrap(), "large selection", &names).unwrap();
        assert!(repository(dir.path().to_str().unwrap())
            .unwrap()
            .files
            .is_empty());
    }

    #[test]
    fn linked_worktrees_use_their_own_index() {
        let dir = repo();
        seed(dir.path());
        let worktrees = tempfile::tempdir().unwrap();
        let linked = worktrees.path().join("linked");
        checked(
            command()
                .current_dir(dir.path())
                .args(["worktree", "add", "-b", "linked-test"])
                .arg(&linked),
        )
        .unwrap();
        fs::write(linked.join("first.txt"), "linked changes\n").unwrap();
        assert!(diff(linked.to_str().unwrap(), &["first.txt".into()])
            .unwrap()
            .contains("+linked changes"));
        commit(
            linked.to_str().unwrap(),
            "linked commit",
            &["first.txt".into()],
        )
        .unwrap();
        assert!(repository(linked.to_str().unwrap())
            .unwrap()
            .files
            .is_empty());
        assert_eq!(
            fs::read_to_string(dir.path().join("first.txt")).unwrap(),
            "before\n"
        );
    }

    #[test]
    fn failed_git_commit_preserves_real_index_and_head() {
        let dir = repo();
        seed(dir.path());
        fs::write(dir.path().join("first.txt"), "selected\n").unwrap();
        fs::write(dir.path().join("other.txt"), "unrelated staged\n").unwrap();
        checked(command().current_dir(dir.path()).args(["add", "other.txt"])).unwrap();
        // A nonexistent signing program deterministically fails after preparation on all OSes.
        checked(
            command()
                .current_dir(dir.path())
                .args(["config", "commit.gpgsign", "true"]),
        )
        .unwrap();
        checked(command().current_dir(dir.path()).args([
            "config",
            "gpg.program",
            "gitpop-test-nonexistent-signing-program",
        ]))
        .unwrap();
        let before = fs::read(dir.path().join(".git/index")).unwrap();
        let head = checked(
            command()
                .current_dir(dir.path())
                .args(["rev-parse", "HEAD"]),
        )
        .unwrap()
        .stdout;
        assert!(commit(
            dir.path().to_str().unwrap(),
            "should fail",
            &["first.txt".into()]
        )
        .is_err());
        assert_eq!(before, fs::read(dir.path().join(".git/index")).unwrap());
        assert_eq!(
            head,
            checked(
                command()
                    .current_dir(dir.path())
                    .args(["rev-parse", "HEAD"])
            )
            .unwrap()
            .stdout
        );
    }
    #[test]
    fn commit_preserves_unrelated_staged_work() {
        let dir = repo();
        seed(dir.path());
        fs::write(dir.path().join("first.txt"), "selected\n").unwrap();
        fs::write(dir.path().join("other.txt"), "staged\n").unwrap();
        checked(command().current_dir(dir.path()).args(["add", "other.txt"])).unwrap();
        commit(
            dir.path().to_str().unwrap(),
            "selected only",
            &["first.txt".into()],
        )
        .unwrap();
        let content = checked(
            command()
                .current_dir(dir.path())
                .args(["show", "HEAD:other.txt"]),
        )
        .unwrap();
        assert_eq!(content.stdout, b"before\n");
        let repo = repository(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(repo.files.len(), 1);
        assert_eq!(repo.files[0].path, "other.txt");
        assert!(repo.files[0].staged);
    }
    #[test]
    fn initial_commit_and_literal_unicode_filenames() {
        let dir = repo();
        let mut names = vec![" spaced è.txt", "brackets[1].txt", "-option.txt"];
        if cfg!(unix) {
            names.extend([" trailing.txt ", ":(glob)*.txt", "line\nbreak.txt"]);
        }
        for name in names {
            fs::write(dir.path().join(name), "hello\n").unwrap();
            // Use Git's filename spelling, including filesystem Unicode normalization on macOS.
            let selected = repository(dir.path().to_str().unwrap()).unwrap().files[0]
                .path
                .clone();
            let text = diff(
                dir.path().to_str().unwrap(),
                std::slice::from_ref(&selected),
            )
            .unwrap();
            assert!(text.contains("+hello"));
            commit(
                dir.path().to_str().unwrap(),
                "add literal file",
                &[selected],
            )
            .unwrap();
        }
        assert!(repository(dir.path().to_str().unwrap())
            .unwrap()
            .files
            .is_empty());
    }
    #[test]
    fn staged_rename_includes_old_path() {
        let dir = repo();
        seed(dir.path());
        checked(
            command()
                .current_dir(dir.path())
                .args(["mv", "first.txt", "renamed.txt"]),
        )
        .unwrap();
        let status = repository(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(status.files[0].original_path.as_deref(), Some("first.txt"));
        commit(
            dir.path().to_str().unwrap(),
            "rename",
            &["renamed.txt".into()],
        )
        .unwrap();
        assert!(repository(dir.path().to_str().unwrap())
            .unwrap()
            .files
            .is_empty());
    }
    #[test]
    fn failed_commit_preserves_index() {
        let dir = repo();
        seed(dir.path());
        fs::write(dir.path().join("first.txt"), "change\n").unwrap();
        let before = fs::read(dir.path().join(".git/index")).unwrap();
        assert!(commit(dir.path().to_str().unwrap(), "", &["first.txt".into()]).is_err());
        assert!(commit(dir.path().to_str().unwrap(), "bad", &["missing.txt".into()]).is_err());
        assert_eq!(before, fs::read(dir.path().join(".git/index")).unwrap());
    }
    #[test]
    fn selected_file_includes_worktree_and_staged_content() {
        let dir = repo();
        seed(dir.path());
        fs::write(dir.path().join("first.txt"), "staged\n").unwrap();
        checked(command().current_dir(dir.path()).args(["add", "first.txt"])).unwrap();
        fs::write(dir.path().join("first.txt"), "latest worktree\n").unwrap();
        let preview = diff(dir.path().to_str().unwrap(), &["first.txt".into()]).unwrap();
        assert!(preview.contains("+latest worktree"));
        commit(
            dir.path().to_str().unwrap(),
            "whole file",
            &["first.txt".into()],
        )
        .unwrap();
        assert!(repository(dir.path().to_str().unwrap())
            .unwrap()
            .files
            .is_empty());
    }
    #[test]
    fn deletion_can_be_previewed_and_committed() {
        let dir = repo();
        seed(dir.path());
        fs::remove_file(dir.path().join("first.txt")).unwrap();
        assert!(diff(dir.path().to_str().unwrap(), &["first.txt".into()])
            .unwrap()
            .contains("deleted file"));
        commit(
            dir.path().to_str().unwrap(),
            "delete",
            &["first.txt".into()],
        )
        .unwrap();
        assert!(repository(dir.path().to_str().unwrap())
            .unwrap()
            .files
            .is_empty());
    }
    #[test]
    fn status_parses_headers_and_conflicts() {
        let repo = parse_status(b"# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +3 -2\0u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted file\0").unwrap();
        assert_eq!((repo.ahead, repo.behind), (3, 2));
        assert_eq!(repo.upstream.as_deref(), Some("origin/main"));
        assert!(repo.files[0].conflicted);
        assert_eq!(repo.files[0].path, "conflicted file");
    }
    #[test]
    fn unicode_truncation_never_panics() {
        for limit in 0..12 {
            let mut text = "€😀èabc".to_owned();
            truncate_utf8(&mut text, limit);
            assert!(text.len() <= limit);
        }
    }
    #[test]
    fn preview_is_bounded() {
        let dir = repo();
        fs::write(dir.path().join("large.txt"), "a".repeat(DIFF_LIMIT * 2)).unwrap();
        let text = diff(dir.path().to_str().unwrap(), &["large.txt".into()]).unwrap();
        assert!(text.contains("Preview truncated"));
        assert!(text.len() < DIFF_LIMIT + 120);
    }

    #[test]
    fn preview_line_count_is_bounded_for_fast_rendering() {
        let dir = repo();
        fs::write(dir.path().join("lines.txt"), "line\n".repeat(10_000)).unwrap();
        let text = diff(dir.path().to_str().unwrap(), &["lines.txt".into()]).unwrap();
        assert!(text.contains("Preview truncated"));
        assert!(text.lines().count() <= DIFF_LINE_LIMIT + 3);
    }

    #[test]
    fn refuses_in_progress_merge_without_touching_index() {
        let dir = repo();
        seed(dir.path());
        fs::write(dir.path().join("first.txt"), "change\n").unwrap();
        fs::write(dir.path().join(".git/MERGE_HEAD"), "placeholder\n").unwrap();
        let before = fs::read(dir.path().join(".git/index")).unwrap();
        assert!(commit(
            dir.path().to_str().unwrap(),
            "not a merge",
            &["first.txt".into()]
        )
        .unwrap_err()
        .contains("in-progress"));
        assert_eq!(before, fs::read(dir.path().join(".git/index")).unwrap());
    }

    #[test]
    fn resolves_subfolders_and_detached_head() {
        let dir = repo();
        seed(dir.path());
        fs::create_dir(dir.path().join("subfolder")).unwrap();
        let root = repository(dir.path().to_str().unwrap()).unwrap().path;
        assert_eq!(
            repository(dir.path().join("subfolder").to_str().unwrap())
                .unwrap()
                .path,
            root
        );
        checked(
            command()
                .current_dir(dir.path())
                .args(["checkout", "--detach"]),
        )
        .unwrap();
        assert!(repository(&root).unwrap().detached);
        assert!(push(&root).unwrap_err().contains("branch"));
    }

    #[test]
    fn initial_publish_uses_explicit_branch_and_sets_upstream() {
        let dir = repo();
        seed(dir.path());
        let remote = tempfile::tempdir().unwrap();
        checked(
            command()
                .current_dir(remote.path())
                .args(["init", "--bare"]),
        )
        .unwrap();
        checked(
            command()
                .current_dir(dir.path())
                .args(["remote", "add", "origin"])
                .arg(remote.path()),
        )
        .unwrap();
        push(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(
            repository(dir.path().to_str().unwrap())
                .unwrap()
                .upstream
                .as_deref(),
            Some("origin/main")
        );
    }
}
