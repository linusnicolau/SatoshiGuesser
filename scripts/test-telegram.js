import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

// Simple zero-dependency dotenv loader
function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let val = match[2].trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          process.env[key] = val;
        }
      }
    } catch (err) {}
  }
}

loadEnv();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8961307464:AAEKetDqXwpAaKrh2vKlnsw9StMgMvjiAk0';

async function main() {
  console.log('===================================================');
  console.log('    TELEGRAM BOT AUTODETECT & TEST UTILITY 🤖    ');
  console.log('===================================================');
  console.log(`Using Bot Token: ${TOKEN}\n`);

  console.log('Step 1: Fetching updates from Telegram API...');
  try {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    if (!response.ok) {
      const text = await response.text();
      console.error(`\n❌ Error: Telegram API returned status ${response.status}`);
      console.error(`Details: ${text}`);
      process.exit(1);
    }

    const data = await response.json();
    if (!data.ok) {
      console.error(`\n❌ Error: Telegram API response is not OK.`);
      console.error(data);
      process.exit(1);
    }

    const results = data.result || [];
    if (results.length === 0) {
      console.log('\n⚠️  No recent messages found for this bot.');
      console.log('---------------------------------------------------');
      console.log('HOW TO GET YOUR CHAT ID:');
      console.log('1. Open Telegram.');
      console.log('2. Search for your bot using its username (e.g. your custom bot name).');
      console.log('3. Press "Start" (or send any text message to the bot).');
      console.log('4. Run this test script again!');
      console.log('---------------------------------------------------');
      process.exit(0);
    }

    console.log(`\n🎉 Found ${results.length} recent interactions!`);
    console.log('---------------------------------------------------');

    const chats = new Map();
    for (const item of results) {
      const message = item.message || item.channel_post || item.edited_message;
      if (message && message.chat) {
        const chat = message.chat;
        const name = chat.first_name ? `${chat.first_name} ${chat.last_name || ''}`.trim() : chat.title || 'Unknown';
        chats.set(chat.id, {
          id: chat.id,
          name,
          username: chat.username || 'N/A',
          type: chat.type
        });
      }
    }

    console.log('Active Users / Chats:');
    for (const [id, info] of chats.entries()) {
      console.log(`- 👤 Name: \x1b[32m${info.name}\x1b[0m (@${info.username})`);
      console.log(`  💬 Chat ID: \x1b[1m\x1b[36m${info.id}\x1b[0m (Type: ${info.type})\n`);
    }

    // Take the most recent chat id
    const targetChat = Array.from(chats.values()).pop();
    console.log(`Step 2: Sending a test message to: ${targetChat.name} (Chat ID: ${targetChat.id})...`);
    
    const sendUrl = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
    const sendResponse = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChat.id,
        text: `🔔 *SatoshiGuesser Telegram Integration Test*
Hello *${targetChat.name}*!
Your Telegram integration is working perfectly. 

Save your credentials:
• *TELEGRAM_BOT_TOKEN:* \`${TOKEN}\`
• *TELEGRAM_CHAT_ID:* \`${targetChat.id}\`

You are ready to deploy to the cloud! 🚀`,
        parse_mode: 'Markdown'
      })
    });

    if (sendResponse.ok) {
      console.log('\n✅ Success! A test message has been sent to your Telegram chat.');
      console.log(`Make sure to set the environment variable: TELEGRAM_CHAT_ID="${targetChat.id}"`);
    } else {
      const errText = await sendResponse.text();
      console.error(`\n❌ Failed to send test message: ${errText}`);
    }

  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
  }
}

main();
