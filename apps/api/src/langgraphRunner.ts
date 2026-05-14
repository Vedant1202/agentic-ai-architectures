import process from "node:process";
import { randomUUID } from "node:crypto";
import { ChatGoogle } from "@langchain/google";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import type {
  ArchitectureName,
  BenchmarkRunRequest,
  BenchmarkRunResponse,
  BenchmarkTaskDefinition,
  ExperimentRun,
  LiveProgressSnapshot,
  LiveUpdate,
  NodeTraceEvent,
  Outcome,
  RunnerStatus
} from "@agent-visibility/shared";

const DEFAULT_MODEL = "gemma-4-26b-a4b-it";
const getGoogleKey = () => process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

const GraphState = Annotation.Root({
  taskPrompt: Annotation<string>(),
  taskLabel: Annotation<string>(),
  architecture: Annotation<ArchitectureName>(),
  plannerBrief: Annotation<string>({ value: (_current, update) => update, default: () => "" }),
  researchNotes: Annotation<string>({ value: (_current, update) => update, default: () => "" }),
  implementationPlan: Annotation<string>({ value: (_current, update) => update, default: () => "" }),
  reviewNotes: Annotation<string>({ value: (_current, update) => update, default: () => "" }),
  finalAnswer: Annotation<string>({ value: (_current, update) => update, default: () => "" }),
  trace: Annotation<string[]>({
    reducer: (current, update) => current.concat(update),
    default: () => []
  }),
  handoffs: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0
  }),
  modelCalls: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0
  })
});

const EvaluationSchema = z.object({
  rubricScore: z.number().min(0).max(1),
  outcome: z.enum(["pass", "partial", "fail"]),
  testsPassed: z.number().int().min(0),
  testsFailed: z.number().int().min(0),
  regressionCount: z.number().int().min(0),
  criteriaMet: z.number().int().min(0),
  confidenceScore: z.number().min(0).max(1),
  rationale: z.string()
});

type Evaluation = z.infer<typeof EvaluationSchema>;

export async function runBenchmark(
  request: BenchmarkRunRequest,
  task: BenchmarkTaskDefinition,
  onUpdate?: (update: LiveUpdate) => void
): Promise<BenchmarkRunResponse> {
  const runtime = createRuntime();
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const trace: string[] = [];
  const emitProgress = (snapshot: LiveProgressSnapshot) => {
    onUpdate?.({ architecture: request.architecture, type: "progress", data: snapshot });
  };

  const sampled = await sampleProcessUsage(async () => {
    const graph = buildArchitectureGraph(
      request.architecture,
      runtime,
      trace,
      startedAtMs,
      emitProgress,
      onUpdate
    );
    const finalState = await graph.invoke({
      taskPrompt: request.customPrompt || task.prompt,
      taskLabel: request.customPrompt ? "Custom Task" : task.label,
      architecture: request.architecture
    });
    const evaluation = await evaluateRun(runtime, task, finalState.finalAnswer, request.architecture);
    emitProgress({
      elapsedMs: Date.now() - startedAtMs,
      handoffs: finalState.handoffs,
      toolCalls: runtime.getCallCount(),
      tokens: runtime.getTokenMetrics()
    });
    return { finalState, evaluation };
  }, onUpdate ? (resources) => onUpdate({ architecture: request.architecture, type: "metrics", data: resources }) : undefined);

  const run = buildRun({
    architecture: request.architecture,
    startedAt,
    durationMs: sampled.durationMs,
    task,
    runtime,
    graphTrace: sampled.result.finalState.trace.length > 0 ? sampled.result.finalState.trace : trace,
    handoffs: sampled.result.finalState.handoffs,
    modelCalls: runtime.getCallCount(),
    evaluation: sampled.result.evaluation,
    finalAnswer: sampled.result.finalState.finalAnswer,
    resources: sampled.resources
  });

  return {
    persisted: false,
    run,
    runner: runtime.getStatus(),
    trace: run.notes ? [...(sampled.result.finalState.trace.length > 0 ? sampled.result.finalState.trace : trace), run.notes] : sampled.result.finalState.trace
  };
}

export function getRunnerStatus(): RunnerStatus {
  return createRuntime().getStatus();
}

