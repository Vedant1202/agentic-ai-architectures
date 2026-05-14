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
    summary: "One agent owns the full loop from understanding through implementation.",
    tradeoff: "Lowest coordination cost, but can stall on search-heavy or multi-file work.",
    color: "#f97316"
  },
  {
    name: "centralized",
    label: "Centralized",
    summary: "A coordinator delegates bounded tasks to workers, then merges the results.",
    tradeoff: "Reliable control surface, with moderate token overhead.",
    color: "#0f766e"
  },
  {
    name: "hybrid",
    label: "Hybrid",
    summary: "A coordinator uses specialists plus a reviewer or verifier before final output.",
    tradeoff: "Often the best quality, but with more orchestration work.",
    color: "#2563eb"
  },
  {
    name: "decentralized_emulated",
    label: "Decentralized (Emulated)",
    summary: "Multiple workers act like peers and synchronize through shared summaries or state.",
    tradeoff: "Great for experiments, but higher conflict and coordination overhead.",
    color: "#7c3aed"
  }
];
