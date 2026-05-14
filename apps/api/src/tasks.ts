import type { BenchmarkTaskDefinition } from "@agent-visibility/shared";

export const BENCHMARK_TASKS: BenchmarkTaskDefinition[] = [
  {
    id: "bugfix_auth_01",
    label: "Complex Auth Session Regression",
    category: "bugfix",
    prompt:
      "A critical intermittent bug has been reported in the production authentication service. User sessions are expiring exactly 15 minutes early, but only when the client device wakes from a deep sleep state of more than 2 hours. This suggests a potential desynchronization between the JWT expiration time, the local system clock, and the server-side session store. You must: 1. Map out the authentication lifecycle across client and server. 2. Identify the most likely mathematical or logical error in the time calculation. 3. Propose a robust patch that centralizes time arithmetic. 4. Define a suite of regression tests including clock-skew simulations and lifecycle event hooks.",
    evaluationFocus: [
      "Clock desync handling",
      "Lifecycle edge cases",
      "Patch robustness",
      "Test coverage depth"
    ]
  },
  {
    id: "refactor_parser_01",
    label: "Modularizing Legacy Data Pipeline",
    category: "refactor",
    prompt:
      "The core data ingestion module is currently a 5,000-line monolithic CSV parser that handles schema validation, data transformation, and database persistence in a single pass. This has become a maintenance bottleneck and prevents parallelizing the ingestion flow. Your task is to: 1. Define clear module boundaries for Schema Validation, Type Transformation, and Sink Persistence. 2. Design an internal interface that allows these modules to communicate via a stream-based API. 3. Provide a phased migration plan that allows replacing the old parser without downtime. 4. Implement unit tests for each new module and an integration test for the full pipeline.",
    evaluationFocus: [
      "Modular separation",
      "API design quality",
      "Migration safety",
      "Performance implications"
    ]
  },
  {
    id: "analysis_perf_01",
    label: "Distributed System Latency Audit",
    category: "analysis",
    prompt:
      "Following the deployment of a new service mesh and global request tracing, the p99 latency of the user-profile API has jumped from 200ms to 850ms. Preliminary logs show high contention in the distributed cache layer and increased TLS handshake overhead. You must: 1. Analyze the trace logs to identify the critical path bottleneck. 2. Determine if the latency is caused by the tracing overhead itself or a regression in the cache invalidation logic. 3. Recommend a prioritized list of optimizations. 4. Propose a monitoring dashboard configuration to catch similar regressions in the future.",
    evaluationFocus: [
      "Bottleneck identification",
      "Tracing overhead analysis",
      "Remediation priority",
      "Observability strategy"
    ]
  },
  {
    id: "custom",
    label: "Custom Experiment",
    category: "analysis",
    prompt: "A custom task defined by the user.",
    evaluationFocus: ["Prompt adherence", "Solution clarity", "Risk assessment"]
  }
];

export function getTaskById(taskId: string) {
  return BENCHMARK_TASKS.find((task) => task.id === taskId) ?? null;
}
