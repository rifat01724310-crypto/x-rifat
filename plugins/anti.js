// plugins/antilink.js
const { Module } = require("../lib/plugins");
const settings = require("../lib/database/settingdb");
const warnlib = require("./bin/warnlib"); // must implement addWarn/removeWarn/setWarnLimit
const { getTheme } = require("../Themes/themes");
const theme = getTheme();

// fast detection patterns (compiled once)
const URL_REGEX = /((?:https?:\/\/|www\.)[^\s]+)/gi;
const DOMAIN_REGEX = /\b([A-Za-z0-9\-]+\.[A-Za-z]{2,}(?:\/[^\s]*)?)\b/gi;

function defaultConfig() {
  return { status: true, action: "kick", not_del: [] };
}
function toBool(v) {
  if (v === true || v === 1) return true;
  if (v === false || v === 0) return false;
  if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
  return Boolean(v);
}
function normalizeCfg(raw) {
  if (!raw || typeof raw !== "object") return defaultConfig();
  const cfg = { ...defaultConfig(), ...raw };
  cfg.not_del = Array.isArray(cfg.not_del) ? cfg.not_del : [];
  cfg.action = (cfg.action || "kick").toLowerCase();
  return cfg;
}
function isIgnored(link, notDelList = []) {
  if (!link) return false;
  const l = link.toLowerCase();
  for (const p of notDelList || []) {
    if (!p) continue;
    const q = p.toLowerCase().trim();
    if (!q) continue;
    if (l.includes(q)) return true;
  }
  return false;
}
function detectLinks(text) {
  if (!text) return [];
  const found = new Set();
  let m;
  while ((m = URL_REGEX.exec(text))) {
    if (m[1]) found.add(m[1]);
  }
  // domain-like fallback
  while ((m = DOMAIN_REGEX.exec(text))) {
    const candidate = m[1];
    if (!candidate) continue;
    if (candidate.includes("@")) continue; // skip emails
    // avoid duplicates
    let dup = false;
    for (const s of found) if (s.includes(candidate) || candidate.includes(s)) { dup = true; break; }
    if (!dup) found.add(candidate);
  }
  return Array.from(found);
}

// Extract text safely from message wrapper (if plugin receives raw different shapes)
function extractText(message) {
  if (!message) return "";
  if (typeof message.body === "string" && message.body.trim()) return message.body;
  if (message.content && typeof message.content === "string" && message.content.trim()) return message.content;
  // some wrappers use 'text' or 'caption'
  if (message.text && typeof message.text === "string") return message.text;
  if (message.caption && typeof message.caption === "string") return message.caption;
  // fallback to msg.raw if available
  try {
    const raw = message.raw || {};
    if (raw.message) {
      const m = raw.message;
      const keys = Object.keys(m);
      for (const k of keys) {
        const ct = m[k];
        if (!ct) continue;
        if (typeof ct === "string") return ct;
        if (ct.text) return ct.text;
        if (ct.caption) return ct.caption;
        if (ct.conversation) return ct.conversation;
        if (ct.extendedTextMessage && ct.extendedTextMessage.text) return ct.extendedTextMessage.text;
      }
    }
  } catch (e) { /* ignore */ }
  return "";
}

