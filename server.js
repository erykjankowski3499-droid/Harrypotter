'use strict';

const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const G = require('./game');

// Czasy da się nadpisać zmiennymi środowiskowymi — przydaje się w testach.
function envMs(name, fallback) {
  const n = Number(process.env[name]);
  return process.env[name] !== undefined && Number.isFinite(n) ? n : fallback;
}

const PORT = Number(process.env.PORT) || 3000;
const COUNTDOWN_MS = envMs('PM_COUNTDOWN_MS', 3000);   // losowanie litery przed startem rundy
const COLLECT_MS = envMs('PM_COLLECT_MS', 1500);       // czas na dosłanie ostatnich odpowiedzi
const HOST_HANDOVER_MS = 15000;          // po tylu ms offline host przechodzi na kogoś innego
const ROOM_TTL_MS = 30 * 60 * 1000;      // pusty pokój znika po 30 min
const BROADCAST_THROTTLE_MS = 200;

const rooms = new Map();

const app = express();
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

/* ---------------------------------------------------------------- pomocnicze */

function randomId(bytes) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPRSTUWXYZ'; // bez I/O/Q/V, żeby nie myliły się z cyframi
  let code;
  do {
    code = Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function sanitizeCategories(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = G.cleanText(raw, G.LIMITS.category);
    const key = G.normalize(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= G.LIMITS.categoriesMax) break;
  }
  return out.length ? out : null;
}

function sanitizeAnswers(list, count) {
  const src = Array.isArray(list) ? list : [];
  return Array.from({ length: count }, (_, i) => G.cleanText(src[i], G.LIMITS.answer));
}

function connectedPlayers(room) {
  return room.order.map((id) => room.players.get(id)).filter((p) => p && p.connected);
}

function clearRoundTimers(round) {
  if (!round) return;
  clearTimeout(round.revealTimer);
  clearTimeout(round.endTimer);
  clearTimeout(round.collectTimer);
}

/* ---------------------------------------------------------------- stan pokoju */

function createRoom() {
  const room = {
    code: makeCode(),
    hostId: null,
    players: new Map(),
    order: [],
    settings: {
      categories: G.DEFAULT_CATEGORIES.slice(),
      roundTime: G.LIMITS.roundTime.def,
      graceTime: G.LIMITS.graceTime.def,
      penalty: G.LIMITS.penalty.def
    },
    phase: 'lobby',
    roundNo: 0,
    usedLetters: [],
    round: null,
    lastRound: null,
    emptySince: null,
    hostTimer: null,
    broadcastTimer: null
  };
  rooms.set(room.code, room);
  return room;
}

function addPlayer(room, nick) {
  const player = {
    id: randomId(6),
    secret: randomId(18),
    nick,
    score: 0,
    connected: false,
    socketId: null
  };
  room.players.set(player.id, player);
  room.order.push(player.id);
  if (!room.hostId) room.hostId = player.id;
  return player;
}

function recomputeResult(room) {
  const r = room.round;
  if (!r) return;
  const voters = r.participants.filter((pid) => room.players.get(pid)?.connected).length;
  r.result = G.scoreRound({
    categories: r.categories,
    letter: r.letter,
    participants: r.participants,
    answers: r.answers,
    votes: r.votes,
    voters: Math.max(voters, 1),
    stoppers: r.stoppers,
    penalty: room.settings.penalty
  });
}

