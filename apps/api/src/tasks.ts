import type { BenchmarkTaskDefinition } from "@agent-visibility/shared";

export const BENCHMARK_TASKS: BenchmarkTaskDefinition[] = [
  {
    id: "single_sequential_01",
    label: "Sequential Release Recovery Plan",
    category: "analysis",
    taskShape: "sequential",
    expectedBestArchitecture: "single",
    prompt:
      "A production release failed midway through a 14-step database and service migration. Each step depends on the exact output of the previous step, and several partial changes are already live. Your task is to: 1. Reconstruct the current system state from the failed sequence. 2. Identify the first invalid transition in the chain. 3. Produce a strict next-step recovery plan with rollback checkpoints after each action. 4. Define validation checks that must pass before moving to the next step. This task is intentionally sequential and should reward a single coherent reasoning thread.",
    evaluationFocus: [
      "Sequential dependency handling",
      "Recovery plan correctness",
      "Checkpoint discipline",
      "Validation quality"
    ],
    evaluationCriteria: [
      "Reconstructs the partial release state before proposing actions",
      "Identifies the first invalid transition in the sequence",
      "Provides a strictly ordered recovery plan",
      "Includes rollback checkpoints after major actions",
      "Defines validation checks before each next step"
    ]
  },
  {
    id: "centralized_parallel_01",
    label: "Parallel Vendor Risk Review",
    category: "analysis",
    taskShape: "parallel",
    expectedBestArchitecture: "centralized",
    prompt:
      "Your team must evaluate whether to renew a large enterprise contract with a software vendor. The decision depends on four largely independent workstreams: security posture, pricing trends, incident history, and integration cost. Your task is to: 1. Break the problem into parallel sub-analyses. 2. Define the evidence each workstream must collect. 3. Synthesize the findings into one renewal recommendation with clear justification. 4. List the highest-risk unknowns that require follow-up. This task is highly decomposable and should reward centralized coordination.",
    evaluationFocus: [
      "Task decomposition quality",
      "Parallel evidence gathering",
      "Synthesis quality",
      "Decision clarity"
    ],
    evaluationCriteria: [
      "Separates the problem into independent workstreams",
      "Specifies evidence needed for each workstream",
      "Synthesizes the findings into one recommendation",
      "Names key unknowns and follow-up actions",
      "Explains why the final decision follows from the evidence"
    ]
  },
  {
    id: "hybrid_verification_01",
    label: "Authentication Patch With Independent Verification",
    category: "bugfix",
    taskShape: "verification",
    expectedBestArchitecture: "hybrid",
    prompt:
      "A payment platform has an intermittent authentication bug that appears only during token refresh under clock skew and network retry conditions. Your task is to: 1. Isolate the likely root cause. 2. Propose a code-level patch. 3. Define a verification pass that independently checks the patch for missed edge cases. 4. Produce a final recommendation that includes both the implementation plan and the verifier's concerns. This task should reward a specialized worker flow plus an explicit review stage.",
    evaluationFocus: [
      "Root cause precision",
      "Patch quality",
      "Independent verification quality",
      "Edge case coverage"
    ],
    evaluationCriteria: [
      "Identifies a plausible root cause tied to refresh or clock skew behavior",
      "Proposes a concrete implementation patch",
      "Includes an independent verification or review pass",
      "Covers edge cases such as retry timing and skew",
      "Surfaces residual risks after the patch"
    ]
  },
  {
    id: "decentralized_consensus_01",
    label: "Cross-Team Interface Negotiation",
    category: "refactor",
    taskShape: "consensus",
    expectedBestArchitecture: "decentralized",
    prompt:
      "Three backend teams own separate services that must agree on a new event schema before a shared rollout. Each team has different constraints, and no single team has full authority over the others. Your task is to: 1. Capture the likely priorities and objections of each team. 2. Reconcile the conflicts into one schema proposal. 3. Identify where peer-to-peer negotiation is necessary. 4. Produce a migration plan that minimizes interface churn. This example is designed to stress peer coordination and consensus formation.",
    evaluationFocus: [
      "Conflict reconciliation",
      "Consensus quality",
      "Schema design quality",
      "Migration practicality"
    ],
    evaluationCriteria: [
      "Captures distinct priorities for the participating teams",
      "Reconciles conflicting constraints into one proposal",
      "Identifies where peer negotiation is needed",
      "Produces a schema proposal with practical migration steps",
      "Minimizes rollout risk and interface churn"
    ]
  },
  {
    id: "dynamic_swarm_01",
    label: "Open-Ended Incident Triage",
    category: "analysis",
    taskShape: "open_ended",
    expectedBestArchitecture: "dynamic_swarm",
    prompt:
      "A major customer reports a severe slowdown, but the root cause is unknown. The issue could involve application code, database saturation, cache invalidation, network policy changes, or a recent deployment. Your task is to: 1. Determine which specialist investigations are needed. 2. Decide the order in which they should be launched. 3. Adapt the plan as new evidence arrives. 4. Produce a final incident summary with the most likely cause, next actions, and residual uncertainty. This task is intentionally open-ended and should reward adaptive specialist spawning.",
    evaluationFocus: [
      "Adaptive decomposition",
      "Investigation prioritization",
      "Evidence integration",
      "Incident summary quality"
    ],
    evaluationCriteria: [
      "Identifies multiple plausible specialist investigations",
      "Prioritizes investigations in a sensible order",
      "Adapts the plan based on emerging evidence",
      "Produces a final summary with likely cause and next actions",
      "Explicitly states residual uncertainty"
    ]
  },
  {
    id: "custom",
    label: "Custom Experiment",
    category: "analysis",
    taskShape: "open_ended",
    prompt: "A custom task defined by the user.",
    evaluationFocus: ["Prompt adherence", "Solution clarity", "Risk assessment"],
    evaluationCriteria: [
      "Addresses the requested task directly",
      "Provides a coherent and usable response",
      "Calls out major risks or uncertainties"
    ]
  }
];

export function getTaskById(taskId: string) {
  return BENCHMARK_TASKS.find((task) => task.id === taskId) ?? null;
}
