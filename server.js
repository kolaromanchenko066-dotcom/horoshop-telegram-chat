require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN || !OWNER_CHAT_ID) {
  console.error('Missing BOT_TOKEN or OWNER_CHAT_ID in .env');
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// Simple in-memory storage
const chats = new Map();

function ensureChat(visitorId) {
  if (!chats.has(visitorId)) {
    chats.set(visitorId, {
      messages: [],
      customerName: '',
      pageUrl: '',
      createdAt: Date.now(),
      lastSeen: Date.now()
    });
  }
  return chats.get(visitorId);
}

async function sendTelegramMessage(text) {
  const res = await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: OWNER_CHAT_ID,
      text
    })
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}

app.get('/', (req, res) => {
  res.send('Horoshop Telegram Chat server is running');
});

// Customer sends message from site
app.post('/send', async (req, res) => {
  try {
    const { visitorId, message, customerName, pageUrl } = req.body;

    if (!visitorId || !message) {
      return res.status(400).json({ ok: false, error: 'visitorId and message are required' });
    }

    const chat = ensureChat(visitorId);
    if (customerName) chat.customerName = customerName;
    if (pageUrl) chat.pageUrl = pageUrl;
    chat.lastSeen = Date.now();

    chat.messages.push({
      from: 'customer',
      text: message,
      ts: Date.now()
    });

    const tgText = [
      `💬 Новий запит з сайту`,
      `ID: #${visitorId}`,
      customerName ? `Ім'я: ${customerName}` : null,
      pageUrl ? `Сторінка: ${pageUrl}` : null,
      `Питання: ${message}`,
      '',
      `Відповідь пиши так:`,
      `#${visitorId} ваш текст`
    ].filter(Boolean).join('\n');

    await sendTelegramMessage(tgText);

    res.json({ ok: true });
  } catch (error) {
    console.error('/send error', error);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

// Site polls for messages
app.get('/messages', (req, res) => {
  const { visitorId, since } = req.query;

  if (!visitorId) {
    return res.status(400).json({ ok: false, error: 'visitorId is required' });
  }

  const chat = ensureChat(visitorId);
  const sinceNum = Number(since || 0);
  const messages = chat.messages.filter(m => m.ts > sinceNum);

  res.json({ ok: true, messages });
});

// Telegram webhook receives your replies
app.post('/telegram-webhook', async (req, res) => {
  try {
    const msg = req.body?.message;
    if (!msg || !msg.text) {
      return res.json({ ok: true });
    }

    const fromChatId = String(msg.chat.id);
    if (fromChatId !== String(OWNER_CHAT_ID)) {
      return res.json({ ok: true });
    }

    const text = msg.text.trim();
    const match = text.match(/^#([a-zA-Z0-9_-]+)\s+([\s\S]+)/);

    if (!match) {
      return res.json({ ok: true, note: 'Reply format must be: #visitorId message' });
    }

    const visitorId = match[1];
    const replyText = match[2];

    const chat = ensureChat(visitorId);
    chat.lastSeen = Date.now();
    chat.messages.push({
      from: 'manager',
      text: replyText,
      ts: Date.now()
    });

    res.json({ ok: true });
  } catch (error) {
    console.error('/telegram-webhook error', error);
    res.status(500).json({ ok: false, error: 'Webhook error' });
  }
});

// Set webhook helper
app.get('/set-webhook', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
      return res.status(400).send('BASE_URL missing in .env');
    }

    const webhookUrl = `${baseUrl}/telegram-webhook`;
    const tgRes = await fetch(`${TELEGRAM_API}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl })
    });

    const data = await tgRes.json();
    res.json(data);
  } catch (error) {
    console.error('/set-webhook error', error);
    res.status(500).json({ ok: false, error: 'Cannot set webhook' });
  }
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
