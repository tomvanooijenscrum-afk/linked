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

## NFC-polsbanden (user story 7)

Een beheerder registreert en programmeert NTAG213-polsbanden op
`wristbands.html`. Een telefoon die een **actief** bandje aantikt, opent
de bestaande hulppagina (`index.html`); de hulpaanvraag zelf gaat via de
bestaande flow.

```
wristbands.html --Web Serial (USB)--> Arduino Uno --SPI--> PN532 --> NTAG213
       |
       +--fetch--> server/app.py (Flask) --> SQLite (server/instance/)

telefoon tikt --> https://<linked>/?t=<token> --> index.html
                  --> GET /api/wristbands/resolve --> "Wristband recognised"
```

### Wat er is gebouwd

| Onderdeel | Bestand(en) |
|---|---|
| Firmware v2 (Uno R3 + PN532 SPI + NTAG213) | `nfc/firmware/linked_nfc/` |
| Serieel protocol | `nfc/PROTOCOL.md` |
| Web Serial-service | `nfc-serial.js` |
| Beheerpagina NFC Wristbands | `wristbands.html`, `wristbands.js`, `wristbands.css` |
| Backend, rollen en API | `server/app.py`, `server/wristbands.py` |
| Database en migratie | `server/db.py`, `server/migrations/001_wristbands.sql` |
| Beheerdersaccounts | `server/manage.py` |
| Aantikken → bestaande hulppagina | `wristband-tap.js`, `wristband-api.js`, `index.html` |

Het vroegere `wristband-store.js` (localStorage) is vervangen door de
backend: deactiveren blokkeert nu echt de link op een telefoon.

### Waarom een backend (en welke)

Linked had geen backend, database of inlog. Registratie, unieke tokens,
beheerdersrechten en controle bij het aantikken kunnen niet veilig in de
browser. Er is gekozen voor wat het project al gebruikte: **Python + Flask**
(net als `nfc/bridge`) met **SQLite** uit de standaardbibliotheek. Flask
serveert ook de bestaande pagina's, zodat API en pagina's één origin delen
(geen CORS nodig, cookies blijven `SameSite=Strict`).

### Hardware

| PN532 | Arduino Uno R3 |
|---|---|
| SCK | D13 |
| MI | D12 |
| MO/SDA/TX | D11 |
| NSS/SCL/RX | D10 |
| GND | GND |
| 5V | 5V |

Zet de schakelaars op **SET0: L** en **SET1: H** (SPI). Koppel USB los
voordat je bedrading wijzigt. MIFARE Classic-kaarten werken niet.

### Firmware uploaden

1. Installeer in Arduino IDE de bibliotheek **Adafruit PN532**.
2. Open `nfc/firmware/linked_nfc/linked_nfc.ino` en upload naar de Uno.
3. Controle in Serial Monitor (115200 baud, regeleinde **Newline**):
   `VERSION` → `CMD:VERSION`, `SUCCESS:VERSION:LINKED_NFC:2`;
   `INFO` met een tag → UID, type, inhoud en `SUCCESS:INFO`.
4. Sluit Serial Monitor daarna: de poort kan maar door één programma
   tegelijk worden gebruikt (ook niet tegelijk met `bridge.py`).

Wat v2 toevoegt ten opzichte van v1: het volledige 144-byte geheugen
(links tot 136 tekens na `https://`), `INFO` om elke tag te herkennen en
uit te lezen (ook links die met een telefoon geschreven zijn), schrijven
alleen naar de tag met de verwachte UID, herkenning van vergrendelde tags,
een veilige `REPLACE`-modus, en een `CMD:`-echo zodat de webapp antwoorden
nooit aan de verkeerde opdracht koppelt. Oude opdrachten (`SCAN`, `READ`,
`WRITE:<url>`) werken nog, dus `bridge.py` blijft werken.

### Server starten

