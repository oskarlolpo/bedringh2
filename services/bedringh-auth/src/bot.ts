import { Telegraf } from 'telegraf';
import { randomUUID } from 'crypto';
import { db, UserRow, SessionRow } from './db.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8805865461:AAFB9RE7mrkQawTubC5mIP1AVI19gw3TedA';

export const bot = new Telegraf(BOT_TOKEN);

function confirmSession(session: SessionRow, telegramId: number, telegramUsername?: string): { success: boolean; message: string } {
  // Проверяем, не привязан ли уже этот Telegram к другому пользователю
  const existingTgUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;
  if (existingTgUser) {
    db.prepare('UPDATE sessions SET status = ? WHERE token = ?').run('rejected', session.token);
    return {
      success: false,
      message: `⚠️ К вашему Telegram-аккаунту уже привязан игровой никнейм *${existingTgUser.username}*!\n\nОдин Telegram-аккаунт может иметь только один профиль в Bedringh.`,
    };
  }

  // Создаем пользователя в базе
  const userId = randomUUID();
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, telegram_id, telegram_username, two_factor_enabled)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertUser.run(
    userId,
    session.username,
    session.password_hash,
    telegramId,
    telegramUsername || null,
    session.enable_2fa ? 1 : 0
  );

  // Обновляем статус сессии на confirmed
  db.prepare('UPDATE sessions SET status = ?, telegram_id = ? WHERE token = ?').run('confirmed', telegramId, session.token);

  const extra2faInfo = session.enable_2fa ? '\n🔒 *Двухэтапная аутентификация (2FA) включена!*' : '';

  return {
    success: true,
    message: `🎉 *Аккаунт успешно подтверждён!*\n\nИгровой ник: *${session.username}*${extra2faInfo}\n\nВернитесь в лаунчер — вход выполнен автоматически! Приятной игры в Bedringh 🚀`,
  };
}

// Обработка команды /start
bot.command('start', async (ctx) => {
  const payload = ctx.payload?.trim();
  const telegramId = ctx.from.id;
  const tgUsername = ctx.from.username;

  if (payload && payload.startsWith('reg_')) {
    const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(payload) as SessionRow | undefined;

    if (!session) {
      return ctx.reply('❌ Сессия подтверждения не найдена или была удалена. Попробуйте снова в лаунчере.');
    }

    if (session.status === 'confirmed') {
      return ctx.reply(`✅ Аккаунт *${session.username}* уже был успешно подтверждён!`, { parse_mode: 'Markdown' });
    }

    if (session.expires_at < Date.now()) {
      return ctx.reply('⏳ Время действия кода истекло. Пожалуйста, начните регистрацию в лаунчере заново.');
    }

    const result = confirmSession(session, telegramId, tgUsername);
    return ctx.reply(result.message, { parse_mode: 'Markdown' });
  }

  // Обычный старт
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;
  if (existing) {
    return ctx.reply(
      `👋 Привет, *${ctx.from.first_name}*!\n\nК вашему Telegram привязан аккаунт Bedringh: *${existing.username}*.\n\nЕсли вы забудете пароль в лаунчере, вы всегда сможете восстановить его здесь.`,
      { parse_mode: 'Markdown' }
    );
  }

  return ctx.reply(
    `👋 *Привет! Я официальный бот Bedringh Launcher.*\n\nЯ помогаю мгновенно и безопасно подтверждать регистрацию аккаунтов прямо из лаунчера. Просто нажмите «Подтвердить через Telegram» в лаунчере, и вы сразу окажетесь в игре!`,
    { parse_mode: 'Markdown' }
  );
});

// Обработка текстового сообщения (если игрок ввел 6-значный код вручную)
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const telegramId = ctx.from.id;
  const tgUsername = ctx.from.username;

  // Если это 6-значный цифровой код
  if (/^\d{6}$/.test(text)) {
    const session = db.prepare('SELECT * FROM sessions WHERE code = ? AND status = "pending"').get(text) as SessionRow | undefined;

    if (!session) {
      return ctx.reply('❌ Код не найден или уже использован. Проверьте правильность ввода кода из лаунчера.');
    }

    if (session.expires_at < Date.now()) {
      return ctx.reply('⏳ Срок действия этого кода истек. Начните регистрацию в лаунчере заново.');
    }

    const result = confirmSession(session, telegramId, tgUsername);
    return ctx.reply(result.message, { parse_mode: 'Markdown' });
  }

  return ctx.reply('Отправьте 6-значный код подтверждения из лаунчера или перейдите по ссылке из лаунчера.');
});

export async function sendPasswordResetCode(telegramId: number, code: string, username: string) {
  try {
    await bot.telegram.sendMessage(
      telegramId,
      `🔐 *Запрос на сброс пароля в Bedringh Launcher*\n\nАккаунт: *${username}*\nВаш код подтверждения: \`${code}\`\n\nВведите этот код в лаунчере для установки нового пароля. Если вы не запрашивали сброс, просто проигнорируйте это сообщение.`,
      { parse_mode: 'Markdown' }
    );
    return true;
  } catch (e) {
    console.error(`Failed to send TG reset code to ${telegramId}:`, e);
    return false;
  }
}

export async function send2FACode(telegramId: number, code: string, username: string) {
  try {
    await bot.telegram.sendMessage(
      telegramId,
      `🛡️ *Код двухэтапной аутентификации (2FA)*\n\nВход в аккаунт: *${username}*\nВаш код подтверждения: \`${code}\`\n\nВведите этот код в лаунчере для входа. Никому не сообщайте его!`,
      { parse_mode: 'Markdown' }
    );
    return true;
  } catch (e) {
    console.error(`Failed to send 2FA code to ${telegramId}:`, e);
    return false;
  }
}

