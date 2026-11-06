/**
 * The media pool's workers take the kinds the modules name in their drop-ins: `media-pool-kinds`
 * reads every module's `kinds`, the media module's own among them, the modules in name order, a
 * kind a line, comments left out, a kind named twice once, `reserve` marking the share kept after
 * ingest. The shell splits its answer into separate flags, as the workers' start scripts need.
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import type { PoolKinds } from '@media/api';
import { ADMIN_ACCESS, createTestContext } from '@ein/testing';

const testCtx = createTestContext({ modules: ['media'] });

const moduleRoot = new URL('../', import.meta.url);

Deno.test({ name: 'media-pool-kinds reads the modules drop-ins', sanitizeResources: false, sanitizeOps: false }, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();

  const writeKinds = async (worker: string, module: string, text: string) => {
    for (const [parent, name] of [['/etc', `${worker}.d`], [`/etc/${worker}.d`, module]]) {
      await vfs.ensure(ADMIN_ACCESS, 'directory', parent, name);
    }
    await vfs.ensure(ADMIN_ACCESS, 'file', `/etc/${worker}.d/${module}`, 'kinds');
    const handle = await vfs.open(ADMIN_ACCESS, `/etc/${worker}.d/${module}/kinds`, { mode: 'w' });
    try {
      await handle.write(new TextEncoder().encode(text));
    } finally {
      await handle.close();
    }
  };

  try {
    await t.step("the media module's own drop-ins name its kinds", async () => {
      assertEquals(await client.execJson<PoolKinds>('media-pool-kinds cpu'), { kinds: ['ingest', 'stills', 'transcode'], reserve: ['stills', 'transcode'] });
      const text = await client.exec('media-pool-kinds models', { json: false });
      assertEquals(String(text.data).trim(), '--kind shots --kind embed-picture');
    });

    await t.step('the modules in name order, comments left out, a kind named twice once', async () => {
      await writeKinds('media-worker', 'zeta', "# zeta's work\ningest\nstills reserve   # pictures\ndedupe\n");
      await writeKinds('media-worker', 'alpha', 'unzip\n\ningest\n');
      assertEquals(await client.execJson<PoolKinds>('media-pool-kinds cpu'), {
        kinds: ['unzip', 'ingest', 'stills', 'transcode', 'dedupe'],
        reserve: ['stills', 'transcode'],
      });
    });

    await t.step('the flags split into words, as a start script uses them', async () => {
      const split = await client.exec('kinds=$(media-pool-kinds models); for word in $kinds; do echo "[$word]"; done', { json: false });
      assertEquals(String(split.data).trim().split('\n'), ['[--kind]', '[shots]', '[--kind]', '[embed-picture]']);
    });

    await t.step('the second models worker takes them the other way round', async () => {
      await writeKinds('media-models', 'archive', 'faces\nocr\n');
      assertEquals((await client.execJson<PoolKinds>('media-pool-kinds models --reverse')).kinds, ['embed-picture', 'shots', 'ocr', 'faces']);
    });

    await t.step('anything but cpu or models is refused', async () => {
      const refused = await client.exec('media-pool-kinds gpu', { json: false });
      assertEquals(refused.success, false);
    });
  } finally {
    await testCtx.teardown();
  }
});

Deno.test('the workers take their kinds from the drop-ins, and name no card', async () => {
  for (const [service, worker] of [['media-worker', 'cpu'], ['models', 'models'], ['models-second', 'models --reverse']]) {
    const script = await Deno.readTextFile(new URL(`services/${service}/start.sh`, moduleRoot));
    assertStringIncludes(script, `kinds=$(media-pool-kinds ${worker})`);
    const invocation = script.slice(script.indexOf('pipeline-worker'));
    assertStringIncludes(invocation, '$kinds');
    assertEquals(invocation.includes('--kind '), false, `${service} names a kind of its own`);
    assertEquals(invocation.includes('vramMb') || invocation.includes('gpu'), false, `${service} names a card`);
  }
});
