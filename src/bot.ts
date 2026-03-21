import path from 'path';
import dotenv from 'dotenv';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { startWizard } from './cli/wizard';
import { DEFAULT_CONFIG_BASE_DIR, readAppConfigResult } from './config/store';
import { formatZodError, parseEnvironment, parseRuntimeOptions } from './config/schema';
import { createSenderCoordinator, runChannel } from './core/sender';

dotenv.config({ path: path.join(DEFAULT_CONFIG_BASE_DIR, '.env') });

function validateRuntimeNumberInput(label: string, options: { integer?: boolean } = {}) {
    return (value: string) => {
        if (value.trim().length === 0) {
            return `${label} is required.`;
        }

        const numericValue = Number(value);
        if (!Number.isFinite(numericValue)) {
            return `${label} must be a valid number.`;
        }

        if (options.integer && !Number.isInteger(numericValue)) {
            return `${label} must be a whole number.`;
        }

        if (numericValue < 0) {
            return `${label} must be zero or greater.`;
        }

        return true;
    };
}

async function promptRuntimeOptions() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'numMessages',
            message: 'Messages to send per channel (0 = infinite):',
            default: '0',
            validate: validateRuntimeNumberInput('Number of messages', { integer: true })
        },
        {
            type: 'input',
            name: 'baseWaitSeconds',
            message: 'Base wait time in seconds:',
            default: '5',
            validate: validateRuntimeNumberInput('Base wait time')
        },
        {
            type: 'input',
            name: 'marginSeconds',
            message: 'Random margin in seconds:',
            default: '2',
            validate: validateRuntimeNumberInput('Random margin')
        }
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

    const configResult = readAppConfigResult();
    if (configResult.kind === 'invalid') {
        throw new Error(configResult.error);
    }

    if (configResult.kind === 'missing') {
        throw new Error('Configuration not found. Review config.json or run with --configure.');
    }

    const config = configResult.config;
    if (config.channels.length === 0) {
        throw new Error('At least one channel must be configured before starting.');
    }

    console.log(chalk.bold(`\n--- Discord Auto Sender ---\n`));
    console.log(`Loaded ${config.channels.length} channels.`);
    console.log(`Loaded groups: ${Object.keys(config.messageGroups).join(', ')}`);

    const runtime = await promptRuntimeOptions();
    const coordinator = createSenderCoordinator();
    await Promise.all(config.channels.map((target) => runChannel({
        target,
        numMessages: runtime.numMessages,
        baseWaitSeconds: runtime.baseWaitSeconds,
        marginSeconds: runtime.marginSeconds,
        token: env.DISCORD_TOKEN,
        userAgent: config.userAgent,
        messageGroups: config.messageGroups,
        coordinator
    })));

    if (coordinator.isAborted()) {
        throw new Error(coordinator.getAbortReason() ?? 'Sending aborted.');
    }

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
