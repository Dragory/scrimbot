import {Message, VoiceChannel, TextChannel, User} from 'discord.js';
import {ICommandOptions} from 'knub';
import {Plugin} from 'knub';
import {JsonDB} from "./JsonDB"
import * as path from 'path';

import {balanceTeams} from "./teamBalancer";

import {IPlayer, ILobby} from "./interfaces";
import {shuffle} from "./util";

const AsciiTable: any = require('ascii-table');

const lobbyFileDir = path.resolve(__dirname, '../data/lobbies');
const playerFileDir = path.resolve(__dirname, '../data/players');

const allowedRoles = ['dps', 'tank', 'support', 'flex'];

interface PlayerMapObj {
    [id: string]: IPlayer;
}

class RegistrationProgress {
    public battleTag: string = null;
    public sr: number = null;
    public roles: string[] = null;
    public voice: boolean = null;
}

const adminCmdOptions: ICommandOptions = {
    permissions: {
        level: 100
    }
};

export class LobbyPlugin extends Plugin {
    async load() {
        const lobbyDB = new JsonDB(path.join(lobbyFileDir, `${this.guildId}.json`), []);
        const lobbies: ILobby[] = await lobbyDB.get();

        const playerDB = new JsonDB(path.join(playerFileDir, `${this.guildId}.json`));
        const players: PlayerMapObj = await playerDB.get();

        const playerRegistrations: Map<string, RegistrationProgress> = new Map();

        const findLobbyByName = (name: string): ILobby => {
            return lobbies.find(lobby => lobby.name.toLowerCase() === name.toLowerCase());
        }

        const joinLobby = (lobby: ILobby, user: User) => {
            lobby.players.push(user.id);

            if (!players[user.id]) {
                startRegistration(user);
            }

            lobbyDB.save();
        };

        const leaveLobby = (lobby: ILobby, user: User) => {
            lobby.players.splice(lobby.players.indexOf(user.id), 1);
            lobbyDB.save();
        };

        // Create a lobby
        this.commands.add('createlobby', '<name:string>', async (msg: Message, args: any) => {
            const name = args.name;

            const hasExistingLobby = lobbies.some(lobby => lobby.name === name);
            if (hasExistingLobby) {
                msg.reply('a lobby with that name already exists!');
                return;
            }

            const channels: (VoiceChannel|TextChannel)[] = [];
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

            lobbies.push(lobby);
            lobbyDB.save();

            msg.reply(`lobby "${name}" created! Type \`!join ${name}\` to join`);
        }, adminCmdOptions);

        // Close a previously created lobby
        this.commands.add('closelobby', '<name:string>', async (msg: Message, args: any) => {
            const lobby = findLobbyByName(args.name);

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

            lobbies.splice(lobbies.indexOf(lobby), 1);
            lobbyDB.save();

            msg.reply(`lobby "${lobby.name}" closed!`);
        });

        // Join a lobby
        this.commands.add('join', '<name:string>', async (msg: Message, args: any) => {
            const lobby = findLobbyByName(args.name);

            if (!lobby) {
                msg.reply('lobby not found!');
                return;
            }

            if (lobby.players.includes(msg.author.id)) {
                msg.reply(`you're already in that lobby!`);
                return;
            }

            const currentLobby = lobbies.find(lobby => lobby.players.includes(msg.author.id));
            if (currentLobby) {
                leaveLobby(currentLobby, msg.author);
            }

            joinLobby(lobby, msg.author);
            msg.reply(`joined ${lobby.name}`);
        });

        // Leave your current lobby
        this.commands.add('leave', async (msg: Message) => {
            const lobby = lobbies.find(lobby => lobby.players.includes(msg.author.id));

            if (!lobby) {
                msg.reply(`you're not in a lobby!`);
                return;
            }

            leaveLobby(lobby, msg.author);
        });

        // Kick a user from the lobby
        this.commands.add('kick', '<lobbyName:string> <user:User>', async (msg: Message, args: any) => {
            const lobby = findLobbyByName(args.lobbyName);

            if (!lobby) {
                msg.reply(`you're not in a lobby!`);
                return;
            }

            if (lobby.owner !== msg.author.id) {
                msg.reply('you can only kick users from your own lobbies!');
                return;
            }

            lobby.players.splice(lobby.players.indexOf(args.user.id), 1);
            msg.reply(`${args.user.username} has been kicked from the lobby!`);
        });

        // List players in a lobby
        this.commands.add('lobbyplayers', '<name:string>', async (msg: Message, args: any) => {
            const lobby = findLobbyByName(args.name);

            if (!lobby) {
                msg.reply(`lobby not found!`);
                return;
            }

            const members = lobby.players.map(id => msg.guild.members.get(id));
            const names = members.map(member => member.nickname || member.user.username);

            msg.reply(`the lobby has ${lobby.players.length} players:\n${names.join(', ')}`);
        });

        // Re-register (or manually register)
        this.commands.add('register', async (msg: Message) => {
            startRegistration(msg.author);
        });

        // Registrations
        const startRegistration = async (user: User) => {
            let channel = user.dmChannel;
            if (!channel) {
                channel = await user.createDM();
            }

            channel.send('Before you can participate in PUGs, we need a little bit of information about you.\nTo start off, what is your BattleTag?');
            playerRegistrations.set(user.id, new RegistrationProgress());
        };

        this.onDirectMessage(async (msg: Message) => {
            const progress = playerRegistrations.get(msg.author.id);
            if (!progress) return;

            const content = msg.cleanContent;
            if (content == null || content === '') return;

            if (!progress.battleTag) {
                if (!content.match(/^[^#]+#[0-9]+$/)) {
                    msg.reply('Invalid BattleTag!');
                    return;
                }

                progress.battleTag = content;
                msg.reply('Ok. What is your current SR? Reply `unranked` if unranked.');
            } else if (progress.sr == null) {
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
                msg.reply('Ok. What roles would you prefer to play? Possible values: dps, tank, support, flex');
            } else if (!progress.roles) {
                let roles = content.replace(/[^a-z\s]/g, '').split(/\s+/);
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
            } else if (progress.voice == null) {
                const firstChar = content.toLowerCase()[0];
                if (firstChar === 'y') {
                    progress.voice = true;
                } else {
                    progress.voice = false;
                }

                players[msg.author.id] = {
                    id: msg.author.id,
                    battleTag: progress.battleTag,
                    sr: progress.sr,
                    roles: progress.roles,
                    voice: progress.voice
                };

                msg.reply('Registration complete! You can now play in PUGs.');
                playerDB.save();
            }
        });

        // Balance
        this.commands.add('balance', '<lobbyName:string>', async (msg: Message, args: any) => {
            const lobby = findLobbyByName(args.lobbyName);

            if (!lobby) {
                msg.reply('lobby not found!');
                return;
            }

            if (lobby.owner !== msg.author.id) {
                msg.reply('you can only balance your own lobbies!');
                return;
            }

            const unregisteredPlayers = lobby.players.filter(id => !players[id]);
            if (unregisteredPlayers.length > 0) {
                const members = unregisteredPlayers.map(id => msg.guild.members.get(id));
                const names = members.map(m => m ? m.nickname || m.user.username : '?');

                msg.reply(`The following players are still completing their registration:\n${names.join(', ')}`);
                return;
            }

            const lobbyPlayers: IPlayer[] = lobby.players.map(id => players[id]);
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
        });

        // (util) List roles
        this.commands.add('roles', async (msg: Message) => {
            const lines = msg.guild.roles.map(role => `${role.id} - ${role.name}`);
            msg.channel.send(lines.join('\n'), {
                disableEveryone: true
            });
        }, adminCmdOptions);
    }
}