function stateFor(room, player) {
  const now = Date.now();
  const r = room.round;
  const revealed = r && now >= r.startsAt;

  const players = room.order.map((id) => {
    const p = room.players.get(id);
    const inRound = r && r.participants.includes(id);
    return {
      id,
      nick: p.nick,
      score: p.score,
      connected: p.connected,
      inRound: Boolean(inRound),
      progress: inRound ? r.answers[id].filter(Boolean).length : 0,
      stopped: Boolean(r && r.stoppers.includes(id))
    };
  });

  const state = {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    now,
    roundNo: room.roundNo,
    settings: room.settings,
    presets: G.PRESET_CATEGORIES,
    limits: G.LIMITS,
    players,
    lastRound: room.lastRound,
    round: null,
    results: null,
    me: {
      id: player.id,
      isHost: room.hostId === player.id,
      participant: Boolean(r && r.participants.includes(player.id)),
      answers: r && r.answers[player.id] ? r.answers[player.id] : null,
      stopped: Boolean(r && r.stoppers.includes(player.id))
    }
  };

  if (r) {
    const first = r.firstStop && room.players.get(r.firstStop.pid);
    state.round = {
      number: r.number,
      letter: revealed ? r.letter : null,
      startsAt: r.startsAt,
      deadline: r.deadline,
      categories: r.categories,
      participants: r.participants,
      firstStop: r.firstStop
        ? { id: r.firstStop.pid, nick: first ? first.nick : r.nicks[r.firstStop.pid], at: r.firstStop.at }
        : null
    };
  }

  if (room.phase === 'voting' && r && r.result) {
    const cells = {};
    for (const pid of r.participants) {
      cells[pid] = r.result.cells[pid].map((c, ci) => ({
        ...c,
        myVote: Boolean(r.votes.get(G.voteKey(pid, ci))?.has(player.id))
      }));
    }
    state.results = {
      participants: r.participants.map((pid) => ({ id: pid, nick: room.players.get(pid)?.nick || r.nicks[pid] })),
      cells,
      totals: r.result.totals,
      penalties: r.result.penalties,
      stoppers: r.stoppers
    };
  }

  return state;
}

function broadcast(room) {
  clearTimeout(room.broadcastTimer);
  room.broadcastTimer = null;
  for (const p of room.players.values()) {
    if (p.connected && p.socketId) io.to(p.socketId).emit('state', stateFor(room, p));
  }
}

// Postęp wpisywania leci bardzo często — zbijamy go w jedną wysyłkę.
function broadcastSoon(room) {
  if (room.broadcastTimer) return;
  room.broadcastTimer = setTimeout(() => broadcast(room), BROADCAST_THROTTLE_MS);
}

/* ---------------------------------------------------------------- przebieg rundy */

function startRound(room) {
  const participants = connectedPlayers(room).map((p) => p.id);
  const letter = G.pickLetter(room.usedLetters);
  const startsAt = Date.now() + COUNTDOWN_MS;
  const categories = room.settings.categories.slice();

  room.roundNo += 1;
  room.phase = 'playing';
  room.round = {
    number: room.roundNo,
    letter,
    categories,
    startsAt,
    deadline: startsAt + room.settings.roundTime * 1000,
    participants,
    nicks: Object.fromEntries(participants.map((pid) => [pid, room.players.get(pid).nick])),
    answers: Object.fromEntries(participants.map((pid) => [pid, categories.map(() => '')])),
    stoppers: [],
    firstStop: null,
    votes: new Map(),
    finals: new Set(),
    result: null
  };

  room.round.revealTimer = setTimeout(() => broadcast(room), COUNTDOWN_MS);
  scheduleEnd(room);
  broadcast(room);
}

function scheduleEnd(room) {
  const r = room.round;
  clearTimeout(r.endTimer);
  r.endTimer = setTimeout(() => endRound(room), Math.max(0, r.deadline - Date.now()));
}

function everyoneStopped(room) {
  const r = room.round;
  const active = r.participants.filter((pid) => room.players.get(pid)?.connected);
  return active.length > 0 && active.every((pid) => r.stoppers.includes(pid));
}

function endRound(room) {
  const r = room.round;
  if (!r || room.phase !== 'playing') return;
  clearRoundTimers(r);
  room.phase = 'collecting';
  r.deadline = Math.min(r.deadline, Date.now());
  broadcast(room);
  r.collectTimer = setTimeout(() => finishCollecting(room), COLLECT_MS);
  maybeFinishCollecting(room);
}

