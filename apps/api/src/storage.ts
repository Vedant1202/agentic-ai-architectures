import { access, readFile, writeFile } from "node:fs/promises";
import type { ExperimentRun } from "@agent-visibility/shared";

const observedRunsUrl = new URL("../../../data/runs.user.json", import.meta.url);

export async function loadUserRuns(): Promise<ExperimentRun[]> {
  const exists = await fileExists(observedRunsUrl);
  if (!exists) {
    return [];
  }

  const raw = await readFile(observedRunsUrl, "utf-8");
  const parsed = JSON.parse(raw) as { runs: ExperimentRun[] };
  return parsed.runs;
}

let writeLock = Promise.resolve();

export function appendUserRun(run: ExperimentRun): Promise<void> {
  writeLock = writeLock.then(async () => {
    const runs = await loadUserRuns();
    runs.unshift(run);
    await writeFile(observedRunsUrl, JSON.stringify({ runs }, null, 2));
  }).catch((err) => {
    console.error("Failed to write to ledger:", err);
  });
  return writeLock;
}

async function fileExists(url: URL) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}
