require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');

// ============ 📍 IMPORT CORE SERVICES (UPDATED PATHS) ============
const db = require('./src/database/db');
const messageHandler = require('./src/handlers/messageHandler');
const { BulkMessagingService, UpdateBroadcastService } = require('./src/handlers/bulkMessagingHandler');
const subscriptionService = require('./src/services/subscriptionService');
const { CommodityService } = require('./src/database/services');
const authService = require('./src/services/authService');
const linkingHandler = require('./src/handlers/linkingHandler');
const paymentHandler = require('./src/handlers/paymentHandler');
const analyticsService = require('./src/services/analyticsService');
const reportingService = require('./src/services/reportingService');
const i18nService = require('./src/services/i18nService');
const baileysService = require('./src/services/baileysService');

// This one is in the same folder as server.js
const telegramService = require('./telegramService');

const app = express();
const PORT = process.env.PORT || 3000;


// ============ MIDDLEWARE ============
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

// ============ 🔓 PUBLIC ROUTES (NO PASSWORD NEEDED) ============

/**
 * Emergency Pairing Code Viewer
 */
app.get('/get-my-code', (req, res) => {
  if (baileysService.latestPairingCode) {
    res.send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px; background: #e5ddd5; min-height: 100vh;">
        <div style="background: white; display: inline-block; padding: 40px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
          <h1 style="color: #25D366; margin-bottom: 10px;">🚀 WhatsApp Bot Pairing</h1>
          <p style="color: #666; font-size: 18px;">Enter this code on your phone:</p>
          <div style="background: #f0f0f0; padding: 20px; border-radius: 10px; border: 3px solid #25D366; margin: 20px 0;">
            <code style="font-size: 50px; font-weight: bold; letter-spacing: 8px; color: #333;">
              ${baileysService.latestPairingCode}
            </code>
          </div>
          <button onclick="window.location.reload()" style="background: #25D366; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-weight: bold;">Refresh Page</button>
        </div>
      </div>
    `);
  } else {
    res.send(`
      <div style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1>⏳ Waiting for Pairing Request...</h1>
        <p>Go to your Telegram Bot and click <b>Link WhatsApp</b> to generate a QR code or numeric code.</p>
      </div>
    `);
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    baileysConnected: baileysService.isConnected()
  });
});

// ============ 🔒 PRIVATE ROUTES (SECURITY GUARD STARTS HERE) ============

app.use(authService.adminAuthMiddleware());

// ============ WEBHOOKS ============

app.post('/webhook/messages', async (req, res) => {
  try {
    await messageHandler.handleIncomingMessage(req.body);
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ API ENDPOINTS ============

app.get('/api/commodities', async (req, res) => {
  const commodities = await CommodityService.getAllCommodities();
  res.json({ success: true, commodities });
});

app.post('/api/bulk-message', async (req, res) => {
  const { message, imageUrl } = req.body;
  const result = await BulkMessagingService.sendBulkMessage(message, imageUrl);
  res.json(result);
});

// ============ SERVER STARTUP ============

async function startServer() {
  try {
    await db.connect();
    console.log('✓ Database connected');

    // Initialize Telegram
    telegramService.initialize();
    console.log('✓ Telegram Command Center Active');

    await baileysService.initialize();
    console.log('✓ Baileys service initialized');

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Register Baileys background handler
baileysService.onMessage(async (messageData) => {
  const body = {
    From: `whatsapp:${messageData.from}`,
    Body: messageData.body,
    NumMedia: 0,
    ProfileName: messageData.from,
  };
  await messageHandler.handleIncomingMessage(body);
});

// ============ 🔄 TELEGRAM EVENT BRIDGES ============

// Listener for the "Link WhatsApp" or "Restart" button
process.on('REQUEST_QR_SCAN', async () => {
  try {
    console.log("♻️ Resetting session for fresh link...");
    // This triggers the resetConnection function in baileysService.js
    await baileysService.resetConnection();
  } catch (err) {
    console.error("❌ QR Request Error:", err);
  }
});

// Listener for the "Request 8-Digit Code" button
process.on('REQUEST_PAIRING_CODE', async (phoneNumber) => {
  try {
    console.log(`🔢 Requesting 8-digit code for: ${phoneNumber}`);
    // This triggers the pairing code function in baileysService.js
    await baileysService.requestManualCode(phoneNumber);
  } catch (err) {
    console.error("❌ Pairing Code Error:", err);
  }
});

startServer();

module.exports = app;