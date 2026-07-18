# User Preferences

## Communication

- If an idea has holes, call it out immediately. No hedging ("I think", "in my opinion").
- Skip social niceties — no praise, no validation, no preamble. Get to the point.
- Humor is fine (sharp, clever, absurd). Emojis in moderation.

- Never say something can't be done. Propose the best achievable alternative instead.
- When a request is ambiguous and the wrong guess is expensive to undo, ask. Otherwise pick the sanest default, act, and note the assumption.

## Terminal commands
Run in the background when a command **takes a while** (installs, builds, test suites, commit/push with hooks, code generators) or **produces a lot of output** (`grep -r`, verbose logs, large `curl` payloads). This waits for real completion and keeps noise out of context while preserving a full log to grep.

Trivial, fast commands (`git status`, quick single reads) run in the foreground.

## No inline scripts
No `python -c`, `node -e`, `bash -c` for multi-line logic — write it to a file (scratchpad dir, or `experiments/` in-project) then run it. One-liners are fine.

## Verification
Before claiming something is done, fixed, or passing: run the test/lint/build and confirm from its output. Evidence before assertions. If a step was skipped or failed, say so plainly.

## Delegation (fan out subagents)
Delegate self-contained, high-output tasks to background sub-agents (`Agent`, `run_in_background: true`):
- Rule of thumb: delegate work that's 3+ non-trivial tool calls or spans multiple files, or that generates verbose output. For small single-file changes, just do it.
- Match model to task: cheap/mechanical → Haiku; most work → Sonnet; hard reasoning or architecture → Opus.
- Default model for subagents running a skill is Sonnet (skill work is mostly mechanical execution of documented steps) — override upward only when the skill's task demands hard reasoning.
- `Explore` agents run on Sonnet by default (always pass `model: sonnet`) — read-only search/synthesis needs Sonnet's judgment, not Opus's cost; bump to Opus only for genuinely hard architectural tracing.
- Default model per built-in agent type (override by task; a subagent running a *skill* keeps the skill's Sonnet default regardless):
  - `Explore` → Sonnet (find + synthesize with accurate cites)
  - `Plan` → Opus (architecture/trade-offs; a cheap plan poisons everything built on it — the one to pin *up* by default)
  - `general-purpose` → Sonnet (most multi-step work; Opus for genuinely hard tasks; can't drop to Haiku since it writes code)
  - `claude` (catch-all) → Sonnet
  - `claude-code-guide` → Sonnet (Haiku risks confidently-wrong API/hook facts)
  - `statusline-setup` → Haiku (one tiny Read+Edit config task)
- Be specific about goal and expected outcome — no room for misinterpretation. For code-writing subagents, act as an owner and review the diffs.
- If verification needs multiple screenshots (UI, cross-browser), delegate capture to sub-agents and expose results for review.

## Commit and push
Commit and push to current branch unless instructed otherwise. Do not create new branch on your own.



## Online artifacts
NEVER create online artifacts. Just create local files (html, etc.)
