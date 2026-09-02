# WordFolio

Offline English–Traditional Chinese dictionary for Obsidian, with hover tooltips and FSRS spaced repetition.

## Conventions

### Commit messages: English

This is a public plugin. Commit history is read by users tracing a behaviour, by
contributors, and by the Obsidian community directory reviewers — so the messages
have to be readable by people who do not read Chinese.

Keep them as detailed as they have been. The value of a commit message here is the
**why** and the **dead ends** ("we tried A and B, both failed, so C"), not the diff
summary. Language changes; depth does not.

**This rule applies to commit messages only. Do not generalise it.**

- Code comments stay in Traditional Chinese. They are the maintainer's working notes
  and carry hard-won reasoning; translating ~16k lines would risk losing nuance for a
  benefit nobody currently needs. Revisit only if an outside contributor actually
  shows up.
- Doug's Obsidian dev log, planning notes, and overview stay in Traditional Chinese.
  They are his private knowledge base, read on his own devices.
- Conversation with Doug stays in Traditional Chinese.

Existing commits are **not** to be rewritten. The directory's build verification
reproduced `main.js` byte-for-byte from a specific commit; rewriting history would
break that link and fork anyone's clone, for no real gain.

### Co-authorship trailer

Keep the `Co-Authored-By: Claude ...` trailer on commits. Doug's decision
(2026-09-02): this project is openly AI-assisted, `CLAUDE.md` is public anyway, and
stating it plainly beats having someone infer it later. It has no effect on
licensing, copyright, or his own contribution history.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`fire-university/wordfolio-obsidian`), driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root, created lazily by `/domain-modeling`. See `docs/agents/domain.md`.
