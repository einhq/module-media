/**
 * The media bridge's rules: which VFS mutations are facts of a media file itself, and which are
 * noise. Table-driven against synthetic node snapshots — no harness — because these rules are the
 * contract the media pipelines trigger on.
 */

import { assertEquals } from '@std/assert';
import type { DomainEvent } from '@ein/client';
import { deriveFileEvents, FILE_FACTS, type FileRuleContext, HOLD_ATTR, LANE_ATTR, type NodeSnapshot, type VfsEventInput } from '@media/file-rules';

const LIBRARY = '/library/x';
const IMG = `${LIBRARY}/a.jpg`;
const VID = `${LIBRARY}/a.mp4`;

const tree = (nodes: Record<string, NodeSnapshot>): FileRuleContext => ({
  getNode: (path) => Promise.resolve(nodes[path]),
  exists: (path) => Promise.resolve(path in nodes),
});

const file = (id: string, attrs: Record<string, unknown> = {}): NodeSnapshot => ({
  id,
  type: 'file',
  attrs: { mimetype: 'image/jpeg', size: 1024, sha256: 'abc', ...attrs },
});

const exif = (attrs: Record<string, unknown> = {}): NodeSnapshot => ({ id: 'e1', type: 'exif', attrs: { indexedAt: 'now', sourceSha256: 'abc', ...attrs } });

const event = (nodeType: string, path: string, type = 'created'): VfsEventInput => ({ type, path, nodeId: 'n1', nodeType, timestamp: 1 });

const types = (facts: Omit<DomainEvent, 'id'>[]) => facts.map((fact) => fact.type);

Deno.test('a media file with bytes and no metadata read is discovered', async () => {
  const facts = await deriveFileEvents(event('file', IMG), tree({ [IMG]: file('f1') }), 100);
  assertEquals(facts.map((fact) => [fact.type, fact.subject, fact.nodeId, fact.data?.mimetype]), [[FILE_FACTS.discovered, IMG, 'f1', 'image/jpeg']]);
});

Deno.test('nothing in a trash, outside the trees media is read in, or not media is discovered', async () => {
  const paths = [
    '/home/anna/.trash/01J/01K/a.jpg',
    '/tmp/like-print.jpg',
    '/var/lib/modules/charts/tiles/12/2183/1240.png',
    '/usr/modules/charts/icon.png',
    '/etc/ui/logo.png',
  ];
  for (const path of paths) assertEquals(await deriveFileEvents(event('file', path), tree({ [path]: file('f1') }), 100), [], path);
  for (const attrs of [{ sourceId: 'f0' }, { mimetype: 'application/pdf' }, { size: 0 }]) {
    assertEquals(await deriveFileEvents(event('file', IMG), tree({ [IMG]: file('f1', attrs) }), 100), [], JSON.stringify(attrs));
  }
});

Deno.test('a file a module holds is not discovered while the hold is for its bytes and its folder', async () => {
  const hold = { by: 'archive', reason: 'an exact copy', sha256: 'abc', within: LIBRARY };
  const discovered = async (path: string, attrs: Record<string, unknown>) =>
    types(await deriveFileEvents(event('file', path, 'updated'), tree({ [path]: file('f1', attrs) }), 100));

  assertEquals(await discovered(IMG, { [HOLD_ATTR]: hold }), []);
  // Other bytes than the hold's: discovered, and the holder asked again when it is read.
  assertEquals(await discovered(IMG, { [HOLD_ATTR]: hold, sha256: 'def' }), [FILE_FACTS.discovered]);
  // Moved out of the folder the hold is for: discovered where it lies.
  assertEquals(await discovered('/library/y/a.jpg', { [HOLD_ATTR]: hold }), [FILE_FACTS.discovered]);
  // Taken off.
  assertEquals(await discovered(IMG, { [HOLD_ATTR]: null }), [FILE_FACTS.discovered]);
});

Deno.test('a file read already is silent, and one whose bytes changed is content-changed, held or not', async () => {
  assertEquals(await deriveFileEvents(event('file', IMG, 'updated'), tree({ [IMG]: file('f1'), [`${IMG}/metadata/exif`]: exif() }), 100), []);

  const hold = { by: 'archive', reason: 'an exact copy', sha256: 'def', within: LIBRARY };
  const changed = await deriveFileEvents(
    event('file', IMG, 'updated'),
    tree({ [IMG]: file('f1', { sha256: 'def', [HOLD_ATTR]: hold }), [`${IMG}/metadata/exif`]: exif() }),
    100,
  );
  assertEquals(changed.map((fact) => [fact.type, fact.data?.previousSha256]), [[FILE_FACTS.contentChanged, 'abc']]);
});

