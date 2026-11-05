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
  skipped?: 'not-video' | 'undecodable' | 'detected' | 'no-rendition' | 'ems-lacks-op' | 'unreadable';
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
