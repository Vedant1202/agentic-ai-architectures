# Agent Architecture Visibility

This project now treats the UI and the harness as separate layers.

The core idea is:

1. Run the same task across multiple agent architectures.
2. Capture normalized metrics for each run.
3. Score quality in a repeatable way.
4. Visualize tradeoffs such as quality vs cost vs latency vs coordination overhead.

## What To Measure

Use four metric families for every run:

- Outcome quality: pass/fail, test count, rubric score, diff size, regression count
- Efficiency: input tokens, output tokens, reasoning tokens if available, total cost, wall-clock time
- Local resource usage: CPU percent, peak RSS, child process count, tool-call count
- Coordination overhead: number of agents, handoffs, retries, merge conflicts, review loops

## Recommended Architecture Modes

Use architecture labels that are tool-agnostic:

- `single`: one agent does the whole task
- `centralized`: one orchestrator delegates bounded subtasks to workers and merges results
- `hybrid`: orchestrator + specialists + reviewer or verifier
- `decentralized_emulated`: multiple peer workers exchange summaries through a shared state store or message bus

The last one is intentionally called `decentralized_emulated` because most coding tools do not expose true peer-to-peer agent autonomy as a first-class product feature.

## Codex Feasibility

Codex is viable for this project, but with an important limitation:

- Codex supports subagents and parallel work.
- Codex does not expose built-in architecture presets like "centralized", "decentralized", or "hybrid".
- Those architectures need to be implemented by your harness and prompts.

Practical reading:

- Codex subagents are explicit and parallel-friendly.
- Codex app supports parallel threads and worktrees.
- OpenAI's broader agent stack is stronger than Codex itself for structured telemetry.

## Best Way To Use Codex Here

There are two different ways to use Codex for this project:

### Option A: Codex app or CLI as the subject under test

Use the Codex product directly and treat each run as a black-box experiment.

Pros:

- Most realistic "what a developer actually experiences"
- Good for demos of agent orchestration behavior
- Easy to compare UX patterns like single-agent vs explicit subagent prompts

Cons:

- Token and internal orchestration telemetry are less structured than API-first setups
- CPU and memory need external instrumentation
- Architecture control is prompt-driven, not a formal runtime graph

### Option B: OpenAI API or Agents SDK as the Codex-like benchmark backend

Use GPT-5.5, GPT-5.4, GPT-5.4-mini, or GPT-5.3-Codex style models behind your own orchestrator.

Pros:

- Best option for rigorous comparisons
- Full control over orchestration logic
- Structured usage data and traces
- Easier to implement repeatable centralized, hybrid, and decentralized-style harnesses

Cons:

- Less identical to the Codex desktop product experience
- More engineering work up front

## Tool Comparison

### Codex

Best for:

- Prompt-defined multi-agent experiments
- Explicit parallel worker runs
- Comparing real coding-agent UX

Weak points:

- No built-in named architecture modes
- No first-class CPU or memory metrics
- More limited observability than a custom API harness

Verdict:

- Good for qualitative and semi-quantitative benchmarking
- Better when paired with an external metrics collector

### Claude Code

Best for:

- Strong subagent workflows
- More mature built-in observability for usage and cost
- Comparing automatic delegation vs explicit delegation

Weak points:

- Still not a formal architecture lab by itself
- CPU and memory still need host-level instrumentation

Verdict:

- Strong alternative, especially if metrics collection matters

### Antigravity

Best for:

- Agent-manager style demos
- Multi-agent orchestration narratives
- Artifact-heavy visual workflows across editor, terminal, and browser

Weak points:

- Public observability surface appears less formal than Claude Code telemetry
- Better for showcasing orchestration than for rigorous low-level measurement unless you can export stable logs

Verdict:

- Good exploratory comparison target
- Not my first choice for the benchmark baseline

## Recommended MVP

Build the first version around a custom harness with adapters.

### Harness layers

- `tasks/`: benchmark task specs
- `runners/`: codex, claude, antigravity, openai-api adapters
- `architectures/`: single, centralized, hybrid, decentralized_emulated
- `collectors/`: tokens, time, CPU, memory, tool events
- `scorers/`: tests, rubric grading, diff analysis
- `ui/`: dashboard and architecture diagrams

### Run record

Each experiment run should save a normalized record like:

```json
{
  "run_id": "uuid",
  "tool": "codex",
  "architecture": "hybrid",
  "task_id": "bugfix_auth_01",
  "model_family": "gpt-5.5",
  "agent_count": 3,
  "started_at": "2026-05-13T23:00:00Z",
  "duration_ms": 182000,
  "tokens": {
    "input": 12000,
    "output": 3400,
    "reasoning": 2100,
    "total": 17500
  },
  "resources": {
    "cpu_avg_pct": 38.2,
    "cpu_peak_pct": 91.4,
    "rss_peak_mb": 1420
  },
  "quality": {
    "tests_passed": 18,
    "tests_failed": 1,
    "rubric_score": 0.82
  },
  "coordination": {
    "handoffs": 4,
    "retries": 1,
    "merge_conflicts": 0
  }
}
```

## Suggested Visualization Set

Start with four charts:

- Architecture diagram per run
- Scatter plot: quality vs total tokens
- Bar chart: wall time and CPU by architecture
- Sankey or timeline: handoffs between agents

Then add filters for:

- task type
- tool
- architecture
- model
- number of workers

## Recommended Build Order

1. Start with one task and one tool: Codex.
2. Compare `single` vs `centralized` vs `hybrid`.
3. Add host-level CPU and memory sampling.
4. Save runs to JSONL or SQLite.
5. Add Claude Code as the second adapter.
6. Add an API-based OpenAI harness for stricter repeatability.
7. Add Antigravity only after the data model is stable.

## Bottom Line

Yes, this project is feasible.

The cleanest path is:

- Use Codex first for the initial user-facing benchmark
- Do not rely on Codex alone for architecture control or telemetry
- Build your own orchestration harness and metrics layer
- Add Claude Code as the strongest comparison target
- Treat Antigravity as a useful demo-oriented alternative, not the primary benchmark baseline

## Current Scaffold

The repository now includes a TypeScript starter stack:

- `apps/web`: React + Vite dashboard
- `apps/api`: Express API serving benchmark runs
- `packages/shared`: shared experiment types and architecture metadata
- `data/runs.sample.json`: sample run dataset to drive the first dashboard

### Quickstart

1. Install dependencies:

   `npm install`

2. Optional: configure Gemini for live runs:

   Copy `.env.example` to `.env.local` and set:

   `GEMINI_API_KEY=...`

   You can also use `GOOGLE_API_KEY`. If neither variable is present, the benchmark runner stays usable in a clearly labeled simulated mode.

3. Start the API:

   `npm run dev:api`

4. In a second terminal, start the dashboard:

   `npm run dev:web`

5. Open the Vite URL, typically `http://localhost:5173`

### Current Backend Choice

The first real harness path is:

- `LangGraph JS` for orchestration
- `Gemini` as the default hosted model provider
- local simulated fallback when Gemini credentials are missing

This means the dashboard can now create new runs through the Node API instead of relying only on the seeded sample dataset.

### What To Build Next

- Add SQLite storage in place of the local JSON run store
- Add richer host metrics sampling and per-node tracing
- Add a Codex adapter as a benchmark target rather than the primary orchestration engine
- Add Claude Code and Ollama adapters behind the same run schema