// Core enforcement: delete first, then act
async function enforceMessage(message) {
  try {
    if (!message || !message.isGroup) return { acted: false, reason: "not_group" };

    // quick short-circuit: if no dot / no www/http then probably no link
    const body = extractText(message) || "";
    if (!body || (body.indexOf('.') === -1 && body.indexOf('http') === -1 && body.indexOf('www') === -1)) {
      return { acted: false, reason: "no_link_chars" };
    }

    const links = detectLinks(body);
    if (!links.length) return { acted: false, reason: "no_detected_links" };

    // load cfg
    let cfg = await settings.getGroup(message.from, "link");
    cfg = normalizeCfg(cfg);
    if (!toBool(cfg.status)) return { acted: false, reason: "disabled_in_settings" };

    // ensure group info available for admin checks
    if (typeof message.isAdmin === "undefined" || typeof message.isBotAdmin === "undefined") {
      try { await message.loadGroupInfo(); } catch (e) { /* ignore */ }
    }

    // ignore admins and bot self
    if (message.isAdmin || message.isFromMe || message.isBotAdmin) return { acted: false, reason: "ignored_admin_or_self" };

    // pick first offending link not in ignore list
    let offenderUrl = null;
    for (const l of links) {
      if (!isIgnored(l, cfg.not_del)) { offenderUrl = l; break; }
    }
    if (!offenderUrl) return { acted: false, reason: "all_ignored" };

    const offender = message.sender;
    const client = message.client || message.conn;
    console.log(`[antilink] detected link in ${message.from} by ${offender} -> ${offenderUrl} (action=${cfg.action})`);

    // 1) Try delete message for everyone if possible (best effort)
    try {
      // prefer message.send wrapper that your serialize exposes
      if (typeof message.send === "function") {
        await message.send({ delete: message.key }).catch(() => { });
      } else if (client && message.key && typeof client.sendMessage === "function") {
        await client.sendMessage(message.from, { delete: message.key }).catch(() => { });
      }
    } catch (e) {
      console.warn("[antilink] delete attempt error:", e && e.message ? e.message : e);
    }

    const action = (cfg.action || "kick").toLowerCase();

    // NULL => only delete (we already attempted delete)
    if (action === "null") {
      return { acted: true, action: "null", offender, url: offenderUrl };
    }

    // WARN => add warn via warnlib
    if (action === "warn") {
      if (!warnlib || typeof warnlib.addWarn !== "function") {
        console.error("[antilink] warnlib.addWarn missing");
        return { acted: false, error: "warnlib_missing" };
      }
      const res = await warnlib.addWarn(message.from, offender, {
        reason: "antilink",
        by: message.sender || "system"
      }).catch(err => {
        console.error("[antilink] warnlib.addWarn error:", err);
        return null;
      });
      if (!res) return { acted: false, error: "warn_failed" };

      try {
        await message.sendreply(
          `⚠️ *Anti-Link Warning*\n\nUser: @${offender.split("@")[0]}\nWarn: ${res.count}/${res.limit}`,
          { mentions: [offender] }
        );
      } catch (e) { /* ignore */ }

      if (res.reached) {
        // kick & clear warns
        try {
          if (client && typeof client.groupParticipantsUpdate === "function") {
            await client.groupParticipantsUpdate(message.from, [offender], "remove");
          } else if (typeof message.removeParticipant === "function") {
            await message.removeParticipant(offender);
          } else {
            console.warn("[antilink] kick after warn not supported by client");
          }
        } catch (e) {
          console.error("[antilink] failed to kick after warn limit:", e);
        }
        await warnlib.removeWarn(message.from, offender).catch(() => { });
        try {
          await message.sendreply(`🚫 @${offender.split("@")[0]} removed — warn limit reached.`, { mentions: [offender] });
        } catch (e) { }
        return { acted: true, action: "warn-kick", offender, url: offenderUrl };
      }
      return { acted: true, action: "warn", offender, url: offenderUrl, warnInfo: res };
    }

    // KICK => immediate removal
    if (action === "kick") {
      try {
        if (client && typeof client.groupParticipantsUpdate === "function") {
          try {
            await message.sendreply(`❌ *Anti-Link Detected*\nUser removed: @${offender.split("@")[0]}`, { mentions: [offender] }).catch(() => { });
          } catch (e) {}
          await client.groupParticipantsUpdate(message.from, [offender], "remove");
        } else if (typeof message.removeParticipant === "function") {
          try { await message.sendreply(`❌ *Anti-Link Detected*\nUser removed: @${offender.split("@")[0]}`, { mentions: [offender] }).catch(() => { }); } catch (e) {}
          await message.removeParticipant(offender);
        } else {
          console.warn("[antilink] groupParticipantsUpdate / removeParticipant not available - cannot kick");
          return { acted: false, error: "kick_not_supported" };
        }
      } catch (err) {
        console.error("antilink kick error:", err);
        return { acted: false, error: err };
      }
      if (warnlib && typeof warnlib.removeWarn === "function") {
        await warnlib.removeWarn(message.from, offender).catch(() => { });
      }
      return { acted: true, action: "kick", offender, url: offenderUrl };
    }

    return { acted: false, reason: "unknown_action" };
  } catch (err) {
    console.error("antilink.enforceMessage error:", err);
    return { acted: false, error: err };
  }
}

