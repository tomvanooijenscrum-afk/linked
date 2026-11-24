// Linked NFC v2: leest en schrijft NTAG213-polsbanden via een PN532 (SPI).
//
// Seriële regels: 115200 baud, elke opdracht eindigt met newline (\n).
// Elk antwoord begint met CMD:<naam>, dan nul of meer informatieregels en
// precies één slotregel die begint met SUCCESS: of ERROR:.
// Zie nfc/PROTOCOL.md.
//
//   PING                         -> SUCCESS:PONG
//   VERSION                      -> SUCCESS:VERSION:LINKED_NFC:2
//   SCAN                         -> UID:<hex>, SUCCESS:TAG_DETECTED
//   INFO                         -> UID, TYPE, LOCKED, NDEF, [URL], SUCCESS:INFO
//   READ                         -> UID:<hex>, SUCCESS:URL:<url>
//   WRITE:<uid>:<mode>:<url>     -> UID:<hex>, SUCCESS:WRITTEN:<url>
//   WRITE:<url>                  -> oude vorm (v1): mode BLANK, zonder UID
//
// <mode> is BLANK (alleen lege tags of exact dezelfde link) of REPLACE
// (overschrijf bestaande NDEF-inhoud, nooit op een vergrendelde tag).

#include <SPI.h>
#include <Adafruit_PN532.h>
#include <string.h>

#include "linked_ndef.h"

#define PN532_SS 10
#define TAG_WAIT_MS 3000
#define INCOMPLETE_COMMAND_MS 2000
#define COMMAND_BUFFER_SIZE 180
#define UID_HEX_LENGTH 14

Adafruit_PN532 nfc(PN532_SS);

uint8_t tagMemory[NTAG213_USER_BYTES];
char commandBuffer[COMMAND_BUFFER_SIZE];
uint8_t commandIndex = 0;
bool discardingLine = false;
unsigned long lastByteAt = 0;
bool readerReady = false;

struct Tag {
  uint8_t uid[7];
  uint8_t uidLength;
};

void fail(const __FlashStringHelper *code) {
  Serial.print(F("ERROR:"));
  Serial.println(code);
}

bool startReader() {
  nfc.begin();
  if (!nfc.getFirmwareVersion()) return false;
  return nfc.SAMConfig();
}

// Opdrachten die de lezer nodig hebben, proberen hem zo nodig opnieuw.
bool requireReader() {
  if (!readerReady) readerReady = startReader();
  if (!readerReady) fail(F("PN532_NOT_FOUND"));
  return readerReady;
}

void uidToHex(const Tag &tag, char *output) {
  const char digits[] = "0123456789ABCDEF";
  for (uint8_t i = 0; i < tag.uidLength; i++) {
    output[i * 2] = digits[tag.uid[i] >> 4];
    output[i * 2 + 1] = digits[tag.uid[i] & 0x0F];
  }
  output[tag.uidLength * 2] = '\0';
}

void printUid(const Tag &tag) {
  char hex[UID_HEX_LENGTH + 1];
  uidToHex(tag, hex);
  Serial.print(F("UID:"));
  Serial.println(hex);
}

bool waitForTag(Tag &tag) {
  Serial.println(F("STATUS:WAITING_FOR_TAG"));
  tag.uidLength = 0;
  if (!nfc.readPassiveTargetID(
        PN532_MIFARE_ISO14443A, tag.uid, &tag.uidLength, TAG_WAIT_MS)) {
    fail(F("TAG_NOT_FOUND"));
    return false;
  }
  return true;
}

// Leest pagina 4 t/m 39 één voor één (ReadPage geeft 4 bytes per pagina).
bool readUserMemory() {
  for (uint8_t i = 0; i < NTAG213_USER_PAGES; i++) {
    if (!nfc.ntag2xx_ReadPage(NTAG213_FIRST_USER_PAGE + i, tagMemory + i * 4)) {
      return false;
    }
  }
  return true;
}

// Capability container (pagina 3): E1 = NDEF, byte 2 = grootte.
// 0x12 * 8 = 144 bytes = NTAG213.
bool isNtag213(const uint8_t *cc) {
  return cc[0] == 0xE1 && cc[2] == 0x12;
}

const __FlashStringHelper *typeName(const Tag &tag, const uint8_t *cc) {
  if (tag.uidLength != 7) return F("UNSUPPORTED");
  if (cc[0] != 0xE1) return F("TYPE2_NO_NDEF");
  if (cc[2] == 0x12) return F("NTAG213");
  if (cc[2] == 0x3E) return F("NTAG215");
  if (cc[2] == 0x6D) return F("NTAG216");
  return F("TYPE2_OTHER");
}

