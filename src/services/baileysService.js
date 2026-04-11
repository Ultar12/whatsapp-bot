const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const QRCode = require('qrcode'); // Need this for the QR generation

// Import telegram service
const telegramService = require('../../telegramService');

class BaileysService {
  constructor() {
    this.latestPairingCode = null;
    this.sock = null;
    // Using a brand new folder to ensure a clean start
    this.authDir = path.join(process.cwd(), 'session_v10_fresh');
    this.messageHandlers = [];
    this.logger = pino({ level: 'error' });

    // Listen for the button click event from Telegram
    process.on('REQUEST_PAIRING_CODE', async (phoneNumber) => {
      await this.requestManualCode(phoneNumber);
    });

    process.on('REQUEST_QR_SCAN', async () => {
       await this.resetConnection();
    });
  }

  onMessage(callback) {
    this.messageHandlers.push(callback);
  }

  isConnected() {
    return this.sock && this.sock.user;
  }

  async initialize() {
    try {
      console.log('🔄 Initializing Baileys Hybrid Service...');
      try { await fs.mkdir(this.authDir, { recursive: true }); } catch (e) {}

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: this.logger,
        browser: ["Ubuntu", "Chrome", "20.0.04"], 
        syncFullHistory: false,
        connectTimeoutMs: 60000, 
        defaultQueryTimeoutMs: 0,
      });

      this.sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('messages.upsert', (message) => this.handleIncomingMessage(message));

      return this.sock;
    } catch (error) {
      console.error('❌ Error initializing Baileys:', error);
      throw error;
    }
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    // 1. If a QR is received, send it as a photo to Telegram
    if (qr && !this.sock.authState.creds.registered) {
      console.log('📡 QR Received. Sending to Telegram Admin...');
      try {
        const qrBuffer = await QRCode.toBuffer(qr);
        await telegramService.sendQR(qrBuffer);
      } catch (err) {
        console.error('❌ Failed to send QR to Telegram:', err);
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('🔄 Connection lost. Reconnecting in 10s...');
        setTimeout(() => this.initialize(), 10000);
      }
    } else if (connection === 'open') {
      console.log('✅ SUCCESS! WhatsApp is connected.');
      const adminId = process.env.TELEGRAM_ADMIN_ID;
      if (adminId) {
          await telegramService.bot.api.sendMessage(adminId, "🎉 *WhatsApp is now linked and active!*", { parse_mode: "Markdown" });
      }
    }
  }

  // 2. NEW: Function to manually request the 8-digit code when button is clicked
  async requestManualCode(phoneNumber) {
    try {
      console.log(`🔢 Requesting 8-digit code for: ${phoneNumber}`);
      // Small delay to ensure socket is ready
      await delay(3000); 
      const code = await this.sock.requestPairingCode(phoneNumber);
      this.latestPairingCode = code;
      
      console.log(`🚀 CODE GENERATED: ${code}`);
      await telegramService.sendCode(code);
    } catch (err) {
      console.error('❌ Pairing code request failed:', err);
    }
  }

  async handleIncomingMessage(message) {
    try {
      const msg = message.messages[0];
      if (!msg.message || msg.key.remoteJid.endsWith('@g.us')) return;

      const messageText = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || 
                          msg.message.imageMessage?.caption || '';

      const phoneNumber = msg.key.remoteJid.split('@')[0];
      
      for (const handler of this.messageHandlers) {
        await handler({ from: phoneNumber, body: messageText, fullMessage: msg });
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  async sendMessage(phoneNumber, messageText) {
    try {
      if (!this.sock) throw new Error('Not connected');
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      await this.sock.sendMessage(jid, { text: messageText });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async resetConnection() {
    console.log("♻️ Resetting session for fresh link...");
    if (this.sock) {
        try { await this.sock.logout(); } catch (e) {}
        try { await this.sock.end(); } catch (e) {}
    }
    await fs.rm(this.authDir, { recursive: true, force: true });
    return this.initialize();
  }
}

module.exports = new BaileysService();