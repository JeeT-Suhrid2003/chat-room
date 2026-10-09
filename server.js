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
`);

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
    const activeUsers = io.engine.clientsCount;
    log('info', 'chat.user_disconnected', { activeUsers });
    io.emit('chat:presence', activeUsers);
  });
});

initializeDatabase().then(() => {
  server.listen(port, '0.0.0.0', () => {
    log('info', 'server.listening', { port });
  });
}).catch((error) => {
  log('error', 'database.initialization_failed', { error: error.message });
  process.exit(1);
});