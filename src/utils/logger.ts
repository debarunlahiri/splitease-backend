function line(level: string, message: string): string {
    return `${new Date().toISOString()} ${level.padStart(5)} ${message}`;
}

export const logger = {
    info(message: string): void {
        console.log(line('INFO', message));
    },
    warn(message: string): void {
        console.warn(line('WARN', message));
    },
    error(message: string, error?: unknown): void {
        console.error(line('ERROR', message));
        if (error !== undefined) console.error(error);
    },
};
