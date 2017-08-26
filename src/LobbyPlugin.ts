import {Message, VoiceChannel, TextChannel, User} from 'discord.js';
import {Plugin} from 'knub';
import {JsonDB} from "./JsonDB"
import * as path from 'path';
import has = Reflect.has;

const lobbyFileDir = path.resolve(__dirname, '../data/lobbies');
const playerFileDir = path.resolve(__dirname, '../data/players');

const allowedRoles = ['dps', 'tank', 'support', 'flex'];

interface Lobby {
    owner: string;
    name: string;
    voiceChannels: string[];
    size: number;
    players: string[];
}

interface Player {
    id: string;
    battleTag: string;
    sr: number;
    roles: string[];
}

interface PlayerMapObj {
    [id: string]: Player;
}

interface RegistrationProgress {
    battleTag: string;
    sr: number;
    roles: string[];
}

export class LobbyPlugin extends Plugin {
    async load() {
        const lobbyDB = new JsonDB(path.join(lobbyFileDir, `${this.guildId}.json`));
        const lobbies: Lobby[] = await lobbyDB.get();

        const playerDB = new JsonDB(path.join(playerFileDir, `${this.guildId}.json`));
        const players: PlayerMapObj = await playerDB.get();

        const playerRegistrations: Map<string, RegistrationProgress> = new Map();

        // Create a lobby
        this.commands.add('createlobby', '<name:string>', async (msg: Message, args: any) => {
            const name = args.name;

            const hasExistingLobby = lobbies.some(lobby => lobby.name === name);
            if (hasExistingLobby) {
                msg.reply('A lobby with that name already exists!');
                return;
            }

            const channels: (VoiceChannel|TextChannel)[] = [];
            channels.push(await msg.guild.createChannel(`${name} - Lobby`, 'voice'));
            channels.push(await msg.guild.createChannel(`${name} - Team 1`, 'voice'));
            channels.push(await msg.guild.createChannel(`${name} - Team 2`, 'voice'));

            const lobby: Lobby = {
                owner: msg.author.id,
                name,
                voiceChannels: channels.map(c => c.id),
                size: 12,
                players: []
            };

            lobbies.push(lobby);
            lobbyDB.save();
        });

        // Close a previously created lobby
        this.commands.add('closelobby', '<name:string>', async (msg: Message, args: any) => {
            const lobby = lobbies.find(lobby => lobby.name.toLowerCase() === args.name.toLowerCase());

            if (!lobby) {
                msg.reply('Lobby not found!');
                return;
            }

            if (lobby.owner !== msg.author.id) {
                msg.reply('You can only close your own lobbies!');
                return;
            }

            await Promise.all(lobby.voiceChannels.map(async voiceChannelId => {
                const channel = msg.guild.channels.get(voiceChannelId);
                if (channel) {
                    await channel.delete();
                }
            }));

            lobbies.splice(lobbies.indexOf(lobby));
            lobbyDB.save();
        });

        // Join a lobby
        this.commands.add('join', '<name:string>', async (msg: Message, args: any) => {
            const lobby = lobbies.find(lobby => lobby.name.toLowerCase() === args.name.toLowerCase());

            if (!lobby) {
                msg.reply('Lobby not found!');
                return;
            }

            const isAlreadyInALobby = lobbies.some(lobby => lobby.players.includes(msg.author.id));
            if (isAlreadyInALobby) {
                msg.reply(`You're already in a lobby!`);
                return;
            }

            lobby.players.push(msg.author.id);
            msg.reply(`Joined ${lobby.name}`);

            if (!players[msg.author.id]) {
                startRegistration(msg.author);
            }

            lobbyDB.save();
        });

        // Leave your current lobby
        this.commands.add('leave', async (msg: Message) => {
            const lobby = lobbies.find(lobby => lobby.players.includes(msg.author.id));

            if (!lobby) {
                msg.reply(`You're not in a lobby!`);
                return;
            }

            lobby.players.splice(lobby.players.indexOf(msg.author.id));
            msg.reply(`Left ${lobby.name}`);

            lobbyDB.save();
        });

        // Registrations
        const startRegistration = async (user: User) => {
            let channel = user.dmChannel;
            if (!channel) {
                channel = await user.createDM();
            }

            channel.send('Before you can participate in PUGs, we need a little bit of information about you.\nTo start off, what is your BattleTag?');
        };

        this.onDirectMessage(async (msg: Message) => {
            const progress = playerRegistrations.get(msg.author.id);
            if (!progress) return;

            const content = msg.cleanContent;

            if (!progress.battleTag) {
                if (!content.match(/^[^#]+#[0-9]+$/)) {
                    msg.reply('Invalid BattleTag!');
                    return;
                }

                progress.battleTag = content;
                msg.reply('Ok. What is your current SR? Reply `unranked` if unranked.');
            } else if (!progress.sr) {
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

                if (roles.includes('flex')) {
                    roles = ['dps', 'tank', 'support'];
                }

                progress.roles = roles;

                players[msg.author.id] = {
                    id: msg.author.id,
                    battleTag: progress.battleTag,
                    sr: progress.sr,
                    roles: progress.roles
                };

                msg.reply('Registration complete! You can now play in PUGs.');

                playerDB.save();
            }
        });
    }
}