Deno.test('a filled exif node is the metadata read; one created empty, or under a text file, is not', async () => {
  const ctx = tree({ [IMG]: file('f1', { width: 4032, height: 3024 }), [`${IMG}/metadata/exif`]: exif({ fileinfo: { duration: 12 } }) });
  const facts = await deriveFileEvents(event('exif', `${IMG}/metadata/exif`, 'updated'), ctx, 100);
  // Subject is the file, so $NODE_PATH is what the steps operate on.
  assertEquals(facts.map((fact) => [fact.type, fact.subject, fact.data]), [[FILE_FACTS.metadataExtracted, IMG, {
    mimetype: 'image/jpeg',
    width: 4032,
    height: 3024,
    duration: 12,
  }]]);

  assertEquals(
    await deriveFileEvents(event('exif', `${IMG}/metadata/exif`), tree({ [IMG]: file('f1'), [`${IMG}/metadata/exif`]: { id: 'e1', type: 'exif', attrs: {} } }), 100),
    [],
  );
  const text = `${LIBRARY}/metadata/description`;
  const textCtx = tree({ [text]: file('f2', { mimetype: 'text/plain' }), [`${text}/metadata/exif`]: exif() });
  assertEquals(await deriveFileEvents(event('exif', `${text}/metadata/exif`, 'updated'), textCtx, 100), []);
});

Deno.test("a file's renditions are made on the write that marked them, and only then", async () => {
  const ctx = tree({
    [VID]: file('f1', { mimetype: 'video/mp4', renditionsFor: '0123456789abcdef', renditionsAt: '2026-11-05T22:00:00Z' }),
    [`${VID}/metadata/exif`]: exif(),
  });
  const updated = (changedAttrs: string[]): VfsEventInput => ({ ...event('file', VID, 'updated'), changedAttrs });

  const facts = await deriveFileEvents(updated(['renditionsFor', 'renditionsAt']), ctx, 100);
  assertEquals(facts.map((fact) => [fact.type, fact.data]), [[FILE_FACTS.renditionsMade, {
    mimetype: 'video/mp4',
    renditionsAt: '2026-11-05T22:00:00Z',
    renditionsFor: '0123456789abcdef',
  }]]);
  assertEquals(await deriveFileEvents(updated(['description']), ctx, 100), []);
});

Deno.test('a video read already, turned or flipped by hand, is turned; any other write is not', async () => {
  const updated = (changedAttrs: string[], path = VID): VfsEventInput => ({ ...event('file', path, 'updated'), changedAttrs });
  const ctx = tree({ [VID]: file('f1', { mimetype: 'video/mp4', angle: 90, angleManual: 90, mirror: true }), [`${VID}/metadata/exif`]: exif() });

  const facts = await deriveFileEvents(updated(['angle', 'angleManual']), ctx, 100);
  assertEquals(facts.map((fact) => [fact.type, fact.subject, fact.data]), [[FILE_FACTS.turned, VID, { mimetype: 'video/mp4', angle: 90, mirror: true }]]);
  assertEquals(types(await deriveFileEvents(updated(['mirror']), ctx, 100)), [FILE_FACTS.turned]);
  // The angle `exif-extract` derives on every reading is not a turn, nor is any other write.
  assertEquals(await deriveFileEvents(updated(['angle']), ctx, 100), []);
  assertEquals(await deriveFileEvents(event('file', VID, 'updated'), ctx, 100), []);
  // Not read yet: the transcode reading queues reads the new orientation itself.
  const unread = tree({ [VID]: file('f1', { mimetype: 'video/mp4', angleManual: 90 }) });
  assertEquals(types(await deriveFileEvents(updated(['angleManual']), unread, 100)).filter((type) => type === FILE_FACTS.turned), []);
  // A turned photo has no rendition to encode again.
  const photo = tree({ [IMG]: file('f1', { angleManual: 90 }), [`${IMG}/metadata/exif`]: exif() });
  assertEquals(await deriveFileEvents(updated(['angleManual'], IMG), photo, 100), []);
});

Deno.test('a removed media file is a fact, read from the attrs it had; anything else removed is not', async () => {
  const deleted = (attrs?: Record<string, unknown>): VfsEventInput => ({ ...event('file', IMG, 'deleted'), ...(attrs ? { attrs } : {}) });
  // The tree is empty: the node is gone, and the rule must not need it.
  const facts = await deriveFileEvents(deleted(file('n1').attrs), tree({}), 100);
  assertEquals(facts.map((fact) => [fact.type, fact.subject, fact.nodeId, fact.data]), [[FILE_FACTS.removed, IMG, 'n1', {
    mimetype: 'image/jpeg',
    size: 1024,
    sha256: 'abc',
  }]]);
  assertEquals(await deriveFileEvents(deleted(), tree({}), 100), []);
  for (const attrs of [{ sourceId: 'f0' }, { mimetype: 'application/pdf' }, { size: 0 }]) {
    assertEquals(await deriveFileEvents(deleted(file('n1', attrs).attrs), tree({}), 100), []);
  }
});

Deno.test('a fact about a file in a folder of the bulk lane is in the bulk lane, and names the write it came from', async () => {
  const bulk = '/library/scans';
  const path = `${bulk}/deep/a.jpg`;
  const ctx = tree({ [path]: file('f1'), [bulk]: { id: 'd1', type: 'directory', attrs: { [LANE_ATTR]: 'bulk' } } });
  const facts = await deriveFileEvents({ ...event('file', path), auditId: 'a1', uid: 7 }, ctx, 100);
  assertEquals(facts.map((fact) => [fact.type, fact.lane, fact.write]), [[FILE_FACTS.discovered, 'bulk', { auditId: 'a1', uid: 7 }]]);
  assertEquals((await deriveFileEvents(event('file', IMG), tree({ [IMG]: file('f1') }), 100))[0].lane, undefined);
});
