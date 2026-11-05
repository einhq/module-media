/**
 * VFS mutation -> the facts of a media file itself: it arrived, its bytes changed, it was turned or
 * removed, its metadata was read, its renditions were made. The media module's bridge
 * (`media-bridge`) derives them; what a file means in a family's world is other modules' facts,
 * which their own bridges derive from the same mutations.
 *
 * A fact is a projection of VFS state, never a record of "a step finished", so the same rules serve
 * the live bridge and a scan replaying them over a tree. Rules read the node fresh rather than
 * trusting the event, so they are safe to re-run and correct under at-least-once delivery; the one
 * exception is a removal, read off the attrs the deleted event carries because nothing is left to
 * read. Emitting a fact twice is harmless — a pipeline's `skipIf` and one-instance-per-node absorb
 * it.
 */

import type { DomainEvent } from '@ein/client';
import { DEV_PATH, ETC_PATH, isTrashPath, TEMP_PATH, USR_PATH, VAR_PATH } from '@ein/paths';
import { RENDITION_FACTS } from '@media/facts';
import { RENDITIONS_AT_ATTR, RENDITIONS_FOR_ATTR } from '@media/rendition-marker';

/** Who announced a fact derived here. */
const SOURCE = 'media-bridge';

/** The facts of a media file itself. */
export const FILE_FACTS = {
  /**
   * A media file with bytes and no metadata read yet, and no hold on it — the entry point to
   * reading it.
   */
  discovered: 'media.file.discovered',
  /** A file whose bytes changed after its metadata was read; everything derived from them is stale. */
  contentChanged: 'media.file.content-changed',
  /**
   * A media file is gone: its last name was unlinked. Read off the attrs the deleted event carries,
   * since the node no longer exists to be read, so `data` is what the file was.
   */
  removed: 'media.file.removed',
  /**
   * A video whose metadata was read was turned or flipped by hand (`angleManual` or `mirror`
   * changed). Its transcoded renditions are encoded at the old orientation and are made again.
   */
  turned: 'media.file.turned',
  /** `<file>/metadata/exif` is written: the file's metadata is read, and the work on it can start. */
  metadataExtracted: 'media.metadata.extracted',
  /** The file's renditions are all there under the rendition table in force. */
  renditionsMade: RENDITION_FACTS.made,
} as const;

/**
 * File-node attr: a module's hold on reading the file, `FileHold`. The file is left unread, and no
 * discovery is announced for it, for as long as it has the bytes and stays in the folder the hold
 * names; a module sets it from its `/etc/media-read.d/<module>/hold` command, which `exif-extract`
 * runs before it reads a file, and takes it off with null when the reason is gone.
 */
export const HOLD_ATTR = 'hold';

/** Why a module holds a file unread, for the bytes it has now, within one folder. */
export type FileHold = {
  /** The module holding it. */
  by: string;
  /** Why, for a person reading `attrs`. */
  reason: string;
  /** The bytes the hold is for: new bytes are read whatever it says. */
  sha256: string;
  /** The folder it holds within: a file moved out of it is read. */
  within: string;
};

/** The hold in force on a file at `path` with `attrs`, if one is: set for these bytes, in that folder. */
export const holdOf = (path: string, attrs: Record<string, unknown>): FileHold | undefined => {
  const hold = attrs[HOLD_ATTR] as Partial<FileHold> | undefined;
  if (!hold || typeof hold !== 'object' || typeof hold.within !== 'string' || typeof hold.sha256 !== 'string') return undefined;
  if (hold.sha256 !== attrs.sha256 || !path.startsWith(`${hold.within}/`)) return undefined;
  return hold as FileHold;
};

/**
 * Directory attr: the lane the work on the files under it runs in. `bulk` puts it below everything
 * of the normal lane, for a folder whose files arrive by the thousand — a module's import area, say;
 * the nearest folder that says decides, and none means the normal lane.
 */
