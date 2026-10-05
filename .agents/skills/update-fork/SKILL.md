---
name: update-fork
description: Update local main from a remote named fork after a security-focused diff review. Use when the user asks to update local main from fork or explicitly requests update-fork. Do not use for general rebase help.
---

## Goal

Update the repository from the `fork` remote only after checking the incoming changes for compromised code.

## Workflow

### Step 1: Preflight

1. Confirm the current directory is inside a Git repository:

   ```bash
   git rev-parse --show-toplevel
   ```

2. Check for a remote named `fork`:

   ```bash
   git remote get-url fork
   ```

   If this fails, stop. Tell the user the repo has no `fork` remote and do not continue.

3. Require a clean worktree before switching branches or rebasing:

   ```bash
   git status --short
   ```

   If this prints anything, stop and ask the user to commit or stash first.

4. Determine the local main branch. Prefer the origin default branch, then fall back to `main`:

   ```bash
   main_branch="$(
     git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true
   )"
   main_branch="${main_branch#origin/}"
   test -n "$main_branch" || main_branch=main
   ```

### Step 2: Fetch remotes and prepare local refs

1. Fetch both `origin` and `fork` together:

   ```bash
   git fetch --prune origin && git fetch --prune fork
   ```

   If this fails because the agent environment cannot access the remotes, stop and ask the user to run this single copy-paste command. When the user confirms it succeeded, continue from the locally fetched refs without fetching again. If the user says the command failed, stop and ask them to fix remote access:

   ```bash
   git fetch --prune origin && git fetch --prune fork
   ```

   Do not ask for separate origin and fork fetches in multiple turns.

2. Determine the `fork` default branch from local refs first, then fall back to `ls-remote`, then the local main branch:

   ```bash
   fork_branch="$(
     git symbolic-ref --short refs/remotes/fork/HEAD 2>/dev/null || true
   )"
   fork_branch="${fork_branch#fork/}"
   if test -z "$fork_branch"
   then
     fork_branch="$(
       git ls-remote --symref fork HEAD 2>/dev/null |
         awk '/^ref:/ {
           sub("refs/heads/", "", $2)
           print $2
           exit
         }' || true
     )"
   fi
   test -n "$fork_branch" || fork_branch="$main_branch"
   ```

3. Switch to the local main branch and fast-forward it from the already fetched `origin/$main_branch` ref:

   ```bash
   git switch "$main_branch"
   git merge --ff-only "origin/$main_branch"
   ```

   If the local origin ref is missing or this fails, stop and ask the user to run this single copy-paste command, then rerun the skill:

   ```bash
   git fetch --prune origin && git fetch --prune fork && git switch <main-branch> && git pull --ff-only origin <main-branch>
   ```
### Step 3: Review incoming changes for compromised code

Review the changes from the current local main branch to `fork/$fork_branch`. First inspect the whole diff, then inspect interesting files in detail.

Use these commands as the starting point:

```bash
git diff --stat "HEAD..fork/$fork_branch"
git diff --name-status "HEAD..fork/$fork_branch"
git diff --find-renames --find-copies --submodule=diff "HEAD..fork/$fork_branch"
```

If the full diff is too large for one response, save it and inspect it in chunks. Do not rely only on the stat or file list.

```bash
mkdir -p /tmp/pi/update-fork
git diff --find-renames --find-copies --submodule=diff "HEAD..fork/$fork_branch" > /tmp/pi/update-fork/incoming.diff
```

Look closely at:

- Package manifests and lockfiles: `package.json`, lockfiles, `pyproject.toml`, `requirements*.txt`, `setup.py`, `Cargo.toml`, `Cargo.lock`, `go.mod`, `go.sum`, `Gemfile`, `composer.json`
- Install and release hooks: `preinstall`, `postinstall`, `prepare`, release scripts, CI workflows, Dockerfiles, shell scripts
- Code that touches network, process execution, dynamic evaluation, environment variables, secrets, auth, crypto, filesystem writes, downloads, or plugin loading
- Newly added generated files, vendored files, minified files, binaries, or files with unusual entropy
- New dependencies, renamed dependencies, git or tarball dependencies, package names that look like typos, and dependencies that are unknown or have little visible ecosystem trust
- URLs, IP addresses, telemetry endpoints, download endpoints, paste sites, short links, and newly introduced domains

Search the diff and changed files for suspicious patterns, then read the surrounding files:

```bash
rg -n "curl|wget|Invoke-WebRequest|http://|https://|base64|atob|eval|Function\(|child_process|exec\(|spawn\(|postinstall|preinstall|prepare|chmod|ssh|npmrc|token|secret|password|process\.env" /tmp/pi/update-fork/incoming.diff
```

Use the `ast-grep` skill for structural call searches when text search is too noisy. Use the `trusted-zone-web-search-skill`, not a subagent, when package reputation, typosquatting, or URL ownership needs current online verification.

Treat these as critical until proven benign:

- Secret or token exfiltration
- Download and execution of remote code
- Obfuscated payloads, encoded scripts, or unexpected minified runtime code
- Malicious lifecycle hooks or CI steps
- Typosquatting, dependency confusion, or attacker-controlled package sources
- Auth bypasses, persistence, cryptominers, destructive file operations, or backdoors
- New hardcoded credentials or suspicious production endpoints

If you find a critical issue, stop. Report the exact files, snippets, commit range, why it is critical, and what the user should avoid doing.

If a finding might be critical and cannot be resolved confidently, stop and ask the user. Do not rebase.

### Step 4: Rebase main with fork

Proceed only when no critical security issue is found.

Check whether the rebase should be a fast-forward:

```bash
if git merge-base --is-ancestor HEAD "fork/$fork_branch"
then
  fast_forward=yes
else
  fast_forward=no
fi
```

Rebase the local main branch with the fork branch:

```bash
git rebase "fork/$fork_branch"
```

If the rebase conflicts, resolve them by best effort and continue. Do not stop solely because conflicts occurred.

- Preserve intentional local functionality while integrating incoming fixes and features.
- Inspect both sides and the original local commit before resolving each conflict. Do not choose one entire side when that would discard unrelated changes.
- Keep released changelog sections unchanged and merge local entries into Unreleased.
- Resolve dependency manifests first, then regenerate lockfile metadata without unrelated dependency upgrades.
- Stage only the resolved files and run `GIT_EDITOR=true git rebase --continue`. Repeat until the rebase finishes.
- Skip a commit only when its behavior is already present and the commit has no remaining changes to preserve.
- Run the required checks after the completed non-fast-forward rebase and fix integration failures. Summarize resolutions and any remaining caveats at the end.

Do not use destructive Git commands to force progress. Security review blockers still follow Step 3.

If `fast_forward=yes`, do not run tests, linters, type checks, or other project checks. For a non-fast-forward rebase, follow repo instructions or ask the user before running checks.

### Step 5: Summarize and ask for push

Summarize:

- `fork` remote URL and reviewed range
- Branches used: local main branch and `fork` branch
- Security review result, including suspicious items checked
- Rebase result and whether it was a fast-forward
- Any unresolved caveats

Ask the user to push directly afterwards. Do not push unless the user explicitly asks.

For a fast-forward or normal push, suggest:

```bash
git push origin <main-branch>
```

If the rebase replayed commits and Git rejects the normal push as non-fast-forward, tell the user to inspect the situation and use this only when they intend to update their fork history:

```bash
git push --force-with-lease origin <main-branch>
```
