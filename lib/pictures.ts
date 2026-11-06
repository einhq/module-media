/**
 * A file's picture vectors (EMS `vision.embed`): which embedding type (pgvector table) a model's
 * vectors go in, where a file keeps them, the marker that says which model made them, and a query's
 * words in their space.
 *
 * A type is named per model, never per role: a vector table's dimension is fixed when it is
 * created, and two models' vectors are not comparable even at the same dimension, so a new model
 * is a new type and its vectors are searched only against each other. The name is short and
 * written down rather than derived from the model name, because PostgreSQL cuts identifiers at 63
 * characters and the registry builds `<prefix>_embeddings_<type>_data_hnsw_idx` from it.
 */

import type { Command } from '@ein/client';
import { embedPictureQuery } from '@ems/text-embedding';

/** Picture vectors by the producer EMS reports. */
const PICTURE_TYPES: Record<string, string> = {
  // SigLIP2 So400m/16-384, Immich's ONNX export; 1152 dimensions, stored as halfvec.
  'ViT-SO400M-16-SigLIP2-384__webli': 'picture_siglip2',
};

/**
 * The embedding type for a picture embedder, or undefined for one nothing here knows — a new
 * model has to be given a type on purpose, not land in a table named after a truncated string.
 */
export const pictureEmbeddingType = (producer: string): string | undefined => PICTURE_TYPES[producer];

/**
 * The least cosine between a query's words and a picture that counts as a match. SigLIP2 cosines
 * live on a scale of their own — a clear match is 0.1-0.2 — and judged hits held 0.9+ precision
 * down to 0.08.
 */
export const PICTURE_FLOOR = 0.08;

/**
 * A file's picture vectors live under `<file>/metadata/picture/`: `embedding` for a photo, `k0`…
 * for a video's keyframes (each with `atSeconds`). The directory carries `embeddedBy`, written
 * after its vectors, so a directory without it is a half-written state and is redone.
 */
export const PICTURE_DIR = 'picture';

/**
 * File attr: the model the file's picture vectors were made by, written last of all, once they
 * are stored. `pictures-scan` asks for the files whose marker is missing or names another model
 * than EMS runs now.
 */
export const PICTURE_VECTORS_BY_ATTR = 'pictureVectorsBy';

/** The node name for a photo's vector (`index` undefined) or a video keyframe's. */
export const pictureNodeName = (index?: number): string => index === undefined ? 'embedding' : `k${index}`;

/**
 * The file a picture vector belongs to, from the vector node's path, or undefined for any other
 * path. What search maps a hit back through.
 */
export const fileOfPictureVector = (vectorPath: string): string | undefined => {
  const match = /^(.*)\/metadata\/picture\/(?:embedding|k\d+)$/.exec(vectorPath);
  return match?.[1];
};

/**
 * Words in the pictures' space: through the picture embedder's text tower, the embed shared with
 * every other search asking the same words (`@ems/text-embedding`), with the embedding type its
 * vector is compared within. Throws for an embedder no type is given to.
 */
export const pictureQuery = async (cmd: Command, words: string): Promise<{ type: string; bytes: Uint8Array }> => {
  const { bytes, producer } = await embedPictureQuery(cmd, words);
  const type = pictureEmbeddingType(producer);
  if (!type) throw new Error(`no embedding type for picture embedder "${producer}"`);
  return { type, bytes };
};