function buildArchitectureGraph(
  architecture: ArchitectureName,
  runtime: Runtime,
  trace: string[],
  startedAtMs: number,
  onProgress: (snapshot: LiveProgressSnapshot) => void,
  onUpdate?: (update: LiveUpdate) => void
) {
  const builder = new StateGraph(GraphState) as any;
  let currentHandoffs = 0;

  const emitProgress = (tokens = runtime.getTokenMetrics()) => {
    onProgress({
      elapsedMs: Date.now() - startedAtMs,
      handoffs: currentHandoffs,
      toolCalls: runtime.getCallCount(),
      tokens
    });
  };

  const emitTrace = (line: string) => {
    trace.push(line);
    if (onUpdate) {
      onUpdate({ architecture, type: "trace", data: line });
    }
    emitProgress();
  };

  const emitNodeEvent = (event: NodeTraceEvent) => {
    if (onUpdate) {
      onUpdate({ architecture, type: "node_event", data: event });
    }
    emitProgress();
  };

  const recordHandoffs = (count: number) => {
    currentHandoffs += count;
    emitProgress();
  };

  const planNode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "plan", label: "Planner", status: "running" });
    emitTrace("Planner started.");
    const startTokens = runtime.getTokenMetrics().total;

    const plannerBrief = await runtime.generateTextStream(
      "planner",
      [
        "You are the orchestration planner for a coding benchmark.",
        "Summarize the approach in 3 bullets, explicitly naming what should be delegated."
      ].join(" "),
      taskBlock(state.taskLabel, state.taskPrompt),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "plan", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "plan", label: "Planner", status: "complete", output: plannerBrief, tokens: tokensUsed });

    const line = `Planner framed the ${labelForArchitecture(state.architecture)} run.`;
    emitTrace(line);
    recordHandoffs(1);
    return {
      plannerBrief,
      trace: [line],
      handoffs: 1,
      modelCalls: 1
    };
  };

  const researchNode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "research", label: "Researcher", status: "running" });
    emitTrace("Researcher started.");
    const startTokens = runtime.getTokenMetrics().total;

    const researchNotes = await runtime.generateTextStream(
      "researcher",
      [
        "You are the technical researcher inside a multi-agent benchmark.",
        "Focus on likely causes, missing information, and experiments.",
        "Be concise but specific."
      ].join(" "),
      [taskBlock(state.taskLabel, state.taskPrompt), `Planner brief:\n${state.plannerBrief}`].join("\n\n"),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "research", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "research", label: "Researcher", status: "complete", output: researchNotes, tokens: tokensUsed });

    const line = "Research specialist mapped risks and diagnostics.";
    emitTrace(line);
    recordHandoffs(1);
    return {
      researchNotes,
      trace: [line],
      handoffs: 1,
      modelCalls: 1
    };
  };

  const implementNode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "implement", label: "Implementer", status: "running" });
    emitTrace("Implementer started.");
    const startTokens = runtime.getTokenMetrics().total;

    const implementationPlan = await runtime.generateTextStream(
      "implementer",
      [
        "You are the implementation specialist.",
        "Produce a patch or refactor plan with concrete code-facing steps and tests.",
        "Use the research notes, and call out tradeoffs."
      ].join(" "),
      [
        taskBlock(state.taskLabel, state.taskPrompt),
        `Planner brief:\n${state.plannerBrief}`,
        `Research notes:\n${state.researchNotes}`
      ].join("\n\n"),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "implement", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "implement", label: "Implementer", status: "complete", output: implementationPlan, tokens: tokensUsed });

    const line = "Implementation specialist proposed code and test changes.";
    emitTrace(line);
    recordHandoffs(1);
    return {
      implementationPlan,
      trace: [line],
      handoffs: 1,
      modelCalls: 1
    };
  };

  const reviewNode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "review", label: "Verifier", status: "running" });
    emitTrace("Verifier started.");
    const startTokens = runtime.getTokenMetrics().total;

    const reviewNotes = await runtime.generateTextStream(
      "reviewer",
      [
        "You are the verifier in a benchmark harness.",
        "Critique the plan, name the highest-risk blind spot, and suggest one concrete improvement."
      ].join(" "),
      [
        taskBlock(state.taskLabel, state.taskPrompt),
        `Implementation plan:\n${state.implementationPlan}`
      ].join("\n\n"),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "review", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "review", label: "Verifier", status: "complete", output: reviewNotes, tokens: tokensUsed });

    const line = "Verifier reviewed the proposed solution for gaps.";
    emitTrace(line);
    recordHandoffs(1);
    return {
      reviewNotes,
      trace: [line],
      handoffs: 1,
      modelCalls: 1
    };
  };

  const peerANode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "peer_a", label: "Peer A", status: "running" });
    emitTrace("Peer A started.");
    const startTokens = runtime.getTokenMetrics().total;

    const implementationPlan = await runtime.generateTextStream(
      "peer_a",
      "You are peer A in an decentralized benchmark. Produce an independent solution sketch.",
      taskBlock(state.taskLabel, state.taskPrompt),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "peer_a", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "peer_a", label: "Peer A", status: "complete", output: implementationPlan, tokens: tokensUsed });

    const line = "Peer A created an independent solution sketch.";
    emitTrace(line);
    recordHandoffs(1);
    return {
      implementationPlan,
      trace: [line],
      handoffs: 1,
      modelCalls: 1
    };
  };

  const peerBNode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "peer_b", label: "Peer B", status: "running" });
    emitTrace("Peer B started.");
    const startTokens = runtime.getTokenMetrics().total;

    const researchNotes = await runtime.generateTextStream(
      "peer_b",
      "You are peer B in an decentralized benchmark. Produce an alternative diagnosis and tests.",
      taskBlock(state.taskLabel, state.taskPrompt),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "peer_b", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "peer_b", label: "Peer B", status: "complete", output: researchNotes, tokens: tokensUsed });

    const line = "Peer B created an alternative diagnosis and test lens.";
    emitTrace(line);
    recordHandoffs(1);
    return {
      researchNotes,
      trace: [line],
      handoffs: 1,
      modelCalls: 1
    };
  };

  const peerMergeNode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "peer_merge", label: "Peer C (Merge)", status: "running" });
    emitTrace("Peer merge started.");
    const startTokens = runtime.getTokenMetrics().total;

    const reviewNotes = await runtime.generateTextStream(
      "peer_merge",
      [
        "You are peer C merging conflicting ideas in an decentralized benchmark.",
        "Synthesize the two proposals, name the conflict, and choose a direction."
      ].join(" "),
      [
        taskBlock(state.taskLabel, state.taskPrompt),
        `Peer A:\n${state.implementationPlan}`,
        `Peer B:\n${state.researchNotes}`
      ].join("\n\n"),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "peer_merge", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "peer_merge", label: "Peer C (Merge)", status: "complete", output: reviewNotes, tokens: tokensUsed });

    const line = "Peer C merged the independent proposals.";
    emitTrace(line);
    recordHandoffs(2);
    return {
      reviewNotes,
      trace: [line],
      handoffs: 2,
      modelCalls: 1
    };
  };

  const finalizeNode = async (state: typeof GraphState.State) => {
    emitNodeEvent({ node: "finalize", label: "Finalizer", status: "running" });
    emitTrace("Finalizer started.");
    const startTokens = runtime.getTokenMetrics().total;

    const finalAnswer = await runtime.generateTextStream(
      "finalizer",
      [
        "You are the final synthesizer for a coding benchmark run.",
        "Return a concise but concrete final response with: diagnosis, plan, tests, and residual risks."
      ].join(" "),
      [
        taskBlock(state.taskLabel, state.taskPrompt),
        optionalBlock("Planner brief", state.plannerBrief),
        optionalBlock("Research notes", state.researchNotes),
        optionalBlock("Implementation plan", state.implementationPlan),
        optionalBlock("Review notes", state.reviewNotes)
      ]
        .filter(Boolean)
        .join("\n\n"),
      (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "finalize", text } }),
      (tokens) => emitProgress(tokens)
    );

    const tokensUsed = runtime.getTokenMetrics().total - startTokens;
    emitNodeEvent({ node: "finalize", label: "Finalizer", status: "complete", output: finalAnswer, tokens: tokensUsed });

    const line = "Final synthesizer produced the benchmark answer.";
    emitTrace(line);
    return {
      finalAnswer,
      trace: [line],
      modelCalls: 1
    };
  };

  switch (architecture) {
    case "single":
      builder.addNode("finalize", finalizeNode);
      builder
        .addEdge(START, "finalize")
        .addEdge("finalize", END);
      break;
    case "centralized":
      builder.addNode("plan", async (state) => {
        const pState = await planNode(state);
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "plan", target: "research" } });
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "plan", target: "implement" } });
        
        const [rState, iState] = await Promise.all([
          researchNode({ ...state, ...pState }),
          implementNode({ ...state, ...pState })
        ]);
        
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "research", target: "finalize" } });
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "implement", target: "finalize" } });
        
        return { 
          ...pState, 
          ...rState, 
          ...iState, 
          trace: [...(pState.trace || []), ...(rState.trace || []), ...(iState.trace || [])],
          handoffs: 3, 
          modelCalls: 3 
        };
      });
      builder.addNode("finalize", finalizeNode);
      builder.addEdge(START, "plan").addEdge("plan", "finalize").addEdge("finalize", END);
      break;
    case "hybrid":
      builder.addNode("plan", async (state) => {
        const pState = await planNode(state);
        
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "plan", target: "peer_a" } });
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "plan", target: "peer_b" } });
        
        const [paState, pbState] = await Promise.all([
          peerANode({ ...state, ...pState }),
          peerBNode({ ...state, ...pState })
        ]);
        
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "peer_a", target: "review" } });
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "peer_b", target: "review" } });
        
        const revState = await reviewNode({ ...state, ...pState, ...paState, ...pbState });
        
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "review", target: "finalize" } });
        
        return { 
          ...pState, 
          ...paState, 
          ...pbState, 
          ...revState, 
          trace: [...(pState.trace || []), ...(paState.trace || []), ...(pbState.trace || []), ...(revState.trace || [])],
          handoffs: 4, 
          modelCalls: 4 
        };
      });
      builder.addNode("finalize", finalizeNode);
      builder.addEdge(START, "plan").addEdge("plan", "finalize").addEdge("finalize", END);
      break;
    case "decentralized":
      builder.addNode("start_peers", async (state) => {
        // Assume START is the initiator visually, but we'll just draw peer_a and peer_b as roots
        const [paState, pbState] = await Promise.all([
          peerANode(state),
          peerBNode(state)
        ]);
        
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "peer_a", target: "peer_merge" } });
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "peer_b", target: "peer_merge" } });
        
        const pmState = await peerMergeNode({ ...state, ...paState, ...pbState });
        
        onUpdate?.({ architecture, type: "graph_edge", data: { source: "peer_merge", target: "finalize" } });
        
        return { 
          ...paState, 
          ...pbState, 
          ...pmState, 
          trace: [...(paState.trace || []), ...(pbState.trace || []), ...(pmState.trace || [])],
          handoffs: 3, 
          modelCalls: 3 
        };
      });
      builder.addNode("finalize", finalizeNode);
      builder.addEdge(START, "start_peers").addEdge("start_peers", "finalize").addEdge("finalize", END);
      break;
    case "dynamic_swarm":
      builder.addNode("manager", async (state: typeof GraphState.State) => {
        emitNodeEvent({ node: "manager", label: "Swarm Manager", status: "running" });
        emitTrace("Swarm manager started.");
        const startTokens = runtime.getTokenMetrics().total;
        
        const managerBrief = await runtime.generateTextStream(
          "planner", 
          "You are the swarm manager. Describe the sub-agents needed.",
          taskBlock(state.taskLabel, state.taskPrompt),
          (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: "manager", text } }),
          (tokens) => emitProgress(tokens)
        );

        const subagents = ["DB Expert", "UI Specialist", "Security Auditor"];
        
        const tokensUsed = runtime.getTokenMetrics().total - startTokens;
        emitNodeEvent({ node: "manager", label: "Swarm Manager", status: "complete", output: managerBrief, tokens: tokensUsed });
        recordHandoffs(3);

        const subAnswers: string[] = [];
        await Promise.all(subagents.map(async (agentLabel, index) => {
          const nodeId = `subagent_${index}`;
          onUpdate?.({ architecture, type: "graph_edge", data: { source: "manager", target: nodeId } });
          
          emitNodeEvent({ node: nodeId, label: agentLabel, status: "running" });
          emitTrace(`${agentLabel} started.`);
          const subTokens = runtime.getTokenMetrics().total;
          
          const ans = await runtime.generateTextStream(
            "researcher",
            `You are ${agentLabel}. Solve your part.`,
            taskBlock(state.taskLabel, state.taskPrompt),
            (text) => onUpdate?.({ architecture, type: "node_stream", data: { node: nodeId, text } }),
            (tokens) => emitProgress(tokens)
          );

          const used = runtime.getTokenMetrics().total - subTokens;
          emitNodeEvent({ node: nodeId, label: agentLabel, status: "complete", output: ans, tokens: used });
          
          onUpdate?.({ architecture, type: "graph_edge", data: { source: nodeId, target: "finalize" } });
          subAnswers.push(ans);
        }));

        const finalPlan = subAnswers.join("\n\n");
        return {
          implementationPlan: finalPlan, 
          handoffs: 3,
          modelCalls: 1 + subagents.length
        };
      });
      builder.addNode("finalize", finalizeNode);
      builder
        .addEdge(START, "manager")
        .addEdge("manager", "finalize")
        .addEdge("finalize", END);
      break;
  }

  return builder.compile();
}

