import inquirer from 'inquirer';
import chalk from 'chalk';
import { Config, Messages } from '../types';
import { loadConfig, loadMessages, saveConfig, saveMessages } from '../config/manager';

async function configureAuth(current: Config) {
    console.log(chalk.cyan('\n--- Edit Authentication ---'));
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'user_agent',
            message: 'User Agent:',
            default: current.user_agent
        },
        {
            type: 'input',
            name: 'discord_token',
            message: 'Discord Token:',
            default: current.discord_token
        }
    ]);
    current.user_agent = answers.user_agent;
    current.discord_token = answers.discord_token;
    saveConfig(current);
    console.log(chalk.green('Authentication saved!'));
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
            current.channels.forEach(c => console.log(chalk.gray(`- ${c.name} (${c.id}) [Group: ${c.message_group || 'default'}]`)));
        }
        else if (action === 'Add Channel') {
            const chan = await inquirer.prompt([
                { type: 'input', name: 'referrer', message: 'Channel URL (Reference):' },
                { type: 'input', name: 'id', message: 'Channel ID:' },
                { type: 'input', name: 'message_group', message: 'Message Group:', default: 'default' }
            ]);
            current.channels.push({
                name: `Channel ${current.channels.length + 1}`,
                id: chan.id,
                referrer: chan.referrer,
                message_group: chan.message_group
            });
            saveConfig(current);
            console.log(chalk.green('Channel added!'));
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
                current.channels.forEach((c, i) => c.name = `Channel ${i + 1}`);
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
                msgs[name] = ["New Message"];
                saveMessages(msgs);
                console.log(chalk.green(`Group '${name}' created!`));
            } else {
                console.log(chalk.red('Invalid name or group already exists.'));
            }
        }
        else if (action === 'Edit Group Messages') {
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
                        msgs[group].push(text);
                        saveMessages(msgs);
                        console.log(chalk.green('Message added!'));
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
                        msgs[group] = msgs[group].filter((_, i) => !indices.includes(i));
                        saveMessages(msgs);
                        console.log(chalk.green('Messages deleted!'));
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

        const current = loadConfig() || { user_agent: '', discord_token: '', channels: [] };

        const { menu } = await inquirer.prompt([{
            type: 'list',
            name: 'menu',
            message: 'Main Menu:',
            choices: [
                'Start Bot',
                new inquirer.Separator(),
                'Edit Authentication',
                'Manage Channels',
                'Manage Messages',
                new inquirer.Separator(),
                'Exit'
            ]
        }]);

        if (menu === 'Start Bot') {
            if (!current.discord_token || current.channels.length === 0) {
                console.log(chalk.red('Error: You must configure Token and Channels first!'));
                // Pause so they see error
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            break;
        }
        else if (menu === 'Exit') process.exit(0);
        else if (menu === 'Edit Authentication') await configureAuth(current);
        else if (menu === 'Manage Channels') await configureChannels(current);
        else if (menu === 'Manage Messages') await configureMessages();
    }
    console.log(chalk.green('Starting bot...'));
}
