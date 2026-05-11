# InkOS Architecture

> Autonomous AI novel writing system — 10-agent pipeline for writing, auditing, and revising novels with continuity tracking.

## Project Overview

InkOS is a pnpm monorepo for AI-assisted long-form web novel creation. It uses a multi-agent LLM pipeline to plan, write, audit, and revise chapters. The system covers the full lifecycle: book creation → chapter planning → draft writing → continuity audit → revision → quality checks → publishing.

- **Version**: 1.3.5
- **License**: AGPL-3.0-only
- **Runtime**: Node.js >= 20, pnpm >= 9.0
- **Language**: TypeScript (ESM modules)
- **Repo**: https://github.com/Narcooo/inkos

---

## Repository Structure

```
inkos/
├── packages/
│   ├── core/          # @actalk/inkos-core — engine: agents, pipeline, state, LLM, validators
│   ├── cli/           # @actalk/inkos — CLI entry (commander + ink TUI)
│   └── studio/        # @actalk/inkos-studio — Web UI (Hono API + React SPA)
├── scripts/           # Build/release/diagnostic scripts
├── docs/              # Design docs, runbooks, prompt references
├── skills/            # OpenClaw skill definition (SKILL.md)
├── my-novel/          # Example novel output directory
├── test-project/      # Test fixture project
├── pnpm-workspace.yaml
├── package.json        # Root workspace config
└── tsconfig.json
```

**Package dependency graph:**

```
@actalk/inkos (CLI)
  ├── @actalk/inkos-core
  └── @actalk/inkos-studio

@actalk/inkos-studio
  └── @actalk/inkos-core

@actalk/inkos-core
  └── (external: @mariozechner/pi-ai, @mariozechner/pi-agent-core, zod)
```

---

## Package: `@actalk/inkos-core` (Engine)

The core engine is the brain of InkOS. It contains all business logic and has zero UI dependencies. Entry: [packages/core/src/index.ts](packages/core/src/index.ts)

### 1. Models (`src/models/`)

Zod-validated data schemas defining the domain types. All schemas are re-exported from the package entry.

| File | Key Types | Purpose |
|---|---|---|
| [book.ts](packages/core/src/models/book.ts) | `BookConfig`, `Platform`, `Genre`, `BookStatus`, `FanficMode`, `WritingRules` | Book metadata, platform target, genre, status lifecycle |
| [project.ts](packages/core/src/models/project.ts) | `ProjectConfig`, `LLMConfig`, `NotifyChannel`, `DetectionConfig`, `QualityGates`, `AgentLLMOverride` | Project-wide config: LLM provider, notifications, AI detection, quality gates |
| [chapter.ts](packages/core/src/models/chapter.ts) | `ChapterMeta`, `ChapterStatus` | Per-chapter metadata |
| [state.ts](packages/core/src/models/state.ts) | `CurrentState`, `ParticleLedger`, `PendingHooks` | The three canonical truth files per book (state card, ledger, hooks) |
| [runtime-state.ts](packages/core/src/models/runtime-state.ts) | `RuntimeStateDelta`, `HookRecord`, `ChapterSummaryRow`, `CurrentStateFact` | Structured runtime state snapshots |
| [input-governance.ts](packages/core/src/models/input-governance.ts) | `ChapterIntent`, `ContextPackage`, `RuleStack`, `HookPressure` | Chapter-level input governance — controls what context the writer sees |
| [genre-profile.ts](packages/core/src/models/genre-profile.ts) | `GenreProfile` | Per-genre writing rules (style, tropes, constraints) |
| [length-governance.ts](packages/core/src/models/length-governance.ts) | `LengthSpec`, `LengthCountingMode` | Chapter word count governance (hard/soft min/max) |
| [detection.ts](packages/core/src/models/detection.ts) | `DetectionHistoryEntry` | AI content detection results |
| [style-profile.ts](packages/core/src/models/style-profile.ts) | `StyleProfile` | Style cloning profile |

### 2. LLM Provider (`src/llm/`)

Abstracts LLM API calls through the `@mariozechner/pi-ai` library.