function createRuntime() {
  const key = getGoogleKey();
  if (key) {
    return new Runtime(
      new ChatGoogle({
        apiKey: key,
        model: DEFAULT_MODEL,
        temperature: 0.2
      }),
      {
        label: "LangGraph + Gemini",
        provider: "gemini",
        configured: true,
        mode: "live",
        model: DEFAULT_MODEL,
        envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        summary: "Gemini is configured. New benchmark runs will execute live through LangGraph."
      }
    );
  }

  return new Runtime(null, {
    label: "LangGraph + Gemini",
    provider: "gemini",
    configured: false,
    mode: "simulated",
    model: `${DEFAULT_MODEL} (simulated)`,
    envVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    summary: "Gemini credentials are not configured, so benchmark runs use a deterministic simulated model."
  });
}

class Runtime {
  private usage = {
    input: 0,
    output: 0,
    reasoning: 0,
    total: 0
  };

  private calls = 0;
  private readonly model: ChatGoogle | null;
  private readonly status: RunnerStatus;

  constructor(model: ChatGoogle | null, status: RunnerStatus) {
    this.model = model;
    this.status = status;
  }

  async generateText(role: string, systemPrompt: string, userPrompt: string) {
    this.calls += 1;

    if (!this.model) {
      const text = buildSimulatedResponse(role, userPrompt);
      this.usage.input += estimateTokens(systemPrompt) + estimateTokens(userPrompt);
      this.usage.output += estimateTokens(text);
      this.usage.total = this.usage.input + this.usage.output + this.usage.reasoning;
      return text;
    }

    const response = await this.model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]);

    this.recordUsage(response.usage_metadata);
    return response.text;
  }

  async generateTextStream(
    role: string,
    systemPrompt: string,
    userPrompt: string,
    onChunk: (text: string) => void,
    onProgress?: (tokens: ReturnType<Runtime["getTokenMetrics"]>) => void
  ) {
    this.calls += 1;
    const inputEstimate = estimateTokens(systemPrompt) + estimateTokens(userPrompt);

    if (!this.model) {
      const text = buildSimulatedResponse(role, userPrompt);
      const words = text.split(" ");
      let current = "";
      for (const word of words) {
        current += (current ? " " : "") + word;
        onChunk(current);
        onProgress?.(this.buildUsageEstimate(inputEstimate, current));
        await new Promise(r => setTimeout(r, 25)); // Smooth fake streaming
      }
      this.usage.input += estimateTokens(systemPrompt) + estimateTokens(userPrompt);
      this.usage.output += estimateTokens(text);
      this.usage.total = this.usage.input + this.usage.output + this.usage.reasoning;
      return text;
    }

    let fullText = "";
    try {
      const stream = await this.model.stream([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]);

      for await (const chunk of stream) {
        if (chunk.content) {
          fullText += typeof chunk.content === "string" ? chunk.content : JSON.stringify(chunk.content);
          onChunk(fullText);
          onProgress?.(this.buildUsageEstimate(inputEstimate, fullText));
        }
      }
    } catch (err) {
      console.error("Gemini API stream error:", err);
      fullText = "[API Error: Rate limit or connectivity issue. Reverting to fallback for this node.]";
      onChunk(fullText);
      onProgress?.(this.buildUsageEstimate(inputEstimate, fullText));
    }
    
    this.usage.input += estimateTokens(systemPrompt) + estimateTokens(userPrompt);
    this.usage.output += estimateTokens(fullText);
    this.usage.total = this.usage.input + this.usage.output + this.usage.reasoning;
    return fullText;
  }

  async generateJson<T>(
    role: string,
    userPrompt: string,
    schema: z.ZodSchema<T>,
    fallback: () => T
  ): Promise<T> {
    this.calls += 1;

    if (!this.model) {
      const value = fallback();
      const text = JSON.stringify(value);
      this.usage.input += estimateTokens(userPrompt);
      this.usage.output += estimateTokens(text);
      this.usage.total = this.usage.input + this.usage.output + this.usage.reasoning;
      return value;
    }

    const response = await this.model.invoke([
      {
        role: "system",
        content:
          "Return strict JSON only. Do not wrap the answer in markdown. Do not add prose before or after the JSON."
      },
      { role: "user", content: `${role}\n\n${userPrompt}` }
    ]);

    this.recordUsage(response.usage_metadata);
    const parsed = extractJsonObject(response.text);

    if (!parsed) {
      return fallback();
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(parsed) as unknown;
    } catch (error) {
      console.warn("Failed to parse model JSON response. Falling back.", {
        role,
        message: error instanceof Error ? error.message : "Unknown parse error",
        responseText: truncate(response.text, 400)
      });
      return fallback();
    }

    const validated = schema.safeParse(candidate);
    if (!validated.success) {
      return fallback();
    }

    return validated.data;
  }

  getTokenMetrics() {
    return {
      ...this.usage
    };
  }

  getCallCount() {
    return this.calls;
  }

  getStatus() {
    return this.status;
  }

  private recordUsage(
    usage:
      | {
          input_tokens?: number;
          output_tokens?: number;
          total_tokens?: number;
          output_token_details?: {
            reasoning?: number;
          };
        }
      | undefined
  ) {
    this.usage.input += usage?.input_tokens ?? 0;
    this.usage.output += usage?.output_tokens ?? 0;
    this.usage.reasoning += usage?.output_token_details?.reasoning ?? 0;
    this.usage.total += usage?.total_tokens ?? (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
  }

  private buildUsageEstimate(inputDelta: number, streamedText: string) {
    const outputDelta = estimateTokens(streamedText);
    return {
      input: this.usage.input + inputDelta,
      output: this.usage.output + outputDelta,
      reasoning: this.usage.reasoning,
      total: this.usage.input + inputDelta + this.usage.output + outputDelta + this.usage.reasoning
    };
  }
}

