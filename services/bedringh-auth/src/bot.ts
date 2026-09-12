import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { randomUUID } from 'crypto';
import { db, UserRow, SessionRow } from './db.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

if (!BOT_TOKEN) {
  console.warn('[Telegram Bot] Внимание: TELEGRAM_BOT_TOKEN не установлен в .env или переменных окружения!');
}

export const bot = new Telegraf(BOT_TOKEN || 'dummy_token');

bot.catch((err, ctx) => {
  console.error(`[Telegraf] Error in bot update ${ctx.updateType}:`, err);
});

function get2FAMessage(username: string, enabled: boolean) {
  const statusText = enabled ? 'Включена' : 'Выключена';
  const descText = enabled
    ? 'При каждом входе в лаунчер вам будет приходить одноразовый 6-значный код в этот чат.'
    : 'Вход в лаунчер выполняется сразу по логину и паролю.';
  const buttonText = enabled ? 'Отключить 2FA' : 'Включить 2FA';
  const actionData = enabled ? 'disable_2fa' : 'enable_2fa';

  return {
    text: `*Настройки безопасности аккаунта ${username}*\n\nДвухэтапная аутентификация (2FA): *${statusText}*\n${descText}`,
    keyboard: Markup.inlineKeyboard([Markup.button.callback(buttonText, actionData)]),
  };
}

function confirmSession(session: SessionRow, telegramId: number, telegramUsername?: string): { success: boolean; user?: UserRow; error?: string } {
  // Проверяем, не привязан ли уже этот Telegram к другому пользователю
  const existingTgUser = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;
  if (existingTgUser) {
    db.prepare('UPDATE sessions SET status = ? WHERE token = ?').run('rejected', session.token);
    return {
      success: false,
      error: `К вашему Telegram-аккаунту уже привязан игровой никнейм ${existingTgUser.username}. Один Telegram-аккаунт может иметь только один профиль в Bedringh.`,
    };
  }

  // Создаем пользователя в базе (по умолчанию 2FA выключена, пользователь включает сам кнопкой)
  const userId = randomUUID();
  const insertUser = db.prepare(`
    INSERT INTO users (id, username, password_hash, telegram_id, telegram_username, two_factor_enabled)
    VALUES (?, ?, ?, ?, ?, 0)
  `);

  insertUser.run(
    userId,
    session.username,
    session.password_hash,
    telegramId,
    telegramUsername || null
  );

  // Обновляем статус сессии на confirmed
  db.prepare('UPDATE sessions SET status = ?, telegram_id = ? WHERE token = ?').run('confirmed', telegramId, session.token);

  const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow;

  return {
    success: true,
    user: createdUser,
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
      return ctx.reply('Сессия подтверждения не найдена или была удалена. Попробуйте снова в лаунчере.');
    }

    if (session.status === 'confirmed') {
      return ctx.reply(`Аккаунт ${session.username} уже был успешно подтверждён!`);
    }

    if (session.expires_at < Date.now()) {
      return ctx.reply('Время действия кода истекло. Пожалуйста, начните регистрацию в лаунчере заново.');
    }

    const result = confirmSession(session, telegramId, tgUsername);
    if (!result.success) {
      return ctx.reply(result.error || 'Ошибка при подтверждении.');
    }

    const info = get2FAMessage(session.username, false);
    await ctx.reply(
      `Аккаунт успешно подтверждён!\n\nИгровой никнейм: ${session.username}\n\nВернитесь в лаунчер — вход выполнен автоматически! Приятной игры в Bedringh.`
    );
    return ctx.reply(info.text, { parse_mode: 'Markdown', ...info.keyboard });
  }

  // Обычный старт
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;
  if (existing) {
    const info = get2FAMessage(existing.username, Boolean(existing.two_factor_enabled));
    return ctx.reply(info.text, { parse_mode: 'Markdown', ...info.keyboard });
  }

  return ctx.reply(
    `Привет! Я официальный бот Bedringh Launcher.\n\nЯ помогаю подтверждать регистрацию аккаунтов прямо из лаунчера и защищать ваш аккаунт двухэтапной аутентификацией.`
  );
});

// Команда /2fa и /settings
bot.command(['2fa', 'settings'], async (ctx) => {
  const telegramId = ctx.from.id;
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;

  if (!existing) {
    return ctx.reply('У вас пока нет привязанного аккаунта Bedringh. Зарегистрируйтесь в лаунчере!');
  }

  const info = get2FAMessage(existing.username, Boolean(existing.two_factor_enabled));
  return ctx.reply(info.text, { parse_mode: 'Markdown', ...info.keyboard });
});

// Кнопка переключения 2FA
bot.action('enable_2fa', async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;
  if (!existing) {
    return ctx.answerCbQuery('Аккаунт не найден');
  }

  db.prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = ?').run(existing.id);
  await ctx.answerCbQuery('2FA успешно включена!');

  const info = get2FAMessage(existing.username, true);
  return ctx.editMessageText(info.text, { parse_mode: 'Markdown', ...info.keyboard });
});

bot.action('disable_2fa', async (ctx) => {
  const telegramId = ctx.from?.id;
  if (!telegramId) return;

  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as UserRow | undefined;
  if (!existing) {
    return ctx.answerCbQuery('Аккаунт не найден');
  }

  db.prepare('UPDATE users SET two_factor_enabled = 0 WHERE id = ?').run(existing.id);
  await ctx.answerCbQuery('2FA отключена.');

  const info = get2FAMessage(existing.username, false);
  return ctx.editMessageText(info.text, { parse_mode: 'Markdown', ...info.keyboard });
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
      return ctx.reply('Код не найден или уже использован. Проверьте код из лаунчера.');
    }

    if (session.expires_at < Date.now()) {
      return ctx.reply('Срок действия этого кода истек. Начните регистрацию в лаунчере заново.');
    }

    const result = confirmSession(session, telegramId, tgUsername);
    if (!result.success) {
      return ctx.reply(result.error || 'Ошибка при подтверждении.');
    }

    const info = get2FAMessage(session.username, false);
    await ctx.reply(
      `Аккаунт успешно подтверждён!\n\nИгровой никнейм: ${session.username}\n\nВернитесь в лаунчер — вход выполнен автоматически!`
    );
    return ctx.reply(info.text, { parse_mode: 'Markdown', ...info.keyboard });
  }

  return ctx.reply('Отправьте 6-значный код подтверждения из лаунчера или используйте команду /2fa для управления двухэтапной аутентификацией.');
});

export async function sendPasswordResetCode(telegramId: number, code: string, username: string) {
  try {
    await bot.telegram.sendMessage(
      telegramId,
      `Запрос на сброс пароля в Bedringh Launcher\n\nАккаунт: ${username}\nВаш код подтверждения: ${code}\n\nВведите этот код в лаунчере для установки нового пароля.`
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
      `Код двухэтапной аутентификации (2FA)\n\nВход в аккаунт: ${username}\nВаш одноразовый код: ${code}\n\nВведите этот код в лаунчере для завершения входа.`
    );
    return true;
  } catch (e) {
    console.error(`Failed to send 2FA code to ${telegramId}:`, e);
    return false;
  }
}
