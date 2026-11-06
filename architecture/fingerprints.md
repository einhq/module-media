# Fingerprints

How a file's copies are made findable whatever its bytes: an SSCD descriptor (EMS
`fingerprint.compute`) for a picture and for each of a video's keyframes, and a chromaprint for a
recording. The module stores them and keeps them made; deciding what is a copy of what is the
reader's (the archive's duplicates and photo stacks).

**Making them.** `media-fingerprint` runs `compute-fingerprint` on `media.metadata.extracted` for a
picture, video or recording in a folder that wants `fingerprints`, a step of kind `fingerprint` on
the media worker. A picture is described from what its picture vector is read from
(`@media/picture-source`), so the descriptor is of the picture as it is shown. The descriptors are
core `embedding` nodes under `<file>/metadata/`, `sscd-image` and `sscd-video-keyframe-<n>`, typed
`sscd-image` and `sscd-video`, stamped with EMS's producer; a chromaprint is a db-tier file
`metadata/chromaprint` of its values as little-endian uint32s (`@media/chromaprint`, which also
aligns and compares two). Once every print is written the file is marked (`fingerprintedAt`), and a
recording too short for a chromaprint, which EMS answers with none, is marked all the same. A file
already fingerprinted is not asked again; `-f` asks again. `@media/fingerprints` says where a
file's prints are and when it is done.

**Keeping them made.** `fingerprints-heal` runs `fingerprints-scan` every hour: one query per kind
for the pictures, videos and recordings with no marker, passed over as the other heals pass over
(`@media/stale-scan`), each announced `media.fingerprints.stale` in the bulk lane, and nothing while
that work waits. `compute-fingerprint` marks a file whose prints are all there and fingerprints the
others.

**Reading them.** A reader waits for the marker: the write of `fingerprintedAt` is the moment a
file's prints are all there. The pictures' and videos' are found near each other by the embedding
index (`vfs.findSimilar` on `sscd-image` or `sscd-video`), a recording's by `matchChromaprints`.
