const { Bot, InlineKeyboard, InputFile } = require('grammy');

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);

// --- MENU DEFINITIONS ---

// The Main Menu seen when you type /start
const mainMenu = new InlineKeyboard()
  .text("🔗 Link WhatsApp", "link_wa")
  .text("📊 Status", "check_status")
  .row()
  .text("⚙️ Settings", "settings");

// The button under the QR Code to switch to 8-digit text code
const codeOptionMenu = new InlineKeyboard()
  .text("🔢 Use 8-Digit Code Instead", "request_pairing_code");

// The button under the 8-digit code to go back to QR
const qrOptionMenu = new InlineKeyboard()
  .text("📸 Try QR Code Instead", "restart_connection");

// --- COMMANDS ---

bot.command("start", async (ctx) => {
  await ctx.reply("👋 *WhatsApp Bot Command Center*", {
    parse_mode: "Markdown",
    reply_markup: mainMenu
  });
});

// --- CALLBACK LISTENERS (Button Clicks) ---

// 1. Initial Link Click (Defaults to QR)
bot.callbackQuery("link_wa", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("🔄 Initializing WhatsApp connection... Fetching QR Code.");
  // Signals baileysService to start the session and generate QR
  process.emit('REQUEST_QR_SCAN'); 
});

// 2. Switching to 8-Digit Code
bot.callbackQuery("request_pairing_code", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("⏳ *Requesting 8-digit code for 2348144821073...*");
  // Signals baileysService to request the numeric code
  process.emit('REQUEST_PAIRING_CODE', "2348144821073"); 
});

// 3. Restarting / Going back to QR
bot.callbackQuery("restart_connection", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply("🔄 Restarting... Switching back to QR Code scan.");
  process.emit('REQUEST_QR_SCAN');
});

// --- EXPORTED FUNCTIONS ---

module.exports = {
  // Use this to export the bot instance if you need it elsewhere
  bot: bot,

  initialize: () => {
    bot.start();
    console.log("🤖 Telegram Bot is listening...");
  },
  
  // Sends the 8-digit code as a text message
  sendCode: async (code) => {
    const adminId = process.env.TELEGRAM_ADMIN_ID;
    if (adminId) {
      await bot.api.sendMessage(adminId, `🔑 *YOUR WHATSAPP PAIRING CODE:*\n\n\`${code}\`\n\n_Copy this and paste it into:_\n_WhatsApp > Linked Devices > Link with phone number._`, {
        parse_mode: "Markdown",
        reply_markup: qrOptionMenu
      });
      console.log("✅ Pairing code sent to Telegram.");
    } else {
      console.log("❌ Cannot send code: TELEGRAM_ADMIN_ID is missing.");
    }
  },

  // Sends the QR code as a photo
  sendQR: async (imageBuffer) => {
    const adminId = process.env.TELEGRAM_ADMIN_ID;
    if (adminId) {
      // We send this as a photo so you can scan it directly
      await bot.api.sendPhoto(adminId, new InputFile(imageBuffer), {
        caption: "📸 *Scan this QR code in WhatsApp*\n\n1. Settings > Linked Devices\n2. Link a Device\n\n_If you can't scan, click the button below to get a code._",
        parse_mode: "Markdown",
        reply_markup: codeOptionMenu
      });
      console.log("✅ QR Code sent to Telegram.");
    } else {
      console.log("❌ Cannot send QR: TELEGRAM_ADMIN_ID is missing.");
    }
  }
};