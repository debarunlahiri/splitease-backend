import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { Db, tx } from '../database';
import { logger } from '../utils/logger';

type Handler = (db: Db, event: any) => Promise<void>;

interface Consumer {
    name: string;
    handle: Handler;
}

const consumers = new Map<string, Consumer[]>();

/** Subscribes an in-process consumer (what used to be a Kafka consumer group) to a topic. */
export function subscribe(topic: string, consumerName: string, handle: Handler): void {
    const list = consumers.get(topic) ?? [];
    list.push({ name: consumerName, handle });
    consumers.set(topic, list);
}

/** Records a domain event in the caller's transaction, so it commits with the business write. */
export async function appendEvent(
    db: Db,
    topic: string,
    eventType: string,
    eventKey: string,
    aggregateId: string,
    event: { eventId: string },
): Promise<void> {
    await db.query(
        `INSERT INTO outbox_events (id, aggregate_id, event_type, topic, event_key, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), aggregateId, eventType, topic, eventKey, JSON.stringify(event), new Date()],
    );
}

/**
 * Delivers the oldest pending event to every consumer of its topic and marks it
 * published, all in one transaction. Returns false when nothing is pending or another
 * instance is dispatching.
 */
async function deliverNext(): Promise<boolean> {
    return tx(async (db) => {
        // One dispatcher at a time keeps events in order across server instances.
        const lock = await db.query(
            "SELECT pg_try_advisory_xact_lock(hashtextextended('outbox-dispatcher', 0)) AS locked",
        );
        if (!lock.rows[0].locked) return false;
        const row = (
            await db.query(
                `SELECT id, topic, event_type, payload FROM outbox_events
                 WHERE published_at IS NULL ORDER BY created_at ASC, id ASC LIMIT 1`,
            )
        ).rows[0];
        if (!row) return false;
        const event = JSON.parse(row.payload);
        for (const consumer of consumers.get(row.topic) ?? []) {
            const first = await db.query(
                `INSERT INTO processed_events (consumer, event_id, event_type)
                 VALUES ($1, $2, $3) ON CONFLICT (consumer, event_id) DO NOTHING`,
                [consumer.name, event.eventId, row.event_type],
            );
            if (first.rowCount === 0) continue;
            await consumer.handle(db, event);
        }
        await db.query('UPDATE outbox_events SET published_at = $1 WHERE id = $2', [
            new Date(),
            row.id,
        ]);
        return true;
    });
}

let timer: NodeJS.Timeout | undefined;
let running = false;
let stopped = true;

async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
        for (let delivered = 0; delivered < 100 && !stopped; delivered++) {
            if (!(await deliverNext())) break;
        }
    } catch (error) {
        // The failed event stays pending and is retried on the next tick.
        logger.error('Could not deliver outbox event', error);
    } finally {
        running = false;
    }
}

export function startOutboxDispatcher(): void {
    stopped = false;
    const tick = () => {
        void drain().finally(() => {
            if (!stopped) timer = setTimeout(tick, config.outbox.publishDelayMs);
        });
    };
    timer = setTimeout(tick, config.outbox.publishDelayMs);
}

export function stopOutboxDispatcher(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
}
