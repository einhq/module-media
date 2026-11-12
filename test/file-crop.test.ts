/**
 * `file-crop`: EMS is asked to cut the box out of the picture as it is shown, at most the size
 * given, into the file named, and what it wrote is answered. A box outside the picture, a file
 * already there or a file that is no picture is refused before EMS is asked.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, assertErrorContains, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import type { FileCropAnswer } from '@media/api';

const fileRoot = await Deno.makeTempDir({ prefix: 'ein-file-crop-' });
const testCtx = createTestContext({ modules: ['media'], fileRoot });

type Target = { output: { path: string; format?: string }; crop?: unknown; box?: unknown; fit?: string };
type Body = { file: { path: string; angle?: number; mirror?: boolean }; targets: Target[] };

Deno.test({
  name: 'file-crop cuts a part of a picture out through EMS',
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();

  const calls: Body[] = [];
  const stub = startStubEms({
    ops: {
      'image.renditions': async (raw) => {
        const body = raw as unknown as Body;
        calls.push(body);
        for (const target of body.targets) await Deno.writeTextFile(target.output.path, 'cut');
        return { result: { frame: { width: 4000, height: 6000 }, targets: body.targets.map(() => ({ path: '', width: 400, height: 300, bytes: 3 })) } };
      },
    },
  });
  const env = `CFG_EMS_URL=${stub.url}`;

  try {
    await client.exec('mkdir -p /library/scans /library/out');
    await client.exec('mkfile /library/scans/print.tif');
    await vfs.update(ADMIN_ACCESS, '/library/scans/print.tif', { attrs: { mimetype: 'image/tiff', width: 6000, height: 4000, angle: 90, mirror: true } });

    await t.step('the box is cut from the picture as shown, bounded and never enlarged', async () => {
      const answer = await client.execJson<FileCropAnswer>(
        `${env} JSON_OUTPUT=1 file-crop /library/scans/print.tif --box 0.5,0.25,0.5,0.25 --width 400 -o /library/out/cut.jpg`,
      );
      assertEquals(answer, { path: '/library/out/cut.jpg', width: 400, height: 300, frame: { width: 4000, height: 6000 } });
      assertEquals(calls.length, 1);
      assertEquals(calls[0].file.angle, 90);
      assertEquals(calls[0].file.mirror, true);
      const [target] = calls[0].targets;
      assertEquals(target.crop, { x: 0.5, y: 0.25, width: 0.5, height: 0.25 });
      assertEquals(target.box, { width: 400 });
      assertEquals(target.fit, 'contain');
      assertEquals(target.output.format, 'jpeg');
      assertEquals((await client.exec('cat /library/out/cut.jpg')).data, 'cut');
    });

    await t.step('what cannot be cut is refused before EMS is asked', async () => {
      calls.length = 0;
      assertErrorContains(await client.exec(`${env} file-crop /library/scans/print.tif --box 0.8,0,0.5,0.5 -o /library/out/a.jpg`), 'not inside the picture');
      assertErrorContains(await client.exec(`${env} file-crop /library/scans/print.tif --box 0,0,1,1 -o /library/out/cut.jpg`), 'already there');
      assertErrorContains(await client.exec(`${env} file-crop /library/scans/print.tif --box 0,0,1,1 -o /library/out/a.gif`), '.jpg, .png, .webp or .avif');
      assertErrorContains(await client.exec(`${env} file-crop /library/scans/print.tif --box 0,0,1,1 --width 0 -o /library/out/a.jpg`), 'whole numbers');
      await client.exec('printf hello > /library/out/note.txt');
      assertErrorContains(await client.exec(`${env} file-crop /library/out/note.txt --box 0,0,1,1 -o /library/out/a.jpg`), 'not a picture');
      assertEquals(calls.length, 0);
      assertEquals(await vfs.exists(ADMIN_ACCESS, '/library/out/a.jpg'), false);
    });
  } finally {
    await stub.close();
    await testCtx.teardown();
    await Deno.remove(fileRoot, { recursive: true }).catch(() => {});
  }
});
