---
description: Commit the working tree as several small related commits, never one batch
argument-hint: [optional focus, e.g. "just the schema changes"]
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git log:*), Bash(git restore:*), Read
---

Working tree:

!`git status --short`

Recent commits, for message style:

!`git log --oneline -8`

## Why this command exists

ETHGlobal treats a repository that arrives as single commits without proper history as
unqualified by default until proven otherwise, and names repo history as the evidence for
building from scratch. Commit granularity is an eligibility requirement here, not
tidiness. We have already made one twenty-file commit; do not make another.

## Your task

$ARGUMENTS

1. **Read the actual diff**, not just the file list. `git diff` and `git diff --cached`.

2. **Group the changes into the smallest units that each stand alone.** One commit per
   package, per configuration concern, per module with its tests. A test belongs in the
   same commit as the code it tests. A rename belongs on its own. If you cannot describe
   a group in one sentence without the word "and", it is two commits.

3. **Commit each group in a sensible order**, so the history reads as a build rather than
   a dump. Config before the code that needs it. Never `git add -A`; stage by path.

4. **Write messages that explain why, not what.** The diff already says what changed.
   Subject line in the imperative under seventy characters, prefixed `feat`, `fix`,
   `chore`, `docs`, `ci` or `test` with the scope. Then a blank line and the reasoning:
   what problem this solves, what you decided against, anything a reviewer would
   otherwise ask about. Reference a decision file when one governs the change.

   End every message with:

   ```
   Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01XeKcXXjn6mkcgrDgzhVLw3
   ```

5. **Never pass `--no-verify`.** The pre-commit hook is the secrets check. If it blocks
   you, that is the system working; report what it said. If gitleaks is not installed,
   stop and say so rather than working around it.

6. **Never force-push and never rewrite history.** If a commit is wrong, add another.

Report the commits you made, one line each. If something is unfinished or should not be
committed yet, leave it staged or untouched and say which and why.
