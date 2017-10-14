import {Message} from "discord.js";
import {Plugin, command} from "knub";
import {cmdPresets} from "../cmdPresets";
import {reply} from "../util";

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
    async updateCmd() {
        // TODO
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