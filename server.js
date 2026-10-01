const http = require('node:http');
const express = require('express');
const { Pool } = require('pg');
const { Server } = require('socket.io');

const port = Number(process.env.PORT) || 3000;
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
  } catch {
    response.status(503).json({ status: 'database unavailable' });
  }
});

io.on('connection', (socket) => {
  database.query(
    'SELECT id, username, text, created_at AS "createdAt" FROM messages ORDER BY id DESC LIMIT 60'
  ).then(({ rows }) => {
    if (socket.connected) socket.emit('chat:history', rows.reverse());
  }).catch((error) => console.error('Could not load chat history:', error));

  io.emit('chat:presence', io.engine.clientsCount);

  socket.on('chat:join', (value) => {
    const username = typeof value === 'string' ? value.trim().slice(0, 24) : '';
    socket.data.username = username || 'Guest';
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
      io.emit('chat:message', rows[0]);
    } catch (error) {
      console.error('Could not save chat message:', error);
    }
  });

  socket.on('disconnect', () => {
    io.emit('chat:typing', { username: socket.data.username, isTyping: false });
    io.emit('chat:presence', io.engine.clientsCount);
  });
});

initializeDatabase().then(() => {
  server.listen(port, '0.0.0.0', () => {
    console.log(`Small Room backend is listening on port ${port}`);
  });
}).catch((error) => {
  console.error('Could not connect to the database:', error);
  process.exit(1);
});