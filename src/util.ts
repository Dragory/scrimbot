import {Message, DMChannel} from 'discord.js';

export function shuffle(a: any[]) {
    for (let i = a.length; i; i--) {
        let j = Math.floor(Math.random() * i);
        [a[i - 1], a[j]] = [a[j], a[i - 1]];
    }
}

export function trimLines(str: string) {
    return str.trim()
        .split(/(?:\r\n|\n|\r)/g)
        .map(line => line.trim())
        .join('\n');
}

export function reply(msg: Message, response: string) {
    if (msg.channel instanceof DMChannel) {
        // No pings when responding to DMs
        msg.channel.send(response);
    } else {
        // Ping + message in regular channels
        msg.channel.send(`<@!${msg.author.id}> ${response}`);
    }
}