import {Message, VoiceChannel, TextChannel, User} from 'discord.js';
import {Plugin, command, onEvent} from 'knub';
import {JsonDB} from "../JsonDB"
import * as path from 'path';

import {balanceTeams} from "../teamBalancer";

import {IPlayer, ILobby} from "../interfaces";
import {shuffle, trimLines} from "../util";
import {cmdPresets} from "../cmdPresets";

const AsciiTable: any = require('ascii-table');

const lobbyFileDir = path.resolve(__dirname, '../data/lobbies');
const playerFileDir = path.resolve(__dirname, '../data/players');

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

        this.playerDB = new JsonDB(path.join(playerFileDir, `${this.guildId}.json`));
        this.players = await this.playerDB.get();

        this.playerRegistrations = new Map();
    }

    /**
     * Create a new lobby
     */
    @command('createlobby', '<lobbyName:string>', cmdPresets.admin)
    async createLobbyCmd(msg: Message, args: any) {
        const name = args.lobbyName;

        const hasExistingLobby = this.lobbies.some(lobby => lobby.name === name);
        if (hasExistingLobby) {
            msg.reply('a lobby with that name already exists!');
            return;
        }

        const channels: (VoiceChannel | TextChannel)[] = [];
        channels.push(await msg.guild.createChannel(`${name} - Lobby`, 'voice'));
        channels.push(await msg.guild.createChannel(`${name} - Team 1`, 'voice'));
        channels.push(await msg.guild.createChannel(`${name} - Team 2`, 'voice'));

        const lobby: ILobby = {
            owner: msg.author.id,
            name,
            voiceChannels: channels.map(c => c.id),
            size: 12,
            players: []
        };

        this.lobbies.push(lobby);
        this.lobbyDB.save();

        msg.reply(`lobby "${name}" created! Type \`!join ${name}\` to join`);
    }

    /**
     * Close a previously created lobby
     */
    @command('closelobby', '<lobbyName:string>', cmdPresets.admin)
    async closeLobbyCmd(msg: Message, args: any) {
        let lobby;

        if (args.lobbyName) {
            lobby = this.findLobbyByName(args.lobbyName);
        } else {
            // If there is just 1 open lobby, don't require specifying the lobby name
            if (this.lobbies.length === 0) {
                msg.reply('there are no open lobbies to close!');
                return;
            } else if (this.lobbies.length > 0) {
                msg.reply('there are more than 1 open lobby. Please specify which one to close.');
                return;
            }

            lobby = this.lobbies[0];
        }

        if (!lobby) {
            msg.reply('lobby not found!');
            return;
        }

        if (lobby.owner !== msg.author.id) {
            msg.reply('you can only close your own lobbies!');
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

        msg.reply(`lobby "${lobby.name}" closed!`);
    }

    /**
     * Join a lobby
     */
    @command('join', '<lobbyName:string>')
    async joinLobbyCmd(msg: Message, args: any) {
        let lobby;

        if (args.lobbyName) {
            lobby = this.findLobbyByName(args.lobbyName);
        } else {
            // If there is just 1 open lobby, don't require specifying the lobby name
            if (this.lobbies.length === 0) {
                msg.reply('there are no open lobbies to join!');
                return;
            } else if (this.lobbies.length > 0) {
                msg.reply('there are more than 1 open lobby. Please specify which one to join.');
                return;
            }

            lobby = this.lobbies[0];
        }

        if (!lobby) {
            msg.reply('lobby not found!');
            return;
        }

        if (lobby.players.includes(msg.author.id)) {
            msg.reply(`you're already in that lobby!`);
            return;
        }

        const currentLobby = this.lobbies.find(lobby => lobby.players.includes(msg.author.id));
        if (currentLobby) {
            this.leaveLobby(currentLobby, msg.author);
        }

        this.joinLobby(lobby, msg.author);
        msg.reply(`joined ${lobby.name}`);
    }

    /**
     * Leave your current lobby. The lobbyName arg is unused, but allowed because people may type it anyway.
     */
    @command('leave', '[lobbyName:string]')
    async leaveLobbyCmd(msg: Message, args: any) {
        const lobby = this.lobbies.find(lobby => lobby.players.includes(msg.author.id));

        if (!lobby) {
            msg.reply(`you're not in a lobby!`);
            return;
        }

        this.leaveLobby(lobby, msg.author);
        msg.reply(`left ${lobby.name}`);
    }

    /**
     * Remove a player from the specified lobby
     */
    @command('lobbykick', '<user:User> [lobbyName:string]', cmdPresets.admin)
    async kickCmd(msg: Message, args: any) {
        let lobby;

        if (args.lobbyName) {
            lobby = this.findLobbyByName(args.lobbyName);
        } else {
            // If there is just 1 open lobby, don't require specifying the lobby name
            if (this.lobbies.length === 0) {
                msg.reply('there are no open lobbies to kick from!');
                return;
            } else if (this.lobbies.length > 0) {
                msg.reply('there are more than 1 open lobby. Please specify which one to kick the user from.');
                return;
            }

            lobby = this.lobbies[0];
        }

        if (!lobby) {
            msg.reply(`lobby not found!`);
            return;
        }

        this.removeUserFromLobby(lobby, args.user);
        msg.reply(`${args.user.username} has been kicked from the lobby!`);
    }

    /**
     * List players in a lobby
     */
    @command('lobbyplayers', '<lobbyName:string>')
    async lobbyPlayersCmd(msg: Message, args: any) {
        const lobby = this.findLobbyByName(args.name);

        if (!lobby) {
            msg.reply(`lobby not found!`);
            return;
        }

        const members = lobby.players.map(id => msg.guild.members.get(id));
        const names = members.map(member => member.nickname || member.user.username);

        msg.reply(`the lobby has ${lobby.players.length} players:\n${names.join(', ')}`);
    }

    @command('balance', '<lobbyName:string>', cmdPresets.admin)
    async balanceCmd(msg: Message, args: any) {
        const lobby = this.findLobbyByName(args.lobbyName);

        if (!lobby) {
            msg.reply('lobby not found!');
            return;
        }

        const unregisteredPlayers = lobby.players.filter(id => !this.players[id]);
        if (unregisteredPlayers.length > 0) {
            const members = unregisteredPlayers.map(id => msg.guild.members.get(id));
            const names = members.map(m => m ? m.nickname || m.user.username : '?');

            msg.reply(`The following players are still completing their registration:\n${names.join(', ')}`);
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
    @command('register', [])
    async registerCmd(msg: Message, args: any) {
        this.registrationStep(msg.author, null, true);
    }

    @onEvent('message', 'dm')
    async onDirectMessage(msg: Message) {
        this.registrationStep(msg.author, msg);
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

        // If the message doesn't contain text, or only contains whitespace, ignore it
        let content = msg.cleanContent;
        if (content == null) return;

        content = content.trim();
        if (content === '') return;

        const progress = this.playerRegistrations.get(msg.author.id);

        if (!progress && !allowStart) return;

        // Start registration
        if (!progress) {
            channel.send(trimLines(`
                Before you can participate in PUGs, we need a little bit of information about you.
                
                To start off, which regions would you like to play in?
                You will also get alerts for PUGs in the regions you choose.
                
                Available options: **EU**, **NA**, **OCE**, **None**
            `));

            this.playerRegistrations.set(user.id, new RegistrationProgress());
        }

        // Ask for regions
        else if (!progress.regions) {
            if (content.toLowerCase() === 'none') {
                progress.regions = [];
            } else {
                const regionRoles = await this.pluginConfig.get('regions');
                const validRegions = Object.keys(regionRoles);

                let regions = content
                    .replace(/,/g, ' ')
                    .replace(/\sand\s/g, ' ')
                    .toLowerCase()
                    .split(/\s+/g);

                regions = regions.filter(region => validRegions.includes(region));
                if (regions.length === 0) {
                    msg.reply('No valid regions specified! Please try again.');
                    return;
                }

                progress.regions = regions;
            }

            msg.reply('Ok. And what is your BattleTag?');
        }

        // Ask for BattleTag
        else if (!progress.battleTag) {
            if (!content.match(/^[^#]+#[0-9]+$/)) {
                msg.reply('Invalid BattleTag! Use the format Name#1234 (not that this is *not* your Discord username).');
                return;
            }

            progress.battleTag = content;
            msg.reply('Ok. What is your current SR? Reply `unranked` if unranked.');
        }

        // Ask for SR
        else if (progress.sr == null) {
            if (!content.match(/^[0-9]+$/) && content !== 'unranked') {
                msg.reply('Invalid SR!');
                return;
            }

            const sr = (content === 'unranked' ? 0 : parseInt(content, 10));
            if (sr > 5000) {
                msg.reply('Very funny.');
                return;
            }

            progress.sr = sr;
            msg.reply(trimLines(`
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
                msg.reply(`${invalidRole} is not a valid role`);
                return;
            }

            if (roles.includes('flex') || roles.includes('any')) {
                roles = ['dps', 'tank', 'support'];
            }

            progress.roles = roles;

            msg.reply('Ok. Finally, are you going to use voice chat while playing?');
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

        // Add region roles
        progress.regions.forEach(region => {
            if (!regionRoles[region]) return;
            member.addRole(regionRoles[region]);
        });

        // Add "Registered" role
        if (registeredRole) {
            member.addRole(registeredRole);
        }

        channel.send('Registration complete! You can now play in PUGs.');
        this.playerDB.save();
    }
}