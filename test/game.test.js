'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game');

const base = {
  categories: ['Państwo', 'Miasto'],
  letter: 'P',
  participants: ['a', 'b', 'c'],
  votes: new Map(),
  voters: 3,
  stoppers: [],
  penalty: 10
};

test('unikalne 10, wspólne 5, jedyne w kategorii 15', () => {
  const { cells, totals } = G.scoreRound({
    ...base,
    answers: {
      a: ['Polska', 'Poznań'],
      b: ['polska', ''],
      c: ['Peru', '']
    }
  });
  assert.equal(cells.a[0].points, 5);
  assert.equal(cells.b[0].points, 5);
  assert.equal(cells.c[0].points, 10);
  assert.equal(cells.a[1].points, 15);
  assert.deepEqual(totals, { a: 20, b: 5, c: 10 });
});

test('duplikaty porównywane bez polskich znaków i wielkości liter', () => {
  const { cells } = G.scoreRound({
    ...base, letter: 'Ł', participants: ['a', 'b'], voters: 2,
    answers: { a: ['Łotwa', 'Łódź'], b: ['ŁOTWA', 'łodz'] }
  });
  assert.equal(cells.a[0].points, 5);
  assert.equal(cells.a[1].points, 5);
});

test('zła litera daje 0 i nie psuje unikalności innym', () => {
  const { cells } = G.scoreRound({
    ...base, participants: ['a', 'b'], voters: 2,
    answers: { a: ['Niemcy', ''], b: ['Polska', ''] }
  });
  assert.equal(cells.a[0].status, 'letter');
  assert.equal(cells.b[0].points, 15);
});

test('Ł to nie L', () => {
  assert.equal(G.startsWithLetter('Łódź', 'L'), false);
  assert.equal(G.startsWithLetter('łódź', 'Ł'), true);
});

test('hasło odpada przy ponad połowie głosów pozostałych graczy', () => {
  const votes = new Map([[G.voteKey('a', 0), new Set(['b'])]]);
  let r = G.scoreRound({ ...base, votes, answers: { a: ['Polska', ''], b: ['', ''], c: ['', ''] } });
  assert.equal(r.cells.a[0].status, 'ok', '1 z 2 pozostałych to jeszcze nie większość');

  votes.get(G.voteKey('a', 0)).add('c');
  r = G.scoreRound({ ...base, votes, answers: { a: ['Polska', ''], b: ['', ''], c: ['', ''] } });
  assert.equal(r.cells.a[0].status, 'rejected');
  assert.equal(r.totals.a, 0);
});

test('odrzucone hasło zwalnia unikalność dla innych', () => {
  const votes = new Map([[G.voteKey('a', 0), new Set(['b', 'c'])]]);
  const r = G.scoreRound({ ...base, votes, answers: { a: ['Polska', ''], b: ['Polska', ''], c: ['', ''] } });
  assert.equal(r.cells.b[0].points, 15);
});

test('STOP bez kompletu = kara, z kompletem = bez kary', () => {
  const r = G.scoreRound({
    ...base, stoppers: ['a', 'b'],
    answers: { a: ['Polska', ''], b: ['Peru', 'Paryż'], c: ['', ''] }
  });
  assert.equal(r.penalties.a, 10);
  assert.equal(r.totals.a, 10 - 10);
  assert.equal(r.penalties.b, undefined);
});

test('kara także gdy hasło stopującego odrzucono w głosowaniu', () => {
  const votes = new Map([[G.voteKey('a', 1), new Set(['b', 'c'])]]);
  const r = G.scoreRound({
    ...base, stoppers: ['a'], votes,
    answers: { a: ['Polska', 'Pies'], b: ['', ''], c: ['', ''] }
  });
  assert.equal(r.penalties.a, 10);
});

test('losowanie nie powtarza liter, dopóki pula się nie wyczerpie', () => {
  const used = G.LETTERS.slice(0, -1);
  assert.equal(G.pickLetter(used), G.LETTERS[G.LETTERS.length - 1]);
  assert.ok(G.LETTERS.includes(G.pickLetter(G.LETTERS.slice())));
});
