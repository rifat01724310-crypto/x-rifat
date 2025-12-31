// plugins/antistatus.js
const { Module } = require("../lib/plugins");
const settings = require("../lib/database/settingdb");
const warnlib = require("./bin/warnlib"); // addWarn/removeWarn/setWarnLimit
const DEBUG = 1;

// ---------- helpers ----------
function defaultConfig() {
  return { status: true, action: "kick" };
}
function toBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string")
    return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  return Boolean(v);
}
function normalizeCfg(raw) {
  if (!raw || typeof raw !== "object") return defaultConfig();
  const cfg = { ...defaultConfig(), ...raw };
  cfg.action = (cfg.action || "kick").toLowerCase();
  return cfg;
}
function normalizeJid(jid) {
  if (!jid) return jid;
  return jid.endsWith("@lid") ? jid.replace(/@lid$/, "@s.whatsapp.net") : jid;
}

async function safeReplyMessage(messageOrConn, toJid, text, mentions = []) {
  try {
    // If we have a message-like object with send/reply methods, use it
    if (messageOrConn && typeof messageOrConn.sendreply === "function") {
      await messageOrConn.sendreply(text, { mentions });
      return;
    }
    if (messageOrConn && typeof messageOrConn.reply === "function") {
      await messageOrConn.reply(text, { mentions });
      return;
    }
    if (messageOrConn && typeof messageOrConn.send === "function") {
      await messageOrConn.send(text, { mentions });
      return;
    }
    // fallback to conn.sendMessage
    if (toJid && messageOrConn && typeof messageOrConn.sendMessage === "function") {
      await messageOrConn.sendMessage(toJid, { text, mentions });
      return;
    }
  } catch (e) {
    if (DEBUG) console.debug("[antistatus] safeReply error:", e && e.message ? e.message : e);
  }
}

async function safeKick(conn, groupJid, jid) {
  try {
    if (conn && typeof conn.groupParticipantsUpdate === "function") {
      await conn.groupParticipantsUpdate(groupJid, [jid], "remove");
      if (DEBUG) console.debug("[antistatus] kicked", jid);
      return true;
    }
    // some clients may expose different API; attempt message.removeParticipant if present on message object (unlikely in raw handler)
  } catch (e) {
    if (DEBUG) console.debug("[antistatus] safeKick error:", e && e.message ? e.message : e);
  }
  if (DEBUG) console.debug("[antistatus] safeKick not supported");
  return false;
}

// ---------- command handler ----------
Module({
  command: "antistatus",
  package: "group",
  description: "Manage anti-status-mention settings (on/off, action kick|warn|null)",
})(async (message, match) => {
  try {
    if (typeof message.loadGroupInfo === "function") {
      try {
        await message.loadGroupInfo();
      } catch (e) {
        if (DEBUG) console.debug("antistatus: loadGroupInfo failed:", e && e.message ? e.message : e);
      }
    }
    if (!message.isGroup) return message.send?.("This command is for groups only.");
    if (!message.isAdmin && !message.isFromMe) return message.send?.("Only group admins can use this.");

    const raw = (match || "").trim();
    const lower = raw.toLowerCase();

    let cfg = await settings.getGroup(message.from, "antistatus");
    cfg = normalizeCfg(cfg);

    if (!raw) {
      return await message.sendreply?.(
        `*Anti-Status-Mention Settings*\n\n` +
          `• Status: ${toBool(cfg.status) ? "✅ ON" : "❌ OFF"}\n` +
          `• Action: ${cfg.action}\n\n` +
          `Commands:\n` +
          `• antistatus on|off\n` +
          `• antistatus action kick|warn|null\n` +
          `• antistatus reset`
      );
    }

    if (lower === "on" || lower === "off") {
      cfg.status = lower === "on";
      await settings.setGroupPlugin(message.from, "antistatus", cfg);
      await message.react?.("✅");
      return await message.send(cfg.status ? "✅ AntiStatus enabled" : "❌ AntiStatus disabled");
    }

    if (lower.startsWith("action")) {
      const val = raw.replace(/action/i, "").trim().toLowerCase();
      if (!["kick", "warn", "null"].includes(val)) {
        await message.react?.("❌");
        return await message.send("Invalid action. Use: kick | warn | null");
      }
      cfg.action = val;
      await settings.setGroupPlugin(message.from, "antistatus", cfg);
      await message.react?.("✅");
      return await message.send(`⚙️ AntiStatus action set to *${val}*`);
    }

    if (lower === "reset") {
      cfg = defaultConfig();
      await settings.setGroupPlugin(message.from, "antistatus", cfg);
      await message.react?.("✅");
      return await message.send("♻️ AntiStatus settings reset to defaults (enabled, action: kick)");
    }

    await message.react?.("❌");
    return await message.send("Invalid command. Type `antistatus` to see help");
  } catch (e) {
    console.error("antistatus command handler error:", e);
    try { await message.send("An error occurred while processing the antistatus command."); } catch {}
  }
});

