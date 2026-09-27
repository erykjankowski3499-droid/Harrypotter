'use strict';

process.env.PM_COUNTDOWN_MS = '50';
process.env.PM_COLLECT_MS = '200';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { server, io, rooms, scheduleEnd, destroyRoom } = require('../server');

let url;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  url = `http://localhost:${server.address().port}`;
});

test.after(async () => {
  for (const room of [...rooms.values()]) destroyRoom(room);
  io.close();
  await new Promise((resolve) => server.close(resolve));
});

function client() {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true });
  socket.last = null;
  socket.on('state', (s) => { socket.last = s; });
  return socket;
}

const call = (socket, event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(socket, predicate, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (socket.last && predicate(socket.last)) return socket.last;
    await sleep(20);
  }
  throw new Error(`timeout; ostatni stan: ${socket.last && socket.last.phase}`);
}

function answersFor(letter, words) {
  return words.map((w) => (w ? letter + w : ''));
}

test('pełna runda: STOP skraca czas, kara, głosowanie, zatwierdzenie', async () => {
  const a = client();
  const b = client();
  const c = client();

  const created = await call(a, 'room:create', { nick: 'Ala' });
  assert.ok(created.ok);
  const code = created.code;

  assert.equal((await call(b, 'room:join', { code, nick: 'ala' })).ok, false, 'nick zajęty bez względu na wielkość liter');
  assert.ok((await call(b, 'room:join', { code, nick: 'Bartek' })).ok);
  assert.ok((await call(c, 'room:join', { code, nick: 'Celina' })).ok);

  assert.equal((await call(b, 'round:start')).ok, false, 'tylko host startuje');

  assert.ok((await call(a, 'settings:update', {
    categories: ['Państwo', 'Miasto', 'Zwierzę'], roundTime: 120, graceTime: 5, penalty: 10
  })).ok);

  assert.ok((await call(a, 'round:start')).ok);
  const hidden = await waitFor(a, (s) => s.phase === 'playing');
  assert.equal(hidden.round.letter, null, 'litera ukryta w trakcie losowania');

  const playing = await waitFor(b, (s) => s.phase === 'playing' && s.round.letter);
  const L = playing.round.letter;

  // Bartek wpisuje (bez STOP) — postęp powinien dojść do innych
  b.emit('answers:update', { answers: answersFor(L, ['x1', 'x2', '']) });
  await waitFor(a, (s) => s.players.find((p) => p.nick === 'Bartek').progress === 2);

  // Ala naciska STOP bez kompletu → czas skrócony do graceTime
  const before = playing.round.deadline;
  assert.ok((await call(a, 'round:stop', { answers: answersFor(L, ['aa', '', '']) })).ok);
  const afterStop = await waitFor(c, (s) => s.round.firstStop);
  assert.equal(afterStop.round.firstStop.nick, 'Ala');
  assert.ok(afterStop.round.deadline < before);
  assert.ok(afterStop.round.deadline - afterStop.now <= 5000 + 50);

  // Celina z kompletem, Bartek też zatrzymuje → koniec rundy od razu
  assert.ok((await call(c, 'round:stop', { answers: answersFor(L, ['aa', 'cc', 'dd']) })).ok);
  assert.ok((await call(b, 'round:stop', { answers: answersFor(L, ['x1', 'x2', '']) })).ok);

  const voting = await waitFor(a, (s) => s.phase === 'voting');
  const ids = Object.fromEntries(voting.players.map((p) => [p.nick, p.id]));
  // Państwo: Ala i Celina mają to samo → po 5
  assert.equal(voting.results.cells[ids.Ala][0].points, 5);
  assert.equal(voting.results.cells[ids.Celina][0].points, 5);
  assert.equal(voting.results.penalties[ids.Ala], 10);
  assert.equal(voting.results.penalties[ids.Bartek], 10);
  assert.equal(voting.results.penalties[ids.Celina], undefined);

  // Nie można głosować na siebie
  assert.equal((await call(c, 'vote:toggle', { playerId: ids.Celina, categoryIndex: 2 })).ok, false);

  // Ala i Bartek odrzucają "Zwierzę" Celiny → Celina dostaje karę, bo STOP bez kompletu uznanych
  await call(a, 'vote:toggle', { playerId: ids.Celina, categoryIndex: 2 });
  await call(b, 'vote:toggle', { playerId: ids.Celina, categoryIndex: 2 });
  const voted = await waitFor(c, (s) => s.results.cells[ids.Celina][2].status === 'rejected');
  assert.equal(voted.results.penalties[ids.Celina], 10);
  assert.equal(voted.results.cells[ids.Celina][2].myVote, false);

  // Cofnięcie głosu przywraca hasło
  await call(b, 'vote:toggle', { playerId: ids.Celina, categoryIndex: 2 });
  const back = await waitFor(c, (s) => s.results.cells[ids.Celina][2].status === 'ok');
  const expected = back.results.totals;

  assert.ok((await call(a, 'round:confirm')).ok);
  const lobby = await waitFor(b, (s) => s.phase === 'lobby' && s.lastRound);
  for (const p of lobby.players) assert.equal(p.score, expected[p.id]);

  a.close(); b.close(); c.close();
});

test('powrót po rozłączeniu zachowuje gracza i odpowiedzi', async () => {
  const a = client();
  const b = client();
  const { code } = await call(a, 'room:create', { nick: 'Host' });
  const joined = await call(b, 'room:join', { code, nick: 'Gość' });

  await call(a, 'round:start');
  const s = await waitFor(b, (st) => st.phase === 'playing' && st.round.letter);
  const answers = answersFor(s.round.letter, ['ab', '', '', '', '', '', '', '']);
  b.emit('answers:update', { answers });
  await waitFor(a, (st) => st.players.find((p) => p.nick === 'Gość').progress === 1);

  b.close();
  await waitFor(a, (st) => st.players.find((p) => p.nick === 'Gość').connected === false);

  const b2 = client();
  assert.ok((await call(b2, 'room:join', { code, secret: joined.secret })).ok);
  const resumed = await waitFor(b2, (st) => st.phase === 'playing');
  assert.equal(resumed.me.answers[0], answers[0]);
  assert.equal(resumed.players.length, 2, 'bez duplikatu gracza');

  a.close(); b2.close();
});

test('koniec czasu bez STOP zbiera ostatnie odpowiedzi', async () => {
  const a = client();
  const { code } = await call(a, 'room:create', { nick: 'Solo' });
  await call(a, 'round:start');
  const s = await waitFor(a, (st) => st.phase === 'playing' && st.round.letter);
  const finalAnswers = answersFor(s.round.letter, ['ies', '', '', '', '', '', '', '']);

  // Klient dosyła odpowiedzi dopiero po zamknięciu rundy (jak przeglądarka).
  a.on('state', (st) => {
    if (st.phase === 'collecting') a.emit('answers:update', { answers: finalAnswers, final: true });
  });

  // Skracamy rundę, żeby nie czekać 2 minut.
  const room = rooms.get(code);
  room.round.deadline = Date.now() + 100;
  scheduleEnd(room);

  const voting = await waitFor(a, (st) => st.phase === 'voting');
  const cell = voting.results.cells[voting.me.id][0];
  assert.equal(cell.text, finalAnswers[0]);
  assert.equal(cell.points, 15);
  assert.equal(voting.results.penalties[voting.me.id], undefined, 'bez STOP nie ma kary');
  a.close();
});
