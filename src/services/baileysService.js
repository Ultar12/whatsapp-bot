const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');

// Import telegram service so we can send the code to your chat
const telegramService = require('../../telegramService');

class BaileysService {
  constructor() {
    this.latestPairingCode = null;
    this.sock = null;
    this.authDir = path.join(process.cwd(), 'session_v3');
    this.messageHandlers = [];
    this.logger = pino({ level: 'error' });
  }

  onMessage(callback) {
    this.messageHandlers.push(callback);
  }

  isConnected() {
    return this.sock && this.sock.user;
  }

  async initialize() {
    try {
      console.log('🔄 Initializing Baileys...');
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

      console.log('✅ Baileys sequence active - Checking for pairing request...');
      return this.sock;
    } catch (error) {
      console.error('❌ Error initializing Baileys:', error);
      throw error;
    }
  }

  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    // FORCED PAIRING LOGIC
    if (qr && !this.sock.authState.creds.registered) {
      console.log('📡 QR Received. Attempting to convert to Pairing Code for: 2348144821073');
      try {
        const code = await this.sock.requestPairingCode("2348144821073");
        this.latestPairingCode = code;
        
        console.log('\n' + '⭐'.repeat(20));
        console.log(`🚀 YOUR CODE IS: ${code}`);
        console.log('⭐'.repeat(20) + '\n');

        // NEW: This sends the code directly to your Telegram bot!
        await telegramService.sendCode(code);
        
      } catch (err) {
        console.log('⚠️ Pairing request failed, retrying in next cycle...');
      }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('🔄 Connection paused. Waiting 20s...');
        setTimeout(() => this.initialize(), 20000);
      }
    } else if (connection === 'open') {
      console.log('✅ SUCCESS! WhatsApp is connected.');
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
      console.log(`📨 Message from ${phoneNumber}: ${messageText}`);

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

  async sendMessageWithImage(phoneNumber, messageText, imageUrl) {
    try {
      if (!this.sock) throw new Error('Not connected');
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      await this.sock.sendMessage(jid, { image: Buffer.from(response.data), caption: messageText });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async sendBulkMessages(recipients, messageText, imageUrl = null) {
    const results = { successful: [], failed: [] };
    for (const recipient of recipients) {
      const res = imageUrl ? await this.sendMessageWithImage(recipient, messageText, imageUrl) : await this.sendMessage(recipient, messageText);
      if (res.success) results.successful.push(recipient);
      else results.failed.push({ recipient, error: res.error });
      await new Promise(r => setTimeout(r, 3500));
    }
    return results;
  }

  async resetConnection() {
    if (this.sock) await this.sock.end();
    await fs.rm(this.authDir, { recursive: true, force: true });
    this.initialize();
  }
}

module.exports = new BaileysService();