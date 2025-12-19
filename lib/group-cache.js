// lib/group-cache.js
// Robust in-memory cache for group metadata + inflight protection

const groups = new Map();   // jid -> GroupMetadata
const inflight = new Map(); // jid -> Promise<GroupMetadata>

/**
 * Normalize a participants array:
 * Accepts array of strings or array of objects and returns [{ id, admin? }, ...]
 */
function normalizeParticipants(participants = []) {
  return participants.map(p => {
    if (!p) return null;
    if (typeof p === "string") return { id: p, admin: null };
    // if it's already an object, ensure it has id
    return { id: p.id || p.jid || p, admin: p.admin ?? p.isAdmin ?? null };
  }).filter(Boolean);
}

function getCached(jid) {
  return groups.get(jid);
}

function setCached(jid, metadata) {
  if (!jid || !metadata) return;
  // ensure participants are normalized if present
  const meta = { ...metadata };
  if (Array.isArray(meta.participants)) {
    meta.participants = normalizeParticipants(meta.participants);
  }
  groups.set(jid, meta);
}

function deleteCached(jid) {
  groups.delete(jid);
  inflight.delete(jid);
}

function listCachedJids() {
  return Array.from(groups.keys());
}

/**
 * Fetch group metadata with inflight dedupe
 * If cache exists, returns it; otherwise fetches via conn.groupMetadata
 */
async function getGroupMetadata(conn, jid) {
  if (!jid) throw new Error("jid required");
  const cached = groups.get(jid);
  if (cached) return cached;

  if (inflight.has(jid)) return inflight.get(jid);

  const p = (async () => {
    try {
      const md = await conn.groupMetadata(jid);
      // normalize participants
      if (md && Array.isArray(md.participants)) {
        md.participants = normalizeParticipants(md.participants);
      }
      groups.set(jid, md);
      return md;
    } catch (err) {
      groups.delete(jid);
      throw err;
    } finally {
      inflight.delete(jid);
    }
  })();

  inflight.set(jid, p);
  return p;
}

/**
 * Merge/overwrite updates into cached metadata
 * updateObj can contain partial fields (subject, desc, participants, etc.)
 */
function updateCached(jid, updateObj) {
  if (!jid || !updateObj) return;
  const cached = groups.get(jid) || {};
  const merged = { ...cached, ...updateObj };
  if (Array.isArray(updateObj.participants)) {
    // If update sends participants, normalize and merge by id to avoid duplicates
    const existing = normalizeParticipants(cached.participants || []);
    const incoming = normalizeParticipants(updateObj.participants || []);
    const map = new Map();
    for (const p of existing) map.set(p.id, p);
    for (const p of incoming) map.set(p.id, { ...map.get(p.id), ...p });
    merged.participants = Array.from(map.values());
  } else if (Array.isArray(merged.participants)) {
    merged.participants = normalizeParticipants(merged.participants);
  }
  groups.set(jid, merged);
}

/**
 * Prefetch all groups the socket participates in.
 * Uses conn.groupFetchAllParticipating() when available.
 * On success returns number of groups cached.
 */
async function prefetchAllParticipating(conn) {
  if (!conn || typeof conn.groupFetchAllParticipating !== "function") {
    return 0;
  }
  try {
    const all = await conn.groupFetchAllParticipating();
    // all: { [jid]: GroupMetadata }
    let count = 0;
    for (const [jid, md] of Object.entries(all || {})) {
      if (!md) continue;
      // normalize participants
      if (Array.isArray(md.participants)) md.participants = normalizeParticipants(md.participants);
      groups.set(jid, md);
      count++;
    }
    return count;
  } catch (err) {
    // don't crash startup on prefetch errors
    console.error("prefetchAllParticipating failed:", err?.message ?? err);
    return 0;
  }
}

module.exports = {
  groups,
  getCached,
  setCached,
  deleteCached,
  listCachedJids,
  getGroupMetadata,
  updateCached,
  prefetchAllParticipating
};