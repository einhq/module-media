/**
 * The media module's pipelines: a rendition pipeline's triggers name the `renditions` family, so a
 * folder that wants none gets none, and skip a source nothing can decode; reading names none, since
 * every family needs it. Every kind a step queues under in the media pool is one the module's own
 * drop-ins name for the workers, or its jobs would wait forever, and a model-bound step takes one
 * slot.
 */

import { assertEquals } from '@std/assert';
import { parse as parseYaml } from '@std/yaml';

type Trigger = { on: string; wants?: string | string[]; skipIfAttr?: string };
type PipelineFile = {
  trigger?: Trigger;
  triggers?: Trigger[];
  steps: Record<string, { kind?: string; pool?: string; requires?: Record<string, number> }>;
};

const moduleRoot = new URL('../', import.meta.url);

/** Every pipeline the module ships, by file name. */
const pipelines = async (): Promise<[string, PipelineFile][]> => {
  const found: [string, PipelineFile][] = [];
  for await (const entry of Deno.readDir(new URL('pipelines/', moduleRoot))) {
    if (!entry.name.endsWith('.yaml')) continue;
    found.push([entry.name, parseYaml(await Deno.readTextFile(new URL(`pipelines/${entry.name}`, moduleRoot))) as PipelineFile]);
  }
  return found.sort(([a], [b]) => a.localeCompare(b));
};

/** The kinds a drop-in names, as `media-pool-kinds` reads it: a kind a line, `#` a comment. */
const dropInKinds = async (worker: string): Promise<string[]> =>
  (await Deno.readTextFile(new URL(`etc/${worker}.d/kinds`, moduleRoot)))
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim().split(/\s+/)[0])
    .filter(Boolean);

/** The family each pipeline's triggers name, and why the others name none. */
const FAMILIES: Record<string, string> = { 'media-stills.yaml': 'renditions', 'media-transcode.yaml': 'renditions' };
const UNGATED: Record<string, string> = {
  'media-ingest.yaml': 'reads the file, which every family needs',
  'media-reindex.yaml': 'reads the file again when its bytes change, which every family needs',
};

Deno.test('every trigger names its family, and a rendition pipeline skips a source nothing can decode', async () => {
  const found = await pipelines();
  assertEquals(found.map(([name]) => name), [...Object.keys(FAMILIES), ...Object.keys(UNGATED)].sort());
  for (const [name, definition] of found) {
    for (const trigger of definition.triggers ?? (definition.trigger ? [definition.trigger] : [])) {
      if (name in UNGATED) assertEquals(trigger.wants, undefined, `${name}: ${UNGATED[name]}`);
      else assertEquals([trigger.wants, trigger.skipIfAttr], [FAMILIES[name], 'undecodable'], `${name}: ${trigger.on}`);
    }
  }
});

Deno.test('every kind a step queues under is one the drop-ins name', async () => {
  const cpu = await dropInKinds('media-worker');
  const models = await dropInKinds('media-models');
  for (const [name, definition] of await pipelines()) {
    for (const [stepName, step] of Object.entries(definition.steps)) {
      if (!step.pool) continue;
      const kind = step.kind ?? '';
      if (step.requires?.models !== undefined) {
        assertEquals(step.requires, { models: 1 }, `${name}: ${stepName}`);
        assertEquals(models.includes(kind), true, `${name}: ${stepName} queues under ${kind}, which media-models.d does not name`);
      } else {
        assertEquals(cpu.includes(kind), true, `${name}: ${stepName} queues under ${kind}, which media-worker.d does not name`);
      }
    }
  }
});
