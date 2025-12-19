const { makeWASocket, Browsers } = require("@whiskeysockets/baileys");
const cache = require("./lib/group-cache");
let conn = null;

async function startSocket(state) {
  conn = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logga),
    },
    version,
    browser: Browsers.macOS("Chrome"),
    logger: logga,
    downloadHistory: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    getMessage: false,
    emitOwnEvents: false,
    generateHighQualityLinkPreview: true,
    defaultQueryTimeoutMs: undefined,
    // IMPORTANT: don't call conn.groupMetadata from here.
    // Return cached metadata or undefined — Baileys will fetch from network when needed.
    cachedGroupMetadata: async (jid) => {
      return cache.getCached(jid);
    }
  });

  // When connection opens, prefetch all groups and populate cache
  conn.ev.on("connection.update", async (update) => {
    try {
      if (update.connection === "open") {
        // prefetch groups in one call
        const added = await cache.prefetchAllParticipating(conn);
        console.log(`Group cache prefetch complete — cached ${added} groups`);
      }
    } catch (err) {
      console.error("Error during connection.update handler:", err);
    }
  });

  // group participant changes
  conn.ev.on("group-participants.update", async (event) => {
    try {
      // event: { id, participants: [jid,...], action: 'add'|'remove'|'promote'|'demote' }
      const jid = event.id;
      const cached = cache.getCached(jid) || (await cache.getGroupMetadata(conn, jid).catch(() => ({ id: jid, participants: [] })));
      let participants = Array.isArray(cached.participants) ? cached.participants.slice() : [];

      // normalize incoming participants array (they're usually strings)
      const incoming = (event.participants || []).map(p => (typeof p === "string" ? p : (p.id || p)));
      const byId = new Map(participants.map(p => [p.id, { ...p }]));

      if (event.action === "add") {
        for (const pid of incoming) {
          if (!byId.has(pid)) byId.set(pid, { id: pid, admin: null });
        }
      } else if (event.action === "remove") {
        for (const pid of incoming) {
          byId.delete(pid);
        }
      } else if (event.action === "promote" || event.action === "demote") {
        const newAdminValue = event.action === "promote" ? "admin" : null;
        for (const pid of incoming) {
          const cur = byId.get(pid);
          if (cur) {
            cur.admin = newAdminValue;
            byId.set(pid, cur);
          } else {
            // if participant wasn't in cache, add them with admin state
            byId.set(pid, { id: pid, admin: newAdminValue });
          }
        }
      }

      const updatedParticipants = Array.from(byId.values());
      // update cached metadata with new participants array
      cache.updateCached(jid, { ...cached, participants: updatedParticipants });

      // run plugins that care about this event (your plugin system)
      for (const plugin of plugins) {
        if (plugin.on === "group-participants.update") {
          try {
            await plugin.exec(null, event, conn);
          } catch (e) {
            console.error("plugin exec error:", e);
          }
        }
      }
    } catch (err) {
      console.error(`Failed to handle participant update ${event.id}:`, err);
      cache.deleteCached(event.id);
    }
  });

  // groups metadata update (title, desc, announce, restrict, etc.)
  conn.ev.on("groups.update", async (events) => {
    for (const event of events) {
      try {
        // merge event fields into cache, then fetch fresh metadata to be safe
        const jid = event.id;
        const cached = cache.getCached(jid) || {};
        cache.updateCached(jid, { ...cached, ...event });

        // prefer fetching full metadata once (will update participants, desc, subject)
        try {
          const md = await conn.groupMetadata(jid);
          cache.setCached(jid, md);
        } catch (err) {
          // if single fetch fails, keep the merged partial update
          console.warn(`Failed to fetch metadata for ${jid}:`, err?.message ?? err);
        }
      } catch (err) {
        console.error(`Failed to update group ${event.id}:`, err?.message ?? err);
        cache.deleteCached(event.id);
      }
    }
  });

  return conn;
}

module.exports = { startSocket };