```bash
cd linked
python3 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements.txt

# Eén keer: beheerder aanmaken (vraagt een wachtwoord van min. 12 tekens).
server/.venv/bin/python -m server.manage create-user <naam>

# Starten. LINKED_PUBLIC_BASE_URL is het HTTPS-adres waarop telefoons
# Linked openen; dat komt op de bandjes te staan.
LINKED_PUBLIC_BASE_URL=https://jouw-linked-adres.nl \
  server/.venv/bin/python -m server.app
```

Open daarna **http://localhost:8000/wristbands.html** in Chrome of Edge.
Web Serial werkt alleen in Chromium-browsers op een computer en alleen op
`localhost` of HTTPS.

| Variabele | Betekenis | Standaard |
|---|---|---|
| `LINKED_PUBLIC_BASE_URL` | HTTPS-adres op de bandjes | – (verplicht om te registreren) |
| `LINKED_SECRET_KEY` | Sleutel voor sessiecookies | willekeurig, in `server/instance/` |
| `LINKED_DATABASE` | Pad naar SQLite-bestand | `server/instance/linked.sqlite3` |
| `LINKED_SECURE_COOKIES` | `1` achter HTTPS | uit |
| `LINKED_HOST` / `LINKED_PORT` | Luisteradres | `127.0.0.1` / `8000` |

Overige opdrachten: `python -m server.manage migrate`, `list-users`,
`set-role <naam> admin|volunteer`. Er is bewust geen registratiepagina.

### Een polsbandje registreren

1. Log in als beheerder op **NFC Wristbands**.
2. **Connect reader** en kies de Arduino in het browservenster.
3. Kies eventueel een evenement en daarna **Register new wristband**.
4. Leg een leeg NTAG213-bandje op de lezer. De pagina toont zes stappen:
   UID lezen → controle op bestaande registratie → link reserveren →
   link schrijven → link teruglezen → bevestigen bij de server.
5. Kies **Activate wristband**. Pas dan opent een tik de hulppagina als
   herkend bandje.

**Scan and identify tag** leest elke tag uit (UID, type, inhoud) en
toont of en als welk bandje (`WB-0001`) hij geregistreerd is.

### Fouten en opnieuw proberen

- **Al geregistreerd:** de server weigert (`DUPLICATE_TAG`) en de pagina
  toont het bestaande nummer; er wordt niets geschreven.
- **Tag bevat al andere gegevens:** er wordt niets overschreven tot de
  beheerder **Overwrite this tag** kiest. Vergrendelde tags worden geweigerd.
- **Schrijven of teruglezen mislukt / lezer losgekoppeld:** de poging wordt
  op de server als `failed` vastgelegd. **Try again** maakt voor dezelfde
  tag een nieuw token (het oude wordt ongeldig) en mag de eigen, half
  geschreven tag overschrijven. Er ontstaat nooit een tweede record.
- **Server niet bereikbaar bij bevestigen:** de tag is goed; **Try again**
  herhaalt alleen de bevestiging (idempotent).
- Onafgemaakte registraties kunnen in de lijst met **Discard** weg.

### Aantikken door een deelnemer

De link op het bandje is `<LINKED_PUBLIC_BASE_URL>/?t=<token>`. De
hulppagina haalt het token meteen uit de adresbalk, vraagt
`/api/wristbands/resolve` en toont **Wristband recognised**, **no longer
active** of **not recognised**. De hulpknop werkt in alle gevallen, ook als
de server onbereikbaar is: een bandje mag hulp nooit blokkeren. De aanvraag
start pas na een druk op de knop, niet automatisch bij het aantikken.

### Beveiliging

- Beheer-API alleen voor rol `admin`, bij elke aanvraag opnieuw uit de
  database gecontroleerd (`401` niet ingelogd, `403` geen beheerder).
- Wachtwoorden met PBKDF2-SHA256 (600.000 rondes); 5 mislukte pogingen
  per 15 minuten per IP-adres.
