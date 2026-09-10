import Fastify from 'fastify';
import cors from '@fastify/cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, UserRow, SessionRow, SKINS_DIR, CAPES_DIR } from './db.js';
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

// Yggdrasil Root Metadata (для authlib-injector)
app.get('/', async () => {
  return {
    meta: {
      serverName: 'Bedringh',
      implementationName: 'bedringh-auth',
      implementationVersion: '1.0.0',
    },
    skinDomains: [
      '2.26.87.126',
      'textures.minecraft.net',
      'oskarlolpo.play2go.cloud',
      'mc-heads.net',
    ],
  };
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

// Установка/загрузка скина и выбор плаща
app.post<{
  Body: {
    username?: string;
    authToken?: string;
    skinDataUrl?: string;
    skinBytesBase64?: string;
    model?: 'classic' | 'slim';
    capeUrl?: string;
    capeName?: string;
  };
}>('/api/skin/equip', async (request, reply) => {
  const { username, skinDataUrl, skinBytesBase64, model, capeUrl, capeName } = request.body || {};
  if (!username) {
    return reply.status(400).send({ error: 'Имя пользователя не указано' });
  }
  const trimmed = username.trim();
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(trimmed) as UserRow | undefined;
  if (!user) {
    return reply.status(404).send({ error: 'Пользователь не найден' });
  }

  const selectedModel = model === 'slim' ? 'slim' : 'classic';
  const skinFileName = `${user.username.toLowerCase()}.png`;

  const rawBase64 = skinBytesBase64 || (skinDataUrl?.includes(',') ? skinDataUrl.split(',')[1] : skinDataUrl);

  if (rawBase64) {
    try {
      const buffer = Buffer.from(rawBase64, 'base64');
      const filePath = path.join(SKINS_DIR, skinFileName);
      fs.writeFileSync(filePath, buffer);
    } catch (e: any) {
      return reply.status(500).send({ error: `Ошибка сохранения текстуры скина: ${e.message}` });
    }
  }

  db.prepare(`
    UPDATE users
    SET skin_model = ?,
        cape_url = ?,
        cape_name = ?,
        skin_texture = ?
    WHERE id = ?
  `).run(
    selectedModel,
    capeUrl || null,
    capeName || null,
    skinFileName,
    user.id
  );

  const host = request.headers.host || '2.26.87.126:3100';

  return {
    success: true,
    message: 'Скин и плащ успешно обновлены',
    skinUrl: `http://${host}/textures/skins/${skinFileName}`,
    capeUrl: capeUrl || null,
    model: selectedModel,
  };
});

// Отдача текстуры скина в формате PNG
app.get<{
  Params: { filename: string };
}>('/textures/skins/:filename', async (request, reply) => {
  let { filename } = request.params;
  if (!filename.toLowerCase().endsWith('.png')) {
    filename += '.png';
  }
  const filePath = path.join(SKINS_DIR, filename.toLowerCase());

  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=60')
      .send(buffer);
  }

  // Fallback: подтягиваем скин по нику
  const usernameWithoutExt = filename.replace(/\.png$/i, '');
  try {
    const res = await fetch(`https://mc-heads.net/skin/${usernameWithoutExt}`);
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filePath, buffer);
      return reply
        .header('Content-Type', 'image/png')
        .header('Cache-Control', 'public, max-age=60')
        .send(buffer);
    }
  } catch {}

  return reply.status(404).send({ error: 'Текстура скина не найдена' });
});

// Отдача текстуры плаща в формате PNG
app.get<{
  Params: { filename: string };
}>('/textures/capes/:filename', async (request, reply) => {
  let { filename } = request.params;
  if (!filename.toLowerCase().endsWith('.png')) {
    filename += '.png';
  }
  const filePath = path.join(CAPES_DIR, filename);

  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    return reply
      .header('Content-Type', 'image/png')
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'public, max-age=86400')
      .send(buffer);
  }

  // Fallback: подтягиваем с GitHub репозитория
  try {
    const res = await fetch(`https://raw.githubusercontent.com/Koteukin69/minecraft_cape_changer/main/textures/${filename}`);
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filePath, buffer);
      return reply
        .header('Content-Type', 'image/png')
        .header('Access-Control-Allow-Origin', '*')
        .header('Cache-Control', 'public, max-age=86400')
        .send(buffer);
    }
  } catch {}

  return reply.status(404).send({ error: 'Плащ не найден' });
});

