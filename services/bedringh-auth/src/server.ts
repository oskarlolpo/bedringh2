import Fastify from 'fastify';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { db, UserRow, SessionRow } from './db.js';
import { bot, sendPasswordResetCode } from './bot.js';

const JWT_SECRET = process.env.JWT_SECRET || 'bedringh_super_secret_jwt_key_2026';
const BOT_USERNAME = process.env.BOT_USERNAME || 'bedringh_bot';
const PORT = parseInt(process.env.PORT || '3100', 10);
const HOST = process.env.HOST || '0.0.0.0';

export const app = Fastify({ logger: true });

app.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Проверка здоровья
app.get('/api/health', async () => {
  return { status: 'ok', service: 'bedringh-auth', time: Date.now() };
});

// Инициация регистрации
app.post<{
  Body: { username?: string; password?: string };
}>('/api/auth/register-intent', async (request, reply) => {
  const { username, password } = request.body || {};

  if (!username || !password) {
    return reply.status(400).send({ error: 'Укажите имя пользователя и пароль' });
  }

  const trimmedUsername = username.trim();
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(trimmedUsername)) {
    return reply.status(400).send({
      error: 'Никнейм должен содержать от 3 до 16 символов (только латинские буквы, цифры и _)',
    });
  }

  if (password.length < 6) {
    return reply.status(400).send({ error: 'Пароль должен быть не менее 6 символов' });
  }

  // Проверяем, не занят ли ник
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername);
  if (existingUser) {
    return reply.status(409).send({ error: 'Пользователь с таким ником уже зарегистрирован' });
  }

  // Хешируем пароль
  const passwordHash = await bcrypt.hash(password, 10);

  // Генерируем 6-значный код и уникальный токен для бота
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const token = `reg_${randomBytes(12).toString('hex')}`;
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 минут

  // Удаляем старые незавершенные сессии для этого ника
  db.prepare('DELETE FROM sessions WHERE username = ?').run(trimmedUsername);

  // Сохраняем сессию
  db.prepare(`
    INSERT INTO sessions (token, username, password_hash, code, enable_2fa, status, expires_at)
    VALUES (?, ?, ?, ?, 0, 'pending', ?)
  `).run(token, trimmedUsername, passwordHash, code, expiresAt);

  return {
    success: true,
    token,
    code,
    botUsername: BOT_USERNAME,
    botUrl: `https://t.me/${BOT_USERNAME}?start=${token}`,
  };
});

