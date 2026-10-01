const socket = io();
const messages = document.querySelector('#messages');
const welcomeNote = document.querySelector('#welcome-note');
const messageForm = document.querySelector('#message-form');
const messageInput = document.querySelector('#message-input');
const nameDialog = document.querySelector('#name-dialog');
const nameForm = document.querySelector('#name-form');
const nameInput = document.querySelector('#name-input');
const profileName = document.querySelector('#profile-name');
const profileAvatar = document.querySelector('#profile-avatar');
const typingLine = document.querySelector('#typing-line');
const charCount = document.querySelector('#char-count');

let username = localStorage.getItem('small-room-name') || '';
let typingTimer;
let typingUser = '';

function setUsername(value) {
  username = value.trim().slice(0, 24) || 'Guest';
  localStorage.setItem('small-room-name', username);
  profileName.textContent = username;
  profileAvatar.textContent = username.charAt(0).toUpperCase();
  socket.emit('chat:join', username);
}

function formatTime(value) {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

function addMessage(message) {
  welcomeNote.hidden = true;
  const row = document.createElement('article');
  row.className = `message${message.username === username ? ' message-own' : ''}`;

  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = message.username.charAt(0).toUpperCase();

  const body = document.createElement('div');
  body.className = 'message-body';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const author = document.createElement('strong');
  author.textContent = message.username;
  const time = document.createElement('time');
  time.textContent = formatTime(message.createdAt);
  time.dateTime = message.createdAt;
  const text = document.createElement('p');
  text.className = 'message-text';
  text.textContent = message.text;

  meta.append(author, time);
  body.append(meta, text);
  row.append(avatar, body);
  messages.append(row);
  messages.scrollTop = messages.scrollHeight;
}

document.querySelector('#change-name').addEventListener('click', () => {
  nameInput.value = username;
  nameDialog.showModal();
  nameInput.focus();
});

nameForm.addEventListener('submit', (event) => {
  event.preventDefault();
  setUsername(nameInput.value);
  nameDialog.close();
  messageInput.focus();
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  socket.emit('chat:message', text);
  socket.emit('chat:typing', false);
  messageInput.value = '';
  charCount.textContent = '0 / 500';
  messageInput.focus();
});

messageInput.addEventListener('input', () => {
  charCount.textContent = `${messageInput.value.length} / 500`;
  socket.emit('chat:typing', Boolean(messageInput.value.trim()));
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('chat:typing', false), 1200);
});

socket.on('connect', () => {
  if (username) setUsername(username);
  else {
    nameDialog.showModal();
    nameInput.focus();
  }
});

socket.on('chat:history', (history) => {
  messages.querySelectorAll('.message').forEach((message) => message.remove());
  history.forEach(addMessage);
});

socket.on('chat:message', addMessage);
socket.on('chat:presence', (count) => {
  document.querySelector('#online-count').textContent = count;
});

socket.on('chat:typing', ({ username: sender, isTyping }) => {
  if (sender === username) return;
  typingUser = isTyping ? sender : '';
  typingLine.textContent = typingUser ? `${typingUser} is typing...` : '';
});