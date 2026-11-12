/**
 * The JSON answers of the media module's commands, for its pages and other modules. Imports
 * nothing, so a reader takes the shapes alone.
 */

/** `media-pool-kinds`: the kinds of work one of the media pool's workers takes, from the modules' drop-ins. */
export type PoolKinds = {
  /** In the order offered: the modules by name, each drop-in's kinds in its order. */
  kinds: string[];
  /** Of `kinds`, those the CPU worker keeps a share of its budget for, after ingest. */
  reserve: string[];
};

/**
 * A video's storyboard: its frames at an even interval tiled row by row into one sheet,
 * `<path>/thumbnails/<name>`. Tile `i` is the frame at `i × interval` seconds; `count` can fall
 * short of a full grid. `sha256` is the sheet's, so a sheet made again under the same name is a
 * new URL.
 */
export type Storyboard = { name: string; sha256: string; interval: number; count: number; columns: number; tileWidth: number; tileHeight: number };

/** What `detect-chapters` says of one file: the cuts it found, or why it looked for none. */
export type DetectChaptersAnswer = {
  path: string;
  skipped?: 'not-video' | 'undecodable' | 'detected' | 'no-rendition' | 'unreadable';
  boundaries?: { t: number; score: number | null; kind: 'cut' | 'leader' }[];
  detectedBy?: string;
};

/**
 * `renditions-scan`: the files it found whose renditions are not those the rendition table names
 * now, and what it announced of them.
 */
export type RenditionsScanAnswer = {
  /** Files the queries returned and the scan looked at. */
  examined: number;
  /** `media.renditions.stale` facts written (or, with `-n`, that would be). */
  announced: number;
  /** True when the rendition pipelines had work waiting under `--if-idle`, and nothing was announced. */
  waiting: boolean;
  /** True when `--limit` stopped the run before the queries were done. */
  limited: boolean;
  /**
   * What could not be checked: `refusals` when EMS did not say its CPU budget, so a rendition
   * refused under another one was not tried again.
   */
  unchecked: string[];
  /** The files announced, with `-v`. */
  paths?: string[];
};

/** `pictures-scan`'s answer. */
export type PicturesScanAnswer = {
  /** Files the queries returned and the scan looked at. */
  examined: number;
  /** `media.picture.stale` facts written (or, with `-n`, that would be). */
  announced: number;
  /** True when `media-embed-picture` had work waiting under `--if-idle`, and nothing was announced. */
  waiting: boolean;
  /** True when `--limit` stopped the run before the queries were done. */
  limited: boolean;
  /** The model EMS embeds pictures with now; null when EMS embeds none, or did not answer. */
  model: string | null;
  /** The files announced, with `-v`. */
  paths?: string[];
};

/** `text-scan`'s answer. */
export type TextScanAnswer = {
  /** Files the queries returned and the scan looked at. */
  examined: number;
  /** Facts written (or, with `-n`, that would be). */
  announced: number;
  /** True when `--limit` stopped the run before the queries were done. */
  limited: boolean;
  /** How many of each fact it announced, by the facts it scanned for. */
  facts: Record<string, number>;
  /** The facts held back under `--if-idle`, as their pipelines have work waiting. */
  waiting: string[];
  /** The facts announced for no file, as EMS did not say what it runs now. */
  unchecked: string[];
  /** The files announced, by fact, with `-v`. */
  paths?: Record<string, string[]>;
};

/** `fingerprints-scan`'s answer. */
export type FingerprintsScanAnswer = {
  /** Files the queries returned and the scan looked at. */
  examined: number;
  /** `media.fingerprints.stale` facts written (or, with `-n`, that would be). */
  announced: number;
  /** True when `media-fingerprint` had work waiting under `--if-idle`, and nothing was announced. */
  waiting: boolean;
  /** True when `--limit` stopped the run before the queries were done. */
  limited: boolean;
  /** The files announced, with `-v`. */
  paths?: string[];
};

/** What `exif-extract` says of a file: what it read, or that a module holds the file unread. */
export type ExifExtractAnswer =
  | { indexedAt: string; width?: number; height?: number; sar?: number; angle?: number; undecodable?: string }
  | { held: string; by: string };

/** One step of a restoration: the EMS op that made it, what it was asked, and what answered. */
export type RestorationStep = { op: string; params: Record<string, unknown>; producer: string };

/**
 * How a restored version was made, on the version as its `restoration` attr: the steps in the order
 * they ran, and when. `marked` is the share of the picture marked as damage, by the defect finder or
 * by the mask given; an `image.inpaint` step of a mask given says so in its params (`given`).
 */
export type Restoration = { steps: RestorationStep[]; at: string; marked?: number };

/**
 * `file-restore`: the version it wrote, `<file>/versions/<name>`, with the steps that made it;
 * `mask` the full-size mask that was filled, the defect finder's or the one given, beside it and
 * `marks` the same in the picture's display frame, small enough for a page to lay over the original.
 */
export type FileRestoreAnswer = { path: string; name: string; restoration: Restoration; mask?: string; marks?: string };

/**
 * `file-crop`: the file it wrote and that file's size in pixels, and `frame` the size of the
 * picture it was cut from, as shown.
 */
export type FileCropAnswer = { path: string; width: number; height: number; frame: { width: number; height: number } };
