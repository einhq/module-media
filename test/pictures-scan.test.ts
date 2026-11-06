/**
 * `pictures-scan` finds the photos and videos whose picture vectors are not the model EMS embeds
 * with now, by their marker, in every tree: one with no marker or another model's. It passes over
 * a file marked by that model, a recording, a rendition, a file nothing can decode, one not read
 * yet, one in a trash, and one in a folder that wants no picture vectors; it announces nothing
 * while EMS does not answer or embeds no pictures, and `--limit` stops it.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import type { PicturesScanAnswer } from '@media/api';

/** Where the files under test live: any folder that wants picture vectors. */
const LIBRARY = '/library';

const SIGLIP = 'ViT-SO400M-16-SigLIP2-384__webli';

const testCtx = createTestContext({ modules: ['media'] });

Deno.test({ name: 'pictures-scan announces the files whose picture vectors are not current', sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();
  const capabilities = { models: { image_embed: SIGLIP } };
  const stub = startStubEms({ ops: { 'vision.embed': { result: {} } }, capabilities });
  const env = `CFG_EMS_URL=${stub.url}`;

  /** A media file with bytes; `read` gives it the metadata a read leaves. */
  const media = async (path: string, attrs: Record<string, unknown>, read = true) => {
    await client.exec(`mkdir -p ${path.slice(0, path.lastIndexOf('/'))} && printf x > ${path}`);
    await vfs.update(ADMIN_ACCESS, path, { attrs });
    if (!read) return;
    await vfs.ensure(ADMIN_ACCESS, 'directory', path, 'metadata');
    await vfs.ensure(ADMIN_ACCESS, 'file', `${path}/metadata`, 'exif');
    await vfs.update(ADMIN_ACCESS, `${path}/metadata/exif`, { attrs: { indexedAt: '2026-11-06T08:00:00Z' } });
  };
  const scan = (flags: string, environment = env) => client.execJson<PicturesScanAnswer>(`${environment} pictures-scan ${flags}`);

  try {
    const dir = `${LIBRARY}/p`;
    await media(`${dir}/current.jpg`, { mimetype: 'image/jpeg', pictureVectorsBy: SIGLIP });
    await media(`${dir}/other-model.jpg`, { mimetype: 'image/jpeg', pictureVectorsBy: 'ViT-B-32__openai' });
    await media(`${dir}/never.mp4`, { mimetype: 'video/mp4' });
    await media(`${dir}/never.mp4/thumbnails/320x320.avif`, { mimetype: 'image/avif', sourceId: 'x' }, false);
    await media(`${dir}/memo.m4a`, { mimetype: 'audio/mp4' });
    await media(`${dir}/unread.jpg`, { mimetype: 'image/jpeg' }, false);
    await media(`${dir}/broken.mov`, { mimetype: 'video/quicktime', undecodable: 'moov atom not found' });
    // Outside the library: a folder that wants renditions only, and a trash.
    await media('/home/sam/screens/shot.png', { mimetype: 'image/png' });
    await vfs.update(ADMIN_ACCESS, '/home/sam/screens', { attrs: { processing: ['renditions'] } });
    await media('/home/sam/.trash/1/gone.jpg', { mimetype: 'image/jpeg' });

    const announced = [`${dir}/never.mp4`, `${dir}/other-model.jpg`];

    await t.step('the photos and videos with no marker or another model, the model said', async () => {
      const dry = await scan('-n -v');
      assertEquals([...(dry.paths ?? [])].sort(), announced);
      assertEquals([dry.announced, dry.limited, dry.waiting, dry.model], [2, false, false, SIGLIP]);
    });

    await t.step('--limit stops the run, and the facts are written', async () => {
      const limited = await scan('-n --limit 1');
      assertEquals([limited.announced, limited.limited], [1, true]);
      await client.exec('mkdir -p /dev && ([ -e /dev/events ] || mknode -t router --as routingKey=system.events /dev/events)');
      assertEquals((await scan('--limit 0')).announced, 2);
    });

    await t.step('nothing is announced while EMS embeds no pictures, or does not answer', async () => {
      capabilities.models.image_embed = '';
      assertEquals(await scan('-n'), { examined: 0, announced: 0, limited: false, waiting: false, model: null });
      capabilities.models.image_embed = SIGLIP;
      const blind = await scan('-n', 'CFG_EMS_URL=http://127.0.0.1:9 CFG_EMS_CONNECT_RETRY=0');
      assertEquals([blind.announced, blind.model], [0, null]);
    });
  } finally {
    client.close();
    await stub.close();
    await testCtx.teardown();
  }
});
