/**
 * `find-damage`: EMS's scores kept on the picture with the kinds of damage they find, what read them
 * and when; a picture already read is not asked again without `-f`; one EMS cannot read is stamped
 * with what tried and no kinds; what is not a picture it reads is refused before EMS is asked.
 */

import { assertEquals } from '@std/assert';
import { ADMIN_ACCESS, assertErrorContains, createTestContext } from '@ein/testing';
import { startStubEms } from '@ems/testing';
import type { FindDamageAnswer } from '@media/api';

const testCtx = createTestContext({ modules: ['media'] });

Deno.test({
  name: 'find-damage keeps how faded, dusty and scratched a picture is',
  sanitizeResources: false,
  sanitizeOps: false,
}, async (t) => {
  const { vfs } = await testCtx.setup();
  const client = await testCtx.server.createShellClient();
  let scores = { faded: 0.8, dusty: 0.5, scratched: 0.1 };
  const stub = startStubEms({
    ops: {
      'image.damage': () => ({
        result: { width: 600, height: 400, ...scores, measures: { change: 18.8, specks: 120, scratches: 1, length: 0.5, marked: 0.01 } },
        producer: 'damage/1+bopb-detection',
      }),
    },
    capabilities: { ops: ['image.damage'], models: { damage: 'damage/1+bopb-detection' } },
  });
  const env = `CFG_EMS_URL=${stub.url}`;
  const read = (args: string) => client.execJson<FindDamageAnswer>(`${env} JSON_OUTPUT=1 find-damage ${args}`);

  try {
    await client.exec('mkdir -p /library/scans');
    await client.exec('printf print > /library/scans/print.jpg');
    await vfs.update(ADMIN_ACCESS, '/library/scans/print.jpg', { attrs: { mimetype: 'image/jpeg', angle: 90 } });

    await t.step('the scores, the kinds that reach a half, what read them', async () => {
      const answer = await read('/library/scans/print.jpg');
      assertEquals(answer.damage, ['faded', 'dust']);
      assertEquals(answer.damageScores, { faded: 0.8, dusty: 0.5, scratched: 0.1 });
      assertEquals(answer.damageBy, 'damage/1+bopb-detection');
      const attrs = (await vfs.get(ADMIN_ACCESS, '/library/scans/print.jpg')).attrs;
      assertEquals(attrs.damage, ['faded', 'dust']);
      assertEquals(attrs.damageAt, answer.damageAt);
      // The picture as stored: damage does not depend on its turn.
      const asked = stub.requests.find((r) => r.op === 'image.damage')!;
      assertEquals((asked.body.file as { angle: number }).angle, 0);
    });

    await t.step('read once; -f reads again', async () => {
      scores = { faded: 0, dusty: 0, scratched: 0.9 };
      const asked = stub.requests.length;
      await client.exec(`${env} find-damage /library/scans/print.jpg`);
      assertEquals(stub.requests.length, asked);
      assertEquals((await read('-f /library/scans/print.jpg')).damage, ['scratches']);
    });

    await t.step('a picture EMS cannot read is stamped with what tried, and no kinds', async () => {
      const failing = startStubEms({
        ops: { 'image.damage': { error: { code: 'undecodable', message: 'the file cannot be decoded', permanent: true }, status: 422 } },
        capabilities: { ops: ['image.damage'], models: { damage: 'damage/1+bopb-detection' } },
      });
      try {
        await client.exec('printf broken > /library/scans/broken.png');
        await vfs.update(ADMIN_ACCESS, '/library/scans/broken.png', { attrs: { mimetype: 'image/png' } });
        const answer = await client.execJson<FindDamageAnswer>(`CFG_EMS_URL=${failing.url} JSON_OUTPUT=1 find-damage /library/scans/broken.png`);
        assertEquals(answer.damage, []);
        assertEquals(answer.damageScores, null);
        assertEquals(answer.damageBy, 'damage/1+bopb-detection');
      } finally {
        await failing.close();
      }
    });

    await t.step('what is refused, before EMS is asked', async () => {
      await client.exec('mkfile /library/scans/phone.heic');
      await vfs.update(ADMIN_ACCESS, '/library/scans/phone.heic', { attrs: { mimetype: 'image/heic' } });
      const asked = stub.requests.length;
      assertErrorContains(await client.exec(`${env} find-damage /library/scans/phone.heic`), 'is not read for damage');
      assertErrorContains(await client.exec(`${env} find-damage /library/scans/none.jpg`), 'file not found');
      assertErrorContains(await client.exec(`${env} find-damage /library/scans`), 'not a file node');
      assertEquals(stub.requests.length, asked);
    });
  } finally {
    await stub.close();
    await testCtx.teardown();
  }
});
