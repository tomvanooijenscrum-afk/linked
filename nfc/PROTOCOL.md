# Linked NFC serieel protocol (v2)

Tussen de webapp (`nfc-serial.js`, Web Serial) en de Arduino-firmware
(`nfc/firmware/linked_nfc`). 115200 baud, 8N1, ASCII.

## Regels

- Een opdracht is één regel die eindigt met `\n` (maximaal 179 tekens).
- Een antwoord bestaat uit:
  1. `CMD:<naam>`: echo van de opdrachtnaam (alles vóór de eerste `:`);
  2. nul of meer informatieregels (`STATUS:`, `UID:`, `TYPE:`, …);
  3. precies één slotregel: `SUCCESS:…` of `ERROR:<CODE>`.
- Opdrachten worden één voor één verwerkt. De webapp stuurt pas een nieuwe
  opdracht als de vorige een slotregel heeft of verlopen is.
- Regels vóór de `CMD:`-echo horen niet bij de opdracht en worden genegeerd.
- Na het openen van de poort herstart de Uno en meldt hij
  `READY:LINKED_NFC:2`, of `READY:LINKED_NFC:2:NO_READER` als de PN532
  niet gevonden is.
- Een halve opdracht zonder newline wordt na 2 s weggegooid
  (`ERROR:INCOMPLETE_COMMAND`); een te lange regel geeft
  `ERROR:COMMAND_TOO_LONG` en de rest van die regel wordt genegeerd.

## Opdrachten

| Opdracht | Antwoord bij succes |
|---|---|
| `PING` | `SUCCESS:PONG` (alleen als de PN532 antwoordt) |
| `VERSION` | `SUCCESS:VERSION:LINKED_NFC:2` |
| `SCAN` | `UID:<hex>`, `SUCCESS:TAG_DETECTED` |
| `INFO` | `UID:<hex>`, `TYPE:<type>`, `LOCKED:0\|1`, `NDEF:<staat>`, [`URL:<url>`], `SUCCESS:INFO` |
| `READ` | `UID:<hex>`, `SUCCESS:URL:<url>` |
| `WRITE:<uid>:<mode>:<url>` | `UID:<hex>`, `STATUS:WRITING`, `STATUS:VERIFYING`, `SUCCESS:WRITTEN:<url>` |
| `WRITE:<url>` | v1-vorm voor `bridge.py`: mode `BLANK`, zonder UID-controle |

Alle tag-opdrachten melden eerst `STATUS:WAITING_FOR_TAG` en wachten
maximaal 3 s op een tag.

- `<uid>`: 14 hoofdletter-hextekens (7-byte NTAG-UID). Het schrijven
  stopt met `UID_MISMATCH` als er een andere tag op de lezer ligt.
- `<mode>`: `BLANK` schrijft alleen naar een lege tag (alleen nullen of
  een lege NDEF-melding `03 00 FE`) of naar een tag waar exact deze link
  al op staat. `REPLACE` overschrijft bestaande inhoud, maar nooit op een
  vergrendelde tag.
- `<url>`: `https://` + 1–136 zichtbare ASCII-tekens.
- `TYPE`: `NTAG213`, `NTAG215`, `NTAG216`, `TYPE2_OTHER`,
  `TYPE2_NO_NDEF` of `UNSUPPORTED` (geen 7-byte UID, bijv. MIFARE Classic).
  Alleen `NTAG213` kan beschreven worden.
- `NDEF`: `BLANK`, `URL`, `OTHER` (geldige NDEF, geen link) of `INVALID`.

## Geheugenindeling (NTAG213, pagina 4–39, 144 bytes)

```
03 LL  D1 01 PL 55 04  <url zonder https://>  FE  00 …
TLV    URI-record (prefix 04 = https://)      einde
```

`LL = 5 + n`, `PL = 1 + n`, met `n` de lengte van de URL zonder
`https://` (maximaal 136). Na het schrijven leest de firmware alle 144 bytes
terug en vergelijkt ze byte voor byte.

## Foutcodes

| Code | Betekenis |
|---|---|
| `PN532_NOT_FOUND` | Lezer niet gevonden (bedrading, SPI-schakelaars) |
| `TAG_NOT_FOUND` | Geen tag binnen 3 s |
| `UNSUPPORTED_TAG` | Geen NTAG213 |
| `TAG_READ_ONLY` | Capability container of lock-bits verbieden schrijven |
| `TAG_NOT_BLANK` | `BLANK`-modus, maar de tag bevat andere gegevens |
| `UID_MISMATCH` | Andere tag dan verwacht |
| `READ_FAILED` | Lezen mislukt |
| `WRITE_FAILED` | Schrijven van een pagina mislukt |
| `VERIFY_READ_FAILED` | Teruglezen na schrijven mislukt |
| `VERIFY_MISMATCH` | Teruggelezen inhoud wijkt af |
| `NO_SUPPORTED_NDEF_URL` | `READ`: geen leesbare link op de tag |
| `HTTPS_REQUIRED`, `URL_TOO_LONG`, `INVALID_URL` | Ongeldige link |
| `INVALID_COMMAND`, `UNKNOWN_COMMAND` | Onbekende of verkeerd opgebouwde opdracht |
| `INCOMPLETE_COMMAND`, `COMMAND_TOO_LONG` | Zie de regels hierboven |

`nfc-serial.js` voegt daar fouten van de verbinding zelf aan toe:
`UNSUPPORTED_BROWSER`, `NO_PORT_SELECTED`, `PERMISSION_DENIED`,
`PORT_BUSY`, `PORT_ALREADY_OPEN`, `NOT_CONNECTED`, `TIMEOUT`,
`READER_DISCONNECTED`, `READER_NOT_RESPONDING` (twee keer op rij geen
antwoord), `READER_RESET` (Arduino herstartte midden in een opdracht),
`FIRMWARE_OUTDATED` en `INCOMPLETE_RESPONSE`.