| File | Purpose |
|---|---|
| [provider.ts](packages/core/src/llm/provider.ts) | Core LLM client: `createLLMClient`, `chatCompletion`, `chatWithTools`, streaming monitors. Wraps pi-ai with Anthropic/OpenAI/custom provider support |
| [service-presets.ts](packages/core/src/llm/service-presets.ts) | Built-in provider presets (Anthropic, OpenAI, DeepSeek, etc.) with base URLs and model lists |
| [service-resolver.ts](packages/core/src/llm/service-resolver.ts) | Resolves `model` string → `{ provider, model }` tuple |
| [secrets.ts](packages/core/src/llm/secrets.ts) | API key management via `.env` and `~/.config/inkos/.env` |
| [config-migration.ts](packages/core/src/llm/config-migration.ts) | Migrates old config formats |

**LLM Client creation:** `createLLMClient(config)` returns a client with `provider`, `baseUrl`, `apiKey`, `headers`, `temperature`, `maxTokens`, `stream` settings.

**Agent-level model routing:** Each agent can use a different model/provider via `modelOverrides` in `inkos.json`. See [docs/multi-llm-writing-architecture.md](docs/multi-llm-writing-architecture.md) for details.

### 3. Agents (`src/agents/`)

Agents are the LLM-powered workers. They extend `BaseAgent` which provides `chat()` and `chatWithSearch()` methods.

**Base class:** [base.ts](packages/core/src/agents/base.ts) — `BaseAgent` holds `AgentContext { client, model, projectRoot, bookId, logger }` and exposes `chat(messages)` and `chatWithSearch(messages)`.

**Writing pipeline agents (10-agent core):**

| Agent | File | Role |
|---|---|---|
| `ArchitectAgent` | [architect.ts](packages/core/src/agents/architect.ts) | Creates book foundation: world-building, characters, rules, settings |
| `FoundationReviewerAgent` | [foundation-reviewer.ts](packages/core/src/agents/foundation-reviewer.ts) | Reviews foundation files for completeness & consistency |
| `PlannerAgent` | [planner.ts](packages/core/src/agents/planner.ts) | Generates chapter intent, goals, conflicts, foreshadowing plan |
| `ComposerAgent` | [composer.ts](packages/core/src/agents/composer.ts) | Assembles governed context + rule stack for the writer |
| `WriterAgent` | [writer.ts](packages/core/src/agents/writer.ts) | Generates chapter draft content (the main creative agent) |
| `ContinuityAuditor` | [continuity.ts](packages/core/src/agents/continuity.ts) | 33-dimension continuity audit — OOC, pacing, plot holes, etc. |
| `ReviserAgent` | [reviser.ts](packages/core/src/agents/reviser.ts) | Fixes audit issues: spot-fix, polish, rewrite, rework, anti-detect |
| `StateValidatorAgent` | [state-validator.ts](packages/core/src/agents/state-validator.ts) | Validates post-chapter state updates are consistent |
| `ChapterAnalyzerAgent` | [chapter-analyzer.ts](packages/core/src/agents/chapter-analyzer.ts) | Analyzes existing chapters, extracts state and facts |
| `LengthNormalizerAgent` | [length-normalizer.ts](packages/core/src/agents/length-normalizer.ts) | Trims/expands chapters to meet length governance |

**Support agents:**

| Agent | File | Role |
|---|---|---|
| `RadarAgent` | [radar.ts](packages/core/src/agents/radar.ts) | Trend radar — analyzes platform rankings and market trends |
| `RadarSource` | [radar-source.ts](packages/core/src/agents/radar-source.ts) | Platform-specific ranking scrapers (Fanqie, Qidian, text) |
| `ConsolidatorAgent` | [consolidator.ts](packages/core/src/agents/consolidator.ts) | Consolidates existing chapters into structured state |
| `FanficCanonImporter` | [fanfic-canon-importer.ts](packages/core/src/agents/fanfic-canon-importer.ts) | Imports canon material for fanfiction mode |
| `AITellDetector` | [ai-tells.ts](packages/core/src/agents/ai-tells.ts) | Detects AI-typical writing patterns ("AI味") |
| `SensitiveWords` | [sensitive-words.ts](packages/core/src/agents/sensitive-words.ts) | Content safety screening |
| `Detector` | [detector.ts](packages/core/src/agents/detector.ts) | AI content detection |
| `StyleAnalyzer` | [style-analyzer.ts](packages/core/src/agents/style-analyzer.ts) | Analyzes and clones writing style |

**Prompt builders:** [writer-prompts.ts](packages/core/src/agents/writer-prompts.ts), [settler-prompts.ts](packages/core/src/agents/settler-prompts.ts), [fanfic-prompt-sections.ts](packages/core/src/agents/fanfic-prompt-sections.ts), [en-prompt-sections.ts](packages/core/src/agents/en-prompt-sections.ts)

