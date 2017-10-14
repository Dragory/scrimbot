require('dotenv').config();
const djs = require('discord.js');

const bot = new djs.Client();

bot.on('ready', async () => {
  const user = bot.users.get('106391128718245888');

  let dmChannel = user.dmChannel;
  if (!dmChannel) {
    dmChannel = await user.createDM();
  }

  dmChannel.send('hi testing');
});

bot.login(process.env.TOKEN);
