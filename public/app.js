(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SESSION_KEY = 'pm-session';
  const NICK_KEY = 'pm-nick';
  const SYNC_DELAY_MS = 350;
  const URGENT_MS = 10000;

  const ROUND_TIMES = [30, 45, 60, 90, 120, 150, 180, 240, 300, 420, 600];
  const GRACE_TIMES = [3, 5, 10, 15, 20, 30, 45, 60];
  const PENALTIES = [0, 5, 10, 15, 20, 25, 30, 50];

  /* ------------------------------------------------------------ pamięć */

  // localStorage bywa niedostępny (tryb prywatny) — gra ma działać i bez niego.
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* trudno */ } },
    del(key) { try { localStorage.removeItem(key); } catch { /* trudno */ } }
  };

  /* ------------------------------------------------------------ stan klienta */

  const socket = io();
  let state = null;
  let clockOffset = 0;
  let session = store.get(SESSION_KEY);
  let myAnswers = [];
  let roundKey = null;
  let finalSentFor = null;
  let syncTimer = null;
  let rollTimer = null;
  let shownLetter = null;
  let wakeLock = null;

  const urlCode = (new URLSearchParams(location.search).get('pokoj') || '').toUpperCase().slice(0, 4);

  /* ------------------------------------------------------------ narzędzia */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function show(name) {
    ['home', 'lobby', 'play', 'collect', 'vote', 'final'].forEach((s) => {
      $(`screen-${s}`).hidden = s !== name;
    });
  }

  let toastTimer = null;
  function toast(message) {
    const t = $('toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function emit(event, payload) {
    return new Promise((resolve) => {
      socket.timeout(8000).emit(event, payload, (err, res) => {
        resolve(err ? { ok: false, error: 'Serwer nie odpowiada. Spróbuj jeszcze raz.' } : res);
      });
    });
  }

  async function act(event, payload) {
    const res = await emit(event, payload);
    if (!res.ok) toast(res.error);
    return res;
  }

  const serverNow = () => Date.now() + clockOffset;

  function formatTime(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  function formatDuration(sec) {
    if (sec < 60) return `${sec} s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s ? `${m}:${String(s).padStart(2, '0')} min` : `${m} min`;
  }

  // Prawdziwy minus zamiast dywizu — czytelniejszy przy ujemnych punktach.
  const num = (n) => (n < 0 ? `−${-n}` : String(n));
  const signed = (n) => (n < 0 ? `−${-n}` : `+${n}`);

  function startsWithLetter(text, letter) {
    const t = text.trim();
    return t.length > 0 && t.charAt(0).toLocaleUpperCase('pl') === letter;
  }

  const isHost = () => state && state.me.isHost;

  function saveSession(code, secret) {
    session = { code, secret };
    store.set(SESSION_KEY, session);
    if (urlCode) history.replaceState(null, '', location.pathname);
  }

  function clearSession() {
    session = null;
    state = null;
    roundKey = null;
    store.del(SESSION_KEY);
  }

  /* ------------------------------------------------------------ połączenie */

  socket.on('connect', async () => {
    $('conn').hidden = true;
    const canResume = session && (!urlCode || urlCode === session.code);
    if (!canResume) {
      if (!state) renderHome();
      return;
    }
    const res = await emit('room:join', { code: session.code, secret: session.secret });
    if (!res.ok) {
      clearSession();
      renderHome();
      toast('Poprzedni pokój już nie istnieje.');
    }
  });

  socket.on('disconnect', () => {
    if (session) $('conn').hidden = false;
  });

  socket.on('kicked', (message) => {
    state = null;
    renderHome();
    toast(message);
  });

  socket.on('state', (next) => {
    clockOffset = next.now - Date.now();
    state = next;

    if (next.phase === 'collecting') sendFinalAnswers();
    render();
  });

  function sendFinalAnswers() {
    const r = state.round;
    const key = `${state.code}:${r.number}`;
    if (finalSentFor === key || !state.me.participant || state.me.stopped) return;
    finalSentFor = key;
    clearTimeout(syncTimer);
    socket.emit('answers:update', { answers: myAnswers, final: true });
  }

  /* ------------------------------------------------------------ render */

  function render() {
    if (!state) return renderHome();
    updateWakeLock(state.phase === 'playing');
    if (state.phase !== 'playing') stopRolling();

    switch (state.phase) {
      case 'lobby': return renderLobby();
      case 'playing': return renderPlay();
      case 'collecting': return show('collect');
      case 'voting': return renderVote();
      case 'finished': return renderFinal();
      default: return renderHome();
    }
  }

  /* ---------- start ---------- */

  function renderHome() {
    show('home');
    if (!$('nick').value) $('nick').value = store.get(NICK_KEY) || '';
    if (urlCode && !$('join-code').value) $('join-code').value = urlCode;
  }

  $('form-home').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nick = $('nick').value.trim();
    if (!nick) return $('nick').focus();
    store.set(NICK_KEY, nick);
    $('btn-create').disabled = true;
    const res = await act('room:create', { nick });
    $('btn-create').disabled = false;
    if (res.ok) saveSession(res.code, res.secret);
  });

  async function join() {
    const nick = $('nick').value.trim();
    const code = $('join-code').value.trim().toUpperCase();
    if (!nick) { toast('Najpierw wpisz nick.'); return $('nick').focus(); }
    if (code.length !== 4) { toast('Kod pokoju ma 4 litery.'); return $('join-code').focus(); }
    store.set(NICK_KEY, nick);
    $('btn-join').disabled = true;
    const secret = session && session.code === code ? session.secret : undefined;
    const res = await act('room:join', { code, nick, secret });
    $('btn-join').disabled = false;
    if (res.ok) saveSession(res.code, res.secret);
  }

  $('btn-join').addEventListener('click', join);
  $('join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); join(); }
  });

  /* ---------- poczekalnia ---------- */

  function playerRow(p, { delta, place } = {}) {
    const li = el('li', `player${p.connected ? '' : ' offline'}`);
    if (place !== undefined) li.append(el('span', 'place', String(place)));
    else li.append(el('span', 'dot'));
    li.append(el('span', 'name', p.nick));
    if (p.id === state.hostId) li.append(el('span', 'tag host', 'host'));
    if (p.id === state.me.id) li.append(el('span', 'tag', 'ty'));
    if (delta !== undefined) li.append(el('span', `delta${delta < 0 ? ' neg' : ''}`, signed(delta)));
    li.append(el('span', 'score', num(p.score)));
    return li;
  }

  function fillSelect(select, values, current, label) {
    const list = values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
    if (select.dataset.sig !== list.join(',')) {
      select.replaceChildren(...list.map((v) => {
        const o = el('option', '', label(v));
        o.value = String(v);
        return o;
      }));
      select.dataset.sig = list.join(',');
    }
    select.value = String(current);
  }

  function pushSettings(patch) {
    act('settings:update', { ...state.settings, ...patch });
  }

  function renderLobby() {
    show('lobby');
    const host = isHost();

    $('lobby-code').textContent = state.code;

    const last = state.lastRound;
    const lastBox = $('last-round');
    lastBox.hidden = !last;
    if (last) {
      const tile = el('div', 'letter-tile small', last.letter);
      const text = el('div');
      text.append(el('p', 'eyebrow', `Runda ${last.number} zaliczona`), el('p', 'muted', 'Punkty z tej rundy przy nickach.'));
      lastBox.replaceChildren(tile, text);
    }

    const players = [...state.players].sort((a, b) => b.score - a.score);
    $('lobby-players').replaceChildren(...players.map((p) => playerRow(p, {
      delta: last && p.id in last.points ? last.points[p.id] : undefined
    })));

    // kategorie
    const chosen = state.settings.categories;
    const chips = [];
    if (host) {
      const customs = chosen.filter((c) => !state.presets.includes(c));
      for (const name of state.presets) {
        const on = chosen.includes(name);
        const b = el('button', `chip${on ? ' on' : ''}`, name);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(on));
        b.addEventListener('click', () => {
          const next = on ? chosen.filter((c) => c !== name) : [...chosen, name];
          if (!next.length) return toast('Musi zostać przynajmniej jedna kategoria.');
          pushSettings({ categories: next });
        });
        chips.push(b);
      }
      for (const name of customs) {
        const b = el('button', 'chip on', name);
        b.type = 'button';
        b.title = 'Usuń kategorię';
        b.append(el('span', 'x', '×'));
        b.addEventListener('click', () => {
          const next = chosen.filter((c) => c !== name);
          if (!next.length) return toast('Musi zostać przynajmniej jedna kategoria.');
          pushSettings({ categories: next });
        });
        chips.push(b);
      }
    } else {
      for (const name of chosen) {
        const b = el('button', 'chip on', name);
        b.disabled = true;
        chips.push(b);
      }
    }
    $('cat-chips').replaceChildren(...chips);
    $('form-custom-cat').hidden = !host;

    fillSelect($('set-round'), ROUND_TIMES, state.settings.roundTime, formatDuration);
    fillSelect($('set-grace'), GRACE_TIMES, state.settings.graceTime, (v) => `${v} s`);
    fillSelect($('set-penalty'), PENALTIES, state.settings.penalty, (v) => (v ? `−${v} pkt` : 'bez kary'));
    ['set-round', 'set-grace', 'set-penalty'].forEach((id) => { $(id).disabled = !host; });
    $('settings-card').classList.toggle('readonly', !host);

    $('btn-start').hidden = !host;
    $('btn-end').hidden = !host || state.roundNo === 0;
    $('wait-host').hidden = host;
  }

  $('form-custom-cat').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('custom-cat');
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (!name) return;
    const chosen = state.settings.categories;
    if (chosen.some((c) => c.toLocaleLowerCase('pl') === name.toLocaleLowerCase('pl'))) {
      return toast('Taka kategoria już jest.');
    }
    if (chosen.length >= state.limits.categoriesMax) {
      return toast(`Maksymalnie ${state.limits.categoriesMax} kategorii.`);
    }
    input.value = '';
    pushSettings({ categories: [...chosen, name] });
  });

  $('set-round').addEventListener('change', (e) => pushSettings({ roundTime: Number(e.target.value) }));
  $('set-grace').addEventListener('change', (e) => pushSettings({ graceTime: Number(e.target.value) }));
  $('set-penalty').addEventListener('change', (e) => pushSettings({ penalty: Number(e.target.value) }));

  $('btn-start').addEventListener('click', () => act('round:start'));
  $('btn-end').addEventListener('click', () => act('game:end'));

  $('btn-share').addEventListener('click', async () => {
    const url = `${location.origin}/?pokoj=${state.code}`;
    const text = `Zagraj ze mną w Państwa-Miasta! Kod pokoju: ${state.code}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'Państwa-Miasta', text, url }); return; } catch { /* anulowane */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link do pokoju skopiowany.');
    } catch {
      toast(`Kod pokoju: ${state.code}`);
    }
  });

  document.querySelectorAll('.js-leave').forEach((b) => b.addEventListener('click', async () => {
    await emit('room:leave');
    clearSession();
    renderHome();
  }));

  /* ---------- runda ---------- */

  function buildAnswers(round) {
    const form = $('answers');
    const fromServer = state.me.answers || [];
    myAnswers = round.categories.map((_, i) => fromServer[i] || '');

    form.replaceChildren(...round.categories.map((name, i) => {
      const label = el('label', 'answer');
      const input = el('input');
      input.maxLength = state.limits.answer;
      input.value = myAnswers[i];
      input.autocomplete = 'off';
      input.autocapitalize = 'words';
      input.spellcheck = false;
      input.enterKeyHint = i === round.categories.length - 1 ? 'done' : 'next';
      input.dataset.index = String(i);
      label.append(el('span', '', name), input);
      return label;
    }));
  }

  $('answers').addEventListener('input', (e) => {
    const i = Number(e.target.dataset.index);
    if (Number.isNaN(i)) return;
    myAnswers[i] = e.target.value;
    markInput(e.target);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => socket.emit('answers:update', { answers: myAnswers }), SYNC_DELAY_MS);
  });

  $('answers').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const inputs = [...$('answers').querySelectorAll('input')];
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) next.focus();
    else e.target.blur();
  });

  function markInput(input) {
    const letter = state.round?.letter;
    const v = input.value.trim();
    input.classList.toggle('bad', Boolean(letter && v && !startsWithLetter(v, letter)));
    input.classList.toggle('good', Boolean(letter && v && startsWithLetter(v, letter)));
  }

  function startRolling() {
    if (rollTimer) return;
    const tile = $('letter');
    tile.classList.add('rolling');
    tile.classList.remove('pop');
    const letters = 'ABCDEFGHIJKLŁMNOPRSTUWZ';
    rollTimer = setInterval(() => {
      tile.textContent = letters[Math.floor(Math.random() * letters.length)];
    }, 90);
  }

  function stopRolling() {
    clearInterval(rollTimer);
    rollTimer = null;
    $('letter').classList.remove('rolling');
  }

  function renderPlay() {
    show('play');
    const r = state.round;
    const key = `${state.code}:${r.number}`;
    const participant = state.me.participant;

    if (roundKey !== key) {
      roundKey = key;
      shownLetter = null;
      buildAnswers(r);
      window.scrollTo(0, 0);
    }

    $('play-round').textContent = `Runda ${r.number}`;

    if (!r.letter) {
      startRolling();
    } else if (shownLetter !== r.letter) {
      stopRolling();
      shownLetter = r.letter;
      const tile = $('letter');
      tile.textContent = r.letter;
      tile.classList.add('pop');
      $('answers').querySelectorAll('input').forEach(markInput);
      if (participant && !state.me.stopped) $('answers').querySelector('input')?.focus({ preventScroll: true });
    }

    const locked = !r.letter || state.me.stopped || !participant;
    $('answers').querySelectorAll('input').forEach((i) => { i.disabled = locked; });
    $('answers').classList.toggle('locked', state.me.stopped);
    $('answers').hidden = !participant;
    $('spectator').hidden = participant;

    const stop = $('btn-stop');
    stop.hidden = !participant;
    stop.disabled = locked;
    stop.classList.toggle('done', state.me.stopped);
    stop.textContent = state.me.stopped ? 'Hasła zablokowane — czekamy na resztę' : 'STOP';

    const inRound = state.players.filter((p) => p.inRound);
    const total = r.categories.length;
    $('progress').replaceChildren(...inRound.map((p) => {
      const li = el('li', `progress-item${p.stopped ? ' stopped' : ''}`);
      const name = p.id === state.me.id ? `${p.nick} (ty)` : p.nick;
      li.append(el('span', 'name', name), el('span', 'count', p.stopped ? `STOP · ${p.progress}/${total}` : `${p.progress}/${total}`));
      const bar = el('span', 'bar');
      const fill = el('i');
      fill.style.width = `${(p.progress / total) * 100}%`;
      bar.append(fill);
      li.append(bar);
      return li;
    }));

    tick();
  }

  function tick() {
    if (!state || state.phase !== 'playing' || !state.round) return;
    const r = state.round;
    const now = serverNow();
    const timer = $('timer');
    const banner = $('stop-banner');

    if (now < r.startsAt) {
      timer.textContent = `Start za ${Math.ceil((r.startsAt - now) / 1000)}`;
      timer.classList.remove('urgent');
      $('timebar-fill').style.width = '100%';
      banner.hidden = true;
      return;
    }

    const left = r.deadline - now;
    timer.textContent = formatTime(left);
    timer.classList.toggle('urgent', left <= URGENT_MS);
    $('timebar-fill').style.width = `${Math.max(0, Math.min(1, left / (state.settings.roundTime * 1000))) * 100}%`;

    if (r.firstStop) {
      const who = r.firstStop.id === state.me.id ? 'Nacisnąłeś' : `${r.firstStop.nick} nacisnął`;
      banner.textContent = `${who} STOP! Zostało ${Math.max(0, Math.ceil(left / 1000))} s na dokończenie.`;
      banner.hidden = false;
    } else {
      banner.hidden = true;
    }
  }

  setInterval(tick, 250);

  function missingCount() {
    const letter = state.round.letter;
    return myAnswers.filter((a) => !startsWithLetter(a || '', letter)).length;
  }

  $('btn-stop').addEventListener('click', async () => {
    if (!state || state.phase !== 'playing') return;
    const missing = missingCount();
    const penalty = state.settings.penalty;
    if (missing > 0 && penalty > 0) {
      const dlg = $('dlg-stop');
      $('dlg-stop-text').textContent =
        `Brakuje Ci ${missing} z ${myAnswers.length} haseł (puste albo na złą literę). ` +
        `STOP bez kompletu poprawnych haseł kosztuje −${penalty} pkt.`;
      dlg.returnValue = '';
      dlg.showModal();
      const choice = await new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue), { once: true }));
      if (choice !== 'confirm' || state.phase !== 'playing') return;
    }
    clearTimeout(syncTimer);
    act('round:stop', { answers: myAnswers });
  });

  async function updateWakeLock(want) {
    if (!('wakeLock' in navigator)) return;
    try {
      if (want && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      } else if (!want && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch { /* ekran może zgasnąć — nic się nie stanie */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state) updateWakeLock(state.phase === 'playing');
  });

  /* ---------- głosowanie ---------- */

  const REASONS = { letter: 'zła litera', rejected: 'odrzucone w głosowaniu', empty: '' };

  function renderVote() {
    show('vote');
    const r = state.round;
    const res = state.results;
    const canVote = state.me.participant;

    $('vote-round').textContent = `Runda ${r.number}`;
    $('vote-letter').textContent = r.letter;

    $('vote-cats').replaceChildren(...r.categories.map((cat, ci) => {
      const card = el('section', 'card cat-card');
      card.append(el('h3', '', cat));
      const rows = el('ul', 'rows');

      for (const p of res.participants) {
        const cell = res.cells[p.id][ci];
        const mine = p.id === state.me.id;
        const invalid = cell.status !== 'ok';
        const li = el('li', `row${invalid ? ' invalid' : ''}${mine ? ' mine' : ''}`);

        li.append(el('span', 'who', mine ? `${p.nick} (ty)` : p.nick));
        li.append(cell.text ? el('span', 'text', cell.text) : el('span', 'text empty', 'brak'));
        li.append(el('span', 'pts', invalid ? '0' : `+${cell.points}`));
        if (REASONS[cell.status]) li.append(el('span', 'why', REASONS[cell.status]));

        const votable = cell.status === 'ok' || cell.status === 'rejected';
        if (votable && canVote && !mine) {
          const b = el('button', `vote${cell.myVote ? ' on' : ''}`,
            `${cell.myVote ? 'Nie uznajesz' : 'Nie uznaję'}${cell.votes ? ` · ${cell.votes}` : ''}`);
          b.type = 'button';
          b.setAttribute('aria-pressed', String(cell.myVote));
          b.addEventListener('click', () => act('vote:toggle', { playerId: p.id, categoryIndex: ci }));
          li.append(b);
        } else if (votable && cell.votes) {
          li.append(el('span', 'why', `głosy przeciw: ${cell.votes}`));
        }
        rows.append(li);
      }
      card.append(rows);
      return card;
    }));

    const sorted = [...res.participants].sort((a, b) => res.totals[b.id] - res.totals[a.id]);
    $('vote-totals').replaceChildren(...sorted.map((p, i) => {
      const li = el('li', 'player');
      li.append(el('span', 'place', String(i + 1)));
      li.append(el('span', 'name', p.id === state.me.id ? `${p.nick} (ty)` : p.nick));
      if (res.penalties[p.id]) li.append(el('span', 'tag', `STOP −${res.penalties[p.id]}`));
      else if (res.stoppers.includes(p.id)) li.append(el('span', 'tag', 'STOP'));
      li.append(el('span', 'score', num(res.totals[p.id])));
      return li;
    }));

    $('btn-confirm').hidden = !isHost();
    $('wait-confirm').hidden = isHost();
  }

  $('btn-confirm').addEventListener('click', () => act('round:confirm'));

  /* ---------- koniec ---------- */

  function renderFinal() {
    show('final');
    const sorted = [...state.players].sort((a, b) => b.score - a.score);
    const top = sorted[0]?.score ?? 0;
    const winners = sorted.filter((p) => p.score === top).map((p) => p.nick);
    $('final-winner').textContent = winners.length > 1 ? `Remis: ${winners.join(' i ')}` : `Wygrywa ${winners[0] || '—'}!`;

    let place = 0;
    let prev = null;
    $('final-list').replaceChildren(...sorted.map((p, i) => {
      if (p.score !== prev) { place = i + 1; prev = p.score; }
      return playerRow(p, { place });
    }));

    $('btn-reset').hidden = !isHost();
    $('wait-reset').hidden = isHost();
  }

  $('btn-reset').addEventListener('click', () => act('game:reset'));

  /* ------------------------------------------------------------ start */

  if (!session) renderHome();
})();