- Sessiecookie `HttpOnly`, `SameSite=Strict`; wijzigingen vereisen de header
  `X-Linked-Request: 1` en een gelijke `Origin` (CSRF).
- Token: 128 bits uit `secrets`, alleen de SHA-256-hash wordt bewaard.
  Unieke constraints op UID, tokenhash en nummer; een bandje kan alleen
  actief zijn als het gecontroleerd is (`CHECK`).
- Geen persoonsgegevens op de tag of bij het bandje. **UID en token zijn
  geen inloggegevens:** een UID is te kopiëren en de link is voor iedereen
  leesbaar. Ze bepalen alleen of de hulppagina het bandje herkent.
- `Referrer-Policy: no-referrer`, zodat het token niet uitlekt.
- De server serveert alleen de bestanden van de webapp, nooit `server/`,
  `nfc/` of `.git`.

### Polsbandje aantikken → verzoeken op de kaart (demo met `bridge.py`)

Deze demo van de vrijwilligerspagina is ongewijzigd en gebruikt nog
`nfc/bridge/bridge.py` (`GET /api/nfc/taps`). Voor deze demo geldt elk
bandje als geregistreerd. De brug en de beheerpagina kunnen de Arduino niet
tegelijk gebruiken: stop de brug voordat je **Connect reader** kiest.

```bash
cd nfc/bridge && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
ARDUINO_PORT=/dev/cu.usbserial-120 python bridge.py
```

Zolang `volunteer.html` open is, vraagt de pagina elke 1,5 seconde om
tikken; elke tik wordt een hypothetisch verzoek op de kaart. **Alle
locaties zijn hypothetisch.** De verzoeken staan in `tap-request-store.js`
(`linked.tap-requests.v1`, maximaal 20).

### Hosting op Vercel

De webapp en de backend draaien samen op Vercel, op hetzelfde adres:

- De pagina's (`*.html`, `*.css`, `*.js`) worden bij het bouwen naar
  `public/` gekopieerd en statisch geserveerd. `server/` is dus niet te
  downloaden.
- Alles onder `/api/` gaat naar `api/index.py`, die de Flask-app uit
  `server/app.py` start.
- De database is Postgres (Neon, via de Vercel Marketplace). Lokaal blijft
  het SQLite. `server/db.py` kiest op basis van het adres; het Postgres-schema
  staat in `server/migrations/postgres/`. Migraties draaien bij het starten.

Omgevingsvariabelen in het Vercel-project:

| Variabele | Waarde |
| --- | --- |
| `DATABASE_URL` | zet de Neon-integratie zelf |
| `LINKED_SECRET_KEY` | lange willekeurige sleutel (verplicht op Vercel) |
| `LINKED_PUBLIC_BASE_URL` | het https-adres van de site, bv. `https://linked-mu-jet.vercel.app` |
| `LINKED_SECURE_COOKIES` | `1` |

Een beheerder aanmaken in de Neon-database (vanuit `linked`):

```sh
vercel env pull .env.production --environment=production
export $(grep DATABASE_URL .env.production | xargs)
server/.venv/bin/python -m server.manage create-user <naam>
rm .env.production
```

Let op: de inlogbeperking (5 pogingen per 15 minuten) wordt per
serverless-instantie bijgehouden en is op Vercel dus minder streng.

### Wat nog ontbreekt (bewust niet verzonnen)

- **Publieke HTTPS-hosting.** Telefoons moeten de server kunnen bereiken.
  Waar Linked draait (domein, hosting, TLS) is nog niet besloten. Tot dan
  werkt aantikken alleen als de telefoon `LINKED_PUBLIC_BASE_URL` kan openen.
  Kies een kort adres: het staat op elk bandje en kan later niet veranderen
  zonder alle bandjes opnieuw te schrijven.
