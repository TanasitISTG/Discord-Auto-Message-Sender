import inquirer from 'inquirer';
import chalk from 'chalk';
import { startWizard } from './cli/wizard';
import { loadConfig, loadMessages } from './config/manager';
import { startChannelWorker } from './core/worker';

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--configure')) {
        await startWizard();
    }

    const config = loadConfig();
    if (!config) {
        console.log(chalk.red('Configuration not found. Run with --configure'));
        process.exit(1);
    }
    const messages = loadMessages();

    console.log(chalk.bold(`\n--- Node.js Auto Sender ---\n`));
    console.log(`Loaded ${config.channels.length} channels.`);
    console.log(`Loaded groups: ${Object.keys(messages).join(', ')}`);

    const answers = await inquirer.prompt([
        { type: 'number', name: 'num_msgs', message: 'Messages to send (0 = Infinite):', default: 0 },
        { type: 'number', name: 'wait_time', message: 'Base wait time (seconds):', default: 5 },
        { type: 'number', name: 'margin', message: 'Random error margin (seconds):', default: 2 }
    ]);

    const promises = config.channels.map(channel =>
        startChannelWorker(channel, answers.num_msgs, answers.wait_time, answers.margin, config, messages)
    );

    await Promise.all(promises);
    console.log('\nSession Complete.');
}

main().catch(console.error);
