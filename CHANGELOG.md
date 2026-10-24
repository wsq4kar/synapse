# Changelog

## 0.2.0

- **Arena**: the large models work as a team. A small model writes the brief; Opus 5.5, GPT-6 Astra / 6.1 Sol, Gemini 4 Argon and others plan, debate until they agree (up to 3 rounds), each build their own variant in a separate copy of the folder, vote anonymously, and the winner polishes its result. Scores, diffs and an **Apply** button; other variants can be viewed and applied too. The folder is untouched until you apply, with a warning if files changed in the meantime.
- Arena line-up is automatic (by coding benchmarks, one model per agent first) or manual in Settings → Agents → Arena; dispatcher model and number of debate rounds are configurable.
- If a model isn't available on your subscription, the Arena switches to the next model of the same agent.
- Codex model list updated: GPT-6.1 Sol, GPT-6 Astra, GPT-5.6 Sol / Terra / Luna.

## 0.1.11

- OpenCode: older versions that don't know `--variant` (or other new flags) are now retried without the flag instead of handing the task to another agent.
- A dropped network connection (proxy, CLI, SSH bridge) no longer shows the "JavaScript error in the main process" window; such errors go to `errors.log` in the app data folder.

## 0.1.10

- **OpenCode** as a fourth code agent: any provider in `provider/model` form, free OpenCode Zen models out of the box, reasoning, tool steps, subagents, session resume, token usage.
- **Appearance settings**: font (system, rounded, serif, mono, readable), text size, accent color, conversation width, reduced motion, Enter or Ctrl+Enter to send, message bubbles on/off, live preview.
- **Workspace**: hide the file list to give the preview the full width, or expand the preview over the whole panel (Esc to collapse).
- Composer buttons no longer overlap when the workspace panel is open.
- Default HTTP proxy is now `127.0.0.1:10801`.
- No server address is baked into the SSH tunnel defaults anymore.
- GPL-3.0 license, GitHub Actions (check on push, Windows installer on tag), issue and PR templates.

## 0.1.9

- Codex subscription limits (5 hours and week) in the context popover.

## 0.1.8

- Token counter shows only new tokens; cache reuse is shown separately.

## 0.1.7 and earlier

- Router between Gemini API, Claude Code, Codex and Gemini CLI with fallback.
- Ultra mode, effort levels, model picker with service icons, RU/EN.
- Workspace: file tree, preview (HTML, code, Markdown, PDF, media), PowerShell terminal.
- Visible reasoning, smooth streaming, subagents and Team mode, instant HTML preview.
- Network: system / HTTP proxy / SSH tunnel, strict mode, Windows Firewall rules.
- Memory ("About me"), Claude Code skills and connectors.
- Pets, ASCII background, progress panel.