async function evaluateRun(
  runtime: Runtime,
  task: BenchmarkTaskDefinition,
  finalAnswer: string,
  architecture: ArchitectureName
) {
  const criteria = task.evaluationCriteria?.length ? task.evaluationCriteria : task.evaluationFocus;
  const evaluationPrompt = [
    `Task: ${task.label}`,
    `Architecture: ${labelForArchitecture(architecture)}`,
    `Task shape: ${task.taskShape ?? "unknown"}`,
    task.expectedBestArchitecture
      ? `Expected best-fit architecture for this task shape: ${labelForArchitecture(task.expectedBestArchitecture)}`
      : "",
    `Evaluation focus: ${task.evaluationFocus.join(", ")}`,
    `Checklist criteria (${criteria.length} total):`,
    ...criteria.map((criterion, index) => `${index + 1}. ${criterion}`),
    "Score the answer on a 0 to 1 rubric, estimate pass/fail style outcome and test counts, count how many checklist criteria were met, and estimate evaluator confidence.",
    "Return only JSON with rubricScore, outcome, testsPassed, testsFailed, regressionCount, criteriaMet, confidenceScore, rationale.",
    `Answer to evaluate:\n${finalAnswer}`
  ]
    .filter(Boolean)
    .join("\n\n");

  return runtime.generateJson("grader", evaluationPrompt, EvaluationSchema, () =>
    buildSimulatedEvaluation(architecture, criteria.length)
  );
}

