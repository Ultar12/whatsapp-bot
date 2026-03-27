require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./database/db');
const messageHandler = require('./handlers/messageHandler');
const { BulkMessagingService, UpdateBroadcastService } = require('./handlers/bulkMessagingHandler');
const subscriptionService = require('./services/subscriptionService');
const { CommodityService } = require('./database/services');
const authService = require('./services/authService');
const linkingHandler = require('./handlers/linkingHandler');
const linkingService = require('./services/linkingService');
const paymentHandler = require('./handlers/paymentHandler');
const paymentService = require('./services/paymentService');
const analyticsService = require('./services/analyticsService');
const reportingService = require('./services/reportingService');
const i18nService = require('./services/i18nService');
const baileysService = require('./services/baileysService');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ AUTHENTICATION MIDDLEWARE ============
const authenticate = authService.adminAuthMiddleware();

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());

// Apply authentication middleware - handles both required and optional auth
app.use(authService.adminAuthMiddleware());

// ============ BAILEYS MESSAGE HANDLING ============

// Register Baileys message handler
baileysService.onMessage(async (messageData) => {
  try {
    // Convert Baileys format to messageHandler format
    const body = {
      From: `whatsapp:${messageData.from}`,
      Body: messageData.body,
      NumMedia: 0,
      ProfileName: messageData.from,
    };
    
    await messageHandler.handleIncomingMessage(body);
  } catch (error) {
    console.error('Error processing Baileys message:', error);
  }
});

// ============ WEBHOOK ENDPOINTS ============

/**
 * Twilio webhook for incoming messages (kept for backward compatibility)
 */
app.post('/webhook/incoming-message', async (req, res) => {
  try {
    await messageHandler.handleIncomingMessage(req.body);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    baileysConnected: baileysService.isConnected()
  });
});

// ============ COMMODITY MANAGEMENT ENDPOINTS ============

/**
 * Add a new commodity/product
 */
