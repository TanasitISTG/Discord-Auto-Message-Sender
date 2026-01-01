import chalk from 'chalk';

type LogColor = 'green' | 'red' | 'yellow' | 'blue' | 'cyan';

export function log(context: string, message: string, color: LogColor = 'blue') {
    const timestamp = new Date().toLocaleTimeString();
    console.log(chalk.gray(`[${timestamp}]`) + ` [${chalk[color](context)}] ${message}`);
}
