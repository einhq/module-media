# Renditions

What the media module makes of a picture, a video, a recording or a document so a page can show and
play it, and how it keeps them current. The pipelines `media-stills` and `media-transcode` start on
`media.metadata.extracted`, which the archive's bridge announces until this module reads files
itself, and on `media.renditions.stale`, which `renditions-scan` announces; `media-stills` also on a
document written or moved, whose metadata is never read.

`generate-derivatives` reads the rendition table, `/etc/renditions.yaml`
(`readRenditionTable` in `@ein/client`; the media module ships it in its `etc/`, which
`mod setup` copies once and never overwrites), and writes each role's rendition as a **child file node**
under a `thumbnails/` directory of the media node, named after the role's box. Images are
**AVIF** (`thumb`, a `320x320` cover crop, and the `contain` roles `grid`, `small`, `medium`
and `large`: `512x512`/`800x800`/`1600x1600`/`2560x2560`), video is **AV1** in MP4 (`playback`,
`1920x1080.mp4` with AAC, and the silent `preview` clip, `480x480.mp4`) with the image roles up
to `medium` as poster frames — the frame a
second in, unless it is blank (black, white or a tape's blue screen): then EMS's `skip_blank`
takes the first of the frames at a tenth, a quarter and half of the picture that is not,
`posterAt` on the file says which second, and the hover clip starts there too — audio is AAC
in MP4 (`playback`, `128k-44100.m4a`) plus a rendered waveform in the image sizes. Which roles a
media type gets is the table's (`kinds` on each image role). The `<width>x<height>` name is the target **box**: a `contain`
rendition is usually shorter, and never upscaled past the source (`fit: contain` in EMS's
`image.renditions`, `min(iw,W)` in `video.transcode`). Only the `cover` thumb enlarges, because
it owes its consumers an exact square. A source smaller than a box lands at its own size in
the first box it fits, and the boxes above it are **not made** — they would be byte-for-byte
copies. The rule is `imageRolesOf` in `@ein/api`, and the shell's pages ask by it too (from the
node's `width`/`height`/`angle`/`sar`), so they never ask for a size a small file lacks, and
their `w` descriptors say the rendition's real width rather than the box's. A file without stored dimensions gets, and is
asked for, the whole ladder; `regenerate --prune` removes the copies made before this rule.
Only two consumers use the `cover` crop now — the 48px map marker and the album cover
card — so `512x512` (`grid`) exists as the _contain_ rendition the justified media grid draws
a tile from, and video gets it too so a video poster is the clip's own shape rather than a
square. `--only still|transcode|preview|storyboard` splits by the cost of the work, not by
media type: `media-stills` runs `still`, every AVIF picture of every type (photo sizes and face
crops, poster frames, waveforms), then `preview`, a video's hover clip (below);
`media-transcode` runs `transcode`, the full ffmpeg renditions of video and audio, so a failed
encode never takes the poster frame with it, and then `storyboard` (below); `--size a,b`
narrows a run to named roles, which is what makes adding a size a ~1-hour backfill rather than a
re-encode of the whole ladder; `--prune` deletes renditions that are no longer targets, which
is how a format change cleans up after itself. Every still-image size of one file is one
EMS call from `@media/image-ladder` — `image.renditions` for a photo, `video.poster` for a
clip, `audio.waveform` for a recording — so the source is decoded once and every output is
an independent clone of it; no smaller rendition is ever cascaded from a larger one, and a
video's poster frame is extracted and square-pixelled once. Every image output is first
written to a hidden temporary VFS sibling whose physical path EMS is handed, and all staged
outputs must be non-empty and reconciled before any final path is replaced, so an
interrupted or partially successful ladder leaves the old renditions servable. A temp an
interrupted step leaves behind is removed by the next ladder or transcode into the same
directory once it is a day old (`@media/staged-output`). Both
audio/video transcode settings are unchanged. All derivatives carry `sourceId`, which is
how the bridge knows not to index them. Originals are never modified (rotation applied
from the `angle` attr at derivative time, by EMS, in the display frame).

**Audio carries both a sound rendition and a picture.** EMS's `audio.waveform` draws the
envelope with ffmpeg's `showwavespic` in the UI's own accent-on-media-bg palette
(`WAVEFORM_STYLE` in `@media/image-ladder` states the colours and the banner aspect), so audio
gets the same `thumb/grid/small/medium` AVIF renditions a photo does and the tile, the srcset and
the cover card need no special case. The picture is drawn at each target's aspect rather than
resized into one — `cover` draws square, `contain` a 3:1 banner — because centre-cropping a
waveform leaves a slice that reads as a blob, and every size comes from one decode of the
track (`aresample=8000` ahead of the drawing still leaves thousands of samples per column).

**Video carries two mp4s, and they are not a ladder.** `1920x1080.mp4` is what the lightbox
plays; `480x480.mp4` is a silent 20-second clip a grid tile plays under the pointer, and on a
touch screen when it scrolls into view. Both are one `video.transcode` call each — the hover
clip with `clip: {start, duration}` (an input-side seek, so the decode starts at a keyframe
near the offset instead of at zero) and `audio: null`, neither of which touches the filter
graph, so EMS's CPU and CUDA chains stay in lockstep. The clip starts exactly where the poster
frame was taken, at 00:00:01 or at `posterAt`, so swapping the still for the clip shows the
same frame twice rather than a jump cut. That second is known only once the poster frame is
made, so the clip is a class of its own, `preview`: a step of `media-stills` after `still`, on
the `transcode` kind beside the full rendition, since a 20-second re-encode costs like one.
`media-transcode` makes it again only when forced, as when a video is turned. A source
under 2s gets no clip at all — the poster already is the whole video — which is read off the
file node's promoted `duration`. The sound rendition's `bitrate`/`sampleRate` in the table
are **ceilings**, not targets — `audio.transcode` caps them at the source's own and stays
mono for a mono source, after a flat 128k stereo turned a 14.8 MB 64 kbps mono tape rip into
a 30 MB rendition carrying strictly less information.

The transcodes (`@media/transcode`) and the image ladder
**create the output node before EMS writes** — `sourceId` has to be set at creation so
the bytes route to the volatile tier — and so they must delete that node again when the encode
fails, or the failure is indistinguishable from success to anything downstream. For the same
reason `generate-derivatives` treats a **0-byte rendition as absent** rather than as done:
presence alone made one failed encode permanent, since every later run skipped the empty
placeholder.

Two constraints are worth knowing before touching this. **A rendition must carry no
orientation tag** — ImageMagick's `-strip` does not clear its own orientation property, only
the EXIF block, and the AVIF encoder writes the property as a HEIF `irot` transform which every
decoder then applies, undoing the rotation: the identical chain measured 800x1600 as PNG and
1600x800 as AVIF, so every rendition of an EXIF-rotated photo was served in the original
orientation. EMS clears it (`-orient Undefined` beside `-strip`, `ems/tools/magick.py`) and the
contract promises it (§4.2). And an AVIF's `ftyp` header is indistinguishable from an MP4's
to the content sniffer, so `src/lib/media/mime.ts` classifies it by major brand — otherwise
every thumbnail is stored, and served, as `video/mp4`. The audio rendition uses ffmpeg's
**ipod** muxer for the same reason: it writes the `M4A` brand that marks the file as audio.

**A video also carries a storyboard**, `storyboard-<tile>.avif`: its frames at an even interval
tiled into one sheet, for the frame the lightbox player's timeline shows under the pointer,
and for the picture of a voice heard in the video (`person-voices`, `person-unknown`). EMS's `video.storyboard` makes it from the `1920x1080.mp4` rendition rather than the source —
the rendition is upright and is the timeline the player plays — so it is its own class,
`storyboard`, run by `media-transcode` after the transcode and forced with it when a video is
turned; not `still`, which a turn re-makes inline. The interval grows with the length rather
than the sheet (the table's `storyboard`: at most 240 tiles of 160 px), so any video is one sheet, and how
to cut it into tiles is on the sheet's node (`storyboard` attr: interval, count, columns,
rows, tile size; `@media/storyboard`). A video under 4 s gets none, and an EMS from
before the op is skipped rather than failed. `--prune` keeps it by name; writing a sheet
removes any other. The marker waits for it, so a video without one is a gap
`renditions-scan` announces, and `media-transcode` makes the sheet.

**A document's pictures are its first page.** A PDF, a plain-text file, and a Word (`.docx`,
`.doc`), OpenDocument or RTF file (`RENDERED_DOCUMENT_MIMETYPES` in `@ein/api`) gets the image roles
of kind `document` from one EMS `document.renditions` call: PDFium renders the first page, after
LibreOffice has converted anything that is not a PDF, at the scale the largest box needs. A page is
vector, so every role of the kind is made whatever its size (`pictureOf` is undefined, as for a
waveform). The same call writes `view.pdf` (`DOCUMENT_VIEW_FILE`) for a Word, OpenDocument or RTF
file (`CONVERTED_DOCUMENT_MIMETYPES`), which the viewer shows in the browser's own PDF reader: it is a
`still` like the pictures, made with them, or alone when it is the one missing, and owed by the
marker. A PDF is shown as it is and plain text as text, so neither gets one. The first page's size in
points becomes the file's `width` and `height`, the shape the grid lays its tile out at. A document
EMS cannot open is marked `undecodable` like a media file `exif-extract` cannot read, which the heal
passes over and a forced run clears once it reads. `media-stills` starts on the document being
written or moved, in the paths `document-index` reads (not `metadata/`, a dot folder or EiN's own
trees), and passes over one already marked; `renditions-scan` asks for each document mimetype by
itself, in the same paths.

