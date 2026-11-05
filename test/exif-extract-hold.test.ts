/**
 * A module's hold on reading a file: `exif-extract` runs each module's
 * `/etc/media-read.d/<module>/hold` command with the file first, and a file the command holds
 * (`hold`, for its bytes in its folder) is not read unless forced, and the bridge's discovery rule
 * announces nothing for it. A hold for other bytes, or for a folder the file has left, holds
 * nothing.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import type { ExifExtractAnswer } from '@media/api';
import { deriveForFile, HOLD_ATTR, holdOf } from '@media/file-rules';

const testCtx = createTestContext({ modules: ['media'] });

/** The hash of the one byte `x` every file here has. */
const X_SHA256 = '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881';

Deno.test({ name: "exif-extract asks the modules' hold commands first", sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();
  const stub = startStubEms({
    ops: {
      'media.probe': () => ({
        result: {
          mimetype: 'image/jpeg',
          kind: 'image',
          size: 1,
          captured_at: [],
          decodable: true,
          raw: { exiftool: { MIMEType: 'image/jpeg', ImageWidth: 40, ImageHeight: 30 } },
        },
        producer: 'exiftool/13',
      }),
    },
  });
  const env = `CFG_EMS_URL=${stub.url}`;
  const dir = '/library/inbox';

  // A module whose hold command holds every file it is asked about: `attrs` with the hold, which
  // `exif-extract` hands the file. Every file here has the one byte `x`, so the hold names its hash.
  const hold = { by: 'keeper', reason: 'testing', sha256: X_SHA256, within: dir };
  const write = async (path: string, text: string) => {
    const handle = await vfs.open(ADMIN_ACCESS, path, { mode: 'w' });
    try {
      await handle.write(new TextEncoder().encode(text));
    } finally {
      await handle.close();
    }
  };
  for (const [parent, name] of [['/', 'library'], ['/library', 'inbox'], ['/etc', 'media-read.d'], ['/etc/media-read.d', 'keeper']]) {
    await vfs.ensure(ADMIN_ACCESS, 'directory', parent, name);
  }
  await vfs.ensure(ADMIN_ACCESS, 'file', '/etc/media-read.d/keeper', 'hold');
  await write('/etc/media-read.d/keeper/hold', `# a test module that holds everything\nattrs -J hold='${JSON.stringify(hold)}'\n`);

  const media = async (name: string) => {
    const path = `${dir}/${name}`;
    await client.exec(`printf x > ${path}`);
    await vfs.update(ADMIN_ACCESS, path, { attrs: { mimetype: 'image/jpeg' } });
    return path;
  };
  const read = async (path: string) => await vfs.exists(ADMIN_ACCESS, `${path}/metadata/exif`);

  try {
    await t.step('a held file is not read, and the bridge does not announce it', async () => {
      const path = await media('held.jpg');
      const answer = await client.execJson<ExifExtractAnswer>(`${env} exif-extract ${path}`);
      assertEquals(answer, { held: 'testing', by: 'keeper' });
      assertEquals(await read(path), false);
      const node = await vfs.get(ADMIN_ACCESS, path);
      const ctx = {
        getNode: async (p: string) => p === path ? { id: node.id, type: node.type, attrs: node.attrs as Record<string, unknown> } : undefined,
        exists: async () => false,
      };
      assertEquals(await deriveForFile(path, ctx, 1), []);
    });

    await t.step('forced, it is read whatever the hold says', async () => {
      const path = `${dir}/held.jpg`;
      const answer = await client.execJson<ExifExtractAnswer>(`${env} exif-extract -f ${path}`);
      assertEquals('indexedAt' in answer, true);
      assertEquals(await read(path), true);
    });

    await t.step('a hold holds only the bytes it was set for, in its folder', () => {
      const hold = { by: 'keeper', reason: 'testing', sha256: 'aaa', within: dir };
      assertEquals(holdOf(`${dir}/a.jpg`, { sha256: 'aaa', [HOLD_ATTR]: hold })?.by, 'keeper');
      assertEquals(holdOf(`${dir}/a.jpg`, { sha256: 'bbb', [HOLD_ATTR]: hold }), undefined);
      assertEquals(holdOf('/library/elsewhere/a.jpg', { sha256: 'aaa', [HOLD_ATTR]: hold }), undefined);
    });
  } finally {
    client.close();
    await stub.close();
    await testCtx.teardown();
  }
});
