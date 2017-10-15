import {Message, VoiceChannel, TextChannel, User} from 'discord.js';
import {Plugin, command, onEvent} from 'knub';
import {JsonDB} from "../JsonDB"
import * as path from 'path';

import {balanceTeams} from "../teamBalancer";

import {IPlayer, ILobby} from "../interfaces";
import {shuffle, trimLines, reply} from "../util";
import {cmdPresets} from "../cmdPresets";
import {dataDir, paths} from "../paths";

const AsciiTable: any = require('ascii-table');

const lobbyFileDir = dataDir('lobbies');
const playerFileDir = dataDir('players');

const allowedRoles = ['dps', 'tank', 'support', 'flex'];

interface PlayerMapObj {
    [id: string]: IPlayer;
}

class RegistrationProgress {
    public battleTag: string = null;
    public regions: string[] = null;
    public sr: number = null;
    public roles: string[] = null;
    public voice: boolean = null;
}

export class LobbyPlugin extends Plugin {
    protected lobbyDB: JsonDB;
    protected lobbies: ILobby[];

    protected playerDB: JsonDB;
    protected players: PlayerMapObj;

    protected playerRegistrations: Map<string, RegistrationProgress>;

    async onLoad() {
        this.lobbyDB = new JsonDB(path.join(lobbyFileDir, `${this.guildId}.json`), []);
        this.lobbies = await this.lobbyDB.get();

        this.playerDB = new JsonDB(path.join(playerFileDir, `${this.guildId}.json`), {});
        this.players = await this.playerDB.get();

        this.playerRegistrations = new Map();
    }

    /**
     * Create a new lobby
     */
    @command('createlobby', '<lobbyName:string>', cmdPresets.host)
    async createLobbyCmd(msg: Message, args: any) {
        const name = args.lobbyName;

        const hasExistingLobby = this.lobbies.some(lobby => lobby.name === name);
        if (hasExistingLobby) {
            reply(msg, 'A lobby with that name already exists!');
            return;
        }

        const categoryId = await this.pluginConfig.get('vc_category_id');

        const createVC = async (name: string) => {
            // FIXME: Remove <any> cast once djs updates typings
            const channel = await msg.guild.createChannel(name, 'voice', <any>{
                bitrate: 96000,
                parent: categoryId || undefined
            });

            return channel;
        };

        const channels: (VoiceChannel | TextChannel)[] = [];
        channels.push(await createVC(`${name} - Lobby`));
        channels.push(await createVC(`${name} - Team 1`));
        channels.push(await createVC(`${name} - Team 2`));

        const lobby: ILobby = {
            owner: msg.author.id,
            name,
            voiceChannels: channels.map(c => c.id),
            size: 12,
            players: []
        };

        this.lobbies.push(lobby);
        this.lobbyDB.save();

        reply(msg, `Lobby "${name}" created! Type \`!join ${name}\` to join`);
    }

    /**
     * Close a previously created lobby
     */
    @command('closelobby', '[lobbyName:string]', cmdPresets.host)
    async closeLobbyCmd(msg: Message, args: any) {
        let lobby;

        if (args.lobbyName) {
            lobby = this.findLobbyByName(args.lobbyName);
        } else {
            // If there is just 1 open lobby, don't require specifying the lobby name
            if (this.lobbies.length === 0) {
                reply(msg, 'There are no open lobbies to close!');
                return;
            } else if (this.lobbies.length > 0) {
                reply(msg, 'There are more than 1 open lobby. Please specify which one to close.');
                return;
            }

            lobby = this.lobbies[0];
        }

        if (!lobby) {
            reply(msg, 'Lobby not found!');
            return;
        }

        await Promise.all(lobby.voiceChannels.map(async voiceChannelId => {
            const channel = msg.guild.channels.get(voiceChannelId);
            if (channel) {
                await channel.delete();
            }
        }));

        this.lobbies.splice(this.lobbies.indexOf(lobby), 1);
        this.lobbyDB.save();

        reply(msg, `lobby "${lobby.name}" closed!`);
    }