function buildRun(input: {
  architecture: ArchitectureName;
  startedAt: string;
  durationMs: number;
  task: BenchmarkTaskDefinition;
  runtime: Runtime;
  graphTrace: string[];
  handoffs: number;
  modelCalls: number;
  evaluation: Evaluation;
  finalAnswer: string;
  resources: {
    cpuAvgPct: number;
    cpuPeakPct: number;
    rssPeakMb: number;
  };
}): ExperimentRun {
  const dataset = input.runtime.getStatus().mode === "live" ? "observed" : "simulated";
  const tokenMetrics = input.runtime.getTokenMetrics();
  const notes = [
    input.runtime.getStatus().summary,
    `Trace: ${input.graphTrace.join(" -> ")}`,
    `Summary: ${truncate(input.finalAnswer, 240)}`
  ].join(" ");

  return {
    runId: randomUUID(),
    tool: "langgraph-gemini",
    architecture: input.architecture,
    taskId: input.task.id,
    taskLabel: input.task.label,
    dataset,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    modelFamily: input.runtime.getStatus().model,
    agentCount: agentCountForArchitecture(input.architecture),
    outcome: input.evaluation.outcome as Outcome,
    tokens: {
      input: tokenMetrics.input,
      output: tokenMetrics.output,
      reasoning: tokenMetrics.reasoning,
      total: tokenMetrics.total
    },
    resources: {
      cpuAvgPct: input.resources.cpuAvgPct,
      cpuPeakPct: input.resources.cpuPeakPct,
      rssPeakMb: input.resources.rssPeakMb,
      childProcessCount: 0,
      toolCallCount: input.modelCalls
    },
    quality: {
      testsPassed: input.evaluation.testsPassed,
      testsFailed: input.evaluation.testsFailed,
      rubricScore: input.evaluation.rubricScore,
      regressionCount: input.evaluation.regressionCount,
      criteriaMet: Math.min(input.evaluation.criteriaMet, input.task.evaluationCriteria?.length ?? input.task.evaluationFocus.length),
      criteriaTotal: input.task.evaluationCriteria?.length ?? input.task.evaluationFocus.length,
      confidenceScore: input.evaluation.confidenceScore,
      compositeScore: buildCompositeScore(
        input.evaluation,
        input.task.evaluationCriteria?.length ?? input.task.evaluationFocus.length
      ),
      verificationMode: input.runtime.getStatus().mode === "simulated" ? "simulated" : "judge_only",
      rationale: input.evaluation.rationale
    },
    coordination: {
      handoffs: input.handoffs,
      retries: 0,
      mergeConflicts: input.architecture === "decentralized" ? 1 : 0,
      reviewLoops: input.architecture === "hybrid" ? 1 : 0
    },
    executionMode: input.runtime.getStatus().mode,
    notes
  };
}

