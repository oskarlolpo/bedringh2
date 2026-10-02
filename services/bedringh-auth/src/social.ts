import { FastifyInstance, FastifyReply } from 'fastify';
import { randomBytes, createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { db, SKINS_DIR, CHAT_MEDIA_DIR } from './db.js';

const PRESENCE_TTL_MS = 90_000; // 90 секунд без heartbeat -> offline

// Активные SSE-подписчики по username (в нижнем регистре)
const socialSubscribers = new Map<string, Set<FastifyReply>>();

export function emitSocialEvent(targetUsername: string, event: string, data: any) {
  const key = targetUsername.trim().toLowerCase();
  const subs = socialSubscribers.get(key);
  if (!subs || subs.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const reply of subs) {
    try {
      reply.raw.write(payload);
    } catch {
      subs.delete(reply);
    }
  }
}

function getOfflineUuid(username: string): string {
  const md5 = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex').toLowerCase();
}

// Очищаем случайно созданные оффлайн-профили, так как социальная система только для Bedringh ID
try {
  db.prepare("DELETE FROM users WHERE password_hash = 'offline_social_account'").run();
} catch {}

export function findBedringhUser(rawUsername: string): { id: string; username: string } | undefined {
  const trimmed = rawUsername.trim();
  if (!trimmed) return undefined;
  return db
    .prepare("SELECT id, username FROM users WHERE username = ? COLLATE NOCASE AND password_hash != 'offline_social_account'")
    .get(trimmed) as { id: string; username: string } | undefined;
}

export function ensureSocialUser(rawUsername: string): { id: string; username: string } {
  const trimmed = rawUsername.trim();
  const existing = findBedringhUser(trimmed);
  if (existing) return existing;
  return { id: getOfflineUuid(trimmed), username: trimmed };
}

function getAvatarUrlForUser(username: string, hostHeader?: string): string {
  const host = hostHeader || 'bedringh.duckdns.org:3100';
  const skinFile = `${username.toLowerCase()}.png`;
  if (fs.existsSync(path.join(SKINS_DIR, skinFile))) {
    return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`;
  }
  return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64`;
}

function levenshtein(a: string, b: string): number {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function getDmPairKey(userA: string, userB: string): string {
  return [userA.trim().toLowerCase(), userB.trim().toLowerCase()].sort().join('::');
}

function buildFriendObject(myUsername: string, friendUsername: string, hostHeader?: string) {
  const userRow = ensureSocialUser(friendUsername);
  const canonicalName = userRow.username;

  const pres = db
    .prepare('SELECT * FROM user_presence WHERE username = ? COLLATE NOCASE')
    .get(canonicalName) as any;

  const now = Date.now();
  const isFresh = pres && now - (pres.updated_at || 0) <= PRESENCE_TTL_MS;
  const status: 'online' | 'in_game' | 'offline' = isFresh
    ? pres.status === 'in_game'
      ? 'in_game'
      : pres.status === 'online'
      ? 'online'
      : 'offline'
    : 'offline';

  const readRow = db
    .prepare('SELECT last_read_at FROM chat_reads WHERE reader = ? COLLATE NOCASE AND target_key = ? COLLATE NOCASE')
    .get(myUsername, canonicalName) as { last_read_at: number } | undefined;
  const lastReadAt = readRow?.last_read_at || 0;

  const unreadRow = db
    .prepare(`
      SELECT COUNT(*) as cnt
      FROM chat_messages
      WHERE room_id IS NULL
        AND sender = ? COLLATE NOCASE
        AND recipient = ? COLLATE NOCASE
        AND deleted = 0
        AND created_at > ?
    `)
    .get(canonicalName, myUsername, lastReadAt) as { cnt: number } | undefined;

  const lastMsgRow = db
    .prepare(`
      SELECT content, sender, created_at, attachment_type
      FROM chat_messages
      WHERE room_id IS NULL
        AND deleted = 0
        AND ((sender = ? COLLATE NOCASE AND recipient = ? COLLATE NOCASE)
          OR (sender = ? COLLATE NOCASE AND recipient = ? COLLATE NOCASE))
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(myUsername, canonicalName, canonicalName, myUsername) as
    | { content: string; sender: string; created_at: number; attachment_type: string | null }
    | undefined;

  let preview = lastMsgRow?.content || '';
  if (preview.startsWith('⟪mc-invite⟫')) {
    preview = 'Приглашение на сервер';
  } else if (!preview && lastMsgRow?.attachment_type === 'voice') {
    preview = 'Голосовое сообщение';
  } else if (!preview && lastMsgRow?.attachment_type === 'image') {
    preview = 'Изображение';
  }

  return {
    id: userRow.id,
    username: canonicalName,
    status,
    place: isFresh ? pres?.place || 'launcher' : 'launcher',
    lastSeen: pres?.updated_at || undefined,
    totalHours: pres?.total_minutes ? Math.round((pres.total_minutes / 60) * 10) / 10 : 0,
    avatarUrl: getAvatarUrlForUser(canonicalName, hostHeader),
    unread: unreadRow?.cnt || 0,
    lastMessage: preview || undefined,
    lastMessageSender: lastMsgRow?.sender || undefined,
    lastMessageAt: lastMsgRow?.created_at || undefined,
    gameInfo:
      status === 'in_game' && pres
        ? {
            instanceName: pres.instance_name || undefined,
            loader: pres.loader || undefined,
            mcVersion: pres.mc_version || undefined,
            serverAddress: pres.server_address || undefined,
            serverName: pres.server_name || undefined,
            packCode: pres.pack_code || undefined,
            startedAt: pres.started_at || undefined,
          }
        : undefined,
  };
}

function getFriendUsernames(username: string): string[] {
  const rows = db
    .prepare(`
      SELECT user_a, user_b
      FROM friendships
      WHERE user_a = ? COLLATE NOCASE OR user_b = ? COLLATE NOCASE
    `)
    .all(username, username) as { user_a: string; user_b: string }[];

  const lowerMe = username.toLowerCase();
  const result: string[] = [];
  for (const r of rows) {
    const other = r.user_a.toLowerCase() === lowerMe ? r.user_b : r.user_a;
    result.push(other);
  }
  return result;
}

function formatMessageRow(row: any) {
  let reactions: Record<string, string[]> = {};
  try {
    reactions = row.reactions_json ? JSON.parse(row.reactions_json) : {};
  } catch {
    reactions = {};
  }

  let voicePeaks: number[] | undefined;
  if (row.voice_peaks) {
    try {
      voicePeaks = JSON.parse(row.voice_peaks);
    } catch {}
  }

  return {
    id: row.id,
    roomId: row.room_id || undefined,
    sender: row.sender,
    recipient: row.recipient || undefined,
    content: row.content,
    replyTo: row.reply_to_id
      ? {
          id: row.reply_to_id,
          sender: row.reply_sender || '',
          preview: row.reply_preview || '',
        }
      : undefined,
    attachmentUrl: row.attachment_url || undefined,
    attachmentType: row.attachment_type || undefined,
    voiceDuration: row.voice_duration || undefined,
    voicePeaks,
    reactions,
    editedAt: row.edited_at || undefined,
    createdAt: row.created_at,
  };
}

export function registerSocialRoutes(app: FastifyInstance) {
  // 1. SSE-поток реального времени (/api/social/stream?username=...)
  app.get<{
    Querystring: { username?: string };
  }>('/api/social/stream', async (request, reply) => {
    const username = (request.query?.username || '').trim();
    if (!username) {
      return reply.status(400).send({ error: 'username required' });
    }
    ensureSocialUser(username);
    const key = username.toLowerCase();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ username, time: Date.now() })}\n\n`);

    if (!socialSubscribers.has(key)) {
      socialSubscribers.set(key, new Set());
    }
    socialSubscribers.get(key)!.add(reply);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: ping ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 20_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      socialSubscribers.get(key)?.delete(reply);
    });

    return reply;
  });

  // 2. Список друзей, входящих/исходящих заявок и групповых комнат
  app.get<{
    Querystring: { username?: string };
  }>('/api/friends/list', async (request, reply) => {
    const username = (request.query?.username || '').trim();
    if (!username) {
      return reply.status(400).send({ error: 'Укажите username' });
    }

    const me = ensureSocialUser(username);
    const friendNames = getFriendUsernames(me.username);
    const friends = friendNames.map((fn) => buildFriendObject(me.username, fn, request.headers.host));

    const incomingRows = db
      .prepare(`
        SELECT id, from_user, created_at
        FROM friend_requests
        WHERE to_user = ? COLLATE NOCASE
        ORDER BY created_at DESC
      `)
      .all(me.username) as { id: string; from_user: string; created_at: number }[];

    const outgoingRows = db
      .prepare(`
        SELECT id, to_user, created_at
        FROM friend_requests
        WHERE from_user = ? COLLATE NOCASE
        ORDER BY created_at DESC
      `)
      .all(me.username) as { id: string; to_user: string; created_at: number }[];

    // Групповые комнаты, в которых состоит пользователь
    const allRooms = db.prepare('SELECT * FROM chat_rooms ORDER BY updated_at DESC').all() as any[];
    const myRooms = allRooms
      .map((r) => {
        let members: string[] = [];
        try {
          members = JSON.parse(r.members_json);
        } catch {}
        const isMember = members.some((m) => m.toLowerCase() === me.username.toLowerCase());
        if (!isMember) return null;

        const readRow = db
          .prepare('SELECT last_read_at FROM chat_reads WHERE reader = ? COLLATE NOCASE AND target_key = ? COLLATE NOCASE')
          .get(me.username, `room:${r.id}`) as { last_read_at: number } | undefined;
        const lastReadAt = readRow?.last_read_at || 0;

        const unreadRow = db
          .prepare(`
            SELECT COUNT(*) as cnt
            FROM chat_messages
            WHERE room_id = ? AND deleted = 0 AND sender != ? COLLATE NOCASE AND created_at > ?
          `)
          .get(r.id, me.username, lastReadAt) as { cnt: number } | undefined;

        const lastMsg = db
          .prepare(`
            SELECT content, sender, created_at, attachment_type
            FROM chat_messages
            WHERE room_id = ? AND deleted = 0
            ORDER BY created_at DESC
            LIMIT 1
          `)
          .get(r.id) as any;

        let preview = lastMsg?.content || '';
        if (preview.startsWith('⟪mc-invite⟫')) preview = 'Приглашение на сервер';
        else if (!preview && lastMsg?.attachment_type === 'voice') preview = 'Голосовое сообщение';
        else if (!preview && lastMsg?.attachment_type === 'image') preview = 'Изображение';

        return {
          id: r.id,
          title: r.title,
          owner: r.owner,
          members,
          unread: unreadRow?.cnt || 0,
          lastMessage: preview || undefined,
          lastMessageSender: lastMsg?.sender || undefined,
          lastMessageAt: lastMsg?.created_at || r.updated_at,
          createdAt: r.created_at,
        };
      })
      .filter(Boolean);

    return {
      success: true,
      friends,
      incomingRequests: incomingRows.map((r) => ({
        id: r.id,
        username: r.from_user,
        avatarUrl: getAvatarUrlForUser(r.from_user, request.headers.host),
        direction: 'incoming',
        createdAt: r.created_at,
      })),
      outgoingRequests: outgoingRows.map((r) => ({
        id: r.id,
        username: r.to_user,
        avatarUrl: getAvatarUrlForUser(r.to_user, request.headers.host),
        direction: 'outgoing',
        createdAt: r.created_at,
      })),
      rooms: myRooms,
    };
  });

  // 3. Поиск пользователей с поддержкой защиты от опечаток (как в Millida FriendSearch)
  app.get<{
    Querystring: { q?: string; username?: string };
  }>('/api/friends/search', async (request) => {
    const q = (request.query?.q || '').trim();
    const requester = (request.query?.username || '').trim().toLowerCase();
    if (q.length < 2) {
      return { success: true, users: [], similar: [] };
    }

    const qLower = q.toLowerCase();
    const allUsers = db
      .prepare('SELECT username FROM users ORDER BY created_at DESC LIMIT 500')
      .all() as { username: string }[];

    const exactOrSubstring: any[] = [];
    const similarMatches: { username: string; dist: number }[] = [];

    for (const u of allUsers) {
      const nameLower = u.username.toLowerCase();
      if (nameLower === requester) continue;

      if (nameLower.includes(qLower)) {
        exactOrSubstring.push({
          username: u.username,
          avatarUrl: getAvatarUrlForUser(u.username, request.headers.host),
        });
      } else {
        const dist = levenshtein(qLower, nameLower);
        if (dist <= 2 || (qLower.length >= 4 && dist <= 3)) {
          similarMatches.push({ username: u.username, dist });
        }
      }
    }

    similarMatches.sort((a, b) => a.dist - b.dist);

    return {
      success: true,
      users: exactOrSubstring.slice(0, 10),
      similar: similarMatches.slice(0, 3).map((s) => ({
        username: s.username,
        avatarUrl: getAvatarUrlForUser(s.username, request.headers.host),
      })),
    };
  });

  // 4. Отправка заявки в друзья
  app.post<{
    Body: { username?: string; targetUsername?: string };
  }>('/api/friends/request', async (request, reply) => {
    const fromRaw = (request.body?.username || '').trim();
    const toRaw = (request.body?.targetUsername || '').trim();

    if (!fromRaw || !toRaw) {
      return reply.status(400).send({ error: 'Укажите ваш ник и ник друга' });
    }
    if (fromRaw.toLowerCase() === toRaw.toLowerCase()) {
      return reply.status(400).send({ error: 'Нельзя добавить в друзья самого себя' });
    }

    const me = findBedringhUser(fromRaw);
    if (!me) {
      return reply.status(401).send({ error: 'Войдите в аккаунт Bedringh ID, чтобы добавлять друзей' });
    }

    const target = findBedringhUser(toRaw);
    if (!target) {
      return reply.status(404).send({ error: `Пользователь "${toRaw}" не найден в Bedringh ID` });
    }

    // Проверяем, не друзья ли уже
    const existingFriendship = db
      .prepare(`
        SELECT id FROM friendships
        WHERE (user_a = ? COLLATE NOCASE AND user_b = ? COLLATE NOCASE)
           OR (user_a = ? COLLATE NOCASE AND user_b = ? COLLATE NOCASE)
      `)
      .get(me.username, target.username, target.username, me.username);

    if (existingFriendship) {
      return reply.status(409).send({ error: `${target.username} уже у вас в друзьях` });
    }

    // Проверяем встречную заявку (если друг уже кидал нам заявку — сразу принимаем!)
    const reverseReq = db
      .prepare('SELECT id FROM friend_requests WHERE from_user = ? COLLATE NOCASE AND to_user = ? COLLATE NOCASE')
      .get(target.username, me.username) as { id: string } | undefined;

    if (reverseReq) {
      db.prepare('DELETE FROM friend_requests WHERE id = ?').run(reverseReq.id);
      const [ua, ub] = [me.username, target.username].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase())
      );
      db.prepare('INSERT OR IGNORE INTO friendships (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)').run(
        `fr_${randomBytes(6).toString('hex')}`,
        ua,
        ub,
        Date.now()
      );

      emitSocialEvent(target.username, 'friend_accepted', { username: me.username });
      emitSocialEvent(me.username, 'friend_accepted', { username: target.username });

      return {
        success: true,
        autoAccepted: true,
        message: `Встречная заявка принята! Вы и ${target.username} теперь друзья!`,
      };
    }

    const reqId = `req_${randomBytes(6).toString('hex')}`;
    const now = Date.now();
    try {
      db.prepare(`
        INSERT OR REPLACE INTO friend_requests (id, from_user, to_user, created_at)
        VALUES (?, ?, ?, ?)
      `).run(reqId, me.username, target.username, now);
    } catch {
      return reply.status(409).send({ error: 'Заявка уже отправлена' });
    }

    emitSocialEvent(target.username, 'friend_request', {
      id: reqId,
      username: me.username,
      createdAt: now,
    });

    return {
      success: true,
      requestId: reqId,
      message: `Заявка в друзья отправлена игроку ${target.username}`,
    };
  });

  // 5. Принятие или отклонение заявки в друзья
  app.post<{
    Body: { username?: string; requestId?: string; action?: 'accept' | 'reject' };
  }>('/api/friends/respond', async (request, reply) => {
    const username = (request.body?.username || '').trim();
    const requestId = (request.body?.requestId || '').trim();
    const action = request.body?.action;

    if (!username || !requestId || !action) {
      return reply.status(400).send({ error: 'Неверные параметры запроса' });
    }

    const reqRow = db
      .prepare('SELECT * FROM friend_requests WHERE id = ?')
      .get(requestId) as { id: string; from_user: string; to_user: string } | undefined;

    if (!reqRow) {
      return reply.status(404).send({ error: 'Заявка не найдена' });
    }

    db.prepare('DELETE FROM friend_requests WHERE id = ?').run(requestId);

    if (action === 'accept') {
      const [ua, ub] = [reqRow.from_user, reqRow.to_user].sort((a, b) =>
        a.toLowerCase().localeCompare(b.toLowerCase())
      );
      db.prepare('INSERT OR IGNORE INTO friendships (id, user_a, user_b, created_at) VALUES (?, ?, ?, ?)').run(
        `fr_${randomBytes(6).toString('hex')}`,
        ua,
        ub,
        Date.now()
      );

      emitSocialEvent(reqRow.from_user, 'friend_accepted', { username: reqRow.to_user });
      emitSocialEvent(reqRow.to_user, 'friend_accepted', { username: reqRow.from_user });
    }

    return { success: true };
  });

  // 6. Отмена исходящей заявки
  app.post<{
    Body: { username?: string; requestId?: string };
  }>('/api/friends/cancel', async (request) => {
    const requestId = (request.body?.requestId || '').trim();
    if (requestId) {
      db.prepare('DELETE FROM friend_requests WHERE id = ?').run(requestId);
    }
    return { success: true };
  });

  // 7. Удаление друга
  app.post<{
    Body: { username?: string; friendUsername?: string };
  }>('/api/friends/remove', async (request, reply) => {
    const u1 = (request.body?.username || '').trim();
    const u2 = (request.body?.friendUsername || '').trim();
    if (!u1 || !u2) {
      return reply.status(400).send({ error: 'Укажите пользователей' });
    }

    db.prepare(`
      DELETE FROM friendships
      WHERE (user_a = ? COLLATE NOCASE AND user_b = ? COLLATE NOCASE)
         OR (user_a = ? COLLATE NOCASE AND user_b = ? COLLATE NOCASE)
    `).run(u1, u2, u2, u1);

    emitSocialEvent(u2, 'friend_removed', { username: u1 });
    return { success: true };
  });

  // 8. Живой Presence Heartbeat + учёт времени в игре
  app.post<{
    Body: {
      username?: string;
      status?: 'online' | 'in_game' | 'away' | 'offline';
      place?: 'game' | 'launcher' | 'web';
      gameInfo?: {
        instanceName?: string;
        loader?: string;
        mcVersion?: string;
        serverAddress?: string;
        serverName?: string;
        packCode?: string;
        startedAt?: number;
      };
    };
  }>('/api/friends/presence', async (request, reply) => {
    const rawUser = (request.body?.username || '').trim();
    if (!rawUser) {
      return reply.status(400).send({ error: 'username required' });
    }

    const me = ensureSocialUser(rawUser);
    const status = request.body?.status || 'online';
    const place = status === 'in_game' ? 'game' : request.body?.place || 'launcher';
    const g = request.body?.gameInfo;
    const now = Date.now();

    const prev = db
      .prepare('SELECT status, updated_at, total_minutes, started_at FROM user_presence WHERE username = ? COLLATE NOCASE')
      .get(me.username) as { status: string; updated_at: number; total_minutes: number; started_at: number | null } | undefined;

    let totalMinutes = prev?.total_minutes || 0;
    if (prev && prev.status === 'in_game' && status === 'in_game') {
      const elapsedMs = now - (prev.updated_at || now);
      if (elapsedMs > 0 && elapsedMs <= 180_000) {
        totalMinutes += Math.max(1, Math.round(elapsedMs / 60_000));
      }
    }

    const startedAt =
      status === 'in_game'
        ? g?.startedAt || (prev?.status === 'in_game' ? prev.started_at : now) || now
        : null;

    db.prepare(`
      INSERT INTO user_presence (
        username, status, place, instance_name, loader, mc_version,
        server_address, server_name, pack_code, started_at, total_minutes, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        status = excluded.status,
        place = excluded.place,
        instance_name = excluded.instance_name,
        loader = excluded.loader,
        mc_version = excluded.mc_version,
        server_address = excluded.server_address,
        server_name = excluded.server_name,
        pack_code = excluded.pack_code,
        started_at = excluded.started_at,
        total_minutes = excluded.total_minutes,
        updated_at = excluded.updated_at
    `).run(
      me.username,
      status,
      place,
      status === 'in_game' ? g?.instanceName || null : null,
      status === 'in_game' ? g?.loader || null : null,
      status === 'in_game' ? g?.mcVersion || null : null,
      status === 'in_game' ? g?.serverAddress || null : null,
      status === 'in_game' ? g?.serverName || null : null,
      status === 'in_game' ? g?.packCode || null : null,
      startedAt,
      totalMinutes,
      now
    );

    // Если статус или сервер изменился — уведомляем друзей в реальном времени
    const friendNames = getFriendUsernames(me.username);
    for (const fn of friendNames) {
      emitSocialEvent(fn, 'presence_update', {
        username: me.username,
        status,
        place,
        lastSeen: now,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        gameInfo: status === 'in_game' ? g : undefined,
      });
    }

    return { success: true, totalHours: Math.round((totalMinutes / 60) * 10) / 10 };
  });

  // 9. Профиль игрока (статистика для карточки друга)
  app.get<{
    Params: { username: string };
  }>('/api/friends/profile/:username', async (request) => {
    const target = ensureSocialUser(request.params.username);
    const pres = db
      .prepare('SELECT * FROM user_presence WHERE username = ? COLLATE NOCASE')
      .get(target.username) as any;

    const friendsCount = getFriendUsernames(target.username).length;

    return {
      success: true,
      profile: {
        username: target.username,
        avatarUrl: getAvatarUrlForUser(target.username, request.headers.host),
        totalHours: pres?.total_minutes ? Math.round((pres.total_minutes / 60) * 10) / 10 : 0,
        lastInstance: pres?.instance_name || null,
        lastServer: pres?.server_address || null,
        lastSeen: pres?.updated_at || null,
        friendsCount,
      },
    };
  });

  // 10. История чата (Личка или Групповая комната)
  app.get<{
    Querystring: { username?: string; peer?: string; roomId?: string };
  }>('/api/chat/history', async (request, reply) => {
    const username = (request.query?.username || '').trim();
    const peer = (request.query?.peer || '').trim();
    const roomId = (request.query?.roomId || '').trim();

    if (!username || (!peer && !roomId)) {
      return reply.status(400).send({ error: 'Укажите username и peer или roomId' });
    }

    const now = Date.now();

    if (roomId) {
      const rows = db
        .prepare(`
          SELECT * FROM chat_messages
          WHERE room_id = ? AND deleted = 0
          ORDER BY created_at ASC
          LIMIT 200
        `)
        .all(roomId) as any[];

      db.prepare(`
        INSERT INTO chat_reads (reader, target_key, last_read_at)
        VALUES (?, ?, ?)
        ON CONFLICT(reader, target_key) DO UPDATE SET last_read_at = excluded.last_read_at
      `).run(username, `room:${roomId}`, now);

      return {
        success: true,
        messages: rows.map(formatMessageRow),
        peerReadAt: now,
      };
    }

    const rows = db
      .prepare(`
        SELECT * FROM chat_messages
        WHERE room_id IS NULL
          AND deleted = 0
          AND ((sender = ? COLLATE NOCASE AND recipient = ? COLLATE NOCASE)
            OR (sender = ? COLLATE NOCASE AND recipient = ? COLLATE NOCASE))
        ORDER BY created_at ASC
        LIMIT 200
      `)
      .all(username, peer, peer, username) as any[];

    // Отмечаем прочитанным для нас
    db.prepare(`
      INSERT INTO chat_reads (reader, target_key, last_read_at)
      VALUES (?, ?, ?)
      ON CONFLICT(reader, target_key) DO UPDATE SET last_read_at = excluded.last_read_at
    `).run(username, peer, now);

    emitSocialEvent(peer, 'chat_read', { reader: username, readAt: now });

    const peerReadRow = db
      .prepare('SELECT last_read_at FROM chat_reads WHERE reader = ? COLLATE NOCASE AND target_key = ? COLLATE NOCASE')
      .get(peer, username) as { last_read_at: number } | undefined;

    return {
      success: true,
      messages: rows.map(formatMessageRow),
      peerReadAt: peerReadRow?.last_read_at || 0,
    };
  });

  // 11. Отправка сообщения в чат (текст, ⟪mc-invite⟫, картинка, голосовое сообщение, ответ)
  app.post<{
    Body: {
      sender?: string;
      recipient?: string;
      roomId?: string;
      content?: string;
      replyToId?: string;
      attachmentDataUrl?: string;
      attachmentType?: 'image' | 'voice';
      voiceDuration?: number;
      voicePeaks?: number[];
    };
  }>('/api/chat/send', async (request, reply) => {
    const senderRaw = (request.body?.sender || '').trim();
    const recipientRaw = (request.body?.recipient || '').trim();
    const roomId = (request.body?.roomId || '').trim() || null;
    const content = (request.body?.content || '').trim();
    const replyToId = (request.body?.replyToId || '').trim() || null;
    const attachmentDataUrl = request.body?.attachmentDataUrl;
    const attachmentType = request.body?.attachmentType || null;
    const voiceDuration = request.body?.voiceDuration || null;
    const voicePeaks = Array.isArray(request.body?.voicePeaks) ? JSON.stringify(request.body.voicePeaks) : null;

    if (!senderRaw || (!recipientRaw && !roomId)) {
      return reply.status(400).send({ error: 'Отсутствует отправитель или получатель' });
    }
    if (!content && !attachmentDataUrl) {
      return reply.status(400).send({ error: 'Пустое сообщение' });
    }

    const me = ensureSocialUser(senderRaw);
    const recipient = recipientRaw ? ensureSocialUser(recipientRaw).username : null;

    let attachmentUrl: string | null = null;
    if (attachmentDataUrl && attachmentDataUrl.includes(',')) {
      const [meta, b64] = attachmentDataUrl.split(',');
      let ext = 'bin';
      if (meta.includes('image/png')) ext = 'png';
      else if (meta.includes('image/jpeg')) ext = 'jpg';
      else if (meta.includes('image/webp')) ext = 'webp';
      else if (meta.includes('image/gif')) ext = 'gif';
      else if (meta.includes('audio/webm')) ext = 'webm';
      else if (meta.includes('audio/ogg')) ext = 'ogg';
      else if (meta.includes('audio/mp4') || meta.includes('audio/mpeg')) ext = 'mp3';

      const fileName = `msg_${Date.now()}_${randomBytes(4).toString('hex')}.${ext}`;
      const filePath = path.join(CHAT_MEDIA_DIR, fileName);
      fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
      const host = request.headers.host || 'bedringh.duckdns.org:3100';
      attachmentUrl = `http://${host}/api/chat/media/${fileName}`;
    }

    let replySender: string | null = null;
    let replyPreview: string | null = null;
    if (replyToId) {
      const orig = db
        .prepare('SELECT sender, content, attachment_type FROM chat_messages WHERE id = ?')
        .get(replyToId) as { sender: string; content: string; attachment_type: string | null } | undefined;
      if (orig) {
        replySender = orig.sender;
        replyPreview = orig.content.startsWith('⟪mc-invite⟫')
          ? 'Приглашение на сервер'
          : orig.content || (orig.attachment_type === 'voice' ? 'Голосовое сообщение' : 'Изображение');
      }
    }

    const msgId = `m_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO chat_messages (
        id, room_id, sender, recipient, content,
        reply_to_id, reply_sender, reply_preview,
        attachment_url, attachment_type, voice_duration, voice_peaks,
        reactions_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)
    `).run(
      msgId,
      roomId,
      me.username,
      recipient,
      content,
      replyToId,
      replySender,
      replyPreview,
      attachmentUrl,
      attachmentType,
      voiceDuration,
      voicePeaks,
      now
    );

    const formatted = formatMessageRow(
      db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(msgId)
    );

    if (roomId) {
      db.prepare('UPDATE chat_rooms SET updated_at = ? WHERE id = ?').run(now, roomId);
      const room = db.prepare('SELECT members_json FROM chat_rooms WHERE id = ?').get(roomId) as { members_json: string } | undefined;
      if (room) {
        try {
          const members: string[] = JSON.parse(room.members_json);
          for (const member of members) {
            emitSocialEvent(member, 'chat_message', formatted);
          }
        } catch {}
      }
    } else if (recipient) {
      emitSocialEvent(recipient, 'chat_message', formatted);
      emitSocialEvent(me.username, 'chat_message', formatted);
    }

    return {
      success: true,
      message: formatted,
    };
  });

  // 12. Раздача медиафайлов чата (картинки, голосовые сообщения)
  app.get<{
    Params: { filename: string };
  }>('/api/chat/media/:filename', async (request, reply) => {
    const safeName = path.basename(request.params.filename);
    const filePath = path.join(CHAT_MEDIA_DIR, safeName);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Медиафайл не найден' });
    }
    const ext = path.extname(safeName).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.webp') contentType = 'image/webp';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webm') contentType = 'audio/webm';
    else if (ext === '.ogg') contentType = 'audio/ogg';
    else if (ext === '.mp3') contentType = 'audio/mpeg';

    return reply
      .header('Content-Type', contentType)
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .send(fs.createReadStream(filePath));
  });

  // 13. Редактирование сообщения
  app.post<{
    Body: { username?: string; messageId?: string; content?: string };
  }>('/api/chat/edit', async (request, reply) => {
    const username = (request.body?.username || '').trim();
    const messageId = (request.body?.messageId || '').trim();
    const content = (request.body?.content || '').trim();
    if (!username || !messageId || !content) {
      return reply.status(400).send({ error: 'Неверные параметры' });
    }

    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as any;
    if (!row || row.sender.toLowerCase() !== username.toLowerCase()) {
      return reply.status(403).send({ error: 'Нельзя редактировать чужое сообщение' });
    }

    const editedAt = Date.now();
    db.prepare('UPDATE chat_messages SET content = ?, edited_at = ? WHERE id = ?').run(
      content,
      editedAt,
      messageId
    );

    const updated = formatMessageRow(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId));
    if (row.room_id) {
      const room = db.prepare('SELECT members_json FROM chat_rooms WHERE id = ?').get(row.room_id) as any;
      if (room) {
        try {
          for (const m of JSON.parse(room.members_json)) {
            emitSocialEvent(m, 'chat_edit', updated);
          }
        } catch {}
      }
    } else if (row.recipient) {
      emitSocialEvent(row.recipient, 'chat_edit', updated);
      emitSocialEvent(row.sender, 'chat_edit', updated);
    }

    return { success: true, message: updated };
  });

  // 14. Удаление сообщения (у обоих собеседников)
  app.post<{
    Body: { username?: string; messageId?: string };
  }>('/api/chat/delete', async (request, reply) => {
    const username = (request.body?.username || '').trim();
    const messageId = (request.body?.messageId || '').trim();
    if (!username || !messageId) {
      return reply.status(400).send({ error: 'Неверные параметры' });
    }

    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as any;
    if (!row) return { success: true };

    db.prepare('UPDATE chat_messages SET deleted = 1 WHERE id = ?').run(messageId);

    const eventData = { id: messageId, roomId: row.room_id || undefined, sender: row.sender, recipient: row.recipient };
    if (row.room_id) {
      const room = db.prepare('SELECT members_json FROM chat_rooms WHERE id = ?').get(row.room_id) as any;
      if (room) {
        try {
          for (const m of JSON.parse(room.members_json)) {
            emitSocialEvent(m, 'chat_delete', eventData);
          }
        } catch {}
      }
    } else if (row.recipient) {
      emitSocialEvent(row.recipient, 'chat_delete', eventData);
      emitSocialEvent(row.sender, 'chat_delete', eventData);
    }

    return { success: true };
  });

  // 15. Реакции на сообщение
  app.post<{
    Body: { username?: string; messageId?: string; reaction?: string };
  }>('/api/chat/react', async (request, reply) => {
    const username = (request.body?.username || '').trim();
    const messageId = (request.body?.messageId || '').trim();
    const reaction = (request.body?.reaction || '').trim();
    if (!username || !messageId || !reaction) {
      return reply.status(400).send({ error: 'Неверные параметры' });
    }

    const row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(messageId) as any;
    if (!row) return reply.status(404).send({ error: 'Сообщение не найдено' });

    let reactions: Record<string, string[]> = {};
    try {
      reactions = row.reactions_json ? JSON.parse(row.reactions_json) : {};
    } catch {
      reactions = {};
    }

    const list = Array.isArray(reactions[reaction]) ? reactions[reaction] : [];
    const idx = list.findIndex((u) => u.toLowerCase() === username.toLowerCase());
    if (idx >= 0) {
      list.splice(idx, 1);
      if (list.length === 0) delete reactions[reaction];
      else reactions[reaction] = list;
    } else {
      reactions[reaction] = [...list, username];
    }

    db.prepare('UPDATE chat_messages SET reactions_json = ? WHERE id = ?').run(
      JSON.stringify(reactions),
      messageId
    );

    const payload = { id: messageId, roomId: row.room_id || undefined, reactions };
    if (row.room_id) {
      const room = db.prepare('SELECT members_json FROM chat_rooms WHERE id = ?').get(row.room_id) as any;
      if (room) {
        try {
          for (const m of JSON.parse(room.members_json)) {
            emitSocialEvent(m, 'chat_react', payload);
          }
        } catch {}
      }
    } else if (row.recipient) {
      emitSocialEvent(row.recipient, 'chat_react', payload);
      emitSocialEvent(row.sender, 'chat_react', payload);
    }

    return { success: true, reactions };
  });

  // 16. Отметка диалога прочитанным + индикатор "печатает..."
  app.post<{
    Body: { username?: string; peer?: string; roomId?: string };
  }>('/api/chat/read', async (request) => {
    const username = (request.body?.username || '').trim();
    const peer = (request.body?.peer || '').trim();
    const roomId = (request.body?.roomId || '').trim();
    if (!username) return { success: false };

    const now = Date.now();
    const targetKey = roomId ? `room:${roomId}` : peer;
    if (targetKey) {
      db.prepare(`
        INSERT INTO chat_reads (reader, target_key, last_read_at)
        VALUES (?, ?, ?)
        ON CONFLICT(reader, target_key) DO UPDATE SET last_read_at = excluded.last_read_at
      `).run(username, targetKey, now);

      if (peer) {
        emitSocialEvent(peer, 'chat_read', { reader: username, readAt: now });
      }
    }
    return { success: true, readAt: now };
  });

  app.post<{
    Body: { username?: string; peer?: string; roomId?: string };
  }>('/api/chat/typing', async (request) => {
    const username = (request.body?.username || '').trim();
    const peer = (request.body?.peer || '').trim();
    const roomId = (request.body?.roomId || '').trim();
    if (!username) return { success: false };

    if (roomId) {
      const room = db.prepare('SELECT members_json FROM chat_rooms WHERE id = ?').get(roomId) as any;
      if (room) {
        try {
          for (const m of JSON.parse(room.members_json)) {
            if (m.toLowerCase() !== username.toLowerCase()) {
              emitSocialEvent(m, 'chat_typing', { sender: username, roomId });
            }
          }
        } catch {}
      }
    } else if (peer) {
      emitSocialEvent(peer, 'chat_typing', { sender: username });
    }
    return { success: true };
  });

  // 17. Групповые комнаты (создание, приглашение, выход)
  app.post<{
    Body: { owner?: string; title?: string; members?: string[] };
  }>('/api/rooms/create', async (request, reply) => {
    const ownerRaw = (request.body?.owner || '').trim();
    const title = (request.body?.title || '').trim();
    const rawMembers = Array.isArray(request.body?.members) ? request.body.members : [];

    if (!ownerRaw || !title) {
      return reply.status(400).send({ error: 'Укажите название группы' });
    }

    const owner = ensureSocialUser(ownerRaw).username;
    const memberSet = new Set<string>([owner]);
    for (const m of rawMembers) {
      if (m && m.trim()) {
        memberSet.add(ensureSocialUser(m.trim()).username);
      }
    }

    const members = Array.from(memberSet);
    const roomId = `room_${randomBytes(6).toString('hex')}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO chat_rooms (id, title, owner, members_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(roomId, title, owner, JSON.stringify(members), now, now);

    const roomObj = {
      id: roomId,
      title,
      owner,
      members,
      unread: 0,
      lastMessageAt: now,
      createdAt: now,
    };

    for (const m of members) {
      emitSocialEvent(m, 'room_updated', roomObj);
    }

    return { success: true, room: roomObj };
  });

  app.post<{
    Body: { username?: string; roomId?: string };
  }>('/api/rooms/leave', async (request, reply) => {
    const username = (request.body?.username || '').trim();
    const roomId = (request.body?.roomId || '').trim();
    if (!username || !roomId) {
      return reply.status(400).send({ error: 'Неверные параметры' });
    }

    const row = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(roomId) as any;
    if (!row) return { success: true };

    let members: string[] = [];
    try {
      members = JSON.parse(row.members_json);
    } catch {}

    const nextMembers = members.filter((m) => m.toLowerCase() !== username.toLowerCase());
    if (nextMembers.length === 0) {
      db.prepare('DELETE FROM chat_rooms WHERE id = ?').run(roomId);
      db.prepare('DELETE FROM chat_messages WHERE room_id = ?').run(roomId);
    } else {
      db.prepare('UPDATE chat_rooms SET members_json = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify(nextMembers),
        Date.now(),
        roomId
      );
    }

    return { success: true };
  });
}
