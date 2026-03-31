const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, MessageType, DisconnectReason, proto } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;

class BaileysService {
  constructor() {
    this.sock = null;
    this.authDir = path.join(process.cwd(), 'auth_info');
    this.messageHandlers = [];
    this.logger = pino({ level: 'error' });
    this.latestQRCode = null; // Store latest QR code data
  }

  /**
   * Initialize Baileys connection
   */
  async initialize() {
    try {
      console.log('🔄 Initializing Baileys...');
      
      // Always clear old authentication on startup to get fresh QR code
      console.log('🔄 Clearing previous authentication for fresh QR code scan...');
      try {
        await fs.rm(this.authDir, { recursive: true, force: true });
        console.log('✅ Old authentication cleared. Fresh QR code will be generated now.');
      } catch (error) {
        console.log('ℹ️  No previous auth to clear (fresh start)');
      }
      
      // Ensure auth directory exists
      try {
        await fs.mkdir(this.authDir, { recursive: true });
      } catch (error) {
        // Directory may already exist
      }

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: this.logger,
        browser: ['WhatsApp Bot', 'Chrome', '120.0'],
        syncFullHistory: false,
      });

      // Handle socket events
      this.sock.ev.on('connection.update', (update) => this.handleConnectionUpdate(update));
      this.sock.ev.on('creds.update', saveCreds);
      this.sock.ev.on('messages.upsert', (message) => this.handleIncomingMessage(message));

      console.log('✅ Baileys initialized');
      return this.sock;
    } catch (error) {
      console.error('❌ Error initializing Baileys:', error);
      throw error;
    }
  }

  /**
   * Handle connection updates
   */
  async handleConnectionUpdate(update) {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📱 Scan this QR code with your WhatsApp to connect:');
      this.latestQRCode = qr; // Store QR code data
      
      // Also save QR code as image file
      try {
        const QRCode = require('qrcode');
        const qrImagePath = path.join(process.cwd(), 'whatsapp-qr.png');
        await QRCode.toFile(qrImagePath, qr);
        console.log(`✅ QR Code saved to: ${qrImagePath}`);
        console.log('📥 Visit: https://whatsapp-bot-sdwb.onrender.com/qr-code in your browser!');
      } catch (error) {
        console.log('ℹ️  Could not save QR as image, use /qr-code endpoint instead');
      }
    }

    if (connection === 'close') {
      if ((lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnecting...');
        setTimeout(() => this.initialize(), 3000);
      } else {
        console.log('❌ Device logged out');
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully!');
    } else if (connection === 'connecting') {
      console.log('⏳ Connecting to WhatsApp...');
    }
  }

  /**
   * Handle incoming messages
   */
  async handleIncomingMessage(message) {
    try {
      const msg = message.messages[0];

      if (!msg.message) return; // Ignore status updates

      const from = msg.key.remoteJid;
      const isGroup = msg.key.remoteJid.endsWith('@g.us');

      // Only handle personal messages, not groups
      if (isGroup) return;

      const messageText = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || '';

      const phoneNumber = from.split('@')[0];

      console.log(`📨 Message from ${phoneNumber}: ${messageText}`);

      // Call registered message handlers
      for (const handler of this.messageHandlers) {
        await handler({
          from: phoneNumber,
          body: messageText,
          fullMessage: msg,
        });
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  }

  /**
   * Register a message handler callback
   */
  onMessage(callback) {
    this.messageHandlers.push(callback);
  }

  /**
   * Send a text message
   */
  async sendMessage(phoneNumber, messageText) {
    try {
      if (!this.sock) {
        throw new Error('Baileys not connected');
      }

      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

      await this.sock.sendMessage(jid, {
        text: messageText,
      });

      console.log(`✅ Message sent to ${phoneNumber}`);
      return { success: true, phoneNumber };
    } catch (error) {
      console.error(`❌ Error sending message to ${phoneNumber}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send a message with image
   */
  async sendMessageWithImage(phoneNumber, messageText, imageUrl) {
    try {
      if (!this.sock) {
        throw new Error('Baileys not connected');
      }

      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;

      // Download image
      const response = await require('axios').get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(response.data, 'binary');

      await this.sock.sendMessage(jid, {
        image: imageBuffer,
        caption: messageText,
      });

      console.log(`✅ Image sent to ${phoneNumber}`);
      return { success: true, phoneNumber };
    } catch (error) {
      console.error(`❌ Error sending image to ${phoneNumber}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send bulk messages with delay
   */
  async sendBulkMessages(recipients, messageText, imageUrl = null) {
    const results = {
      successful: [],
      failed: [],
      totalAttempted: recipients.length,
    };

    for (const recipient of recipients) {
      try {
        let result;
        if (imageUrl) {
          result = await this.sendMessageWithImage(recipient, messageText, imageUrl);
        } else {
          result = await this.sendMessage(recipient, messageText);
        }

        if (result.success) {
          results.successful.push({ phone: recipient });
        } else {
          results.failed.push({ phone: recipient, error: result.error });
        }

        // Rate limiting delay (3.5 seconds as configured)
        await new Promise(resolve => setTimeout(resolve, 3500));
      } catch (error) {
        results.failed.push({ phone: recipient, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get connection status
   */
  isConnected() {
    return this.sock !== null;
  }

  /**
   * Disconnect Baileys
   */
  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.end();
        this.sock = null;
        console.log('✅ Baileys disconnected');
      }
    } catch (error) {
      console.error('Error disconnecting Baileys:', error);
    }
  }

  /**
   * Get latest QR code
   */
  getLatestQRCode() {
    return this.latestQRCode;
  }

  /**
   * Reset connection and generate new QR code
   */
  async resetConnection() {
    try {
      console.log('🔄 Resetting WhatsApp connection...');
      
      // Disconnect if already connected
      if (this.sock) {
        await this.sock.end();
        this.sock = null;
      }

      // Clear authentication
      try {
        await fs.rm(this.authDir, { recursive: true, force: true });
        console.log('✅ Cleared old authentication');
      } catch (error) {
        console.log('ℹ️  No previous auth to clear');
      }

      // Clear stored QR code
      this.latestQRCode = null;

      // Reinitialize to generate fresh QR code
      console.log('🔄 Reinitializing with fresh QR code...');
      setTimeout(() => this.initialize(), 500);
    } catch (error) {
      console.error('❌ Error resetting connection:', error);
    }
  }
}

module.exports = new BaileysService();