- **Echte verzending van hulpaanvragen.** De bestaande hulpflow is nog een
  lokale demo (localStorage); het bandje opent die flow, maar maakt er geen
  echte melding van.
- **Organisaties.** Er zijn evenementen; een apart organisatiemodel is niet
  toegevoegd omdat de opdracht het niet beschrijft.
- **Vrijwilligersaccounts.** De rol `volunteer` bestaat in de database, maar
  `volunteer.html` gebruikt nog geen inlog.

### Testplan

| # | Actie | Verwacht | Automatisch | Handmatig |
|---|---|---|---|---|
| T1 | Connect reader (Chrome/Edge) | `Connected`, versie 2 | Geslaagd | In te vullen |
| T2 | Niet-ondersteunde browser (Safari, Firefox, telefoon) | Uitleg, knop uit | Geslaagd | In te vullen |
| T3 | Scan and identify: lege NTAG213 | UID, `NTAG213`, `Blank` | Geslaagd | In te vullen |
| T4 | Scan: tag met telefoonlink / MIFARE-kaart | Link getoond / `not an NTAG tag` | Geslaagd (firmware-host) | In te vullen |
| T5 | Registreren lege tag | Zes stappen ✓, `WB-0001` in lijst | Geslaagd | In te vullen |
| T6 | Tag teruglezen in Serial Monitor (`READ`) | Zelfde link | Geslaagd (firmware-host) | In te vullen |
| T7 | Zelfde tag nogmaals | `already registered as WB-0001` | Geslaagd | In te vullen |
| T8 | Tag met andere gegevens | Pas na **Overwrite** geschreven | Geslaagd | In te vullen |
| T9 | Tag tijdens schrijven weghalen | `failed`, **Try again** lukt, één record | Geslaagd | In te vullen |
| T10 | USB-kabel los tijdens registratie | Melding, poging `failed` | Geslaagd | In te vullen |
| T11 | Serial Monitor open bij verbinden | `port is in use` | Geslaagd | In te vullen |
| T12 | Activeren → tikken Android (Chrome) | Linked, `Wristband recognised` | Geslaagd (API) | In te vullen |
| T13 | Activeren → tikken iPhone (XS of nieuwer) | Linked, `Wristband recognised` | Geslaagd (API) | In te vullen |
| T14 | Deactiveren → tikken | `no longer active`, hulpknop werkt | Geslaagd | In te vullen |
| T15 | Hulp aanvragen na tikken | Bestaande flow, vrijwilliger ziet verzoek | Bestaande tests | In te vullen |
| T16 | Inloggen als `volunteer` / niet ingelogd | Geen beheer, API `403` / `401` | Geslaagd | In te vullen |
| T17 | Zoeken op `WB-0001`, UID, evenement; filter | Juiste rijen | Geslaagd | In te vullen |

Tips voor T12/T13: iPhones lezen NFC-links alleen als het scherm aan en
ontgrendeld is (achtergrondlezen, iPhone XS en nieuwer); houd het bandje
bij de bovenrand. Android: NFC aan in instellingen, scherm ontgrendeld.

## Geautomatiseerde controle

Met Node.js geïnstalleerd:

```powershell
node app.test.cjs
node volunteer.test.cjs
node wristbands.test.cjs
node wristband-tap.test.cjs
node nfc-serial.test.cjs
node --check app.js
```

Backend (vanuit `linked`, met `server/.venv`):

```bash
server/.venv/bin/python -m unittest server.test_server -v
```

NDEF-logica van de firmware op de computer (zonder Arduino) en een
compilatiecontrole voor de Uno:

```bash
c++ -std=c++11 -Wall -Wextra -o /tmp/test_ndef nfc/firmware/test/test_ndef.cpp && /tmp/test_ndef
arduino-cli compile --fqbn arduino:avr:uno nfc/firmware/linked_nfc
```

Voor de brug (in `nfc/bridge`, met de venv actief):

```bash
python -m unittest test_bridge.py
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
