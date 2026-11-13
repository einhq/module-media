/**
 * The text gaps, found by their markers in every tree: `text-scan` announces a recording or a video
 * whose transcript is not marked with the decode settings EMS runs now, a read picture another
 * engine read, a picture or a document never read, and a file whose texts are not marked as
 * embedded by the text embedder EMS runs now. It passes over what is current, a transcript kept
 * whatever the settings, a text a person wrote, the paths the text pipelines do not read, and a
 * folder that wants none of the fact's families; it announces for no file a fact whose check EMS
 * cannot answer, and none at all of a transcript under `CFG_MEDIA_TRANSCRIPTS_CURRENT=off` but one
 * never marked.
 *
 * Then the steps behind two of the facts decide what they ask: `transcribe-file` keeps a transcript
 * made with the settings in force, or with none to compare, and marks the file, and transcribes one
 * made with others; `media-reembed` embeds what is missing and marks the file.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import type { TextScanAnswer } from '@media/api';
import { TEXT_FACTS } from '@media/facts';

/** Where the files under test live: any folder that wants everything. */
const LIBRARY = '/library';

const DECODE = 'whisper-large-v3:vad=0.2/800/2000,nospeech=0.8,on=cuda:float16,lang=auto,words=0';
/** The same settings on the CPU, where EMS decodes when its card's share cannot hold whisper. */
const ON_CPU = 'whisper-large-v3:vad=0.2/800/2000,nospeech=0.8,on=cpu:int8,lang=auto,words=0';
const OLD_DECODE = 'whisper-large-v3:vad=0.5/400/500,nospeech=1.0,lang=auto,words=0';
const PPOCR = 'PP-OCRv6_medium';
const BGE = 'bge-m3';
const READ_AT = '2026-11-06T08:00:00Z';

const testCtx = createTestContext({ modules: ['media'] });

