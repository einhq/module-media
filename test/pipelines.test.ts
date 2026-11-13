/**
 * The media module's pipelines: each trigger names the family of work it does (`renditions`,
 * `picture-vectors`, `fingerprints`, `text`, `transcripts`), so a folder that wants none gets none, and one that
 * decodes the source skips a source nothing can decode; reading names none, since every family
 * needs it. A written document starts media-stills on the documents a picture is made of, in the
 * paths document-index reads. Every kind a step queues under in the media pool is one the module's own
 * drop-ins name for the workers, or its jobs would wait forever, and a model-bound step takes one
 * slot.
 */

import { assertEquals } from '@std/assert';
import { parse as parseYaml } from '@std/yaml';
import { RENDERED_DOCUMENT_MIMETYPES } from '@ein/api';
import { RENDITIONS_FOR_ATTR } from '@media/rendition-marker';

type Trigger = {
  on?: string;
  event?: string;
  wants?: string | string[];
  skipIfAttr?: string;
  match?: { mimetype?: string[] };
  unless?: { nodePath?: string[] };
};
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
const FAMILIES: Record<string, string | string[]> = {
  'document-index.yaml': 'text',
  'media-embed-picture.yaml': 'picture-vectors',
  'media-embed-text.yaml': ['text', 'transcripts'],
  'media-fingerprint.yaml': 'fingerprints',
  'media-ocr.yaml': 'text',
  'media-stills.yaml': 'renditions',
  'media-transcode.yaml': 'renditions',
  'media-transcribe.yaml': 'transcripts',
};
/** The pipelines that decode the source, and so skip one nothing can decode. */
const DECODING = new Set(['media-embed-picture.yaml', 'media-fingerprint.yaml', 'media-stills.yaml', 'media-transcode.yaml', 'media-transcribe.yaml']);
const UNGATED: Record<string, string> = {
  'media-ingest.yaml': 'reads the file, which every family needs',
  'media-reindex.yaml': 'reads the file again when its bytes change, which every family needs',
};

Deno.test('every trigger names its family, and a pipeline that decodes the source skips one nothing can decode', async () => {
  const found = await pipelines();
  assertEquals(found.map(([name]) => name), [...Object.keys(FAMILIES), ...Object.keys(UNGATED)].sort());
  for (const [name, definition] of found) {
    for (const trigger of definition.triggers ?? (definition.trigger ? [definition.trigger] : [])) {
      const which = `${name}: ${trigger.on ?? trigger.event}`;
      if (name in UNGATED) assertEquals(trigger.wants, undefined, `${name}: ${UNGATED[name]}`);
      else assertEquals(trigger.wants, FAMILIES[name], which);
      // A written document's own trigger skips one already marked: `generate-derivatives` marks one
      // EMS cannot open as undecodable and answers it from the attr.
      if (DECODING.has(name)) assertEquals(trigger.skipIfAttr, trigger.event ? RENDITIONS_FOR_ATTR : 'undecodable', which);
    }
  }
});

Deno.test('a written or moved document starts media-stills where document-index would read it', async () => {
  const found = new Map(await pipelines());
  const documents = found.get('media-stills.yaml')!.triggers!.filter((trigger) => trigger.event);
  const read = found.get('document-index.yaml')!.triggers!.find((trigger) => trigger.event === 'updated')!;
  assertEquals(documents.map((trigger) => trigger.event), ['updated', 'moved']);
  for (const trigger of documents) {
    assertEquals(trigger.match?.mimetype, [...RENDERED_DOCUMENT_MIMETYPES], trigger.event);
    assertEquals(trigger.unless?.nodePath, read.unless?.nodePath, trigger.event);
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
