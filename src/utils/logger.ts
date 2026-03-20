import chalk from 'chalk';

type LogColor = 'green' | 'red' | 'yellow' | 'blue' | 'cyan';
type LogMeta = Record<string, string | number | boolean | undefined>;

function formatMeta(meta?: LogMeta): string {
    if (!meta) {
        return '';
    }

    const pairs = Object.entries(meta)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`);

    return pairs.length > 0 ? ` ${chalk.gray(pairs.join(' '))}` : '';
}

export function log(context: string, message: string, color: LogColor = 'blue', meta?: LogMeta) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.gray(`[${timestamp}]`) + ` [${chalk[color](context)}] ${message}${formatMeta(meta)}`);
}
