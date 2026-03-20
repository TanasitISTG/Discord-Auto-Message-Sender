import inquirer from 'inquirer';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { AppConfig } from '../types';
import { readAppConfigResult, writeAppConfig } from '../config/store';
import { buildDefaultReferrer, createDefaultAppConfig, formatZodError } from '../config/schema';

function getErrorMessage(error: unknown): string {
    if (error instanceof ZodError) {
        return formatZodError(error);
    }

    if (error instanceof Error) {
        return error.message;
    }

    return 'Unable to save changes.';
}

async function showTokenSetup() {
    console.log(chalk.cyan('\n--- Token Setup ---'));
    console.log('1. Copy `.env.example` to `.env`.');
    console.log('2. Set `DISCORD_TOKEN` in `.env` or your shell environment.');
    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to return to the menu:' }]);
}

async function configureUserAgent(current: AppConfig) {
    const { userAgent } = await inquirer.prompt([{
        type: 'input',
        name: 'userAgent',
        message: 'User-Agent:',
        default: current.userAgent
    }]);

    const previousUserAgent = current.userAgent;
    current.userAgent = userAgent;

    try {
        writeAppConfig(current);
        console.log(chalk.green('User-Agent updated!'));
    } catch (error) {
        current.userAgent = previousUserAgent;
        console.log(chalk.red(getErrorMessage(error)));
    }
}

async function configureChannels(current: AppConfig) {
    while (true) {
        console.log(chalk.cyan(`\n--- Manage Channels (${current.channels.length}) ---`));
        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'Choose an action:',
            choices: [
                'List Channels',
                'Add Channel',
                'Remove Channel',
                'Back to Main Menu'
            ]
        }]);

        if (action === 'Back to Main Menu') break;

        if (action === 'List Channels') {
            if (current.channels.length === 0) {
                console.log(chalk.yellow('No channels configured.'));
                continue;
            }

            current.channels.forEach((channel) => console.log(chalk.gray(`- ${channel.name} (${channel.id}) [Group: ${channel.messageGroup}]`)));
        }
        else if (action === 'Add Channel') {
            const channel = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'Channel Name:', default: `Channel ${current.channels.length + 1}` },
                { type: 'input', name: 'id', message: 'Channel ID:' },
                { type: 'input', name: 'referrer', message: 'Referrer URL (optional):' },
                { type: 'input', name: 'messageGroup', message: 'Message Group:', default: 'default' }
            ]);

            try {
                current.channels.push({
                    name: channel.name,
                    id: channel.id,
                    referrer: channel.referrer || buildDefaultReferrer(channel.id),
                    messageGroup: channel.messageGroup
                });
                writeAppConfig(current);
                console.log(chalk.green('Channel added!'));
            } catch (error) {
                current.channels.pop();
                console.log(chalk.red(getErrorMessage(error)));
            }
        }
        else if (action === 'Remove Channel') {
            if (current.channels.length === 0) {
                console.log(chalk.yellow('No channels to remove.'));
                continue;
            }

            const { toRemove } = await inquirer.prompt([{
                type: 'checkbox',
                name: 'toRemove',
                message: 'Select channels to remove:',
                choices: current.channels.map((c, i) => ({ name: `${c.name} (${c.id})`, value: i }))
            }]);

            if (toRemove.length > 0) {
                const previousChannels = current.channels;
                current.channels = current.channels.filter((_, i) => !toRemove.includes(i));
                try {
                    writeAppConfig(current);
                    console.log(chalk.green('Channels removed!'));
                } catch (error) {
                    current.channels = previousChannels;
                    console.log(chalk.red(getErrorMessage(error)));
                }
            }
        }
    }
}