async function sampleProcessUsage<T>(
  work: () => Promise<T>,
  onMetrics?: (resources: { cpuAvgPct: number; cpuPeakPct: number; rssPeakMb: number }) => void
) {
  const intervalMs = 150;
  let peakRssMb = process.memoryUsage().rss / (1024 * 1024);
  let lastCpu = process.cpuUsage();
  let lastTime = process.hrtime.bigint();
  const cpuSamples: number[] = [];
  const timer = setInterval(() => {
    const currentRssMb = process.memoryUsage().rss / (1024 * 1024);
    peakRssMb = Math.max(peakRssMb, currentRssMb);

    const cpuDelta = process.cpuUsage(lastCpu);
    const now = process.hrtime.bigint();
    const elapsedMs = Number(now - lastTime) / 1_000_000;
    const cpuMs = (cpuDelta.user + cpuDelta.system) / 1000;

    if (elapsedMs > 0) {
      const currentCpu = Math.min(1000, (cpuMs / elapsedMs) * 100);
      cpuSamples.push(currentCpu);

      if (onMetrics) {
        onMetrics({
          cpuAvgPct: round(cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length),
          cpuPeakPct: round(Math.max(...cpuSamples)),
          rssPeakMb: round(peakRssMb)
        });
      }
    }

    lastCpu = process.cpuUsage();
    lastTime = now;
  }, intervalMs);

  const started = Date.now();
  const startCpu = process.cpuUsage();

  try {
    const result = await work();
    return {
      result,
      durationMs: Date.now() - started,
      resources: buildResourceSnapshot(process.cpuUsage(startCpu), Date.now() - started, peakRssMb, cpuSamples)
    };
  } finally {
    clearInterval(timer);
  }
}

