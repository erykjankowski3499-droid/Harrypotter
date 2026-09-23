/* =========================================================================
   KONFIGURACJA — tu zmieniasz wszystko bez ruszania reszty kodu
   ========================================================================= */

/* Gracze i przypisane im na stałe postacie.
   Wynik NIE zależy od odpowiedzi — każdy gracz zawsze dostaje swoją postać.
   `image` to plik w folderze images/ (dodaj zdjęcia pod tymi nazwami).
   `focus` (opcjonalne) decyduje, która część zdjęcia zostaje przy kadrowaniu
   do ramki 3:4 — np. 'center top', 'center', '30% 20%'. Domyślnie środek. */
const PLAYERS = [
  {
    id: 'margo',
    name: 'Margo',
    character: 'Hermiona Granger',
    image: 'images/margo.jpg',
    description: 'Najbystrzejsza czarownica swojego pokolenia. Odpowiedź znajdujesz szybciej, niż inni zdążą zadać pytanie — a odwagi masz tyle samo co wiedzy.',
    traits: ['Gryffindor', 'Błyskotliwość', 'Lojalność']
  },
  {
    id: 'piotrek',
    name: 'Piotrek',
    character: 'Bowtruckle',
    image: 'images/piotrek.webp',
    focus: 'center top',
    description: 'Maleńki strażnik drzew różdżkowych. Wyglądasz niepozornie i wolisz trzymać się z boku, ale kto raz zdobędzie Twoje zaufanie, nie znajdzie wierniejszego towarzysza — ani nikogo, kto broniłby swoich równie zaciekle.',
    traits: ['Strażnik drzew', 'Czujność', 'Mała wielka odwaga']
  },
  {
    id: 'antek',
    name: 'Antek',
    character: 'Ron Weasley',
    image: 'images/antek.jpg',
    description: 'Przyjaciel, na którym można polegać. Rozbrajasz każdą sytuację żartem, a gdy robi się naprawdę groźnie — stajesz obok bez chwili wahania.',
    traits: ['Gryffindor', 'Humor', 'Wierność']
  },
  {
    id: 'george',
    name: 'George',
    character: 'Profesor Pomona Sprout',
    image: 'images/george.png',
    focus: 'left center',
    description: 'Opiekunka Hufflepuffu i mistrzyni zielarstwa. Nie boisz się ubrudzić rąk, a z każdej trudnej sytuacji wyciągasz coś, co da się wyhodować — nawet jeśli po drodze trzeba nakrzyczeć na mandragorę.',
    traits: ['Hufflepuff', 'Cierpliwość', 'Praktyczność']
  },
  {
    id: 'doma',
    name: 'Doma',
    character: 'Luna Lovegood',
    image: 'images/doma.jpg',
    description: 'Widzisz to, czego inni nie dostrzegają. Idziesz własną drogą, spokojna i nieustraszona, i nigdy nie udajesz kogoś, kim nie jesteś.',
    traits: ['Ravenclaw', 'Wyobraźnia', 'Szczerość']
  },
  {
    id: 'eryk',
    name: 'Eryk',
    character: 'Draco Malfoy',
    image: 'images/eryk.jpg',
    description: 'Duma Slytherinu. Wchodzisz do sali tak, jakby należała do Ciebie, a jeden uniesiony kącik ust mówi więcej niż cudze przemowy. Pod tą pewnością siebie kryje się jednak więcej, niż pokazujesz.',
    traits: ['Slytherin', 'Duma', 'Spryt']
  }
];

/* Pytania. Odpowiedzi nie wpływają na wynik — służą budowaniu klimatu.
   Pytania 1–3 są propozycją: podmień treść, gdy będziesz miał swoje. */
const QUESTIONS = [
  {
    title: 'Znajdujesz cudzą różdżkę w Wielkiej Sali',
    desc: 'Leży pod ławką, nikogo nie ma w pobliżu, a za chwilę zaczyna się uczta.',
    answers: [
      'Oddaję ją natychmiast opiekunowi domu',
      'Sam szukam właściciela, pytając uczniów przy stołach',
      'Zatrzymuję ją na chwilę, żeby sprawdzić, jak działa'
    ]
  },
  {
    title: 'Kolega prosi Cię o ściągę na egzaminie z eliksirów',
    desc: 'Uczył się całą noc, ale i tak nic nie pamięta. Profesor patrzy w drugą stronę.',
    answers: [
      'Odmawiam, ale proponuję wspólną naukę przed poprawką',
      'Pomagam dyskretnie — przyjaźń jest ważniejsza niż ocena',
      'Udaję, że nie słyszę, i skupiam się na swoim kotle'
    ]
  },
  {
    title: 'Nocą z Zakazanego Lasu dobiega wołanie o pomoc',
    desc: 'Cała wieża śpi. Wyjście po ciszy nocnej oznacza karę, a las nie jest bezpieczny.',
    answers: [
      'Idę sam, od razu — ktoś może być w niebezpieczeństwie',
      'Biegnę po nauczyciela, choćbym miał się przyznać do wszystkiego',
      'Budzę przyjaciół i ruszamy razem'
    ]
  },
  {
    title: 'Widzisz, jak starszy uczeń znęca się nad młodszym',
    desc: 'Idziesz korytarzem i widzisz przemoc słowną wobec pierwszoklasisty.',
    answers: [
      'Interweniuję natychmiast, a potem zgłaszam to opiekunowi domu',
      'Zgłaszam sytuację nauczycielowi, nie wchodząc w konfrontację',
      'Odchodzę, zakładając, że to nie moja sprawa'
    ]
  },
  {
    title: 'Masz szansę użyć Zwrotnika Czasu, by poprawić swój błąd',
    desc: 'Popełniłeś pomyłkę, która zaszkodziła koledze, i masz dostęp do magii cofającej czas.',
    answers: [
      'Używam Zwrotnika, żeby naprawić sytuację, mimo ryzyka',
      'Szukam innego sposobu naprawienia szkody bez ingerencji w czas',
      'Proszę o pomoc doświadczonego czarodzieja, zanim podejmę decyzję'
    ]
  }
];

