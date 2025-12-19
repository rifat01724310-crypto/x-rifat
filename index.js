const express = require("express");
const { WhatsApp } = require("./lib/index");
const config = require("./config.js");
const app = express();
const PORT = process.env.PORT || 8000;
const db = require('./lib/database/settingdb');
app.use(express.json());

// ==================== ROUTES ====================
app.get("/", (req, res) => {
  res.json({
    status: "online",
    timestamp: new Date().toISOString(),
  });
});
// ================================================
// Start server and initialize WhatsApp session (if configured)
app.listen(PORT, async () => {
   try {
    global.baileys = await import("baileys");
     console.log(`Server running on port ${PORT}`);
  console.log("Initializing databases...");
   await db.init();
  console.log('DB initialized. startup:', db.getStartupTime());
  const sessionId = config.SESSION_ID;
  if (!sessionId) {
    console.log("please set SESSION_ID in config.js");
    return;
  }
    const wa = new WhatsApp('x-kira');
    await wa.connect();
    console.log(`WhatsApp session '${sessionId}' initialized`);
  } catch (err) {
    console.error("Failed to initialize WhatsApp session:", err?.message || err);
  }
});

process.on("unhandledRejection", (err) => console.error("UnhandledRejection:", err));
process.on("uncaughtException", (err) => {
  console.error("UncaughtException:", err);
  process.exit(1);
});
