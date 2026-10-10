# Security Incident Runbook: ARGUS Secret & PII Scrubbing

> **CRITICAL NOTICE FOR REPOSITORY OWNER:**
> **Do NOT run these history-rewriting steps automatically.**
> This runbook is prepared for the repository owner to execute manually. Per the security policy, AI assistants are strictly forbidden from rewriting git history or force-pushing.

---

## 1. Incident Summary

During the Phase 0 Security Audit, sensitive tokens and personally identifiable information (PII) were identified in public commits and tracked files:

| Type | Target Description | Introduced In Commit | Prior Locations |
| :--- | :--- | :--- | :--- |
| **Secret Token** | Compromised 32-byte `ARGUS_SECRET` | `e018680`, `00ac76f` | `README.md:131`, `setup.bat:88` |
| **Personal Phone** | Real phone number default | `e3a692e` | `setup.bat:73`, `README.md:221`, `backend/test_all_features.py:54` |
| **Student ID** | Real academic student ID | Early commits | `README.md:64`, `bridge/src/selfChat.ts:1193`, `backend/groq_client.py:437` |

While these items have been replaced with placeholders in the working tree on branch `phase-0-security`, git history still contains the historical diffs.

---

## 2. Mandatory Step 1: Rotate Secret in Local `.env`

Before touching git history, generate and set a completely new secret in your local runtime files. **The old secret is compromised and must be treated as public.**

Generate a fresh 32-byte hexadecimal secret:

```bash
# On Linux / macOS / Git Bash:
openssl rand -hex 32

# On Windows PowerShell or Command Prompt:
python -c "import secrets; print(secrets.token_hex(32))"
```

Update both configuration files immediately:
* `backend/.env` -> `ARGUS_SECRET=<new_secret>`
* `bridge/.env` -> `ARGUS_SECRET=<new_secret>`

---

## 3. Step 2: Full Repository Backup

Rewriting git history is destructive and irreversible. Create a bare mirror backup before proceeding:

```bash
cd ..
git clone --mirror ARGUS ARGUS-backup.git
cd ARGUS
```

---

## 4. Step 3: History Rewrite using `git-filter-repo`

We use [`git-filter-repo`](https://github.com/newren/git-filter-repo) (the officially recommended tool by the Git project, superseding `git filter-branch`).

### A. Install `git-filter-repo`
```bash
pip install git-filter-repo
```

### B. Create Text Replacement Mapping
Create a temporary file named `replace_secrets.txt` in the repository root (fill in the exact compromised string from your git history):

```text
<OLD_COMPROMISED_HEX_SECRET>==>change-me-generate-with-openssl-rand-hex-32
<OLD_PHONE_NUMBER>==>919876543210
<OLD_STUDENT_ID>==>ABC123XYZ
```

### C. Run `git-filter-repo`
Execute the history replacement across all commits, branches, and tags:

```bash
git filter-repo --replace-text replace_secrets.txt --force
```

### D. Verify Clean History
Verify that the published secret string no longer exists in any commit diff:

```bash
git log -S "<OLD_COMPROMISED_HEX_SECRET>" --all --oneline
```
*(This command must return zero lines.)*

Remove the temporary mapping file:
```bash
rm replace_secrets.txt
```

---

## 5. Step 4: Force-Push to Remote

`git-filter-repo` removes remote URLs as a safety safeguard. Re-add your remote and force-push rewritten branches and tags:

```bash
git remote add origin <your-git-remote-url>
git push origin --force --all
git push origin --force --tags
```

---

## 6. Step 5: Downstream Fork and Clone Notice

> [!WARNING]
> Anyone with an existing clone, fork, or local branch still has the old commits and secrets in their local object database until they reset or re-clone.

1. **GitHub / Remote Caches:** Contact GitHub Support to clear cached commit views if the repository is public.
2. **Collaborators / Other Machines:** Any collaborator must discard their local copy and clone freshly:
   ```bash
   git fetch origin
   git reset --hard origin/main
   ```
