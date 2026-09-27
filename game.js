'use strict';

// Czysta logika gry — bez sieci i timerów, żeby dało się ją łatwo testować.

// Litery, które realnie da się grać po polsku (bez Q, V, X, Y i rzadkich
// liter z ogonkami, na które prawie nie ma słów na początku).
const LETTERS = 'A B C D E F G H I J K L Ł M N O P R S T U W Z'.split(' ');

const PRESET_CATEGORIES = [
  'Państwo', 'Miasto', 'Rzeka', 'Imię', 'Zwierzę', 'Roślina', 'Rzecz', 'Zawód',
  'Kolor', 'Jedzenie', 'Marka', 'Film lub serial', 'Sport', 'Postać fikcyjna',
  'Część ciała', 'Instrument', 'Sławna osoba', 'Piłkarz'
];

const DEFAULT_CATEGORIES = PRESET_CATEGORIES.slice(0, 8);

const LIMITS = {
  nick: 20,
  answer: 40,
  category: 30,
  categoriesMax: 16,
  playersMax: 16,
  roundTime: { min: 30, max: 600, def: 120 },
  graceTime: { min: 3, max: 60, def: 10 },
  penalty: { min: 0, max: 50, def: 10 }
};

const POINTS = { alone: 15, unique: 10, shared: 5 };

function cleanText(value, maxLen) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function clampInt(value, { min, max, def }) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// Do porównywania duplikatów: bez wielkości liter i polskich znaków,
// żeby "Łódź" i "lodz" liczyły się jako to samo hasło.
function normalize(text) {
  return cleanText(text, 200)
    .toLocaleLowerCase('pl')
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Pierwsza litera musi się zgadzać dokładnie — Ł to nie L.
function startsWithLetter(text, letter) {
  const t = cleanText(text, 200);
  return t.length > 0 && t.charAt(0).toLocaleUpperCase('pl') === letter;
}

function pickLetter(used, random = Math.random) {
  let pool = LETTERS.filter((l) => !used.includes(l));
  if (pool.length === 0) pool = LETTERS.slice();
  return pool[Math.floor(random() * pool.length)];
}

function voteKey(playerId, categoryIndex) {
  return `${playerId}:${categoryIndex}`;
}

// Hasło odpada, gdy przeciw jest ponad połowa pozostałych graczy rundy.
function isRejected(votes, voters) {
  const others = voters - 1;
  return others > 0 && votes * 2 > others;
}

/**
 * Liczy punkty rundy.
 * @param {object} p
 * @param {string[]} p.categories
 * @param {string} p.letter
 * @param {string[]} p.participants  id graczy biorących udział w rundzie
 * @param {Object<string,string[]>} p.answers
 * @param {Map<string,Set<string>>} p.votes  klucz voteKey → id głosujących
 * @param {number} p.voters  ilu graczy może głosować (połączeni uczestnicy)
 * @param {string[]} p.stoppers  kto nacisnął STOP
 * @param {number} p.penalty
 */
function scoreRound({ categories, letter, participants, answers, votes, voters, stoppers, penalty }) {
  const cells = {};
  const totals = {};
  const penalties = {};

  for (const pid of participants) {
    cells[pid] = categories.map((_, ci) => {
      const text = cleanText(answers[pid]?.[ci], LIMITS.answer);
      const voteCount = votes.get(voteKey(pid, ci))?.size || 0;
      let status = 'ok';
      if (!text) status = 'empty';
      else if (!startsWithLetter(text, letter)) status = 'letter';
      else if (isRejected(voteCount, voters)) status = 'rejected';
      return { text, status, votes: voteCount, points: 0 };
    });
  }

  categories.forEach((_, ci) => {
    const valid = participants.filter((pid) => cells[pid][ci].status === 'ok');
    const counts = new Map();
    for (const pid of valid) {
      const key = normalize(cells[pid][ci].text);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    for (const pid of valid) {
      const cell = cells[pid][ci];
      if (valid.length === 1) cell.points = POINTS.alone;
      else if (counts.get(normalize(cell.text)) === 1) cell.points = POINTS.unique;
      else cell.points = POINTS.shared;
    }
  });

  for (const pid of participants) {
    let sum = cells[pid].reduce((acc, c) => acc + c.points, 0);
    // STOP bez kompletu uznanych haseł kosztuje karę.
    const complete = cells[pid].every((c) => c.status === 'ok');
    if (stoppers.includes(pid) && !complete) {
      penalties[pid] = penalty;
      sum -= penalty;
    }
    totals[pid] = sum;
  }

  return { cells, totals, penalties };
}

module.exports = {
  LETTERS,
  PRESET_CATEGORIES,
  DEFAULT_CATEGORIES,
  LIMITS,
  POINTS,
  cleanText,
  clampInt,
  normalize,
  startsWithLetter,
  pickLetter,
  voteKey,
  isRejected,
  scoreRound
};
