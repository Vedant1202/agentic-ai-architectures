export type ToolName =
  | "codex"
  | "claude-code"
  | "antigravity"
  | "openai-api"
  | "langgraph-gemini";

export type ArchitectureName =
  | "single"
  | "centralized"
  | "hybrid"
  | "decentralized"
  | "dynamic_swarm";

export type Outcome = "pass" | "partial" | "fail";

export interface TokenMetrics {
  input: number;
  output: number;
  reasoning: number;
  total: number;
  costUsd?: number;
}

export interface ResourceMetrics {
  cpuAvgPct: number;
  cpuPeakPct: number;
  rssPeakMb: number;
  childProcessCount: number;
  toolCallCount: number;
}

export interface QualityMetrics {
  testsPassed: number;
  testsFailed: number;
  rubricScore: number;
  regressionCount: number;
}

export interface CoordinationMetrics {
  handoffs: number;
  retries: number;
  mergeConflicts: number;
  reviewLoops: number;
}

export interface ExperimentRun {
  runId: string;
  tool: ToolName;
  architecture: ArchitectureName;
  taskId: string;
  taskLabel: string;
  dataset: "sample" | "observed" | "simulated";
  startedAt: string;
  durationMs: number;
  modelFamily: string;
  agentCount: number;
  outcome: Outcome;
  tokens: TokenMetrics;
  resources: ResourceMetrics;
  quality: QualityMetrics;
  coordination: CoordinationMetrics;
  executionMode?: "live" | "simulated";
  notes?: string;
}

export interface ToolDefinition {
  name: ToolName;
  label: string;
  telemetryStrength: "low" | "medium" | "high";
  summary: string;
}

export interface ArchitectureDefinition {
  name: ArchitectureName;
  label: string;
  summary: string;
  tradeoff: string;
  color: string;
}

export interface BenchmarkTaskDefinition {
  id: string;
  label: string;
  category: "bugfix" | "refactor" | "analysis";
  prompt: string;
  evaluationFocus: string[];
}

export interface RunnerStatus {
  label: string;
  provider: "gemini";
  configured: boolean;
  mode: "live" | "simulated";
  model: string;
  envVars: string[];
  summary: string;
}

export interface DatasetOverviewResponse {
  generatedAt: string;
  mode: "sample" | "mixed" | "observed" | "simulated";
  runs: ExperimentRun[];
  tools: ToolDefinition[];
  architectures: ArchitectureDefinition[];
  taskOptions: Array<{
    id: string;
    label: string;
  }>;
  benchmarkTasks: BenchmarkTaskDefinition[];
  runner: RunnerStatus;
}

export interface BenchmarkRunRequest {
  taskId: string;
  architecture: ArchitectureName;
  persist?: boolean;
  customPrompt?: string;
}

export interface NodeTraceEvent {
  node: string;
  label: string;
  status: "running" | "complete" | "error";
  output?: string;
  tokens?: number;
}

export interface NodeStreamEvent {
  node: string;
  text: string;
}

export interface EdgeTraceEvent {
  source: string;
  target: string;
}

export interface LiveProgressSnapshot {
  elapsedMs: number;
  handoffs: number;
  toolCalls: number;
  tokens: TokenMetrics;
}

export interface LiveErrorDetails {
  kind: "node_failure" | "rate_limit" | "network" | "stream_disconnect" | "unknown";
  message: string;
  node?: string;
  nodeLabel?: string;
  retryable: boolean;
}

export interface LiveUpdate {
  architecture: ArchitectureName;
  type: "trace" | "node_event" | "node_stream" | "graph_edge" | "metrics" | "progress" | "complete" | "error";
  data: any;
}

export interface BenchmarkRunResponse {
  persisted: boolean;
  run: ExperimentRun;
  runner: RunnerStatus;
  trace: string[];
}
