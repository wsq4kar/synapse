# Changelog

## 0.4.0

- **Antigravity CLI** instead of Gemini CLI: Google's new agent (`agy`) with streaming steps, reasoning, subagents, token usage and session resume. It reports its own model list, and the Arena skips models it doesn't have. Old settings move over automatically.
- **OpenRouter**: one key for hundreds of models. Chat (with reasoning and prompt caching for Claude and Gemini), task routing and image generation work through OpenRouter when there's no Gemini key, or when you pick an OpenRouter model in the menu. OpenCode gets the key for `openrouter/…` models.
- **No more typing model names**: all model lists live in `models.json`; the app pulls a fresh copy from GitHub. The «Models» field in Settings → Agents is now optional.
- **Fewer tokens**:
  - Codex and Antigravity continue their own sessions like Claude Code and OpenCode — the chat history is no longer resent every turn. If a session can't be resumed, the task restarts once with a short context.
  - History for agents without a session: code blocks from earlier answers are folded (the code is already in the files), long messages are shortened.
  - Gemini and OpenRouter chats keep a history budget: recent messages in full, older ones shorter.
  - Routing sends only the start of the request and turns reasoning off.
  - Arena participants with a session don't receive the brief and their own plan again.
- **Stats** (account menu or sidebar): tokens all time, most tokens in a day, longest task, streaks, a token activity heatmap (by day, by week, cumulative), executors and favorite models, most used reasoning level.
- **Account menu** like in Claude: settings, stats, language, agents and models, API keys, what's new, help.
- Settings: search, grouped sections, «API keys» tab with Gemini and OpenRouter.
- **Your name**: change it on the stats page («Edit»), from the account menu or in Settings → Appearance. By default it's your Windows user name.
- The Windows installer build on GitHub works again (PowerShell broke an electron-builder flag, so 0.2.0 and 0.3.0 had no installer).
- Fixes: «Stopped» and «blocked by filter» messages from Gemini were never shown (a variable hid the translation function); pages opened scrolled to where the previous page was.

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
