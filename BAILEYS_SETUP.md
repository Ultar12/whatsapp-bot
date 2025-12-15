# 🤖 Baileys Setup Guide

Your WhatsApp bot is now configured to use **Baileys** for WhatsApp Web automation!

## ⚠️ IMPORTANT: Risks & Warnings

Using Baileys violates WhatsApp's Terms of Service. Be aware:
- ❌ Your account could be **banned**
- ⚠️ Not officially supported by WhatsApp
- ⚠️ Use only for testing/development
- ⚠️ Your phone must stay connected

## 📋 Setup Steps

### Step 1: Install Dependencies
```bash
npm install
```

This will install:
- `@whiskeysockets/baileys` - WhatsApp Web automation
- `pino` - Logging library

### Step 2: Create `.env` File
Create or update `.env`:
```bash
# Existing Twilio config (optional)
TWILIO_ACCOUNT_SID=your_sid
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+1234567890

# NEW: Enable Baileys
USE_BAILEYS=true

# Rest of your config
PORT=3000
PASSWORD=your_password
```

### Step 3: Start the Server
```bash
npm start
```

### Step 4: Scan QR Code
1. When server starts, it will display a **QR code** in the terminal
2. Open WhatsApp on your phone
3. Go to **Settings → Linked Devices**
4. Click **Link a Device**
5. **Scan the QR code** with your phone

### Step 5: Connected! ✅
Once scanned, the bot is connected and ready to:
- ✅ Receive messages
- ✅ Send replies
- ✅ Send bulk messages (5 max, 3.5s per person)
- ✅ Track analytics

---

## 🔄 Switching Between Twilio and Baileys

### Use Baileys:
```bash
USE_BAILEYS=true
```

### Use Twilio:
```bash
USE_BAILEYS=false
```

The bot will **automatically fall back** to Twilio if Baileys isn't connected.

---

## 📁 File Changes

New files created:
- `src/services/baileysService.js` - Baileys handler
- `auth_info/` - Where your WhatsApp session is saved

Modified files:
- `src/server.js` - Added Baileys initialization
- `src/services/whatsappService.js` - Added Baileys support
- `package.json` - Added Baileys dependencies

---

## 🐛 Troubleshooting

### QR Code Not Showing?
```bash
# Check if Baileys initialized
npm start
```

If no QR code appears, check console for errors.

### Messages Not Sending?
1. Make sure WhatsApp is connected (green check)
2. Check `.env` file has `USE_BAILEYS=true`
3. Make sure phone is online
4. Check console for errors

### Account Banned Risk?
- Use a **secondary WhatsApp account** for testing
- Don't send too many messages too quickly
- Never use for commercial purposes

---

## ✅ Features Working with Baileys

| Feature | Status |
|---------|--------|
| Auto-reply | ✅ Yes |
| Bulk messaging | ✅ Yes (5 max) |
| Message delays | ✅ Yes (3.5s) |
| Image messages | ✅ Yes |
| Subscriptions | ✅ Yes |
| Linking | ✅ Yes |
| Analytics | ✅ Yes |
| Reporting | ✅ Yes |
| i18n | ✅ Yes |

---

## 🔐 Security Notes

Your WhatsApp session is stored in `auth_info/`. Keep it safe:
- Don't share this folder
- Don't commit to GitHub
- Add to `.gitignore` if using git

---

## 📞 Testing

### Send a test message (via dashboard):
```bash
# Using your bot's analytics endpoint
curl http://localhost:3000/api/analytics/dashboard \
  -H "Authorization: Bearer PASSWORD"
```

### Check bot status:
```bash
curl http://localhost:3000/health
```

You should see:
```json
{
  "status": "ok",
  "baileysConnected": true
}
```

---

## 🚀 Next Steps

1. **Test locally** - Make sure everything works
2. **Monitor account** - Watch for any WhatsApp warnings
3. **Deploy carefully** - Deploy to VPS only after testing
4. **Keep phone online** - Your phone must stay connected 24/7

---

**Good luck with Baileys! 🎉**

For issues: Check `node.js` console for error messages.
