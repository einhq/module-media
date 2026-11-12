/**
 * file-set-transcript: a recording's cues are replaced by a person's in place, the voices under the
 * transcript kept, and an unchanged cue keeps its word timings; the transcript is stamped `editedAt`
 * and `transcribe-file` leaves it alone even forced. A file with no transcript gets one from stdin.
 * Anything but WebVTT, a cue that ends before it starts, and a picture are refused. The chunks are
 * embedded ahead of batch work, and an absent EMS does not hold the save up.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { ADMIN_ACCESS, createTestContext, type ShellClient, testCommands } from '@ein/testing';
import { startStubEms } from '@ems/testing';

/** Where the files under test live: any folder. */
const LIBRARY = '/library';

const testCtx = createTestContext({ modules: ['media'] });

/** `file-set-transcript <path>` with `vtt` on stdin, after `env` (`CFG_EMS_URL=… `). */
const setTranscript = (client: ShellClient, path: string, vtt: string, env = '') => client.exec(`${env}file-set-transcript ${path}`, { stdin: vtt });

const WHISPER = [
  'WEBVTT',
  '',
  '1',
  '00:00:01.000 --> 00:00:02.500',
  '<00:00:01.000>We <00:00:01.400>took <00:00:01.900>the <00:00:02.100>boat',
  '',
  '2',
  '00:00:03.000 --> 00:00:04.000',
  'to the iland',
  '',
].join('\n');

const CORRECTED = [
  'WEBVTT',
  '',
  '00:00:03.000 --> 00:00:04.200',
  'to the island &amp; back',
  '',
  '00:00:01.000 --> 00:00:02.500',
  'We took the boat',
  '',
].join('\n');

