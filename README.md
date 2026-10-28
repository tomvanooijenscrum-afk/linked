# Linked - eerste prototype

Deze fase richt zich op vier user stories: openen, hulp aanvragen,
status bekijken en annuleren. Het conceptdocument van 30 september 2026
beschrijft de richting voor later, niet de scope van dit prototype.

Het product is Engelstalig. Codecommentaren en teamdocumentatie blijven
Nederlandstalig; de onderstaande knop- en statusnamen volgen de Engelse UI.

## Starten

Open `index.html` in een browser. Er is geen installatie of build nodig.
De aanvraagflow werkt lokaal; kaarttegels en leesbare gebiedslabels vereisen
een internetverbinding. Browserlocatie werkt alleen in een secure context:
test locatie delen via `localhost` of HTTPS, niet door het HTML-bestand
rechtstreeks te openen.

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
het lokale verzoek en de wachtende ontvangstsimulatie. Het demoverzoek en de
beschikbaarheid worden lokaal in de browser opgeslagen. Vernieuwen behoudt
deze gegevens; andere tabbladen kunnen wijzigingen volgen.

## Status en geluid

- De aanvraagstatus wordt getoond in tekst en statusbanners. Een geografische
  kaart verschijnt alleen wanneer de aanvrager kiest om een benaderde locatie
  te delen.
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

## Approximate location (user story 10)

Locatie delen is optioneel en staat standaard uit. De browser vraagt pas om
toestemming nadat de aanvrager **Share approximate location** heeft gekozen
en het hulpverzoek heeft ingediend. De demo slaat alleen breedte- en
lengtegraad op die op twee decimalen zijn afgerond (ongeveer 1,1 km
noord-zuid; oost-west verschilt per breedtegraad), nooit de precieze waarden
van de browser. Dit is een eenmalige locatiebepaling, geen continue tracking.
De kaart gebruikt Leaflet en OpenStreetMap-tegels. Een transparante groene
cirkel wordt geografisch gecentreerd op de afgeronde coördinaten. De straal
dekt de halve diagonaal van het afrondingsvak plus de door de browser gemelde
GPS-nauwkeurigheid, naar boven afgerond op stappen van 50 meter. Rond
Eindhoven is dit zonder GPS-nauwkeurigheid ongeveer 700 meter. Alleen het
afgeronde middelpunt en de afgeleide straal worden opgeslagen; ruwe
GPS-nauwkeurigheid en precieze coördinaten niet. OpenStreetMap en Photon
(OpenStreetMap-gebaseerde reverse-geocoding) ontvangen alleen de afgeronde
coördinaten. Het label gebruikt een benaderde straat/gebied/stad, vermijdt
huisnummers en gebruikt "Near" om de benadering duidelijk te maken.
Kaarttegels en geocodering kunnen niet beschikbaar zijn; het verzoek werkt dan
nog steeds en het label valt terug op **Approximate location available**.
Bij geweigerde toestemming, onbeschikbare locatie, timeout of een niet
ondersteunde browser blijft het hulpverzoek beschikbaar zonder locatie.
Annuleren tijdens de toestemmingsvraag negeert een later resultaat; annuleren
verwijdert ook een al opgeslagen benaderde locatie.

De vrijwilligersinbox toont een gedeelde benaderde locatie alleen in de
geaccepteerde aanvraag; anders staat er **No location shared**. Dit prototype
gebruikt `localStorage`, dat toegankelijk is voor andere code op dezelfde
website. Verbergen tot acceptatie in de interface is geen beveiligde
toegangscontrole. Een echte toepassing heeft een backend nodig die toegang
tot de locatie pas na acceptatie autoriseert.

### Handmatig testen

1. Start de app via `localhost` of HTTPS en open de aanvragerspagina.
2. Controleer dat **Share approximate location** uit staat en er geen
   toestemmingsvraag verschijnt.
3. Dien zonder locatie in en controleer dat het verzoek gewoon doorgaat.
4. Kies locatie delen, dien in en sta toestemming toe. Controleer dat de
   feedback delen bevestigt, maar dat de vrijwilligersinbox nog geen locatie
   toont zolang de aanvraag wacht.
5. Accepteer de aanvraag en controleer dat een mini-kaart en een label zoals
   **Near [street/area], [city]** verschijnen, zonder coördinaten of
   huisnummer. Herhaal zonder locatie en controleer **No location shared**.
6. Weiger toestemming, schakel apparaatlocatie uit of wacht op de timeout.
   Controleer dat het verzoek beschikbaar blijft en de feedback uitlegt dat
   er geen locatie is gedeeld.
7. Kies tijdens het wachten **Ask for help without location** en controleer
   dat het verzoek actief blijft en een laat GPS-resultaat wordt genegeerd.
8. Annuleer een verzoek terwijl de toestemmingsvraag openstaat, sta daarna
   eventueel toe en controleer dat er niets wordt opgeslagen. Begin een
   nieuw verzoek en controleer dat delen weer uit staat.
9. Blokkeer de Photon-aanvraag of test offline: de cirkel blijft zichtbaar als
   de kaarttegels laden, het label valt terug op **Approximate location
   available** en de aanvraag blijft werken. Als Leaflet zelf niet beschikbaar
   is, meldt de kaart **Map preview unavailable**.

## Geautomatiseerde controle

Met Node.js geïnstalleerd:

```powershell
node app.test.cjs
node volunteer.test.cjs
node --check app.js
node --check volunteer.js
node --check request-store.js
node --check approximate-map.js
```

De test gebruikt de echte appcode met een gesimuleerde DOM en timers.
Hij controleert de complete flow, dubbele klikken, annuleren vóór en na
ontvangst, opnieuw starten en callbacks van oude verzoeken. Dit vervangt
geen gebruikerstest op een echte telefoon.

## Code lezen

- `index.html`: één gebruikersscherm met vaste knoppen en statusvelden.
- `styles.css`: de bestaande groene stijl, kaarten en mobiele indeling.
- `app.js`: vier statussen, twee acties en één ontvangsttimer.
- `approximate-map.js`: gedeelde Leaflet-kaart met een geografische onzekerheidscirkel.
- `app.test.cjs`: reproduceerbare controles zonder extra dependencies.

De code bevat Nederlandse uitleg en korte, verticaal opgemaakte regels.
`render()` past tekst en zichtbaarheid aan; eventhandlers veranderen de
status. De ontvangstsimulatie en een eventuele eenmalige locatiebepaling zijn
asynchroon.

## Bewaarde uitgebreide versie

De bestaande versie, inclusief alle toen niet-gecommitte bestanden,
is bewaard op `archive/linked-expanded-prototype`, commit `57a6b83`.
Deze vereenvoudiging staat op `feature/linked-phase-one-flow`.
Er is geen Git-geschiedenis herschreven en niets gepusht.

De analyse, scopekeuzes, rol van Codex en voorgestelde acht weken
vervolgwerk staan in [PROJECTKEUZES.md](PROJECTKEUZES.md).

<!-- Rayan feature branch initialized -->