    /**
     * Join a lobby
     */
    @command('join', '[lobbyName:string]')
    async joinLobbyCmd(msg: Message, args: any) {
        let lobby;

        if (args.lobbyName) {
            lobby = this.findLobbyByName(args.lobbyName);
        } else {
            // If there is just 1 open lobby, don't require specifying the lobby name
            if (this.lobbies.length === 0) {
                reply(msg, 'There are no open lobbies to join!');
                return;
            } else if (this.lobbies.length > 0) {
                reply(msg, 'There are more than 1 open lobby. Please specify which one to join.');
                return;
            }

            lobby = this.lobbies[0];
        }

        if (!lobby) {
            reply(msg, `That lobby isn't open right now!`);
            return;
        }

        if (lobby.players.includes(msg.author.id)) {
            reply(msg, `You're already in that lobby!`);
            return;
        }

        const currentLobby = this.lobbies.find(lobby => lobby.players.includes(msg.author.id));
        if (currentLobby) {
            this.leaveLobby(currentLobby, msg.author);
        }

        this.joinLobby(lobby, msg.author);
        reply(msg, `Joined ${lobby.name}`);
    }

    /**
     * Leave your current lobby. The lobbyName arg is unused, but allowed because people may type it anyway.
     */
    @command('leave', '[lobbyName:string]')
    async leaveLobbyCmd(msg: Message, args: any) {
        const lobby = this.lobbies.find(lobby => lobby.players.includes(msg.author.id));

        if (!lobby) {
            reply(msg, `You're not in a lobby!`);
            return;
        }

        this.leaveLobby(lobby, msg.author);
        reply(msg, `Left ${lobby.name}`);
    }

    /**
     * Remove a player from the specified lobby
     */
    @command('lobbykick', '<user:User> [lobbyName:string]', cmdPresets.host)
    async kickCmd(msg: Message, args: any) {
        let lobby;

        if (args.lobbyName) {
            lobby = this.findLobbyByName(args.lobbyName);
        } else {
            // If there is just 1 open lobby, don't require specifying the lobby name
            if (this.lobbies.length === 0) {
                reply(msg, 'There are no open lobbies to kick from!');
                return;
            } else if (this.lobbies.length > 0) {
                reply(msg, 'There are more than 1 open lobby. Please specify which one to kick the user from.');
                return;
            }

            lobby = this.lobbies[0];
        }

        if (!lobby) {
            reply(msg, `Lobby not found!`);
            return;
        }

        this.removeUserFromLobby(lobby, args.user);
        reply(msg, `${args.user.username} has been kicked from the lobby!`);
    }

    /**
     * List players in a lobby
     */
    @command('lobbyplayers', '<lobbyName:string>')
    async lobbyPlayersCmd(msg: Message, args: any) {
        const lobby = this.findLobbyByName(args.name);

        if (!lobby) {
            reply(msg, `Lobby not found!`);
            return;
        }

        const members = lobby.players.map(id => msg.guild.members.get(id));
        const names = members.map(member => member.nickname || member.user.username);

        reply(msg, `The lobby has ${lobby.players.length} players:\n${names.join(', ')}`);
    }

    @command('balance', '<lobbyName:string>', cmdPresets.host)
    async balanceCmd(msg: Message, args: any) {
        const lobby = this.findLobbyByName(args.lobbyName);

        if (!lobby) {
            reply(msg, 'Lobby not found!');
            return;
        }

        const unregisteredPlayers = lobby.players.filter(id => !this.players[id]);
        if (unregisteredPlayers.length > 0) {
            const members = unregisteredPlayers.map(id => msg.guild.members.get(id));
            const names = members.map(m => m ? m.nickname || m.user.username : '?');

            reply(msg, `The following players are still completing their registration:\n${names.join(', ')}`);
            return;
        }

        const lobbyPlayers: IPlayer[] = lobby.players.map(id => this.players[id]);
        shuffle(lobbyPlayers);

        const teams = balanceTeams(lobbyPlayers.slice(0, 12));
        const tables = teams.map((team, i) => {
            const table = new AsciiTable();

            team.players.forEach(player => {
                table.addRow(player.battleTag, player.assignedRole, player.voice ? '🔊' : '');
            });

            return table;
        });

        for (const [i, table] of tables.entries()) {
            await msg.channel.send(`** ${lobby.name} - Team ${i + 1}**\n` + '```' + table.toString() + '```');
        }
    }

