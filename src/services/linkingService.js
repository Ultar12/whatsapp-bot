const qrcodeTerminal = require('qrcode-terminal'); 
const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../database/db'); // This is your Database instance

/**
 * WhatsApp Account Linking Service
 * Generates QR codes and PINs for secure account linking
 */
class LinkingService {
  constructor() {
    this.sessionTimeout = 5 * 60 * 1000; // 5 minutes
    this.pinLength = 8;
    this.maxAttempts = 3;
  }

  async generateLinkingSession(phoneNumber) {
    try {
      if (!this.isValidPhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      const sessionId = this.generateSessionId();
      const pin = this.generatePin();
      
      const qrData = {
        sessionId,
        pin,
        phone: phoneNumber,
        timestamp: Date.now(),
        type: 'whatsapp_linking'
      };

      // 1. Generate QR code as data URL
      const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(qrData));

      // 2. --- IMPROVED LOGGING FOR RENDER ---
      console.log('\n' + '='.repeat(40));
      console.log('🚀 NEW WHATSAPP LINKING SESSION');
      console.log('📱 Phone:', phoneNumber);
      console.log('🔢 PIN:', pin);
      console.log('='.repeat(40));
      
      console.log('\nSCAN THE QR CODE BELOW:');
      qrcodeTerminal.generate(JSON.stringify(qrData), { small: true });
      console.log('\n' + '='.repeat(40) + '\n');

      // 3. Store session in database (Using your class method 'run')
      await this.storeSession(sessionId, phoneNumber, pin, qrCodeUrl);

      return {
        success: true,
        sessionId,
        pin,
        qrCode: qrCodeUrl,
        expiresIn: this.sessionTimeout,
        message: `Session ${sessionId} created. Scan QR or enter PIN: ${pin}`
      };
    } catch (error) {
      console.error('Error generating linking session:', error);
      throw error;
    }
  }

  /**
   * ========== UPDATED DATABASE HELPERS ==========
   * Using your custom Database class methods (db.run, db.get, db.all)
   */

  async storeSession(sessionId, phone, pin, qrCode) {
    return db.run(
      `INSERT INTO linking_sessions (sessionId, phone, pin, qrCode, linked, attempts, createdAt) 
       VALUES (?, ?, ?, ?, 0, 0, datetime('now'))`,
      [sessionId, phone, pin, qrCode]
    );
  }

  async getSession(sessionId) {
    return db.get(`SELECT * FROM linking_sessions WHERE sessionId = ?`, [sessionId]);
  }

  async markSessionAsLinked(sessionId, phone) {
    return db.run(
      `UPDATE linking_sessions 
       SET linked = 1, linkedAt = datetime('now') 
       WHERE sessionId = ? AND phone = ?`,
      [sessionId, phone]
    );
  }

  async incrementAttempts(sessionId) {
    return db.run(`UPDATE linking_sessions SET attempts = attempts + 1 WHERE sessionId = ?`, [sessionId]);
  }

  async deleteSession(sessionId) {
    return db.run(`DELETE FROM linking_sessions WHERE sessionId = ?`, [sessionId]);
  }

  async getUserLinkedAccounts(phoneNumber) {
    return db.all(
      `SELECT sessionId, phone, linkedAt, createdAt FROM linking_sessions 
       WHERE phone = ? AND linked = 1 
       ORDER BY linkedAt DESC`,
      [phoneNumber]
    );
  }

  async unlinkAccount(sessionId, phoneNumber) {
    return db.run(
      `DELETE FROM linking_sessions 
       WHERE sessionId = ? AND phone = ? AND linked = 1`,
      [sessionId, phoneNumber]
    );
  }

  /**
   * ========== PRIVATE METHODS ==========
   */

  generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  generatePin() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  }

  isValidPhoneNumber(phoneNumber) {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber.replace(/\D/g, ''));
  }

  isSessionExpired(createdAt) {
    const now = Date.now();
    const sessionAge = now - new Date(createdAt).getTime();
    return sessionAge > this.sessionTimeout;
  }
}

module.exports = new LinkingService();