**The marker says a file's renditions are complete, and under which table.** Once a file has
every rendition the table owes it — each role of its kind, less the sizes a small picture
does without, the clip a video under 2 s and the storyboard one under 4 s are never owed —
`generate-derivatives` writes `renditionsFor`, the first 16 hex digits of the SHA-256 of the
table's entries for the file's kind (`@media/rendition-marker`), and `renditionsAt`. A picture
role's `kinds` count in a photo's, a video's or a recording's signature without `document`, so
documents taking a role reopens only documents.
A rendition EMS refused under its CPU budget (`transcodeRefused`), a storyboard EMS cannot read
the rendition for or has no route for, and the storyboard of a refused playback count as
accounted for. Stills and transcodes are separate pipelines, so whichever run completes the
set writes it; a run with a failure marks nothing, and a run that finds everything in place
writes nothing, so the write is news. The bridge announces it as `media.renditions.made`, on
which the archive's `media-camera-cover` offers a video's poster frame to its camera. The gap is the other
side of the same attr: `renditions-scan` asks, per kind, for the files of that mimetype whose
`renditionsFor` is not the signature in force — an attr query over every tree, not a walk of
the albums or a listing of `thumbnails/` — passes over a rendition, an undecodable file, an
empty or unread one, a trash and a folder that wants no renditions, and announces
`media.renditions.stale`, which only `media-stills` and `media-transcode` take; a refusal
recorded under another budget than EMS runs now reopens its file too. The `renditions-heal`
service runs it every hour. A changed table changes the
signature of the kinds it touched and no other, so editing `/etc/renditions.yaml` reopens
those files within the hour; the files no role names any more stay until `regenerate --prune`.

