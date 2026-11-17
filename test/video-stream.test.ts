/**
 * `video-stream`: EMS's H.264 stream of a video goes to stdout as it comes, asked for from the
 * original as it is shown; what is not a video is refused before EMS is asked, and a stream EMS
 * cannot start says why.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, assertErrorContains, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';

const testCtx = createTestContext({ modules: ['media'] });

Deno.test({
  name: 'video-stream writes what EMS makes of a video',
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();
  const encoder = new TextEncoder();
  const stub = startStubEms({
    ops: {
      'video.stream': (body) =>
        (body.file as { path: string }).path.endsWith('broken.mov')
          ? { error: { code: 'tool_failed', message: 'no encoder could start the stream' }, status: 500 }
          : { bytes: [encoder.encode('ftyp'), encoder.encode('moof'), encoder.encode('mdat')], producer: 'ffmpeg/9.0.1/h264_nvenc/cuda' },
    },
  });
  const env = `CFG_EMS_URL=${stub.url}`;

  try {
    await client.exec('mkdir -p /library/films');
    await client.exec('printf mov > /library/films/sailing.mov');
    await vfs.update(ADMIN_ACCESS, '/library/films/sailing.mov', { attrs: { mimetype: 'video/quicktime', angle: 90, codec: 'hevc' } });

    await t.step('the bytes as they come, from the original turned as it is shown', async () => {
      const result = await client.exec(`${env} video-stream /library/films/sailing.mov --start=95.5 --fps=25 --muted > /library/films/sailing-h264.mp4`);
      assertEquals(result.success, true, result.error);
      const handle = await vfs.open(ADMIN_ACCESS, '/library/films/sailing-h264.mp4', { mode: 'r' });
      try {
        assertEquals(new TextDecoder().decode(await handle.read(64)), 'ftypmoofmdat');
      } finally {
        await handle.close();
      }
      const asked = stub.requests.find((r) => r.op === 'video.stream')!;
      assertEquals(asked.body.file, { path: (asked.body.file as { path: string }).path, angle: 90, mirror: false });
      assertEquals([asked.body.start, asked.body.video, asked.body.audio, asked.body.hints], [95.5, { fps: 25 }, null, { source_codec: 'hevc' }]);
    });

    await t.step('what is not a video, or not there, is refused before EMS is asked', async () => {
      const asked = stub.requests.length;
      await client.exec('printf song > /library/films/song.m4a');
      await vfs.update(ADMIN_ACCESS, '/library/films/song.m4a', { attrs: { mimetype: 'audio/mp4' } });
      assertErrorContains(await client.exec(`${env} video-stream /library/films/song.m4a`), 'not a video');
      assertErrorContains(await client.exec(`${env} video-stream /library/films/none.mov`), 'not found');
      assertErrorContains(await client.exec(`${env} video-stream /library/films/sailing.mov --fps=90`), 'a whole number from 1 to 60');
      assertEquals(stub.requests.length, asked);
    });

    await t.step('a stream EMS cannot start says why', async () => {
      await client.exec('printf mov > /library/films/broken.mov');
      await vfs.update(ADMIN_ACCESS, '/library/films/broken.mov', { attrs: { mimetype: 'video/quicktime' } });
      assertErrorContains(await client.exec(`${env} video-stream /library/films/broken.mov`), 'no encoder could start the stream');
    });
  } finally {
    await stub.close();
    await testCtx.teardown();
  }
});
