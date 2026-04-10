const { Bot, InlineKeyboard } = require('grammy');

// Connects to your Render keys
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
const ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// The Buttons for your "User Page"
const mainMenu = new InlineKeyboard()
  .text("🔗 Link WhatsApp", "link_wa")
  .text("📊 Status", "check_status")
  .row()
  .text("⚙️ Settings", "settings");

// Command: /start
bot.command("start", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return ctx.reply("🚫 Unauthorized.");
  await ctx.reply("👋 *WhatsApp Bot Command Center*", {
    parse_mode: "Markdown",
    reply_markup: mainMenu
  });
});

// Command: /link [number]
bot.command("link", async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  const num = ctx.match;
  if (!num) return ctx.reply("❌ Use: /link 2348144821073");
  
  ctx.reply(`⏳ Requesting 8-digit code for ${num}...`);
  // This sends a signal to your server.js
  process.emit('REQUEST_PAIRING_CODE', num);
});

bot.start();

module.exports = {
  // This sends the final code to your Telegram chat
  sendCode: async (code) => {
    await bot.api.sendMessage(ADMIN_ID, `🔑 *WHATSAPP CODE:* \n\n \`${code}\``, { parse_mode: "MarkdownV2" });
  }
};