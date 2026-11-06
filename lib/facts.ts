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

/** The fact of a file's picture vectors, which `pictures-scan` announces and `media-embed-picture` takes. */
export const PICTURE_FACTS = {
  /**
   * A file's picture vectors are missing or were made by another model than EMS embeds with now:
   * its marker (`pictureVectorsBy`, `@media/pictures`) is missing or names another.
   */
  stale: 'media.picture.stale',
} as const;

/** The fact of a file's fingerprints, which `fingerprints-scan` announces and `media-fingerprint` takes. */
export const FINGERPRINT_FACTS = {
  /** A picture, video or recording was never fingerprinted to the end: no `fingerprintedAt` (`@media/fingerprints`). */
  stale: 'media.fingerprints.stale',
} as const;

/**
 * The facts of a file's text: what is read from a picture or a document, a recording's transcript,
 * and their vectors. The media bridge derives the first two from the writes that reveal them
 * (`@media/file-rules`); the others are gaps, which a scan over a tree announces.
 */
export const TEXT_FACTS = {
  /**
   * A person set or cleared the language of a read picture's text (`ocrLanguageManual`,
   * `file-set-text-language`). The picture is read again in it: the language picks the transcriber
   * for its handwriting.
   */
  languageSet: 'media.text.language-set',
  /**
   * A video's or a recording's transcript is written: `<file>/metadata/transcript` gained its
   * `transcribedAt`. Subject is the file; `data.speech` says whether anything was said.
   */
  transcriptGenerated: 'media.transcript.generated',
  /**
   * A transcript exists but was decoded with other whisper settings than EMS runs now, or an
   * interrupted run left it without `transcribedAt`. Its own fact because the transcribe
   * pipeline's ordinary trigger skips every file that has the node — exactly the set this fact is
   * about.
   */
  transcriptStale: 'media.transcript.stale',
  /**
   * A picture's text was read by another engine than EMS reads with now, or by none named
   * (`ocrBy`). Its own fact because `media-ocr`'s ordinary triggers skip every picture already
   * read.
   */
  ocrStale: 'media.ocr.stale',
  /**
   * A file's texts lack a vector from the text embedder EMS runs now: extracted text, a
   * transcript or a hand-written description with no vector, or one from another model (a
   * transcript also when its chunks were cut at another length). `data.stale` names which. The
   * repair embeds the stored text again and never re-runs what wrote it.
   */
  textEmbeddingStale: 'media.text-embedding.stale',
  /**
   * A document or picture whose text is read (`isTextIndexedMimetype`) has never had it read: no
   * `textIndexedAt`. Announced for each such file in a directory that was moved, since the move
   * publishes an event for the directory only, and for a file whose write or move came while
   * nothing was listening. `document-index` and `media-ocr` exclude the same paths for it as for
   * the write.
   */
  textMissing: 'media.text.missing',
} as const;
