require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');

// ============ 📍 IMPORT CORE SERVICES (UPDATED PATHS) ============
// We added './src/' to these so the server can find them in their new home
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

// This one is in the same folder as server.js, so no 'src' needed
const telegramService = require('./telegramService');

const app = express();
const PORT = process.env.PORT || 3000;


// ============ MIDDLEWARE ============
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

// ============ 🔓 PUBLIC ROUTES (NO PASSWORD NEEDED) ============

/**
 * NEW: The "Emergency" Pairing Code Viewer
 * This is ABOVE the auth middleware so you can actually see your code!
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
        <p>1. Open WhatsApp on your phone.</p>
        <p>2. Link a device -> <b>Link with phone number instead</b>.</p>
        <p>3. Enter your phone number in the bot.</p>
        <p>4. Once you click "Next" on your phone, <b>Refresh this page</b>.</p>
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

// Apply authentication middleware to everything below this line
app.use(authService.adminAuthMiddleware());

/**
 * Get WhatsApp QR Code (For scan method)
 */
app.get('/qr-code', async (req, res) => {
  try {
    const qrCodeData = baileysService.getLatestQRCode();
    if (!qrCodeData) return res.status(503).send('<h1>QR Loading... Refresh in 5s</h1>');
    
    const dataURL = await QRCode.toDataURL(qrCodeData, { width: 400 });
    res.send(`<div style="text-align:center"><h1>Scan Me</h1><img src="${dataURL}"></div>`);
  } catch (err) {
    res.status(500).json({ error: 'QR Error' });
  }
});

// ============ WEBHOOKS ============

app.post('/webhook/messages', async (req, res) => {
  try {
    await messageHandler.handleIncomingMessage(req.body);
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============ API ENDPOINTS (COMMODITIES, ANALYTICS, ETC) ============

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

startServer();

module.exports = app;

// ============ 📡 THE SIGNAL LISTENER (ADD THIS!) ============
// This listens for the /link command from Telegram
process.on('REQUEST_PAIRING_CODE', async (phoneNumber) => {
  try {
    console.log(`📡 Signal received! Requesting code for: ${phoneNumber}`);
    
    // 1. Tell the WhatsApp service to get a code
    const code = await baileysService.sock.requestPairingCode(phoneNumber);
    
    // 2. Save it so the webpage /get-my-code can see it
    baileysService.latestPairingCode = code;
    
    console.log(`✅ Code generated: ${code}`);
    
    // 3. Send the code back to your Telegram bot
    await telegramService.sendCode(code);
    
  } catch (err) {
    console.error("❌ Pairing Error:", err);
  }
});