    /**
     * Registration
     */
    @command('register')
    async registerCmd(msg: Message, args: any) {
        let channel = msg.author.dmChannel;
        if (!channel) {
            channel = await msg.author.createDM();
        }

        this.registrationStep(msg.author, null, true);
        msg.delete();
    }

    @command('autoregister', [], cmdPresets.admin)
    async autoRegisterCmd(msg: Message, args: any) {
        const registeredRole = await this.pluginConfig.get('registered_role');
        if (! registeredRole) return;

        reply(msg, 'Adding the Registered role to all previously registered users...');

        const guild = this.bot.guilds.get(this.guildId);
        const userIds = Object.keys(this.players);
        let added = 0;

        for (const userId of userIds) {
            const member = guild.members.get(userId);
            if (! member) continue;
            if (member.roles.has(registeredRole)) continue;

            await member.addRole(registeredRole);
            added++;
        }

        reply(msg, `Added the role to ${added} members!`);
    }

    @onEvent('message', 'dm')
    async onDirectMessage(msg: Message) {
        this.registrationStep(msg.author, msg);
    }

    /**
     * Player info
     */
    @command('player', '<user:User>', cmdPresets.host)
    async playerCmd(msg: Message, args: {user: User}) {
        const player = this.players[args.user.id];
        if (!player) {
            reply(msg, `Player hasn't registered yet!`);
            return;
        }

        const tableValues = new Map();
        tableValues.set('Discord', `${args.user.username}#${args.user.discriminator}`);
        tableValues.set('BattleTag', player.battleTag);
        tableValues.set('SR', player.sr);
        tableValues.set('Voice', player.voice);

        let pairs = Array.from(tableValues.entries());
        const longestTitle = pairs.reduce((longest, pair) => Math.max(pair[0].length, longest), 0);
        const tableRows = pairs.map(pair => {
            const title = (<string>pair[0]).padStart(longestTitle, ' ');
            return `${title}: ${pair[1]}`;
        });

        const message = '```' + tableRows.join('\n') + '```';
        msg.channel.send(message);
    }

    protected findLobbyByName(name: string): ILobby {
        return this.lobbies.find(lobby => lobby.name.toLowerCase() === name.toLowerCase());
    }

    protected getLobbiesByOwnerId(id: string): ILobby[] {
        return this.lobbies.filter(lobby => lobby.owner === id);
    }

    protected joinLobby(lobby: ILobby, user: User) {
        lobby.players.push(user.id);

        if (!this.players[user.id]) {
            // If the user is not yet registered, start their registration
            this.registrationStep(user, null, true);
        }

        this.lobbyDB.save();
    };

    protected leaveLobby(lobby: ILobby, user: User) {
        lobby.players.splice(lobby.players.indexOf(user.id), 1);
        this.lobbyDB.save();
    }

    protected removeUserFromLobby(lobby: ILobby, user: User) {
        lobby.players.splice(lobby.players.indexOf(user.id), 1);
    }

