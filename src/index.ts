require('dotenv').config();

import * as path from 'path';
import {Knub} from 'knub';

import {LobbyPlugin} from "./LobbyPlugin"

const bot = new Knub(process.env.TOKEN, {
    'lobby': LobbyPlugin
}, {
    guildConfigDir: path.resolve(__dirname, '..', 'data', 'guilds')
});