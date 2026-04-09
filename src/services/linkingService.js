const qrcodeTerminal = require('qrcode-terminal'); // Add at top

// Inside generateLinkingSession...
const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(qrData));

// ADD THIS TO SEE IT ON RENDER:
console.log('--- NEW LINKING QR CODE ---');
qrcodeTerminal.generate(JSON.stringify(qrData), { small: true });
console.log('PIN for this session:', pin);

const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../database/db');

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

  /**
   * Generate a new linking session with QR code and PIN
   * Returns both QR code data and PIN for authentication
   */
  async generateLinkingSession(phoneNumber) {
    try {
      // Validate phone number
      if (!this.isValidPhoneNumber(phoneNumber)) {
        throw new Error('Invalid phone number format');
      }

      // Generate unique session ID
      const sessionId = this.generateSessionId();
      
      // Generate 8-digit PIN
      const pin = this.generatePin();
      
      // Generate QR code data
      const qrData = {
        sessionId,
        pin,
        phone: phoneNumber,
        timestamp: Date.now(),
        type: 'whatsapp_linking'
      };

      // Generate QR code as data URL
      const qrCodeUrl = await QRCode.toDataURL(JSON.stringify(qrData));

      // Store session in database
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
   * Verify account link using either QR code data or PIN
   * Supports both QR scan and manual PIN entry
   */
  async verifyLink(sessionId, pinOrQrData, phoneNumber) {
    try {
      // Get session from database
      const session = await this.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found or expired');
      }

      if (session.phone !== phoneNumber) {
        throw new Error('Phone number does not match session');
      }

      // Check if session has expired
      if (this.isSessionExpired(session.createdAt)) {
        await this.deleteSession(sessionId);
        throw new Error('Session has expired. Please generate a new one');
      }

      // Check attempt count
      if (session.attempts >= this.maxAttempts) {
        await this.deleteSession(sessionId);
        throw new Error('Maximum verification attempts exceeded');
      }

      let isValid = false;

      // Verify PIN
      if (pinOrQrData && pinOrQrData.length === this.pinLength) {
        isValid = session.pin === pinOrQrData;
      } else if (pinOrQrData) {
        // Try to parse QR data
        try {
          const qrData = JSON.parse(pinOrQrData);
          isValid = qrData.pin === session.pin && qrData.sessionId === sessionId;
        } catch (e) {
          isValid = false;
        }
      }

      if (!isValid) {
        // Increment attempts
        await this.incrementAttempts(sessionId);
        throw new Error(`Invalid verification. ${this.maxAttempts - session.attempts - 1} attempts remaining`);
      }

      // Mark session as verified and linked
      await this.markSessionAsLinked(sessionId, phoneNumber);

      return {
        success: true,
        message: 'Account successfully linked to WhatsApp',
        sessionId,
        phone: phoneNumber,
        linkedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error verifying link:', error);
      throw error;
    }
  }

  /**
   * Get linking session status
   */
  async getSessionStatus(sessionId) {
    try {
      const session = await this.getSession(sessionId);

      if (!session) {
        return {
          success: false,
          status: 'not_found',
          message: 'Session not found'
        };
      }

      const isExpired = this.isSessionExpired(session.createdAt);

      if (isExpired) {
        await this.deleteSession(sessionId);
        return {
          success: false,
          status: 'expired',
          message: 'Session has expired'
        };
      }

      return {
        success: true,
        status: session.linked ? 'linked' : 'pending',
        sessionId,
        phone: session.phone,
        linked: session.linked,
        attempts: session.attempts,
        maxAttempts: this.maxAttempts,
        createdAt: session.createdAt,
        expiresAt: new Date(session.createdAt.getTime() + this.sessionTimeout).toISOString()
      };
    } catch (error) {
      console.error('Error getting session status:', error);
      throw error;
    }
  }

  /**
   * Get user's linked accounts
   */
  async getUserLinkedAccounts(phoneNumber) {
    try {
      return new Promise((resolve, reject) => {
        db.db.all(
          `SELECT sessionId, phone, linkedAt, createdAt FROM linking_sessions 
           WHERE phone = ? AND linked = 1 
           ORDER BY linkedAt DESC`,
          [phoneNumber],
          (err, rows) => {
            if (err) reject(err);
            resolve(rows || []);
          }
        );
      });
    } catch (error) {
      console.error('Error getting linked accounts:', error);
      throw error;
    }
  }

  /**
   * Unlink account
   */
  async unlinkAccount(sessionId, phoneNumber) {
    try {
      return new Promise((resolve, reject) => {
        db.db.run(
          `DELETE FROM linking_sessions 
           WHERE sessionId = ? AND phone = ? AND linked = 1`,
          [sessionId, phoneNumber],
          function(err) {
            if (err) reject(err);
            resolve({
              success: true,
              message: 'Account unlinked successfully'
            });
          }
        );
      });
    } catch (error) {
      console.error('Error unlinking account:', error);
      throw error;
    }
  }

  /**
   * Get QR code for existing session
   */
  async getQrCode(sessionId) {
    try {
      const session = await this.getSession(sessionId);

      if (!session) {
        throw new Error('Session not found');
      }

      return {
        success: true,
        qrCode: session.qrCode,
        pin: session.pin,
        expiresAt: new Date(session.createdAt.getTime() + this.sessionTimeout).toISOString()
      };
    } catch (error) {
      console.error('Error getting QR code:', error);
      throw error;
    }
  }

  /**
   * ========== PRIVATE METHODS ==========
   */

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Generate 8-digit PIN
   */
  generatePin() {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  }

  /**
   * Validate phone number format
   */
  isValidPhoneNumber(phoneNumber) {
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber.replace(/\D/g, ''));
  }

  /**
   * Check if session has expired
   */
  isSessionExpired(createdAt) {
    const now = Date.now();
    const sessionAge = now - new Date(createdAt).getTime();
    return sessionAge > this.sessionTimeout;
  }

  /**
   * Store session in database
   */
  async storeSession(sessionId, phone, pin, qrCode) {
    return new Promise((resolve, reject) => {
      db.db.run(
        `INSERT INTO linking_sessions (sessionId, phone, pin, qrCode, linked, attempts, createdAt) 
         VALUES (?, ?, ?, ?, 0, 0, datetime('now'))`,
        [sessionId, phone, pin, qrCode],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });
  }

  /**
   * Get session from database
   */
  async getSession(sessionId) {
    return new Promise((resolve, reject) => {
      db.db.get(
        `SELECT * FROM linking_sessions WHERE sessionId = ?`,
        [sessionId],
        (err, row) => {
          if (err) reject(err);
          resolve(row || null);
        }
      );
    });
  }

  /**
   * Mark session as linked
   */
  async markSessionAsLinked(sessionId, phone) {
    return new Promise((resolve, reject) => {
      db.db.run(
        `UPDATE linking_sessions 
         SET linked = 1, linkedAt = datetime('now') 
         WHERE sessionId = ? AND phone = ?`,
        [sessionId, phone],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });
  }

  /**
   * Increment verification attempts
   */
  async incrementAttempts(sessionId) {
    return new Promise((resolve, reject) => {
      db.db.run(
        `UPDATE linking_sessions SET attempts = attempts + 1 WHERE sessionId = ?`,
        [sessionId],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });
  }

  /**
   * Delete session from database
   */
  async deleteSession(sessionId) {
    return new Promise((resolve, reject) => {
      db.db.run(
        `DELETE FROM linking_sessions WHERE sessionId = ?`,
        [sessionId],
        function(err) {
          if (err) reject(err);
          resolve();
        }
      );
    });
  }

  /**
   * Clean up expired sessions (can be called periodically)
   */
  async cleanupExpiredSessions() {
    try {
      const expirationTime = new Date(Date.now() - this.sessionTimeout).toISOString();
      
      return new Promise((resolve, reject) => {
        db.db.run(
          `DELETE FROM linking_sessions WHERE createdAt < ? AND linked = 0`,
          [expirationTime],
          function(err) {
            if (err) reject(err);
            resolve({
              success: true,
              message: `Deleted ${this.changes} expired sessions`
            });
          }
        );
      });
    } catch (error) {
      console.error('Error cleaning up expired sessions:', error);
      throw error;
    }
  }
}

module.exports = new LinkingService();
