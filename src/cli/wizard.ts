import inquirer from 'inquirer';
import chalk from 'chalk';
import { ZodError } from 'zod';
import { Config } from '../types';
import { loadConfig, loadMessages, saveConfig, saveMessages } from '../config/manager';
import { formatZodError, parseConfig } from '../config/schema';

function getErrorMessage(error: unknown): string {
    if (error instanceof ZodError) {
        return formatZodError(error);
    }

    if (error instanceof Error) {
        return error.message;
    }

    return 'Unable to save changes.';
}

async function showBotTokenSetup() {
    console.log(chalk.cyan('\n--- Bot Token Setup ---'));
    console.log('1. Create a Discord application and bot in the Discord Developer Portal.');
    console.log('2. Copy `.env.example` to `.env`.');
    console.log('3. Set `DISCORD_BOT_TOKEN` in `.env` or your shell environment.');
    console.log('4. Invite the bot with at least `View Channels` and `Send Messages` permissions.');
    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to return to the menu:' }]);
}

async function configureChannels(current: Config) {
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

            current.channels.forEach(c => console.log(chalk.gray(`- ${c.name} (${c.id}) [Group: ${c.message_group || 'default'}]`)));
        }
        else if (action === 'Add Channel') {
            const chan = await inquirer.prompt([
                { type: 'input', name: 'name', message: 'Channel Name:', default: `Channel ${current.channels.length + 1}` },
                { type: 'input', name: 'id', message: 'Channel ID:' },
                { type: 'input', name: 'message_group', message: 'Message Group:', default: 'default' }
            ]);

            try {
                current.channels.push({
                    name: chan.name,
                    id: chan.id,
                    message_group: chan.message_group
                });
                saveConfig(current);
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
                current.channels = current.channels.filter((_, i) => !toRemove.includes(i));
                saveConfig(current);
                console.log(chalk.green('Channels removed!'));
            }
        }
    }
}

async function configureMessages() {
    while (true) {
        const msgs = loadMessages();
        const groups = Object.keys(msgs);
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
            groups.forEach(g => console.log(chalk.gray(`- ${g} (${msgs[g].length} messages)`)));
        }
        else if (action === 'Add New Group') {
            const { name } = await inquirer.prompt([{ type: 'input', name: 'name', message: 'Group Name:' }]);
            if (name && !msgs[name]) {
                try {
                    msgs[name] = ['New Message'];
                    saveMessages(msgs);
                    console.log(chalk.green(`Group '${name}' created!`));
                } catch (error) {
                    delete msgs[name];
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
                msgs[group].forEach((m, i) => console.log(chalk.gray(`${i + 1}. ${m}`)));

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
                            msgs[group].push(text);
                            saveMessages(msgs);
                            console.log(chalk.green('Message added!'));
                        } catch (error) {
                            msgs[group].pop();
                            console.log(chalk.red(getErrorMessage(error)));
                        }
                    }
                }
                else if (msgAction === 'Delete Message') {
                    const { indices } = await inquirer.prompt([{
                        type: 'checkbox',
                        name: 'indices',
                        message: 'Select messages to delete:',
                        choices: msgs[group].map((m, i) => ({ name: m, value: i }))
                    }]);

                    if (indices.length > 0) {
                        const updatedMessages = msgs[group].filter((_, i) => !indices.includes(i));
                        if (updatedMessages.length === 0) {
                            console.log(chalk.red('A group must contain at least one message.'));
                            continue;
                        }

                        try {
                            msgs[group] = updatedMessages;
                            saveMessages(msgs);
                            console.log(chalk.green('Messages deleted!'));
                        } catch (error) {
                            console.log(chalk.red(getErrorMessage(error)));
                        }
                    }
                }
            }
        }
    }
}

export async function startWizard() {
    while (true) {
        console.clear();
        console.log(chalk.bold.cyan('\n--- Configuration Wizard ---\n'));

        const current = loadConfig() || parseConfig({ channels: [] });

        const { menu } = await inquirer.prompt([{
            type: 'list',
            name: 'menu',
            message: 'Main Menu:',
            choices: [
                'Start Bot',
                new inquirer.Separator(),
                'Bot Token Setup',
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
            break;
        }
        else if (menu === 'Exit') process.exit(0);
        else if (menu === 'Bot Token Setup') await showBotTokenSetup();
        else if (menu === 'Manage Channels') await configureChannels(current);
        else if (menu === 'Manage Messages') await configureMessages();
    }
    console.log(chalk.green('Starting bot...'));
}
