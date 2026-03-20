import 'dotenv/config';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { startWizard } from './cli/wizard';
import { readAppConfig } from './config/store';
import { formatZodError, parseEnvironment, parseRuntimeOptions } from './config/schema';
import { runChannel } from './core/sender';

async function promptRuntimeOptions() {
    const answers = await inquirer.prompt([
        { type: 'input', name: 'numMessages', message: 'Messages to send per channel (0 = infinite):', default: '0' },
        { type: 'input', name: 'baseWaitSeconds', message: 'Base wait time in seconds:', default: '5' },
        { type: 'input', name: 'marginSeconds', message: 'Random margin in seconds:', default: '2' }
    ]);

    try {
        return parseRuntimeOptions(answers);
    } catch (error) {
        if (error instanceof ZodError) {
            throw new Error(`Invalid runtime options: ${formatZodError(error)}`);
        }
        if (error instanceof Error) {
            throw new Error(`Invalid runtime options: ${error.message}`);
        }
        throw error;
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--configure')) {
        const wizardAction = await startWizard();
        if (wizardAction === 'exit') {
            return;
        }
    }

    let env;
    try {
        env = parseEnvironment(process.env);
    } catch (error) {
        const message = error instanceof ZodError
            ? formatZodError(error)
            : error instanceof Error
                ? error.message
                : 'Invalid environment configuration.';
        throw new Error(`Environment error: ${message}`);
    }

    const config = readAppConfig();
    if (!config) {
        throw new Error('Configuration not found or invalid. Review config.json or run with --configure.');
    }

    if (config.channels.length === 0) {
        throw new Error('At least one channel must be configured before starting.');
    }

    console.log(chalk.bold(`\n--- Discord Auto Sender ---\n`));
    console.log(`Loaded ${config.channels.length} channels.`);
    console.log(`Loaded groups: ${Object.keys(config.messageGroups).join(', ')}`);

    const runtime = await promptRuntimeOptions();
    await Promise.all(config.channels.map((target) => runChannel({
        target,
        numMessages: runtime.numMessages,
        baseWaitSeconds: runtime.baseWaitSeconds,
        marginSeconds: runtime.marginSeconds,
        token: env.DISCORD_TOKEN,
        userAgent: config.userAgent,
        messageGroups: config.messageGroups
    })));
    console.log('\nSession complete.');
}

main().catch((error: unknown) => {
    if (error instanceof ZodError) {
        console.error(chalk.red(`Configuration error: ${formatZodError(error)}`));
        process.exitCode = 1;
        return;
    }
    if (error instanceof Error) {
        console.error(chalk.red(error.message));
        process.exitCode = 1;
        return;
    }
    console.error(chalk.red('Unexpected failure.'));
    process.exitCode = 1;
});
