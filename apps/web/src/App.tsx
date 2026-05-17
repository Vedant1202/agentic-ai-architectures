import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import {
  ARCHITECTURE_DEFINITIONS,
  type ArchitectureName,
  type BenchmarkTaskDefinition,
  type DatasetOverviewResponse,
  type ExperimentRun,
  type LiveErrorDetails,
  type LiveProgressSnapshot,
  type LiveUpdate,
  type NodeTraceEvent
} from "@agent-visibility/shared";
import { AnimatedAgentGraph } from "./AnimatedAgentGraph.js";

type TourTarget = "intro" | "prompt" | "architectures" | "live" | "postrun";

interface GuidedTourStep {
  target: TourTarget;
  title: string;
  body: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const IS_PROD = import.meta.env.VITE_IS_PROD_DEPLOYMENT === "true";
const DEFAULT_ARCHITECTURES: ArchitectureName[] = ["single", "centralized", "hybrid"];
const PAPER_URL =
  "https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/";
const GUIDED_TOUR_STEPS = [
  {
    target: "intro",
    title: "Start with the decision",
    body:
      "Inspired by Google Research's agent scaling paper, this project treats architecture as a product decision: test the task shape, then compare quality, cost, latency, coordination, and reliability."
  },
  {
    target: "prompt",
    title: "Choose or write a task",
    body:
      "Enter your own prompt or select a preset to compare how single-agent, centralized, hybrid, peer, and swarm patterns behave."
  },
  {
    target: "architectures",
    title: "Select architectures",
    body:
      "Pick the architectures you want to test. Each card explains the task shape where that pattern tends to help or become expensive."
  },
  {
    target: "live",
    title: "Inspect the live run",
    body:
      "After a run starts, the graph cards show AI nodes, streamed traces, token use, model calls, handoffs, runtime, and resource pressure."
  },
  {
    target: "postrun",
    title: "Compare post-run evidence",
    body:
      "Review judge scores, criteria coverage, reliability, efficiency, and charts to decide which architecture belongs in your product. Note: These post-run metrics will only be available during evaluation on completion of the run."
  }
] satisfies readonly GuidedTourStep[];
const ARCH_COLORS = Object.fromEntries(
  ARCHITECTURE_DEFINITIONS.map((definition) => [definition.name, definition.color])
) as Record<ArchitectureName, string>;

interface LiveRunState {
  architecture: ArchitectureName;
  status: "idle" | "running" | "complete" | "error";
  trace: string[];
  nodeEvents: Record<string, NodeTraceEvent & { streamedText?: string }>;
  dynamicEdges: { source: string; target: string }[];
  metrics: {
    cpuAvgPct: number;
    cpuPeakPct: number;
    rssPeakMb: number;
  };
  progress: LiveProgressSnapshot;
  errorDetails?: LiveErrorDetails;
  result?: ExperimentRun;
}

interface ArchitectureAggregate {
  architecture: ArchitectureName;
  label: string;
  color: string;
  runCount: number;
  avgScore: number;
  avgJudgeScore: number;
  avgCriteriaCoverage: number;
  avgConfidence: number;
  avgDurationMs: number;
  avgTokens: number;
  passRate: number;
  avgCpuPeak: number;
  avgMemory: number;
  avgHandoffs: number;
}

interface HistoricalOverview {
  totalRuns: number;
  averageScore: number;
  averageJudgeScore: number;
  averageCriteriaCoverage: number;
  passRate: number;
  totalTokens: number;
  bestArchitecture: ArchitectureAggregate | null;
  fastestArchitecture: ArchitectureAggregate | null;
}

interface LiveComparisonDatum {
  architecture: ArchitectureName;
  label: string;
  color: string;
  status: LiveRunState["status"];
  cpuPeakPct: number;
  rssPeakMb: number;
  score: number;
  judgeScore: number;
  criteriaCoverage: number;
  confidenceScore: number;
  tokens: number;
  durationMs: number;
  handoffs: number;
  outputRatio: number;
  testsPassed: number;
  testsFailed: number;
  toolCalls: number;
  verificationMode: string;
  rationale?: string;
  outcome: ExperimentRun["outcome"] | "pending";
}

interface TooltipPayloadEntry {
  color?: string;
  name?: string | number;
  value?: number | string | readonly (string | number)[];
}

interface MetricBarChartProps {
  title: string;
  subtitle: string;
  data: Array<Record<string, number | string> & { label: string; color: string }>;
  dataKey: string;
  valueFormatter: (value: number) => string;
  axisFormatter?: (value: number) => string;
  domain?: [number | "auto", number | "auto"];
}

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [data, setData] = useState<DatasetOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedArches, setSelectedArches] = useState<ArchitectureName[]>(DEFAULT_ARCHITECTURES);
  const [isComparing, setIsComparing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [liveRuns, setLiveRuns] = useState<Record<string, LiveRunState>>({});
  const [activeTourIndex, setActiveTourIndex] = useState<number | null>(null);
  const graphsRef = useRef<HTMLElement>(null);
  const hasAutoStartedTour = useRef(false);

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light-theme-root", theme === "light");
    return () => {
      document.documentElement.classList.remove("light-theme-root");
    };
  }, [theme]);

  useEffect(() => {
    if (!data || loading || hasAutoStartedTour.current) {
      return;
    }

    hasAutoStartedTour.current = true;
    if (localStorage.getItem("agent_tour_phase1_done") !== "true") {
      window.setTimeout(() => {
        setActiveTourIndex(0);
      }, 350);
    }
  }, [data, loading]);

  useEffect(() => {
    if (activeTourIndex === null) {
      return;
    }

    const activeStep = GUIDED_TOUR_STEPS[activeTourIndex];
    if (!activeStep) {
      return;
    }

    window.setTimeout(() => {
      document
        .querySelector(`[data-tour-target="${activeStep.target}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }, [activeTourIndex]);

  async function loadOverview() {
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/overview`);
      if (!response.ok) {
        throw new Error(`Overview request failed with status ${response.status}.`);
      }

      const nextData = (await response.json()) as DatasetOverviewResponse;
      setData(nextData);
      setSelectedTaskId((current) => current || nextData.benchmarkTasks[0]?.id || "");
    } catch (nextError) {
      console.error("Failed to load overview", nextError);
      setError(nextError instanceof Error ? nextError.message : "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }

  const selectedTask = useMemo(
    () => data?.benchmarkTasks.find((task) => task.id === selectedTaskId) ?? null,
    [data, selectedTaskId]
  );

  const historicalAverages = useMemo(
    () => buildArchitectureAverages(data?.runs ?? []),
    [data]
  );

  const historicalOverview = useMemo(
    () => buildHistoricalOverview(data?.runs ?? [], historicalAverages),
    [data, historicalAverages]
  );

  const recentRuns = useMemo(
    () =>
      [...(data?.runs ?? [])]
        .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
        .slice(0, 14),
    [data]
  );

  const comparisonReady =
    selectedArches.length > 0 &&
    (selectedTaskId !== "custom" || customPrompt.trim().length > 0);
  const activeTourStep =
    activeTourIndex === null ? null : GUIDED_TOUR_STEPS[activeTourIndex] ?? null;
  const isTourTarget = (target: TourTarget) => activeTourStep?.target === target;

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const startGuidedTour = () => {
    setActiveTourIndex(0);
  };

  const closeGuidedTour = () => {
    setActiveTourIndex(null);
    if (activeTourIndex !== null && activeTourIndex <= 2) {
      localStorage.setItem("agent_tour_phase1_done", "true");
    } else if (activeTourIndex !== null && activeTourIndex >= 3) {
      localStorage.setItem("agent_tour_phase2_done", "true");
    }
  };

  const goToPreviousTourStep = () => {
    setActiveTourIndex((current) => (current === null ? 0 : Math.max(0, current - 1)));
  };

  const goToNextTourStep = () => {
    setActiveTourIndex((current) => {
      if (current === null) {
        return 0;
      }
      if (current === 2 && Object.keys(liveRuns).length === 0) {
        localStorage.setItem("agent_tour_phase1_done", "true");
        return null;
      }
      const nextIndex = current + 1;
      if (nextIndex >= GUIDED_TOUR_STEPS.length) {
        localStorage.setItem("agent_tour_phase1_done", "true");
        localStorage.setItem("agent_tour_phase2_done", "true");
        return null;
      }
      return nextIndex;
    });
  };

  const toggleArchitecture = (architecture: ArchitectureName) => {
    setSelectedArches((current) => {
      if (current.includes(architecture)) {
        return current.filter((value) => value !== architecture);
      }
      if (IS_PROD && current.length >= 3) {
        return current;
      }
      return [...current, architecture];
    });
  };

  const handleRunComparison = () => {
    if (!comparisonReady) {
      return;
    }

    setIsComparing(true);
    setError(null);

    const initialLiveRuns: Record<string, LiveRunState> = {};
    selectedArches.forEach((architecture) => {
      initialLiveRuns[architecture] = {
        architecture,
        status: "running",
        trace: [],
        nodeEvents: {},
        dynamicEdges: [],
        metrics: { cpuAvgPct: 0, cpuPeakPct: 0, rssPeakMb: 0 },
        progress: {
          elapsedMs: 0,
          handoffs: 0,
          toolCalls: 0,
          tokens: { input: 0, output: 0, reasoning: 0, total: 0 }
        },
        errorDetails: undefined
      };
    });
    setLiveRuns(initialLiveRuns);

    if (localStorage.getItem("agent_tour_phase2_done") !== "true") {
      localStorage.setItem("agent_tour_phase2_done", "true");
      setTimeout(() => {
        setActiveTourIndex(3);
      }, 500);
    }

    setTimeout(() => {
      graphsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);

    const params = new URLSearchParams({
      taskId: selectedTaskId,
      architectures: selectedArches.join(","),
      customPrompt: selectedTaskId === "custom" ? customPrompt : ""
    });

    const eventSource = new EventSource(
      `${API_BASE_URL}/api/benchmark-stream?${params.toString()}`
    );
    let streamClosedByServer = false;

    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data) as LiveUpdate;

      setLiveRuns((current) => {
        const existing = current[update.architecture];
        if (!existing) {
          return current;
        }

        if (update.type === "trace") {
          return {
            ...current,
            [update.architecture]: {
              ...existing,
              trace: [...existing.trace, update.data as string]
            }
          };
        }

        if (update.type === "node_event") {
          const nextNodeEvent = update.data as NodeTraceEvent;
          return {
            ...current,
            [update.architecture]: {
              ...existing,
              nodeEvents: {
                ...existing.nodeEvents,
                [nextNodeEvent.node]: {
                  ...existing.nodeEvents[nextNodeEvent.node],
                  ...nextNodeEvent
                }
              }
            }
          };
        }

        if (update.type === "node_stream") {
          const streamEvent = update.data as { node: string; text: string };
          const existingNodeEvent = existing.nodeEvents[streamEvent.node];
          const nextNodeEvent: NodeTraceEvent & { streamedText?: string } = {
            node: existingNodeEvent?.node ?? streamEvent.node,
            label: existingNodeEvent?.label ?? streamEvent.node,
            status: existingNodeEvent?.status ?? "running",
            output: existingNodeEvent?.output,
            tokens: existingNodeEvent?.tokens,
            streamedText: streamEvent.text
          };

          return {
            ...current,
            [update.architecture]: {
              ...existing,
              nodeEvents: {
                ...existing.nodeEvents,
                [streamEvent.node]: nextNodeEvent
              }
            }
          };
        }

        if (update.type === "graph_edge") {
          const edge = update.data as { source: string; target: string };
          const edgeKey = `${edge.source}-${edge.target}`;
          const seen = new Set(
            existing.dynamicEdges.map((currentEdge) => `${currentEdge.source}-${currentEdge.target}`)
          );

          if (seen.has(edgeKey)) {
            return current;
          }

          return {
            ...current,
            [update.architecture]: {
              ...existing,
              dynamicEdges: [...existing.dynamicEdges, edge]
            }
          };
        }

        if (update.type === "metrics") {
          return {
            ...current,
            [update.architecture]: {
              ...existing,
              metrics: update.data as LiveRunState["metrics"]
            }
          };
        }

        if (update.type === "progress") {
          return {
            ...current,
            [update.architecture]: {
              ...existing,
              progress: update.data as LiveProgressSnapshot
            }
          };
        }

        if (update.type === "complete") {
          return {
            ...current,
            [update.architecture]: {
              ...existing,
              status: "complete",
              progress: {
                elapsedMs: (update.data as ExperimentRun).durationMs,
                handoffs: (update.data as ExperimentRun).coordination.handoffs,
                toolCalls: (update.data as ExperimentRun).resources.toolCallCount,
                tokens: (update.data as ExperimentRun).tokens
              },
              result: update.data as ExperimentRun
            }
          };
        }

        if (update.type === "error") {
          const details = normalizeLiveErrorDetails(update.data, existing);
          return {
            ...current,
            [update.architecture]: {
              ...existing,
              status: "error",
              errorDetails: details,
              trace: [...existing.trace, formatLiveErrorTrace(details)]
            }
          };
        }

        return current;
      });
    };

    eventSource.addEventListener("end", () => {
      streamClosedByServer = true;
      eventSource.close();
      setIsComparing(false);
      void loadOverview();
    });

    eventSource.onerror = () => {
      eventSource.close();

      if (streamClosedByServer) {
        return;
      }

      setIsComparing(false);
      setError("The live benchmark stream disconnected before every run completed.");
      setLiveRuns((current) => {
        const nextRuns: Record<string, LiveRunState> = {};
        Object.entries(current).forEach(([key, value]) => {
          nextRuns[key] = value.status === "complete"
            ? value
            : {
                ...value,
                status: "error",
                errorDetails: {
                  kind: "stream_disconnect",
                  message: "The browser lost the server event stream before the run completed.",
                  retryable: true
                },
                trace: [
                  ...value.trace,
                  "Live stream disconnected before the run completed."
                ]
              };
        });
        return nextRuns;
      });
    };
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-card">
          <span className="eyebrow">Architecture comparison</span>
          <h1>Loading the AI architecture comparison workspace</h1>
          <p>Loading presets, historical signals, and live runner stack status.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <div className="empty-state">
          <span className="eyebrow">Workspace unavailable</span>
          <h1>We couldn&apos;t load the experiment data.</h1>
          <p>{error ?? "The API did not return an overview payload."}</p>
          <button className="theme-toggle" onClick={() => void loadOverview()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`page-shell ${activeTourStep ? "tour-is-active" : ""}`}>
      <header className="app-navbar">
        <div className="app-navbar__brand">
          <span>Agentic AI Architecture Comparison</span>
        </div>

        <div className="app-navbar__stack" aria-label="Runner stack">
          <span>Runner</span>
          <strong>{data.runner.label}</strong>
          <span className={`runner-status ${data.runner.configured ? "is-live" : "is-simulated"}`}>
            {data.runner.mode === "live" ? "Live" : "Simulated"}
          </span>
          <span className="runner-model">{data.runner.model}</span>
        </div>

        <div className="app-navbar__actions">
          <button className="tour-launch" type="button" onClick={startGuidedTour}>
            Guided tour
          </button>
          <a className="paper-link" href={PAPER_URL} target="_blank" rel="noreferrer">
            Paper
          </a>
          <button className="theme-toggle" onClick={toggleTheme}>
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>
      </header>

      <section
        className={`project-intro ${isTourTarget("intro") ? "tour-highlight" : ""}`}
        data-tour-target="intro"
      >
        <div>
          <span className="eyebrow">Architecture comparison</span>
          <h1>the Agentic AI Architecture Comparison project</h1>
          <p>
            Test your internal AI architecture against prompts and presets, then compare
            how task shape changes performance, efficiency, reliability, and product fit.
          </p>
          <p>
            The motivation comes from Google Research&apos;s work on when and why agent
            systems scale: architecture is not decoration. It changes handoffs, model
            calls, latency, verification quality, failure modes, and ultimately whether a
            product should ship a single-agent flow, a coordinator, a verifier, or an
            adaptive swarm.
          </p>
          <p>
            Testing metrics matters because the best architecture for a demo can be the
            wrong one for production. Use the live and post-run scores to decide where
            extra coordination improves outcomes and where it only adds cost.
          </p>
          <div className="project-intro__actions">
            <a className="inline-paper-link" href={PAPER_URL} target="_blank" rel="noreferrer">
              Read the inspiration paper by Google Research
            </a>
          </div>
        </div>

        <aside className="runner-summary">
          <span>Current runner stack</span>
          <strong>{data.runner.label}</strong>
          <p>{data.runner.summary}</p>
          <div className="runner-summary__meta">
            <span>{historicalOverview.totalRuns} runs</span>
            <span>{data.runner.configured ? "Live runner available" : "Simulation mode"}</span>
          </div>
        </aside>
      </section>

      {error && (
        <div className="banner">
          <span>{error}</span>
          <button className="text-button" onClick={() => void loadOverview()}>
            Refresh data
          </button>
        </div>
      )}

      <section className="panel panel-spacious">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Task-shape testing</span>
            <h2>Run an architecture comparison</h2>
            <p>
              Select a preset or enter your own prompt, then compare the chosen
              architectures in parallel.
            </p>
          </div>
        </div>

        <div className="control-layout">
          <div
            className={`control-column ${isTourTarget("prompt") ? "tour-highlight" : ""}`}
            data-tour-target="prompt"
          >
            <div className="input-group">
              <label htmlFor="task-select">Benchmark task</label>
              <select
                id="task-select"
                value={selectedTaskId}
                onChange={(event) => setSelectedTaskId(event.target.value)}
              >
                {data.benchmarkTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.label}
                  </option>
                ))}
              </select>
            </div>

            {selectedTaskId === "custom" && (
              <div className="input-group">
                <label htmlFor="custom-prompt">Custom benchmark prompt</label>
                <textarea
                  id="custom-prompt"
                  placeholder="Describe the coding or analysis challenge you want every architecture to solve."
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                />
              </div>
            )}

            <TaskPreview task={selectedTask} customPrompt={customPrompt} />
          </div>

          <div
            className={`selection-column ${isTourTarget("architectures") ? "tour-highlight" : ""}`}
            data-tour-target="architectures"
          >
            <div className="selection-header">
              <h3>Architecture selection</h3>
              <p>Select the architectures to test for quality, coordination cost, and product fit.</p>
              {IS_PROD && (
                <div style={{ marginTop: "12px", padding: "12px", borderRadius: "12px", background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.2)", color: "var(--warning-color)", fontSize: "0.9rem" }}>
                  <strong>Demo Limit:</strong> In the public preview, you can select up to 3 architectures at once to preserve server resources.
                </div>
              )}
            </div>

            <div className="architecture-selector-grid">
              {ARCHITECTURE_DEFINITIONS.map((architecture) => {
                const isActive = selectedArches.includes(architecture.name);
                const isLimitReached = IS_PROD && selectedArches.length >= 3;
                const isDisabled = !isActive && isLimitReached;
                return (
                  <button
                    key={architecture.name}
                    type="button"
                    className={`architecture-option ${isActive ? "active" : ""}`}
                    style={{ 
                      "--card-accent": architecture.color,
                      opacity: isDisabled ? 0.4 : 1,
                      cursor: isDisabled ? "not-allowed" : "pointer"
                    } as CSSProperties}
                    onClick={() => !isDisabled && toggleArchitecture(architecture.name)}
                    disabled={isDisabled}
                  >
                    <div className="architecture-option__topline">
                      <span>{architecture.label}</span>
                      <strong>{isActive ? "Selected" : isDisabled ? "Limit Reached" : "Available"}</strong>
                    </div>
                    <p>{architecture.summary}</p>
                    <small>{architecture.tradeoff}</small>
                  </button>
                );
              })}
            </div>

            <div className="runner-footer">
              <div className="helper-copy">
                <strong>{selectedArches.length}</strong> architectures selected
                {selectedTaskId === "custom" && !customPrompt.trim() && (
                  <span>Add a custom prompt to start the run.</span>
                )}
              </div>

              <button
                className="run-btn"
                onClick={handleRunComparison}
                disabled={isComparing || !comparisonReady}
              >
                {isComparing ? "Running benchmark..." : "Run benchmark"}
              </button>
            </div>

            <div
              className={`metrics-guide ${isTourTarget("live") ? "tour-highlight" : ""}`}
              data-tour-target="live"
            >
              <span>During-run metrics</span>
              <p>Live graph cards appear here after a run starts, with node traces and resource signals.</p>
            </div>
          </div>
        </div>
      </section>

      {Object.keys(liveRuns).length > 0 && (
        <section
          ref={graphsRef}
          className={`panel panel-spacious ${isTourTarget("live") ? "tour-highlight" : ""}`}
          data-tour-target="live"
        >
          <div className="panel-header">
            <div>
              <span className="eyebrow">Live Benchmark Results</span>
              <h2>Streaming architecture metrics</h2>
              <p>
                Resource usage, quality, and execution traces update as each architecture
                processes the selected task.
              </p>
            </div>
          </div>

          <LiveComparativeDashboard liveRuns={liveRuns} />
        </section>
      )}

      {!IS_PROD && (
        <section className="history-toggle-row">
          <button
            type="button"
            className="history-toggle"
            onClick={() => setShowHistory((current) => !current)}
          >
            {showHistory ? "Hide history" : "Show history"}
          </button>
        </section>
      )}

      {showHistory && !IS_PROD && (
        <>
          <section className="summary-strip">
            <OverviewCard
              label="Total spend"
              value={formatCompact(historicalOverview.totalTokens)}
              detail="Aggregate tokens consumed across the full ledger"
              tone="blue"
            />
            <OverviewCard
              label="Best index"
              value={historicalOverview.bestArchitecture?.label ?? "No data"}
              detail={
                historicalOverview.bestArchitecture
                  ? `${formatPercent(historicalOverview.bestArchitecture.avgScore)} composite • ${formatPercent(historicalOverview.bestArchitecture.avgCriteriaCoverage)} criteria`
                  : "Waiting for benchmark history"
              }
              tone="teal"
            />
            <OverviewCard
              label="Fastest architecture"
              value={historicalOverview.fastestArchitecture?.label ?? "No data"}
              detail={
                historicalOverview.fastestArchitecture
                  ? `${formatDuration(historicalOverview.fastestArchitecture.avgDurationMs)} average completion`
                  : "Waiting for benchmark history"
              }
              tone="gold"
            />
            <OverviewCard
              label="Runner status"
              value={data.runner.mode === "live" ? "Live" : "Simulated"}
              detail={data.runner.configured ? "Gemini credentials detected" : "Safe deterministic fallback"}
              tone="slate"
            />
          </section>

          <section className="panel panel-spacious">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Historical Summary</span>
                <h2>Architecture performance summary</h2>
                <p>
                  Aggregate ledger results show quality, latency, and efficiency by architecture.
                </p>
              </div>
            </div>

            <div className="insights-layout">
              <MetricBarChart
                title="Mean Composite Index"
                subtitle="Combined score from judge, criteria coverage, confidence, and test reliability"
                data={historicalAverages.map((item) => ({
                  label: item.label,
                  color: item.color,
                  avgScore: item.avgScore
                }))}
                dataKey="avgScore"
                valueFormatter={formatPercent}
                axisFormatter={(value) => `${Math.round(value)}%`}
                domain={[0, 100]}
              />

              <MetricBarChart
                title="Mean Completion Time"
                subtitle="Lower is better for end-to-end latency"
                data={historicalAverages.map((item) => ({
                  label: item.label,
                  color: item.color,
                  avgDurationMs: item.avgDurationMs / 1000
                }))}
                dataKey="avgDurationMs"
                valueFormatter={(value) => `${value.toFixed(0)}s`}
                axisFormatter={(value) => `${Math.round(value)}s`}
              />

              <div className="architecture-stack">
                <div className="architecture-stack__header">
                  <h3>Architecture summaries</h3>
                  <p>Summary statistics for each architecture in the ledger.</p>
                </div>

                {historicalAverages.map((item) => (
                  <article
                    key={item.architecture}
                    className="architecture-summary"
                    style={{ "--card-accent": item.color } as CSSProperties}
                  >
                    <div className="architecture-summary__topline">
                      <span>{item.label}</span>
                      <strong>{formatPercent(item.avgScore)}</strong>
                    </div>
                    <p>{getArchitectureDefinition(item.architecture)?.tradeoff}</p>
                    <div className="architecture-summary__meta">
                      <span>{item.runCount} runs</span>
                      <span>{formatPercent(item.avgCriteriaCoverage)} criteria</span>
                      <span>{formatPercent(item.avgConfidence)} confidence</span>
                      <span>{formatDuration(item.avgDurationMs)} avg</span>
                      <span>{formatCompact(item.avgTokens)} tokens</span>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="panel panel-spacious">
            <div className="panel-header">
              <div>
                <span className="eyebrow">Benchmark Ledger</span>
                <h2>Recent benchmark runs</h2>
                <p>
                  Recent persisted runs ordered by start time with key quality
                  and efficiency metrics.
                </p>
              </div>
            </div>

            <div className="table-shell">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Task</th>
                    <th>Architecture</th>
                    <th>Quality</th>
                    <th>Tokens</th>
                    <th>Duration</th>
                    <th>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr key={run.runId}>
                      <td className="mono-cell">{run.runId.slice(0, 8)}</td>
                      <td>
                        <div className="table-primary">{run.taskLabel}</div>
                        <div className="table-secondary">{new Date(run.startedAt).toLocaleString()}</div>
                      </td>
                      <td>
                        <span
                          className="architecture-badge"
                          style={{ "--card-accent": ARCH_COLORS[run.architecture] } as CSSProperties}
                        >
                          {getArchitectureDefinition(run.architecture)?.label ?? run.architecture}
                        </span>
                      </td>
                      <td>
                        <div className="quality-meter">
                          <strong>{formatPercent(getCompositeScore(run) * 100)}</strong>
                          <span>
                            Judge {formatPercent((run.quality.rubricScore ?? 0) * 100)}
                            {" • "}
                            Criteria {formatPercent(getCriteriaCoverage(run) * 100)}
                          </span>
                        </div>
                      </td>
                      <td className="mono-cell">{formatCompact(run.tokens.total)}</td>
                      <td className="mono-cell">{formatDuration(run.durationMs)}</td>
                      <td>
                        <span className={`outcome-badge outcome-${run.outcome}`}>{run.outcome}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activeTourStep && activeTourIndex !== null && (
        <GuidedTourCard
          step={activeTourStep}
          stepNumber={activeTourIndex + 1}
          totalSteps={Object.keys(liveRuns).length === 0 && activeTourIndex < 3 ? 3 : GUIDED_TOUR_STEPS.length}
          onPrevious={goToPreviousTourStep}
          onNext={goToNextTourStep}
          onClose={closeGuidedTour}
        />
      )}
    </div>
  );
}

function GuidedTourCard({
  step,
  stepNumber,
  totalSteps,
  onPrevious,
  onNext,
  onClose
}: {
  step: GuidedTourStep;
  stepNumber: number;
  totalSteps: number;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const isFirstStep = stepNumber === 1;
  const isLastStep = stepNumber === totalSteps;

  return (
    <div className="tour-card" role="dialog" aria-modal="false" aria-labelledby="tour-card-title">
      <div className="tour-card__topline">
        <span>Guided tour</span>
        <button type="button" className="tour-card__close" onClick={onClose} aria-label="Close tour">
          Close
        </button>
      </div>
      <div className="tour-card__progress">
        <span>
          {stepNumber} of {totalSteps}
        </span>
        <div>
          <i style={{ width: `${(stepNumber / totalSteps) * 100}%` }} />
        </div>
      </div>
      <h2 id="tour-card-title">{step.title}</h2>
      <p>{step.body}</p>
      <div className="tour-card__actions">
        <button type="button" className="text-button" onClick={onPrevious} disabled={isFirstStep}>
          Back
        </button>
        <button type="button" className="run-btn" onClick={onNext}>
          {isLastStep ? "Finish tour" : "Next"}
        </button>
      </div>
    </div>
  );
}

function LiveComparativeDashboard({ liveRuns }: { liveRuns: Record<string, LiveRunState> }) {
  const comparisonData = useMemo(() => buildLiveComparisonData(liveRuns), [liveRuns]);

  const completedRuns = comparisonData.filter((run) => run.status === "complete");
  const leadingScore = [...completedRuns].sort((left, right) => right.score - left.score)[0] ?? null;
  const fastestCompletion =
    [...completedRuns].sort((left, right) => left.durationMs - right.durationMs)[0] ?? null;
  const peakMemory = comparisonData.reduce(
    (current, run) => Math.max(current, run.rssPeakMb),
    0
  );
  const activeCount = comparisonData.filter((run) => run.status === "running").length;

  return (
    <div className="live-dashboard">
      <section className="summary-strip summary-strip-live">
        <OverviewCard
          label="Highest index"
          value={leadingScore ? `${leadingScore.label}` : "Pending"}
          detail={leadingScore ? formatPercent(leadingScore.score) : "Waiting for completed runs"}
          tone="blue"
        />
        <OverviewCard
          label="Shortest runtime"
          value={fastestCompletion ? fastestCompletion.label : "Pending"}
          detail={
            fastestCompletion
              ? formatDuration(fastestCompletion.durationMs)
              : "Waiting for completed runs"
          }
          tone="teal"
        />
        <OverviewCard
          label="Maximum memory"
          value={`${peakMemory.toFixed(0)} MB`}
          detail="Highest observed RSS peak in the live run"
          tone="gold"
        />
        <OverviewCard
          label="Judge average"
          value={
            comparisonData.length > 0
              ? formatPercent(average(comparisonData.map((run) => run.judgeScore)))
              : "Pending"
          }
          detail={
            `${activeCount}/${comparisonData.length} architectures still active`
          }
          tone="slate"
        />
      </section>

      <div className="live-run-grid">
        {comparisonData.map((item) => (
          <ArchitectureRunCard
            key={item.architecture}
            run={liveRuns[item.architecture]!}
            summary={item}
          />
        ))}
      </div>

      <div className="chart-grid">
        <MetricBarChart
          title="Judge Score"
          subtitle="Evaluator model's holistic rubric score per architecture (post-run)"
          data={comparisonData.map((item) => ({
            label: item.label,
            color: item.color,
            judgeScore: item.judgeScore
          }))}
          dataKey="judgeScore"
          valueFormatter={formatPercent}
          axisFormatter={(value) => `${Math.round(value)}%`}
          domain={[0, 100]}
        />

        <MetricBarChart
          title="Criteria Coverage"
          subtitle="Fraction of task evaluation checklist satisfied (post-run)"
          data={comparisonData.map((item) => ({
            label: item.label,
            color: item.color,
            criteriaCoverage: item.criteriaCoverage
          }))}
          dataKey="criteriaCoverage"
          valueFormatter={formatPercent}
          axisFormatter={(value) => `${Math.round(value)}%`}
          domain={[0, 100]}
        />

        <MetricBarChart
          title="Total Token Usage"
          subtitle="Total tokens consumed per architecture (live)"
          data={comparisonData.map((item) => ({
            label: item.label,
            color: item.color,
            tokens: item.tokens
          }))}
          dataKey="tokens"
          valueFormatter={formatCompact}
          axisFormatter={(value) => formatCompact(value)}
        />

        <MetricBarChart
          title="Agent Handoffs"
          subtitle="Inter-agent delegations during execution (live)"
          data={comparisonData.map((item) => ({
            label: item.label,
            color: item.color,
            handoffs: item.handoffs
          }))}
          dataKey="handoffs"
          valueFormatter={(value) => `${Math.round(value)}`}
          axisFormatter={(value) => `${Math.round(value)}`}
        />

        <MetricBarChart
          title="Model Calls"
          subtitle="Total LLM invocations per architecture (live)"
          data={comparisonData.map((item) => ({
            label: item.label,
            color: item.color,
            toolCalls: item.toolCalls
          }))}
          dataKey="toolCalls"
          valueFormatter={(value) => `${Math.round(value)}`}
          axisFormatter={(value) => `${Math.round(value)}`}
        />
      </div>
    </div>
  );
}

function ArchitectureRunCard({
  run,
  summary
}: {
  run: LiveRunState;
  summary: LiveComparisonDatum;
}) {
  const definition = getArchitectureDefinition(summary.architecture);
  const recentTrace = run.trace.slice(-4).reverse();
  const isComplete = summary.status === "complete";
  const isRunning = summary.status === "running";
  const evalPending = !isComplete;
  const dash = "—";
  const [expanded, setExpanded] = useState(false);

  return (
    <article
      className={`run-card status-${summary.status}`}
      style={{ "--card-accent": summary.color } as CSSProperties}
    >
      <div className="run-card__header">
        <div>
          <span className="run-card__eyebrow">Architecture</span>
          <h3>{summary.label}</h3>
          <p>{definition?.summary}</p>
        </div>
        <span className={`status-chip status-${summary.status}`}>
          {formatStatusLabel(summary.status)}
        </span>
      </div>

      {/* Live token count — updates as nodes complete */}
      <div className="run-card__live-strip">
        <span className="live-token-counter">
          {summary.tokens > 0 ? (
            <><strong>{formatCompact(summary.tokens)}</strong> tokens {isRunning ? <span className="live-badge">live</span> : ""}</>
          ) : (
            "Waiting for first node…"
          )}
        </span>
        {summary.durationMs > 0 && (
          <span className="live-duration">{formatDuration(summary.durationMs)}</span>
        )}
      </div>

      {/* Node graph */}
      <div className="graph-shell">
        <AnimatedAgentGraph
          architecture={run.architecture}
          nodeEvents={run.nodeEvents}
          dynamicEdges={run.dynamicEdges}
        />
      </div>

      {/* Latest trace line */}
      <div className="run-card__snapshot">
        <span>{run.trace.at(-1) ?? "Waiting for execution trace…"}</span>
      </div>

      {/* Expandable details toggle */}
      <button
        className="run-card__details-toggle"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        {expanded ? "Hide metrics" : "Show detailed metrics"}
        <span className="details-toggle-icon">{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && (
        <div className="run-card__expanded">
          <div className="metric-table-section">
            <div className="metric-section-header">
              <span className="metric-section-title">In-Task Execution</span>
              <div className="metric-section-pills">
                <span className="metric-pill">
                  <span className="metric-pill__label">Tokens</span>
                  <strong>{summary.tokens > 0 ? formatCompact(summary.tokens) : dash}</strong>
                  {isRunning && <span className="live-badge">live</span>}
                </span>
                <span className="metric-pill">
                  <span className="metric-pill__label">Duration</span>
                  <strong>{summary.durationMs > 0 ? formatDuration(summary.durationMs) : "—"}</strong>
                </span>
                <span className="metric-pill">
                  <span className="metric-pill__label">Calls</span>
                  <strong>{summary.toolCalls}</strong>
                </span>
                <span className="metric-pill">
                  <span className="metric-pill__label">Handoffs</span>
                  <strong>{summary.handoffs}</strong>
                </span>
              </div>
            </div>
            <table className="metric-table">
              <tbody>
                <MetricRow label="Total tokens" value={summary.tokens > 0 ? formatCompact(summary.tokens) : dash} note={isRunning ? "Updating live" : undefined} />
                <MetricRow label="Output / input ratio" value={`${summary.outputRatio.toFixed(2)}×`} note="Generated tokens ÷ prompt tokens" />
                <MetricRow label="Duration" value={summary.durationMs > 0 ? formatDuration(summary.durationMs) : "Streaming"} />
                <MetricRow label="Model calls" value={summary.toolCalls.toString()} note="Total LLM invocations" />
                <MetricRow label="Agent handoffs" value={summary.handoffs.toString()} note="Inter-agent delegations" />
              </tbody>
            </table>
          </div>

          <div className="metric-table-section">
            <div className="metric-section-header">
              <span className="metric-section-title">Post-Completion Evaluation</span>
              <div className="metric-section-pills">
                <span className="metric-pill">
                  <span className="metric-pill__label">Judge</span>
                  <strong className={isComplete ? "" : "metric-pill__pending"}>
                    {isComplete ? formatPercent(summary.judgeScore) : dash}
                  </strong>
                </span>
                <span className="metric-pill">
                  <span className="metric-pill__label">Criteria</span>
                  <strong className={isComplete ? "" : "metric-pill__pending"}>
                    {isComplete ? formatPercent(summary.criteriaCoverage) : dash}
                  </strong>
                </span>
                <span className="metric-pill">
                  <span className="metric-pill__label">Confidence</span>
                  <strong className={isComplete ? "" : "metric-pill__pending"}>
                    {isComplete ? formatPercent(summary.confidenceScore) : dash}
                  </strong>
                </span>
                <span className="metric-pill">
                  <span className="metric-pill__label">Reliability</span>
                  <strong className={isComplete ? "" : "metric-pill__pending"}>
                    {isComplete
                      ? (summary.testsPassed + summary.testsFailed > 0
                        ? formatPercent((summary.testsPassed / (summary.testsPassed + summary.testsFailed)) * 100)
                        : "100%")
                      : dash}
                  </strong>
                </span>
                {!isComplete && <span className="eval-pending-badge">Post-run</span>}
              </div>
            </div>
            <table className="metric-table">
              <tbody>
                <MetricRow
                  label="Judge score"
                  value={isComplete ? formatPercent(summary.judgeScore) : dash}
                  note="Holistic rubric (0–100%)"
                />
                <MetricRow
                  label="Criteria coverage"
                  value={isComplete ? formatPercent(summary.criteriaCoverage) : dash}
                  note="Task checklist satisfied"
                />
                <MetricRow
                  label="Evaluator confidence"
                  value={isComplete ? formatPercent(summary.confidenceScore) : dash}
                  note="Evaluator certainty in judgment"
                />
                <MetricRow
                  label="Test reliability"
                  value={isComplete
                    ? (summary.testsPassed + summary.testsFailed > 0
                      ? formatPercent((summary.testsPassed / (summary.testsPassed + summary.testsFailed)) * 100)
                      : "100%")
                    : dash}
                  note={isComplete ? `${summary.testsPassed} passed, ${summary.testsFailed} failed` : "Available post-run"}
                />
                <MetricRow label="Outcome" value={isComplete ? summary.outcome : dash} />
                <MetricRow label="Eval mode" value={formatVerificationMode(summary.verificationMode)} />
              </tbody>
            </table>
          </div>

          {summary.rationale && (
            <div className="metric-table-section">
              <div className="metric-table-heading">Evaluator rationale</div>
              <p className="metric-rationale">{summary.rationale}</p>
            </div>
          )}

          {run.errorDetails && (
            <div className="metric-table-section">
              <div className="metric-table-heading error-heading">{formatLiveErrorTitle(run.errorDetails)}</div>
              <p className="metric-table-note">{run.errorDetails.message}</p>
              {run.errorDetails.nodeLabel && (
                <p className="metric-table-note">Active node: {run.errorDetails.nodeLabel}</p>
              )}
            </div>
          )}

          <div className="metric-table-section">
            <div className="metric-table-heading">Execution trace</div>
            <div className="trace-feed">
              {recentTrace.length > 0 ? (
                recentTrace.map((line, index) => (
                  <div key={`${summary.architecture}-${index}`} className="trace-item">{line}</div>
                ))
              ) : (
                <div className="trace-item trace-item-muted">No trace events yet.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

function TaskPreview({
  task,
  customPrompt
}: {
  task: BenchmarkTaskDefinition | null;
  customPrompt: string;
}) {
  const taskDescription =
    task?.id === "custom"
      ? customPrompt.trim() || "Enter a custom prompt to benchmark your own scenario."
      : task?.prompt ?? "Choose a benchmark task to see the preview.";

  return (
    <article className="task-preview">
      <div className="task-preview__header">
        <div>
          <span className="run-card__eyebrow">Task definition</span>
          <h3>{task?.label ?? "No task selected"}</h3>
        </div>
        {task && <span className="task-category">{task.category}</span>}
      </div>

      <p>{taskDescription}</p>

      {task && (
        <>
          <div className="task-preview__meta">
            {task.taskShape && <span className="focus-pill">Shape: {formatTaskShape(task.taskShape)}</span>}
            {task.expectedBestArchitecture && (
              <span className="focus-pill">Best fit: {getArchitectureDefinition(task.expectedBestArchitecture)?.label ?? task.expectedBestArchitecture}</span>
            )}
          </div>
          <div className="focus-pills">
            {task.evaluationFocus.map((focus) => (
              <span key={focus} className="focus-pill">
                {focus}
              </span>
            ))}
          </div>
          <details className="task-criteria">
            <summary>Evaluation criteria</summary>
            <div className="focus-pills focus-pills-criteria">
              {(task.evaluationCriteria ?? task.evaluationFocus).map((criterion) => (
                <span key={criterion} className="focus-pill focus-pill-criterion">
                  {criterion}
                </span>
              ))}
            </div>
          </details>
        </>
      )}
    </article>
  );
}

function MetricBarChart({
  title,
  subtitle,
  data,
  dataKey,
  valueFormatter,
  axisFormatter = valueFormatter,
  domain
}: MetricBarChartProps) {
  return (
    <article className="chart-panel">
      <div className="chart-panel__header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>

      <div className="chart-panel__body">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="var(--grid-color)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={domain}
              tick={{ fill: "var(--text-secondary)", fontSize: 12 }}
              tickFormatter={(value) => axisFormatter(Number(value))}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ fill: "rgba(148, 163, 184, 0.10)" }}
              content={(props) => (
                <ChartTooltip
                  active={props.active}
                  label={props.label}
                  payload={props.payload}
                  valueFormatter={valueFormatter}
                />
              )}
            />
            <Bar dataKey={dataKey} radius={[12, 12, 4, 4]} maxBarSize={44}>
              {data.map((entry) => (
                <Cell key={`${title}-${entry.label}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function ChartTooltip({
  active,
  label,
  payload,
  valueFormatter
}: {
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipPayloadEntry[];
  valueFormatter: (value: number) => string;
}) {
  const entry = payload?.[0];

  if (!active || !entry) {
    return null;
  }

  const tooltipValue = Array.isArray(entry.value) ? entry.value[0] : entry.value;
  const rawValue = Number(tooltipValue ?? 0);

  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      <span>{valueFormatter(rawValue)}</span>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "teal" | "gold" | "slate";
}) {
  return (
    <article className={`overview-card tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function MiniMetric({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="mini-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {sublabel && <span className="mini-metric__sublabel">{sublabel}</span>}
    </div>
  );
}

function MetricRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <tr className="metric-row">
      <td className="metric-row__label">{label}</td>
      <td className="metric-row__value">{value}</td>
      {note !== undefined && <td className="metric-row__note">{note}</td>}
      {note === undefined && <td />}
    </tr>
  );
}

function buildArchitectureAverages(runs: ExperimentRun[]) {
  const grouped = new Map<ArchitectureName, ExperimentRun[]>();

  runs.forEach((run) => {
    const current = grouped.get(run.architecture) ?? [];
    current.push(run);
    grouped.set(run.architecture, current);
  });

  return [...grouped.entries()]
    .map(([architecture, architectureRuns]) => {
      const definition = getArchitectureDefinition(architecture);
      return {
        architecture,
        label: definition?.label ?? architecture,
        color: definition?.color ?? "#64748b",
        runCount: architectureRuns.length,
        avgScore: average(architectureRuns.map((run) => getCompositeScore(run) * 100)),
        avgJudgeScore: average(architectureRuns.map((run) => (run.quality.rubricScore ?? 0) * 100)),
        avgCriteriaCoverage: average(architectureRuns.map((run) => getCriteriaCoverage(run) * 100)),
        avgConfidence: average(architectureRuns.map((run) => (run.quality.confidenceScore ?? 0) * 100)),
        avgDurationMs: average(architectureRuns.map((run) => run.durationMs)),
        avgTokens: average(architectureRuns.map((run) => run.tokens.total)),
        passRate:
          (architectureRuns.filter((run) => run.outcome === "pass").length / architectureRuns.length) *
          100,
        avgCpuPeak: average(architectureRuns.map((run) => run.resources.cpuPeakPct)),
        avgMemory: average(architectureRuns.map((run) => run.resources.rssPeakMb)),
        avgHandoffs: average(architectureRuns.map((run) => run.coordination.handoffs))
      } satisfies ArchitectureAggregate;
    })
    .sort((left, right) => right.avgScore - left.avgScore);
}

function buildHistoricalOverview(
  runs: ExperimentRun[],
  aggregates: ArchitectureAggregate[]
): HistoricalOverview {
  const totalRuns = runs.length;
  const averageScore = totalRuns
    ? average(runs.map((run) => getCompositeScore(run) * 100))
    : 0;
  const averageJudgeScore = totalRuns
    ? average(runs.map((run) => (run.quality.rubricScore ?? 0) * 100))
    : 0;
  const averageCriteriaCoverage = totalRuns
    ? average(runs.map((run) => getCriteriaCoverage(run) * 100))
    : 0;
  const passRate = totalRuns
    ? (runs.filter((run) => run.outcome === "pass").length / totalRuns) * 100
    : 0;
  const totalTokens = runs.reduce((sum, run) => sum + run.tokens.total, 0);
  const bestArchitecture = aggregates[0] ?? null;
  const fastestArchitecture =
    [...aggregates].sort((left, right) => left.avgDurationMs - right.avgDurationMs)[0] ?? null;

  return {
    totalRuns,
    averageScore,
    averageJudgeScore,
    averageCriteriaCoverage,
    passRate,
    totalTokens,
    bestArchitecture,
    fastestArchitecture
  };
}

function buildLiveComparisonData(liveRuns: Record<string, LiveRunState>) {
  const runs = Object.values(liveRuns).sort(
    (left, right) =>
      ARCHITECTURE_DEFINITIONS.findIndex((definition) => definition.name === left.architecture) -
      ARCHITECTURE_DEFINITIONS.findIndex((definition) => definition.name === right.architecture)
  );

  return runs.map((run) => {
    const definition = getArchitectureDefinition(run.architecture);
    const result = run.result;
    const tokenMetrics = result?.tokens ?? run.progress.tokens;
    const inputTokens = tokenMetrics.input ?? 0;
    const outputTokens = tokenMetrics.output ?? 0;

    return {
      architecture: run.architecture,
      label: definition?.label ?? run.architecture,
      color: definition?.color ?? "#64748b",
      status: run.status,
      cpuPeakPct: run.metrics.cpuPeakPct,
      rssPeakMb: run.metrics.rssPeakMb,
      score: getCompositeScore(result) * 100,
      judgeScore: (result?.quality.rubricScore ?? 0) * 100,
      criteriaCoverage: getCriteriaCoverage(result) * 100,
      confidenceScore: (result?.quality.confidenceScore ?? 0) * 100,
      tokens: tokenMetrics.total ?? 0,
      durationMs: result?.durationMs ?? run.progress.elapsedMs,
      handoffs: result?.coordination.handoffs ?? run.progress.handoffs,
      outputRatio: inputTokens > 0 ? outputTokens / inputTokens : 0,
      testsPassed: result?.quality.testsPassed ?? 0,
      testsFailed: result?.quality.testsFailed ?? 0,
      toolCalls: result?.resources.toolCallCount ?? run.progress.toolCalls,
      verificationMode: result?.quality.verificationMode ?? (result ? "judge_only" : "live"),
      rationale: result?.quality.rationale,
      outcome: result?.outcome ?? "pending"
    } satisfies LiveComparisonDatum;
  });
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getCompositeScore(run?: ExperimentRun | null) {
  if (!run) {
    return 0;
  }

  return run.quality.compositeScore ?? run.quality.rubricScore ?? 0;
}

function getCriteriaCoverage(run?: ExperimentRun | null) {
  if (!run) {
    return 0;
  }

  const total = run.quality.criteriaTotal ?? 0;
  const met = run.quality.criteriaMet ?? 0;
  if (total <= 0) {
    return run.quality.rubricScore ?? 0;
  }

  return met / total;
}

function getArchitectureDefinition(architecture: ArchitectureName) {
  return ARCHITECTURE_DEFINITIONS.find((definition) => definition.name === architecture) ?? null;
}

function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatDuration(valueMs: number) {
  const totalSeconds = Math.max(0, Math.round(valueMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatStatusLabel(status: LiveRunState["status"]) {
  if (status === "running") {
    return "Running";
  }
  if (status === "complete") {
    return "Complete";
  }
  if (status === "error") {
    return "Error";
  }
  return "Idle";
}

function formatVerificationMode(mode: string) {
  switch (mode) {
    case "simulated":
      return "Simulated";
    case "judge_only":
      return "Judge only";
    case "hybrid":
      return "Hybrid";
    case "live":
      return "Live";
    default:
      return mode || "Unknown";
  }
}

function formatTaskShape(shape: NonNullable<BenchmarkTaskDefinition["taskShape"]>) {
  switch (shape) {
    case "open_ended":
      return "Open-ended";
    case "verification":
      return "Verification";
    case "parallel":
      return "Parallel";
    case "sequential":
      return "Sequential";
    case "consensus":
      return "Consensus";
  }
}

function normalizeLiveErrorDetails(
  data: unknown,
  run: LiveRunState
): LiveErrorDetails {
  if (isLiveErrorDetails(data)) {
    return data;
  }

  const message = typeof data === "string" ? data : "Unknown runtime error.";
  const activeNode = Object.values(run.nodeEvents).find((event) => event.status === "running");

  return {
    kind: activeNode ? "node_failure" : "unknown",
    message,
    node: activeNode?.node,
    nodeLabel: activeNode?.label,
    retryable: true
  };
}

function isLiveErrorDetails(value: unknown): value is LiveErrorDetails {
  return typeof value === "object" && value !== null && "kind" in value && "message" in value;
}

function formatLiveErrorTrace(error: LiveErrorDetails) {
  const nodeLabel = error.nodeLabel ? ` while ${error.nodeLabel} was active` : "";
  return `${formatLiveErrorTitle(error)}${nodeLabel}: ${error.message}`;
}

function formatLiveErrorTitle(error: LiveErrorDetails) {
  switch (error.kind) {
    case "rate_limit":
      return "Rate limit";
    case "network":
      return "Network interruption";
    case "stream_disconnect":
      return "Stream disconnected";
    case "node_failure":
      return "Node failure";
    default:
      return "Runtime error";
  }
}
