const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
} = require("baileys");
const pino = require("pino");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const config = require("../config.js");
const manager = require("./manager");
const fs = require("fs");
const handleAnti = require("./anti");
const serialize = require("./serialize");
const { loadPlugins } = require("./plugins");
const { groupDB, personalDB, deleteSession } = require("./database");
//const { connectDB, User } = require("./database/model");
const groupCache = new Map();

async function deathuser(file_path) {
  try {
    await deleteSession(file_path);
    const logoutSessionDir = path.resolve(process.cwd(), "sessions", file_path);
    if (fs.existsSync(logoutSessionDir)) {
      fs.rmSync(logoutSessionDir, { recursive: true, force: true });
      console.log(`✅ Session folder deleted: ${logoutSessionDir}`);
    }
  } catch (err) {
    console.error("❌ Error deleting session:", err);
  }
}

const connect = async (file_path) => {
  try {
    if (manager.isConnected(file_path)) {
      console.log(`✓ [${file_path}] Already connected`);
      return;
    }

    // Check if already connecting
    if (manager.isConnecting(file_path)) {
      console.log(
        `⏳ [${file_path}] Already connecting, skipping duplicate call`
        // Check if already connected
      );
      return;
    }

    // Mark as connecting
    manager.setConnecting(file_path);
    console.log(`🔄 [${file_path}] Starting connection...`);
    const sessionDir = path.join(__dirname, "Session");
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);
    const logga = pino({ level: "silent" });
    // Initialize auth state
    const { state, saveCreds } = await useMultiFileAuthState(
      `./sessions/${file_path}`
    );
    const { version } = await fetchLatestBaileysVersion();
    let conn = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logga),
      },
      version,
      browser: Browsers.macOS("Chrome"),
      logger: pino({ level: "silent" }),
      downloadHistory: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      getMessage: false,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: true,
    });
    conn.ev.on("creds.update", saveCreds);
    let plugins = [];

    conn.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        const fullJid = conn.user.id;
        const botNumber = fullJid.split(":")[0];
        manager.addConnection(file_path, conn);
        manager.removeConnecting(file_path);
        console.log("✅ Garfield connected");
        plugins = await loadPlugins();

        const { login = false } =
          (await personalDB(["login"], {}, "get", botNumber)) || {};

        try {
          if (login !== "true") {
            await personalDB(["login"], { content: "true" }, "set", botNumber);
            await conn.sendMessage(conn.user.id, {
              image: { url: "https://files.catbox.moe/lq7nwm.jpg" },
              caption: `*\n\n*PREFIX:* ${process.env.PREFIX}\n*MODE:* ${process.env.WORK_TYPE}\n*SUDO:* ${process.env.SUDO}\n*Made with❤️*`,
            });
          } else {
            console.log(`🍉 Connecting to WhatsApp ${botNumber}`);
          }
        } catch (error) {
          console.log("Failed to send welcome message:", error.message);
        }

        //=================================================================================
        // Unified Group Participants Handler (Welcome + Goodbye)
        //=================================================================================

        const name = "© X-kira";
        function externalPreview(profileImage, options = {}) {
          return {
            showAdAttribution: true,
            title: options.title || "Welcome Message",
            body: options.body || name,
            thumbnailUrl: profileImage || "https://i.imgur.com/U6d9F1v.png",
            sourceUrl:
              options.sourceUrl ||
              "https://whatsapp.com/channel/0029VaAKCMO1noz22UaRdB1Q",
            mediaType: 1,
            renderLargerThumbnail: true,
          };
        }
        conn.ev.on("group-participants.update", async (update) => {
          const { id: groupJid, participants, action } = update;
          if (action !== "add") return;

          // Get group metadata
          const groupMetadata = await conn
            .groupMetadata(groupJid)
            .catch(() => {});
          const groupName = groupMetadata?.subject || "Group";
          const groupSize = groupMetadata?.participants?.length || "Unknown";

          // Check welcome config
          const { welcome } =
            (await groupDB(
              ["welcome"],
              { jid: groupJid, content: {} },
              "get"
            )) || {};
          if (welcome?.status !== "true") return;

          const rawMessage = welcome.message || "Welcome &mention!";

          for (const user of participants) {
            const mentionTag = `@${user.split("@")[0]}`;

            // Get user profile pic or fallback
            let profileImage;
            try {
              profileImage = await conn.profilePictureUrl(user, "image");
            } catch {
              profileImage = "https://i.imgur.com/U6d9F1v.png";
            }

            // Replace placeholders
            let text = rawMessage
              .replace(/&mention/g, mentionTag)
              .replace(/&size/g, groupSize)
              .replace(/&name/g, groupName)
              .replace(/&pp/g, ""); // Remove &pp from message

            // Send welcome message
            if (rawMessage.includes("&pp")) {
              await conn.sendMessage(groupJid, {
                text,
                mentions: [user],
                contextInfo: {
                  externalAdReply: externalPreview(profileImage),
                },
              });
            } else {
              await conn.sendMessage(groupJid, {
                text,
                mentions: [user],
              });
            }
          }
        });

        //=================================================================================

        function externalGoodbyePreview(profileImage, options = {}) {
          return {
            showAdAttribution: true,
            title: options.title || "Goodbye Message",
            body: options.body || name,
            thumbnailUrl: profileImage || "https://i.imgur.com/U6d9F1v.png",
            sourceUrl:
              options.sourceUrl ||
              "https://whatsapp.com/channel/0029VaAKCMO1noz22UaRdB1Q",
            mediaType: 1,
            renderLargerThumbnail: true,
          };
        }
        const sentGoodbye = new Set();

        conn.ev.on("group-participants.update", async (update) => {
          const { id: groupJid, participants, action } = update;

          if (action !== "remove") return; // ✅ Only on user left

          const groupMetadata = await conn
            .groupMetadata(groupJid)
            .catch(() => {});
          const groupName = groupMetadata?.subject || "Group";
          const groupSize = groupMetadata?.participants?.length || "Unknown";

          const { exit } =
            (await groupDB(["exit"], { jid: groupJid, content: {} }, "get")) ||
            {};

          if (exit?.status !== "true") return;

          const rawMessage = exit.message || "Goodbye &mention!";

          for (const user of participants) {
            const key = `${groupJid}_${user}`;
            if (sentGoodbye.has(key)) return;
            sentGoodbye.add(key);
            setTimeout(() => sentGoodbye.delete(key), 10_000);

            const mentionTag = `@${user.split("@")[0]}`;
            let profileImage;

            try {
              profileImage = await conn.profilePictureUrl(user, "image");
            } catch {
              profileImage = "https://i.imgur.com/U6d9F1v.png";
            }

            const text = rawMessage
              .replace(/&mention/g, mentionTag)
              .replace(/&name/g, groupName)
              .replace(/&size/g, groupSize)
              .replace(/&pp/g, "");

            if (rawMessage.includes("&pp")) {
              await conn.sendMessage(groupJid, {
                text,
                mentions: [user],
                contextInfo: {
                  externalAdReply: externalGoodbyePreview(profileImage),
                },
              });
            } else {
              await conn.sendMessage(groupJid, {
                text,
                mentions: [user],
              });
            }
          }
        });

        // ==============================
        // 🔹 ANTI CALL (Reject any incoming call
        // ==============================
        const callEvents = ["call", "CB:call", "calls.upsert", "calls.update"];

        callEvents.forEach((eventName) => {
          conn.ev.on(eventName, async (callData) => {
            const anticallData = await personalDB(
              ["anticall"],
              {},
              "get",
              botNumber
            );
            if (anticallData?.anticall !== "true") return;

            try {
              const calls = Array.isArray(callData) ? callData : [callData];

              for (const call of calls) {
                console.log("Call object:", call);

                if (call.isOffer || call.status === "offer") {
                  const from = call.from || call.chatId;

                  await conn.sendMessage(from, {
                    text: "Sorry, I do not accept calls",
                  });

                  // Try different reject methods
                  if (conn.rejectCall) {
                    await conn.rejectCall(call.id, from);
                  } else if (conn.updateCallStatus) {
                    await conn.updateCallStatus(call.id, "reject");
                  }

                  console.log(`❌ Rejected call from ${from}`);
                }
              }
            } catch (err) {
              console.error(`❌ Error in ${eventName} handler:`, err);
            }
          });
        });

        //=================================================================================
        // Unified Messages & Group Update Handler
        //=================================================================================
        conn.ev.on("messages.upsert", async (m) => {
          try {
            if (m.type !== "notify") return;

            for (let msg of m.messages) {
              if (!msg?.message) continue;
              if (msg.key.fromMe) continue;

              const jid = msg.key.remoteJid;
              const participant = msg.key.participant || jid;
              const mtype = getContentType(msg.message);

              // ==============================
              // 🔹 Handle Ephemeral Message
              // ==============================
              msg.message =
                mtype === "ephemeralMessage"
                  ? msg.message.ephemeralMessage.message
                  : msg.message;

              // ==============================
              // 🔹 AUTO READ
              // ==============================
              const readData = await personalDB(
                ["autoread"],
                {},
                "get",
                botNumber
              );
              if (readData?.autoread === "true") {
                await conn.readMessages([msg.key]);
                console.log(`✅ Auto-read message from ${jid}`);
              }

              // ==============================
              // 🔹 AUTO STATUS SEEN
              // ==============================
              if (jid === "status@broadcast") {
                const seenData = await personalDB(
                  ["autostatus_seen"],
                  {},
                  "get",
                  botNumber
                );
                if (seenData?.autostatus_seen === "true") {
                  await conn.readMessages([msg.key]);
                  console.log(`👀 Auto-seen status of ${participant}`);
                }
              }

              // ==============================
              // 🔹 AUTO STATUS REACT
              // ==============================
              if (jid === "status@broadcast") {
                const reactData = await personalDB(
                  ["autostatus_react"],
                  {},
                  "get",
                  botNumber
                );
                if (reactData?.autostatus_react === "true") {
                  const emojis = [
                    "🔥",
                    "❤️",
                    "💯",
                    "😎",
                    "🌟",
                    "💜",
                    "💙",
                    "👑",
                    "🥰",
                  ];
                  const randomEmoji =
                    emojis[Math.floor(Math.random() * emojis.length)];
                  const jawadlike = await conn.decodeJid(conn.user.id);

                  await conn.sendMessage(
                    jid,
                    { react: { text: randomEmoji, key: msg.key } },
                    { statusJidList: [participant, jawadlike] }
                  );

                  console.log(
                    `🎭 Reacted to status of ${participant} with ${randomEmoji}`
                  );
                }
              }

              // ==============================
              // 🔹 AUTO TYPING
              // ==============================
              const typingData = await personalDB(
                ["autotyping"],
                {},
                "get",
                botNumber
              );
              if (
                typingData?.autotyping === "true" &&
                jid !== "status@broadcast"
              ) {
                await conn.sendPresenceUpdate("composing", jid);
                const typingDuration = Math.floor(Math.random() * 3000) + 2000;
                setTimeout(async () => {
                  try {
                    await conn.sendPresenceUpdate("paused", jid);
                  } catch (e) {
                    console.error("Error stopping typing indicator:", e);
                  }
                }, typingDuration);
              }

              // ==============================
              // 🔹 AUTO REACT (All Messages)
              // ==============================
              const settings = await personalDB(
                ["autoreact"],
                {},
                "get",
                botNumber
              );
              if (
                settings?.autoreact === "true" &&
                jid !== "status@broadcast"
              ) {
                const emojis = [
                  "😅",
                  "😎",
                  "😂",
                  "🥰",
                  "🔥",
                  "💖",
                  "🤖",
                  "🌸",
                  "😳",
                  "❤️",
                  "🥺",
                  "👍",
                  "🎉",
                  "😜",
                  "💯",
                  "✨",
                  "💫",
                  "💥",
                  "💝",
                  "💞",
                  "💘",
                  "💟",
                  "🫶",
                  "🫰",
                  "🥳",
                  "🫡",
                  "😇",
                  "😺",
                  "😸",
                  "😹",
                  "🫠",
                  "🤩",
                  "😻",
                  "💌",
                  "💤",
                  "🫂",
                  "💬",
                  "🫧",
                  "🌹",
                  "🌷",
                  "🌼",
                  "🍀",
                  "🍁",
                  "🌈",
                  "☀️",
                  "🌙",
                  "⭐",
                  "🌟",
                  "⚡",
                  "🔥",
                  "💦",
                  "❄️",
                  "🌊",
                  "🪐",
                  "🎶",
                  "🎵",
                  "🎼",
                  "🎹",
                  "🎸",
                  "🎺",
                  "🥁",
                  "🛸",
                  "🏆",
                  "🥇",
                  "🥈",
                  "🥉",
                  "🎯",
                  "🎲",
                  "🪁",
                  "🧸",
                  "🪀",
                  "🛹",
                  "🎮",
                  "🖌️",
                  "🖍️",
                  "🎨",
                  "📸",
                  "🎬",
                  "🎥",
                  "📽️",
                  "📺",
                  "🖥️",
                  "💻",
                  "📱",
                  "📲",
                  "🧩",
                  "🛎️",
                  "🔔",
                  "📢",
                  "🛍️",
                  "🪄",
                  "💎",
                  "🪙",
                  "🧧",
                  "💰",
                  "🪪",
                  "🛡️",
                  "⚔️",
                  "🏹",
                  "🗡️",
                  "🪓",
                  "🔮",
                  "🧿",
                  "🪬",
                  "🪞",
                  "🛸",
                ];
                const randomEmoji =
                  emojis[Math.floor(Math.random() * emojis.length)];
                await conn.sendMessage(jid, {
                  react: { text: randomEmoji, key: msg.key },
                });
                await new Promise((res) => setTimeout(res, 150));
              }
            }
          } catch (err) {
            console.error("❌ Unified messages.upsert error:", err);
          }
        });

        conn.ev.on("messages.upsert", async ({ messages, type }) => {
          if (type !== "notify" || !messages || !messages.length) return;
          const raw = messages[0];
          if (!raw.message) return;
          if (!plugins.length) return;
          const message = await serialize(raw, conn);
          if (!message || !message.body) return;
          console.log(
            `\nUser: ${message.sender}\nMessage: ${message.body}\nFrom: ${message.from}\n`
          );
          await handleAnti(message);
          /* await User.findOneAndUpdate(
        { jid: message.sender },
        {
          name: message.pushName || "",
          $setOnInsert: { isAdmin: false },
        },
        { upsert: true, new: true }
      );*/

          if (
            config.STATUS_REACT &&
            message.key?.remoteJid === "status@broadcast"
          ) {
            const st_id = `${message.key.participant}_${message.key.id}`;
            if (
              !kf.has(st_id) &&
              !conn.areJidsSameUser(message.key.participant, conn.user.id)
            ) {
              const reactions = ["❤️", "❣️", "🩷"];
              try {
                await conn.sendMessage(
                  "status@broadcast",
                  {
                    react: {
                      text: reactions[
                        Math.floor(Math.random() * reactions.length)
                      ],
                      key: message.key,
                    },
                  },
                  { statusJidList: [message.key.participant] }
                );
                kf.add(st_id);
              } catch (e) {
                console.error(e);
              }
            }
          }

          const cmdEvent =
            config.WORK_TYPE === "public" ||
            (config.WORK_TYPE === "private" &&
              (message.fromMe || process.env.SUDO));
          if (!cmdEvent) return;
          const prefix = config.prefix || process.env.PREFIX;
          if (message.body.startsWith(prefix)) {
            const [cmd, ...args] = message.body
              .slice(prefix.length)
              .trim()
              .split(" ");
            const match = args.join(" ");
            const found = plugins.find((p) => p.command === cmd);
            if (found) {
              await found.exec(message, match);
              return;
            }
          }

          for (const plugin of plugins) {
            if (plugin.on === "text" && message.body) {
              await plugin.exec(message);
            }
          }
        });
      }

      if (connection === "close") {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = lastDisconnect?.error?.output?.payload?.error;

        console.log("❌ Connection closed");
        console.log("Status Code:", statusCode);
        console.log("Reason:", reason);
        console.log(
          "Error:",
          lastDisconnect?.error?.message || lastDisconnect?.error
        );

        manager.removeConnection(file_path);
        manager.removeConnecting(file_path);

        // Handle different disconnect reasons using DisconnectReason
        switch (statusCode) {
          case DisconnectReason.loggedOut: // 401
            console.log("⚠️ Device logged out. Please scan QR code again.");
            console.log("🗑️ Deleting session...");
            await deathuser(file_path);

            break;

          case DisconnectReason.forbidden: // 403
            console.log("🚫 Connection forbidden. Account may be banned.");
            console.log("🗑️ Deleting session...");
            await deathuser(file_path);

            break;

          case DisconnectReason.badSession: // 400
            console.log("⚠️ Bad session. Deleting and reconnecting...");
            await deathuser(file_path);

            setTimeout(connect, 3000);
            break;

          case DisconnectReason.connectionClosed: // 428
            console.log("📡 Connection closed. Reconnecting in 2s...");
            setTimeout(connect, 2000);
            break;

          case DisconnectReason.connectionLost: // 408
            console.log("⏱️ Connection lost. Reconnecting in 3s...");
            setTimeout(connect, 3000);
            break;

          case DisconnectReason.connectionReplaced: // 440
            console.log("🔄 Connection replaced by another session.");
            console.log("🗑️ Deleting old session...");
            await deathuser(file_path);

            break;

          case DisconnectReason.timedOut: // 408
            console.log("⏱️ Connection timeout. Reconnecting in 3s...");
            setTimeout(connect, 3000);
            break;

          case DisconnectReason.restartRequired: // 515
            console.log("🔄 Restart required. Reconnecting in 3s...");
            setTimeout(connect, 3000);
            break;

          case DisconnectReason.multideviceMismatch: // 411
            console.log("🔄 Multidevice mismatch. Reconnecting in 5s...");
            setTimeout(connect, 5000);
            break;

          case DisconnectReason.unavailableService: // 503
            console.log("⚠️ Service unavailable. Reconnecting in 10s...");
            setTimeout(connect, 10000);
            break;

          default:
            const shouldReconnect =
              statusCode !== DisconnectReason.loggedOut &&
              statusCode !== DisconnectReason.forbidden &&
              statusCode !== DisconnectReason.connectionReplaced;

            if (shouldReconnect) {
              console.log(
                `🔄 Unexpected disconnect (${
                  statusCode || "unknown"
                }). Reconnecting in 3s...`
              );
              setTimeout(connect, 3000);
            } else {
              console.log("⛔ Connection terminated. Not reconnecting.");
              console.log("🗑️ Deleting session...");
              await deathuser(file_path);
            }
            break;
        }
      }
    });
  } catch (err) {
    console.log(err);
    manager.removeConnecting(file_path);
  }
};

class WhatsApp {
  constructor(fp) {
    this.path = fp; // unique folder per user
    this.conn = null;
  }

  async connect() {
    this.conn = await connect(this.path);
    return this.conn;
  }
}

module.exports = { WhatsApp, connect };