function maybeFinishCollecting(room) {
  const r = room.round;
  const waiting = r.participants.filter(
    (pid) => room.players.get(pid)?.connected && !r.stoppers.includes(pid) && !r.finals.has(pid)
  );
  if (waiting.length === 0) finishCollecting(room);
}

function finishCollecting(room) {
  const r = room.round;
  if (!r || room.phase !== 'collecting') return;
  clearRoundTimers(r);
  room.phase = 'voting';
  recomputeResult(room);
  broadcast(room);
}

function confirmRound(room) {
  const r = room.round;
  const points = {};
  for (const pid of r.participants) {
    const p = room.players.get(pid);
    const pts = r.result.totals[pid];
    if (p) p.score += pts;
    points[pid] = pts;
  }
  room.usedLetters.push(r.letter);
  room.lastRound = { number: r.number, letter: r.letter, points };
  room.round = null;
  room.phase = 'lobby';
}

/* ---------------------------------------------------------------- host i sprzątanie */

function handOverHost(room) {
  const next = connectedPlayers(room)[0];
  if (next) room.hostId = next.id;
}

function removePlayer(room, player) {
  room.players.delete(player.id);
  room.order = room.order.filter((id) => id !== player.id);

  const r = room.round;
  if (r && room.phase === 'playing') {
    r.participants = r.participants.filter((id) => id !== player.id);
    delete r.answers[player.id];
    if (r.participants.length === 0) {
      clearRoundTimers(r);
      room.round = null;
      room.phase = 'lobby';
    } else if (everyoneStopped(room)) {
      endRound(room);
    }
  }
  if (room.hostId === player.id) {
    room.hostId = null;
    handOverHost(room);
  }
  if (room.players.size === 0) {
    destroyRoom(room);
    return;
  }
  if (room.phase === 'voting') recomputeResult(room);
  if (room.phase === 'collecting') maybeFinishCollecting(room);
  broadcast(room);
}

function destroyRoom(room) {
  clearRoundTimers(room.round);
  clearTimeout(room.hostTimer);
  clearTimeout(room.broadcastTimer);
  rooms.delete(room.code);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.emptySince && now - room.emptySince > ROOM_TTL_MS) destroyRoom(room);
  }
}, 60 * 1000).unref();

/* ---------------------------------------------------------------- gniazda */

function attach(socket, room, player) {
  // Ten sam gracz z drugiej karty — stare połączenie przestaje go reprezentować.
  if (player.socketId && player.socketId !== socket.id) {
    const old = io.sockets.sockets.get(player.socketId);
    if (old) {
      old.data = {};
      old.emit('kicked', 'Otworzyłeś grę w innym oknie.');
    }
  }
  player.connected = true;
  player.socketId = socket.id;
  socket.data = { code: room.code, playerId: player.id };
  room.emptySince = null;

  if (room.hostId === player.id) {
    clearTimeout(room.hostTimer);
    room.hostTimer = null;
  } else if (!room.players.get(room.hostId)?.connected && !room.hostTimer) {
    handOverHost(room);
  }
  if (room.phase === 'voting') recomputeResult(room);
}

function context(socket) {
  const { code, playerId } = socket.data || {};
  const room = code && rooms.get(code);
  const player = room && room.players.get(playerId);
  return room && player ? { room, player } : null;
}

function reply(cb, payload) {
  if (typeof cb === 'function') cb(payload);
}

function fail(cb, error) {
  reply(cb, { ok: false, error });
}