// ----------------- Command handler -----------------
Module({
  command: "antilink",
  package: "group",
  description: "Manage anti-link settings",
})(async (message, match) => {
  try {
    if (typeof message.loadGroupInfo === "function") {
      try { await message.loadGroupInfo(); } catch (e) { console.warn("antilink: loadGroupInfo failed:", e && e.message ? e.message : e); }
    }
    if (!message.isGroup) return message.send(theme.isGroup);
    if (!message.isAdmin && !message.isFromMe) return message.send(theme.isAdmin);

    const raw = (match || "").trim();
    const lower = raw.toLowerCase();
    let cfg = await settings.getGroup(message.from, "link");
    cfg = normalizeCfg(cfg);

    if (!raw) {
      return await message.sendreply(
        `*Antilink Settings*\n\n` +
        `• Status: ${toBool(cfg.status) ? "✅ ON" : "❌ OFF"}\n` +
        `• Action: ${cfg.action}\n` +
        `• Ignore (not_del): ${cfg.not_del.length ? cfg.not_del.join(", ") : "None"}\n\n` +
        `Commands:\n` +
        `• antilink on|off\n` +
        `• antilink action kick|warn|null\n` +
        `• antilink set_warn <number>\n` +
        `• antilink not_del add <url|domain>\n` +
        `• antilink not_del remove <url|domain>\n` +
        `• antilink not_del list\n` +
        `• antilink reset`
      );
    }

    // on / off
    if (lower === "on" || lower === "off") {
      cfg.status = lower === "on";
      await settings.setGroupPlugin(message.from, "link", cfg);
      await message.react("✅");
      return await message.send(cfg.status ? "✅ Antilink enabled" : "❌ Antilink disabled");
    }

    // action
    if (lower.startsWith("action")) {
      const val = raw.replace(/action/i, "").trim().toLowerCase();
      if (!["kick", "warn", "null"].includes(val)) {
        await message.react("❌");
        return await message.send("Invalid action. Use: kick | warn | null");
      }
      cfg.action = val;
      await settings.setGroupPlugin(message.from, "link", cfg);
      await message.react("✅");
      return await message.send(`⚙️ Antilink action set to *${val}*`);
    }

    // set_warn => change group-level warn limit
    if (lower.startsWith("set_warn")) {
      const num = parseInt(raw.replace(/set_warn/i, "").trim());
      if (isNaN(num) || num < 1 || num > 50) {
        await message.react("❌");
        return await message.send("Provide a valid number between 1 and 50");
      }
      if (!warnlib || typeof warnlib.setWarnLimit !== "function") {
        await message.react("❌");
        return await message.send("Warnlib doesn't support setWarnLimit");
      }
      await warnlib.setWarnLimit(message.from, num);
      await message.react("✅");
      return await message.send(`✅ Warn limit set to ${num}`);
    }

    // not_del subcommands
    if (lower.startsWith("not_del")) {
      const tail = raw.replace(/not_del/i, "").trim();
      if (!tail) {
        await message.react("❌");
        return await message.send("Usage: not_del add <url> | not_del remove <url> | not_del list");
      }
      const [sub, ...rest] = tail.split(/\s+/);
      const payload = rest.join(" ").trim();
      if (sub === "add") {
        if (!payload) {
          await message.react("❌");
          return await message.send("Provide a URL or domain to add");
        }
        if (!payload.includes(".") && !/^https?:\/\//i.test(payload) && !/^www\./i.test(payload)) {
          await message.react("❌");
          return await message.send("Please provide a valid URL or domain (e.g. example.com or https://example.com)");
        }
        if (!cfg.not_del.includes(payload)) cfg.not_del.push(payload);
        await settings.setGroupPlugin(message.from, "link", cfg);
        await message.react("✅");
        return await message.send("✅ URL/domain added to ignore list");
      } else if (sub === "remove") {
        if (!payload) {
          await message.react("❌");
          return await message.send("Provide a URL or domain to remove");
        }
        cfg.not_del = (cfg.not_del || []).filter(x => x.toLowerCase() !== payload.toLowerCase());
        await settings.setGroupPlugin(message.from, "link", cfg);
        await message.react("✅");
        return await message.send("✅ URL/domain removed from ignore list");
      } else if (sub === "list") {
        await message.react("✅");
        return await message.send(`Ignored patterns:\n${cfg.not_del.length ? cfg.not_del.join("\n") : "None"}`);
      } else {
        await message.react("❌");
        return await message.send("Invalid not_del subcommand. Use add/remove/list");
      }
    }

    // reset
    if (lower === "reset") {
      cfg = defaultConfig();
      await settings.setGroupPlugin(message.from, "link", cfg);
      await message.react("✅");
      return await message.send("♻️ Antilink settings reset to defaults (enabled, action: kick)");
    }

    await message.react("❌");
    return await message.send("Invalid command. Type `antilink` to see help");
  } catch (e) {
    console.error("antilink command handler error:", e);
    try { await message.send("An error occurred while processing the antilink command."); } catch {}
  }
});

// auto trigger on text messages
Module({ on: "text" })(async (message) => {
  try {
    const res = await enforceMessage(message);
    if (res && res.acted) {
      console.log("[antilink] action:", res.action, "details:", res);
    }
  } catch (e) {
    console.error("antilink auto error:", e);
  }
});