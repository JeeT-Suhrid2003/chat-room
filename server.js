const http = require('node:http');
const express = require('express');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const port = Number(process.env.PORT) || 3000;
const log = (level, event, fields = {}) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  }));
};

const database = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'chatroom',
  user: process.env.DB_USER || 'chatroom',
  password: process.env.DB_PASSWORD || 'small-room-dev',
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use((request, response, next) => {
  const startedAt = process.hrtime.bigint();
  response.on('finish', () => {
    log('info', 'http.request', {
      method: request.method,
      path: request.path,
      statusCode: response.statusCode,
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
    });
  });
  next();
});

const initializeDatabase = () => database.query(`
  CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).then(() => database.query(`
  CREATE TABLE IF NOT EXISTS chat_user_sessions (
    id BIGSERIAL PRIMARY KEY,
    socket_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disconnected_at TIMESTAMPTZ
  )
`)).then(() => database.query(`
  CREATE INDEX IF NOT EXISTS chat_user_sessions_active_idx
  ON chat_user_sessions (last_seen_at)
  WHERE disconnected_at IS NULL
`));

const persistSessionChange = (socket, event, query, values) => {
  socket.data.sessionWrite = (socket.data.sessionWrite || Promise.resolve())
    .then(() => database.query(query, values))
    .then(({ rowCount }) => {
      if (rowCount !== 1) {
        log('error', event, { socketId: socket.id, error: 'Expected one session row to be updated' });
      }
    })
    .catch((error) => log('error', event, { socketId: socket.id, error: error.message }));
};

app.get('/health', async (_request, response) => {
  try {
    await database.query('SELECT 1');
    response.json({ status: 'ok' });
  } catch (error) {
    log('error', 'health.check_failed', { error: error.message });
    response.status(503).json({ status: 'database unavailable' });
  }
});

io.on('connection', (socket) => {
  persistSessionChange(
    socket,
    'chat.session_create_failed',
    'INSERT INTO chat_user_sessions (socket_id, username) VALUES ($1, $2)',
    [socket.id, 'Guest']
  );

  database.query(
    'SELECT id, username, text, created_at AS "createdAt" FROM messages ORDER BY id DESC LIMIT 60'
  ).then(({ rows }) => {
    if (socket.connected) socket.emit('chat:history', rows.reverse());
  }).catch((error) => log('error', 'chat.history_load_failed', { error: error.message }));

  const activeUsers = io.engine.clientsCount;
  log('info', 'chat.user_connected', { activeUsers });
  io.emit('chat:presence', activeUsers);

  socket.on('chat:join', (value) => {
    const username = typeof value === 'string' ? value.trim().slice(0, 24) : '';
    socket.data.username = username || 'Guest';
    persistSessionChange(
      socket,
      'chat.session_update_failed',
      'UPDATE chat_user_sessions SET username = $1, last_seen_at = NOW() WHERE socket_id = $2 AND disconnected_at IS NULL',
      [socket.data.username, socket.id]
    );
    log('info', 'chat.user_joined', { username: socket.data.username });
    io.emit('chat:presence', io.engine.clientsCount);
  });

  socket.on('chat:typing', (isTyping) => {
    if (socket.data.username) {
      socket.broadcast.emit('chat:typing', {
        username: socket.data.username,
        isTyping: Boolean(isTyping),
      });
    }
  });

  socket.on('chat:message', async (value) => {
    if (!socket.data.username || typeof value !== 'string') return;
    const text = value.trim().slice(0, 500);
    if (!text) return;

    try {
      const { rows } = await database.query(
        'INSERT INTO messages (username, text) VALUES ($1, $2) RETURNING id, username, text, created_at AS "createdAt"',
        [socket.data.username, text]
      );
      log('info', 'chat.message_sent', {
        messageId: rows[0].id,
        username: socket.data.username,
        textLength: text.length,
      });
      io.emit('chat:message', rows[0]);
    } catch (error) {
      log('error', 'chat.message_save_failed', { error: error.message });
    }
  });

  socket.on('disconnect', () => {
    io.emit('chat:typing', { username: socket.data.username, isTyping: false });
    persistSessionChange(
      socket,
      'chat.session_disconnect_failed',
      'UPDATE chat_user_sessions SET disconnected_at = NOW(), last_seen_at = NOW() WHERE socket_id = $1 AND disconnected_at IS NULL',
      [socket.id]
    );
    const activeUsers = io.engine.clientsCount;
    log('info', 'chat.user_disconnected', { activeUsers });
    io.emit('chat:presence', activeUsers);
  });
});

const refreshActiveSessions = async () => {
  try {
    const socketIds = [...io.sockets.sockets.keys()];
    if (socketIds.length > 0) {
      await database.query(
        'UPDATE chat_user_sessions SET last_seen_at = NOW() WHERE socket_id = ANY($1::text[]) AND disconnected_at IS NULL',
        [socketIds]
      );
    }
    await database.query(`
      UPDATE chat_user_sessions
      SET disconnected_at = last_seen_at
      WHERE disconnected_at IS NULL
        AND last_seen_at < NOW() - INTERVAL '45 seconds'
    `);
  } catch (error) {
    log('error', 'chat.session_refresh_failed', { error: error.message });
  }
};

initializeDatabase().then(() => {
  server.listen(port, '0.0.0.0', () => {
    log('info', 'server.listening', { port });
    setInterval(refreshActiveSessions, 15000);
  });
}).catch((error) => {
  log('error', 'database.initialization_failed', { error: error.message });
  process.exit(1);
});