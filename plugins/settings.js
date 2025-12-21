// plugins/settings.js
const { Module } = require("../lib/plugins");
const settings = require("../lib/database/settingdb");
const config = require("../config");
const { getTheme } = require("../Themes/themes");
const theme = getTheme();

// small boolean helper
function toBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  return Boolean(v);
}

/* ---------------- . setstickername ---------------- */
Module({
  command: "setstickername",
  package: "owner",
  description: "Set sticker name .setstickername x-kira"
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const info = (match || "").trim();
  if (!info) return message.send("Usage: .setstickername x-kira");
  try {
    await settings.setGlobal("sticker", info, { persist: true });
    await message.react?.("✅");
    return await message.send("✅sticker name  saved.");
  } catch (err) {
    console.error(" error:", err);
    await message.react?.("❌");
    return await message.send("❌ Failed to save sticker name.");
  }
});
/* ---------------- .setmenu <url> ---------------- */
Module({
  command: "setmenu",
  package: "owner",
  description: "Set menu info (.setmenu name,desc,https://photo.jpg,image/video/gif"
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const info = (match || "").trim();
  if (!info) return message.send("Usage: .setmenuinfo x-kira,powered by x-kira,https://photo.jpg,image/video/gif");
  try {
    await settings.setGlobal("MENU_INFO", info, { persist: true });
    await message.react?.("✅");
    return await message.send("✅ menu info saved.");
  } catch (err) {
    console.error("setimg error:", err);
    await message.react?.("❌");
    return await message.send("❌ Failed to save menu info.");
  }
});

/* ---------------- .setimg <url> ---------------- */
Module({
  command: "setimg",
  package: "owner",
  description: "Set cmd image url (.setimg https://... )"
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const url = (match || "").trim();
  if (!url) return message.send("Usage: .setcmdimg <image_url>");
  if (!/^https?:\/\//i.test(url)) return message.send("Please provide a valid http(s) url.");
  try {
    await settings.setGlobal("MENU_URL", url, { persist: true });
    await message.react?.("✅");
    return await message.send("✅ Menu image URL saved.");
  } catch (err) {
    console.error("setimg error:", err);
    await message.react?.("❌");
    return await message.send("❌ Failed to save cmd image URL.");
  }
});

/* ---------------- .setname <bot name> ---------------- */
Module({
  command: "setbotname",
  package: "owner",
  description: "Set bot display name (.setname MyBot)"
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const name = (match || "").trim();
  if (!name) return message.send("Usage: .setname <bot display name>");
  try {
    await settings.setGlobal("BOT_NAME", name, { persist: true });
    await message.react?.("✅");
    return await message.send(`✅ Bot name set to: *${name}*`);
  } catch (err) {
    console.error("setname error:", err);
    await message.react?.("❌");
    return await message.send("❌ Failed to save bot name.");
  }
});

/* ---------------- .setprefix <prefix> ---------------- */
Module({
  command: "setprefix",
  package: "owner",
  description: "Set command prefix (.setprefix . or !)"
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const p = (match || "").trim();
  if (!p) return message.send("Usage: .setprefix <new_prefix>");
  // prefer single character prefixes but allow string
  try {
    await settings.setGlobal("prefix", p, { persist: true });
    await message.react?.("✅");
    return await message.send(`✅ Prefix updated to: \`${p}\``);
  } catch (err) {
    console.error("setprefix error:", err);
    await message.react?.("❌");
    return await message.send("❌ Failed to save prefix.");
  }
});

/* ---------------- .setmode <public|private> ---------------- */
Module({
  command: "setmode",
  package: "owner",
  description: "Set bot mode: public or private"
})(async (message, match) => {
  if (!message.isFromMe) return message.send(theme.isfromMe);
  const m = (match || "").trim().toLowerCase();
  if (!m || (m !== "public" && m !== "private")) {
    return message.send("Usage: .setmode public|private");
  }
  try {
    await settings.setGlobal("WORK_TYPE", m, { persist: true });
    await message.react?.("✅");
    return await message.send(`✅ Mode set to *${m}*`);
  } catch (err) {
    console.error("setmode error:", err);
    await message.react?.("❌");
    return await message.send("❌ Failed to save mode.");
  }
});