### 4. Pipeline (`src/pipeline/`)

Orchestrates the writing workflow.

| File | Purpose |
|---|---|
| [runner.ts](packages/core/src/pipeline/runner.ts) | `PipelineRunner` — the main orchestrator. Methods: `initBook()`, `writeNextChapter()` (full write→audit→revise cycle), `draftChapter()`, `auditChapter()`, `reviseChapter()`, `exportBook()`, `importChapters()`. Manages per-agent LLM client creation and model routing. |
| [scheduler.ts](packages/core/src/pipeline/scheduler.ts) | `Scheduler` — daemon mode. Cron-based autonomous writing with quality gates, failure clustering, daily chapter limits, and cooldown periods. |
| [agent.ts](packages/core/src/pipeline/agent.ts) | `runAgentLoop` — LLM agent with tool-use loop (write_draft, plan_chapter, audit_chapter, revise_chapter tools). The autonomous agent mode. |
| [chapter-review-cycle.ts](packages/core/src/pipeline/chapter-review-cycle.ts) | Chapter review cycle: writer → pre-audit normalizer → auditor → reviser → post-revise normalizer. Manages the full review loop. |
| [chapter-persistence.ts](packages/core/src/pipeline/chapter-persistence.ts) | Persists chapter artifacts (drafts, reviews, state cards) to disk. |
| [chapter-state-recovery.ts](packages/core/src/pipeline/chapter-state-recovery.ts) | Recovers from degraded state validation, retries settlement. |
| [chapter-truth-validation.ts](packages/core/src/pipeline/chapter-truth-validation.ts) | Validates truth file consistency after chapter write. |
| [detection-runner.ts](packages/core/src/pipeline/detection-runner.ts) | AI content detection and auto-rewrite pipeline. |
| [persisted-governed-plan.ts](packages/core/src/pipeline/persisted-governed-plan.ts) | Persists and loads governed chapter plans. |

**Pipeline write flow** (simplified):
```
writeNextChapter(bookId)
  → load book config, control documents, state, memory index
  → architect (if first chapter)
  → planner → PlanChapterResult (intent + goal + conflicts)
  → composer → ComposeChapterResult (context + ruleStack + trace)
  → writer → draft content
  → length-normalizer (if needed)
  → state-validator (truth file consistency)
  → auditor (33-dimension continuity check)
  → reviser (if audit fails)
  → persist chapter + update state
```

### 5. State Management (`src/state/`)

| File | Purpose |
|---|---|
| [manager.ts](packages/core/src/state/manager.ts) | `StateManager` — book CRUD, control documents, chapter metadata indexing. File-based state per book under `<project>/books/<id>/story/`. |
| [memory-db.ts](packages/core/src/state/memory-db.ts) | `MemoryDB` — in-memory fact and summary index for fast retrieval during writing. |
| [state-bootstrap.ts](packages/core/src/state/state-bootstrap.ts) | Bootstraps structured state from markdown truth files. |
| [state-projections.ts](packages/core/src/state/state-projections.ts) | Renders state cards, hooks, chapter summaries as markdown strings. |
| [state-reducer.ts](packages/core/src/state/state-reducer.ts) | Applies `RuntimeStateDelta` to current state snapshot. |
| [state-validator.ts](packages/core/src/state/state-validator.ts) | Validates runtime state updates. |
| [runtime-state-store.ts](packages/core/src/state/runtime-state-store.ts) | Loads/saves structured runtime state snapshots to disk. |
| [settlement-reconciliation.ts](packages/core/src/state/settlement-reconciliation.ts) | Reconciles settlement outputs with existing state. |

**Three canonical truth files** per book (in `story/`):
- `current_state.md` — protagonist status, location, enemies, active conflict
- `particle_ledger.md` — resource/value tracking ledger
- `pending_hooks.md` — open/pending plot hooks and foreshadowing

### 6. Interaction System (`src/interaction/`)

Handles natural language interaction with the writing system, used by both CLI interact mode and Studio chat.