export const LANE_ATTR = 'lane';

/** How long a folder's lane is kept before it is read again, ms. */
const LANE_TTL_MS = 60_000;

const laneCache = new WeakMap<FileRuleContext, Map<string, { at: number; lane: string | undefined }>>();

/** The lane the nearest folder above `path` names, read through `ctx` and kept a minute. */
const laneOf = async (ctx: FileRuleContext, path: string, now: number): Promise<string | undefined> => {
  const cache = laneCache.get(ctx) ?? new Map();
  laneCache.set(ctx, cache);
  for (let dir = parentOf(path);; dir = parentOf(dir)) {
    const cached = cache.get(dir);
    const lane = cached && now - cached.at < LANE_TTL_MS ? cached.lane : str((await ctx.getNode(dir))?.attrs[LANE_ATTR]);
    if (!cached || now - cached.at >= LANE_TTL_MS) cache.set(dir, { at: now, lane });
    if (lane !== undefined) return lane;
    if (dir === '/') return undefined;
  }
};

/**
 * `facts` with `lane: 'bulk'` on each whose subject lies in a folder of the bulk lane (`LANE_ATTR`):
 * the media bridge's facts, and those of any other module's bridge, so all the work on a file runs
 * in one lane.
 */
export const withLanes = async (facts: Omit<DomainEvent, 'id'>[], ctx: FileRuleContext, now: number): Promise<Omit<DomainEvent, 'id'>[]> => {
  const stamped: Omit<DomainEvent, 'id'>[] = [];
  for (const fact of facts) stamped.push(await laneOf(ctx, fact.subject, now) === 'bulk' ? { ...fact, lane: 'bulk' } : fact);
  return stamped;
};

/** VFS routing keys the media bridge binds: the file writes and removals, and the metadata node's writes. */
export const MEDIA_BRIDGE_ROUTING_KEYS = [
  'system.vfs.file.created',
  'system.vfs.file.updated',
  'system.vfs.file.deleted',
  'system.vfs.exif.created',
  'system.vfs.exif.updated',
];

/** A node as a rule sees it. */
export type NodeSnapshot = {
  id: string;
  type: string;
  attrs: Record<string, unknown>;
  /** Last modification time, epoch ms. */
  modtime?: number;
};

/** The slim VFS event as published on `system.vfs.<nodeType>.<eventType>`. */
export type VfsEventInput = {
  type: string;
  path: string;
  nodeId: string;
  nodeType: string;
  timestamp: number;
  /** Attr names an `updated` event changed. Absent on other event types and on older publishers. */
  changedAttrs?: string[];
  /** The node's attrs as they were, on a `deleted` event only. */
  attrs?: Record<string, unknown>;
  /** Where the node was before, on a `moved` event only. */
  fromPath?: string;
  /** Who made the write. */
  uid?: number;
  /** The audit record the write left, when the trail kept one. */
  auditId?: string;
};

/** What a rule reads of the VFS, so the rules stay testable on their own. */
export type FileRuleContext = {
  getNode(path: string): Promise<NodeSnapshot | undefined>;
  exists(path: string): Promise<boolean>;
};

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

/** The attrs that turn a file by hand. */
const MANUAL_ORIENTATION_ATTRS = ['angleManual', 'mirror'];

const MEDIA_MIMETYPE = /^(image|video|audio)\//;

/**
 * True if `node` is a file the media pipelines read at all: a picture, a video or a recording with
 * bytes, and not a rendition of another file. Exported so a count of "still reading" can leave out
 * what will never be read — a text file, an empty file.
 */
export const isIndexableMedia = (node: NodeSnapshot): boolean => {
  if (node.type !== 'file') return false;
  // A rendition carries the id of the file it was made from. Reading one would make the pipelines
  // recurse on their own output — this one check replaces a `skipIf` in every media pipeline.
  if (node.attrs.sourceId) return false;
  if (!MEDIA_MIMETYPE.test(str(node.attrs.mimetype) ?? '')) return false;
  // No bytes yet: the node exists but the upload has not landed.
  return (num(node.attrs.size) ?? 0) > 0;
};

