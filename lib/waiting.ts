/**
 * Whether work waits for a fact: what a scan asks before it announces a gap, so that it never
 * announces again what is already on its way.
 */

import { POOLS_PATH } from '@ein/paths';
import type { PipelineSummary } from '@ein/api';
import type { Command } from '@ein/client';
import { join } from '@std/path';

/** The kinds with a ready job in the pool at `path`; none when there is no pool yet (a fresh boot). */
const readyKinds = async (cmd: Command, path: string): Promise<Set<string>> => {
  if (!await cmd.sys.vfs.exists(cmd.access, path)) return new Set();
  const stat = await cmd.sys.vfs.stat(cmd.access, path) as { byKind?: Record<string, { ready?: number }> };
  return new Set(Object.entries(stat.byKind ?? {}).filter(([, counts]) => (counts.ready ?? 0) > 0).map(([kind]) => kind));
};

/**
 * The fact types whose work waits, each mapped to whether it does: a type waits when a pipeline it
 * starts has a ready trigger, or a ready job in the media pool of a kind one of its steps runs. A
 * scan then would announce again what is already on its way, so `--if-idle` holds those facts
 * back. Counted per pipeline, not per pool: a backlog of one kind of work does not hold off gaps
 * that feed another, and a live tracker's debounced `track-trips` job, ready for as long as it
 * sends, holds off nothing here. Types no pipeline starts are left out.
 *
 * Undefined when the definitions cannot be read, which the caller takes as everything waiting.
 */
export const factsWaiting = async (cmd: Command, name: string): Promise<Map<string, boolean> | undefined> => {
  const listed = await cmd.execute('JSON_OUTPUT=1 pipeline list');
  let pipelines: PipelineSummary[];
  try {
    pipelines = JSON.parse(listed.stdout);
  } catch {
    await cmd.writeError(`${name}: could not read the pipeline definitions: ${listed.stderr.trim() || listed.stdout.trim()}\n`);
    return undefined;
  }

  const pools = cmd.env.POOLS_PATH || POOLS_PATH;
  const triggers = await readyKinds(cmd, join(pools, 'triggers'));
  const media = await readyKinds(cmd, join(pools, 'media'));
  const waiting = new Map<string, boolean>();
  for (const pipeline of pipelines) {
    const busy = triggers.has(pipeline.name) || Object.values(pipeline.stepKinds ?? {}).some((kind) => media.has(kind));
    for (const type of pipeline.triggers.flatMap((trigger) => trigger.on ?? [])) {
      waiting.set(type, (waiting.get(type) ?? false) || busy);
    }
  }

  return waiting;
};

/** Whether every one of `types` waits by `waiting`, which a scan of only those types would hold back whole. */
export const allWait = (waiting: Map<string, boolean> | undefined, types: string[]): boolean => !waiting || types.every((type) => waiting.get(type) !== false);
