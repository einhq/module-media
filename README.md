# module-media

Renditions of pictures, videos and recordings, and what describes a file, for any module.

An [EiN](https://github.com/einhq) module. It is developed and tested inside a checkout of EiN core,
as `modules/media`, and a deployment chooses whether to run it. `mod.json` is its manifest: the core it
needs (`coreApi`), the modules it depends on, and what it exports.

## What it holds

The reading of every media file in a folder that wants processing: `exif-extract` keeps what its
metadata says under `metadata/exif` and the facts every reader needs on the file, after asking each
module's hold command (`/etc/media-read.d/<module>/hold`) whether to leave it unread, and the
`media-bridge` service announces the facts of a media file itself — discovered, its bytes changed,
turned, removed, read, its renditions made — which pipelines start on (`@media/file-rules`, and the
bridge runner `@media/bridge`). [architecture/reading.md](architecture/reading.md) says how.

The renditions of every picture, video and recording in a folder that wants them (`processing`):
the roles `/etc/renditions.yaml` names, which the module installs once and never overwrites,
made by `generate-derivatives` in the pipelines `media-stills` and `media-transcode`, with a
video's storyboard and chapters (`detect-chapters`). A file that has all of them is marked with
the table they were made by, and the `renditions-heal` service runs `renditions-scan` every hour,
which announces the files whose mark is missing or names another table. `regenerate` makes them
again under a folder. [architecture/renditions.md](architecture/renditions.md) says how.

The picture vectors of every photo and video in a folder that wants them (`picture-vectors`), for
search by what a picture shows: `embed-picture` in the pipeline `media-embed-picture`, a vector per
photo and per keyframe of a video under `metadata/picture`, the file marked with the model that
made them (`pictureVectorsBy`), and the `pictures-heal` service, which runs `pictures-scan` every
hour to announce the files whose mark is missing or names another model than EMS runs now. Search
reads them through `@media/pictures` (the embedding types, where a file keeps them, a query's words
in their space) and `@media/picture-source` (what EMS reads a picture from).
[architecture/pictures.md](architecture/pictures.md) says how.

The text of every file in a folder that wants it (`text`, `transcripts`): a picture's read by
`read-text` in `media-ocr`, a document's by `index-document` in `document-index`, a video's or a
recording's transcript by `transcribe-file` in `media-transcribe` (WebVTT, `@media/transcript`),
and their vectors, which `media-reembed` makes again in `media-embed-text`; `file-set-text`,
`file-set-text-language` and `file-set-transcript` write them by hand. The bridge announces a
transcript written, a text language or a description set by hand, and the unread files of a
directory moved whole (`TEXT_FACTS`, `@media/facts`). A file is marked with what its transcript and
its text vectors were made with (`transcriptWith`, `textVectorsBy`, `@media/text-markers`), and
the `text-heal` service runs `text-scan` every hour to announce the files whose text was never
read, whose reading, transcript or vectors are not what EMS makes now; `CFG_MEDIA_TRANSCRIPTS_CURRENT`
set to `off` leaves the transcripts there are alone. [architecture/text.md](architecture/text.md)
says how.

The libraries other modules build on: `@media/probe` (what EMS says of a file), `@media/orientation`
(the display frame and the pixel shape), `@media/storyboard`, `@media/chapters`, `@media/vtt`,
`@media/writable`, the marker (`@media/rendition-marker`), the facts (`@media/facts`), whether
work waits for a fact (`@media/waiting`), and the commands' answers (`@media/api`).

The workers of the media pool, `/var/pools/media`, where the modules' pipelines put the media work a
crawl must not start all at once: `media-worker`, on one budget of CPU slots (`CFG_CPU_SLOTS`,
`CFG_CPU_WORKERS`, `CFG_CPU_NON_ENTRY_SLOTS`), and `models` and `models-second`, which keep the
model-bound steps in flight against the media service (`CFG_MODEL_SLOTS`, `CFG_MODEL_SECOND_SLOTS`,
`CFG_MODEL_KIND_QUANTUM_MS`).

A module names the kinds of its work in drop-ins, which `mod setup` links as
`/etc/media-worker.d/<module>/kinds` and `/etc/media-models.d/<module>/kinds`: a kind a line, in the
order offered, `reserve` after a CPU kind to put it in the share kept for the work after ingest, `#`
for a comment. `media-pool-kinds cpu|models` reads them as the workers start; a worker with no kind
to take waits for one, and `mod install` restarts the workers once it has put in place a module
whose kinds are new or changed, as `dropIns` in `mod.json` asks. The answer's type is `PoolKinds` in
`@media/api`.