function buildResourceSnapshot(
  cpuDelta: NodeJS.CpuUsage,
  durationMs: number,
  peakRssMb: number,
  cpuSamples: number[]
) {
  const totalCpuMs = (cpuDelta.user + cpuDelta.system) / 1000;
  const cpuAvgPct = durationMs > 0 ? (totalCpuMs / durationMs) * 100 : 0;
  const cpuPeakPct = cpuSamples.length > 0 ? Math.max(...cpuSamples) : cpuAvgPct;

  return {
    cpuAvgPct: round(cpuAvgPct),
    cpuPeakPct: round(cpuPeakPct),
    rssPeakMb: round(peakRssMb)
  };
}

function buildSimulatedResponse(role: string, prompt: string) {
  const excerpt = truncate(prompt, 160);
  const roleTemplates: Record<string, string> = {
    planner:
      "1. Frame the debugging loop.\n2. Delegate root-cause research and test strategy.\n3. Merge the strongest answer with risks.",
    researcher:
      "Likely cause centers on time arithmetic, stale expiry timestamps, or lifecycle edges after process sleep. Verify with clock-skew tests and resume-from-sleep scenarios.",
    implementer:
      "Patch the expiry calculation behind a single helper, add resume-from-sleep coverage, and keep rollout behind a narrow guard so regression blast radius stays small.",
    reviewer:
      "Highest risk: assuming the clock source is the only problem. Add one test for persisted sessions and one for token refresh race conditions.",
    finalizer:
      "Diagnosis: the session expiry path likely mixes wall-clock and elapsed-time assumptions.\nPlan: centralize expiry math, add focused regression tests, and stage rollout behind metrics.\nResidual risks: refresh token races and stale persisted state.",
    peer_a:
      "Peer A suggests centralizing timeout math and prioritizing a minimal patch before any broader refactor.",
    peer_b:
      "Peer B emphasizes reproducing the bug after machine sleep and testing cache invalidation or stale in-memory timestamps."
  };

  return `${roleTemplates[role] ?? "Produce a concrete benchmark response."}\n\nContext excerpt: ${excerpt}`;
}