Deno.test({ name: 'text-scan announces the text gaps by their markers', sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();
  const capabilities = { models: { ocr: PPOCR, text_embed: BGE }, signatures: { transcribe: DECODE, transcribe_places: [DECODE, ON_CPU] } };
  const stub = startStubEms({
    capabilities,
    ops: {
      'ocr.read': { result: {} },
      'speech.transcribe': {
        result: { text: 'a sailboat', speech: true, segments: [{ start: 0, end: 2, text: 'a sailboat' }], language: 'en', duration: 2 },
        producer: DECODE,
      },
      'text.embed': (body) => ({ result: { embeddings: (body.texts as string[]).map(() => [1, 0]), dimension: 2 }, producer: BGE }),
    },
  });
  const env = `CFG_EMS_URL=${stub.url}`;

  /** A file with bytes; `read` gives a picture, a video or a recording the metadata a read leaves. */
  const write = async (path: string, attrs: Record<string, unknown>, read = true) => {
    await client.exec(`mkdir -p ${path.slice(0, path.lastIndexOf('/'))} && printf x > ${path}`);
    await vfs.update(ADMIN_ACCESS, path, { attrs });
    if (!read) return;
    await vfs.ensure(ADMIN_ACCESS, 'directory', path, 'metadata');
    await vfs.ensure(ADMIN_ACCESS, 'file', `${path}/metadata`, 'exif');
    await vfs.update(ADMIN_ACCESS, `${path}/metadata/exif`, { attrs: { indexedAt: READ_AT } });
  };
  /** Every fact's files from a dry run, sorted. */
  const scan = async (flags = '', environment = env) => {
    const answer = await client.execJson<TextScanAnswer>(`${environment} text-scan -n -v ${flags}`);
    return { answer, paths: Object.fromEntries(Object.entries(answer.paths ?? {}).map(([fact, paths]) => [fact, [...paths].sort()])) };
  };

  try {
    const dir = `${LIBRARY}/t`;
    const done = { textVectorsBy: BGE };
    // Transcripts.
    await write(`${dir}/current.mp4`, { mimetype: 'video/mp4', transcriptWith: DECODE, ...done });
    await write(`${dir}/on-the-cpu.mp4`, { mimetype: 'video/mp4', transcriptWith: ON_CPU, ...done });
    await write(`${dir}/old.mp4`, { mimetype: 'video/mp4', transcriptWith: OLD_DECODE, ...done });
    await write(`${dir}/kept.m4a`, { mimetype: 'audio/mp4', transcriptWith: 'kept', ...done });
    await write(`${dir}/never.m4a`, { mimetype: 'audio/mp4', ...done });
    await write(`${dir}/unread.mp4`, { mimetype: 'video/mp4' }, false);
    await write(`${dir}/broken.mov`, { mimetype: 'video/quicktime', undecodable: 'moov atom not found' });
    // Pictures' text.
    await write(`${dir}/read.jpg`, { mimetype: 'image/jpeg', textIndexedAt: READ_AT, ocrBy: PPOCR, ...done });
    await write(`${dir}/other-engine.jpg`, { mimetype: 'image/jpeg', textIndexedAt: READ_AT, ocrBy: 'tesseract', ...done });
    await write(`${dir}/by-hand.jpg`, { mimetype: 'image/jpeg', textIndexedAt: READ_AT, textManual: true, ...done });
    await write(`${dir}/never.jpg`, { mimetype: 'image/jpeg' });
    await write(`${dir}/never.jpg/thumbnails/320.avif`, { mimetype: 'image/avif', sourceId: 'x' }, false);
    // Documents, which have no metadata to read.
    await write(`${dir}/menu.pdf`, { mimetype: 'application/pdf' }, false);
    await write(`${dir}/indexed.pdf`, { mimetype: 'application/pdf', textIndexedAt: READ_AT, ...done }, false);
    await write(`${dir}/indexed.pdf/metadata/content`, { mimetype: 'text/plain' }, false);
    await write(`${dir}/data.json`, { mimetype: 'application/json' }, false);
    // Text vectors: a read document not marked, and a picture described by hand.
    await write(`${dir}/letter.pdf`, { mimetype: 'application/pdf', textIndexedAt: READ_AT }, false);
    await write(`${dir}/described.jpg`, { mimetype: 'image/jpeg', textIndexedAt: READ_AT, ocrBy: PPOCR, description: 'Anna at the helm', textVectorsBy: 'all-minilm' });
    // Where text is not read, and a folder that wants renditions only.
    // A staging area wants no text while its files wait.
    await write('/home/sam/staging/files/scan.pdf', { mimetype: 'application/pdf' }, false);
    await vfs.update(ADMIN_ACCESS, '/home/sam/staging', { attrs: { processing: ['renditions', 'transcripts'] } });
    await write(`${dir}/.cache/note.txt`, { mimetype: 'text/plain' }, false);
    await write('/home/sam/screens/shot.png', { mimetype: 'image/png' });
    await vfs.update(ADMIN_ACCESS, '/home/sam/screens', { attrs: { processing: ['renditions'] } });

    const expected = {
      [TEXT_FACTS.transcriptStale]: [`${dir}/never.m4a`, `${dir}/old.mp4`],
      [TEXT_FACTS.ocrStale]: [`${dir}/other-engine.jpg`],
      [TEXT_FACTS.textMissing]: [`${dir}/menu.pdf`, `${dir}/never.jpg`],
      // `old.mp4` and `other-engine.jpg` wait for what their new transcript and reading write, and
      // `never.jpg` for its first reading.
      [TEXT_FACTS.textEmbeddingStale]: [`${dir}/described.jpg`, `${dir}/letter.pdf`],
    };

    await t.step('each gap is announced as its fact', async () => {
      const { answer, paths } = await scan();
      assertEquals(paths, expected);
      assertEquals([answer.limited, answer.waiting, answer.unchecked], [false, [], []]);
    });

    await t.step('--limit stops the run across the facts', async () => {
      const { answer } = await scan('--limit 3');
      assertEquals([answer.announced, answer.limited, answer.facts], [3, true, { [TEXT_FACTS.transcriptStale]: 2, [TEXT_FACTS.ocrStale]: 1 }]);
    });

    await t.step('a fact EMS cannot answer for is unchecked; text never read is asked all the same', async () => {
      const { answer, paths } = await scan('', 'CFG_EMS_URL=http://127.0.0.1:9 CFG_EMS_CONNECT_RETRY=0');
      assertEquals(answer.unchecked, [TEXT_FACTS.transcriptStale, TEXT_FACTS.ocrStale, TEXT_FACTS.textEmbeddingStale]);
      assertEquals(paths, { [TEXT_FACTS.textMissing]: expected[TEXT_FACTS.textMissing] });
    });

    await t.step('with transcripts not kept current, only a file never marked is announced for one', async () => {
      const { paths } = await scan('', `${env} CFG_MEDIA_TRANSCRIPTS_CURRENT=off`);
      assertEquals(paths[TEXT_FACTS.transcriptStale], [`${dir}/never.m4a`]);
    });

    await t.step('transcribe-file keeps a transcript made with the settings in force, and redoes one made with others', async () => {
      const transcript = async (path: string, attrs: Record<string, unknown>) => {
        await client.exec(`mkdir -p ${path}/metadata && printf 'WEBVTT\\n' > ${path}/metadata/transcript`);
        await vfs.update(ADMIN_ACCESS, `${path}/metadata/transcript`, {
          attrs: { mimetype: 'text/vtt', transcribedAt: READ_AT, transcribedBy: 'whisper-large-v3', speech: false, ...attrs },
        });
      };
      const transcribed = () => stub.requests.filter((request) => request.op === 'speech.transcribe').length;
      const marker = async (path: string) => (await vfs.get(ADMIN_ACCESS, path)).attrs.transcriptWith;

      await transcript(`${dir}/never.m4a`, { transcribedWith: DECODE });
      assertEquals((await client.exec(`${env} transcribe-file ${dir}/never.m4a`)).success, true);
      assertEquals([transcribed(), await marker(`${dir}/never.m4a`)], [0, DECODE]);

      // Made on the CPU while the card's share left whisper no room there: as current.
      await transcript(`${dir}/on-the-cpu.mp4`, { transcribedWith: ON_CPU });
      assertEquals((await client.exec(`${env} transcribe-file ${dir}/on-the-cpu.mp4`)).success, true);
      assertEquals([transcribed(), await marker(`${dir}/on-the-cpu.mp4`)], [0, ON_CPU]);

      // No sound: kept whatever the settings.
      await transcript(`${dir}/kept.m4a`, { transcribedBy: null, transcribedWith: null });
      await vfs.update(ADMIN_ACCESS, `${dir}/kept.m4a`, { attrs: { transcriptWith: null } });
      assertEquals((await client.exec(`${env} transcribe-file ${dir}/kept.m4a`)).success, true);
      assertEquals([transcribed(), await marker(`${dir}/kept.m4a`)], [0, 'kept']);

      await transcript(`${dir}/old.mp4`, { transcribedWith: OLD_DECODE });
      // Not current, but EMS cannot say: kept, and marked with what made it.
      assertEquals((await client.exec(`CFG_EMS_URL=http://127.0.0.1:9 CFG_EMS_CONNECT_RETRY=0 transcribe-file ${dir}/old.mp4`)).success, true);
      assertEquals([transcribed(), await marker(`${dir}/old.mp4`)], [0, OLD_DECODE]);

      const redo = await client.exec(`${env} transcribe-file ${dir}/old.mp4`);
      assertEquals(redo.success, true, redo.error);
      assertEquals([transcribed(), await marker(`${dir}/old.mp4`)], [1, DECODE]);
      const node = await vfs.get(ADMIN_ACCESS, `${dir}/old.mp4/metadata/transcript`);
      assertEquals([node.attrs.transcribedWith, node.attrs.speech], [DECODE, true]);
      // Its chunks were embedded as it was written, and the file marked so.
      assertEquals((await vfs.get(ADMIN_ACCESS, `${dir}/old.mp4`)).attrs.textVectorsBy, BGE);
    });

    await t.step('media-reembed embeds what a file lacks, and marks it', async () => {
      assertEquals((await client.exec(`${env} media-reembed ${dir}/described.jpg`)).success, true);
      const attrs = (await vfs.get(ADMIN_ACCESS, `${dir}/described.jpg`)).attrs;
      assertEquals(attrs.textVectorsBy, BGE);
      assertEquals((await vfs.get(ADMIN_ACCESS, `${dir}/described.jpg/metadata/authored/text_bgem3`)).attrs.embeddedBy, BGE);
      assertEquals((await scan()).paths[TEXT_FACTS.textEmbeddingStale].includes(`${dir}/described.jpg`), false);
    });
  } finally {
    client.close();
    await stub.close();
    await testCtx.teardown();
  }
});