async function configureMessages(current: AppConfig) {
    while (true) {
        const groups = Object.keys(current.messageGroups);
        console.log(chalk.cyan(`\n--- Manage Messages (${groups.length} groups) ---`));

        const { action } = await inquirer.prompt([{
            type: 'list',
            name: 'action',
            message: 'Choose an action:',
            choices: [
                'List Groups',
                'Add New Group',
                'Edit Group Messages',
                'Back to Main Menu'
            ]
        }]);

        if (action === 'Back to Main Menu') break;

        if (action === 'List Groups') {
            groups.forEach((group) => console.log(chalk.gray(`- ${group} (${current.messageGroups[group].length} messages)`)));
        }
        else if (action === 'Add New Group') {
            const { name } = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Group Name:' }]);
            if (name && !current.messageGroups[name]) {
                try {
                    current.messageGroups[name] = ['New Message'];
                    writeAppConfig(current);
                    console.log(chalk.green(`Group '${name}' created!`));
                } catch (error) {
                    delete current.messageGroups[name];
                    console.log(chalk.red(getErrorMessage(error)));
                }
            } else {
                console.log(chalk.red('Invalid name or group already exists.'));
            }
        }
        else if (action === 'Edit Group Messages') {
            if (groups.length === 0) {
                console.log(chalk.yellow('No groups available to edit.'));
                continue;
            }

            const { group } = await inquirer.prompt([{
                type: 'list',
                name: 'group',
                message: 'Select Group:',
                choices: groups
            }]);

            while (true) {
                console.log(chalk.yellow(`\nEditing Group: ${group}`));
                current.messageGroups[group].forEach((message, i) => console.log(chalk.gray(`${i + 1}. ${message}`)));

                const { msgAction } = await inquirer.prompt([{
                    type: 'list',
                    name: 'msgAction',
                    message: 'Action:',
                    choices: ['Add Message', 'Delete Message', 'Back']
                }]);

                if (msgAction === 'Back') break;

                if (msgAction === 'Add Message') {
                    const { text } = await inquirer.prompt([{ type: 'input', name: 'text', message: 'Message content:' }]);
                    if (text) {
                        try {
                            current.messageGroups[group].push(text);
                            writeAppConfig(current);
                            console.log(chalk.green('Message added!'));
                        } catch (error) {
                            current.messageGroups[group].pop();
                            console.log(chalk.red(getErrorMessage(error)));
                        }
                    }
                }
                else if (msgAction === 'Delete Message') {
                    const { indices } = await inquirer.prompt([{
                        type: 'checkbox',
                        name: 'indices',
                        message: 'Select messages to delete:',
                        choices: current.messageGroups[group].map((message, i) => ({ name: message, value: i }))
                    }]);

                    if (indices.length > 0) {
                        const previousMessages = current.messageGroups[group];
                        const updatedMessages = current.messageGroups[group].filter((_, i) => !indices.includes(i));
                        if (updatedMessages.length === 0) {
                            console.log(chalk.red('A group must contain at least one message.'));
                            continue;
                        }

                        try {
                            current.messageGroups[group] = updatedMessages;
                            writeAppConfig(current);
                            console.log(chalk.green('Messages deleted!'));
                        } catch (error) {
                            current.messageGroups[group] = previousMessages;
                            console.log(chalk.red(getErrorMessage(error)));
                        }
                    }
                }
            }
        }
    }
}

export async function startWizard(): Promise<'start' | 'exit'> {
    const configResult = readAppConfigResult();
    if (configResult.kind === 'invalid') {
        throw new Error(configResult.error);
    }

    const current = configResult.kind === 'ok' ? configResult.config : createDefaultAppConfig();

    while (true) {
        console.clear();
        console.log(chalk.bold.cyan('\n--- Configuration Wizard ---\n'));

        const { menu } = await inquirer.prompt([{
            type: 'list',
            name: 'menu',
            message: 'Main Menu:',
            choices: [
                'Start Bot',
                new inquirer.Separator(),
                'Token Setup',
                'Edit User-Agent',
                'Manage Channels',
                'Manage Messages',
                new inquirer.Separator(),
                'Exit'
            ]
        }]);

        if (menu === 'Start Bot') {
            if (current.channels.length === 0) {
                console.log(chalk.red('Error: Configure at least one channel first.'));
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            return 'start';
        }
        else if (menu === 'Exit') return 'exit';
        else if (menu === 'Token Setup') await showTokenSetup();
        else if (menu === 'Edit User-Agent') await configureUserAgent(current);
        else if (menu === 'Manage Channels') await configureChannels(current);
        else if (menu === 'Manage Messages') await configureMessages(current);
    }
}