    protected async registrationStep(user: User, msg: Message, allowStart = false) {
        // Get or create a DM channel for this user
        let channel = user.dmChannel;
        if (!channel) {
            channel = await user.createDM();
        }

        let content = (msg && msg.cleanContent ? msg.cleanContent : '');
        content = content.trim();

        const progress = this.playerRegistrations.get(user.id);

        // No progress, not allowed to start a new registration -> ignore
        if (!progress && !allowStart) return;

        // Progress, but no message to continue with -> ignore
        if (progress && content === '') return;

        const regionRoles = await this.pluginConfig.get('regions');
        const validRegions = Object.keys(regionRoles);

        // Start registration
        if (!progress) {
            const regionRolesCapitalized = validRegions.map(r => `**${r.toUpperCase()}**`);

            channel.send(trimLines(`
                Before you can participate in PUGs, we need a little bit of information about you.
                
                To start off, which regions would you like to play in?
                You will also get alerts for PUGs in the regions you choose.
                
                Available options: ${regionRolesCapitalized.join(', ')}, **None**
            `));

            this.playerRegistrations.set(user.id, new RegistrationProgress());
        }

        // Ask for regions
        else if (!progress.regions) {
            if (content.toLowerCase() === 'none') {
                progress.regions = [];
            } else {
                let regions = content
                    .replace(/,/g, ' ')
                    .replace(/\sand\s/g, ' ')
                    .toLowerCase()
                    .split(/\s+/g);

                regions = regions.filter(region => validRegions.includes(region));
                if (regions.length === 0) {
                    reply(msg, 'No valid regions specified! Please try again.');
                    return;
                }

                progress.regions = regions;
            }

            reply(msg, 'Ok. And what is your BattleTag?');
        }

        // Ask for BattleTag
        else if (!progress.battleTag) {
            if (!content.match(/^[^#]+#[0-9]+$/)) {
                reply(msg, 'Invalid BattleTag! Use the format Name#1234 (not that this is *not* your Discord username).');
                return;
            }

            progress.battleTag = content;
            reply(msg, 'Ok. What is your current SR? Reply `unranked` if unranked.');
        }

        // Ask for SR
        else if (progress.sr == null) {
            if (!content.match(/^[0-9]+$/) && content !== 'unranked') {
                reply(msg, 'Invalid SR!');
                return;
            }

            const sr = (content === 'unranked' ? 0 : parseInt(content, 10));
            if (sr > 5000) {
                reply(msg, 'Very funny.');
                return;
            }

            progress.sr = sr;
            reply(msg, trimLines(`
                Ok. Which roles would you prefer to play?
                Available options: **DPS**, **Tank**, **Support**
                You can also reply **Flex** or **Any** if you're fine with any role.
            `));
        }

        // Ask for roles
        else if (!progress.roles) {
            let roles = content.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
            roles = roles.filter(role => role !== '' && role !== 'and');
            roles = roles.map(role => role.toLowerCase());

            const invalidRole = roles.find(role => !allowedRoles.includes(role));
            if (invalidRole) {
                reply(msg, `${invalidRole} is not a valid role`);
                return;
            }

            if (roles.includes('flex') || roles.includes('any')) {
                roles = ['dps', 'tank', 'support'];
            }

            progress.roles = roles;

            reply(msg, 'Ok. Finally, are you going to use voice chat while playing?');
        }

        // Ask for voice status
        else if (progress.voice == null) {
            const firstChar = content.toLowerCase()[0];
            if (firstChar === 'y') {
                progress.voice = true;
            } else {
                progress.voice = false;
            }

            this.completeRegistration(user);
        }
    }

    protected async completeRegistration(user: User) {
        let channel = user.dmChannel;
        if (!channel) {
            channel = await user.createDM();
        }

        const progress = this.playerRegistrations.get(user.id);

        this.players[user.id] = {
            id: user.id,
            regions: progress.regions,
            battleTag: progress.battleTag,
            sr: progress.sr,
            roles: progress.roles,
            voice: progress.voice
        };

        const regionRoles = await this.pluginConfig.get('regions');
        const registeredRole = await this.pluginConfig.get('registered_role');

        const guild = this.bot.guilds.get(this.guildId);
        const member = guild.members.get(user.id);

        // Remove any region roles that weren't selected above that the member has
        const rolesToRemove = Object.keys(regionRoles)
            .filter(roleName => !progress.regions.includes(roleName))
            .map(name => regionRoles[name])
            .filter(id => member.roles.has(id));

        if (rolesToRemove.length) {
            member.removeRoles(rolesToRemove, 'Registered: remove extra roles');
        }

        // Add selected region roles that the member doesn't have yet
        let rolesToAdd = progress.regions
            .map(r => regionRoles[r])
            .filter(id => id != null)
            .filter(id => !member.roles.has(id));

        if (registeredRole && !member.roles.has(registeredRole)) {
            rolesToAdd.push(registeredRole);
        }

        if (rolesToAdd.length > 0) {
            await member.addRoles(rolesToAdd, 'Registered: add roles');
        }

        channel.send('Registration complete! You can now play in PUGs.');
        this.playerDB.save();
        this.playerRegistrations.delete(user.id);
    }
}