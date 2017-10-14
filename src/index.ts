require('dotenv').config();

import * as path from 'path';
import {Knub, Plugin, command} from 'knub';

import {LobbyPlugin} from "./plugins/LobbyPlugin"
import {UtilityPlugin} from "./plugins/UtilityPlugin"

const bot = new Knub(process.env.TOKEN, {
    'lobby': LobbyPlugin,
    'utility': UtilityPlugin
}, {
    guildConfigDir: path.resolve(__dirname, '..', 'data', 'guilds')
});

bot.run();