io.on('connection', (socket) => {
  socket.data = {};

  socket.on('room:create', (msg, cb) => {
    const nick = G.cleanText(msg?.nick, G.LIMITS.nick);
    if (!nick) return fail(cb, 'Wpisz nick.');
    const room = createRoom();
    const player = addPlayer(room, nick);
    attach(socket, room, player);
    reply(cb, { ok: true, code: room.code, secret: player.secret });
    broadcast(room);
  });

  socket.on('room:join', (msg, cb) => {
    const code = G.cleanText(msg?.code, 8).toUpperCase();
    const room = rooms.get(code);
    if (!room) return fail(cb, 'Nie ma pokoju o takim kodzie.');

    // Powrót po zerwanym połączeniu — rozpoznajemy gracza po sekrecie.
    const secret = typeof msg?.secret === 'string' ? msg.secret : '';
    const returning = secret && [...room.players.values()].find((p) => p.secret === secret);
    if (returning) {
      attach(socket, room, returning);
      reply(cb, { ok: true, code: room.code, secret: returning.secret });
      return broadcast(room);
    }

    const nick = G.cleanText(msg?.nick, G.LIMITS.nick);
    if (!nick) return fail(cb, 'Wpisz nick.');
    if (room.players.size >= G.LIMITS.playersMax) return fail(cb, 'Pokój jest pełny.');
    const taken = [...room.players.values()].some((p) => G.normalize(p.nick) === G.normalize(nick));
    if (taken) return fail(cb, 'Ten nick jest już zajęty w tym pokoju.');

    const player = addPlayer(room, nick);
    attach(socket, room, player);
    reply(cb, { ok: true, code: room.code, secret: player.secret });
    broadcast(room);
  });

  socket.on('room:leave', (_msg, cb) => {
    const ctx = context(socket);
    socket.data = {};
    if (ctx) removePlayer(ctx.room, ctx.player);
    reply(cb, { ok: true });
  });

  socket.on('settings:update', (msg, cb) => {
    const ctx = context(socket);
    if (!ctx) return fail(cb, 'Nie jesteś w pokoju.');
    const { room, player } = ctx;
    if (room.hostId !== player.id) return fail(cb, 'Ustawienia zmienia tylko host.');
    if (room.phase !== 'lobby' && room.phase !== 'finished') return fail(cb, 'Nie w trakcie rundy.');

    const categories = sanitizeCategories(msg?.categories);
    if (!categories) return fail(cb, 'Musi zostać przynajmniej jedna kategoria.');
    room.settings = {
      categories,
      roundTime: G.clampInt(msg?.roundTime, G.LIMITS.roundTime),
      graceTime: G.clampInt(msg?.graceTime, G.LIMITS.graceTime),
      penalty: G.clampInt(msg?.penalty, G.LIMITS.penalty)
    };
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('round:start', (_msg, cb) => {
    const ctx = context(socket);
    if (!ctx) return fail(cb, 'Nie jesteś w pokoju.');
    const { room, player } = ctx;
    if (room.hostId !== player.id) return fail(cb, 'Rundę zaczyna host.');
    if (room.phase !== 'lobby') return fail(cb, 'Runda już trwa.');
    startRound(room);
    reply(cb, { ok: true });
  });

  socket.on('answers:update', (msg) => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    const r = room.round;
    if (!r || !r.participants.includes(player.id) || r.stoppers.includes(player.id)) return;
    if (room.phase === 'playing' && Date.now() >= r.startsAt) {
      r.answers[player.id] = sanitizeAnswers(msg?.answers, r.categories.length);
      broadcastSoon(room);
    } else if (room.phase === 'collecting' && msg?.final) {
      r.answers[player.id] = sanitizeAnswers(msg?.answers, r.categories.length);
      r.finals.add(player.id);
      maybeFinishCollecting(room);
    }
  });

  socket.on('round:stop', (msg, cb) => {
    const ctx = context(socket);
    if (!ctx) return fail(cb, 'Nie jesteś w pokoju.');
    const { room, player } = ctx;
    const r = room.round;
    if (room.phase !== 'playing' || !r || Date.now() < r.startsAt) return fail(cb, 'Runda nie trwa.');
    if (!r.participants.includes(player.id)) return fail(cb, 'Nie grasz w tej rundzie.');
    if (r.stoppers.includes(player.id)) return reply(cb, { ok: true });

    r.answers[player.id] = sanitizeAnswers(msg?.answers, r.categories.length);
    r.stoppers.push(player.id);

    if (!r.firstStop) {
      const now = Date.now();
      r.firstStop = { pid: player.id, at: now };
      r.deadline = Math.min(r.deadline, now + room.settings.graceTime * 1000);
      scheduleEnd(room);
    }
    reply(cb, { ok: true });
    if (everyoneStopped(room)) endRound(room);
    else broadcast(room);
  });

  socket.on('vote:toggle', (msg, cb) => {
    const ctx = context(socket);
    if (!ctx) return fail(cb, 'Nie jesteś w pokoju.');
    const { room, player } = ctx;
    const r = room.round;
    if (room.phase !== 'voting' || !r) return fail(cb, 'Teraz nie ma głosowania.');
    if (!r.participants.includes(player.id)) return fail(cb, 'Głosują tylko gracze tej rundy.');

    const target = String(msg?.playerId || '');
    const ci = Number(msg?.categoryIndex);
    if (!r.participants.includes(target) || !Number.isInteger(ci) || ci < 0 || ci >= r.categories.length) {
      return fail(cb, 'Nie ma takiego hasła.');
    }
    if (target === player.id) return fail(cb, 'Nie głosujesz na własne hasła.');

    const key = G.voteKey(target, ci);
    if (!r.votes.has(key)) r.votes.set(key, new Set());
    const set = r.votes.get(key);
    if (set.has(player.id)) set.delete(player.id);
    else set.add(player.id);

    recomputeResult(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('round:confirm', (_msg, cb) => {
    const ctx = context(socket);
    if (!ctx) return fail(cb, 'Nie jesteś w pokoju.');
    const { room, player } = ctx;
    if (room.hostId !== player.id) return fail(cb, 'Wyniki zatwierdza host.');
    if (room.phase !== 'voting') return fail(cb, 'Nie ma czego zatwierdzać.');
    confirmRound(room);
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('game:end', (_msg, cb) => {
    const ctx = context(socket);
    if (!ctx) return fail(cb, 'Nie jesteś w pokoju.');
    const { room, player } = ctx;
    if (room.hostId !== player.id) return fail(cb, 'Grę kończy host.');
    if (room.phase !== 'lobby') return fail(cb, 'Najpierw dokończ rundę.');
    room.phase = 'finished';
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('game:reset', (_msg, cb) => {
    const ctx = context(socket);
    if (!ctx) return fail(cb, 'Nie jesteś w pokoju.');
    const { room, player } = ctx;
    if (room.hostId !== player.id) return fail(cb, 'Nową grę zaczyna host.');
    if (room.phase !== 'finished') return fail(cb, 'Gra jeszcze trwa.');
    for (const p of room.players.values()) p.score = 0;
    room.roundNo = 0;
    room.usedLetters = [];
    room.lastRound = null;
    room.phase = 'lobby';
    reply(cb, { ok: true });
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const ctx = context(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;

    if (!connectedPlayers(room).length) room.emptySince = Date.now();

    if (room.hostId === player.id && !room.hostTimer) {
      room.hostTimer = setTimeout(() => {
        room.hostTimer = null;
        if (!room.players.get(room.hostId)?.connected) {
          handOverHost(room);
          broadcast(room);
        }
      }, HOST_HANDOVER_MS);
      room.hostTimer.unref();
    }

    if (room.phase === 'playing' && everyoneStopped(room)) endRound(room);
    else if (room.phase === 'collecting') maybeFinishCollecting(room);
    else if (room.phase === 'voting') recomputeResult(room);
    broadcast(room);
  });
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Państwa-Miasta działa na porcie ${PORT}`);
  });
}

module.exports = { server, io, rooms, scheduleEnd, destroyRoom };
