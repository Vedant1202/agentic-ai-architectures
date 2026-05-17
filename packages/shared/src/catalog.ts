import type { ArchitectureDefinition, ToolDefinition } from "./types.js";

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "codex",
    label: "Codex",
    telemetryStrength: "medium",
    summary: "Strong fit for prompt-defined subagent experiments and real-world coding flows."
  },
  {
    name: "claude-code",
    label: "Claude Code",
    telemetryStrength: "high",
    summary: "Strong subagent support with first-class telemetry via OpenTelemetry."
  },
  {
    name: "antigravity",
    label: "Antigravity",
    telemetryStrength: "low",
    summary: "Compelling manager-surface orchestration story, best treated as exploratory for now."
  },
  {
    name: "openai-api",
    label: "OpenAI API",
    telemetryStrength: "high",
    summary: "Best option when you want full orchestration control and structured usage data."
  },
  {
    name: "langgraph-gemini",
    label: "LangGraph + Gemini",
    telemetryStrength: "high",
    summary: "Provider-agnostic orchestration graph with Gemini as the default low-cost or free-tier runner."
  }
];

export const ARCHITECTURE_DEFINITIONS: ArchitectureDefinition[] = [
  {
    name: "single",
    label: "Single Agent",
    summary: "One agent keeps the full reasoning chain, context, and action loop in one place.",
    tradeoff: "Best for strict sequential tasks where coordination overhead would fragment the work.",
    color: "#f97316"
  },
  {
    name: "centralized",
    label: "Centralized",
    summary: "A coordinator decomposes the task, delegates parallel work, and synthesizes one answer.",
    tradeoff: "Strong fit for decomposable workstreams, with a manageable orchestration tax.",
    color: "#0f766e"
  },
  {
    name: "hybrid",
    label: "Hybrid",
    summary: "A coordinator uses specialists, then routes outputs through review or verification.",
    tradeoff: "Useful when independent checks improve reliability enough to justify extra tokens.",
    color: "#2563eb"
  },
  {
    name: "decentralized",
    label: "Decentralized",
    summary: "Peer agents reason from different positions and negotiate toward a shared result.",
    tradeoff: "Useful for consensus-heavy work, but communication can amplify cost and conflict.",
    color: "#7c3aed"
  },
  {
    name: "dynamic_swarm",
    label: "Dynamic Swarm",
    summary: "A manager adapts mid-run and spawns specialists as the task reveals new needs.",
    tradeoff: "Best for open-ended exploration, but expensive in tokens, calls, and tool coordination.",
    color: "#eab308"
  }
];