| File | Purpose |
|---|---|
| [intents.ts](packages/core/src/interaction/intents.ts) | `InteractionRequest` schema — 25 intent types (create_book, write_next, revise_chapter, chat, export_book, etc.) |
| [events.ts](packages/core/src/interaction/events.ts) | `InteractionEvent`, `ExecutionStatus`, `ExecutionState` — event-driven interaction state |
| [session.ts](packages/core/src/interaction/session.ts) | `InteractionSession`, `BookSession` — conversation session state with message history |
| [modes.ts](packages/core/src/interaction/modes.ts) | `AutomationMode` — manual vs automated execution |
| [request-router.ts](packages/core/src/interaction/request-router.ts) | Routes `InteractionRequest` (validates + passes through) |
| [nl-router.ts](packages/core/src/interaction/nl-router.ts) | Natural language intent routing — maps user NL to `InteractionRequest` |
| [project-control.ts](packages/core/src/interaction/project-control.ts) | Core interaction processing — `processProjectInteractionRequest` |
| [runtime.ts](packages/core/src/interaction/runtime.ts) | `runInteractionRequest` — executes intents via `InteractionRuntimeTools` |
| [project-tools.ts](packages/core/src/interaction/project-tools.ts) | Creates tool implementations bound to PipelineRunner + StateManager |
| [project-session-store.ts](packages/core/src/interaction/project-session-store.ts) | Persists global and project-level sessions |
| [book-session-store.ts](packages/core/src/interaction/book-session-store.ts) | Persists per-book sessions, supports migration |
| [edit-controller.ts](packages/core/src/interaction/edit-controller.ts) | Entity rename, chapter text patching transactions |
| [truth-authority.ts](packages/core/src/interaction/truth-authority.ts) | Classifies truth file write authority |
| [export-artifact.ts](packages/core/src/interaction/export-artifact.ts) | Builds export artifacts (TXT, MD, EPUB) |
| [draft-directive-parser.ts](packages/core/src/interaction/draft-directive-parser.ts) | Parses structured directives from draft responses |

### 7. Validators (`src/validators/`)

Post-generation quality checks:

| File | Purpose |
|---|---|
| [consistency-guard.ts](packages/core/src/validators/consistency-guard.ts) | Validates cross-chapter consistency (entities, power levels, relationships) |
| [style-guard.ts](packages/core/src/validators/style-guard.ts) | Enforces style profile constraints |
| [pattern-breaker.ts](packages/core/src/validators/pattern-breaker.ts) | Detects repetitive narrative patterns (pacing monotony, mood monotony, opening/ending repetition) |
| [regression-validation.ts](packages/core/src/validators/regression-validation.ts) | Detects quality regression across chapter sequences |

### 8. Utilities (`src/utils/`)

Key utilities used across the engine:

| File | Purpose |
|---|---|
| [config-loader.ts](packages/core/src/utils/config-loader.ts) | Loads `inkos.json` project config, resolves global config paths |
| [logger.ts](packages/core/src/utils/logger.ts) | Structured logging (JSON lines, stderr sinks) |
| [length-metrics.ts](packages/core/src/utils/length-metrics.ts) | Chapter word counting (Chinese chars vs English words), length spec evaluation |
| [context-filter.ts](packages/core/src/utils/context-filter.ts) | Filters hooks/summaries/subplots by relevance to current chapter |
| [hook-governance.ts](packages/core/src/utils/hook-governance.ts) | Hook lifecycle management — admission, staleness, disposition |
| [hook-arbiter.ts](packages/core/src/utils/hook-arbiter.ts) | Arbitrates hook delta decisions |
| [hook-health.ts](packages/core/src/utils/hook-health.ts) | Analyzes hook health (open rate, resolution rate, staleness) |
| [memory-retrieval.ts](packages/core/src/utils/memory-retrieval.ts) | Retrieves relevant facts from MemoryDB |
| [chapter-splitter.ts](packages/core/src/utils/chapter-splitter.ts) | Splits long drafts into chapter-sized segments |
| [web-search.ts](packages/core/src/utils/web-search.ts) | Web search (Tavily API) and URL fetching |
| [webnovel-inputs.ts](packages/core/src/utils/webnovel-inputs.ts) | Web novel specific input processing |
| [numeric-expression-mode.ts](packages/core/src/utils/numeric-expression-mode.ts) | Numeric expression guidance (immersive/system/light_numeric) |
| [analytics.ts](packages/core/src/utils/analytics.ts) | Token usage and cost analytics |

### 9. Notifications (`src/notify/`)

Multi-channel notifications for pipeline events:

