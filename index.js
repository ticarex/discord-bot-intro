require('dotenv').config();

const Discord = require('discord.js');
const ytdl = require("ytdl-core");
const ffmpeg = require("fluent-ffmpeg")
const path = require("path");
const fs = require("fs-extra");
const uuidv4 = require('uuid/v4');
const express = require('express')
const publicIp = require('public-ip');

const Database = require("./Database");

const client = new Discord.Client();
const app = express();

const port = process.env.PORT || 80;
const commandPrefix = process.env.COMMANDS_PREFIX;
const maxDuration = process.env.INTRO_MAX_DURATION;
const botToken = process.env.BOT_TOKEN;
const introCooldown = 1000 * 60 * process.env.INTRO_COOLDOWN;

const lastOnline = {};

let ip;
publicIp.v4().then(publicIP => ip = publicIP);

app.get("/intro/:userID", webGetIntro);

app.listen(port, () => console.log(`Example app listening on port ${port}!`));

fs.ensureDirSync("intros");

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on('message', msg => {
    if (!msg.guild) return;
    if (msg.author.bot) return;
    if (!msg.cleanContent.startsWith(commandPrefix)) return;

    try {
        onCommand(msg);
    } catch (e) {
        console.error(e);
        msg.reply(e.message);
    }
});

client.on('voiceStateUpdate', (oldMember, newMember) => {
    const introChannel = getGuildIntroChannel(newMember.guild.id);

    if (oldMember.channelID && newMember.channelID != oldMember.channelID)
        setLastOnline(newMember.id, oldMember.channelID);

    if (!introChannel) return;
    if (newMember.channelID != introChannel) return;

    if (oldMember.channelID != newMember.channelID)
        onJoinVoiceChannel(newMember);
});

client.login(botToken);

function setLastOnline(userID, channelID) {
    if (!lastOnline[userID]) lastOnline[userID] = {};

    lastOnline[userID][channelID] = Date.now();
}

function getLastOnline(userID, channelID) {
    if (!lastOnline[userID]) return null;
    if (!lastOnline[userID][channelID]) return null;

    return lastOnline[userID][channelID];
}

function webGetIntro(req, res) {
    const userID = req.params.userID;

    if (!getIntro(userID)) return res.send("vc nao tem intro porra");

    const introPath = path.resolve(path.join("intros", getIntro(userID)));
    res.sendFile(introPath);
}

function onJoinVoiceChannel(guildMember) {
    playIntro(guildMember);
}

async function onCommand(msg) {
    const contentWords = msg.cleanContent.split(" ");

    const command = contentWords.splice(0, 1)[0].substring(commandPrefix.length);
    const args = contentWords;

    try {
        switch (command) {
            default:
                msg.reply("vai aprender a escrever seu imbencil");
                break;
            case "help":
                helpCommand(msg);
                break;
            case "intro":
                await introCommand(msg, args);
                break;
        }
    } catch (e) {
        console.error(e);
        msg.reply(e.message);
    }
}

function helpCommand(msg) {
    const p = commandPrefix;

    msg.reply(
        "lista de comandos:\`\`\`" +
        p + "help            mostra isso aqui kkkkkk\n" +
        "\n" +
        p + "intro           coloca ou mostra a ajuda pras intro\n" +
        p + "intro remove    remove sua intro\n" +
        p + "intro test      mostra o link pra vc ouvir sua intro\n" +
        p + "intro channel   define o canal de voz atual como o de intro" +
        "\`\`\`"
    );
}

async function introCommand(msg, args) {
    if (args.length == 0)
        return introHelpCommand(msg);

    if (args[0] == "remove")
        return introRemoveCommand(msg);

    if (args[0] == "test")
        return introTestCommand(msg);

    if (args[0] == "channel")
        return introChannelCommand(msg);

    const youtubeURL = args[0];
    const begin = timeToSeconds(args[1]) || 0;
    const duration = timeToSeconds(args[2]) - begin || maxDuration;

    if (duration > maxDuration)
        throw new Error("nao pode durar tanto tempo assim nao filho da puta");

    if (duration < 0)
        throw new Error("mano vc ta nas drogas? kkkkkkkkkkkkkkkkkkkkkkkkk olha esses tempo mano q doenca...");

    if (begin < 0)
        throw new Error("inicio menor q 0? vc e gay?");

    msg.reply(`vo baixa esse lixo, começa nos ${begin} segundos e tem ${duration} segundos de duracao, q gracinha`);

    const filename = await downloadYoutubeAudio({
        urlOrID: youtubeURL,
        startSecond: begin,
        durationSeconds: duration
    });
    setIntro(msg.author.id, filename);

    msg.reply("terminei essa porra");
}

