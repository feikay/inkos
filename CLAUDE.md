# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build (all packages)
pnpm build

# Type-check
pnpm typecheck

# Run all tests
pnpm test

# Run a single test file
pnpm --filter @actalk/inkos-core test -- --reporter=verbose src/__tests__/writer.test.ts
pnpm --filter @actalk/inkos test -- --reporter=verbose src/__tests__/tui-dashboard.test.tsx
pnpm --filter @actalk/inkos-studio test -- --reporter=verbose src/api/server.test.ts

# Dev loop (CLI — rebuilds on change + runs command)
node scripts/dev-cli.mjs write --book <id>

# Studio dev (frontend + API server with hot reload)
pnpm --filter @actalk/inkos-studio dev
```

## Architecture

This is InkOS, a pnpm monorepo for autonomous AI novel writing. Three packages:

- **`@actalk/inkos-core`** (`packages/core/`) — The engine. Contains all business logic with zero UI deps: 10 LLM agents, pipeline orchestration, state management, validators, notifications, and the interaction system. Entry: [packages/core/src/index.ts](packages/core/src/index.ts).
- **`@actalk/inkos`** (`packages/cli/`) — CLI entry point. Thin wrapper that registers 28 commander subcommands + an Ink (React) terminal UI. Entry: [packages/cli/src/index.ts](packages/cli/src/index.ts).
- **`@actalk/inkos-studio`** (`packages/studio/`) — Web workbench. Hono API server + React 19 SPA (Vite + Tailwind + shadcn/ui). Entry: [packages/studio/src/api/index.ts](packages/studio/src/api/index.ts).

Full architecture reference: [ARCHITECTURE.md](ARCHITECTURE.md).

### Core engine structure

The core is organized into 11 modules under `packages/core/src/`:

| Module | Purpose |
|---|---|
| `models/` | Zod schemas for all domain types (`BookConfig`, `LLMConfig`, `CurrentState`, `ChapterIntent`, etc.) |
| `llm/` | LLM abstraction over `@mariozechner/pi-ai`. `createLLMClient` → `chatCompletion` / `chatWithTools`. Service presets for Anthropic/OpenAI/DeepSeek/etc. |
| `agents/` | All LLM agents extend `BaseAgent` which provides `chat()` and `chatWithSearch()`. Each agent has a `name` getter + execute method. |
| `pipeline/` | `PipelineRunner` orchestrates the write flow (plan→compose→write→normalize→validate→audit→revise). `Scheduler` adds cron-based daemon mode. `runAgentLoop` enables tool-use agent mode. |
| `state/` | `StateManager` for book/chapter CRUD. `MemoryDB` for in-memory fact retrieval. Three canonical truth files per book: `current_state.md`, `particle_ledger.md`, `pending_hooks.md`. |
| `interaction/` | Natural language interaction system. 25 intent types in [intents.ts](packages/core/src/interaction/intents.ts). Shared by CLI interact mode, TUI, and Studio chat. |
| `validators/` | Post-generation checks: consistency guard, style guard, pattern breaker, regression validation. |
| `notify/` | Multi-channel notifications (Telegram, Feishu, WeChat Work, webhook). |
| `short-story/` | Separate deterministic pipeline for short stories with genre-specific strategies. |
| `agent/` | Agent framework: system prompt builder, tool implementations (read/edit/write/grep/ls/patch/rename/sub-agent). |
| `utils/` | Shared utilities: config loader, logger, length metrics, context filter, hook governance, web search, analytics. |

### Critical data flow: writeNextChapter

The `PipelineRunner.writeNextChapter(bookId)` method is the heart of the system:

```
load book config + control documents + memory index
  → PlannerAgent (chapter intent + goals)
  → ComposerAgent (context package + rule stack)
  → WriterAgent (draft content)
  → LengthNormalizerAgent (if outside length spec)
  → StateValidatorAgent (truth file consistency)
  → ContinuityAuditor (33-dimension audit)
  → ReviserAgent (fix if audit failed)
  → persist chapter + update truth files
```

### Key design decisions

- **No database** — all state is markdown/JSON files on disk under `books/<id>/story/`. Portable and git-friendly.
- **Agent-level model routing** — each agent can use a different LLM model via `modelOverrides` in `inkos.json`. See [docs/multi-llm-writing-architecture.md](docs/multi-llm-writing-architecture.md).
- **Three truth files** per book — `current_state.md` (protagonist/location/conflict), `particle_ledger.md` (resource economy), `pending_hooks.md` (foreshadowing registry). These are the canonical source of continuity.
- **Input governance** — before the writer runs, the composer assembles a `ContextPackage` (filtered hooks, summaries, subplots) and a `RuleStack` (layered rules with override priorities) to control what context the writer receives.
- **PipelineRunner manages per-agent LLM clients** — `agentCtxFor(agentName)` resolves model overrides and creates/复用 LLM clients with the correct provider, model, temperature, and maxTokens.
- **Interaction system** is the shared abstraction layer — CLI `interact`, TUI chat, and Studio chat all route through `processProjectInteractionRequest` in [project-control.ts](packages/core/src/interaction/project-control.ts).

### Code conventions

- All domain types use Zod schemas (exported as both type and schema from [models/](packages/core/src/models/)).
- Agents are stateless — they receive input, call LLM via `this.chat()`, return structured output.
- File paths use `node:fs/promises` async API exclusively in core. Sync fs is only in CLI entry points.
- The CLI package uses `createRequire` to read its own `package.json` for version info.
- Studio frontend uses hash-based routing (`#/books/:id`) with no React Router — routing is manual via `useHashRoute` hook.
- Studio API is a single Hono app defined in [server.ts](packages/studio/src/api/server.ts) — all routes are registered in one file.
- Tests use Vitest with `include` patterns: core uses `src/__tests__/**/*.test.ts`, studio uses `src/**/*.test.ts`.
