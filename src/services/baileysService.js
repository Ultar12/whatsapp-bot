const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;
const qrcodeTerminal = require('qrcode-terminal');
const axios = require('axios');

class BaileysService {
  constructor() {
    this.sock = null;
    this.authDir = path.join(process.cwd(), 'auth_info');
    this.messageHandlers = [];
    this.logger = pino({ level: 'error' });
    this.latestQRCode = null;
  }

  // This is the function server.js is looking for!
  onMessage(callback) {
    this.messageHandlers.push(callback);
  }
  isConnected() {
    return this.sock && this.sock.user;
  }
  async initialize() {
    try {
      console.log('🔄 Initializing Baileys...');
      try {
        await fs.mkdir(this.authDir, { recursive: true });
      } catch (e) {}

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: this.logger,
        browser: ['WhatsApp Bot', 'Chrome', '120.0'],
        syncFullHistory: false,
      });

      this.sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('messages.upsert', (message) => this.handleIncomingMessage(message));

      console.log('✅ Baileys initialization sequence complete');
      return this.sock;
    } catch (error) {
      console.error('❌ Error initializing Baileys:', error);
      throw error;
    }
  }

 async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.latestQRCode = qr;
      // We are adding a massive visual border to help you spot it
      console.log('\n\n' + '########################################'.repeat(3));
      console.log('      🚨 SCAN THIS QR CODE NOW 🚨      ');
      console.log('########################################'.repeat(3) + '\n');
      
      // We use the 'large' version so it doesn't compress and disappear in Render
      qrcodeTerminal.generate(qr, { small: false });
      
      console.log('\n' + '########################################'.repeat(3) + '\n\n');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        // We are increasing this to 15 seconds to give the terminal a break
        console.log('🔄 Connection paused. Waiting 15 seconds before retry...');
        setTimeout(() => this.initialize(), 15000);
      } else {
        console.log('❌ Device logged out.');
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully!');
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

// Ensure we are exporting a new instance of the class
module.exports = new BaileysService();