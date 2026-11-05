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
