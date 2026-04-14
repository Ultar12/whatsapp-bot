const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  useMultiFileAuthState,
  DisconnectReason,
  delay
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;
const QRCode = require('qrcode');

const telegramService = require('../../telegramService');

class BaileysService {
  constructor() {
    this.sock = null;
    // Updated folder name for a fresh start with your Postgres move
    this.authDir = path.join(process.cwd(), 'session_v11_postgres');
    this.logger = pino({ level: 'silent' });

    this.messageHandlers = [];
    this.latestPairingCode = null;

    this.reconnecting = false;
    this.processListenersAttached = false;
    this.lastQR = null;

    this.attachProcessListeners();
  }

  attachProcessListeners() {
    if (this.processListenersAttached) return;

    process.on('REQUEST_PAIRING_CODE', async (phoneNumber) => {
      await this.requestManualCode(phoneNumber);
    });

    process.on('REQUEST_QR_SCAN', async () => {
      await this.resetConnection();
    });

    this.processListenersAttached = true;
  }

  onMessage(callback) {
    this.messageHandlers.push(callback);
  }

  isConnected() {
    return this.sock?.user?.id != null;
  }

  async initialize() {
    try {
      console.log('🔄 Initializing Baileys Service...');

      await fs.mkdir(this.authDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners();
        } catch {}
      }

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: this.logger,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
      });

      if (!this.sock) throw new Error("Socket init failed");

      this.sock.ev.on('connection.update', (update) =>
        this.handleConnectionUpdate(update)
      );

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('messages.upsert', (msg) =>
        this.handleIncomingMessage(msg)
      );

      return this.sock;
    } catch (error) {
      console.error('❌ Initialization error:', error);
      throw error;
    }
  }

  async handleConnectionUpdate(update) {
    try {
      const { connection, lastDisconnect, qr } = update;

      // Handle QR Code delivery to Telegram
      if (qr && qr !== this.lastQR && !this.sock?.authState?.creds?.registered) {
        this.lastQR = qr;
        console.log('📡 QR Received → sending to Telegram...');
        try {
          const qrBuffer = await QRCode.toBuffer(qr);
          await telegramService.sendQR(qrBuffer);
        } catch (err) {
          console.error('❌ QR send failed:', err);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;

        if (statusCode !== DisconnectReason.loggedOut) {
          console.log('🔄 Connection lost → reconnecting...');
          if (this.reconnecting) return;
          this.reconnecting = true;

          setTimeout(async () => {
            this.reconnecting = false;
            await this.initialize();
          }, 5000);
        } else {
          console.log('🚪 Logged out. Clearing session...');
          await this.resetConnection();
        }
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp Connected!');
        this.reconnecting = false;
        this.lastQR = null;

        const adminId = process.env.TELEGRAM_ADMIN_ID;
        if (adminId) {
          await telegramService.bot.api.sendMessage(
            adminId,
            "🎉 *WhatsApp is now linked and active!*",
            { parse_mode: "Markdown" }
          );
        }
      }
    } catch (err) {
      console.error('❌ Connection handler error:', err);
    }
  }

  /**
   * FIXED: Removed the check for this.sock.user
   * Now allows pairing code requests before the user is officially "connected"
   */
  async requestManualCode(phoneNumber) {
    try {
      if (!this.sock) throw new Error('Socket not initialized');

      console.log(`🔢 Requesting pairing code for ${phoneNumber}`);

      // Give the socket a few seconds to stabilize after initialization
      await delay(3000); 

      // Request the 8-digit code from WhatsApp
      const code = await this.sock.requestPairingCode(phoneNumber);

      this.latestPairingCode = code;
      console.log(`🚀 Pairing Code Generated: ${code}`);

      // Send the code to your Telegram Bot
      await telegramService.sendCode(code);
    } catch (err) {
      console.error('❌ Pairing code failed:', err);
      const adminId = process.env.TELEGRAM_ADMIN_ID;
      if (adminId) {
          await telegramService.bot.api.sendMessage(adminId, "❌ *Pairing Request Failed*\nCheck console for details.", { parse_mode: "Markdown" });
      }
    }
  }

  async handleIncomingMessage(message) {
    try {
      const msg = message?.messages?.[0];
      if (!msg) return;

      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid || remoteJid.endsWith('@g.us')) return;

      const messageText =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      const phoneNumber = remoteJid.split('@')[0];

      for (const handler of this.messageHandlers) {
        await handler({
          from: phoneNumber,
          body: messageText,
          fullMessage: msg,
        });
      }
    } catch (error) {
      console.error('❌ Message handling error:', error);
    }
  }

  async sendMessage(phoneNumber, messageText) {
    try {
      if (!this.sock?.user) throw new Error('Not connected');

      const jid = phoneNumber.includes('@')
        ? phoneNumber
        : `${phoneNumber}@s.whatsapp.net`;

      await this.sock.sendMessage(jid, { text: messageText });
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async resetConnection() {
    console.log("♻️ Resetting session...");
    try {
      if (this.sock) {
        try { await this.sock.logout(); } catch {}
        try { this.sock.ev.removeAllListeners(); } catch {}
      }
      await fs.rm(this.authDir, { recursive: true, force: true });
    } catch (err) {
      console.error('❌ Reset error:', err);
    }

    this.sock = null;
    return this.initialize();
  }
}

module.exports = new BaileysService();