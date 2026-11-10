import { config, validateConfig } from './config';
import { createApp } from './app';
import { pool } from './database';
import { logger } from './utils/logger';
import { startOutboxDispatcher, stopOutboxDispatcher } from './events/outbox';
import { migrate } from './database/migrate';
import {
    registerNotificationConsumers,
    startPushDispatcher,
    stopPushDispatcher,
} from './services/notification.service';
import {
    mailEnabled,
    registerMailConsumers,
    startMailDispatcher,
    stopMailDispatcher,
    verifyMailConnection,
} from './services/mail.service';
import { registerBalanceProjection } from './services/settlement.service';

async function main(): Promise<void> {
    validateConfig();
    if (config.database.autoMigrate) await migrate();

    // In-process consumers of the outbox (these were Kafka listeners).
    registerBalanceProjection();
    registerNotificationConsumers();
    registerMailConsumers();
    if (!mailEnabled()) {
        logger.warn('SMTP is not configured: emails will be written to the log instead of sent');
    }
    startOutboxDispatcher();
    startPushDispatcher();
    startMailDispatcher();
    void verifyMailConnection();

    const server = createApp().listen(config.port, () => {
        logger.info(`SplitEase backend listening on port ${config.port}`);
    });

    let shuttingDown = false;
    const shutdown = (signal: string) => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`${signal} received, shutting down`);
        stopOutboxDispatcher();
        stopPushDispatcher();
        stopMailDispatcher();
        server.close(() => {
            pool.end().finally(() => process.exit(0));
        });
        // Keep-alive connections would otherwise delay the exit (and every dev restart).
        server.closeIdleConnections();
        // Do not wait forever for open connections.
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
    if ((error as { code?: unknown } | null)?.code === 'ECONNREFUSED') {
        // Show where we tried to connect, without the credentials.
        let target = 'the configured database';
        try {
            const url = new URL(config.database.url);
            target = `${url.hostname}:${url.port || 5432}${url.pathname}`;
        } catch {
            // DATABASE_URL is not a valid URL; the original error below says more.
        }
        logger.error(
            `Cannot reach PostgreSQL at ${target}. Start the database, or fix DATABASE_URL in .env.`,
        );
    }
    logger.error('Startup failed', error);
    process.exit(1);
});
