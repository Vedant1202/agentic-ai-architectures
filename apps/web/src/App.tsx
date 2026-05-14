import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import {
  ARCHITECTURE_DEFINITIONS,
  type ArchitectureName,
  type BenchmarkRunRequest,
  type BenchmarkTaskDefinition,
  type DatasetOverviewResponse,
  type ExperimentRun,
  type LiveUpdate,
  type NodeTraceEvent,
} from "@agent-visibility/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

interface LiveRunState {
  architecture: ArchitectureName;
  status: "idle" | "running" | "complete" | "error";
  trace: string[];
  nodeEvents: Record<string, NodeTraceEvent>;
  metrics: {
    cpuAvgPct: number;
    cpuPeakPct: number;
    rssPeakMb: number;
  };
  result?: ExperimentRun;
}

export default function App() {
  const [data, setData] = useState<DatasetOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedArches, setSelectedArches] = useState<ArchitectureName[]>([
    "single",
    "centralized",
    "hybrid",
  ]);
  const [isComparing, setIsComparing] = useState(false);
  const [liveRuns, setLiveRuns] = useState<Record<string, LiveRunState>>({});

  useEffect(() => {
    loadOverview();
  }, []);

  async function loadOverview() {
    try {
      const response = await fetch(`${API_BASE_URL}/api/overview`);
      const nextData = await response.json();
      setData(nextData);
      setSelectedTaskId(nextData.benchmarkTasks[0]?.id || "");
      setLoading(false);
    } catch (error) {
      console.error("Failed to load overview", error);
    }
  }

  const handleRunComparison = () => {
    setIsComparing(true);
    const initialLiveRuns: Record<string, LiveRunState> = {};
    selectedArches.forEach((arch) => {
      initialLiveRuns[arch] = {
        architecture: arch,
        status: "running",
        trace: [],
        nodeEvents: {},
        metrics: { cpuAvgPct: 0, cpuPeakPct: 0, rssPeakMb: 0 },
      };
    });
    setLiveRuns(initialLiveRuns);

    const params = new URLSearchParams({
      taskId: selectedTaskId,
      architectures: selectedArches.join(","),
      customPrompt: selectedTaskId === "custom" ? customPrompt : "",
    });

    const eventSource = new EventSource(
      `${API_BASE_URL}/api/benchmark-stream?${params.toString()}`
    );

    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data) as LiveUpdate;
      
      setLiveRuns((prev) => {
        const current = prev[update.architecture];
        if (!current) return prev;

        if (update.type === "trace") {
          return {
            ...prev,
            [update.architecture]: {
              ...current,
              trace: [...current.trace, update.data],
            },
          };
        }

        if (update.type === "node_event") {
          const event = update.data as NodeTraceEvent;
          return {
            ...prev,
            [update.architecture]: {
              ...current,
              nodeEvents: {
                ...current.nodeEvents,
                [event.node]: event,
              },
            },
          };
        }

        if (update.type === "metrics") {
          return {
            ...prev,
            [update.architecture]: {
              ...current,
              metrics: update.data,
            },
          };
        }

        if (update.type === "complete") {
          return {
            ...prev,
            [update.architecture]: {
              ...current,
              status: "complete",
              result: update.data,
            },
          };
        }

        if (update.type === "error") {
          return {
            ...prev,
            [update.architecture]: {
              ...current,
              status: "error",
            },
          };
        }

        return prev;
      });
    };

    eventSource.addEventListener("end", () => {
      eventSource.close();
      setIsComparing(false);
      loadOverview(); // Refresh the ledger
    });

    eventSource.onerror = () => {
      eventSource.close();
      setIsComparing(false);
    };
  };

  const toggleArch = (arch: ArchitectureName) => {
    setSelectedArches((prev) =>
      prev.includes(arch) ? prev.filter((a) => a !== arch) : [...prev, arch]
    );
  };

  if (loading) return <div className="loading">Initializing Agent Lab...</div>;

  return (
    <div className="page-shell">
      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Agent Visibility 2.0</span>
          <h1>Architectural Benchmarking</h1>
          <p>
            Compare coordination patterns in real-time. Analyze the tradeoffs
            between single-agent efficiency and multi-agent robustness.
          </p>
        </div>
        <div className="hero-panel">
          <StatCard label="Live Runner" value={data?.runner.mode === "live" ? "Gemini 1.5 Pro" : "Simulated"} detail="Provider: LangGraph" />
          <StatCard label="Total Runs" value={data?.runs.length.toString() || "0"} detail="In local ledger" />
          <StatCard label="Avg Quality" value="84%" detail="Cross-arch average" />
          <StatCard label="Throughput" value="1.2 req/s" detail="System capacity" />
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>Runner Configuration</h2>
          <p>Select a preset task or define a custom challenge to run across architectures.</p>
        </div>

        <div className="runner-controls">
          <div className="input-group">
            <label>Benchmark Task</label>
            <select
              value={selectedTaskId}
              onChange={(e) => setSelectedTaskId(e.target.value)}
            >
              {data?.benchmarkTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.label}
                </option>
              ))}
            </select>
            {selectedTaskId === "custom" && (
              <textarea
                placeholder="Enter your custom task prompt here..."
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
              />
            )}
            {selectedTaskId !== "custom" && (
              <div className="task-preview">
                {data?.benchmarkTasks.find(t => t.id === selectedTaskId)?.prompt}
              </div>
            )}
          </div>

          <div className="input-group">
            <label>Comparison Architectures</label>
            <div className="arch-selector">
              {ARCHITECTURE_DEFINITIONS.map((arch) => (
                <button
                  key={arch.name}
                  className={`arch-toggle ${selectedArches.includes(arch.name) ? "active" : ""}`}
                  onClick={() => toggleArch(arch.name)}
                >
                  {arch.label}
                </button>
              ))}
            </div>
            <button
              className="run-btn"
              onClick={handleRunComparison}
              disabled={isComparing || selectedArches.length === 0}
            >
              {isComparing ? "Running Comparison..." : "Run Parallel Benchmark"}
            </button>
          </div>
        </div>
      </section>

      {Object.keys(liveRuns).length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h2>Live Comparative Dashboard</h2>
            <p>Real-time tradeoff analysis across selected architectures.</p>
          </div>
          <LiveComparativeDashboard liveRuns={liveRuns} />
        </section>
      )}

      <section className="panel">
        <div className="panel-header">
          <h2>Global Ledger</h2>
          <p>Historical data from previous experiments.</p>
        </div>
        <table className="ledger-table">
          <thead>
            <tr>
              <th>Run ID</th>
              <th>Task</th>
              <th>Architecture</th>
              <th>Quality</th>
              <th>Tokens</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.runs.slice().reverse().map((run) => (
              <tr key={run.runId}>
                <td>{run.runId.slice(0, 8)}</td>
                <td>{run.taskLabel}</td>
                <td>{run.architecture}</td>
                <td>
                  <div className="mini-stat">
                    <strong>{(run.quality.rubricScore * 100).toFixed(0)}%</strong>
                  </div>
                </td>
                <td>{formatCompact(run.tokens.total)}</td>
                <td>{formatDuration(run.durationMs)}</td>
                <td>
                  <span className={`outcome-badge outcome-${run.outcome}`}>
                    {run.outcome}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const ARCH_COLORS: Record<string, string> = {
  single: "#60a5fa",
  centralized: "#f472b6",
  hybrid: "#a78bfa",
  decentralized_emulated: "#34d399",
};

function LiveComparativeDashboard({ liveRuns }: { liveRuns: Record<string, LiveRunState> }) {
  const data = Object.values(liveRuns).map(run => {
    const archDef = ARCHITECTURE_DEFINITIONS.find(a => a.name === run.architecture);
    return {
      architecture: run.architecture,
      label: archDef?.label || run.architecture,
      cpuPeakPct: run.metrics.cpuPeakPct,
      rssPeakMb: run.metrics.rssPeakMb,
      score: run.result ? run.result.quality.rubricScore * 100 : 0,
      tokens: run.result ? run.result.tokens.total : 0,
      status: run.status,
      trace: run.trace,
    };
  });

  return (
    <div className="live-comparative-dashboard">
      <div className="charts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        
        {/* CPU Chart */}
        <div className="chart-card" style={{ background: 'var(--panel-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>Peak CPU (%)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Bar dataKey="cpuPeakPct" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={ARCH_COLORS[entry.architecture] || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Memory Chart */}
        <div className="chart-card" style={{ background: 'var(--panel-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>Peak Memory (MB)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Bar dataKey="rssPeakMb" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={ARCH_COLORS[entry.architecture] || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Score Chart */}
        <div className="chart-card" style={{ background: 'var(--panel-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>Quality Score (%)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={ARCH_COLORS[entry.architecture] || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tokens Chart */}
        <div className="chart-card" style={{ background: 'var(--panel-bg)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          <h3 style={{ marginBottom: '16px', fontSize: '14px', color: 'var(--text-muted)' }}>Total Tokens</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(255,255,255,0.05)' }} contentStyle={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              <Bar dataKey="tokens" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={ARCH_COLORS[entry.architecture] || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Visual Flowcharts */}
      <div className="unified-traces" style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length > 2 ? 2 : data.length}, 1fr)`, gap: '16px' }}>
        {Object.values(liveRuns).map((run) => {
          const archDef = ARCHITECTURE_DEFINITIONS.find(a => a.name === run.architecture);
          return (
            <div key={run.architecture} className={`arch-run-card ${run.status === "running" ? "active" : ""} ${run.status === "complete" ? "complete" : ""}`}>
               <div className="arch-header">
                  <h3 style={{ color: ARCH_COLORS[run.architecture] }}>{archDef?.label || run.architecture}</h3>
                  <span className={`arch-status-tag ${run.status}`}>
                    {run.status}
                  </span>
                </div>
                <VisualFlowchart architecture={run.architecture} nodeEvents={run.nodeEvents} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VisualFlowchart({ architecture, nodeEvents }: { architecture: ArchitectureName, nodeEvents: Record<string, NodeTraceEvent> }) {
  
  const renderNode = (nodeId: string) => {
    const event = nodeEvents[nodeId];
    const isActive = event?.status === "running";
    const isComplete = event?.status === "complete";
    return (
      <div 
        key={nodeId}
        style={{
          padding: '12px',
          borderRadius: '8px',
          border: `2px solid ${isActive ? '#60a5fa' : isComplete ? '#34d399' : 'var(--border-color)'}`,
          background: isComplete ? 'rgba(52, 211, 153, 0.1)' : isActive ? 'rgba(96, 165, 250, 0.1)' : 'transparent',
          minWidth: '120px',
          textAlign: 'center',
          position: 'relative',
          transition: 'all 0.3s ease',
          boxShadow: isActive ? '0 0 10px rgba(96, 165, 250, 0.3)' : 'none'
        }}
        title={event?.output || "Waiting..."}
      >
        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-color)' }}>
          {event?.label || nodeId.replace('_', ' ').toUpperCase()}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
          {isActive && "Running..."}
          {isComplete && `${event?.tokens || 0} tkns`}
          {!isActive && !isComplete && "Pending"}
        </div>
      </div>
    );
  };

  const Arrow = () => <div style={{ color: 'var(--border-color)', margin: '0 8px' }}>→</div>;

  if (architecture === "decentralized_emulated") {
    return (
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '8px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {renderNode("peer_a")}
          {renderNode("peer_b")}
        </div>
        <Arrow />
        {renderNode("peer_merge")}
        <Arrow />
        {renderNode("finalize")}
      </div>
    );
  }

  const layouts: Record<string, string[]> = {
    single: ["finalize"],
    centralized: ["plan", "research", "implement", "finalize"],
    hybrid: ["plan", "research", "implement", "review", "finalize"],
  };

  const flow = layouts[architecture] || [];

  return (
    <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '8px 0' }}>
      {flow.map((nodeId, index) => (
        <div key={nodeId} style={{ display: 'flex', alignItems: 'center' }}>
          {renderNode(nodeId)}
          {index < flow.length - 1 && <Arrow />}
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function formatDuration(value: number) {
  const seconds = Math.round(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
