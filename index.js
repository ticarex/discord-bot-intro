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

const commandPrefix = process.env.COMMANDS_PREFIX || ".";
const maxDuration = process.env.INTRO_MAX_DURATION || 7;
const voiceChannelID = process.env.VOICE_CHANNEL_ID;
const guildID = process.env.GUILD_ID;
const botToken = process.env.BOT_TOKEN;

const introCooldown = 1000 * 60 * (process.env.INTRO_COOLDOWN || 5);

const lastPlayed = {};

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

    if (msg.guild.id !== guildID) return;

    try {
        onCommand(msg);
    } catch (e) {
        msg.reply(e.message);
    }
});

client.on('voiceStateUpdate', (oldMember, newMember) => {
    if (newMember.channelID != voiceChannelID) return;

    if (oldMember.channelID != newMember.channelID)
        onJoinVoiceChannel(newMember);
});

client.login(botToken);

function webGetIntro(req, res) {
    const userID = req.params.userID;

    if (!hasIntro(userID)) return res.send("vc nao tem intro porra");

    const introPath = path.resolve(path.join("intros", getIntro(userID)));
    res.sendFile(introPath);
}

function onJoinVoiceChannel(guildMember) {
    playIntro(guildMember.id);
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
        msg.reply(e.message);
    }
}

function helpCommand(msg) {
    msg.reply(
        "lista de comandos:\`\`\`" +
        commandPrefix + "help           mostra isso aqui kkkkkk\n" +
        "\n" +
        commandPrefix + "intro          coloca ou mostra a ajuda pras intro\n" +
        commandPrefix + "intro remove   remove sua intro\n" +
        commandPrefix + "intro test     mostra o link pra vc ouvir sua intro" +
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

    const youtubeURL = args[0];
    const begin = timeToSeconds(args[1]) || 0;
    const duration = args[2] || maxDuration;

    if (duration > maxDuration)
        throw new Error("nao pode durar tanto tempo assim nao filho da puta");

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
    const suffix = port == 80 ? "" : `:${port}`;

    msg.reply(`vc pode ver sua intro acessando http://${ip}${suffix}/intro/${msg.author.id}`);
}

function introHelpCommand(msg) {
    msg.reply(
        "como usar:\`\`\`" +
        commandPrefix + "intro id_ou_url_do_youtube tempo_de_início duração_em_segundos" +
        "\`\`\`" +
        "exemplo:\`\`\`" +
        commandPrefix + "intro https://www.youtube.com/watch?v=DC5uMv3InPY 0:06 2" +
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
    return !!format.audioBitrate && !!format.audioEncoding;
};

function isFormatVideo(format) {
    return format.encoding;
};

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

    return s;
}

function setIntro(userID, filename) {
    const db = Database.get();

    deleteIntro(userID);

    db[userID] = filename;

    Database.save();
}

function deleteIntro(userID) {
    const db = Database.get();

    if (!db[userID]) return;

    fs.unlinkSync(path.join("intros", db[userID]));
    delete db[userID];

    Database.save();
}

function hasIntro(userID) {
    const db = Database.get();

    return userID in db;
}

async function playIntro(userID) {
    if (!hasIntro(userID)) return;
    if (isOnIntroCooldown(userID)) return;

    const db = Database.get();
    const filename = db[userID];
    const introPath = path.resolve(path.join("intros", filename));

    const guild = client.guilds.get(guildID);
    const channel = guild.channels.get(voiceChannelID);

    const conn = await channel.join();

    const dispatcher = conn.play(introPath);
    dispatcher.once('end', () => {
        conn.disconnect();
    });

    setIntroCooldown(userID);
}

function isOnIntroCooldown(userID) {
    if (!lastPlayed[userID]) return false;

    return lastPlayed[userID] + introCooldown > Date.now();
}

function getIntro(userID) {
    const db = Database.get();

    return db[userID];
}

function setIntroCooldown(userID) {
    lastPlayed[userID] = Date.now();
}