import { readFile } from "node:fs/promises";
import express from "express";
import cors from "cors";
import { config as loadEnv } from "dotenv";
import {
  ARCHITECTURE_DEFINITIONS,
  TOOL_DEFINITIONS,
  type BenchmarkRunRequest,
  type DatasetOverviewResponse,
  type ExperimentRun,
  type LiveErrorDetails,
  type LiveUpdate,
  type NodeTraceEvent
} from "@agent-visibility/shared";
import { runBenchmark, getRunnerStatus } from "./langgraphRunner.js";
import { appendUserRun, loadUserRuns } from "./storage.js";
import { BENCHMARK_TASKS, getTaskById } from "./tasks.js";

loadEnv({ path: new URL("../../../.env", import.meta.url) });
loadEnv({ path: new URL("../../../.env.local", import.meta.url) });

const app = express();
const port = Number(process.env.PORT ?? 4000);
const datasetUrl = new URL("../../../data/runs.sample.json", import.meta.url);

app.use(cors());
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    service: "agent-visibility-api",
    timestamp: new Date().toISOString()
  });
});

app.get("/api/overview", async (_request, response) => {
  try {
    const sampleRuns = await loadSampleRuns();
    const userRuns = await loadUserRuns();
    const runs = [...userRuns, ...sampleRuns];
    const payload: DatasetOverviewResponse = {
      generatedAt: new Date().toISOString(),
      mode: deriveMode(sampleRuns, userRuns),
      runs,
      tools: TOOL_DEFINITIONS.filter((tool) =>
        runs.some((run) => run.tool === tool.name)
      ),
      architectures: ARCHITECTURE_DEFINITIONS.filter((architecture) =>
        runs.some((run) => run.architecture === architecture.name)
      ),
      taskOptions: buildTaskOptions(runs),
      benchmarkTasks: BENCHMARK_TASKS,
      runner: getRunnerStatus()
    };

    response.json(payload);
  } catch (error) {
    response.status(500).json({
      message: "Failed to load experiment dataset.",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.post("/api/benchmark-runs", async (request, response) => {
  try {
    const body = request.body as Partial<BenchmarkRunRequest>;
    if (!body.taskId || !body.architecture) {
      response.status(400).json({
        message: "taskId and architecture are required."
      });
      return;
    }

    const task = getTaskById(body.taskId);
    if (!task) {
      response.status(404).json({
        message: `Unknown benchmark task: ${body.taskId}`
      });
      return;
    }

    const runResponse = await runBenchmark(
      {
        taskId: task.id,
        architecture: body.architecture,
        persist: body.persist ?? true
      },
      task
    );

    if (runResponse.persisted || body.persist !== false) {
      await appendUserRun(runResponse.run);
      runResponse.persisted = true;
    }

    response.status(201).json(runResponse);
  } catch (error) {
    response.status(500).json({
      message: "Failed to run benchmark.",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

app.get("/api/benchmark-stream", async (request, response) => {
  const taskId = request.query.taskId as string;
  const customPrompt = request.query.customPrompt as string;
  const architecturesRaw = request.query.architectures as string;

  if (!taskId || !architecturesRaw) {
    response.status(400).json({ message: "taskId and architectures are required." });
    return;
  }

  const task = getTaskById(taskId);
  if (!task && taskId !== "custom") {
    response.status(404).json({ message: `Unknown task: ${taskId}` });
    return;
  }

  const architectures = architecturesRaw.split(",") as any[];

  // SSE Setup
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();

  const sendUpdate = (update: any) => {
    response.write(`data: ${JSON.stringify(update)}\n\n`);
  };

  try {
    const runPromises = architectures.map(async (arch) => {
      const nodeState = new Map<string, NodeTraceEvent>();
      try {
        const runResponse = await runBenchmark(
          {
            taskId,
            architecture: arch,
            persist: true,
            customPrompt: taskId === "custom" ? customPrompt : undefined
          },
          task || BENCHMARK_TASKS.find(t => t.id === "custom")!,
          (update) => {
            trackNodeState(nodeState, update);
            sendUpdate(update);
          }
        );

        await appendUserRun(runResponse.run);
        sendUpdate({
          architecture: arch,
          type: "complete",
          data: runResponse.run
        });
      } catch (error) {
        const details = buildLiveErrorDetails(error, nodeState);
        sendUpdate({
          architecture: arch,
          type: "error",
          data: details
        });
      }
    });

    await Promise.all(runPromises);
    response.write("event: end\ndata: done\n\n");
    response.end();
  } catch (error) {
    console.error("Stream error:", error);
    response.end();
  }
});

app.listen(port, () => {
  console.log(`agent-visibility-api listening on http://localhost:${port}`);
});

async function loadSampleRuns(): Promise<ExperimentRun[]> {
  const raw = await readFile(datasetUrl, "utf-8");
  const parsed = JSON.parse(raw) as { runs: ExperimentRun[] };
  return parsed.runs;
}

function buildTaskOptions(runs: ExperimentRun[]) {
  const entries = new Map<string, string>();

  for (const run of runs) {
    if (!entries.has(run.taskId)) {
      entries.set(run.taskId, run.taskLabel);
    }
  }

  return [...entries.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function deriveMode(sampleRuns: ExperimentRun[], userRuns: ExperimentRun[]) {
  if (userRuns.length === 0) {
    return "sample" as const;
  }

  if (sampleRuns.length === 0) {
    return userRuns.every((run) => run.executionMode === "live") ? "observed" : "simulated";
  }

  return "mixed" as const;
}

function trackNodeState(
  nodeState: Map<string, NodeTraceEvent>,
  update: LiveUpdate
) {
  if (update.type !== "node_event") {
    return;
  }

  const event = update.data as NodeTraceEvent;
  nodeState.set(event.node, event);
}

function buildLiveErrorDetails(
  error: unknown,
  nodeState: Map<string, NodeTraceEvent>
): LiveErrorDetails {
  const message = error instanceof Error ? error.message : "Unknown error";
  const normalized = message.toLowerCase();
  const activeNode = [...nodeState.values()].reverse().find((node) => node.status === "running");

  let kind: LiveErrorDetails["kind"] = "unknown";
  let retryable = false;

  if (
    normalized.includes("rate limit")
    || normalized.includes("quota")
    || normalized.includes("429")
  ) {
    kind = "rate_limit";
    retryable = true;
  } else if (
    normalized.includes("network")
    || normalized.includes("fetch")
    || normalized.includes("econn")
    || normalized.includes("timeout")
    || normalized.includes("socket")
    || normalized.includes("connect")
    || normalized.includes("dns")
  ) {
    kind = "network";
    retryable = true;
  } else if (activeNode) {
    kind = "node_failure";
    retryable = true;
  }

  return {
    kind,
    message,
    node: activeNode?.node,
    nodeLabel: activeNode?.label,
    retryable
  };
}