**A video's chapters (`metadata/chapters`).** `detect-chapters`, a step of `media-transcode` after
the transcode, asks EMS where the `playback` rendition cuts from one shot to the next (`video.shots`:
TransNetV2 over every frame at 48×27, and its rules — a peak over 0.6, leader as a gap, a lasting
change of colour, cuts under a second apart merged, no shot under three seconds — measured on the
archive's own film transfers and phone clips, wow `notes/lessons-media.md`). A video whose EXIF
names its camera is one take with no leader: a cut there must score 0.85, and a blank stretch in it
is a dark scene, not leader. The rendition, not the original: its clock is the player's and it is
upright. The node is a db-tier `file` holding one
WebVTT cue per chapter, with the cuts on it (`boundaries`: `{t, score, kind}`, `kind: leader` at the
end of black or white leader), `detectedBy`, `detectedWith` (the rules) and `detectedAt`, which marks
it done. A cut's `t` is the new shot's first frame. A video with no cut gets the node with no
boundaries, so it is not looked at again; one EMS cannot decode, or will not within its CPU budget,
gets it with `unreadable` and no `detectedAt`, and any other failure fails the step. `media-details` reads the cuts off the
node as `chapters`, the lightbox player's segments and skip buttons. Not forced when a video is
turned, which moves no cut in time; no gap term: chapters are no rendition, and the marker does not
wait for them.

**Orientation, and the frame coordinates live in.** A file node's `angle` (0/90/180/270) plus
`mirror` define the **display frame**: the raster rotated counter-clockwise by `angle`, then
flopped. `exif-extract` derives `angle` from the EXIF Orientation tag — through
`angleFromExifOrientation`, and from a HEIF's `irot` through `angleFromHeifRotation`, the same
reading EMS subtracts back out for the turn libheif already made, so the tag has one reading
and not two — but a manual override
(`angleManual`, which the legacy import sets) always wins and after that step the tag is never
read again: every renderer and every model call rotates by the node's angle instead
([@media/orientation](../lib/orientation.ts)). A **video**'s angle comes from the
container display matrix rather than a tag, through `angleFromVideoRotation` — the one mapping
`exif-extract`, `promote-exif-attrs --angle` and the legacy importer all read it with, and one
that must only ever be applied to a `video/` mimetype because the ungrouped `Rotation` key means
something else on a still and on a HEIF. That single authority is the point:
OpenCV's `imread` silently applies the EXIF tag, so before this the detector worked in one frame
while the cropper worked in another, and every face cutout on a rotated image (~20% of the
corpus) came from the wrong part of the picture.

**The pixel shape, `sar`.** A quarter turn is not the only difference between a stored raster and
the picture it stands for: a video stream can declare a **sample aspect ratio**, and then the
picture is the raster times that ratio (AVCHD records 1080 lines in 1440 coded columns at SAR 4:3
and _is_ 1920x1080). What `width`/`height` hold depends on the container — exiftool reads a
QuickTime track header, which already has the ratio applied, and an `.MTS`'s H.264 sequence
header, which has no ratio in it at all — so the node stores `sar` **relative to its own raster**
(`sarForRaster`): 1 for everything whose stored numbers are already the shape, and 4/3 for the
`.MTS` album. `exif-extract` reads it off the dump where it can (`sarFromExifRaw`) and pays for
one ffprobe where it cannot, which is the only container family that needs it. `pictureDims`
applies it, `displayDims` deliberately does not — the crop paths measure real pixels of the
original — and the UI's `displayAspect` mirrors the first so a grid tile is laid out at the shape
it will paint at instead of reflowing when the picture decodes. Every path that writes a _still_
from a video frame bakes the ratio into the pixels instead, because an image file has nowhere to
put it.

`regenerate <path>` re-runs `generate-derivatives` over existing media; `--force --prune` after a
format or size change rebuilds the set and drops the renditions it replaced. `--size a,b` narrows
it to named roles and `--mime 'video/*'` to one media type, so adding a size that only one type has
does not cost a `generate-derivatives` exec per photo in the corpus.
