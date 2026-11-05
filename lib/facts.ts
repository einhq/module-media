/**
 * The facts of a file's renditions. `generate-derivatives` writes the marker the first is
 * announced from, and `renditions-scan` announces the second, which only the rendition pipelines
 * take.
 */
export const RENDITION_FACTS = {
  /**
   * A file's renditions are all there under the rendition table in force: `generate-derivatives`
   * wrote `renditionsAt` (`@media/rendition-marker`). Only on the write that changed it.
   */
  made: 'media.renditions.made',
  /**
   * A file's renditions are missing or were made by another rendition table, or a rendition was
   * refused under a CPU budget EMS no longer runs.
   */
  stale: 'media.renditions.stale',
} as const;
