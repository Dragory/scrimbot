import {Message} from "discord.js";
import {Plugin, command} from "knub";
import {cmdPresets} from "../cmdPresets";
import {reply} from "../util";
import * as child_process from 'child_process';
import {errorEmbed} from "knub/dist/utils";

export class UtilityPlugin extends Plugin {
    getDefaultPermissions() {
        return cmdPresets.mod.permissions;
    }

    /**
     * List roles and their IDs
     */
    @command('roles')
    async rolesCmd(msg: Message) {
        const lines = msg.guild.roles.map(role => `${role.id} - ${role.name}`);
        msg.channel.send(lines.join('\n'), {
            disableEveryone: true
        });
    }

    /**
     * Restart & update
     */
    @command(/^(?:update|restart)$/, [])
    async updateCmd(msg: Message) {
        const updateCmd = await this.pluginConfig.get('update_cmd');
        if (!updateCmd) {
            reply(msg, 'No update command specified!');
            return;
        }

        reply(msg, 'Updating...');

        const updater = child_process.exec(updateCmd, {cwd: process.cwd()});
        updater.stderr.on('data', data => {
            console.error(data);
        });
    }

    /**
     * Reload this guild's plugins/config
     */
    @command('reload')
    async reloadCmd(msg: Message) {
        reply(msg, 'Reloading...');
        this.parent.reloadGuild(this.guildId);
    }
}