const { Module } = require("../lib/plugins");
const { getTheme } = require("../Themes/themes");
const theme = getTheme();
const cache = require("../lib/group-cache");

Module({
  command: "tagall",
  package: "group",
  description: "Tag all group members with custom style (cached)",
})(async (m, text) => {
  if (!m.isGroup) return m.send(theme.isGroup);
  if (!m.isAdmin && !m.isFromMe) return m.send(theme.isAdmin);
  try {
    const conn = m.conn;
    const from = m.from;
    let groupMetadata = cache.getCached(from);
    if (!groupMetadata) {
      groupMetadata = await cache.getGroupMetadata(conn, from);
    }
    const participants = groupMetadata.participants || [];
    const groupName = groupMetadata.subject || "Unknown Group";
    const totalMembers = participants.length;
    if (!totalMembers)
      return m.sendreply("❌ No members found in this group.");
    const msgText = text?.trim() || "ATTENTION EVERYONE";
    const emojis = [
      "⚡", "✨", "🎖️", "💎", "🔱", "💗", "❤‍🩹", "👻", "🌟", "🪄",
      "🎋", "🪼", "🍿", "👀", "👑", "🦋", "🐋", "🌻", "🌸", "🔥",
      "🍉", "🍧", "🍨", "🍦", "🧃", "🪀", "🎾", "🪇", "🎲", "🎡",
      "🧸", "🎀", "🎈", "🩵", "♥️", "🚩", "🏳️‍🌈", "🏖️", "🔪",
      "🎏", "🫐", "🍓", "💋", "🍄", "🎐", "🍇", "🐍", "🪻", "🪸", "💀"
    ];
    const getEmoji = () => emojis[Math.floor(Math.random() * emojis.length)];
    let tagText = `
*🪷 GROUP : ${groupName}*
*🪷 MEMBERS : ${totalMembers}*
*🪷 MESSAGE : ${msgText}*

   *╭┈─「 𝐇𝐞𝐥𝐥𝐨 𝐄𝐯𝐞𝐫𝐲𝐨𝐧𝐞 」┈❍*
`;
    let i = 1;
    for (const p of participants) {
      tagText += `${i}.│${getEmoji()} ᩧ𝆺ྀི𝅥  @${p.id.split("@")[0]}\n`;
      i++;
    }
   
    const mentions = participants.map(p => p.id);
    await conn.sendMessage(
      from,
      { text: tagText, mentions },
      { quoted: m.raw }
    );
  } catch (err) {
    console.error("tagall error:", err);
    m.sendreply("❌ Failed to tag members.");
  }
});


Module({
  command: "admin",
  package: "group",
  description: "Tag all group admins (cached)",
})(async (m, text) => {
  if (!m.isGroup) return m.send(theme.isGroup);
  try {
    const conn = m.conn;
    const from = m.from;
    let groupMetadata = cache.getCached(from);
    if (!groupMetadata) {
      groupMetadata = await cache.getGroupMetadata(conn, from);
    }
    const participants = groupMetadata.participants || [];
    const groupName = groupMetadata.subject || "Unknown Group";
    const admins = participants.filter(
      p => p.admin === "admin" || p.admin === "superadmin"
    );
    if (!admins.length) {
      return m.sendReply("❌ No admins found in this group.");
    }
    const msgText = text?.trim() || "ATTENTION ADMINS";
    const emojis = [
      "⚡", "✨", "🎖️", "💎", "🔱", "💗", "❤‍🩹", "👻", "🌟", "🪄",
      "🎋", "🪼", "🍿", "👀", "👑", "🦋", "🐋", "🌻", "🌸", "🔥",
      "🍉", "🍧", "🍨", "🍦", "🧃", "🎾", "🪇", "🎲", "🎡", "🧸",
      "🎀", "🎈", "🩵", "♥️", "🚩", "🏳️‍🌈", "🏖️", "🔪", "🎏",
      "🫐", "🍓", "💋", "🍄", "🎐", "🍇", "🐍", "🪻", "🪸", "💀"
    ];
    const getEmoji = () => emojis[Math.floor(Math.random() * emojis.length)];
    let tagText = `
*🪷 GROUP : ${groupName}*
*🪷 ADMINS : ${admins.length}*
*🪷 MESSAGE : ${msgText}*

   *╭┈─「 αℓℓ α∂ɱเɳร 👑 」┈❍*
`;
    let i = 1;
    for (const admin of admins) {
      const role = admin.admin === "superadmin" ? "🌟" : "👮";
      tagText += `${i}.│${getEmoji()} ${role} @${admin.id.split("@")[0]}\n`;
      i++;
    }
    tagText += `   *╰────────────❍*`;
    const mentions = admins.map(a => a.id);
    await conn.sendMessage(
      from,
      { text: tagText, mentions },
      { quoted: m.raw }
    );
  } catch (err) {
    console.error("admin tag error:", err);
    m.sendReply("❌ An error occurred while tagging admins.");
  }
});

Module({
  command: "hidetag",
  package: "group",
  description: "Tag all without showing names (cached)",
})(async (m, text) => {
  if (!m.isGroup) return m.send(theme.isGroup);
  if (!m.isAdmin && !m.isFromMe) return m.send(theme.isAdmin);
  try {
    const conn = m.conn;
    const from = m.from;
    let groupMetadata = cache.getCached(from);
    if (!groupMetadata) {
      groupMetadata = await cache.getGroupMetadata(conn, from);
    }
    const participants = groupMetadata.participants || [];
    if (!participants.length) {
      return m.reply("❌ No members found.");
    }
    const message = text?.trim() || "📢 Everyone has been tagged!";
    const mentions = participants.map(p => p.id);
    await conn.sendMessage(
      from,
      { text: message, mentions },
      { quoted: m.raw }
    );
    await m.react("👻");
  } catch (err) {
    console.error("hidetag error:", err);
    m.reply("❌ Error: " + err.message);
  }
});