function buildSimulatedEvaluation(architecture: ArchitectureName, criteriaTotal: number): Evaluation {
  const clampCriteria = (met: number) => Math.min(met, criteriaTotal || met);
  const mapping: Record<ArchitectureName, Evaluation> = {
    single: {
      rubricScore: 0.74,
      outcome: "partial",
      testsPassed: 6,
      testsFailed: 1,
      regressionCount: 1,
      criteriaMet: clampCriteria(3),
      confidenceScore: 0.68,
      rationale: "Single-agent run covered the basics but missed one edge case."
    },
    centralized: {
      rubricScore: 0.86,
      outcome: "pass",
      testsPassed: 7,
      testsFailed: 0,
      regressionCount: 0,
      criteriaMet: clampCriteria(4),
      confidenceScore: 0.83,
      rationale: "Coordinator plus research improved coverage and execution detail."
    },
    hybrid: {
      rubricScore: 0.92,
      outcome: "pass",
      testsPassed: 7,
      testsFailed: 0,
      regressionCount: 0,
      criteriaMet: clampCriteria(5),
      confidenceScore: 0.9,
      rationale: "Verifier feedback tightened the final plan and reduced blind spots."
    },
    decentralized: {
      rubricScore: 0.79,
      outcome: "partial",
      testsPassed: 6,
      testsFailed: 1,
      regressionCount: 1,
      criteriaMet: clampCriteria(3),
      confidenceScore: 0.7,
      rationale: "Independent peers increased idea diversity but also merge overhead."
    },
    dynamic_swarm: {
      rubricScore: 0.95,
      outcome: "pass",
      testsPassed: 8,
      testsFailed: 0,
      regressionCount: 0,
      criteriaMet: clampCriteria(5),
      confidenceScore: 0.92,
      rationale: "Dynamic sub-agents adapted perfectly to the multi-faceted problem."
    }
  };

  return mapping[architecture];
}

function buildCompositeScore(evaluation: Evaluation, criteriaTotal: number) {
  const checklistCoverage = criteriaTotal > 0 ? evaluation.criteriaMet / criteriaTotal : evaluation.rubricScore;
  const testReliability = evaluation.testsPassed + evaluation.testsFailed > 0
    ? evaluation.testsPassed / (evaluation.testsPassed + evaluation.testsFailed)
    : 1;
  const regressionPenalty = Math.max(0, 1 - evaluation.regressionCount * 0.12);

  const weighted =
    evaluation.rubricScore * 0.45
    + checklistCoverage * 0.25
    + evaluation.confidenceScore * 0.15
    + testReliability * 0.15;

  return round(Math.max(0, Math.min(1, weighted * regressionPenalty)));
}

function taskBlock(label: string, prompt: string) {
  return `Benchmark task: ${label}\n\n${prompt}`;
}

function optionalBlock(label: string, content: string) {
  if (!content) {
    return "";
  }

  return `${label}:\n${content}`;
}

function extractJsonObject(text: string) {
  const firstBrace = text.indexOf("{");
  if (firstBrace === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, index + 1);
      }
    }
  }

  return null;
}

function labelForArchitecture(architecture: ArchitectureName) {
  switch (architecture) {
    case "single":
      return "single-agent";
    case "centralized":
      return "centralized";
    case "hybrid":
      return "hybrid";
    case "decentralized":
      return "decentralized";
    case "dynamic_swarm":
      return "dynamic swarm";
  }
}

function agentCountForArchitecture(architecture: ArchitectureName) {
  switch (architecture) {
    case "single":
      return 1;
    case "centralized":
      return 3;
    case "hybrid":
      return 4;
    case "decentralized":
      return 4;
    case "dynamic_swarm":
      return 5;
  }
}

function estimateTokens(text: string) {
  return Math.max(1, Math.round(text.length / 4));
}

function truncate(text: string, length: number) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
