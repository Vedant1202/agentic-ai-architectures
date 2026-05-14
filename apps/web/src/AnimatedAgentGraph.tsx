import React, { useMemo, useState } from "react";
import { 
  ReactFlow, 
  Controls, 
  Background, 
  MarkerType, 
  Handle, 
  Position, 
  Edge, 
  NodeProps 
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { motion, AnimatePresence } from "framer-motion";
import type { NodeTraceEvent, ArchitectureName } from "@agent-visibility/shared";

// ---------------------------------------------------------
// Layout Definitions
// ---------------------------------------------------------

interface LayoutConfig {
  nodes: { id: string; x: number; y: number; label: string }[];
  edges: { source: string; target: string }[];
}

const LAYOUTS: Record<ArchitectureName, LayoutConfig> = {
  single: {
    nodes: [{ id: "finalize", x: 100, y: 50, label: "Finalizer" }],
    edges: []
  },
  centralized: {
    nodes: [
      { id: "plan", x: 50, y: 50, label: "Planner" },
      { id: "research", x: 250, y: 50, label: "Researcher" },
      { id: "implement", x: 450, y: 50, label: "Implementer" },
      { id: "finalize", x: 650, y: 50, label: "Finalizer" }
    ],
    edges: [
      { source: "plan", target: "research" },
      { source: "research", target: "implement" },
      { source: "implement", target: "finalize" }
    ]
  },
  hybrid: {
    nodes: [
      { id: "plan", x: 50, y: 50, label: "Planner" },
      { id: "research", x: 250, y: 50, label: "Researcher" },
      { id: "implement", x: 450, y: 50, label: "Implementer" },
      { id: "review", x: 650, y: 50, label: "Verifier" },
      { id: "finalize", x: 850, y: 50, label: "Finalizer" }
    ],
    edges: [
      { source: "plan", target: "research" },
      { source: "research", target: "implement" },
      { source: "implement", target: "review" },
      { source: "review", target: "finalize" }
    ]
  },
  decentralized_emulated: {
    nodes: [
      { id: "peer_a", x: 50, y: 0, label: "Peer A" },
      { id: "peer_b", x: 50, y: 100, label: "Peer B" },
      { id: "peer_merge", x: 250, y: 50, label: "Peer Merge" },
      { id: "finalize", x: 450, y: 50, label: "Finalizer" }
    ],
    edges: [
      { source: "peer_a", target: "peer_merge" },
      { source: "peer_b", target: "peer_merge" },
      { source: "peer_merge", target: "finalize" }
    ]
  }
};

// ---------------------------------------------------------
// Custom Node Component
// ---------------------------------------------------------

function AgentNode({ data }: NodeProps) {
  const { label, status, tokens, onClick } = data as any;
  const isRunning = status === "running";
  const isComplete = status === "complete";

  let borderColor = "var(--border-color)";
  if (isRunning) borderColor = "#60a5fa";
  if (isComplete) borderColor = "#34d399";

  return (
    <div 
      onClick={onClick}
      style={{
        position: 'relative',
        padding: '10px',
        borderRadius: '8px',
        background: 'var(--panel-bg)',
        border: `2px solid ${borderColor}`,
        minWidth: '130px',
        textAlign: 'center',
        cursor: isComplete ? 'pointer' : 'default',
        boxShadow: isRunning ? '0 0 15px rgba(96, 165, 250, 0.4)' : 'none',
        transition: 'all 0.3s ease',
      }}
    >
      {isRunning && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
          style={{
            position: 'absolute',
            top: -6, left: -6, right: -6, bottom: -6,
            border: '2px dashed rgba(96, 165, 250, 0.5)',
            borderRadius: '10px',
            pointerEvents: 'none'
          }}
        />
      )}

      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      
      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-color)' }}>
        {label}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
        {isRunning && "Running..."}
        {isComplete && `${tokens || 0} tokens`}
        {!isRunning && !isComplete && "Pending"}
      </div>

      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = {
  agentNode: AgentNode
};

// ---------------------------------------------------------
// Main Graph Component
// ---------------------------------------------------------

export function AnimatedAgentGraph({ 
  architecture, 
  nodeEvents 
}: { 
  architecture: ArchitectureName; 
  nodeEvents: Record<string, NodeTraceEvent> 
}) {
  const [selectedEvent, setSelectedEvent] = useState<NodeTraceEvent | null>(null);

  const config = LAYOUTS[architecture];

  const nodes = useMemo(() => {
    return config.nodes.map(n => {
      const event = nodeEvents[n.id];
      return {
        id: n.id,
        type: "agentNode",
        position: { x: n.x, y: n.y },
        data: {
          label: event?.label || n.label,
          status: event?.status || "pending",
          tokens: event?.tokens || 0,
          onClick: () => {
            if (event?.status === "complete") {
              setSelectedEvent(event);
            }
          }
        }
      };
    });
  }, [config, nodeEvents]);

  const edges = useMemo(() => {
    return config.edges.map((e, i) => {
      const targetEvent = nodeEvents[e.target];
      const sourceEvent = nodeEvents[e.source];
      // Animate if the target is currently running and the source is complete!
      const isFlowing = targetEvent?.status === "running" && sourceEvent?.status === "complete";
      
      return {
        id: `e-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        animated: isFlowing,
        type: 'smoothstep',
        style: {
          stroke: isFlowing ? '#60a5fa' : sourceEvent?.status === "complete" ? '#34d399' : 'var(--border-color)',
          strokeWidth: isFlowing ? 3 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isFlowing ? '#60a5fa' : sourceEvent?.status === "complete" ? '#34d399' : 'var(--border-color)'
        }
      };
    });
  }, [config, nodeEvents]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '220px', borderRadius: '8px', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
      <ReactFlow 
        nodes={nodes} 
        edges={edges} 
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        panOnDrag={false}
        zoomOnScroll={false}
      >
        <Background color="rgba(255,255,255,0.05)" gap={20} />
      </ReactFlow>

      {/* Inspector Panel */}
      <AnimatePresence>
        {selectedEvent && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            style={{
              position: 'absolute',
              top: 10, right: 10, bottom: 10,
              width: '300px',
              background: 'var(--bg-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              zIndex: 10
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '14px', color: '#34d399' }}>{selectedEvent.label} Payload</h3>
              <button 
                onClick={() => setSelectedEvent(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '18px' }}
              >
                &times;
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', fontSize: '12px', color: 'var(--text-color)', whiteSpace: 'pre-wrap', fontFamily: 'monospace', background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '4px' }}>
              {selectedEvent.output || "No output captured."}
            </div>
            <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
              Total Tokens: {selectedEvent.tokens}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
