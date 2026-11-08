/**
 * The media pool's workers take the kinds the modules name in their drop-ins: `media-pool-kinds`
 * reads every module's `kinds`, the media module's own among them, the modules in name order, a
 * kind a line, comments left out, a kind named twice once, `reserve` marking the share kept after
 * ingest. The shell splits its answer into separate flags, as the workers' start scripts need.
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import type { PoolKinds } from '@media/api';
import { ADMIN_ACCESS, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';

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
      assertEquals(await client.execJson<PoolKinds>('media-pool-kinds cpu'), {
        kinds: ['ingest', 'stills', 'transcode', 'fingerprint'],
        reserve: ['stills', 'transcode', 'fingerprint'],
      });
      const text = await client.exec('media-pool-kinds models', { json: false });
      assertEquals(String(text.data).trim(), '--kind shots --kind embed-picture --kind ocr --kind embed-text --kind transcribe');
    });

    await t.step('the modules in name order, comments left out, a kind named twice once', async () => {
      await writeKinds('media-worker', 'zeta', "# zeta's work\ningest\nstills reserve   # pictures\ndedupe\n");
      await writeKinds('media-worker', 'alpha', 'unzip\n\ningest\n');
      assertEquals(await client.execJson<PoolKinds>('media-pool-kinds cpu'), {
        kinds: ['unzip', 'ingest', 'stills', 'transcode', 'fingerprint', 'dedupe'],
        reserve: ['stills', 'transcode', 'fingerprint'],
      });
    });

    await t.step('the flags split into words, as a start script uses them', async () => {
      const split = await client.exec('kinds=$(media-pool-kinds models); for word in $kinds; do echo "[$word]"; done', { json: false });
      assertEquals(String(split.data).trim().split('\n').slice(0, 4), ['[--kind]', '[shots]', '[--kind]', '[embed-picture]']);
    });

    await t.step('the second models worker takes them the other way round', async () => {
      await writeKinds('media-models', 'archive', 'faces\ndiarize\n');
      assertEquals((await client.execJson<PoolKinds>('media-pool-kinds models --reverse')).kinds, [
        'transcribe',
        'embed-text',
        'ocr',
        'embed-picture',
        'shots',
        'diarize',
        'faces',
      ]);
    });

    await t.step('another instance takes the kinds whose ops it serves and stamps as the primary does', async () => {
      await writeKinds('media-models', 'archive', 'faces ops=faces.detect,image.renditions\ndiarize\n');
      const primary = startStubEms({
        capabilities: {
          ops: ['vision.embed', 'speech.transcribe', 'text.embed', 'faces.detect'],
          models: { image_embed: 'siglip2', text_embed: 'bge-m3' },
          signatures: { transcribe: 'cuda' },
        },
      });
      const laptop = startStubEms({
        capabilities: {
          ops: ['vision.embed', 'speech.transcribe', 'text.embed', 'faces.detect', 'image.renditions'],
          models: { image_embed: 'siglip2', text_embed: 'bge-m3' },
          signatures: { transcribe: 'cpu' },
        },
      });
      try {
        await vfs.ensure(ADMIN_ACCESS, 'directory', '/etc', 'ems.d');
        await vfs.ensure(ADMIN_ACCESS, 'file', '/etc/ems.d', 'laptop');
        const handle = await vfs.open(ADMIN_ACCESS, '/etc/ems.d/laptop', { mode: 'w' });
        try {
          await handle.write(new TextEncoder().encode(JSON.stringify({ url: laptop.url })));
        } finally {
          await handle.close();
        }
        const env = `CFG_EMS_URL=${primary.url}`;
        // Its transcripts would be stamped otherwise, and diarize names no ops: neither is the laptop's.
        const kinds = String((await client.exec(`${env} media-pool-kinds models --instance laptop`, { json: false })).data).trim();
        assertEquals(kinds, '--kind faces --kind embed-picture --kind embed-text');
        assertEquals((await client.exec(`${env} media-pool-kinds models --instance laptop --expect='${kinds}'`, { json: false })).success, true);
        assertEquals((await client.exec(`${env} media-pool-kinds models --instance laptop --expect='--kind faces'`, { json: false })).success, false);
        assertEquals((await client.execJson<PoolKinds>(`${env} media-pool-kinds models --instance main`)).kinds.length, 7);
        await laptop.close();
        assertEquals(String((await client.exec(`${env} media-pool-kinds models --instance laptop`, { json: false })).data ?? '').trim(), '');
        assertEquals((await client.exec(`${env} media-pool-kinds models --instance desktop`, { json: false })).success, false);
      } finally {
        await primary.close();
        await laptop.close().catch(() => {});
      }
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
