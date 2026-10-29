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

Een beheerder programmeert NTAG213-polsbanden vanuit `wristbands.html`.
Een telefoon die het bandje aantikt, opent daarna de Linked-pagina.

```
wristbands.html --fetch--> nfc/bridge/bridge.py --USB--> Arduino Uno --SPI--> PN532 --> NTAG213
```

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
voordat je bedrading wijzigt. Gebruik lege, schrijfbare NTAG213-tags;
MIFARE Classic-kaarten werken niet.

### Firmware

1. Installeer in Arduino IDE de bibliotheek **Adafruit PN532**.
2. Open `nfc/firmware/linked_nfc/linked_nfc.ino` en upload.
3. Serial Monitor: 115200 baud, regeleinde **Newline**. Test:
   - `PING` → `SUCCESS:PONG`
   - `SCAN` → `UID:…` en `SUCCESS:TAG_DETECTED`
   - `WRITE:https://linked.example/?t=a7k92x4q` → `SUCCESS:WRITTEN:…`
   - `READ` → `UID:…` en `SUCCESS:URL:…`

Ten opzichte van het voorbeeld uit de handleiding leest `readPages()` nu
per pagina: `mifareultralight_ReadPage` geeft maar 4 bytes terug, dus
stappen van 16 bytes lieten het grootste deel van het geheugen ongelezen.
`READ` stuurt nu ook de UID mee, zodat de webapp die kan bewaren.

### Brug starten

```bash
cd nfc/bridge
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ARDUINO_PORT=/dev/cu.usbserial-120 python bridge.py
```

De brug luistert alleen op `http://127.0.0.1:5001` en accepteert verzoeken
van Live Server (`http://127.0.0.1:5501` en `http://localhost:5501`).
Zoek de juiste poort met `ls /dev/cu.*`. Sluit Serial Monitor eerst:
de poort kan maar door één programma tegelijk worden gebruikt.

### Gebruik

1. Open `wristbands.html` via Live Server.
2. **Connect Arduino**, daarna eventueel **Scan NFC tag**.
3. Vul het korte HTTPS-adres van de Linked-pagina in en kies **Save**.
   De volledige link (`<adres>/?t=<token>`) mag maximaal 40 tekens na
   `https://` zijn. Gebruik geen lang tunneladres.
4. **Register wristband** maakt een wachtend bandje met een willekeurig
   token van 8 tekens.
5. Leg het bandje op de lezer en kies **Program wristband**. De app schrijft
   de link, leest hem terug en activeert het bandje alleen als hij klopt.

### Polsbandje aantikken → verzoeken op de kaart

Voor deze demo geldt elk bandje als geregistreerd. Zolang `volunteer.html`
open is, vraagt de pagina elke 1,5 seconde aan de brug
(`GET /api/nfc/taps`) of er getikt is. De brug stuurt dan doorlopend
`SCAN` naar de Arduino. Is de pagina 10 seconden weg, dan stopt het scannen.

1. Start de brug en open `volunteer.html` via Live Server.
2. Bij **Requests near you** staat **Wristband reader: listening for taps.**
3. Tik een tag op de lezer: er verschijnt een melding **Someone needs help**
   en een nieuw verzoek op de kaart en in de lijst.

Elke tik telt als een nieuw persoon, zodat één tag genoeg is om meerdere
verzoeken te tonen. Een tag die blijft liggen telt als één tik.

**Alle locaties zijn hypothetisch.** De vrijwilliger staat vast bij Fontys
Rachelsmolen; elk verzoek krijgt een willekeurige plek op 0,3–3 km afstand.
Er wordt geen echte locatie opgevraagd. De lijst staat op afstand
(haversine), het dichtstbijzijnde wachtende verzoek is gemarkeerd als
**Closest** en elk verzoek heeft een eigen **Accept**-knop. De kaart gebruikt
Leaflet en OpenStreetMap, net als de US10-branch, en heeft internet nodig;
zonder kaart blijft de lijst werken.

De verzoeken staan in `tap-request-store.js` (`linked.tap-requests.v1`,
maximaal 20), los van het ene verzoek van `index.html`. Bij **Unavailable**
worden wachtende verzoeken bewaard maar verborgen, zonder melding.
**Clear wristband requests** wist de demolijst.

### Beperkingen van deze fase

- Alleen lege NTAG213-tags met fabrieksinstellingen. Tags met een lege
  NDEF-melding (`03 00 FE`) worden geweigerd met `TAG_NOT_BLANK`, zodat
  er nooit onbekende gegevens worden overschreven.
- De registratie staat in localStorage van de beheerder. De telefoon
  controleert het token nog niet, dus deactiveren blokkeert de link nog niet.
- De brug is alleen voor een vertrouwde ontwikkelcomputer. CORS is geen
  authenticatie; zet de brug nooit achter een publieke tunnel.
- Een HTTPS-pagina mag mogelijk geen verzoeken naar `http://127.0.0.1`
  doen. Programmeer daarom vanaf de lokale Live Server-pagina.

### Testplan

| # | Actie | Verwacht | Automatisch | Handmatig |
|---|---|---|---|---|
| T1 | Connect Arduino | `Arduino connected.` | Geslaagd | In te vullen |
| T2 | Scan tag | UID zichtbaar | Geslaagd | In te vullen |
| T3 | Register wristband | Wachtend bandje met link | Geslaagd | In te vullen |
| T4 | Program blank NTAG213 | NDEF-link geschreven | Geslaagd | In te vullen |
| T5 | Verify | Teruggelezen link klopt, bandje actief | Geslaagd | In te vullen |
| T6 | Tik met telefoon (Android en iPhone) | Linked opent | – | In te vullen |
| T7–T9 | Hulp aanvragen en ontvangen | Bestaande flow | Bestaande tests | In te vullen |
| T10 | Gedeactiveerd bandje | Token geweigerd | – | Volgende fase (backend) |

## Geautomatiseerde controle

Met Node.js geïnstalleerd:

```powershell
node app.test.cjs
node volunteer.test.cjs
node wristbands.test.cjs
node --check app.js
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
