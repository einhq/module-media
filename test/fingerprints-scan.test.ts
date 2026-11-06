/**
 * `fingerprints-scan` finds the pictures, videos and recordings without `fingerprintedAt`, in every
 * tree. It passes over a marked file, a document, a rendition, a file nothing can decode, one not
 * read yet, one in a trash, and one in a folder that wants no fingerprints, and `--limit` stops it.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, createTestContext } from '@ein/testing';
import type { FingerprintsScanAnswer } from '@media/api';

/** Where the files under test live: any folder that wants fingerprints. */
const LIBRARY = '/library';

const testCtx = createTestContext({ modules: ['media'] });

Deno.test({ name: 'fingerprints-scan announces the files never fingerprinted to the end', sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();

  /** A media file with bytes; `read` gives it the metadata a read leaves. */
  const media = async (path: string, attrs: Record<string, unknown>, read = true) => {
    await client.exec(`mkdir -p ${path.slice(0, path.lastIndexOf('/'))} && printf x > ${path}`);
    await vfs.update(ADMIN_ACCESS, path, { attrs });
    if (!read) return;
    await vfs.ensure(ADMIN_ACCESS, 'directory', path, 'metadata');
    await vfs.ensure(ADMIN_ACCESS, 'file', `${path}/metadata`, 'exif');
    await vfs.update(ADMIN_ACCESS, `${path}/metadata/exif`, { attrs: { indexedAt: '2026-11-06T08:00:00Z' } });
  };
  const scan = (flags: string) => client.execJson<FingerprintsScanAnswer>(`fingerprints-scan ${flags}`);

  try {
    const dir = `${LIBRARY}/p`;
    await media(`${dir}/done.jpg`, { mimetype: 'image/jpeg', fingerprintedAt: '2026-11-06T09:00:00Z' });
    await media(`${dir}/never.jpg`, { mimetype: 'image/jpeg' });
    await media(`${dir}/never.mp4`, { mimetype: 'video/mp4' });
    await media(`${dir}/never.mp4/thumbnails/320x320.avif`, { mimetype: 'image/avif', sourceId: 'x' }, false);
    await media(`${dir}/memo.m4a`, { mimetype: 'audio/mp4' });
    await media(`${dir}/letter.pdf`, { mimetype: 'application/pdf' });
    await media(`${dir}/unread.jpg`, { mimetype: 'image/jpeg' }, false);
    await media(`${dir}/broken.mov`, { mimetype: 'video/quicktime', undecodable: 'moov atom not found' });
    // Outside the library: a folder that wants renditions only, and a trash.
    await media('/home/sam/screens/shot.png', { mimetype: 'image/png' });
    await vfs.update(ADMIN_ACCESS, '/home/sam/screens', { attrs: { processing: ['renditions'] } });
    await media('/home/sam/.trash/1/gone.jpg', { mimetype: 'image/jpeg' });

    const announced = [`${dir}/memo.m4a`, `${dir}/never.jpg`, `${dir}/never.mp4`];

    await t.step('the pictures, videos and recordings with no marker', async () => {
      const dry = await scan('-n -v');
      assertEquals([...(dry.paths ?? [])].sort(), announced);
      assertEquals([dry.announced, dry.limited, dry.waiting], [3, false, false]);
    });

    await t.step('--limit stops the run, and the facts are written', async () => {
      const limited = await scan('-n --limit 1');
      assertEquals([limited.announced, limited.limited], [1, true]);
      await client.exec('mkdir -p /dev && ([ -e /dev/events ] || mknode -t router --as routingKey=system.events /dev/events)');
      assertEquals((await scan('--limit 0')).announced, 3);
    });
  } finally {
    client.close();
    await testCtx.teardown();
  }
});
