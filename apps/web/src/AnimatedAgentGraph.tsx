import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Node,
  type NodeProps
} from "@xyflow/react";
import { AnimatePresence, motion } from "framer-motion";
import "@xyflow/react/dist/style.css";
import type { ArchitectureName, NodeTraceEvent } from "@agent-visibility/shared";

interface LayoutConfig {
  nodes: { id: string; x: number; y: number; label: string }[];
  edges: { source: string; target: string }[];
}

interface AgentNodeData extends Record<string, unknown> {
  label: string;
  status: "pending" | "running" | "complete";
  tokens: number;
  streamedText?: string;
  onClick: () => void;
}

const LAYOUTS: Record<ArchitectureName, LayoutConfig> = {
  single: {
    nodes: [{ id: "finalize", x: 220, y: 100, label: "Finalizer" }],
    edges: []
  },
  centralized: {
    nodes: [
      { id: "plan", x: 36, y: 100, label: "Coordinator" },
      { id: "research", x: 232, y: 24, label: "Researcher" },
      { id: "implement", x: 232, y: 176, label: "Implementer" },
      { id: "finalize", x: 428, y: 100, label: "Finalizer" }
    ],
    edges: [
      { source: "plan", target: "research" },
      { source: "plan", target: "implement" },
      { source: "research", target: "finalize" },
      { source: "implement", target: "finalize" }
    ]
  },
  hybrid: {
    nodes: [
      { id: "plan", x: 24, y: 100, label: "Coordinator" },
      { id: "peer_a", x: 210, y: 24, label: "Peer A" },
      { id: "peer_b", x: 210, y: 176, label: "Peer B" },
      { id: "review", x: 396, y: 100, label: "Reviewer" },
      { id: "finalize", x: 582, y: 100, label: "Finalizer" }
    ],
    edges: [
      { source: "plan", target: "peer_a" },
      { source: "plan", target: "peer_b" },
      { source: "peer_a", target: "review" },
      { source: "peer_b", target: "review" },
      { source: "review", target: "finalize" }
    ]
  },
  decentralized: {
    nodes: [
      { id: "peer_a", x: 36, y: 24, label: "Peer A" },
      { id: "peer_b", x: 36, y: 176, label: "Peer B" },
      { id: "peer_merge", x: 240, y: 100, label: "Peer Merge" },
      { id: "finalize", x: 444, y: 100, label: "Finalizer" }
    ],
    edges: [
      { source: "peer_a", target: "peer_merge" },
      { source: "peer_b", target: "peer_merge" },
      { source: "peer_merge", target: "finalize" }
    ]
  },
  dynamic_swarm: {
    nodes: [
      { id: "manager", x: 36, y: 100, label: "Swarm Manager" },
      { id: "finalize", x: 488, y: 100, label: "Finalizer" }
    ],
    edges: [{ source: "manager", target: "finalize" }]
  }
};

const DEFAULT_DYNAMIC_LABELS: Record<string, string> = {
  manager: "Swarm Manager",
  finalize: "Finalizer"
};

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>) {
  const { label, status, tokens, streamedText, onClick } = data;
  const isRunning = status === "running";
  const isComplete = status === "complete";

  const borderColor = isRunning
    ? "rgba(96, 165, 250, 0.92)"
    : isComplete
      ? "rgba(52, 211, 153, 0.85)"
      : "rgba(148, 163, 184, 0.25)";

  return (
    <div
      onClick={isComplete ? onClick : undefined}
      style={{
        position: "relative",
        minWidth: "142px",
        padding: "14px 14px 12px",
        borderRadius: "18px",
        border: `1px solid ${borderColor}`,
        background: "linear-gradient(180deg, var(--graph-node-bg-strong), var(--graph-node-bg))",
        boxShadow: isRunning ? "0 18px 36px rgba(37, 99, 235, 0.22)" : "none",
        color: "var(--text-primary)",
        cursor: isComplete ? "pointer" : "default",
        transition: "transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease",
        backdropFilter: "blur(16px)"
      }}
    >
      {isRunning && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 5, ease: "linear" }}
          style={{
            position: "absolute",
            inset: "-5px",
            border: "1px dashed rgba(96, 165, 250, 0.42)",
            borderRadius: "22px",
            pointerEvents: "none"
          }}
        />
      )}

      {isRunning && streamedText && (
        <motion.div
          initial={{ opacity: 0, y: 10, x: "-50%" }}
          animate={{ opacity: 1, y: 0, x: "-50%" }}
          style={{
            position: "absolute",
            left: "50%",
            bottom: "calc(100% + 14px)",
            width: "180px",
            padding: "10px 12px",
            borderRadius: "14px",
            border: "1px solid rgba(96, 165, 250, 0.45)",
            background: "var(--graph-tooltip-bg)",
            boxShadow: "0 16px 28px rgba(2, 6, 23, 0.42)",
            color: "var(--text-secondary)",
            fontSize: "11px",
            lineHeight: 1.45,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            zIndex: 10
          }}
        >
          {streamedText.length > 140 ? `…${streamedText.slice(-140)}` : streamedText}
        </motion.div>
      )}

      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <span
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.16em",
            color: "var(--text-secondary)"
          }}
        >
          {status}
        </span>
        <strong style={{ fontSize: "14px", fontWeight: 700 }}>{label}</strong>
        <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          {isRunning && "Streaming node output"}
          {isComplete && `${tokens.toLocaleString()} tokens`}
          {!isRunning && !isComplete && "Queued in the graph"}
        </span>
      </div>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = {
  agentNode: AgentNode
};