/**
 * The regions that hold nobody's media: configuration, machine state, code and its payload (a
 * module's own pictures, written file by file as it is installed), endpoints, and scratch — a
 * picture put in /tmp to search with would otherwise be read and answer every search.
 */
const NOT_MEDIA = [ETC_PATH, VAR_PATH, USR_PATH, DEV_PATH, TEMP_PATH];

/** Whether `path` lies where media is read. */
export const isMediaPath = (path: string): boolean => !NOT_MEDIA.some((region) => path === region || path.startsWith(`${region}/`));

/**
 * The facts a file node reveals, whichever event revealed it: discovered when it has bytes and no
 * metadata read, and no hold; content changed when its bytes are no longer those the metadata was
 * read from.
 *
 * `node` lets a caller that already holds the snapshot skip the re-read.
 */
export async function deriveForFile(filePath: string, ctx: FileRuleContext, now: number, node?: NodeSnapshot): Promise<Omit<DomainEvent, 'id'>[]> {
  // Nothing in a trash is read: a trashed file waits there to be restored or purged.
  if (isTrashPath(filePath)) return [];

  const file = node ?? await ctx.getNode(filePath);
  if (!file || !isIndexableMedia(file)) return [];

  const exif = await ctx.getNode(`${filePath}/metadata/exif`);
  const base = { subject: filePath, nodeId: file.id, time: now, source: SOURCE };
  const data = { mimetype: str(file.attrs.mimetype) ?? '', size: num(file.attrs.size) ?? 0, sha256: str(file.attrs.sha256) ?? '' };

  if (!exif) {
    if (holdOf(filePath, file.attrs)) return [];
    return [{ ...base, type: FILE_FACTS.discovered, data }];
  }

  // Read already. All that is left to say is whether the bytes moved out from under it — compared
  // by content hash rather than timestamps, because the pipelines' own writes bump the modtime.
  const readSha = str(exif.attrs.sourceSha256);
  const currentSha = str(file.attrs.sha256);
  if (readSha && currentSha && readSha !== currentSha) {
    return [{ ...base, type: FILE_FACTS.contentChanged, data: { ...data, previousSha256: readSha } }];
  }
  return [];
}

/** The fact the last name of a media file being unlinked reveals, read off the event's attrs. */
function deriveForRemoval(event: VfsEventInput, now: number): Omit<DomainEvent, 'id'>[] {
  if (!event.attrs) return [];
  const file: NodeSnapshot = { id: event.nodeId, type: event.nodeType, attrs: event.attrs };
  if (!isIndexableMedia(file)) return [];
  return [{
    type: FILE_FACTS.removed,
    subject: event.path,
    nodeId: event.nodeId,
    time: now,
    source: SOURCE,
    data: {
      mimetype: str(file.attrs.mimetype) ?? '',
      size: num(file.attrs.size) ?? 0,
      ...(str(file.attrs.sha256) ? { sha256: str(file.attrs.sha256) } : {}),
    },
  }];
}

/**
 * The fact a hand-set turn of a video whose metadata was read reveals. Only on the write that
 * changed the orientation, and only once read: before that, the transcode reading queues reads the
 * new orientation anyway.
 */
async function deriveFileTurned(event: VfsEventInput, file: NodeSnapshot, ctx: FileRuleContext, now: number): Promise<Omit<DomainEvent, 'id'>[]> {
  if (event.type !== 'updated' || !(event.changedAttrs ?? []).some((name) => MANUAL_ORIENTATION_ATTRS.includes(name))) return [];
  const mimetype = str(file.attrs.mimetype) ?? '';
  if (!isIndexableMedia(file) || !mimetype.startsWith('video/')) return [];
  if (!await ctx.exists(`${event.path}/metadata/exif`)) return [];
  return [{
    type: FILE_FACTS.turned,
    subject: event.path,
    nodeId: file.id,
    time: now,
    source: SOURCE,
    data: { mimetype, angle: num(file.attrs.angle) ?? 0, mirror: file.attrs.mirror === true },
  }];
}

