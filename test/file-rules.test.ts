/**
 * The media bridge's rules: which VFS mutations are facts of a media file itself, and which are
 * noise. Table-driven against synthetic node snapshots — no harness — because these rules are the
 * contract the media pipelines trigger on.
 */

import { assertEquals } from '@std/assert';
import { parse as parseYaml } from '@std/yaml';
import type { DomainEvent } from '@ein/client';
import { deriveFileEvents, FILE_FACTS, type FileRuleContext, HOLD_ATTR, isTextReadPath, LANE_ATTR, type NodeSnapshot, type VfsEventInput } from '@media/file-rules';
import { TEXT_FACTS } from '@media/facts';

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

Deno.test('a read picture whose text language is set by hand is announced; any other write is not', async () => {
  const updated = (changedAttrs: string[]): VfsEventInput => ({ ...event('file', IMG, 'updated'), changedAttrs });
  const set = (facts: Omit<DomainEvent, 'id'>[]) => facts.filter((fact) => fact.type === TEXT_FACTS.languageSet);
  const picture = (attrs: Record<string, unknown>) => tree({ [IMG]: file('f1', attrs), [`${IMG}/metadata/exif`]: exif() });
  const read = { textIndexedAt: '2026-10-19T10:00:00Z' };

  const facts = set(await deriveFileEvents(updated(['ocrLanguageManual']), picture({ ...read, ocrLanguageManual: 'en' }), 100));
  assertEquals(facts.map((fact) => [fact.subject, fact.data]), [[IMG, { mimetype: 'image/jpeg', language: 'en' }]]);
  // Cleared, the language is told from the text again.
  assertEquals(set(await deriveFileEvents(updated(['ocrLanguageManual']), picture(read), 100))[0].data?.language, null);
  assertEquals(set(await deriveFileEvents(updated(['textIndexedAt', 'ocrBy']), picture({ ...read, ocrLanguageManual: 'en' }), 100)), []);
  // Its text never read: the reading it waits for asks in the language anyway.
  assertEquals(set(await deriveFileEvents(updated(['ocrLanguageManual']), picture({ ocrLanguageManual: 'en' }), 100)), []);
});

Deno.test('a transcript gaining its transcribedAt reports the recording, once per transcription', async () => {
  const transcript = `${VID}/metadata/transcript`;
  const nodes: Record<string, NodeSnapshot> = {
    [VID]: file('f1', { mimetype: 'video/mp4' }),
    [transcript]: { id: 't1', type: 'file', attrs: {} },
  };
  const ctx = tree(nodes);

  // transcribe-file writes the cues first: nothing to announce yet.
  assertEquals(await deriveFileEvents(event('file', transcript), ctx, 100), []);

  nodes[transcript] = { id: 't1', type: 'file', attrs: { mimetype: 'text/vtt', transcribedAt: '2026-11-06T08:00:00Z', speech: true, language: 'sv' } };
  const facts = await deriveFileEvents({ ...event('file', transcript, 'updated'), changedAttrs: ['mimetype', 'transcribedAt', 'speech', 'language'] }, ctx, 100);
  assertEquals(facts.map((fact) => [fact.type, fact.subject, fact.data]), [[TEXT_FACTS.transcriptGenerated, VID, { mimetype: 'video/mp4', speech: true, language: 'sv' }]]);

  // Its chunks are written beneath it; an update that leaves transcribedAt alone says nothing.
  assertEquals(await deriveFileEvents({ ...event('file', transcript, 'updated'), changedAttrs: ['size'] }, ctx, 100), []);
});

