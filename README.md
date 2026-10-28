# Linked - eerste prototype

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
geen locatie of persoonsgegevens. Het demoverzoek en de beschikbaarheid
worden lokaal in de browser opgeslagen. Vernieuwen behoudt deze gegevens;
andere tabbladen kunnen wijzigingen volgen.

## Kaart en geluid (branch `feature/map-and-sound`)

- Een illustratieve kaart toont de status: rustig, pulserend signaal
  bij **sent** en oplichtende helpers bij **received**. Het is een
  inline SVG: geen echte locatie, geen kaarttegels van internet.
- Knoppen en statuswissels spelen korte tonen via de Web Audio API.
  Er zijn geen audiobestanden. **Sound on/off** in de header zet het
  geluid uit; die keuze wordt niet opgeslagen.
- Met "minder beweging" in het besturingssysteem staat de kaart stil.

## Beschikbaarheid vrijwilliger (user story 8)

Op `volunteer.html` staat boven de inbox de schakelaar **Your availability**.
De status wordt opgeslagen onder `linked.volunteer-availability.v1` en is
standaard **Available**. De keuze blijft na vernieuwen bewaard.

Bij **Available** verschijnen nieuwe hulpverzoeken in de inbox en kan de
vrijwilliger een verzoek openen en accepteren. Bij **Unavailable** worden
nieuwe verzoeken verborgen en kan een verzoek niet worden geaccepteerd.
Een wachtend verzoek blijft wel opgeslagen en verschijnt opnieuw wanneer de
vrijwilliger weer **Available** kiest. Een al geaccepteerd verzoek blijft
zichtbaar, ook als de vrijwilliger daarna **Unavailable** kiest.

De status is zowel met tekst als vorm en kleur herkenbaar: **Available** heeft
een cirkel, **Unavailable** een vierkant. De schakelaar is met het toetsenbord
te bedienen.

### Testresultaten

| # | Controle | Criterium | Automatisch | Handmatig |
|---|---|---|---|---|
| 1 | Status zichtbaar en standaard Available | 1, 5, 6 | Geslaagd | In te vullen |
| 2 | Schakelaar werkt in beide richtingen | 2 | Geslaagd | In te vullen |
| 3 | Beschikbaar: verzoek verschijnt | 3 | Geslaagd | In te vullen |
| 4 | Onbeschikbaar: verzoek verborgen en accepteren geblokkeerd | 4 | Geslaagd | In te vullen |
| 5 | Status blijft na vernieuwen behouden | 5 | Geslaagd | In te vullen |
| 6 | Terug naar Available toont het bewaarde verzoek | 3 | Geslaagd | In te vullen |
| 7 | Tweede tabblad volgt de status | 5 | Geslaagd | In te vullen |
| 8 | Ongeldige waarde valt terug op Available | 1 | Geslaagd | In te vullen |
| 9 | Toetsenbord (Tab, Spatie/Enter) en scherm van 320 px | 2, 6 | Geslaagd | In te vullen |

## Geautomatiseerde controle

Met Node.js geïnstalleerd:

```powershell
node app.test.cjs
node volunteer.test.cjs
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

<!-- Rayan feature branch initialized -->
