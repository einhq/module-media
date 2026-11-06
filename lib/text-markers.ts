/**
 * The markers on a file that say its transcript and its text vectors are current, which `text-scan`
 * finds the gaps of by a query rather than a walk.
 *
 * - `transcriptWith`: the decode settings the file's transcript was made with (the transcript
 *   node's `transcribedWith`), or `kept` for a transcript no change of settings redoes: one a person
 *   wrote, and one of a file with no sound. `transcribe-file` writes it last.
 * - `textVectorsBy`: the text embedder every text of the file has a vector from — its extracted
 *   text, its transcript and its hand-written description. Every command that writes a text or its
 *   vector settles it last (`settleTextVectors`), so it is cleared by a write whose embed failed.
 */

import type { Command } from '@ein/client';
import { generations } from '@ems/client';
import { authoredHash, authoredParent, textEmbeddingType } from '@ems/text-embedding';
import { CHUNK_TARGET_SECONDS } from '@media/transcript';

/** File-node attr: the decode settings of the file's transcript, or `TRANSCRIPT_KEPT`. */
export const TRANSCRIPT_WITH_ATTR = 'transcriptWith';

/** `transcriptWith` of a transcript no change of settings redoes: written by hand, or of no sound. */
export const TRANSCRIPT_KEPT = 'kept';

/** File-node attr: the text embedder every text of the file has a current vector from. */
export const TEXT_VECTORS_BY_ATTR = 'textVectorsBy';

/** The text nodes under a file's `metadata/` that carry a vector, by name. */
const TEXT_NODE_NAMES = ['content', 'transcript'] as const;

const get = (cmd: Command, path: string) => cmd.sys.vfs.get(cmd.access, path).catch(() => undefined);

/** How long the text embedder EMS answered with is trusted, ms: a crawl settles a file a moment. */
const EMBEDDER_TTL_MS = 10_000;

/** The text embedder each EMS answered with lately, by its URL. */
const embedders = new Map<string, { at: number; value: string | null }>();

/** The text embedder EMS runs now, null when it runs none or does not answer, asked once in a while. */
const currentEmbedder = async (cmd: Command): Promise<string | null> => {
  const url = cmd.env.CFG_EMS_URL ?? '';
  const known = embedders.get(url);
  if (known && Date.now() - known.at < EMBEDDER_TTL_MS) return known.value;
  const value = (await generations(cmd))?.textEmbed ?? null;
  embedders.set(url, { at: Date.now(), value });
  return value;
};

/**
 * Which of the texts of the file at `file` (with `attrs`) have no current vector from `generation`,
 * as `media-reembed` decides it: the vector beside the text, named for the model's type, has to
 * carry `embeddedBy` equal to it; a transcript's chunk set also has to be cut at
 * CHUNK_TARGET_SECONDS, and a hand-written description's vector has to carry the hash of the text
 * as it is now. Undefined when nothing has given `generation` a type.
 *
 * A text that gives `media-reembed` nothing to embed is never stale: an empty text node, and a
 * transcript that heard no speech. A content vector made from the opening of a long text, which
 * `media-reembed` redoes in parts, is not asked about: telling it apart takes the text itself.
 */
export const staleTexts = async (cmd: Command, file: string, attrs: Record<string, unknown>, generation: string): Promise<string[] | undefined> => {
  const type = textEmbeddingType(generation);
  if (!type) return undefined;

  const stale: string[] = [];
  for (const name of TEXT_NODE_NAMES) {
    const text = await get(cmd, `${file}/metadata/${name}`);
    if (text?.type !== 'file' || text.attrs.size === 0 || (name === 'transcript' && text.attrs.speech === false)) continue;
    const vector = await get(cmd, `${file}/metadata/${name}/${type}`);
    if (vector?.attrs.embeddedBy === generation && (name !== 'transcript' || vector.attrs.chunkSeconds === CHUNK_TARGET_SECONDS)) continue;
    stale.push(name);
  }

  const authored = typeof attrs.description === 'string' ? attrs.description.trim() : '';
  if (authored) {
    const vector = await get(cmd, `${authoredParent(file)}/${type}`);
    if (vector?.attrs.embeddedBy !== generation || vector.attrs.authoredHash !== await authoredHash(authored)) stale.push('authored');
  }
  return stale;
};

/**
 * Mark the file at `file` with the text embedder EMS runs now when every text of it has a vector
 * from it, and clear the mark otherwise — also when EMS cannot say what it runs, so that the next
 * scan asks again. `generation` saves asking EMS when the caller has. A file that is gone, or
 * that the caller may not write, is left as it is.
 */
export const settleTextVectors = async (cmd: Command, file: string, generation?: string | null): Promise<void> => {
  const node = await get(cmd, file);
  if (node?.type !== 'file') return;
  const now = generation === undefined ? await currentEmbedder(cmd) : generation;
  const stale = now ? await staleTexts(cmd, file, node.attrs, now) : undefined;
  const marker = now && stale?.length === 0 ? now : null;
  if ((node.attrs[TEXT_VECTORS_BY_ATTR] ?? null) === marker) return;
  await cmd.sys.vfs.update(cmd.access, file, { attrs: { [TEXT_VECTORS_BY_ATTR]: marker } }).catch(() => {});
};