Deno.test('a directory moved whole announces the text gap of each unread file within it, where text is read', async () => {
  const dir = `${LIBRARY}/trip`;
  const within: Record<string, NodeSnapshot> = {
    [`${dir}/menu.pdf`]: file('f1', { mimetype: 'application/pdf' }),
    [`${dir}/day-2/IMG_0001.jpg`]: file('f2'),
    [`${dir}/IMG_0002.cr2`]: file('f3', { mimetype: 'image/x-canon-cr2' }),
    [`${dir}/clip.mp4`]: file('f4', { mimetype: 'video/mp4' }),
    [`${dir}/IMG_0003.jpg/thumbnails/320.avif`]: file('f5', { mimetype: 'image/avif', sourceId: 'f6' }),
    [`${dir}/.hidden/IMG_0004.jpg`]: file('f7'),
  };
  const asked: string[] = [];
  const ctx: FileRuleContext = {
    ...tree({}),
    unreadFilesWithin: (path) => {
      asked.push(path);
      return Promise.resolve(Object.entries(within).map(([path, node]) => ({ path, node })));
    },
  };

  const facts = await deriveFileEvents(event('directory', dir, 'moved'), ctx, 100);

  assertEquals(asked, [dir]);
  assertEquals(facts.map((fact) => [fact.type, fact.subject, fact.data]), [
    [TEXT_FACTS.textMissing, `${dir}/menu.pdf`, { mimetype: 'application/pdf' }],
    [TEXT_FACTS.textMissing, `${dir}/day-2/IMG_0001.jpg`, { mimetype: 'image/jpeg' }],
    [TEXT_FACTS.textMissing, `${dir}/IMG_0002.cr2`, { mimetype: 'image/x-canon-cr2' }],
  ]);
  // Any other change to a directory is not a move, and a move with nothing to ask reveals nothing.
  assertEquals(await deriveFileEvents(event('directory', dir, 'updated'), ctx, 100), []);
  assertEquals(await deriveFileEvents(event('directory', dir, 'moved'), tree({}), 100), []);
  assertEquals(asked, [dir]);
});

Deno.test('a hand-written description set or changed is a text gap; one cleared, and any other write, is not', async () => {
  const described = (changed: string[], attrs: Record<string, unknown>) =>
    deriveFileEvents({ ...event('file', IMG, 'updated'), changedAttrs: changed }, tree({ [IMG]: file('f1', attrs), [`${IMG}/metadata/exif`]: exif() }), 100);

  const facts = await described(['description'], { description: 'Anna at the helm' });
  assertEquals(facts.map((fact) => [fact.type, fact.subject, fact.data]), [[TEXT_FACTS.textEmbeddingStale, IMG, { mimetype: 'image/jpeg', stale: ['authored'] }]]);
  assertEquals(await described(['description'], { description: '  ' }), []);
  assertEquals(await described(['description'], {}), []);
  assertEquals(await described(['title'], { description: 'Anna at the helm' }), []);
});

Deno.test("isTextReadPath leaves out the paths document-index's and media-ocr's triggers do", async () => {
  type Trigger = { unless?: { nodePath?: string[] } };
  const read = async (name: string) => (parseYaml(await Deno.readTextFile(new URL(`../pipelines/${name}`, import.meta.url))) as { triggers: Trigger[] }).triggers;
  const globs = [...(await read('document-index.yaml')), ...(await read('media-ocr.yaml'))].flatMap((trigger) => trigger.unless?.nodePath ?? []);
  // A path glob as the engine reads one: `*` within one name, `**` across `/`.
  const pathGlob = (glob: string) =>
    new RegExp(`^${glob.split('**').map((part) => part.split('*').map((text) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*')}$`);
  const unread = [...new Set(globs)].map(pathGlob);
  const paths = [
    `${LIBRARY}/a.jpg`,
    `${LIBRARY}/letters/menu.pdf`,
    '/home/anna/photos/a.jpg',
    '/home/anna/staging/files/a.jpg',
    '/home/anna/staging/genealogy/tree.txt',
    '/home/anna/.trash/01J/a.jpg',
    `${LIBRARY}/.cache/a.jpg`,
    `${LIBRARY}/a.pdf/metadata/content`,
    '/var/logs/jobs/1/stdout.log',
    '/etc/notes.txt',
    '/usr/modules/x/a.png',
    '/dev/events',
    '/tmp/a.jpg',
  ];
  for (const path of paths) assertEquals(isTextReadPath(path), !unread.some((pattern) => pattern.test(path)), path);
});
