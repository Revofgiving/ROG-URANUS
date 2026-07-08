/**
 * Script per ottenere i Chat ID Telegram
 * 
 * USO:
 * 1. Sostituisci BOT_TOKEN con il token del tuo bot
 * 2. Assicurati che @ISACRISFOMA75 e @Lilly_Castagneto abbiano avviato una chat col bot
 * 3. Esegui: node get-telegram-chat-ids.js
 */

const https = require('https');

// INSERISCI IL TOKEN DEL BOT QUI
const BOT_TOKEN = process.argv[2] || 'INSERISCI_IL_TOKEN';

if (BOT_TOKEN === 'INSERISCI_IL_TOKEN') {
  console.log('❌ Uso: node get-telegram-chat-ids.js <BOT_TOKEN>');
  console.log('   Esempio: node get-telegram-chat-ids.js 7123456789:AAHxyz...');
  process.exit(1);
}

console.log('🔍 Recupero aggiornamenti dal bot...\n');

const url = `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`;

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      
      if (!json.ok) {
        console.log('❌ Errore:', json.description);
        return;
      }

      if (json.result.length === 0) {
        console.log('⚠️  Nessun messaggio trovato.');
        console.log('   Assicurati che @ISACRISFOMA75 e @Lilly_Castagneto');
        console.log('   abbiano avviato una chat col bot e inviato un messaggio.');
        return;
      }

      console.log('✅ Chat trovate:\n');
      
      const chats = new Map();
      for (const update of json.result) {
        const chat = update.message?.chat;
        if (chat && !chats.has(chat.id)) {
          chats.set(chat.id, {
            id: chat.id,
            username: chat.username || 'N/A',
            firstName: chat.first_name || 'N/A'
          });
        }
      }

      for (const [id, chat] of chats) {
        console.log(`👤 @${chat.username} (${chat.firstName})`);
        console.log(`   Chat ID: ${chat.id}`);
        console.log('');
      }

      const chatIds = [...chats.keys()].join(',');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📋 Copia questa riga nel .env:');
      console.log(`TELEGRAM_CHAT_IDS=${chatIds}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (e) {
      console.log('❌ Errore parsing:', e.message);
    }
  });
}).on('error', (e) => {
  console.log('❌ Errore richiesta:', e.message);
});