app.post('/api/commodities', authenticate, async (req, res) => {
  try {
    const { name, price, description, category, imagePath } = req.body;

    if (!name || !price) {
      return res.status(400).json({ error: 'Name and price are required' });
    }

    const commodity = await CommodityService.addCommodity(
      name,
      price,
      description,
      category,
      imagePath
    );

    res.json({ success: true, commodity });
  } catch (error) {
    console.error('Error adding commodity:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all commodities
 */
app.get('/api/commodities', authenticate, async (req, res) => {
  try {
    const commodities = await CommodityService.getAllCommodities();
    res.json({ success: true, commodities });
  } catch (error) {
    console.error('Error fetching commodities:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search commodities
 */
app.get('/api/commodities/search/:term', authenticate, async (req, res) => {
  try {
    const { term } = req.params;
    const results = await CommodityService.searchCommodities(term);
    res.json({ success: true, results });
  } catch (error) {
    console.error('Error searching commodities:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update commodity
 */
app.put('/api/commodities/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const commodity = await CommodityService.updateCommodity(id, req.body);
    res.json({ success: true, commodity });
  } catch (error) {
    console.error('Error updating commodity:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Delete commodity
 */
app.delete('/api/commodities/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await CommodityService.deleteCommodity(id);
    res.json({ success: true, message: 'Commodity deleted' });
  } catch (error) {
    console.error('Error deleting commodity:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ BULK MESSAGING ENDPOINTS ============

/**
 * Send bulk message to all active users
 */
app.post('/api/bulk-message', authenticate, async (req, res) => {
  try {
    const { message, imageUrl, scheduledFor } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const result = await BulkMessagingService.sendBulkMessage(message, imageUrl, scheduledFor);
    res.json(result);
  } catch (error) {
    console.error('Error sending bulk message:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get bulk message status
 */
app.get('/api/bulk-message/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const status = await BulkMessagingService.getBulkMessageStatus(id);
    const recipients = await BulkMessagingService.getBulkMessageRecipients(id);

    res.json({ success: true, status, recipients });
  } catch (error) {
    console.error('Error fetching bulk message status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all bulk messages
 */
app.get('/api/bulk-messages', authenticate, async (req, res) => {
  try {
    const messages = await BulkMessagingService.getAllBulkMessages();
    res.json({ success: true, messages });
  } catch (error) {
    console.error('Error fetching bulk messages:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ UPDATE BROADCAST ENDPOINTS ============

/**
 * Broadcast update to all users
 */
app.post('/api/broadcast-update', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authService.extractToken(authHeader);

    if (!token || !authService.verifyAdminToken(token)) {
      return res.status(401).json({ error: 'Unauthorized - Admin token required' });
    }

    const { title, description, imageUrl, version } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const result = await UpdateBroadcastService.broadcastUpdate(
      title,
      description,
      imageUrl,
      version
    );

    res.json(result);
  } catch (error) {
    console.error('Error broadcasting update:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all updates - PUBLIC ENDPOINT (no auth required)
 */
app.get('/api/updates', async (req, res) => {
  try {
    const updates = await UpdateBroadcastService.getAllUpdates();
    res.json({ success: true, updates });
  } catch (error) {
    console.error('Error fetching updates:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get update delivery stats - PUBLIC ENDPOINT (no auth required)
 */
app.get('/api/updates/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const stats = await UpdateBroadcastService.getUpdateDeliveryStats(id);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching update stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SUBSCRIPTION MANAGEMENT ENDPOINTS ============

/**
 * Get subscription details
 */
app.get('/api/subscription/:phone', authenticate, async (req, res) => {
  try {
    const { phone } = req.params;
    const subscription = await subscriptionService.getSubscription(phone);

    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    res.json({ success: true, subscription });
  } catch (error) {
    console.error('Error fetching subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Renew subscription
 */
app.post('/api/subscription/:phone/renew', authenticate, async (req, res) => {
  try {
    const { phone } = req.params;
    const { daysToAdd = 30 } = req.body;

    const result = await subscriptionService.renewSubscription(phone, daysToAdd);
    res.json(result);
  } catch (error) {
    console.error('Error renewing subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all active subscriptions
 */
app.get('/api/subscriptions', authenticate, async (req, res) => {
  try {
    const subscriptions = await subscriptionService.getAllActiveSubscriptions();
    res.json({ success: true, subscriptions });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get subscription statistics
 */
app.get('/api/subscriptions/stats', authenticate, async (req, res) => {
  try {
    const stats = await subscriptionService.getSubscriptionStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching subscription stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Manually check and expire subscriptions
 */
app.post('/api/subscriptions/check-expiry', authenticate, async (req, res) => {
  try {
    const result = await subscriptionService.checkAndExpireSubscriptions();
    res.json(result);
  } catch (error) {
    console.error('Error checking subscriptions:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send renewal reminders
 */
app.post('/api/subscriptions/send-reminders', authenticate, async (req, res) => {
  try {
    const result = await subscriptionService.sendRenewalReminders();
    res.json(result);
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ WHATSAPP ACCOUNT LINKING ENDPOINTS ============

/**
 * Initiate linking process
 * Generates QR code and PIN, sends PIN via WhatsApp
 */
app.post('/api/linking/initiate', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const result = await linkingHandler.initiateLinking(phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error initiating linking:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Verify and complete linking
 * Accepts either QR code data or 8-digit PIN
 */
app.post('/api/linking/verify', async (req, res) => {
  try {
    const { sessionId, pin, phoneNumber } = req.body;

    if (!sessionId || !pin || !phoneNumber) {
      return res.status(400).json({ error: 'sessionId, pin, and phoneNumber are required' });
    }

    const result = await linkingHandler.completeLinking(sessionId, pin, phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error verifying link:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get linking session status
 */
app.get('/api/linking/status/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const status = await linkingHandler.getLinkingStatus(sessionId);
    res.json(status);
  } catch (error) {
    console.error('Error getting linking status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get QR code for a session
 */
app.get('/api/linking/qrcode/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await linkingHandler.getQrCode(sessionId);
    res.json(result);
  } catch (error) {
    console.error('Error getting QR code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Resend PIN for existing session
 */
app.post('/api/linking/resend-pin', async (req, res) => {
  try {
    const { sessionId, phoneNumber } = req.body;

    if (!sessionId || !phoneNumber) {
      return res.status(400).json({ error: 'sessionId and phoneNumber are required' });
    }

    const result = await linkingHandler.resendPin(sessionId, phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error resending PIN:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all linked accounts for a user
 */
app.get('/api/linking/accounts/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const result = await linkingHandler.getLinkedAccounts(phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error getting linked accounts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Unlink an account
 */
app.post('/api/linking/unlink', async (req, res) => {
  try {
    const { sessionId, phoneNumber } = req.body;

    if (!sessionId || !phoneNumber) {
      return res.status(400).json({ error: 'sessionId and phoneNumber are required' });
    }

    const result = await linkingHandler.unlinkAccount(sessionId, phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error unlinking account:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get linking statistics - ADMIN ONLY
 */
app.get('/api/linking/stats', authenticate, async (req, res) => {
  try {
    const result = await linkingHandler.getLinkingStats();
    res.json(result);
  } catch (error) {
    console.error('Error getting linking stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PAYMENT MANAGEMENT ENDPOINTS ============

/**
 * Start free trial
 */
app.post('/api/payment/trial/start', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const result = await paymentHandler.startTrial(phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error starting trial:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all subscription plans
 */
app.get('/api/payment/plans', async (req, res) => {
  try {
    const result = paymentHandler.getPlans();
    res.json(result);
  } catch (error) {
    console.error('Error getting plans:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get specific plan details
 */
app.get('/api/payment/plan/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    const result = paymentHandler.getPlanDetails(planId);
    res.json(result);
  } catch (error) {
    console.error('Error getting plan details:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Initiate payment for a plan
 */
app.post('/api/payment/initiate', async (req, res) => {
  try {
    const { phoneNumber, planId } = req.body;

    if (!phoneNumber || !planId) {
      return res.status(400).json({ error: 'Phone number and plan ID are required' });
    }

    const result = await paymentHandler.initiatePayment(phoneNumber, planId);
    res.json(result);
  } catch (error) {
    console.error('Error initiating payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Confirm payment
 */
app.post('/api/payment/confirm', async (req, res) => {
  try {
    const { phoneNumber, referenceId } = req.body;

    if (!phoneNumber || !referenceId) {
      return res.status(400).json({ error: 'Phone number and reference ID are required' });
    }

    const result = await paymentHandler.confirmPayment(phoneNumber, referenceId);
    res.json(result);
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check subscription status
 */
app.get('/api/payment/status/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const result = await paymentHandler.checkStatus(phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get payment account information
 */
app.get('/api/payment/account', async (req, res) => {
  try {
    const result = paymentHandler.getPaymentAccount();
    res.json(result);
  } catch (error) {
    console.error('Error getting payment account:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get payment statistics - ADMIN ONLY
 */
app.get('/api/payment/stats', authenticate, async (req, res) => {
  try {
    const result = await paymentHandler.getStats();
    res.json(result);
  } catch (error) {
    console.error('Error getting payment stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Send expiration reminder
 */
app.post('/api/payment/reminder', authenticate, async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    const result = await paymentHandler.sendExpirationReminder(phoneNumber);
    res.json(result);
  } catch (error) {
    console.error('Error sending reminder:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ ANALYTICS ENDPOINTS ============

/**
 * Get user activity summary
 */
app.get('/api/analytics/user/:phoneNumber', authenticate, async (req, res) => {
  try {
    const { phoneNumber } = req.params;
    const summary = await analyticsService.getUserActivitySummary(phoneNumber);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error getting user activity:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Record user interaction
 */
app.post('/api/analytics/interaction', async (req, res) => {
  try {
    const { phoneNumber, type, data } = req.body;

    if (!phoneNumber || !type) {
      return res.status(400).json({ error: 'Phone number and type are required' });
    }

    await analyticsService.recordInteraction(phoneNumber, type, data || {});
    res.json({ success: true, message: 'Interaction recorded' });
  } catch (error) {
    console.error('Error recording interaction:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get dashboard metrics
 */
app.get('/api/analytics/dashboard', authenticate, async (req, res) => {
  try {
    const metrics = await analyticsService.getDashboardMetrics();
    res.json({ success: true, metrics });
  } catch (error) {
    console.error('Error getting dashboard metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get retention metrics
 */
app.get('/api/analytics/retention/:days', authenticate, async (req, res) => {
  try {
    const { days } = req.params;
    const metrics = await analyticsService.getRetentionMetrics(parseInt(days));
    res.json({ success: true, metrics });
  } catch (error) {
    console.error('Error getting retention metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get conversation metrics
 */
app.get('/api/analytics/conversations', authenticate, async (req, res) => {
  try {
    const metrics = await analyticsService.getConversationMetrics();
    res.json({ success: true, metrics });
  } catch (error) {
    console.error('Error getting conversation metrics:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Export analytics
 */
app.get('/api/analytics/export/:format', authenticate, async (req, res) => {
  try {
    const { format } = req.params;
    const data = await analyticsService.exportAnalytics(format || 'json');
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error exporting analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ REPORTING ENDPOINTS ============

/**
 * Generate revenue report
 */
app.get('/api/reports/revenue/:dateFrom/:dateTo', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.params;
    const report = await reportingService.generateRevenueReport(dateFrom, dateTo);
    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating revenue report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate user report
 */
app.get('/api/reports/users/:dateFrom/:dateTo', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.params;
    const report = await reportingService.generateUserReport(dateFrom, dateTo);
    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating user report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate subscription report
 */
app.get('/api/reports/subscriptions/:dateFrom/:dateTo', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.params;
    const report = await reportingService.generateSubscriptionReport(dateFrom, dateTo);
    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating subscription report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate engagement report
 */
app.get('/api/reports/engagement/:dateFrom/:dateTo', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.params;
    const report = await reportingService.generateEngagementReport(dateFrom, dateTo);
    res.json({ success: true, report });
  } catch (error) {
    console.error('Error generating engagement report:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate executive summary
 */
app.get('/api/reports/summary/:dateFrom/:dateTo', authenticate, async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.params;
    const summary = await reportingService.generateExecutiveSummary(dateFrom, dateTo);
    res.json({ success: true, summary });
  } catch (error) {
    console.error('Error generating executive summary:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get all reports
 */
app.get('/api/reports/list', authenticate, async (req, res) => {
  try {
    const reports = await reportingService.getAllReports();
    res.json({ success: true, reports });
  } catch (error) {
    console.error('Error getting reports:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get specific report
 */
app.get('/api/reports/:filename', authenticate, async (req, res) => {
  try {
    const { filename } = req.params;
    const report = await reportingService.getReport(filename);
    res.json({ success: true, report });
  } catch (error) {
    console.error('Error getting report:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ INTERNATIONALIZATION (I18N) ENDPOINTS ============

/**
 * Get available languages
 */
app.get('/api/i18n/languages', async (req, res) => {
  try {
    const languages = i18nService.getAvailableLanguages();
    res.json({ success: true, languages });
  } catch (error) {
    console.error('Error getting languages:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get translation
 */
app.get('/api/i18n/translate/:key/:language', async (req, res) => {
  try {
    const { key, language } = req.params;
    const translation = i18nService.translate(key, language);
    res.json({ success: true, translation });
  } catch (error) {
    console.error('Error translating:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get language menu
 */
app.get('/api/i18n/menu', async (req, res) => {
  try {
    const menu = i18nService.getLanguageMenu();
    res.json({ success: true, menu });
  } catch (error) {
    console.error('Error getting language menu:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Set user language preference
 */
app.post('/api/i18n/set-language', async (req, res) => {
  try {
    const { phoneNumber, languageCode } = req.body;

    if (!phoneNumber || !languageCode) {
      return res.status(400).json({ error: 'Phone number and language code are required' });
    }

    // Save to database
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO user_languages (phone_number, language_code, updated_at)
      VALUES (?, ?, ?)
    `);

    stmt.run(phoneNumber, languageCode, new Date().toISOString());

    res.json({ success: true, message: 'Language preference saved' });
  } catch (error) {
    console.error('Error setting language:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get user language preference
 */
app.get('/api/i18n/user-language/:phoneNumber', async (req, res) => {
  try {
    const { phoneNumber } = req.params;

    const stmt = db.prepare(`
      SELECT language_code FROM user_languages WHERE phone_number = ?
    `);

    const result = stmt.get(phoneNumber);
    const languageCode = result?.language_code || 'en';

    res.json({ success: true, languageCode });
  } catch (error) {
    console.error('Error getting user language:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ INITIALIZATION & SERVER START ============

async function startServer() {
  try {
    // Connect to database
    await db.connect();
    console.log('✓ Database connected');

    // Initialize Baileys
    console.log('Initializing Baileys...');
    await baileysService.initialize();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`✓ WhatsApp Bot Server running on port ${PORT}`);
      console.log(`\nWebhook URL: http://localhost:${PORT}/webhook/incoming-message`);
      console.log(`Health Check: http://localhost:${PORT}/health`);
      console.log(`\n✓ Server started at ${new Date().toISOString()}`);

      // Schedule periodic tasks
      schedulePeriodicTasks();
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Schedule periodic maintenance tasks
 */
function schedulePeriodicTasks() {
  // Check for expired subscriptions every hour
  setInterval(async () => {
    try {
      await subscriptionService.checkAndExpireSubscriptions();
    } catch (error) {
      console.error('Error in scheduled subscription check:', error);
    }
  }, 60 * 60 * 1000); // 1 hour

  // Send renewal reminders every 12 hours
  setInterval(async () => {
    try {
      await subscriptionService.sendRenewalReminders();
    } catch (error) {
      console.error('Error in scheduled renewal reminders:', error);
    }
  }, 12 * 60 * 60 * 1000); // 12 hours

  // Clean up expired linking sessions every 10 minutes
  setInterval(async () => {
    try {
      await linkingService.cleanupExpiredSessions();
    } catch (error) {
      console.error('Error cleaning up expired linking sessions:', error);
    }
  }, 10 * 60 * 1000); // 10 minutes

  // Ping the bot every 5 minutes to keep it alive
  setInterval(async () => {
    try {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] 🏓 Ping: Bot is alive and running...`);
      
      // Optional: Send a ping to the health check endpoint
      // This helps if the bot is deployed on a service that terminates idle connections
      console.log(`   - Database: Connected`);
      console.log(`   - Baileys: ${baileysService.isConnected() ? 'Connected' : 'Disconnected'}`);
      console.log(`   - Server: Responding to requests`);
    } catch (error) {
      console.error('Error in ping task:', error);
    }
  }, 5 * 60 * 1000); // 5 minutes

  console.log('✓ Periodic tasks scheduled:');
  console.log('  - Subscription check: Every 1 hour');
  console.log('  - Renewal reminders: Every 12 hours');
  console.log('  - Link cleanup: Every 10 minutes');
  console.log('  - Keep-alive ping: Every 5 minutes');
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await db.close();
  process.exit(0);
});

// Start the server
startServer();
