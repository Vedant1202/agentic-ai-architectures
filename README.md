# Agent Architecture Evaluation & Metrics

A real-time benchmarking platform for comparing multi-agent LLM architectures. Run the same task across multiple agent topologies simultaneously and observe token usage, execution traces, coordination patterns, and post-run evaluation scores — all live, as they happen.

Inspired by the Google Research paper: [Towards a Science of Scaling Agent Systems: When and Why Agent Systems Work](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) (Kim & Liu, 2026).

---

## What It Does

- **Parallel benchmark execution** — run up to 5 agent architectures side-by-side on the same task
- **Real-time streaming** — token counts, node traces, and agent handoffs update live via Server-Sent Events
- **Post-run LLM evaluation** — an independent judge model scores quality, criteria coverage, and confidence after each run
- **Interactive architecture graphs** — animated node graphs visualize the agent topology and execution path in real time
- **Comparative bar charts** — side-by-side charts across architectures for judge score, criteria coverage, token usage, agent handoffs, and model calls
- **Light / dark theme** — toggle between themes with a blue-accented glassmorphic design system

---

## Architectures Supported

| Architecture | Description |
|---|---|
| `single` | One agent handles the full task sequentially |
| `centralized` | Orchestrator delegates bounded subtasks to specialist workers and merges results |
| `hybrid` | Orchestrator + specialists + reviewer; combines hierarchical control with peer refinement |
| `decentralized` | Peer agents debate and cross-validate; no central orchestrator |
| `dynamic_swarm` | Runtime-adaptive topology; agent roles and connections form based on task structure |

---

## Metrics Tracked

### In-Task Execution (live, streaming)
| Metric | Description |
|---|---|
| Total tokens | Cumulative input + output token count, updating as each node completes |
| Output / input ratio | Generated tokens ÷ prompt tokens — proxy for agent verbosity |
| Duration | Wall-clock time from first node to last |
| Model calls | Total LLM invocations across all nodes |
| Agent handoffs | Inter-agent delegation events (coordination overhead) |

### Post-Completion Evaluation (computed after run)
| Metric | Description |
|---|---|
| Judge score | Holistic rubric scored 0–100% by an independent evaluator model |
| Criteria coverage | Fraction of the task's evaluation checklist satisfied |
| Evaluator confidence | The judge model's self-reported certainty in its assessment |
| Test reliability | Automated test pass rate (where applicable) |
| Outcome | Binary classification: `pass`, `partial`, or `fail` |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript |
| Backend | Node.js + Express + TypeScript |
| Orchestration | LangGraph JS (`@langchain/langgraph`) |
| Model | Google Gemini (via `@langchain/google`) |
| Graph visualization | React Flow |
| Charts | Recharts |
| Shared types | `packages/shared` monorepo package |

---

## Quickstart

### 1. Install dependencies

```bash
npm install
```

### 2. Configure your API key

Copy `.env.example` to `.env` and set your Gemini API key:

```bash
cp .env.example .env
# then edit .env:
GEMINI_API_KEY=your_key_here
```

> If no key is provided, the runner falls back to a clearly-labeled **simulated mode** so the dashboard remains functional for UI development.

### 3. Start the API server

```bash
npm run dev:api
# Runs on http://localhost:3001
```

### 4. Start the dashboard

```bash
npm run dev:web
# Runs on http://localhost:5173
```

---

## Project Structure

```
agent-visibility-project/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── index.ts            # Express server + SSE streaming endpoint
│   │       ├── langgraphRunner.ts  # LangGraph orchestration for all 5 architectures
│   │       ├── tasks.ts            # Benchmark task definitions
│   │       └── storage.ts          # JSON-based run persistence
│   └── web/
│       └── src/
│           ├── App.tsx             # Dashboard UI, live state management, charts
│           ├── AnimatedAgentGraph.tsx  # React Flow architecture graph component
│           └── styles.css          # Design system (glassmorphic, blue-accented)
├── packages/
│   └── shared/
│       └── src/
│           └── types.ts            # Shared TypeScript types (ExperimentRun, LiveUpdate, etc.)
├── data/
│   ├── runs.sample.json            # Seeded sample dataset for UI development
│   └── runs.user.json              # Persisted live benchmark runs
├── BENCHMARK_METRICS_GUIDE.md      # Full metric definitions and calculation formulas
└── .env.example
```

---

## How the Benchmark Runner Works

Each architecture is implemented as a distinct **LangGraph state machine**:

- **Single**: `planner → researcher → implementer → reviewer`
- **Centralized**: `orchestrator → [specialist_A, specialist_B, specialist_C] → synthesizer`
- **Hybrid**: `orchestrator → [researcher, implementer] → reviewer → synthesizer`
- **Decentralized**: `agent_A ↔ agent_B ↔ agent_C` (peer debate, no central orchestrator)
- **Dynamic Swarm**: orchestrator dynamically spawns and routes to specialist nodes at runtime

Runs stream progress via **Server-Sent Events** (`/api/benchmark/stream`). The frontend consumes this stream and updates charts, graphs, and token counters in real time.

Post-run, an independent **judge node** evaluates the final answer against the task's evaluation criteria and emits a structured score.

---

## Benchmark Tasks

Pre-built task categories:

| Category | Examples |
|---|---|
| `bugfix` | Fix a broken auth function, debug an async race condition |
| `refactor` | Decompose a monolithic module, apply a design pattern |
| `analysis` | Summarize a codebase, identify performance bottlenecks |

Tasks define: prompt, evaluation criteria checklist, expected best architecture, and task shape (`sequential`, `parallel`, `verification`, `consensus`, `open_ended`).

Custom tasks can be entered directly in the dashboard.

---

## Research Context

This platform operationalizes the key measurements from [Kim & Liu (2026)](https://arxiv.org/abs/2512.08296):

- **Task Success Rate** — tracked as `outcome` (pass/partial/fail) per run
- **Coordination Overhead** — tracked as agent handoffs and model calls
- **Architecture-specific tradeoffs** — the paper found centralized systems contain error amplification best (4.4×) while independent systems can amplify errors up to 17.2×; parallel tasks benefit most from multi-agent coordination (+81% on Finance-Agent), while sequential tasks degrade (-70% on PlanCraft)

The dashboard does **not** use an invented composite score — all displayed metrics are either directly measured or produced by the evaluator model.

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Stable, current release |
| `dev` | Active development |