/**
 * The fact `generate-derivatives` announces by writing `renditionsAt` on the file, which it does
 * once the file's renditions are all there. Only on the write that changed it.
 */
function deriveRenditionsMade(event: VfsEventInput, file: NodeSnapshot, now: number): Omit<DomainEvent, 'id'>[] {
  const renditionsAt = str(file.attrs[RENDITIONS_AT_ATTR]);
  if (!renditionsAt || event.type !== 'updated' || !(event.changedAttrs ?? []).includes(RENDITIONS_AT_ATTR)) return [];
  return [{
    type: FILE_FACTS.renditionsMade,
    subject: event.path,
    nodeId: file.id,
    time: now,
    source: SOURCE,
    data: { mimetype: str(file.attrs.mimetype) ?? '', renditionsAt, renditionsFor: str(file.attrs[RENDITIONS_FOR_ATTR]) ?? '' },
  }];
}

/**
 * The fact a filled `metadata/exif` node reveals: the file's metadata is read. The node is created
 * empty and filled by a following update, so only the filled state is a fact. `exif-extract` writes
 * the file's own attrs before this node, so what starts on the fact finds them.
 */
export async function deriveForExif(exifPath: string, ctx: FileRuleContext, now: number): Promise<Omit<DomainEvent, 'id'>[]> {
  const exif = await ctx.getNode(exifPath);
  if (!exif || !exif.attrs.indexedAt) return [];

  const filePath = parentOf(parentOf(exifPath));
  const file = await ctx.getNode(filePath);
  // The same test discovery applies: a text node can carry an exif child from an earlier life, and
  // every consumer of this fact renders media.
  if (!file || !isIndexableMedia(file)) return [];

  const fileinfo = exif.attrs.fileinfo as Record<string, unknown> | undefined;
  return [{
    type: FILE_FACTS.metadataExtracted,
    subject: filePath,
    nodeId: file.id,
    time: now,
    source: SOURCE,
    data: {
      mimetype: str(file.attrs.mimetype) ?? '',
      width: num(file.attrs.width) ?? null,
      height: num(file.attrs.height) ?? null,
      duration: num(fileinfo?.duration) ?? null,
    },
  }];
}

/**
 * Map one VFS mutation to the file facts it reveals, each in the lane its folder names. Empty for
 * the overwhelming majority of events — that is the point.
 */
export async function deriveFileEvents(event: VfsEventInput, ctx: FileRuleContext, now: number = Date.now()): Promise<Omit<DomainEvent, 'id'>[]> {
  const facts = await withLanes(await factsOf(event, ctx, now), ctx, now);
  // Each names the write it was derived from, so the pipelines it starts can record it as their cause.
  if (!event.auditId || event.uid === undefined) return facts;
  const write = { auditId: event.auditId, uid: event.uid };
  return facts.map((fact) => ({ ...fact, write }));
}

const factsOf = async (event: VfsEventInput, ctx: FileRuleContext, now: number): Promise<Omit<DomainEvent, 'id'>[]> => {
  if (!isMediaPath(event.path)) return [];
  if (event.nodeType === 'exif') return event.type === 'deleted' ? [] : await deriveForExif(event.path, ctx, now);
  if (event.nodeType !== 'file') return [];
  if (event.type === 'deleted') return deriveForRemoval(event, now);

  const file = await ctx.getNode(event.path);
  const primary = await deriveForFile(event.path, ctx, now, file);
  if (primary.length > 0 || !file) return primary;
  return [...await deriveFileTurned(event, file, ctx, now), ...deriveRenditionsMade(event, file, now)];
};