// Vergrendeld als de CC schrijven verbiedt of een lock-bit gezet is
// (statisch: pagina 2 byte 2-3, dynamisch NTAG213: pagina 40 byte 0-2).
bool readLocked(const uint8_t *cc, bool &locked) {
  uint8_t page[4];
  locked = cc[3] != 0x00;

  if (!nfc.ntag2xx_ReadPage(2, page)) return false;
  if (page[2] != 0x00 || page[3] != 0x00) locked = true;

  if (isNtag213(cc)) {
    if (!nfc.ntag2xx_ReadPage(40, page)) return false;
    if (page[0] != 0x00 || page[1] != 0x00 || page[2] != 0x00) locked = true;
  }
  return true;
}

void scanTag() {
  if (!requireReader()) return;
  Tag tag;
  if (!waitForTag(tag)) return;
  printUid(tag);
  Serial.println(F("SUCCESS:TAG_DETECTED"));
}

void printNdef(LinkedNdefState state, const char *url) {
  Serial.print(F("NDEF:"));
  switch (state) {
    case NDEF_BLANK: Serial.println(F("BLANK")); break;
    case NDEF_URL: Serial.println(F("URL")); break;
    case NDEF_OTHER: Serial.println(F("OTHER")); break;
    default: Serial.println(F("INVALID")); break;
  }
  if (state == NDEF_URL) {
    Serial.print(F("URL:"));
    Serial.println(url);
  }
}

void infoTag() {
  if (!requireReader()) return;
  Tag tag;
  if (!waitForTag(tag)) return;
  printUid(tag);

  // MIFARE Classic e.d. (4-byte UID) begrijpen geen NTAG-paginaopdrachten.
  if (tag.uidLength != 7) {
    Serial.println(F("TYPE:UNSUPPORTED"));
    Serial.println(F("SUCCESS:INFO"));
    return;
  }

  uint8_t cc[4];
  bool locked = false;
  if (!nfc.ntag2xx_ReadPage(3, cc) || !readLocked(cc, locked)) {
    fail(F("READ_FAILED"));
    return;
  }

  Serial.print(F("TYPE:"));
  Serial.println(typeName(tag, cc));
  Serial.print(F("LOCKED:"));
  Serial.println(locked ? 1 : 0);

  if (cc[0] == 0xE1) {
    if (!readUserMemory()) {
      fail(F("READ_FAILED"));
      return;
    }
    char url[LINKED_URL_BUFFER];
    printNdef(linkedParseNdef(tagMemory, url, sizeof(url)), url);
  }

  Serial.println(F("SUCCESS:INFO"));
}

void readUrl() {
  if (!requireReader()) return;
  Tag tag;
  if (!waitForTag(tag)) return;

  if (tag.uidLength != 7) {
    fail(F("UNSUPPORTED_TAG"));
    return;
  }
  if (!readUserMemory()) {
    fail(F("READ_FAILED"));
    return;
  }

  char url[LINKED_URL_BUFFER];
  if (linkedParseNdef(tagMemory, url, sizeof(url)) != NDEF_URL) {
    fail(F("NO_SUPPORTED_NDEF_URL"));
    return;
  }

  printUid(tag);
  Serial.print(F("SUCCESS:URL:"));
  Serial.println(url);
}