function introTestCommand(msg) {
    if (!getIntro(msg.author.id))
        return msg.reply(`vc nao tem intro caralho, oxi bixo burro da porra kkkkkkkkkkk`);

    const suffix = port == 80 ? "" : `:${port}`;

    msg.reply(`vc pode ver sua intro acessando http://${ip}${suffix}/intro/${msg.author.id}`);
}

function introChannelCommand(msg) {
    const isGuildManager = msg.member.permissions.has("MANAGE_GUILD");

    if (!isGuildManager)
        return msg.reply(`oxi sai fora mano se nao for admin nem quero saber mano ta loco kkkkkkk`);

    if (!msg.member.voice.channelID)
        return msg.reply(`mano vc precisa estar em um canal de voz CARAIO`);

    Database.guild(msg.member.guild.id).introChannel = msg.member.voice.channelID;
    Database.save();

    return msg.reply(`hahahahaha esse agora e o canal de intro caralho...`);
}

function introHelpCommand(msg) {
    msg.reply(
        "como usar:\`\`\`" +
        commandPrefix + "intro id_ou_url_do_youtube tempo_de_início tempo_de_término" +
        "\`\`\`" +
        "exemplo:\`\`\`" +
        commandPrefix + "intro https://www.youtube.com/watch?v=DC5uMv3InPY 0:06 0:08" +
        "\`\`\`" +
        "e o maximo de duração q uma intro pode ter eh " + maxDuration + " segundos"
    );
}

function introRemoveCommand(msg) {
    deleteIntro(msg.author.id);
    msg.reply("sua intro foi pra deletera");
}

async function downloadYoutubeAudio({
    urlOrID,
    startSecond = 0,
    durationSeconds = 0
}) {
    const filename = uuidv4();

    const id = ytdl.getVideoID(urlOrID);
    const info = await ytdl.getInfo(id);

    const onlyAudio = info.formats.filter((format) => isFormatAudio(format) && !isFormatVideo(format));
    const highestAudio = onlyAudio[0];

    const stream = highestAudio.url;
    const extension = "mp3";

    const fullFilename = filename + '.' + extension;
    const outputPath = path.join("intros", fullFilename);

    await downloadAndCropAudio({
        outputPath,
        stream,
        begin: startSecond,
        duration: durationSeconds
    });

    return fullFilename;
}

function isFormatAudio(format) {
    return !!format.audioBitrate;
};

function isFormatVideo(format) {
    return format.mimeType.startsWith("video");
};

function getGuildIntroChannel(guildID) {
    return Database.guild(guildID).introChannel;
}

async function downloadAndCropAudio({
    outputPath,
    stream,
    begin,
    duration
}) {
    return new Promise((resolve, reject) => {
        const proc = new ffmpeg();

        proc.addInput(stream);
        proc.seekInput(begin);
        proc.duration(duration);

        proc.once("end", () => resolve(outputPath));
        proc.once("error", error => reject(error));

        proc.output(outputPath);
        proc.run();
    });
}

function timeToSeconds(str) {
    str = str + "";

    var p = str.split(':'),
        s = 0,
        m = 1;

    while (p.length > 0) {
        s += m * parseFloat(p.pop(), 10);
        m *= 60;
    }

    return parseFloat(s);
}

function setIntro(userID, filename) {
    deleteIntro(userID);

    Database.user(userID).intro = filename;
    Database.save();
}

function deleteIntro(userID) {
    const intro = getIntro(userID);
    if (!intro) return;

    fs.unlinkSync(path.join("intros", intro));
    delete Database.user(userID).intro;

    Database.save();
}

async function playIntro(guildMember) {
    const intro = getIntro(guildMember.id);
    const introChannel = getGuildIntroChannel(guildMember.guild.id);
    if (!intro) return;
    if (!introChannel) return;

    if (isOnIntroCooldown(guildMember.id, introChannel)) return;

    const introPath = path.resolve(path.join("intros", intro));

    const guild = client.guilds.resolve(guildMember.guild.id);
    const channel = guild.channels.resolve(introChannel);

    const conn = await channel.join();

    const dispatcher = conn.play(introPath);
    dispatcher.once('finish', () => {
        conn.disconnect();
    });
}

function isOnIntroCooldown(userID, channelID) {
    const lastOnline = getLastOnline(userID, channelID);
    if (!lastOnline) return false;

    return lastOnline + introCooldown > Date.now();
}

function getIntro(userID) {
    return Database.user(userID).intro;
}