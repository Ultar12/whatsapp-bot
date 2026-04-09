#!/usr/bin/env node

/**
 * WhatsApp Bot Integration - Main Entry Point
 * 
 * This is the primary entry point for the WhatsApp integration system.
 * It initializes the server and all necessary services for handling
 * WhatsApp messages, payments, linking, analytics, and more.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

// Import core services and handlers
const db = require('./src/database/db');
const messageHandler = require('./src/handlers/messageHandler');
const linkingHandler = require('./src/handlers/linkingHandler');
const paymentHandler = require('./src/handlers/paymentHandler');
const { BulkMessagingService } = require('./src/handlers/bulkMessagingHandler');

// Import services
const authService = require('./src/services/authService');
const baileysService = require('./src/services/baileysService');
const analyticsService = require('./src/services/analyticsService');
const reportingService = require('./src/services/reportingService');
const subscriptionService = require('./src/services/subscriptionService');
const linkingService = require('./src/services/linkingService');
const paymentService = require('./src/services/paymentService');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

// ============ MIDDLEWARE SETUP ============
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Authentication middleware
app.use(authService.adminAuthMiddleware());

// ============ BAILEYS INTEGRATION ============
baileysService.onMessage(async (messageData) => {
  try {
    const body = {
      From: `whatsapp:${messageData.from}`,
      Body: messageData.body,
      NumMedia: 0,
      ProfileName: messageData.from,
    };
    await messageHandler.handleIncomingMessage(body);
  } catch (error) {
    console.error('Baileys message processing error:', error);
  }
});

// ============ WEBHOOK ENDPOINTS ============

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'WhatsApp Bot Running',
    timestamp: new Date(),
    version: '2.0',
  });
});

// Message webhook endpoint
app.post('/webhook/messages', async (req, res) => {
  try {
    await messageHandler.handleIncomingMessage(req.body);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook message error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Linking webhook endpoint
app.post('/webhook/linking', async (req, res) => {
  try {
    await linkingHandler.handleLinkingRequest(req.body);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Linking webhook error:', error);
    res.status(500).json({ error: 'Failed to process linking' });
  }
});

// Payment webhook endpoint
app.post('/webhook/payment', async (req, res) => {
  try {
    await paymentHandler.handlePaymentNotification(req.body);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// Bulk messaging endpoint
app.post('/api/bulk-message', async (req, res) => {
  try {
    const result = await BulkMessagingService.sendBulkMessage(req.body);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Bulk messaging error:', error);
    res.status(500).json({ error: 'Failed to send bulk message' });
  }
});

// Analytics endpoint
app.get('/api/analytics', async (req, res) => {
  try {
    const data = await analyticsService.getAnalytics(req.query);
    res.status(200).json(data);
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Reporting endpoint
app.get('/api/reports', async (req, res) => {
  try {
    const reports = await reportingService.generateReport(req.query);
    res.status(200).json(reports);
  } catch (error) {
    console.error('Reporting error:', error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});
 // Route to trigger the QR Code in Render Logs
app.get('/generate-qr', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).send('Add ?phone=YOUR_NUMBER to the URL');

  try {
    // This calls the "Golden Version" service we just fixed
    const session = await linkingService.generateLinkingSession(phone);
    res.json({
      message: "Check your Render Logs for the QR Code!",
      pin: session.pin,
      sessionId: session.sessionId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ERROR HANDLING ============
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// ============ SERVER STARTUP ============
const startServer = async () => {
  try {
    // Initialize database
    await db.initialize();
    console.log('✓ Database connected');

    // Initialize Baileys service
    await baileysService.initialize();
    console.log('✓ Baileys service initialized');

    // Start Express server
    app.listen(PORT, HOST, () => {
      console.log(`
╔════════════════════════════════════════╗
║   WhatsApp Bot Integration Started     ║
║   Running on: ${HOST}:${PORT}
║   Environment: ${process.env.NODE_ENV || 'development'}
║   Timestamp: ${new Date().toISOString()}
╚════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await baileysService.disconnect();
  await db.close();
  process.exit(0);
});

// Start the application
startServer();

module.exports = app;
