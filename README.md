# Państwa-Miasta online

Klasyczne Państwa-Miasta dla wielu graczy na żywo — w przeglądarce, także na
telefonie. Serwer Node.js + Socket.IO trzyma stan gry, więc wszyscy widzą
postęp, STOP i głosowanie w czasie rzeczywistym.

## Jak się gra

1. Ktoś wpisuje nick i **tworzy pokój** — dostaje 4-literowy kod i link
   „Zaproś”. Pozostali dołączają kodem albo z linku.
2. Host ustawia w poczekalni:
   - **kategorie** — gotowe do zaznaczenia + **własne** (do 16),
   - **czas rundy** (30 s – 10 min),
   - **czas po STOP** — ile zostaje pozostałym, gdy ktoś naciśnie STOP,
   - **karę za STOP** bez kompletu haseł.
3. Serwer **losuje literę** (bez powtórek, dopóki nie skończy się pula).
4. Gracze wpisują hasła; wszyscy widzą, ile kto ma już wypełnionych pól.
5. Kto naciśnie **STOP**, blokuje swoje hasła, a reszcie zostaje ustawiony
   „czas po STOP”. Jeśli STOP-ujący nie ma kompletu poprawnych haseł, dostaje
   **minusowe punkty** (gra ostrzega przed takim STOP-em).
6. Po rundzie jest **głosowanie**: przy każdym cudzym haśle można kliknąć
   „Nie uznaję”. Hasło odpada, gdy nie uzna go ponad połowa pozostałych graczy.
   Punkty przeliczają się na żywo; host zatwierdza wyniki.
7. Kolejne rundy do woli, potem „Zakończ grę” i ranking.

### Punktacja

| Sytuacja                                   | Punkty |
|--------------------------------------------|--------|
| Jedyne hasło w kategorii                   | 15     |
| Hasło unikalne (inni wpisali coś innego)   | 10     |
| To samo hasło co ktoś inny                 | 5      |
| Puste, na złą literę, odrzucone głosami    | 0      |
| STOP bez kompletu uznanych haseł           | −kara  |

Porównanie duplikatów ignoruje wielkość liter i polskie znaki
(„Łódź” = „lodz”), ale pierwsza litera musi się zgadzać dokładnie — Ł to nie L.

## Uruchomienie lokalnie

```bash
npm install
npm start          # http://localhost:3000
npm test           # testy logiki i serwera
```

## Wdrożenie na Railway

Projekt jest przygotowany tak samo jak bot Slackowy z
`bot-eryk-nowy-lot`: zwykła aplikacja Node z `npm start`, którą Railway
buduje prosto z GitHuba. Dodatkowo `railway.json` ustawia komendę startu i
healthcheck `/health`.

1. [railway.com](https://railway.com) → **New Project** → **Deploy from GitHub repo**
   → wybierz to repozytorium (i gałąź z grą).
2. Railway sam wykryje Node i uruchomi `npm start`. Port bierze ze zmiennej
   `PORT`, którą ustawia automatycznie — nic nie trzeba konfigurować.
3. W usłudze: **Settings → Networking → Generate Domain**. Ten adres
   wysyłasz znajomym.

Uwagi:
- Stan gry jest w pamięci serwera — restart/redeploy kasuje trwające pokoje.
  Nie odpalaj więcej niż jednej repliki (pokoje nie są współdzielone).
- Gracz, któremu zgaśnie ekran albo odświeży stronę, wraca do swojego pokoju
  z tymi samymi punktami i wpisanymi hasłami.
- Pusty pokój znika po 30 minutach.

## Pliki

- `server.js` — serwer HTTP + Socket.IO, pokoje, przebieg rundy, timery
- `game.js` — czysta logika: litery, walidacja, punktacja, głosowanie
- `public/` — front (`index.html`, `styles.css`, `app.js`)
- `test/` — testy (`node --test`)
- `railway.json` — konfiguracja wdrożenia
