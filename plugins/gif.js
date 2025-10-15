const { fetchGif, gifToVideo } = require("../lib/fetchGif");
const { Module } = require("../lib/plugins");
const axios = require("axios");

// Auto reaction GIF handler
Module({ on: "text" })(async (message) => {
  try {
    const text = (message.body || "").toLowerCase().trim();

    // Define reactions with their API endpoints
    const reactions = {
      cry: {
        api: "https://api.waifu.pics/sfw/cry",
        emoji: "😢",
        action: "is crying",
      },
      cuddle: {
        api: "https://api.waifu.pics/sfw/cuddle",
        emoji: "🤗",
        action: "cuddled",
      },
      bully: {
        api: "https://api.waifu.pics/sfw/bully",
        emoji: "😈",
        action: "is bullying",
      },
      hug: {
        api: "https://api.waifu.pics/sfw/hug",
        emoji: "🤗",
        action: "hugged",
      },
      awoo: {
        api: "https://api.waifu.pics/sfw/awoo",
        emoji: "🐺",
        action: "awoos at",
      },
      lick: {
        api: "https://api.waifu.pics/sfw/lick",
        emoji: "👅",
        action: "licked",
      },
      pat: {
        api: "https://api.waifu.pics/sfw/pat",
        emoji: "🫂",
        action: "patted",
      },
      smug: {
        api: "https://api.waifu.pics/sfw/smug",
        emoji: "😏",
        action: "is smug at",
      },
      bonk: {
        api: "https://api.waifu.pics/sfw/bonk",
        emoji: "🔨",
        action: "bonked",
      },
      yeet: {
        api: "https://api.waifu.pics/sfw/yeet",
        emoji: "🔪",
        action: "yeeted",
      },
      blush: {
        api: "https://api.waifu.pics/sfw/blush",
        emoji: "😊",
        action: "is blushing at",
      },
      handhold: {
        api: "https://api.waifu.pics/sfw/handhold",
        emoji: "🤝",
        action: "is holding hands with",
      },
      highfive: {
        api: "https://api.waifu.pics/sfw/highfive",
        emoji: "✋",
        action: "gave a high-five to",
      },
      nom: {
        api: "https://api.waifu.pics/sfw/nom",
        emoji: "🍽️",
        action: "is nomming",
      },
      wave: {
        api: "https://api.waifu.pics/sfw/wave",
        emoji: "👋",
        action: "waved at",
      },
      smile: {
        api: "https://api.waifu.pics/sfw/smile",
        emoji: "😁",
        action: "smiled at",
      },
      wink: {
        api: "https://api.waifu.pics/sfw/wink",
        emoji: "😉",
        action: "winked at",
      },
      happy: {
        api: "https://api.waifu.pics/sfw/happy",
        emoji: "😊",
        action: "is happy with",
      },
      glomp: {
        api: "https://api.waifu.pics/sfw/glomp",
        emoji: "🤗",
        action: "glomped",
      },
      bite: {
        api: "https://api.waifu.pics/sfw/bite",
        emoji: "🦷",
        action: "bit",
      },
      poke: {
        api: "https://api.waifu.pics/sfw/poke",
        emoji: "👉",
        action: "poked",
      },
      cringe: {
        api: "https://api.waifu.pics/sfw/cringe",
        emoji: "😬",
        action: "thinks",
      },
      dance: {
        api: "https://api.waifu.pics/sfw/dance",
        emoji: "💃",
        action: "danced with",
      },
      kill: {
        api: "https://api.waifu.pics/sfw/kill",
        emoji: "🔪",
        action: "killed",
      },
      slap: {
        api: "https://api.waifu.pics/sfw/slap",
        emoji: "✊",
        action: "slapped",
      },
      kiss: {
        api: "https://api.waifu.pics/sfw/kiss",
        emoji: "💋",
        action: "kissed",
      },
    };

    // Check if message is a reaction keyword
    const reactionType = reactions[text];
    if (!reactionType) return;

    await message.react(reactionType.emoji);

    // Get sender and mentioned user (with proper JID format)
    const senderJid = message.sender; // Full JID: 12345678901@s.whatsapp.net
    const mentionedUser = message.mentions?.[0] || message.quoted?.sender;

    // Build message with @ mentions
    const sender = `@${senderJid.split("@")[0]}`;

    let caption;
    let mentionsList = [senderJid]; // Always include sender

    if (mentionedUser) {
      const target = `@${mentionedUser.split("@")[0]}`;
      caption = `${sender} ${reactionType.action} ${target}`;
      mentionsList.push(mentionedUser); // Add mentioned user
    } else if (message.isGroup) {
      caption = `${sender} ${reactionType.action} everyone!`;
    } else {
      caption = `> *© ᴘσωєʀє∂ ву 𝖐𝚊𝚒𝚜𝖊𝖓 𝙼ԃ⎯꯭̽💀*`;
    }

    // Fetch and send GIF
    const res = await axios.get(reactionType.api);
    const gifUrl = res.data.url;

    const gifBuffer = await fetchGif(gifUrl);
    const videoBuffer = await gifToVideo(gifBuffer);

    // Send with proper mentions array
    await message.conn.sendMessage(
      message.from,
      {
        video: videoBuffer,
        caption: caption,
        gifPlayback: true,
        mentions: mentionsList.filter(Boolean), // Remove any null/undefined
      },
      { quoted: message.raw }
    );
  } catch (error) {
    console.error("❌ Auto reaction error:", error);
  }
});
