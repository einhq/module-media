# Reading a file

What the media module learns of a picture, a video or a recording before anything is made of it,
and the facts of a media file itself that the pipelines start on.

**The bridge.** `media-bridge` binds the file writes and removals and the `exif` node's writes, and
publishes on `/dev/events` what they reveal (`@media/file-rules`): `media.file.discovered` for a
media file with bytes and no `metadata/exif`, `media.file.content-changed` for one whose bytes are
no longer those its metadata was read from (`sourceSha256`), `media.file.turned` for a video turned
by hand once read, `media.file.removed` off the attrs a deleted file carried,
`media.metadata.extracted` for a filled `exif` node, and `media.renditions.made` for the write of
the renditions marker. Not media: a rendition (it carries `sourceId`), a file with no bytes, and
anything under `/tmp`, `/etc`, `/var`, `/usr`, `/dev` or in a trash — a picture put in `/tmp` to
search with would otherwise answer every search, and a trashed file waits to be restored or purged.
Rules read the node fresh, so the order the bridge's consumers take messages in does not matter
(`@media/bridge`, which another module's bridge runs its own rules on). Each fact names the write it
came from, and one about a file in a folder of the bulk lane — the nearest folder with `lane: bulk`,
such as the archive's import categories — is in the bulk lane, behind what people do.

**Reading.** `media-ingest` runs `exif-extract` for a discovered file, `media-reindex` again for one
whose bytes changed (`-f`). One `media.probe` call to EMS (`@media/exif-service`) runs exiftool there
— a stay-open pool, numeric ungrouped JSON — and ffprobe for every video and recording, and hands
both dumps back under `raw`. `exif-extract` keeps the exiftool dump under `metadata/exif` with what
it says of the file: the device (`deviceinfo`, `deviceSerialNumber`), the picture (`fileinfo`), its
GPS fix (`where`) and its clock readings (`when`, `@media/exif-date`: only a tag that can be a
capture time, and never a zero-clock sentinel). Onto the file it promotes what every reader needs:
the mimetype (exiftool's, a RAW name deciding over a plain TIFF), dimensions, the pixel shape
(`sar`), the angle (from the EXIF tag, a HEIF's `irot` or a video's display matrix, unless a person
set it, `angleManual`), duration, codec (`@media/video-codec`), and `undecodable` when ffprobe
cannot read the container — every fact written even when absent, as null, so reading new bytes
leaves nothing of the old ones. The file's attrs are written before the `exif` node, since the
fact the work starts on is the filled node, and the work must find them. A file whose bytes never
went through the VFS is hashed first. What the metadata means — when the picture was taken, where,
by whose camera — is other modules' to read off the dump; the archive's `exif-interpret` does.

**The hold.** Before it reads a file `exif-extract` runs each module's hold command,
`/etc/media-read.d/<module>/hold` (a drop-in `mod setup` links from the module's
`etc/media-read.d/hold`): its first line that is not a comment, run as `<command> [-f] <file>`. A
command may set `hold` on the file (`FileHold`: who, why, the `sha256` and the folder it is for),
and a held file is left unread, its answer `{ held, by }`, and announced by no discovery for as long
as it has those bytes in that folder; new bytes, or a move out of the folder, end the hold without
anyone taking it off. `-f` reads a held file anyway, and tells the commands so. The archive's
command is staging's exact-copy check (`staging-hold`), and the crawl's progress leaves held files
out (`entryPoint.exempt: hold`).
