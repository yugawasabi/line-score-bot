const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const admin = require('firebase-admin');

// ===== Firebase 初期化 =====
// RenderのSecret Fileは /opt/render/project/src/ に配置される
const serviceAccount = require('/opt/render/project/src/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// ===== LINE Messaging API 設定 =====
const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN, // RenderのEnvironment Variablesに設定
  channelSecret: process.env.CHANNEL_SECRET            // RenderのEnvironment Variablesに設定
};

const client = new Client(config);
const app = express();

// ===== Webhook受信 =====
app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;
  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleMessage(event);
    }
  }
  res.sendStatus(200);
});

// ===== メッセージ処理 =====
async function handleMessage(event) {
  const userId = event.source.userId;
  const text = event.message.text.trim();

  // ===== 名前登録 =====
  if (text.startsWith('/register ')) {
    const name = text.replace('/register ', '').trim();
    if (!name) {
      await client.replyMessage(event.replyToken, { type: 'text', text: '名前を入力してください。\n例: /register A' });
      return;
    }
    await db.collection('users').doc(userId).set({ name }, { merge: true });
    await client.replyMessage(event.replyToken, { type: 'text', text: `名前を「${name}」に登録しました！` });
    return;
  }

  // ===== ランキング表示 =====
  if (text === '/ranking') {
    await sendRanking(event.replyToken);
    return;
  }

  // ===== 得点 (+2000, -1500, +2,000 など) =====
  const match = text.match(/^([+-][\d,]+)$/);
  if (match) {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists || !userDoc.data().name) {
      await client.replyMessage(event.replyToken, { type: 'text', text: 'まず名前を登録してください。\n例: /register A' });
      return;
    }

    // カンマを削除して数値化
    const rawScore = match[1].replace(/,/g, '');
    const score = parseInt(rawScore, 10);

    const data = userDoc.data();
    const name = data.name;
    const scores = data.scores || [];
    let total = data.total || 0;

    scores.push(score);
    total += score;

    await userRef.set({ name, scores, total }, { merge: true });

    await client.replyMessage(event.replyToken, { type: 'text', text: `${name}さんの合計: ${total}点` });
    return;
  }

  // ===== それ以外は無反応 =====
  return;
}

// ===== ランキング表示 =====
async function sendRanking(replyToken) {
  const snapshot = await db.collection('users').get();
  if (snapshot.empty) {
    await client.replyMessage(replyToken, { type: 'text', text: 'まだ得点が登録されていません。' });
    return;
  }

  const ranking = snapshot.docs
    .map(doc => doc.data())
    .filter(user => user.name)
    .sort((a, b) => (b.total || 0) - (a.total || 0));

  if (ranking.length === 0) {
    await client.replyMessage(replyToken, { type: 'text', text: '名前登録されたユーザーがいません。' });
    return;
  }

  let message = '🏆 合計得点ランキング 🏆\n';
  ranking.forEach((user, i) => {
    message += `${i + 1}. ${user.name}: ${user.total || 0}点\n`;
  });

  await client.replyMessage(replyToken, { type: 'text', text: message });
}

// ===== サーバー起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
