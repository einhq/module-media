/**
 * Fingerprints for finding copies: where a file keeps them, when its fingerprinting is done, and
 * how they are asked of EMS.
 *
 * Under `<file>/metadata/`: `sscd-image` for a picture, `sscd-video-keyframe-<n>` for each of a
 * video's keyframes (embedding nodes holding SSCD descriptors), and `chromaprint` for a recording
 * (a db-tier file of its values, `@media/chromaprint`). `compute-fingerprint` writes
 * `fingerprintedAt` on the file last, once every print is written; `fingerprints-scan` announces
 * the files without it.
 *
 * A picture is described from what its picture vector is embedded from (`pictureSource`): the
 * display-frame rendition when it has one, else the file turned as the node says. Either way the
 * descriptor is of the picture as it is shown, so a copy saved rotated still matches.
 */

import type { Command, NodeAttrs } from '@ein/client';
import { fingerprint, type FingerprintResult } from '@ems/client';
import { pictureSource } from '@media/picture-source';

export type { FingerprintResult };

/** The fingerprint type a file of each kind gets, which is also its embedding type. */
export const FINGERPRINT_TYPES = { image: 'sscd-image', video: 'sscd-video', audio: 'chromaprint' } as const;

/** File-node attr: when `compute-fingerprint` last finished with the file, written after its prints. */
export const FINGERPRINTED_AT_ATTR = 'fingerprintedAt';

/** Whether `name` under a file's `metadata/` is one of its fingerprints. */
export const isFingerprintName = (name: string): boolean => name === FINGERPRINT_TYPES.audio || name.startsWith('sscd-');

/**
 * Whether a file needs no more fingerprinting. A picture or a video always gets a print; a
 * recording too short for a chromaprint gets none and never will, which `fingerprintedAt` records.
 */
export const fingerprintDone = (mimetype: string, fingerprintedAt: unknown, metadataNames: readonly string[]): boolean =>
  metadataNames.some(isFingerprintName) || (typeof fingerprintedAt === 'string' && !/^(image|video)\//.test(mimetype));

/**
 * The fingerprints of the file at `path` from EMS: an SSCD descriptor for a picture and for each of
 * a video's keyframes, a chromaprint for sound. An audio too short to fingerprint comes back as no
 * entries rather than an error; a file EMS cannot decode is an `EmsError` with `permanent: true`,
 * which the pipeline should not retry.
 */
export async function computeFingerprints(cmd: Command, path: string, attrs: NodeAttrs): Promise<FingerprintResult> {
  const source = await pictureSource(cmd, path, attrs);
  return await fingerprint(cmd, source.path, source.opts);
}