| File | Channel |
|---|---|
| [dispatcher.ts](packages/core/src/notify/dispatcher.ts) | Routes events to configured channels |
| [telegram.ts](packages/core/src/notify/telegram.ts) | Telegram bot |
| [feishu.ts](packages/core/src/notify/feishu.ts) | Feishu/Lark webhook |
| [wechat-work.ts](packages/core/src/notify/wechat-work.ts) | WeChat Work webhook |
| [webhook.ts](packages/core/src/notify/webhook.ts) | Generic webhook |

### 10. Agent System (`src/agent/`)

LLM agent framework for autonomous operation:

| File | Purpose |
|---|---|
| [agent-session.ts](packages/core/src/agent/agent-session.ts) | `runAgentSession` — full agent session with tool-use loop |
| [agent-system-prompt.ts](packages/core/src/agent/agent-system-prompt.ts) | Builds system prompt for the agent |
| [agent-tools.ts](packages/core/src/agent/agent-tools.ts) | Tool implementations: read, edit, write, grep, ls, patch chapter text, rename entity, sub-agent |

### 11. Short Story (`src/short-story/`)

Deterministic short story pipeline (separate from the novel pipeline):

| File | Purpose |
|---|---|
| [schema.ts](packages/core/src/short-story/schema.ts) | Short story config schema |
| [chapter-plan.ts](packages/core/src/short-story/chapter-plan.ts) | Chapter word count and beat planning |
| [world-builder.ts](packages/core/src/short-story/world-builder.ts) | World-building with name variants |
| [writer.ts](packages/core/src/short-story/writer.ts) | Draft generation from plans |
| [auditor.ts](packages/core/src/short-story/auditor.ts) | Structure and constraint validation |
| [publish-optimizer.ts](packages/core/src/short-story/publish-optimizer.ts) | Title generation, opening optimization, short video scripts |
| [variant.ts](packages/core/src/short-story/variant.ts) | Batch/run variant generation |
| [strategies/](packages/core/src/short-story/strategies/) | Genre-specific strategies (betrayal-revenge, thriller) |

---

## Package: `@actalk/inkos` (CLI)

Entry: [packages/cli/src/index.ts](packages/cli/src/index.ts) — 4-line bootstrap that calls `runProgram()`.

### Program Structure

[packages/cli/src/program.ts](packages/cli/src/program.ts) — Uses `commander` to define the CLI:

```
inkos [default]           → launch Studio
inkos init                → initialize a new project
inkos config              → manage LLM configuration
inkos book                → create/list/select books
inkos write               → write the next chapter
inkos draft               → draft a specific chapter
inkos review              → review/audit a chapter
inkos audit               → audit a chapter
inkos revise              → revise a chapter
inkos plan                → plan next chapter
inkos compose             → compose context for next chapter
inkos export              → export book to TXT/MD/EPUB
inkos import              → import existing chapters
inkos up/down             → start/stop daemon
inkos doctor              → diagnostic checks
inkos status              → show project/book status
inkos radar               → trend radar
inkos detect              → AI content detection
inkos genre               → manage genre profiles
inkos style               → manage style profiles
inkos analytics           → cost/token analytics
inkos update              → check for updates
inkos agent               → LLM agent with tool use
inkos short-story         → short story pipeline
inkos fanfic              → fanfiction mode
inkos eval                → evaluation mode
inkos studio              → launch web studio
inkos tui                 → launch terminal UI
inkos interact            → interactive NL session
inkos consolidate         → consolidate chapters into state
```

### Commands (`src/commands/`)

Each file implements a `Command` registered in [program.ts](packages/cli/src/program.ts):

- [write.ts](packages/cli/src/commands/write.ts) — `inkos write` triggers `PipelineRunner.writeNextChapter()`
- [review.ts](packages/cli/src/commands/review.ts) — `inkos review` triggers continuity audit
- [draft.ts](packages/cli/src/commands/draft.ts) — `inkos draft` drafts without audit/revise
- [export.ts](packages/cli/src/commands/export.ts) — format conversion and export
- [studio.ts](packages/cli/src/commands/studio.ts) — launches Studio server
- [tui.ts](packages/cli/src/commands/tui.ts) — launches terminal UI
- [interact.ts](packages/cli/src/commands/interact.ts) — NL interaction loop
- [daemon.ts](packages/cli/src/commands/daemon.ts) — daemon lifecycle
- [import.ts](packages/cli/src/commands/import.ts) — chapter import
- [agent.ts](packages/cli/src/commands/agent.ts) — autonomous agent mode
- [consolidate.ts](packages/cli/src/commands/consolidate.ts) — state consolidation

