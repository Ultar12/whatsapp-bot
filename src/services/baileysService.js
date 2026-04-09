const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs').promises;
const QRCodeTerminal = require('qrcode-terminal'); // For terminal printing

class BaileysService {
  constructor() {
    this.sock = null;
    this.authDir = path.join(process.cwd(), 'auth_info');
    this.messageHandlers = [];
    this.logger = pino({ level: 'error' });
    this.latestQRCode = null;
  }

  async initialize() {
    try {
      console.log('🔄 Initializing Baileys...');
      
      // ENSURE AUTH DIRECTORY EXISTS (But don't delete it!)
      try {
        await fs.mkdir(this.authDir, { recursive: true });
      } catch (error) {}

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // We will handle printing ourselves for better control
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
      console.log('\n' + '='.repeat(40));
      console.log('📱 NEW WHATSAPP QR CODE GENERATED');
      console.log('Scan this in your Render logs to connect:');
      
      // This prints the actual QR code to your Render Terminal
      QRCodeTerminal.generate(qr, { small: true });
      
      console.log('='.repeat(40) + '\n');
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      
      if (shouldReconnect) {
        console.log('🔄 Connection closed. Reconnecting in 5 seconds...');
        setTimeout(() => this.initialize(), 5000);
      } else {
        console.log('❌ Device logged out. Please delete auth_info folder and restart to get a new QR.');
      }
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected successfully!');
    } else if (connection === 'connecting') {
      console.log('⏳ Connecting to WhatsApp...');
    }
  }

  // ... (Keep the rest of your handleIncomingMessage, sendMessage, etc. functions exactly as they were)
  
  // Update the resetConnection to be the only thing that deletes auth
  async resetConnection() {
    try {
      if (this.sock) await this.sock.end();
      await fs.rm(this.authDir, { recursive: true, force: true });
      console.log('✅ Auth cleared. Restarting...');
      this.initialize();
    } catch (error) {
      console.error('Error resetting:', error);
    }
  }
}

module.exports = new BaileysService();