import {Message} from "discord.js";
import {Plugin, command} from "knub";
import {cmdPresets} from "../cmdPresets";

class UtilityPlugin extends Plugin {
    getDefaultPermissions() {
        return cmdPresets.admin.permissions;
    }

    /**
     * List roles and their IDs
     */
    @command('roles', [], cmdPresets.admin)
    async rolesCmd(msg: Message) {
        const lines = msg.guild.roles.map(role => `${role.id} - ${role.name}`);
        msg.channel.send(lines.join('\n'), {
            disableEveryone: true
        });
    }

    /**
     * Restart & update
     */
    @command(/^(?:update|restart)$/, [], cmdPresets.admin)
    async updateCmd() {
        // TODO
    }

    /**
     * Reload this guild's plugins/config
     */
    @command('reload', [], cmdPresets.admin)
    async reloadCmd(msg: Message) {
        msg.reply('Reloading...');
        this.parent.reloadGuild(this.guildId);
    }
}