bool isHexUid(const char *text) {
  for (uint8_t i = 0; i < UID_HEX_LENGTH; i++) {
    char c = text[i];
    bool isHex = (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F');
    if (!isHex) return false;
  }
  return true;
}

// args is alles na "WRITE:".
void writeUrl(char *args) {
  const char *expectedUid = 0;
  bool replace = false;
  const char *url = args;

  if (strncmp(args, LINKED_HTTPS, LINKED_HTTPS_LENGTH) != 0) {
    // Nieuwe vorm: <uid>:<mode>:<url>
    if (strlen(args) < UID_HEX_LENGTH + 2 ||
        args[UID_HEX_LENGTH] != ':' ||
        !isHexUid(args)) {
      fail(F("INVALID_COMMAND"));
      return;
    }
    args[UID_HEX_LENGTH] = '\0';
    expectedUid = args;
    char *mode = args + UID_HEX_LENGTH + 1;

    if (strncmp(mode, "BLANK:", 6) == 0) {
      url = mode + 6;
    } else if (strncmp(mode, "REPLACE:", 8) == 0) {
      replace = true;
      url = mode + 8;
    } else {
      fail(F("INVALID_COMMAND"));
      return;
    }
  }

  const char *urlError = linkedCheckUrl(url);
  if (urlError) {
    Serial.print(F("ERROR:"));
    Serial.println(urlError);
    return;
  }

  if (!requireReader()) return;
  Tag tag;
  if (!waitForTag(tag)) return;

  if (tag.uidLength != 7) {
    fail(F("UNSUPPORTED_TAG"));
    return;
  }

  printUid(tag);

  // Voorkomt dat een andere tag wordt beschreven dan de gescande tag.
  if (expectedUid) {
    char hex[UID_HEX_LENGTH + 1];
    uidToHex(tag, hex);
    if (strcmp(hex, expectedUid) != 0) {
      fail(F("UID_MISMATCH"));
      return;
    }
  }

  uint8_t cc[4];
  bool locked = false;
  if (!nfc.ntag2xx_ReadPage(3, cc) || !readLocked(cc, locked)) {
    fail(F("READ_FAILED"));
    return;
  }
  if (!isNtag213(cc)) {
    fail(F("UNSUPPORTED_TAG"));
    return;
  }
  if (locked) {
    fail(F("TAG_READ_ONLY"));
    return;
  }

  if (!readUserMemory()) {
    fail(F("READ_FAILED"));
    return;
  }

  // Staat exact deze link er al op (bijv. bij opnieuw proberen), dan
  // hoeft er niets geschreven te worden.
  bool alreadyWritten = linkedMatchesUrl(url, tagMemory);

  if (!alreadyWritten && !replace) {
    char existing[LINKED_URL_BUFFER];
    if (linkedParseNdef(tagMemory, existing, sizeof(existing)) != NDEF_BLANK) {
      fail(F("TAG_NOT_BLANK"));
      return;
    }
  }

  if (!alreadyWritten) {
    Serial.println(F("STATUS:WRITING"));

    // Alleen pagina's die afwijken: sneller en minder slijtage.
    for (uint8_t page = 0; page < NTAG213_USER_PAGES; page++) {
      uint8_t data[4];
      bool changed = false;
      for (uint8_t i = 0; i < 4; i++) {
        data[i] = linkedExpectedByte(url, page * 4 + i);
        if (data[i] != tagMemory[page * 4 + i]) changed = true;
      }
      if (changed &&
          !nfc.ntag2xx_WritePage(NTAG213_FIRST_USER_PAGE + page, data)) {
        fail(F("WRITE_FAILED"));
        return;
      }
    }
  }

  Serial.println(F("STATUS:VERIFYING"));

  if (!readUserMemory()) {
    fail(F("VERIFY_READ_FAILED"));
    return;
  }
  if (!linkedMatchesUrl(url, tagMemory)) {
    fail(F("VERIFY_MISMATCH"));
    return;
  }

  Serial.print(F("SUCCESS:WRITTEN:"));
  Serial.println(url);
}

void handleCommand(char *command) {
  // Echo van de opdrachtnaam: zo kan de webapp een antwoord altijd aan
  // de juiste opdracht koppelen en losse meldingen negeren.
  Serial.print(F("CMD:"));
  for (char *c = command; *c != '\0' && *c != ':'; c++) Serial.print(*c);
  Serial.println();

  if (strcmp(command, "PING") == 0) {
    if (requireReader()) Serial.println(F("SUCCESS:PONG"));
  } else if (strcmp(command, "VERSION") == 0) {
    Serial.println(F("SUCCESS:VERSION:LINKED_NFC:2"));
  } else if (strcmp(command, "SCAN") == 0) {
    scanTag();
  } else if (strcmp(command, "INFO") == 0) {
    infoTag();
  } else if (strcmp(command, "READ") == 0) {
    readUrl();
  } else if (strncmp(command, "WRITE:", 6) == 0) {
    writeUrl(command + 6);
  } else {
    fail(F("UNKNOWN_COMMAND"));
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  readerReady = startReader();

  // De webapp wacht op deze regel; de Uno herstart bij elke nieuwe
  // seriële verbinding.
  Serial.println(readerReady ? F("READY:LINKED_NFC:2")
                             : F("READY:LINKED_NFC:2:NO_READER"));
}

void loop() {
  // Een halve opdracht zonder newline wordt na 2 s weggegooid.
  if ((commandIndex > 0 || discardingLine) &&
      millis() - lastByteAt > INCOMPLETE_COMMAND_MS) {
    commandIndex = 0;
    discardingLine = false;
    fail(F("INCOMPLETE_COMMAND"));
  }

  while (Serial.available()) {
    char c = Serial.read();
    lastByteAt = millis();

    if (c == '\n' || c == '\r') {
      if (discardingLine) {
        discardingLine = false;
      } else if (commandIndex > 0) {
        commandBuffer[commandIndex] = '\0';
        commandIndex = 0;
        handleCommand(commandBuffer);
      }
    } else if (discardingLine) {
      // Rest van een te lange regel negeren.
    } else if (commandIndex < COMMAND_BUFFER_SIZE - 1) {
      commandBuffer[commandIndex++] = c;
    } else {
      commandIndex = 0;
      discardingLine = true;
      fail(F("COMMAND_TOO_LONG"));
    }
  }
}
