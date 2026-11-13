/**
 * `file-restore`: the steps asked for run in order through EMS, each reading what the one before
 * wrote, and what is left is one frozen version beside the file, carrying the file's tags and the
 * steps as its history, with the mask filled (the defect finder's or one given) and its marks under
 * it and renditions of its own. The file is never written, and no temp stays behind.
 */

import { assert, assertEquals } from '@std/assert';
import { ADMIN_ACCESS, assertErrorContains, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import type { FileRestoreAnswer } from '@media/api';

const fileRoot = await Deno.makeTempDir({ prefix: 'ein-file-restore-' });
const testCtx = createTestContext({ modules: ['media'], fileRoot });

type Body = { file: { path: string; angle?: number }; source?: { path: string }; mask?: { path: string }; output?: { path: string; format?: string }; [key: string]: unknown };

Deno.test({
  name: 'file-restore writes a version of a picture through the EMS steps asked for',
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();

  /** Each op called, in order, with its body and what the file it was given held (and the source whose tags it copied). */
  const calls: { op: string; body: Body; read: string; source?: string }[] = [];
  const step = (op: string, result: Record<string, unknown>) => async (raw: Record<string, unknown>) => {
    const body = raw as unknown as Body;
    calls.push({ op, body, read: await Deno.readTextFile(body.file.path).catch(() => '') });
    await Deno.writeTextFile(body.output!.path, `${op} of ${calls.length}`);
    return { result: { path: body.output!.path, width: 600, height: 400, channels: 3, depth: 8, bytes: 10, ...result }, meta: { producer: `${op}-model` } };
  };
  const stub = startStubEms({
    ops: {
      'image.unfade': step('image.unfade', { levels: [[0.1, 0.8], [0.1, 0.7], [0.2, 0.6]], gammas: [1.2, 0.9, 0.9] }),
      'image.defects': step('image.defects', { marked: 120, fraction: 0.0005 }),
      'image.inpaint': step('image.inpaint', { filled: 120 }),
      'image.denoise': step('image.denoise', {}),
      // The picture as it was given, as exiftool leaves the pixels.
      'image.copy_tags': async (raw) => {
        const body = raw as unknown as Body;
        const read = await Deno.readTextFile(body.file.path);
        calls.push({ op: 'image.copy_tags', body, read, source: await Deno.readTextFile(body.source!.path) });
        await Deno.writeTextFile(body.output!.path, read);
        return { result: { path: body.output!.path, bytes: read.length }, meta: { producer: 'exiftool/13.10' } };
      },
      'image.renditions': async (raw) => {
        const body = raw as unknown as { file: { path: string; angle: number }; targets: { output: { path: string; format?: string } }[] };
        calls.push({ op: 'image.renditions', body: body as unknown as Body, read: '' });
        for (const target of body.targets) await Deno.writeTextFile(target.output.path, 'rendition');
        return { result: { frame: { width: 400, height: 600 }, targets: body.targets.map(() => ({ path: '', width: 1, height: 1, bytes: 9 })) } };
      },
    },
  });
  const restoring = () => calls.filter((c) => c.op !== 'image.renditions' && c.op !== 'image.copy_tags');
  const tagging = () => calls.filter((c) => c.op === 'image.copy_tags');
  const env = `CFG_EMS_URL=${stub.url}`;
  const restore = (args: string) => client.execJson<FileRestoreAnswer>(`${env} JSON_OUTPUT=1 file-restore ${args}`);

  try {
    await client.exec('mkdir -p /library/scans');
    await client.exec('printf print > /library/scans/print.jpg');
    await vfs.update(ADMIN_ACCESS, '/library/scans/print.jpg', { attrs: { mimetype: 'image/jpeg', width: 600, height: 400, angle: 90 } });
    const original = await vfs.get(ADMIN_ACCESS, '/library/scans/print.jpg');

    await t.step('colours, dust and grain run in that order, each on what the one before wrote', async () => {
      const answer = await restore('/library/scans/print.jpg --unfade --dust --dark --fill lama --grain 0.4');
      const ops = restoring();
      assertEquals(ops.map((c) => c.op), ['image.unfade', 'image.defects', 'image.inpaint', 'image.denoise']);
      // The picture as stored, never turned: the version takes the file's turn instead.
      assertEquals(ops.map((c) => c.body.file.angle ?? 0), [0, 0, 0, 0]);
      assertEquals(ops[1].read, 'image.unfade of 1');
      assertEquals(ops[2].read, 'image.unfade of 1');
      assertEquals(ops[2].body.mask?.path, ops[1].body.output?.path);
      assertEquals(ops[2].body.method, 'lama');
      assertEquals(ops[1].body.dark, true);
      assertEquals(ops[3].read, 'image.inpaint of 3');
      assertEquals(ops[3].body.strength, 0.4);
      assertEquals(ops.map((c) => c.body.output?.format), ['png', undefined, 'png', 'png']);
      assertEquals(ops.map((c) => (c.body.options as { priority?: string } | undefined)?.priority), ['interactive', 'interactive', 'interactive', 'interactive']);

      // The last picture gets the file's tags, its turn, the steps as its history, and says a model painted it.
      const [tags] = tagging();
      assertEquals(tags.read, 'image.denoise of 4');
      assertEquals(tags.source, 'print');
      assertEquals(tags.body.file.angle, 90);
      const history = tags.body.history as { action: string; software_agent: string; parameters: string }[];
      assertEquals(history.map((event) => event.software_agent), ['image.unfade-model', 'image.defects-model', 'image.inpaint-model', 'image.denoise-model']);
      assertEquals(history[2].parameters, 'image.inpaint {"method":"lama"}');
      assertEquals(tags.body.digital_source_type, 'compositeWithTrainedAlgorithmicMedia');

      assertEquals(answer.path, '/library/scans/print.jpg/versions/restored-1.png');
      assertEquals(answer.restoration.steps.map((s) => s.producer), ['image.unfade-model', 'image.defects-model', 'image.inpaint-model', 'image.denoise-model']);
      assertEquals(answer.restoration.marked, 0.0005);
      assertEquals(answer.mask, `${answer.path}/mask.png`);
      assertEquals(answer.marks, `${answer.path}/marks.png`);

      const version = await vfs.get(ADMIN_ACCESS, answer.path);
      assertEquals(version.attrs.sourceId, original.id);
      assertEquals(version.attrs.frozen, true);
      assertEquals(version.attrs.angle, 90);
      assertEquals(version.attrs.mimetype !== undefined, true);
      assertEquals((version.attrs.restoration as FileRestoreAnswer['restoration']).steps.length, 4);
      assertEquals((await client.exec(`cat ${answer.path}`)).data, 'image.denoise of 4');
      assertEquals((await client.exec(`cat ${answer.mask}`)).data, 'image.defects of 2');
      assertEquals((await vfs.get(ADMIN_ACCESS, answer.mask!)).attrs.sourceId, version.id);

      // The marks are cut from the mask in the display frame; the version's renditions likewise.
      const renditions = calls.filter((c) => c.op === 'image.renditions');
      assertEquals(renditions.map((c) => c.body.file.angle), [90, 90]);
      const thumbnails = (await vfs.children(ADMIN_ACCESS, `${answer.path}/thumbnails`)).map((c) => c.name);
      assert(thumbnails.length > 0 && thumbnails.every((name) => name.endsWith('.avif')));

      const versions = (await vfs.children(ADMIN_ACCESS, '/library/scans/print.jpg/versions')).map((c) => c.name);
      assertEquals(versions, ['restored-1.png']);
      assertEquals((await vfs.get(ADMIN_ACCESS, '/library/scans/print.jpg')).attrs.sha256, original.attrs.sha256);
    });

    await t.step('a second restoration is a version of its own; one step alone keeps no mask', async () => {
      calls.length = 0;
      const answer = await restore('/library/scans/print.jpg --grain 0.5');
      assertEquals(restoring().map((c) => c.op), ['image.denoise']);
      assertEquals(answer.name, 'restored-2.png');
      assertEquals(tagging()[0].body.digital_source_type, 'algorithmicallyEnhanced');
      assertEquals(answer.mask, undefined);
      assertEquals(answer.restoration.marked, undefined);
    });

    await t.step('a mask given is filled instead of one found, and kept beside the copy', async () => {
      await client.exec('printf painted > /library/scans/painted.png');
      calls.length = 0;
      const answer = await restore('/library/scans/print.jpg --unfade --mask /library/scans/painted.png --fill lama');
      const ops = restoring();
      assertEquals(ops.map((c) => c.op), ['image.unfade', 'image.inpaint']);
      assertEquals(ops[1].read, 'image.unfade of 1');
      assertEquals(ops[1].body.method, 'lama');
      assertEquals(answer.name, 'restored-3.png');
      assertEquals(answer.restoration.steps[1].params, { method: 'lama', given: true });
      assertEquals(answer.restoration.marked, 120 / (600 * 400));
      assertEquals(answer.mask, `${answer.path}/mask.png`);
      assertEquals((await client.exec(`cat ${answer.mask}`)).data, 'painted');
      assert(await vfs.exists(ADMIN_ACCESS, '/library/scans/painted.png'));
      assertEquals(calls.filter((c) => c.op === 'image.renditions').length, 2);
    });

    await t.step('a TIFF is restored into a TIFF', async () => {
      await client.exec('mkfile /library/scans/master.tif');
      await vfs.update(ADMIN_ACCESS, '/library/scans/master.tif', { attrs: { mimetype: 'image/tiff' } });
      calls.length = 0;
      const answer = await restore('/library/scans/master.tif --unfade');
      assertEquals(calls[0].body.output?.format, 'tiff');
      assertEquals(answer.name, 'restored-1.tif');
    });

    await t.step('what is refused, before EMS is asked', async () => {
      await client.exec('mkfile /library/scans/phone.heic');
      await vfs.update(ADMIN_ACCESS, '/library/scans/phone.heic', { attrs: { mimetype: 'image/heic' } });
      await client.exec('mkfile /library/scans/empty.png');
      calls.length = 0;
      for (
        const [args, message] of [
          ['/library/scans/print.jpg', 'nothing to do'],
          ['/library/scans/print.jpg --dark', '--dark goes with --dust'],
          ['/library/scans/print.jpg --unfade --fill lama', '--fill goes with --dust or --mask'],
          ['/library/scans/print.jpg --dust --mask /library/scans/painted.png', 'name one'],
          ['/library/scans/print.jpg --mask /library/scans/nothing.png', 'no mask file there'],
          ['/library/scans/print.jpg --mask /library/scans/empty.png', 'an empty file'],
          ['/library/scans/print.jpg --dust --fill paint', '--fill is ns, telea or lama'],
          ['/library/scans/print.jpg --grain 2', '--grain is a strength'],
          ['/library/scans/phone.heic --unfade', 'cannot be restored'],
          ['/library/scans/print.jpg/versions/restored-1.png --unfade', 'restore the file it belongs to'],
        ]
      ) {
        assertErrorContains(await client.exec(`${env} file-restore ${args}`), message);
      }
      assertEquals(calls.length, 0);
    });

    await t.step('a step EMS fails leaves nothing behind', async () => {
      const failing = startStubEms({
        ops: { 'image.unfade': { error: { code: 'undecodable', message: 'the file cannot be decoded', permanent: true }, status: 422 } },
      });
      try {
        const run = await client.exec(`CFG_EMS_URL=${failing.url} file-restore /library/scans/print.jpg --unfade`);
        assertErrorContains(run, 'cannot be decoded');
        const versions = (await vfs.children(ADMIN_ACCESS, '/library/scans/print.jpg/versions')).map((c) => c.name);
        assertEquals(versions, ['restored-1.png', 'restored-2.png', 'restored-3.png']);
      } finally {
        await failing.close();
      }
    });
  } finally {
    await stub.close();
    await testCtx.teardown();
    await Deno.remove(fileRoot, { recursive: true }).catch(() => {});
  }
});
