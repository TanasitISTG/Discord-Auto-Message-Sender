import 'dotenv/config';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { startWizard } from './cli/wizard';
import { loadConfig, loadMessages } from './config/manager';
import { formatZodError, getMissingMessageGroups, parseEnvironment, parseRuntimeOptions } from './config/schema';
import { buildChannelTargets } from './core/client';
import { startChannelWorker } from './core/worker';

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
        await startWizard();
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
        console.log(chalk.red(`Environment error: ${message}`));
        process.exit(1);
    }

    const config = loadConfig();
    if (!config) {
        console.log(chalk.red('Configuration not found or invalid. Copy config.example.json to config.json or run with --configure.'));
        process.exit(1);
    }
    const messages = loadMessages();
    if (Object.keys(messages).length === 0) {
        console.log(chalk.red('Messages configuration is missing or invalid. Review messages.json.'));
        process.exit(1);
    }

    if (config.channels.length === 0) {
        console.log(chalk.red('At least one channel must be configured before starting.'));
        process.exit(1);
    }

    const missingGroups = getMissingMessageGroups(config, messages);
    if (missingGroups.length > 0) {
        console.log(chalk.red(`Missing message groups referenced by config: ${missingGroups.join(', ')}`));
        process.exit(1);
    }

    console.log(chalk.bold(`\n--- Discord Auto Sender ---\n`));
    console.log(`Loaded ${config.channels.length} channels.`);
    console.log(`Loaded groups: ${Object.keys(messages).join(', ')}`);

    const runtime = await promptRuntimeOptions();
    const targets = buildChannelTargets(config.channels);

    const promises = targets.map(target =>
        startChannelWorker(
            target,
            runtime.numMessages,
            runtime.baseWaitSeconds,
            runtime.marginSeconds,
            env.DISCORD_TOKEN,
            config.user_agent,
            messages
        )
    );

    await Promise.all(promises);
    console.log('\nSession complete.');
}

main().catch((error: unknown) => {
    if (error instanceof Error) {
        console.error(chalk.red(error.message));
        process.exitCode = 1;
        return;
    }
    console.error(chalk.red('Unexpected failure.'));
    process.exitCode = 1;
});