// Получение информации о скине и плаще пользователя
app.get<{
  Params: { username: string };
}>('/api/user/:username/skin', async (request, reply) => {
  const { username } = request.params;
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as UserRow | undefined;
  if (!user) {
    return reply.status(404).send({ error: 'Пользователь не найден' });
  }

  const host = request.headers.host || '2.26.87.126:3100';
  const skinFileName = `${user.username.toLowerCase()}.png`;
  const hasSkin = fs.existsSync(path.join(SKINS_DIR, skinFileName));

  return {
    username: user.username,
    skinUrl: hasSkin ? `http://${host}/textures/skins/${skinFileName}` : `https://mc-heads.net/skin/${user.username}`,
    model: user.skin_model || 'classic',
    capeUrl: user.cape_url || null,
    capeName: user.cape_name || null,
  };
});

// Yggdrasil Session Profile API (для Minecraft клиента и authlib-injector)
const handleYggdrasilProfile = async (request: any, reply: any) => {
  const { uuid } = request.params;
  const cleanUuid = uuid.replace(/-/g, '').toLowerCase();

  // Ищем пользователя по UUID или по username
  let user = db.prepare('SELECT * FROM users WHERE LOWER(REPLACE(id, "-", "")) = ?').get(cleanUuid) as UserRow | undefined;
  if (!user) {
    user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(uuid) as UserRow | undefined;
  }

  if (!user) {
    return reply.status(204).send();
  }

  const host = request.headers.host || '2.26.87.126:3100';
  const skinFileName = `${user.username.toLowerCase()}.png`;
  const hasSkin = fs.existsSync(path.join(SKINS_DIR, skinFileName));

  const textures: Record<string, any> = {};

  if (hasSkin) {
    textures.SKIN = {
      url: `http://${host}/textures/skins/${skinFileName}`,
    };
    if (user.skin_model === 'slim') {
      textures.SKIN.metadata = { model: 'slim' };
    }
  } else {
    textures.SKIN = {
      url: `https://mc-heads.net/skin/${user.username}`,
    };
  }

  if (user.cape_url) {
    textures.CAPE = {
      url: user.cape_url,
    };
  }

  const texturesJson = JSON.stringify({
    timestamp: Date.now(),
    profileId: cleanUuid,
    profileName: user.username,
    textures,
  });

  const base64Value = Buffer.from(texturesJson).toString('base64');

  return {
    id: cleanUuid,
    name: user.username,
    properties: [
      {
        name: 'textures',
        value: base64Value,
      },
    ],
  };
};

// Получение синхронизированных настроек пользователя
app.get<{
  Querystring: { username?: string };
}>('/api/user/settings', async (request, reply) => {
  const queryUsername = (request.query as any)?.username;
  let username = queryUsername;

  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded: any = jwt.verify(authHeader.substring(7), JWT_SECRET);
      if (decoded?.username) {
        username = decoded.username;
      }
    } catch {}
  }

  if (!username) {
    return reply.status(400).send({ error: 'Имя пользователя не указано' });
  }

  const user = db.prepare('SELECT launcher_settings FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as UserRow | undefined;
  if (!user) {
    return reply.status(404).send({ error: 'Пользователь не найден' });
  }

  let settings = null;
  if (user.launcher_settings) {
    try {
      settings = JSON.parse(user.launcher_settings);
    } catch {
      settings = null;
    }
  }

  return {
    success: true,
    username,
    settings,
  };
});

// Сохранение синхронизированных настроек пользователя
app.post<{
  Body: {
    username?: string;
    authToken?: string;
    settings?: any;
  };
}>('/api/user/settings', async (request, reply) => {
  const { username: bodyUsername, authToken, settings } = request.body || {};
  let username = bodyUsername;

  const authHeader = request.headers.authorization;
  const token = authToken || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : undefined);

  if (token) {
    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      if (decoded?.username) {
        username = decoded.username;
      }
    } catch {}
  }

  if (!username) {
    return reply.status(400).send({ error: 'Имя пользователя не указано' });
  }

  const user = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username.trim()) as UserRow | undefined;
  if (!user) {
    return reply.status(404).send({ error: 'Пользователь не найден' });
  }

  if (settings === undefined || settings === null) {
    return reply.status(400).send({ error: 'Настройки не переданы' });
  }

  const settingsJson = typeof settings === 'string' ? settings : JSON.stringify(settings);

  db.prepare('UPDATE users SET launcher_settings = ? WHERE id = ?').run(settingsJson, user.id);

  return {
    success: true,
    message: 'Настройки успешно синхронизированы в Bedringh ID',
  };
});

app.get('/session/minecraft/profile/:uuid', handleYggdrasilProfile);
app.get('/sessionserver/session/minecraft/profile/:uuid', handleYggdrasilProfile);

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

