/**
 * `embed-picture` against a stub EMS: where a photo's and a video's vectors land, what marks the
 * work done, that vectors the model EMS runs made are kept and the file marked while another
 * model's are made again, and that a re-embed starts from an empty directory rather than retyping
 * nodes (a retyped embedding node leaves its row in the old model's table).
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, createTestContext, testCommands } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import { PICTURE_VECTORS_BY_ATTR } from '@media/pictures';

const testCtx = createTestContext({ boot: true, modules: ['media'] });
const SIGLIP = 'ViT-SO400M-16-SigLIP2-384__webli';
const LIBRARY = '/library';

Deno.test({
  name: 'embed-picture',
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();
  const cmd = testCommands(client);

  const read = async (path: string) => {
    const handle = await vfs.open(ADMIN_ACCESS, path, { mode: 'r' });
    try {
      return JSON.parse(new TextDecoder().decode(await new Response(handle.readable).arrayBuffer()));
    } finally {
      await handle.close();
    }
  };
  const children = async (path: string) => (await vfs.children(ADMIN_ACCESS, path)).map((c) => c.name).sort();

  let reply: Record<string, unknown> = { embedding: [0.6, 0.8, 0], dimension: 3 };
  let producer = SIGLIP;
  // What EMS says it embeds with now, read on every request.
  const capabilities = { models: { image_embed: SIGLIP } };
  const stub = startStubEms({ ops: { 'vision.embed': () => ({ result: reply, producer }) }, capabilities });
  const embeds = () => stub.requests.filter((r) => r.op === 'vision.embed').length;
  const run = (args: string) => client.exec(`CFG_EMS_URL=${stub.url} embed-picture ${args}`);

  try {
    await client.exec(`mkdir -p ${LIBRARY}/hav/files`);
    const photo = `${LIBRARY}/hav/files/segel.jpg`;
    await cmd.shouldSucceed(`mknode -t file ${photo} --as name=segel.jpg --as mimetype=image/jpeg --an angle=90`);

    await t.step('a photo gets one vector, typed by its model, and the directory is stamped last', async () => {
      const out = await run(photo);
      assertEquals(out.success, true, out.error);
      assertEquals(await children(`${photo}/metadata/picture`), ['embedding']);
      const node = await vfs.get(ADMIN_ACCESS, `${photo}/metadata/picture/embedding`);
      assertEquals(node.attrs.embeddingType, 'picture_siglip2');
      assertEquals(node.attrs.capacity, 3);
      assertEquals(await read(`${photo}/metadata/picture/embedding`), [0.6, 0.8, 0]);
      assertEquals((await vfs.get(ADMIN_ACCESS, `${photo}/metadata/picture`)).attrs.embeddedBy, SIGLIP);
      assertEquals((await vfs.get(ADMIN_ACCESS, photo)).attrs[PICTURE_VECTORS_BY_ATTR], SIGLIP);
      // The file's own rotation reached EMS: the vector is of the picture as it is shown.
      const asked = stub.requests.filter((r) => r.op === 'vision.embed').at(-1)!;
      assertEquals((asked.body.file as { angle: number }).angle, 90);
    });

    await t.step('a photo with an 800px rendition is embedded from it, unrotated', async () => {
      const shown = `${LIBRARY}/hav/files/skepp.jpg`;
      await cmd.shouldSucceed(`mknode -t file ${shown} --as name=skepp.jpg --as mimetype=image/jpeg --an angle=270`);
      await cmd.shouldSucceed(`mkdir -p ${shown}/thumbnails`);
      await cmd.shouldSucceed(`mknode -t file ${shown}/thumbnails/800x800.avif --as name=800x800.avif --as mimetype=image/avif`);
      assertEquals((await run(shown)).success, true);
      const asked = stub.requests.filter((r) => r.op === 'vision.embed').at(-1)!;
      const file = asked.body.file as { angle: number; mimetype: string };
      assertEquals([file.angle, file.mimetype], [0, 'image/avif']);
    });

    await t.step("a photo's vectors are kept while EMS embeds with the model that made them, and the file marked", async () => {
      await vfs.update(ADMIN_ACCESS, photo, { attrs: { [PICTURE_VECTORS_BY_ATTR]: null } });
      const before = embeds();
      assertEquals((await run(photo)).success, true);
      assertEquals(embeds(), before);
      assertEquals((await vfs.get(ADMIN_ACCESS, photo)).attrs[PICTURE_VECTORS_BY_ATTR], SIGLIP);
    });

    await t.step("another model's vectors are made again without -f", async () => {
      await vfs.update(ADMIN_ACCESS, `${photo}/metadata/picture`, { attrs: { embeddedBy: 'ViT-B-32__openai' } });
      const before = embeds();
      assertEquals((await run(photo)).success, true);
      assertEquals(embeds(), before + 1);
      assertEquals((await vfs.get(ADMIN_ACCESS, `${photo}/metadata/picture`)).attrs.embeddedBy, SIGLIP);
      // While EMS embeds no pictures, vectors are kept whatever made them.
      await vfs.update(ADMIN_ACCESS, `${photo}/metadata/picture`, { attrs: { embeddedBy: 'ViT-B-32__openai' } });
      capabilities.models.image_embed = '';
      assertEquals((await run(photo)).success, true);
      assertEquals(embeds(), before + 1);
      capabilities.models.image_embed = SIGLIP;
      assertEquals((await run(`-f ${photo}`)).success, true);
    });

    await t.step('a model nothing has given a type is refused, and nothing is replaced', async () => {
      producer = 'ViT-B-32__openai';
      const out = await run(`-f ${photo}`);
      assertEquals(out.success, false);
      assertEquals((await vfs.get(ADMIN_ACCESS, `${photo}/metadata/picture`)).attrs.embeddedBy, SIGLIP);
      producer = SIGLIP;
    });

    await t.step('a video gets a vector per keyframe, and a re-embed leaves no old node behind', async () => {
      const clip = `${LIBRARY}/hav/files/segel.mp4`;
      await cmd.shouldSucceed(`mknode -t file ${clip} --as name=segel.mp4 --as mimetype=video/mp4`);
      reply = { frames: [0, 1, 2].map((i) => ({ at: i * 2.5, embedding: [i, 1, 0] })), dimension: 3 };
      assertEquals((await run(clip)).success, true);
      assertEquals(await children(`${clip}/metadata/picture`), ['k0', 'k1', 'k2']);
      assertEquals((await vfs.get(ADMIN_ACCESS, `${clip}/metadata/picture/k1`)).attrs.atSeconds, 2.5);

      reply = { frames: [0, 1].map((i) => ({ at: i, embedding: [1, i, 0] })), dimension: 3 };
      assertEquals((await run(`-f ${clip}`)).success, true);
      assertEquals(await children(`${clip}/metadata/picture`), ['k0', 'k1']);
    });

    await t.step('audio is not a picture', async () => {
      const memo = `${LIBRARY}/hav/files/memo.m4a`;
      await cmd.shouldSucceed(`mknode -t file ${memo} --as name=memo.m4a --as mimetype=audio/mp4`);
      assertEquals((await run(memo)).success, false);
    });
  } finally {
    await stub.close();
    client.close();
    await testCtx.teardown();
  }
});
