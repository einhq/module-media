# Text and transcripts

What is read from a picture or a document, what is said in a video or a recording, and the vectors
search finds a file's texts by. A transcript's voices — who speaks when — are the archive's, under
`<file>/metadata/transcript/speakers/`, which a new transcript leaves alone.

## Reading text

`document-index` runs `index-document` on a file's VFS `updated` and on its
`moved`, one trigger body shared by both: PDF, plain text, Word and OpenDocument text. JSON and
XMP sidecars are not documents. Pictures are `media-ocr`'s: `read-text` on the media
pool (kind `ocr`), after `media.metadata.extracted` so the picture is read in its display frame,
and on a `moved`. It asks EMS `ocr.read` (PP-OCRv6) for the original's lines and keeps them
beside the text, `lines` on `<file>/metadata/content` (each line's words, four corners as
fractions of the picture, and score), and stamps the file `ocrBy`. The archive's `media-scan` announces
`media.ocr.stale` for a read picture whose `ocrBy` names another engine than EMS names in
`capabilities.models.ocr`, or none, and `media-ocr` reads it again with `-f`; a reading without
text removes the old one. A picture never read has no `textIndexedAt` and is
`media.text.missing`'s. Plan: wow `history/ocr-tiers.md`.
EMS tells the language of the text from its reading, and the language picks the transcriber
that writes the picture's handwriting (Swedish and Finnish, or English); `read-text` keeps it
as `ocrLanguage` and `ocrLanguageConfidence` on `<file>/metadata/content`, none when there is
too little text to tell. `file-set-text-language <file> <code|auto>` sets it by hand as
`ocrLanguageManual` on the file, which `read-text` gives EMS instead; the bridge reads that
write on a read picture as `media.text.language-set`, and `media-ocr` reads it again with `-f`.
Plan: wow `history/ocr-language.md`.
`file-set-text <file> --text-base64 <b64>` (the lightbox's text editor) writes the text by
hand: it replaces `<file>/metadata/content` without `lines`, embeds it, and marks the file
`textManual` with no `ocrBy`, so `media.ocr.stale` passes it by and `read-text` refuses it
even with `-f`.
Nothing under `/home/<user>/staging/` is read while it is staged: the triggers' `unless`
skips it before any shell runs, so an import costs no OCR and no filter evaluation per write.
The same `unless` leaves out EiN's own paths (`/var`, `/etc`, `/usr`, `/dev`, `/tmp`),
dotfiles, a trash among them, and the pipeline's own `metadata/content`.
A file is read when it leaves staging, by the `moved` trigger; staging's own filing (promote,
`album add`) moves the files themselves, a `moved` event each. A directory moved out whole
publishes `moved` for the directory alone: the archive's bridge binds `directory.moved` and announces
`media.text.missing` for each file within it that has no `textIndexedAt` (one subtree query,
`deriveTextGap` per file). A write while the engine was down reaches no trigger: for that
the archive's `media-scan` announces the same fact (the filter's mimetypes and every picture as
`isTextIndexedMimetype`). The fact is a trigger of both pipelines, each for its mimetypes, with
the same `unless`, so a directory moved within staging reads nothing. `textIndexedAt` is written whether text was found or not, so a file is read once.

The gaps — a file whose text was never read, a picture read by an older engine — are announced by
the archive's walk over its albums (`media-scan`) for now, under these facts' names (`TEXT_FACTS`,
`@media/facts`).

## The text space

Every text
is embedded by EMS's current text embedder (`text.embed` `model: current`, bge-m3)
into a type per model, at a node named after the type beside the text:
`metadata/content/text_bgem3` and `metadata/transcript/text_bgem3/t<second>` (a directory stamped
`embeddedBy` last). An extracted text longer than 6 000 characters is embedded in
parts of about 400 tokens instead: `metadata/content/text_bgem3/c<N>`, a directory like the
transcript's, each part cut at paragraphs and sentences and carrying its character `offset`
(`contentParts`); `search-media` and `search-document` score the file by its best part. The
**hand-written** `description` attr is embedded as `metadata/authored/text_bgem3` (no text node;
the attr stays the one copy of the text) with an `authoredHash` of the text it was made from;
`file-set-description` writes it on save and removes it on clear, and `search-media` ranks it as a
channel of its own at the picture channel's weight, counting only hits from the space's `strict`
level (0.66 for bge-m3), where judged pairs hold 0.9 precision.

A vector carries nothing but `embeddedBy` and `embeddedAt`, and a transcript chunk's its start and
end seconds and its `text`, the words it was made from, which search matches a phrase against. So a
transcript whose chunks are not embedded yet is found by neither, until `media-reembed` embeds them.
What a text is and where it came from
is on its **text node**: a transcript's `transcribedBy`, `transcribedWith` and `transcribedAt`,
the last written once the cues are, are both the "already transcribed" marker (the transcribe
pipeline's guard, `transcribe-file`'s own skip, the staleness rule) and what announces a transcript
(`media.transcript.generated` fires when `transcribedAt` is written). So a new embedding model is a
re-embed and never a re-transcription: `media-reembed` walks the text nodes and embeds what is
missing or another model's, from the stored text alone. `media-scan` announces
`media.text-embedding.stale` for a media file whose extracted text, transcript
(also when cut at another `chunkSeconds`) or hand-written description has no vector from the
embedder EMS runs now (`generations()` in `@ems/client`), naming which in `data.stale`; `media-embed-text`
runs `media-reembed <file>`, the same rules for that one file. A text with nothing to embed (an
empty text node, a transcript with `speech: false`) is never announced. Search has a
floor of 0.35 on this space, measured on the retrieval eval's judgements.
`@ems/text-embedding` (module-ems's `lib/text-embedding.ts`) holds the types, the layout and the
query side.

The transcript is WebVTT rather than a JSON of segments because that is the format `<video>` already
understands: `get-file` serves the node with the mimetype it carries, so the lightbox's video
player and the sidebar's transcript panel both read `/file/<path>/metadata/transcript` with no
route, no converter and no second copy (one request between them, `useTranscriptCues`). The player
draws the subtitles itself; its `<track>` is shown only in an iPhone's fullscreen, which is the
system's player. Its `text_bgem3/t<second>` children are embedding nodes, one
per minute of speech (`CHUNK_TARGET_SECONDS`; it was 30 s, sized to MiniLM's 128-token window), so
a hit says where in the recording it matched. A set carries the length it was cut at
(`chunkSeconds`), and `media-reembed` re-chunks a set cut at another. Each chunk node is **named for
its start second**, which is what lets a vector hit carry its own seek target:
the archive's `search-media` resolves a hit to a path and nothing else, so
reading an attr per hit would put a node read back on the search path. The timecode travels out as
`atSeconds` on the search hit, and the lightbox opens the player there. Composition rules
(WebVTT in and out, chunking, chunk-path resolution) are pure and tested in
[lib/transcript.ts](../lib/transcript.ts).

The gaps of transcripts and text vectors are announced by the archive's walk for now, as above.