### Terminal UI (`src/tui/`)

React (Ink)-based terminal UI for interactive use:

| File | Purpose |
|---|---|
| [app.ts](packages/cli/src/tui/app.ts) | TUI entry point and main app component |
| [dashboard.tsx](packages/cli/src/tui/dashboard.tsx) | Dashboard component (book list, chapter progress) |
| [chat-draft.ts](packages/cli/src/tui/chat-draft.ts) | Chat/draft view |
| [composer-display.ts](packages/cli/src/tui/composer-display.ts) | Message composer display |
| [output.ts](packages/cli/src/tui/output.ts) | Output rendering with markdown support |
| [markdown.ts](packages/cli/src/tui/markdown.ts) | Markdown rendering in terminal |
| [session-store.ts](packages/cli/src/tui/session-store.ts) | TUI session state persistence |
| [i18n.ts](packages/cli/src/tui/i18n.ts) | Internationalization (zh/en) |
| [theme.ts](packages/cli/src/tui/theme.ts) | Terminal color themes |
| [effects.ts](packages/cli/src/tui/effects.ts) | Visual effects (spinners, etc.) |
| [setup.ts](packages/cli/src/tui/setup.ts) | First-run setup wizard |

### Other CLI modules

| File | Purpose |
|---|---|
| [localization.ts](packages/cli/src/localization.ts) | i18n strings |
| [project-bootstrap.ts](packages/cli/src/project-bootstrap.ts) | Project directory initialization |
| [runtime-requirements.ts](packages/cli/src/runtime-requirements.ts) | Node.js version checks |

---

## Package: `@actalk/inkos-studio` (Web UI)

A web-based workbench for InkOS. Two-tier architecture:

### API Server (`src/api/`)

Built with **Hono** (lightweight web framework):

| File | Purpose |
|---|---|
| [index.ts](packages/studio/src/api/index.ts) | Server entry — auto-builds frontend, starts Hono server on configurable port (default 4569) |
| [server.ts](packages/studio/src/api/server.ts) | Main server — Hono app with CORS, REST API routes, SSE streaming for runs, health checks, book CRUD, chapter management, truth files, config, logs |
| [book-create.ts](packages/studio/src/api/book-create.ts) | Book creation endpoint logic |
| [safety.ts](packages/studio/src/api/safety.ts) | Input sanitization (book ID safety) |
| [errors.ts](packages/studio/src/api/errors.ts) | Standardized API error responses |

**API routes (defined in [server.ts](packages/studio/src/api/server.ts)):**

```
GET  /api/health                    — health check
GET  /api/books                     — list books
POST /api/books                     — create book
GET  /api/books/:id                 — book detail
GET  /api/books/:id/chapters        — chapter list
GET  /api/books/:id/chapters/:num   — chapter content
PUT  /api/books/:id/chapters/:num   — save chapter content
POST /api/books/:id/runs            — trigger run (draft/audit/revise/write-next)
GET  /api/runs/:runId               — run status
GET  /api/books/:id/runs            — list runs
GET  /api/runs/:runId/stream        — SSE run stream
GET  /api/books/:id/truths          — truth files list
GET  /api/books/:id/truths/:name    — truth file content
PUT  /api/books/:id/truths/:name    — save truth file
GET  /api/config                    — get LLM config
POST /api/config                    — save LLM config
GET  /api/config/services           — list service presets
GET  /api/config/models/:service    — list models for service
POST /api/config/test               — test LLM connection
GET  /api/logs                      — recent logs
GET  /api/genres                    — genre profiles
GET  /api/analytics                 — analytics data
GET  /api/sessions                  — book sessions
GET  /api/sessions/:id              — session messages
```

### Frontend (`src/`)

React 19 SPA built with Vite + Tailwind CSS v4 + shadcn/ui:

| File | Purpose |
|---|---|
| [App.tsx](packages/studio/src/App.tsx) | Root component with hash-based routing |
| [main.tsx](packages/studio/src/main.tsx) | React entry point |
| [app-state.ts](packages/studio/src/app-state.ts) | Global app state (Zustand) |

**Pages:**

