/**
 * The walk behind the scans that heal by a marker (`renditions-scan`, `pictures-scan`, `text-scan`):
 * the files a query finds whose marker is missing or names something no longer in force, each
 * announced in the bulk lane, as nobody waits on a repair.
 *
 * Passed over: a rendition itself (it carries `sourceId`), a file nothing can decode, one with no
 * bytes, a picture, video or recording whose metadata is not read yet (that is discovery's gap,
 * `media-scan`'s), one in a trash or in `/etc`, `/var` and the like, one in a folder that wants
 * none of the scan's families of processing (`processing`), and one the scan's own test refuses.
 */

import { DEV_PATH, ETC_PATH, isTrashPath, TEMP_PATH, USR_PATH, VAR_PATH } from '@ein/paths';
import type { AttrCondition, Command, DomainEvent } from '@ein/client';
import { EVENTS_NODE_PATH, processingRoots, wantsProcessing } from '@ein/client';
import { ulid } from '@std/ulid/ulid';
import { UNDECODABLE_ATTR } from '@media/probe';

/** Files one query page returns. */
const PAGE = 500;

/** The files whose metadata is read before anything else is made of them. */
const MEDIA_MIMETYPE = /^(image|video|audio)\//;

/** The trees that hold no one's media. */
const NOT_MEDIA = [ETC_PATH, VAR_PATH, USR_PATH, DEV_PATH, TEMP_PATH];

type StaleScan = {
  /** The scan, which its facts say they came from. */
  source: string;
  /** The fact announced for each file. */
  fact: string;
  /** The families of processing a file's folder wants one of for the file to be announced. */
  families: string[];
  /** Whether a file at the path is announced at all; every file when absent. */
  admits?: (path: string) => boolean;
  /** Paths passed over: those another scan of the same run announced, say. */
  skip?: Set<string>;
  /** The tree to look in, `/` for every one. */
  root: string;
  /** Facts one run announces at most; 0 for no cap. */
  limit: number;
  /** Count what would be announced, announcing nothing. */
  dry: boolean;
  /** Write a line for each fact. */
  verbose: boolean;
};

/**
 * A query of the scan: the files its conditions find, and the data a file's fact carries, or
 * undefined for a file the query found that is current after all.
 */
export type StaleQuery = {
  where: AttrCondition[];
  data: (attrs: Record<string, unknown>) => Record<string, string> | undefined;
};

type StaleScanResult = {
  /** Files the queries returned and the scan looked at. */
  examined: number;
  /** The files announced (or, dry, that would be). */
  announced: string[];
  /** True when the limit stopped the run before the queries were done. */
  limited: boolean;
};

/** Run `queries` in turn, announcing a fact for each file they find that is not passed over. */
export const scanStale = async (cmd: Command, scan: StaleScan, queries: StaleQuery[]): Promise<StaleScanResult> => {
  const roots = await processingRoots(cmd.sys.vfs);
  const result: StaleScanResult = { examined: 0, announced: [], limited: false };
  const seen = new Set<string>();
  const events = scan.dry ? undefined : await cmd.sys.vfs.open(cmd.access, EVENTS_NODE_PATH, { mode: 'a' });
  const encoder = new TextEncoder();

  /** Announce the file at `path` unless it is passed over. False once the run is at its limit. */
  const consider = async (path: string, node: { id: string; attrs: Record<string, unknown> }, data: Record<string, string>): Promise<boolean> => {
    if (seen.has(path)) return true;
    seen.add(path);
    result.examined++;
    if (scan.skip?.has(path) || isTrashPath(path) || !(Number(node.attrs.size ?? 0) > 0)) return true;
    if ((scan.admits && !scan.admits(path)) || !wantsProcessing(roots, path, scan.families)) return true;
    if (MEDIA_MIMETYPE.test(String(node.attrs.mimetype ?? ''))) {
      const exif = await cmd.sys.vfs.get(cmd.access, `${path}/metadata/exif`).catch(() => undefined);
      if (!exif?.attrs.indexedAt) return true;
    }
    if (scan.limit > 0 && result.announced.length >= scan.limit) {
      result.limited = true;
      return false;
    }

    const fact: DomainEvent = {
      id: ulid(),
      type: scan.fact,
      subject: path,
      nodeId: node.id,
      time: Date.now(),
      source: scan.source,
      lane: 'bulk',
      data: { mimetype: String(node.attrs.mimetype ?? ''), ...data },
    };
    if (events) await events.write(encoder.encode(JSON.stringify(fact) + '\n'));
    result.announced.push(path);
    if (scan.verbose && !cmd.json) await cmd.writeLn(`${fact.type} ${path}`);
    return true;
  };

  try {
    for (const query of queries) {
      let after: { value: string | null; id: string } | undefined;
      do {
        const page = await cmd.sys.vfs.query(cmd.access, {
          types: ['file'],
          where: [...query.where, { ref: 'sourceId', op: 'missing' }, { ref: UNDECODABLE_ATTR, op: 'missing' }],
          ...(scan.root === '/' ? {} : { within: scan.root }),
          notWithin: NOT_MEDIA,
          after,
          limit: PAGE,
        });
        for (const hit of page) {
          const data = query.data(hit.node.attrs);
          if (data !== undefined && !await consider(hit.absPath, hit.node, data)) return result;
        }
        after = page.length === PAGE ? { value: page[page.length - 1].sortValue, id: page[page.length - 1].id } : undefined;
      } while (after);
    }
  } finally {
    await events?.close();
  }
  return result;
};