export function AnimatedAgentGraph({
  architecture,
  nodeEvents,
  dynamicEdges = []
}: {
  architecture: ArchitectureName;
  nodeEvents: Record<string, NodeTraceEvent & { streamedText?: string }>;
  dynamicEdges?: { source: string; target: string }[];
}) {
  const [selectedEvent, setSelectedEvent] = useState<(NodeTraceEvent & { streamedText?: string }) | null>(
    null
  );

  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    if (architecture !== "dynamic_swarm") {
      return LAYOUTS[architecture] ?? LAYOUTS.decentralized;
    }

    const eventEntries = Object.entries(nodeEvents);
    if (eventEntries.length === 0) {
      return LAYOUTS.dynamic_swarm;
    }

    const nodes = eventEntries.map(([nodeId, event], index) => {
      if (nodeId === "manager") {
        return {
          id: nodeId,
          x: 36,
          y: 100,
          label: event.label || DEFAULT_DYNAMIC_LABELS[nodeId] || "Manager"
        };
      }

      if (nodeId === "finalize") {
        return {
          id: nodeId,
          x: 488,
          y: 100,
          label: event.label || DEFAULT_DYNAMIC_LABELS[nodeId] || "Finalizer"
        };
      }

      const verticalIndex = Math.max(0, index - 1);
      return {
        id: nodeId,
        x: 258,
        y: 24 + verticalIndex * 92,
        label: event.label || `Agent ${verticalIndex + 1}`
      };
    });

    return {
      nodes,
      edges: dynamicEdges.length > 0 ? dynamicEdges : LAYOUTS.dynamic_swarm.edges
    };
  }, [architecture, dynamicEdges, nodeEvents]);

  const nodes = useMemo(
    () =>
      layoutNodes.map((node) => {
        const event = nodeEvents[node.id];
        return {
          id: node.id,
          type: "agentNode",
          position: { x: node.x, y: node.y },
          draggable: false,
          selectable: false,
          data: {
            label: event?.label || node.label,
            status: event?.status || "pending",
            tokens: event?.tokens || 0,
            streamedText: event?.streamedText,
            onClick: () => {
              if (event?.status === "complete") {
                setSelectedEvent(event);
              }
            }
          }
        };
      }),
    [layoutNodes, nodeEvents]
  );

  const edges = useMemo(
    () =>
      layoutEdges.map((edge) => {
        const sourceEvent = nodeEvents[edge.source];
        const targetEvent = nodeEvents[edge.target];
        const isFlowing =
          sourceEvent?.status === "complete" && targetEvent?.status === "running";
        const isSettled = sourceEvent?.status === "complete" && targetEvent?.status === "complete";

        return {
          id: `edge-${edge.source}-${edge.target}`,
          source: edge.source,
          target: edge.target,
          type: "smoothstep",
          animated: isFlowing,
          style: {
            stroke: isFlowing
              ? "#60a5fa"
              : isSettled
                ? "#34d399"
                : "rgba(148, 163, 184, 0.28)",
            strokeWidth: isFlowing ? 3 : 2
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: isFlowing
              ? "#60a5fa"
              : isSettled
                ? "#34d399"
                : "rgba(148, 163, 184, 0.48)"
          }
        };
      }),
    [layoutEdges, nodeEvents]
  );

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "272px",
        overflow: "hidden",
        borderRadius: "22px",
        border: "1px solid rgba(148, 163, 184, 0.14)",
        background: "linear-gradient(180deg, var(--graph-surface-top), var(--graph-surface-bottom))"
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.28 }}
        zoomOnScroll
        zoomOnPinch
        panOnDrag
        panOnScroll
        selectionOnDrag={false}
        preventScrolling={false}
        minZoom={0.45}
        maxZoom={1.75}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--graph-grid-color)" gap={24} size={1} />
        <Controls
          showInteractive={false}
          style={{
            border: "1px solid var(--panel-border)",
            borderRadius: "14px",
            background: "var(--graph-controls-bg)",
            boxShadow: "var(--shadow-md)"
          }}
        />
      </ReactFlow>

      <AnimatePresence>
        {selectedEvent && (
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              bottom: 14,
              width: "296px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              padding: "16px",
              borderRadius: "18px",
              border: "1px solid rgba(96, 165, 250, 0.26)",
              background: "var(--graph-overlay-bg)",
              boxShadow: "0 20px 40px rgba(2, 6, 23, 0.34)",
              zIndex: 20
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: "12px"
              }}
            >
              <div>
                <span
                  style={{
                    display: "block",
                    fontSize: "10px",
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    color: "var(--text-secondary)",
                    marginBottom: "6px"
                  }}
                >
                  Node payload
                </span>
                <strong style={{ fontSize: "15px" }}>{selectedEvent.label}</strong>
              </div>

              <button
                onClick={() => setSelectedEvent(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--text-secondary)",
                  cursor: "pointer",
                  fontSize: "18px",
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: "auto",
                borderRadius: "14px",
                border: "1px solid rgba(148, 163, 184, 0.14)",
                background: "var(--graph-node-bg)",
                padding: "12px",
                color: "var(--text-secondary)",
                whiteSpace: "pre-wrap",
                fontSize: "12px",
                lineHeight: 1.55,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
              }}
            >
              {selectedEvent.output || "No output captured for this node."}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
              <span style={{ color: "var(--text-secondary)" }}>Tokens</span>
              <strong>{selectedEvent.tokens?.toLocaleString() ?? "0"}</strong>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