/* =========================================================================
   LOGIKA
   ========================================================================= */

const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const $ = (id) => document.getElementById(id);

const screens = {
  players: $('screen-players'),
  quiz: $('screen-quiz'),
  result: $('screen-result')
};

let currentPlayer = null;
let step = 0;

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove('is-active'));
  screens[name].classList.add('is-active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* --- ekran wyboru gracza --- */
function renderPlayers() {
  const list = $('player-list');
  list.innerHTML = '';

  PLAYERS.forEach((player) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'player-btn';
    btn.innerHTML =
      `<span class="sigil" aria-hidden="true">${player.name.charAt(0)}</span>` +
      `<span class="player-name">${player.name}</span>`;
    btn.addEventListener('click', () => startQuiz(player));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

/* --- quiz --- */
function startQuiz(player) {
  currentPlayer = player;
  step = 0;
  $('who-name').textContent = player.name;
  renderQuestion();
  showScreen('quiz');
}

function renderQuestion() {
  const q = QUESTIONS[step];

  $('counter').textContent = `Pytanie ${step + 1} z ${QUESTIONS.length}`;
  $('progress-bar').style.width = `${((step + 1) / QUESTIONS.length) * 100}%`;
  $('progress').setAttribute('aria-valuenow', String(step + 1));
  $('progress').setAttribute('aria-valuemax', String(QUESTIONS.length));
  $('q-title').textContent = q.title;
  $('q-desc').textContent = q.desc;

  const list = $('answers');
  list.innerHTML = '';

  q.answers.forEach((text, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'answer-btn';
    btn.innerHTML =
      `<span class="letter" aria-hidden="true">${LETTERS[i]}</span>` +
      `<span>${text}</span>`;
    btn.addEventListener('click', () => pickAnswer(btn));
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function pickAnswer(btn) {
  // blokujemy podwójne kliknięcia w trakcie animacji przejścia
  const buttons = document.querySelectorAll('.answer-btn');
  buttons.forEach((b) => (b.disabled = true));
  btn.classList.add('is-picked');

  setTimeout(() => {
    if (step < QUESTIONS.length - 1) {
      step += 1;
      renderQuestion();
    } else {
      showResult();
    }
  }, 320);
}

function goBack() {
  if (step === 0) {
    showScreen('players');
  } else {
    step -= 1;
    renderQuestion();
  }
}

/* --- wynik --- */
function showResult() {
  const p = currentPlayer;

  $('result-player').textContent = p.name;
  $('result-name').textContent = p.character;
  $('result-desc').textContent = p.description;
  $('result-initial').textContent = p.character.charAt(0);

  const traits = $('result-traits');
  traits.innerHTML = '';
  (p.traits || []).forEach((t) => {
    const li = document.createElement('li');
    li.textContent = t;
    traits.appendChild(li);
  });

  loadPortrait(p);
  showScreen('result');
}

/* Zdjęcia dodasz później — dopóki pliku nie ma, pokazujemy inicjał w ramce.
   Próbujemy po kolei kilku rozszerzeń, żeby nie było znaczenia, czy wrzucisz
   .jpg, .png czy .webp. */
function loadPortrait(player) {
  const img = $('result-img');
  const placeholder = $('result-placeholder');

  img.classList.remove('is-loaded');
  placeholder.classList.remove('is-hidden');
  img.alt = player.character;
  img.style.objectPosition = player.focus || 'center';

  const declared = player.image || `images/${player.id}.jpg`;
  const base = declared.replace(/\.[^./]+$/, '');
  const preferred = declared.slice(base.length).toLowerCase();
  const extensions = ['.jpg', '.jpeg', '.png', '.webp'];
  const order = [preferred, ...extensions.filter((ext) => ext !== preferred)];
  const candidates = order.filter(Boolean).map((ext) => base + ext);
  let i = 0;

  img.onload = () => {
    img.classList.add('is-loaded');
    placeholder.classList.add('is-hidden');
  };
  img.onerror = () => {
    i += 1;
    if (i < candidates.length) {
      img.src = candidates[i];
    } else {
      img.removeAttribute('src');
      img.classList.remove('is-loaded');
      placeholder.classList.remove('is-hidden');
    }
  };

  img.src = candidates[0];
}

function restart() {
  currentPlayer = null;
  step = 0;
  showScreen('players');
}

/* --- start --- */
renderPlayers();
$('btn-back').addEventListener('click', goBack);
$('btn-again').addEventListener('click', restart);