// ---------- raw handler: watches status mention events ----------
Module({
  name: "antistatus",
  on: "raw",
})(async (raw, conn) => {
  try {
    if (!raw || !raw.message) return;

    const groupJid = raw.key && raw.key.remoteJid;
    if (!groupJid || !groupJid.endsWith("@g.us")) return;

    const gsm = raw.message.groupStatusMentionMessage;
    if (!gsm) return; // not a status mention

    // load config for this group
    let cfg = await settings.getGroup(groupJid, "antistatus");
    cfg = normalizeCfg(cfg);
    if (!toBool(cfg.status)) {
      if (DEBUG) console.debug("[antistatus] disabled in group settings");
      return;
    }

    // determine offender (participant)
    const rawParticipant = raw.key.participantAlt || raw.key.participant || raw.participant || null;
    const offender = normalizeJid(rawParticipant) || rawParticipant;
    if (!offender) {
      if (DEBUG) console.debug("[antistatus] no offender jid found");
      return;
    }

    // try to fetch group metadata to check admin/bot admin
    let metadata = null;
    try {
      if (conn && typeof conn.groupMetadata === "function") {
        metadata = await conn.groupMetadata(groupJid).catch(() => null);
      } else if (conn && typeof conn.groupFetch === "function") {
        metadata = await conn.groupFetch(groupJid).catch(() => null);
      }
    } catch (e) {
      if (DEBUG) console.debug("[antistatus] group metadata fetch failed:", e && e.message ? e.message : e);
    }

    // determine offender admin status and bot admin status
    let offenderIsAdmin = false;
    let botIsAdmin = false;
    try {
      const botJid = conn && conn.user && conn.user.id ? (conn.user.id.split(":")[0] + "@s.whatsapp.net") : null;
      if (metadata && Array.isArray(metadata.participants)) {
        const p = metadata.participants.find(x => {
          const id = (x.id || x.jid || x.participant) + "";
          return id === offender || normalizeJid(id) === offender;
        });
        offenderIsAdmin = !!(p && (p.admin || p.isAdmin || p.isSuperAdmin || p.admin === "admin" || p.admin === "superadmin"));
        const bp = metadata.participants.find(x => {
          const id = (x.id || x.jid || x.participant) + "";
          return id === botJid || normalizeJid(id) === botJid;
        });
        botIsAdmin = !!(bp && (bp.admin || bp.isAdmin || bp.isSuperAdmin || bp.admin === "admin" || bp.admin === "superadmin"));
      }
    } catch (e) {
      if (DEBUG) console.debug("[antistatus] admin-check failed:", e && e.message ? e.message : e);
    }

    if (offenderIsAdmin) {
      if (DEBUG) console.debug("[antistatus] offender is admin -> ignore");
      return;
    }
    // ignore if sender is bot itself
    if (raw.key && raw.key.fromMe) {
      if (DEBUG) console.debug("[antistatus] fromMe -> ignore");
      return;
    }
    if (!botIsAdmin) {
      if (DEBUG) console.debug("[antistatus] bot is not admin -> ignore");
      return;
    }

    const action = (cfg.action || "kick").toLowerCase();

    // ACTION: null -> notify only
    if (action === "null" || action === "none") {
      if (DEBUG) console.debug("[antistatus] action=null -> notify only");
      await safeReplyMessage(conn, groupJid, `⚠️ Anti-Status: A status mention was detected and ignored.`, [offender]);
      return;
    }

    // ACTION: warn
    if (action === "warn") {
      if (!warnlib || typeof warnlib.addWarn !== "function") {
        if (DEBUG) console.debug("[antistatus] warnlib missing");
        return;
      }
      const info = await warnlib.addWarn(groupJid, offender, { reason: "antistatus", by: offender || "system" }).catch(err => {
        console.error("[antistatus] warnlib.addWarn error:", err);
        return null;
      });
      if (!info) return;
      try {
        await safeReplyMessage(conn, groupJid, `⚠️ *Anti-Status Warning*\nUser: @${(offender||"unknown").split("@")[0]}\nWarn: ${info.count}/${info.limit}`, [offender]);
      } catch (e) {}
      if (info.reached) {
        try {
          const kicked = await safeKick(conn, groupJid, offender);
          if (!kicked) console.warn("[antistatus] kick after warn limit not supported by client");
        } catch (e) {
          console.error("[antistatus] failed to kick after warn limit:", e);
        }
        await warnlib.removeWarn(groupJid, offender).catch(()=>{});
        try {
          await safeReplyMessage(conn, groupJid, `🚫 @${(offender||"unknown").split("@")[0]} removed — warn limit reached.`, [offender]);
        } catch {}
        return;
      }
      return;
    }

    // ACTION: kick
    if (action === "kick") {
      try {
        try {
          await safeReplyMessage(conn, groupJid, `❌ *Anti-Status Detected*\nUser removed: @${(offender||"unknown").split("@")[0]}`, [offender]);
        } catch (e) {}
        const kicked = await safeKick(conn, groupJid, offender);
        if (!kicked) {
          console.warn("[antistatus] cannot kick — client missing API");
          return;
        }
      } catch (err) {
        console.error("[antistatus] kick error:", err);
        return;
      }
      if (warnlib && typeof warnlib.removeWarn === "function") {
        await warnlib.removeWarn(groupJid, offender).catch(()=>{});
      }
      return;
    }

    if (DEBUG) console.debug("[antistatus] unknown action:", action);
  } catch (err) {
    console.error("[antistatus] plugin error:", err);
  }
});