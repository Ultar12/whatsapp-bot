const db = require('../database/db');
const { UserService } = require('../database/services');
const whatsappService = require('../services/whatsappService');

class BulkMessagingService {
  /**
   * Create and send bulk message to all active users
   */
  async sendBulkMessage(messageText, imageUrl = null, scheduledFor = null) {
    try {
      // Get all active users
      let activeUsers = await UserService.getAllActiveUsers();

      // Limit to 5 persons maximum
      if (activeUsers.length > 5) {
        activeUsers = activeUsers.slice(0, 5);
      }

      if (activeUsers.length === 0) {
        return {
          success: false,
          message: 'No active users to send messages to',
        };
      }

      // Create bulk message record
      const bulkResult = await db.run(
        `INSERT INTO bulk_messages (message_text, image_path, total_recipients, status, scheduled_for)
         VALUES (?, ?, ?, ?, ?)`,
        [messageText, imageUrl, activeUsers.length, scheduledFor ? 'scheduled' : 'in_progress', scheduledFor]
      );

      const bulkMessageId = bulkResult.lastID;

      // Create recipient records
      for (const user of activeUsers) {
        await db.run(
          `INSERT INTO bulk_message_recipients (bulk_message_id, user_phone, status)
           VALUES (?, ?, ?)`,
          [bulkMessageId, user.phone_number, 'pending']
        );
      }

      // Send messages (or schedule)
      if (!scheduledFor) {
        await this.executeBulkSend(bulkMessageId, messageText, imageUrl, activeUsers);
      }

      return {
        success: true,
        bulkMessageId,
        totalRecipients: activeUsers.length,
        status: scheduledFor ? 'scheduled' : 'sent',
      };
    } catch (error) {
      console.error('Error in sendBulkMessage:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Execute the actual bulk send
   */
  async executeBulkSend(bulkMessageId, messageText, imageUrl, users) {
    try {
      const results = await whatsappService.sendBulkMessages(
        users.map(u => u.phone_number),
        messageText,
        imageUrl
      );

      // Update recipient records
      for (const successful of results.successful) {
        await db.run(
          `UPDATE bulk_message_recipients SET status = ?, sent_at = CURRENT_TIMESTAMP
           WHERE bulk_message_id = ? AND user_phone = ?`,
          ['delivered', bulkMessageId, successful.phone]
        );
      }

      for (const failed of results.failed) {
        await db.run(
          `UPDATE bulk_message_recipients SET status = ?
           WHERE bulk_message_id = ? AND user_phone = ?`,
          ['failed', bulkMessageId, failed.phone]
        );
      }

      // Update bulk message status
      await db.run(
        `UPDATE bulk_messages SET sent_count = ?, failed_count = ?, status = ?, completed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [results.successful.length, results.failed.length, 'completed', bulkMessageId]
      );

      return results;
    } catch (error) {
      console.error('Error executing bulk send:', error);
      throw error;
    }
  }

  /**
   * Get bulk message status
   */
  async getBulkMessageStatus(bulkMessageId) {
    return db.get(
      `SELECT * FROM bulk_messages WHERE id = ?`,
      [bulkMessageId]
    );
  }

  /**
   * Get all bulk messages
   */
  async getAllBulkMessages(limit = 50) {
    return db.all(
      `SELECT * FROM bulk_messages ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
  }

  /**
   * Get recipient details for a bulk message
   */
  async getBulkMessageRecipients(bulkMessageId) {
    return db.all(
      `SELECT * FROM bulk_message_recipients WHERE bulk_message_id = ?`,
      [bulkMessageId]
    );
  }
}

class UpdateBroadcastService {
  /**
   * Create and broadcast an update to all active users
   */
  async broadcastUpdate(title, description, imageUrl = null, version = '1.0') {
    try {
      // Create update record
      const updateResult = await db.run(
        `INSERT INTO updates (title, description, image_path, version, status, published_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [title, description, imageUrl, version, 'published']
      );

      const updateId = updateResult.lastID;

      // Get all active users
      const activeUsers = await UserService.getAllActiveUsers();

      if (activeUsers.length === 0) {
        return {
          success: true,
          updateId,
          message: 'Update created but no active users to broadcast to',
        };
      }

      // Send broadcast messages
      let messageText = `🔔 *UPDATE - v${version}*\n\n`;
      messageText += `*${title}*\n\n`;
      messageText += description;

      const results = await whatsappService.sendBulkMessages(
        activeUsers.map(u => u.phone_number),
        messageText,
        imageUrl
      );

      // Track delivery
      for (const user of activeUsers) {
        await db.run(
          `INSERT INTO update_delivery (update_id, user_phone, delivered_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)`,
          [updateId, user.phone_number]
        );
      }

      return {
        success: true,
        updateId,
        totalRecipients: activeUsers.length,
        sentSuccessfully: results.successful.length,
        failedCount: results.failed.length,
      };
    } catch (error) {
      console.error('Error broadcasting update:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get update details
   */
  async getUpdate(updateId) {
    return db.get(
      `SELECT * FROM updates WHERE id = ?`,
      [updateId]
    );
  }

  /**
   * Get all updates
   */
  async getAllUpdates(limit = 20) {
    return db.all(
      `SELECT * FROM updates WHERE status = 'published' ORDER BY published_at DESC LIMIT ?`,
      [limit]
    );
  }

  /**
   * Get update delivery stats
   */
  async getUpdateDeliveryStats(updateId) {
    const total = await db.get(
      `SELECT COUNT(*) as count FROM update_delivery WHERE update_id = ?`,
      [updateId]
    );

    const delivered = await db.get(
      `SELECT COUNT(*) as count FROM update_delivery WHERE update_id = ? AND delivered_at IS NOT NULL`,
      [updateId]
    );

    const read = await db.get(
      `SELECT COUNT(*) as count FROM update_delivery WHERE update_id = ? AND read_at IS NOT NULL`,
      [updateId]
    );

    return {
      total: total?.count || 0,
      delivered: delivered?.count || 0,
      read: read?.count || 0,
    };
  }
}

module.exports = {
  BulkMessagingService: new BulkMessagingService(),
  UpdateBroadcastService: new UpdateBroadcastService(),
};