// Опрос статуса регистрации
app.get<{
  Params: { token: string };
}>('/api/auth/poll/:token', async (request, reply) => {
  const { token } = request.params;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as SessionRow | undefined;

  if (!session) {
    return reply.status(404).send({ error: 'Сессия регистрации не найдена' });
  }

  if (session.status === 'confirmed') {
    const user = db.prepare('SELECT id, username, telegram_id, two_factor_enabled, created_at FROM users WHERE username = ?').get(session.username) as UserRow | undefined;
    if (!user) {
      return reply.status(500).send({ error: 'Ошибка получения созданного пользователя' });
    }

    const authToken = jwt.sign(
      { id: user.id, username: user.username, telegram_id: user.telegram_id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return {
      status: 'confirmed',
      authToken,
      user: {
        id: user.id,
        username: user.username,
        twoFactorEnabled: Boolean(user.two_factor_enabled),
      },
    };
  }

  if (session.status === 'rejected') {
    return {
      status: 'rejected',
      error: 'К этому Telegram-аккаунту уже привязан другой профиль!',
    };
  }

  if (session.expires_at < Date.now()) {
    return { status: 'expired', error: 'Время ожидания подтверждения истекло' };
  }

  return { status: 'pending' };
});

// Вход по нику и паролю
app.post<{
  Body: { username?: string; password?: string };
}>('/api/auth/login', async (request, reply) => {
  const { username, password } = request.body || {};

  if (!username || !password) {
    return reply.status(400).send({ error: 'Введите ник и пароль' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
  if (!user) {
    return reply.status(401).send({ error: 'Неверный никнейм или пароль' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return reply.status(401).send({ error: 'Неверный никнейм или пароль' });
  }

  // Если включена 2FA через Telegram
  if (user.two_factor_enabled && user.telegram_id) {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 минут

    db.prepare(`
      INSERT INTO two_factor_codes (username, code, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
    `).run(user.username, code, expiresAt);

    // Отправляем 2FA код в Telegram
    const { send2FACode } = await import('./bot.js');
    await send2FACode(user.telegram_id, code, user.username);

    // Временный токен для подтверждения 2FA
    const tempToken = jwt.sign(
      { id: user.id, username: user.username, pending2FA: true },
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    return {
      twoFactorRequired: true,
      tempToken,
      username: user.username,
      message: 'Код подтверждения отправлен в ваш Telegram-бот @' + BOT_USERNAME,
    };
  }

  // Обычный вход без 2FA
  const authToken = jwt.sign(
    { id: user.id, username: user.username, telegram_id: user.telegram_id },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  return {
    success: true,
    authToken,
    user: {
      id: user.id,
      username: user.username,
      twoFactorEnabled: Boolean(user.two_factor_enabled),
    },
  };
});

// Подтверждение 2FA кода
app.post<{
  Body: { username?: string; code?: string; tempToken?: string };
}>('/api/auth/verify-2fa', async (request, reply) => {
  const { username, code, tempToken } = request.body || {};

  if (!username || !code || !tempToken) {
    return reply.status(400).send({ error: 'Заполните все данные для проверки' });
  }

  try {
    const decoded = jwt.verify(tempToken, JWT_SECRET) as any;
    if (decoded.username !== username.trim() || !decoded.pending2FA) {
      return reply.status(401).send({ error: 'Недействительная сессия 2FA' });
    }
  } catch {
    return reply.status(401).send({ error: 'Сессия подтверждения истекла, попробуйте войти снова' });
  }

  const row = db.prepare('SELECT * FROM two_factor_codes WHERE username = ?').get(username.trim()) as { username: string; code: string; expires_at: number } | undefined;

  if (!row || row.code !== code.trim()) {
    return reply.status(400).send({ error: 'Неверный код подтверждения' });
  }

  if (row.expires_at < Date.now()) {
    return reply.status(400).send({ error: 'Срок действия кода истек' });
  }

  // Удаляем использованный код
  db.prepare('DELETE FROM two_factor_codes WHERE username = ?').run(username.trim());

  const user = db.prepare('SELECT id, username, telegram_id, two_factor_enabled FROM users WHERE username = ?').get(username.trim()) as UserRow;

  const authToken = jwt.sign(
    { id: user.id, username: user.username, telegram_id: user.telegram_id },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  return {
    success: true,
    authToken,
    user: {
      id: user.id,
      username: user.username,
      twoFactorEnabled: Boolean(user.two_factor_enabled),
    },
  };
});

// Переключение 2FA
app.post<{
  Body: { username?: string; enable?: boolean };
  Headers: { authorization?: string };
}>('/api/user/toggle-2fa', async (request, reply) => {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Не авторизован' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    const { enable } = request.body || {};

    db.prepare('UPDATE users SET two_factor_enabled = ? WHERE id = ?').run(enable ? 1 : 0, decoded.id);

    return { success: true, twoFactorEnabled: Boolean(enable) };
  } catch {
    return reply.status(401).send({ error: 'Недействительный токен' });
  }
});

// Запрос на восстановление пароля
app.post<{
  Body: { username?: string };
}>('/api/auth/forgot-password', async (request, reply) => {
  const { username } = request.body || {};
  if (!username) {
    return reply.status(400).send({ error: 'Укажите имя пользователя' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
  if (!user || !user.telegram_id) {
    return reply.status(404).send({ error: 'Пользователь не найден или к нему не привязан Telegram' });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + 15 * 60 * 1000;

  db.prepare(`
    INSERT INTO resets (username, code, expires_at)
    VALUES (?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at
  `).run(user.username, code, expiresAt);

  const sent = await sendPasswordResetCode(user.telegram_id, code, user.username);
  if (!sent) {
    return reply.status(500).send({ error: 'Не удалось отправить сообщение в Telegram. Убедитесь, что вы не заблокировали бота.' });
  }

  return { success: true, message: 'Код восстановления отправлен в Telegram!' };
});

// Сброс пароля по коду
app.post<{
  Body: { username?: string; code?: string; newPassword?: string };
}>('/api/auth/reset-password', async (request, reply) => {
  const { username, code, newPassword } = request.body || {};
  if (!username || !code || !newPassword) {
    return reply.status(400).send({ error: 'Заполните все поля' });
  }

  if (newPassword.length < 6) {
    return reply.status(400).send({ error: 'Новый пароль должен быть не менее 6 символов' });
  }

  const resetEntry = db.prepare('SELECT * FROM resets WHERE username = ?').get(username.trim()) as { username: string; code: string; expires_at: number } | undefined;

  if (!resetEntry || resetEntry.code !== code.trim()) {
    return reply.status(400).send({ error: 'Неверный код подтверждения' });
  }

  if (resetEntry.expires_at < Date.now()) {
    return reply.status(400).send({ error: 'Срок действия кода истек' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(newHash, username.trim());
  db.prepare('DELETE FROM resets WHERE username = ?').run(username.trim());

  return { success: true, message: 'Пароль успешно изменён! Теперь вы можете войти.' };
});

// Запуск сервера и бота
export async function start() {
  try {
    console.log(`[Bedringh Auth] Запуск HTTP сервера на http://${HOST}:${PORT}...`);
    await app.listen({ port: PORT, host: HOST });
    console.log(`[Bedringh Auth] HTTP сервер успешно запущен и слушает порт ${PORT}!`);

    console.log('[Bedringh Auth] Подключение к Telegram API...');
    bot.telegram.getMe()
      .then((me) => {
        console.log(`[Bedringh Auth] Бот подключен: @${me.username} (ID: ${me.id})`);
        return bot.launch({ dropPendingUpdates: true });
      })
      .then(() => {
        console.log('[Bedringh Auth] Telegram бот запущен и слушает входящие сообщения.');
      })
      .catch((err) => {
        console.error('[Bedringh Auth] Ошибка подключения Telegram бота:', err);
      });

    // Graceful shutdown
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } catch (err) {
    console.error('[Bedringh Auth] Фатальная ошибка запуска сервера:', err);
    process.exit(1);
  }
}

