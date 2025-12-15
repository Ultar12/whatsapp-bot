const twilio = require('twilio');
const baileysService = require('./baileysService');

class WhatsAppService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER;
    this.rateLimitDelay = 3500; // 3.5 seconds delay between messages per person
    this.useBaileys = process.env.USE_BAILEYS === 'true'; // Toggle between Twilio and Baileys
  }

  /**
   * Send a text message to a single user
   */
  async sendMessage(toPhoneNumber, messageText) {
    try {
      // Use Baileys if enabled
      if (this.useBaileys && baileysService.isConnected()) {
        return await baileysService.sendMessage(toPhoneNumber, messageText);
      }

      // Fall back to Twilio
      const message = await this.client.messages.create({
        body: messageText,
        from: this.phoneNumber,
        to: `whatsapp:${toPhoneNumber}`,
      });

      return {
        success: true,
        messageId: message.sid,
        status: message.status,
      };
    } catch (error) {
      console.error(`Error sending message to ${toPhoneNumber}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send a message with an image
   */
  async sendMessageWithImage(toPhoneNumber, messageText, imageUrl) {
    try {
      // Use Baileys if enabled
      if (this.useBaileys && baileysService.isConnected()) {
        return await baileysService.sendMessageWithImage(toPhoneNumber, messageText, imageUrl);
      }

      // Fall back to Twilio
      const message = await this.client.messages.create({
        body: messageText,
        from: this.phoneNumber,
        to: `whatsapp:${toPhoneNumber}`,
        mediaUrl: [imageUrl],
      });

      return {
        success: true,
        messageId: message.sid,
        status: message.status,
      };
    } catch (error) {
      console.error(`Error sending image to ${toPhoneNumber}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Send bulk messages with rate limiting
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
          results.successful.push({ phone: recipient, messageId: result.messageId });
        } else {
          results.failed.push({ phone: recipient, error: result.error });
        }

        // Rate limiting delay
        await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay));
      } catch (error) {
        results.failed.push({ phone: recipient, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get message history
   */
  async getMessageHistory(phoneNumber, limit = 50) {
    try {
      const messages = await this.client.messages.list({
        to: `whatsapp:${phoneNumber}`,
        limit: limit,
      });

      return messages.map(msg => ({
        id: msg.sid,
        from: msg.from,
        to: msg.to,
        body: msg.body,
        status: msg.status,
        dateSent: msg.dateSent,
        dateCreated: msg.dateCreated,
      }));
    } catch (error) {
      console.error('Error fetching message history:', error);
      return [];
    }
  }

  /**
   * Download media from WhatsApp (including status images)
   */
  async downloadMedia(mediaUrl) {
    try {
      const axios = require('axios');
      const response = await axios({
        url: mediaUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Basic ${Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString('base64')}`
        }
      });

      return {
        success: true,
        data: response.data,
        contentType: response.headers['content-type'],
      };
    } catch (error) {
      console.error('Error downloading media:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get media type from content-type header
   * Supports ALL image and video types
   */
  getMediaType(contentType) {
    if (contentType.includes('image')) return 'image';
    if (contentType.includes('video')) return 'video';
    if (contentType.includes('audio')) return 'audio';
    if (contentType.includes('pdf')) return 'document';
    return 'file';
  }

  /**
   * Get file extension from content-type header
   * Dynamically extracts extension from MIME type
   * Supports ALL image and video formats automatically
   */
  getFileExtension(contentType) {
    // Standard MIME type to extension mappings
    const typeMap = {
      // Images
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/bmp': '.bmp',
      'image/svg+xml': '.svg',
      'image/tiff': '.tiff',
      'image/x-icon': '.ico',
      'image/vnd.adobe.photoshop': '.psd',
      'image/heic': '.heic',
      'image/heif': '.heif',
      // Videos
      'video/mp4': '.mp4',
      'video/quicktime': '.mov',
      'video/x-msvideo': '.avi',
      'video/x-matroska': '.mkv',
      'video/webm': '.webm',
      'video/x-flv': '.flv',
      'video/x-ms-wmv': '.wmv',
      'video/x-ms-asf': '.asf',
      'video/3gpp': '.3gp',
      'video/3gpp2': '.3g2',
      'video/ogg': '.ogv',
      'video/x-mmpeg': '.mpg',
      'video/mpeg': '.mpeg',
      'video/x-m4v': '.m4v',
      // Audio
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/ogg': '.ogg',
      'audio/webm': '.webm',
      // Documents
      'application/pdf': '.pdf',
    };

    // Check standard mapping first
    if (typeMap[contentType]) {
      return typeMap[contentType];
    }

    // Extract extension from MIME type dynamically
    // Examples: image/webp → .webp, video/quicktime → .quicktime
    const parts = contentType.split('/');
    if (parts.length === 2) {
      let ext = parts[1].split(';')[0].trim();
      
      // Handle MIME types like 'image/vnd.something+xml'
      if (ext.includes('+')) {
        ext = ext.split('+')[0];
      }
      
      // Handle MIME types like 'audio/x-something'
      if (ext.startsWith('x-')) {
        ext = ext.substring(2);
      }
      
      // Return with dot prefix
      return `.${ext}`;
    }

    // Default to jpg if unable to parse
    return '.jpg';
  }

  /**
   * Verify phone number format
   */
  isValidPhoneNumber(phoneNumber) {
    // Basic validation - starts with + or country code
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phoneNumber.replace(/\D/g, ''));
  }
}

module.exports = new WhatsAppService();
