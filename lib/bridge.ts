/**
 * A bridge: a durable queue bound to the VFS routing keys a module's rules care about, whose
 * mutations it turns into the module's domain facts on /dev/events, for the pipeline engine to
 * trigger on. The media module's `media-bridge` runs one for the file facts, and another module's
 * bridge runs its own rules the same way.
 *
 * Delivery is at-least-once end to end: a message is acked only after its facts are published, and
 * a duplicate fact is absorbed by the pipeline's `skipIf` and the one-instance-per-node rule.
 *
 * `concurrency` consumers compete on the one queue, the shape the pipeline engine uses. A queue
 * handle allows a single unacked entry, so concurrency is N handles on the one subscription rather
 * than a faster loop — and since a message costs a claim, a few node reads, a publish and an ack,
 * all of them round trips, that is the part which parallelises. Messages are therefore consumed out
 * of order, which rules that read the node fresh tolerate.
 */

import type { CmdReturn, Command, DomainEvent, ResourceHandleIf } from '@ein/client';
import { EVENTS_NODE_PATH } from '@ein/client';
import { ulid } from '@std/ulid/ulid';
import type { NodeSnapshot, VfsEventInput } from '@media/file-rules';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type BridgeOptions = {
  /** The command's name, for what it writes. */
  name: string;
  /** The queue node, created when missing and bound to `routingKeys`. */
  queuePath: string;
  routingKeys: string[];
  /** Consumers on the one queue. */
  concurrency: number;
  /** The facts one mutation reveals. */
  derive: (event: VfsEventInput) => Promise<Omit<DomainEvent, 'id'>[]>;
};

/** A node read as a rule sees it, or undefined when it cannot be read. */
export const readNode = async (cmd: Command, path: string): Promise<NodeSnapshot | undefined> => {
  try {
    const node = await cmd.sys.vfs.get(cmd.access, path);
    return {
      id: node.id,
      type: node.type,
      attrs: node.attrs as Record<string, unknown>,
      modtime: typeof node.props.modtime === 'number' ? node.props.modtime : undefined,
    };
  } catch {
    return undefined;
  }
};

/** Whether `path` exists, false when it cannot be asked. */
export const nodeExists = async (cmd: Command, path: string): Promise<boolean> => {
  try {
    return await cmd.sys.vfs.exists(cmd.access, path);
  } catch {
    return false;
  }
};

/**
 * Run a bridge until the command is interrupted. Non-zero when a consumer died, so a service's
 * `on-failure` policy restarts it: exiting 0 would leave it looking healthy while the pipelines are
 * deaf to whatever share of the queue that consumer would have taken.
 */
export const runBridge = async (cmd: Command, options: BridgeOptions): Promise<Awaited<CmdReturn>> => {
  const { name, queuePath, routingKeys, derive } = options;
  const concurrency = Math.max(1, options.concurrency);
  const queueDir = queuePath.slice(0, queuePath.lastIndexOf('/'));
  const queueName = queuePath.slice(queuePath.lastIndexOf('/') + 1);

  // The queue directory's own parent, not the root: with the queues under /var, pinning it to '/'
  // put a stray /queues beside the real one.
  await cmd.sys.vfs.ensure(cmd.access, 'directory', queueDir.slice(0, queueDir.lastIndexOf('/')) || '/', queueDir.slice(queueDir.lastIndexOf('/') + 1));
  await cmd.sys.vfs.ensure(cmd.access, 'queue', queueDir, queueName, { attrs: { routingKeys } });
  // Re-bind in case the rule set changed since the queue node was created.
  await cmd.sys.vfs.update(cmd.access, queuePath, { attrs: { routingKeys } });

  const abort = new AbortController();
  let running = true;
  cmd.onInterrupt(() => {
    running = false;
    abort.abort();
  });

  /** Pause between consume retries, resolving early when the bridge is stopping. */
  const backoff = (ms = 1000): Promise<void> =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      abort.signal.addEventListener('abort', done, { once: true });
    });

  // Both tracked as they open, not gathered at the end: a failure partway through still leaves the
  // successful ones for the shutdown path to close.
  const queues: ResourceHandleIf[] = [];
  const opened: ResourceHandleIf[] = [];
  let derived = 0;
  let failures = 0;

  const consumeLoop = async (queue: ResourceHandleIf, events: ResourceHandleIf): Promise<void> => {
    while (running) {
      let event: VfsEventInput;
      try {
        const bytes = await queue.read(1, abort.signal);
        if (bytes.length === 0) {
          // Empty means aborted or closed — unless still running, in which case it is a transient
          // blip the queue could not ride out. Backing off rather than returning: a return exits 0,
          // and the service's `on-failure` restart would leave the bridge looking healthy and deaf.
          if (!running || abort.signal.aborted) break;
          await cmd.writeError(`${name}: empty queue read while running, retrying\n`);
          await backoff();
          continue;
        }
        event = JSON.parse(decoder.decode(bytes)) as VfsEventInput;
      } catch (error) {
        if (!running || abort.signal.aborted) break;
        await cmd.writeError(`${name}: failed to read queue: ${error}\n`);
        // Backed off, not retried at once: a read that keeps throwing — a closed handle, a store that
        // is down — would otherwise spin a core and write an error line per iteration.
        await backoff();
        continue;
      }

      try {
        for (const fact of await derive(event)) {
          await events.write(encoder.encode(JSON.stringify({ id: ulid(), ...fact }) + '\n'));
          derived++;
        }
        // Ack only once the facts are out, so a crash mid-derive redelivers.
        await queue.write(encoder.encode('ack\n'));
      } catch (error) {
        await cmd.writeError(`${name}: ${event.path}: ${error}\n`);
        try {
          await queue.write(encoder.encode('nack\n'));
        } catch { /* the queue is going away with us */ }
      }
    }
  };

  try {
    for (let i = 0; i < concurrency; i++) {
      const queue = await cmd.sys.vfs.open(cmd.access, queuePath, { mode: 'r+' });
      queues.push(queue);
      opened.push(queue);
    }
    // One append handle for all consumers. Safe to share: the router node's write decodes the buffer
    // it was handed and publishes each line, holding no state between calls.
    const events = await cmd.sys.vfs.open(cmd.access, EVENTS_NODE_PATH, { mode: 'a' });
    opened.push(events);

    await cmd.write(`${name} running (${queuePath}, ${concurrency} consumers)\n`);

    // allSettled, not all: one consumer throwing must not pull the handles out from under the others
    // mid-entry. Each rejection is reported and counted.
    const results = await Promise.allSettled(queues.map((queue) => consumeLoop(queue, events)));
    for (const result of results) {
      if (result.status === 'rejected') {
        failures++;
        await cmd.writeError(`${name}: consumer failed: ${result.reason}\n`);
      }
    }
  } finally {
    cmd.onInterrupt(null);
    // Closing a queue handle auto-nacks whatever that consumer still holds, so it is redelivered
    // rather than sitting locked until its lease lapses.
    await Promise.allSettled(opened.map((handle) => handle.close()));
  }

  await cmd.write(`${name} stopped (${derived} events emitted)\n`).catch(() => {});
  return failures > 0 ? 1 : 0;
};
