const db = require('../database/db');
const { UserService } = require('../database/services');
const whatsappService = require('./whatsappService');
const responseGenerator = require('./responseGenerator');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

class MessageHandler {
  /**
   * Handle incoming webhook from Twilio
   */
  async handleIncomingMessage(body) {
    const {
      From,
      Body,
      NumMedia,
      MediaUrl0,
      MediaContentType0,
      ProfileName,
      ReferredProductId,
    } = body;

    // Extract phone number (remove whatsapp: prefix)
    const userPhone = From.replace('whatsapp:', '').replace('+', '');
    const messageText = Body || '';

    try {
      // Get or create user
      const user = await UserService.getOrCreateUser(userPhone, ProfileName);

      // Check subscription status
      const isActive = await UserService.isSubscriptionActive(userPhone);
      if (!isActive) {
        // Add delay before replying
        await new Promise(resolve => setTimeout(resolve, 2000));
        await whatsappService.sendMessage(
          userPhone,
          '⚠️ Your subscription has expired. Please renew to continue using the bot.\nReply "RENEW" to extend your subscription.'
        );
        return;
      }

      // Handle image/media messages (including WhatsApp Status)
      if (NumMedia > 0) {
        await this.handleImageMessage(userPhone, messageText, MediaUrl0, MediaContentType0, ReferredProductId);
      } else if (messageText.toLowerCase() === 'renew') {
        // Handle subscription renewal request
        await this.handleRenewalRequest(userPhone);
      } else {
        // Generate and send auto-reply
        await this.handleAutoReply(userPhone, messageText);
      }

      // Save message record
      await db.run(
        `INSERT INTO messages (user_phone, user_message, message_type, image_path)
         VALUES (?, ?, ?, ?)`,
        [userPhone, messageText, NumMedia > 0 ? 'image' : 'text', NumMedia > 0 ? MediaUrl0 : null]
      );

      // Update user last seen
      await UserService.updateUserLastSeen(userPhone);

    } catch (error) {
      console.error('Error handling incoming message:', error);
      await whatsappService.sendMessage(
        userPhone,
        'Sorry, there was an error processing your message. Please try again.'
      );
    }
  }

  /**
   * Handle image messages including WhatsApp Status
   */
  async handleImageMessage(userPhone, caption, imageUrl, contentType, referredProductId = null) {
    try {
      // Download image from WhatsApp (handles status images)
      const imagePath = await this.downloadAndSaveImage(imageUrl, userPhone, contentType);

      // Store reference to status image if from status
      if (referredProductId) {
        console.log(`Image from user status: ${referredProductId}`);
        // Can be used for tracking status interactions
      }

      if (caption && caption.trim()) {
        // If there's a caption, process it as a query
        const response = await responseGenerator.processMessage(caption, userPhone);
        // Add delay before replying
        await new Promise(resolve => setTimeout(resolve, 2000));
        await whatsappService.sendMessage(userPhone, response);
      } else {
        // Just acknowledge receipt of image
        // Add delay before replying
        await new Promise(resolve => setTimeout(resolve, 1500));
        await whatsappService.sendMessage(
          userPhone,
          '📸 Image received! Thanks for sharing.\n\nWhat would you like to know about our products?\nType "list" to see all available items.'
        );
      }
    } catch (error) {
      console.error('Error handling image message:', error);
      await whatsappService.sendMessage(
        userPhone,
        'Error processing your image. Please try again.'
      );
    }
  }

  /**
   * Download and save image from URL
   */
  async downloadAndSaveImage(imageUrl, userPhone, contentType = 'image/jpeg') {
    try {
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      const timestamp = Date.now();
      
      // Determine file extension based on content type
      const ext = this.getFileExtension(contentType);
      const fileName = `${userPhone}_${timestamp}${ext}`;
      const filePath = path.join(uploadDir, fileName);

      // Download using Twilio authenticated request
      const mediaResult = await whatsappService.downloadMedia(imageUrl);
      
      if (!mediaResult.success) {
        throw new Error(mediaResult.error);
      }

      // Save file
      await fs.writeFile(filePath, mediaResult.data);
      
      console.log(`Image saved: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error('Error downloading image:', error);
      throw error;
    }
  }

  /**
   * Get file extension from content type
   * Now delegates to whatsappService for universal support
   */
  getFileExtension(contentType) {
    // Use whatsappService's enhanced method that supports all formats
    return whatsappService.getFileExtension(contentType);
  }

  /**
   * Handle auto-reply
   */
  async handleAutoReply(userPhone, messageText) {
    const response = await responseGenerator.processMessage(messageText, userPhone);
    // Add delay before replying to make bot seem more natural
    await new Promise(resolve => setTimeout(resolve, 2000));
    await whatsappService.sendMessage(userPhone, response);
  }

  /**
   * Handle subscription renewal
   */
  async handleRenewalRequest(userPhone) {
    const renewed = await UserService.renewSubscription(userPhone, 30);

    if (renewed) {
      // Add delay before replying
      await new Promise(resolve => setTimeout(resolve, 1500));
      await whatsappService.sendMessage(
        userPhone,
        '✅ *Subscription Renewed!*\n\n' +
        'Your subscription has been extended for 30 more days.\n' +
        'Thank you for your continued support!\n\n' +
        'Type "list" to see all products or ask about any product.'
      );
    } else {
      // Add delay before replying
      await new Promise(resolve => setTimeout(resolve, 1500));
      await whatsappService.sendMessage(
        userPhone,
        '❌ Renewal failed. Please contact support.'
      );
    }
  }
}

module.exports = new MessageHandler();
