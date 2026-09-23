# Magiczny Quiz — Którą postacią jesteś?

Strona w klimacie Hogwartu: gracz wybiera swoje imię, odpowiada na 5 pytań
i na końcu poznaje przypisaną mu postać.

## Jak uruchomić

Otwórz `index.html` w przeglądarce — nie trzeba niczego instalować.
Albo lokalnie: `python3 -m http.server` i wejdź na `http://localhost:8000`.

## Jak to działa

Wynik **nie zależy od odpowiedzi** — każdy gracz ma na stałe przypisaną postać.
Pytania budują klimat i napięcie przed rozstrzygnięciem.

## Co gdzie zmienić

Wszystko siedzi na górze pliku `app.js`:

- `PLAYERS` — gracze, ich postacie, opisy, cechy i ścieżki do zdjęć,
- `QUESTIONS` — pytania (tytuł, opis sytuacji i odpowiedzi a/b/c).

Zdjęcia wrzucasz do folderu `images/` — szczegóły w `images/README.md`.

## Pliki

- `index.html` — struktura trzech ekranów (wybór gracza → pytania → wynik)
- `styles.css` — motyw, animacje, układ responsywny
- `app.js` — konfiguracja i logika
