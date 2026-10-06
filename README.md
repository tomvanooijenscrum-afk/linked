# Linked — eerste prototype

Deze fase richt zich op vier user stories: openen, hulp aanvragen,
status bekijken en annuleren. Het conceptdocument van 30 september 2026
beschrijft de richting voor later, niet de scope van dit prototype.

Het product is Engelstalig. Codecommentaren en teamdocumentatie blijven
Nederlandstalig; de onderstaande knop- en statusnamen volgen de Engelse UI.

## Starten

Open `index.html` in een browser. Er is geen installatie, build of server
nodig. De app werkt lokaal, ook zonder internet. Voor testen op een telefoon
kun je de bestanden lokaal openen of via jullie eigen lokale webserver
beschikbaar maken.

## De flow testen

1. Open de pagina: **Ask for help** is direct beschikbaar.
2. Klik: **Request sent (demo)** verschijnt en annuleren wordt beschikbaar.
3. Wacht ongeveer 1,5 seconde: **Receipt simulated (demo)** verschijnt.
4. Klik op **Cancel request**: de annulering wordt bevestigd.
5. Klik op **Ask for help again**: een nieuw verzoek begint.
6. Herhaal, maar annuleer vóór de ontvangstsimulatie. Wacht daarna:
   de status blijft geannuleerd.
7. Klik snel meerdere keren: er ontstaat maximaal één actief verzoek.
8. Test met Tab en Enter en op een smal scherm (bijvoorbeeld 320–390 px).

Verzending en ontvangst worden alleen in dezelfde pagina gesimuleerd.
Er is geen backend, echte ontvanger of hulp onderweg. Annulering stopt
het lokale verzoek en de wachtende ontvangstsimulatie. Deze demo verwerkt
geen locatie of persoonsgegevens en bewaart geen verzoeken. Vernieuwen
of sluiten eindigt de lokale demo; andere tabbladen zijn aparte sessies.

## Geautomatiseerde controle

Met Node.js geïnstalleerd:

```powershell
node app.test.cjs
node --check app.js
```

De test gebruikt de echte appcode met een gesimuleerde DOM en timers.
Hij controleert de complete flow, dubbele klikken, annuleren vóór en na
ontvangst, opnieuw starten en callbacks van oude verzoeken. Dit vervangt
geen gebruikerstest op een echte telefoon.

## Code lezen

- `index.html`: één gebruikersscherm met vaste knoppen en statusvelden.
- `styles.css`: de bestaande groene stijl, kaarten en mobiele indeling.
- `app.js`: vier statussen, twee acties en één ontvangsttimer.
- `app.test.cjs`: reproduceerbare controles zonder extra dependencies.

De code bevat Nederlandse uitleg en korte, verticaal opgemaakte regels.
`render()` past tekst en zichtbaarheid aan; eventhandlers veranderen de
status. De ontvangsttimer is de enige asynchrone stap.

## Bewaarde uitgebreide versie

De bestaande versie, inclusief alle toen niet-gecommitte bestanden,
is bewaard op `archive/linked-expanded-prototype`, commit `57a6b83`.
Deze vereenvoudiging staat op `feature/linked-phase-one-flow`.
Er is geen Git-geschiedenis herschreven en niets gepusht.

De analyse, scopekeuzes, rol van Codex en voorgestelde acht weken
vervolgwerk staan in [PROJECTKEUZES.md](PROJECTKEUZES.md).
