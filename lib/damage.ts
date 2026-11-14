import type { DamageKind, DamageScores } from '@media/api';

/** The pictures EMS's restoration ops and `image.damage` read (OpenCV): not RAW, HEIF or AVIF. */
export const RESTORABLE = new Set(['image/jpeg', 'image/png', 'image/tiff', 'image/webp', 'image/bmp']);

/** The score from which a kind of damage counts as found: a picture worth restoring for it. */
const DAMAGE_LEVEL = 0.5;

/** Each kind of damage a file's `damage` lists, by the score that finds it. */
const KINDS: [DamageKind, keyof DamageScores][] = [['faded', 'faded'], ['dust', 'dusty'], ['scratches', 'scratched'], ['blurred', 'blurred'], ['shaken', 'shaken']];

/** The kinds of damage `scores` find, in a fixed order. */
export const damageFound = (scores: DamageScores): DamageKind[] => KINDS.filter(([, score]) => scores[score] >= DAMAGE_LEVEL).map(([kind]) => kind);