Deno.test({
  name: 'file-set-transcript',
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();
  const cmd = testCommands(client);

  const FILES = `${LIBRARY}/sommar/files`;
  const CLIP = `${FILES}/klipp.mp4`;
  const TRANSCRIPT = `${CLIP}/metadata/transcript`;
  const RECORDING = `${FILES}/inspelning.m4a`;
  const PICTURE = `${FILES}/bild.jpg`;
  const read = async (path: string) => {
    const handle = await vfs.open(ADMIN_ACCESS, path, { mode: 'r' });
    try {
      return new TextDecoder().decode(await new Response(handle.readable).arrayBuffer());
    } finally {
      await handle.close();
    }
  };

  try {
    await client.exec(`mkdir -p ${FILES}`);
    await cmd.shouldSucceed(`mknode -t file ${CLIP} --as name=klipp.mp4 --as mimetype=video/mp4`);
    await cmd.shouldSucceed(`mknode -t file ${RECORDING} --as name=inspelning.m4a --as mimetype=audio/mp4`);
    await cmd.shouldSucceed(`mknode -t file ${PICTURE} --as name=bild.jpg --as mimetype=image/jpeg`);
    await cmd.shouldSucceed(`mkdir -p ${CLIP}/metadata`);
    await cmd.shouldSucceed(
      `mknode -t file ${TRANSCRIPT} --as mimetype=text/vtt --tier db --as transcribedAt=2026-01-01T00:00:00Z --as transcribedBy=whisper --as transcribedWith=old`,
    );
    const handle = await vfs.open(ADMIN_ACCESS, TRANSCRIPT, { mode: 'w' });
    await handle.write(new TextEncoder().encode(WHISPER));
    await handle.close();
    await cmd.shouldSucceed(`mkdir -p ${TRANSCRIPT}/speakers`);

    await t.step('the cues are replaced in place, in order, and an unchanged one keeps its words', async () => {
      const out = await client.execJson(`JSON_OUTPUT=1 file-set-transcript ${CLIP}`, { stdin: CORRECTED });
      assertEquals(out, { ok: true, path: CLIP, segmentCount: 2 });
      const vtt = await read(TRANSCRIPT);
      assertStringIncludes(vtt, '00:00:01.000 --> 00:00:02.500\n<00:00:01.000>We <00:00:01.400>took');
      assertStringIncludes(vtt, '2\n00:00:03.000 --> 00:00:04.200\nto the island &amp; back\n');
      const { attrs } = await vfs.get(ADMIN_ACCESS, TRANSCRIPT);
      assertEquals([attrs.transcribedAt, attrs.transcribedBy, attrs.segmentCount, attrs.speech], ['2026-01-01T00:00:00Z', 'whisper', 2, true]);
      assert(typeof attrs.editedAt === 'string');
      assert(await vfs.exists(ADMIN_ACCESS, `${TRANSCRIPT}/speakers`));
    });

    await t.step('a forced transcription leaves the corrected transcript alone', async () => {
      const before = await read(TRANSCRIPT);
      await cmd.shouldSucceed(`transcribe-file -f ${CLIP}`);
      assertEquals(await read(TRANSCRIPT), before);
    });

    await t.step('a recording with no transcript gets one from stdin, finished', async () => {
      await cmd.shouldSucceed(`printf 'WEBVTT\\n\\n00:00:01.000 --> 00:00:02.000\\nHej\\n' | file-set-transcript ${RECORDING}`);
      const { attrs } = await vfs.get(ADMIN_ACCESS, `${RECORDING}/metadata/transcript`);
      assertEquals([attrs.mimetype, attrs.segmentCount, attrs.speech, attrs.transcribedAt], ['text/vtt', 1, true, attrs.editedAt]);
    });

    await t.step('no lines leave an empty transcript, with no speech', async () => {
      const set = await setTranscript(client, RECORDING, 'WEBVTT\n');
      assert(set.success, set.error);
      const { attrs } = await vfs.get(ADMIN_ACCESS, `${RECORDING}/metadata/transcript`);
      assertEquals([attrs.segmentCount, attrs.speech], [0, false]);
    });

    await t.step('the chunks are embedded ahead of batch work, and an absent EMS does not hold the save up', async () => {
      const BGE = 'bge-m3';
      const stub = startStubEms({
        ops: { 'text.embed': (body) => ({ result: { embeddings: (body.texts as string[]).map(() => [1, 0]), dimension: 2 }, producer: BGE }) },
      });
      try {
        const set = await setTranscript(client, CLIP, CORRECTED, `CFG_EMS_URL=${stub.url} `);
        assert(set.success, set.error);
        const embed = stub.requests.find((request) => request.op === 'text.embed');
        assertEquals((embed?.body.options as { priority?: string } | undefined)?.priority, 'interactive');
        assertEquals((await vfs.get(ADMIN_ACCESS, `${TRANSCRIPT}/text_bgem3`)).attrs.embeddedBy, BGE);
      } finally {
        await stub.close();
      }

      // A batch call would retry the refused connection for the whole 90 s budget.
      const started = Date.now();
      const out = await client.exec(`CFG_EMS_URL=http://127.0.0.1:1 CFG_EMS_CONNECT_RETRY=90 file-set-transcript ${CLIP} 2>&1`, { stdin: CORRECTED });
      assert(out.success, out.error);
      assertStringIncludes(String(out.data), 'saved, but not yet searchable');
      assert(Date.now() - started < 5000, `the save took ${Date.now() - started} ms`);
    });

    await t.step('anything but WebVTT, a backwards cue, or a picture is refused', async () => {
      const refused = async (path: string, vtt: string, why: string) => {
        const out = await setTranscript(client, path, vtt);
        assert(!out.success, `${path} was not refused`);
        assertStringIncludes(String(out.error), why);
      };
      await refused(CLIP, '1\n00:00:01.000 --> 00:00:02.000\nx\n', 'not WebVTT');
      await refused(CLIP, 'WEBVTT\n\n00:00:03.000 --> 00:00:02.000\nx\n', 'ends before it starts');
      await refused(PICTURE, 'WEBVTT\n', 'not a video or a recording');
    });
  } finally {
    client.close();
    await testCtx.teardown();
  }
});