| Page | Route | Purpose |
|---|---|---|
| [Dashboard.tsx](packages/studio/src/pages/Dashboard.tsx) | `#/` | Project overview, book list, recent activity |
| [BookCreate.tsx](packages/studio/src/pages/BookCreate.tsx) | `#/books/new` | Book creation wizard |
| [BookDetail.tsx](packages/studio/src/pages/BookDetail.tsx) | `#/books/:id` | Book detail: chapters, runs, actions |
| [ChapterReader.tsx](packages/studio/src/pages/ChapterReader.tsx) | `#/books/:id/chapters/:num` | Chapter reader/editor |
| [ChatPage.tsx](packages/studio/src/pages/ChatPage.tsx) | `#/chat` | AI chat for book operations |
| [DaemonControl.tsx](packages/studio/src/pages/DaemonControl.tsx) | `#/daemon` | Daemon management |
| [DoctorView.tsx](packages/studio/src/pages/DoctorView.tsx) | `#/doctor` | Diagnostic view |
| [GenreManager.tsx](packages/studio/src/pages/GenreManager.tsx) | `#/genres` | Genre profile management |
| [ServiceListPage.tsx](packages/studio/src/pages/ServiceListPage.tsx) | `#/services` | LLM service configuration |
| [ServiceDetailPage.tsx](packages/studio/src/pages/ServiceDetailPage.tsx) | `#/services/:id` | Service detail/model selection |
| [StyleManager.tsx](packages/studio/src/pages/StyleManager.tsx) | `#/styles` | Style profile management |
| [TruthFiles.tsx](packages/studio/src/pages/TruthFiles.tsx) | `#/books/:id/truths` | Truth file viewer/editor |
| [LogViewer.tsx](packages/studio/src/pages/LogViewer.tsx) | `#/logs` | Log viewer |
| [Analytics.tsx](packages/studio/src/pages/Analytics.tsx) | `#/analytics` | Cost and token analytics |
| [RadarView.tsx](packages/studio/src/pages/RadarView.tsx) | `#/radar` | Trend radar |
| [ImportManager.tsx](packages/studio/src/pages/ImportManager.tsx) | `#/import` | Chapter import |
| [LanguageSelector.tsx](packages/studio/src/pages/LanguageSelector.tsx) | `#/settings` | Language settings |

### Shared Contracts ([contracts.ts](packages/studio/src/shared/contracts.ts))

TypeScript interfaces shared between API server and frontend:
- `HealthStatus`, `BookSummary`, `BookDetail`, `ChapterSummary`, `ChapterDetail`
- `TruthFileSummary`, `TruthFileDetail`
- `StudioRun`, `RunAction`, `RunStatus`, `RunStreamEvent`
- `ApiErrorResponse`

---

## Data Flow: Write Next Chapter

This is the most critical workflow. Here's the end-to-end flow:

```
User/CLI invokes writeNextChapter(bookId)
  │
  ├─ StateManager.loadBookConfig(bookId)
  │   └─ reads books/<id>/book.json
  │
  ├─ StateManager.loadControlDocuments(bookId)
  │   └─ reads story/author_intent.md, story/current_focus.md
  │
  ├─ loadNarrativeMemorySeed(bookId)
  │   └─ loads story/runtime/narrative_memory_seed.json
  │
  ├─ [1] PlannerAgent.plan()
  │   └─ generates chapter_intent.md, chapter_goal, conflicts
  │   └─ output: PlanChapterResult
  │
  ├─ [2] ComposerAgent.compose()
  │   └─ assembles context_package.json, rule_stack.json, chapter_trace.json
  │   └─ output: ComposeChapterResult
  │
  ├─ [3] WriterAgent.write()
  │   └─ generates chapter draft content
  │   └─ output: WriteChapterOutput { content, wordCount, tokenUsage }
  │
  ├─ [4] LengthNormalizerAgent.normalize()  [if needed]
  │   └─ trims or expands to meet length spec
  │
  ├─ [5] StateValidatorAgent.validate()
  │   └─ validates truth file consistency
  │   └─ may trigger settlement retry on degradation
  │
  ├─ [6] ContinuityAuditor.audit()
  │   └─ 33-dimension continuity check
  │   └─ output: AuditResult { passed, issues[], score }
  │
  ├─ [7] ReviserAgent.revise()  [if audit fails]
  │   └─ applies fixes (spot-fix / polish / rewrite)
  │   └─ re-audits after revision
  │
  ├─ persistChapterArtifacts()
  │   └─ writes chapters/<NNNN>_<title>.md
  │   └─ updates current_state.md, particle_ledger.md, pending_hooks.md
  │
  └─ returns ChapterPipelineResult
```

---

## Project Configuration

A project is a directory containing an `inkos.json` file. Key configuration:

```json
{
  "llm": {
    "provider": "anthropic" | "openai" | "custom",
    "baseUrl": "...",
    "apiKey": "...",
    "model": "claude-sonnet-4-6",
    "temperature": 0.7,
    "maxTokens": 8192,
    "thinkingBudget": 0
  },
  "modelOverrides": {
    "writer": { "model": "different-model", "temperature": 0.65 },
    "auditor": { "model": "stable-model", "temperature": 0.1 }
  },
  "notify": [
    { "type": "webhook", "url": "..." },
    { "type": "telegram", "botToken": "...", "chatId": "..." }
  ],
  "detection": { "enabled": false, ... },
  "qualityGates": {
    "maxAuditRetries": 2,
    "pauseAfterConsecutiveFailures": 3
  },
  "inputGovernanceMode": "full"
}
```

Per-book configuration in `books/<id>/book.json`:
```json
{
  "id": "my-novel",
  "title": "My Novel",
  "platform": "tomato",
  "genre": "litrpg",
  "status": "active",
  "targetChapters": 200,
  "chapterWordCount": 3000,
  "language": "zh",
  "writingRules": { "numericExpressionMode": "immersive" }
}
```

---

## File System Layout (per project)

```
<project-root>/
├── inkos.json              # project configuration
├── .env                    # API keys (local)
├── books/
│   └── <book-id>/
│       ├── book.json       # book configuration
│       └── story/
│           ├── author_intent.md          # long-horizon vision
│           ├── current_focus.md          # active priorities (1-3 chapters)
│           ├── current_state.md          # canonical state card
│           ├── particle_ledger.md        # resource/value ledger
│           ├── pending_hooks.md          # plot hooks registry
│           ├── book_rules.md             # genre rules
│           ├── volume_outline.md         # volume-level outline
│           ├── foundation/               # world-building docs
│           ├── chapters/                 # chapter files (0001_title.md)
│           ├── chapters-fixed/           # revised chapters
│           ├── chapters-polished/        # polished chapters (Fanqie quality)
│           ├── chapters-salvaged/        # salvaged chapters
│           ├── reviews/
│           │   └── continuity/           # audit reports
│           └── runtime/                  # runtime state snapshots
│               ├── narrative_memory_seed.json
│               ├── chapter_intent/
│               ├── context_package/
│               ├── rule_stack/
│               └── chapter_trace/
└── sessions/               # interaction sessions
```

---

## Key Design Patterns

### 1. Agent Pattern
All agents extend `BaseAgent` which provides LLM access via `this.chat(messages)`. Each agent has a `name` getter and an `execute`-style method. Agents are stateless — they receive input, call LLM, return structured output.

### 2. Pipeline Pattern
`PipelineRunner` orchestrates agents in a defined sequence. Each step produces a typed result. The runner handles error recovery, token tracking, length governance, and state persistence.

### 3. State Card + Ledger + Hooks
The "three truth files" pattern: current state (what's happening now), particle ledger (resource economy), pending hooks (foreshadowing debt). These are markdown for human readability but parsed for structured access.

### 4. Model Routing
Agent-level model overrides allow different LLM models per agent. The `agentCtxFor(agentName)` method in `PipelineRunner` resolves the correct client, model, temperature, and maxTokens for each agent.

### 5. Zod Schema Validation
All domain models, config, and API inputs/outputs use Zod schemas. This provides runtime type safety and validation at system boundaries.

### 6. File-Based Persistence
No database — all state is markdown and JSON files on disk. This makes the system portable, git-friendly, and transparent to the user.

### 7. Event-Driven Interaction
The interaction system uses typed events (`InteractionEvent`) with status tracking (`ExecutionStatus`), enabling both synchronous and asynchronous conversation patterns across CLI and Studio.

---

## Technology Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.8 (ESM) |
| Package Manager | pnpm 9+ (workspace) |
| LLM Abstraction | `@mariozechner/pi-ai` (0.67.1), `@mariozechner/pi-agent-core` (0.67.1) |
| Schema Validation | Zod 3.24 |
| CLI Framework | Commander 13, Ink 7 (React for terminal) |
| Terminal Markdown | marked 15 + marked-terminal 7 |
| Web Server | Hono 4.7 |
| Frontend | React 19, Vite 6, Tailwind CSS 4, shadcn/ui |
| State Management | Zustand 5 |
| Testing | Vitest 3 |
| EPUB Export | epub-gen-memory 1 |
