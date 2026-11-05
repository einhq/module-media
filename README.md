# module-media

Renditions of pictures, videos and recordings, and what describes a file, for any module.

An [EiN](https://github.com/einhq) module. It is developed and tested inside a checkout of EiN core,
as `modules/media`, and a deployment chooses whether to run it. `mod.json` is its manifest: the core it
needs (`coreApi`), the modules it depends on, and what it exports.

## What it holds

The workers of the media pool, `/var/pools/media`, where the modules' pipelines put the media work a
crawl must not start all at once: `media-worker`, on one budget of CPU slots (`CFG_CPU_SLOTS`,
`CFG_CPU_WORKERS`, `CFG_CPU_NON_ENTRY_SLOTS`), and `models` and `models-second`, which keep the
model-bound steps in flight against the media service (`CFG_MODEL_SLOTS`, `CFG_MODEL_SECOND_SLOTS`,
`CFG_MODEL_KIND_QUANTUM_MS`).

A module names the kinds of its work in drop-ins, which `mod setup` links as
`/etc/media-worker.d/<module>/kinds` and `/etc/media-models.d/<module>/kinds`: a kind a line, in the
order offered, `reserve` after a CPU kind to put it in the share kept for the work after ingest, `#`
for a comment. `media-pool-kinds cpu|models` reads them as the workers start; a worker with no kind
to take waits for one, and after a module changes its kinds the workers are restarted to take them.
The answer's type is `PoolKinds` in `@media/api`.
