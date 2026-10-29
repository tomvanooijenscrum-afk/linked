// Linked NFC: leest en schrijft NTAG213-polsbanden via een PN532 (SPI).
// Seriële opdrachten (115200 baud, regel eindigt met newline):
//   PING              -> SUCCESS:PONG
//   SCAN              -> UID:<hex> en SUCCESS:TAG_DETECTED
//   WRITE:https://... -> SUCCESS:WRITTEN:<url>
//   READ              -> SUCCESS:URL:<url>
// Elke opdracht eindigt met precies één SUCCESS:- of ERROR:-regel.

#include <SPI.h>
#include <Adafruit_PN532.h>
#include <string.h>

#define PN532_SS 10

Adafruit_PN532 nfc(PN532_SS);

// NTAG213 heeft 144 bytes gebruikersgeheugen.
// Deze eerste versie gebruikt alleen de eerste 48 bytes (pagina 4 t/m 15).
#define MAX_NDEF_BYTES 48
#define FIRST_USER_PAGE 4
#define USER_PAGE_COUNT 12

char commandBuffer[100];
uint8_t commandIndex = 0;

bool readTag(uint8_t *uid, uint8_t *uidLength) {
  return nfc.readPassiveTargetID(
    PN532_MIFARE_ISO14443A,
    uid,
    uidLength,
    3000
  );
}

void printUID(uint8_t *uid, uint8_t uidLength) {
  for (uint8_t i = 0; i < uidLength; i++) {
    if (uid[i] < 0x10) Serial.print("0");
    Serial.print(uid[i], HEX);
  }
  Serial.println();
}

bool readPages(uint8_t *buffer) {
  // mifareultralight_ReadPage kopieert maar 4 bytes (één pagina)
  // per aanroep, dus we lezen pagina 4 t/m 15 één voor één.
  for (uint8_t i = 0; i < USER_PAGE_COUNT; i++) {
    if (!nfc.mifareultralight_ReadPage(
          FIRST_USER_PAGE + i,
          buffer + i * 4
        )) {
      return false;
    }
  }

  return true;
}

bool getNdefUrl(char *output, size_t outputSize) {
  uint8_t memory[MAX_NDEF_BYTES];

  if (!readPages(memory)) {
    return false;
  }

  // Verwacht een korte NDEF-TLV aan het begin van het gebruikersgeheugen.
  if (memory[0] != 0x03) return false;

  uint8_t tlvLength = memory[1];

  if (tlvLength < 5 || tlvLength > 45) return false;

  // Eén kort URI-record met prefix 0x04 (https://).
  if (memory[2] != 0xD1) return false;
  if (memory[3] != 0x01) return false;
  if (memory[5] != 0x55) return false;
  if (memory[6] != 0x04) return false;

  uint8_t payloadLength = memory[4];

  if (payloadLength < 1 ||
      tlvLength != payloadLength + 4) {
    return false;
  }

  const char prefix[] = "https://";
  size_t prefixLength = strlen(prefix);
  size_t suffixLength = payloadLength - 1;

  if (prefixLength + suffixLength + 1 > outputSize) {
    return false;
  }

  if (7 + suffixLength >= sizeof(memory)) {
    return false;
  }

  memcpy(output, prefix, prefixLength);
  memcpy(output + prefixLength, memory + 7, suffixLength);
  output[prefixLength + suffixLength] = '\0';

  return true;
}

void scanTag() {
  uint8_t uid[7];
  uint8_t uidLength = 0;

  Serial.println("STATUS:WAITING_FOR_TAG");

  if (!readTag(uid, &uidLength)) {
    Serial.println("ERROR:TAG_NOT_FOUND");
    return;
  }

  Serial.print("UID:");
  printUID(uid, uidLength);

  Serial.println("SUCCESS:TAG_DETECTED");
}

void writeUrl(const char *url) {
  const char prefix[] = "https://";

  if (strncmp(url, prefix, strlen(prefix)) != 0) {
    Serial.println("ERROR:HTTPS_REQUIRED");
    return;
  }

  size_t suffixLength = strlen(url) - strlen(prefix);

  // NDEF-TLV (2) + URI-record (5) + URL + terminator (1).
  size_t usedBytes = 8 + suffixLength;

  if (usedBytes > MAX_NDEF_BYTES) {
    Serial.println("ERROR:URL_TOO_LONG");
    return;
  }

  uint8_t uid[7];
  uint8_t uidLength = 0;

  Serial.println("STATUS:WAITING_FOR_TAG");

  if (!readTag(uid, &uidLength)) {
    Serial.println("ERROR:TAG_NOT_FOUND");
    return;
  }

  if (uidLength != 7) {
    Serial.println("ERROR:UNSUPPORTED_TAG");
    return;
  }

  // Controleer de fabrieks-capability container (pagina 3).
  // E1 10 12 00 is de normale CC van een NTAG213.
  uint8_t capability[4];

  if (!nfc.mifareultralight_ReadPage(3, capability)) {
    Serial.println("ERROR:READ_FAILED");
    return;
  }

  if (capability[0] != 0xE1 ||
      capability[1] != 0x10 ||
      capability[2] != 0x12 ||
      capability[3] != 0x00) {
    Serial.println("ERROR:TAG_NOT_BLANK_NTAG213");
    return;
  }

  // Schrijf alleen naar een tag waarvan de eerste 48 bytes leeg zijn,
  // zodat we nooit onbekende gegevens overschrijven.
  uint8_t existing[MAX_NDEF_BYTES];

  if (!readPages(existing)) {
    Serial.println("ERROR:READ_FAILED");
    return;
  }

  for (uint8_t i = 0; i < MAX_NDEF_BYTES; i++) {
    if (existing[i] != 0x00) {
      Serial.println("ERROR:TAG_NOT_BLANK");
      return;
    }
  }

  uint8_t data[MAX_NDEF_BYTES] = {0};

  // NDEF-TLV
  data[0] = 0x03;
  data[1] = 5 + suffixLength;

  // NDEF URI-record
  data[2] = 0xD1;
  data[3] = 0x01;
  data[4] = 1 + suffixLength;
  data[5] = 0x55;
  data[6] = 0x04;

  memcpy(data + 7, url + strlen(prefix), suffixLength);

  data[7 + suffixLength] = 0xFE;

  Serial.println("STATUS:WRITING");

  for (uint8_t i = 0; i < USER_PAGE_COUNT; i++) {
    if (!nfc.ntag2xx_WritePage(FIRST_USER_PAGE + i, data + i * 4)) {
      Serial.println("ERROR:WRITE_FAILED");
      return;
    }
  }

  Serial.println("STATUS:VERIFYING");

  uint8_t verify[MAX_NDEF_BYTES];

  if (!readPages(verify)) {
    Serial.println("ERROR:VERIFY_READ_FAILED");
    return;
  }

  if (memcmp(data, verify, MAX_NDEF_BYTES) != 0) {
    Serial.println("ERROR:VERIFY_MISMATCH");
    return;
  }

  Serial.print("SUCCESS:WRITTEN:");
  Serial.println(url);
}

void readUrl() {
  uint8_t uid[7];
  uint8_t uidLength = 0;

  Serial.println("STATUS:WAITING_FOR_TAG");

  if (!readTag(uid, &uidLength)) {
    Serial.println("ERROR:TAG_NOT_FOUND");
    return;
  }

  if (uidLength != 7) {
    Serial.println("ERROR:UNSUPPORTED_TAG");
    return;
  }

  char url[64];

  if (!getNdefUrl(url, sizeof(url))) {
    Serial.println("ERROR:NO_SUPPORTED_NDEF_URL");
    return;
  }

  Serial.print("UID:");
  printUID(uid, uidLength);

  Serial.print("SUCCESS:URL:");
  Serial.println(url);
}

void handleCommand(char *command) {
  if (strcmp(command, "PING") == 0) {
    Serial.println("SUCCESS:PONG");
  }

  else if (strcmp(command, "SCAN") == 0) {
    scanTag();
  }

  else if (strcmp(command, "READ") == 0) {
    readUrl();
  }

  else if (strncmp(command, "WRITE:", 6) == 0) {
    writeUrl(command + 6);
  }

  else {
    Serial.println("ERROR:UNKNOWN_COMMAND");
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  nfc.begin();

  if (!nfc.getFirmwareVersion()) {
    Serial.println("ERROR:PN532_NOT_FOUND");
    while (1) delay(1000);
  }

  if (!nfc.SAMConfig()) {
    Serial.println("ERROR:PN532_CONFIG_FAILED");
    while (1) delay(1000);
  }

  Serial.println("READY:LINKED_NFC");
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '\n' || c == '\r') {
      if (commandIndex > 0) {
        commandBuffer[commandIndex] = '\0';
        handleCommand(commandBuffer);
        commandIndex = 0;
      }
    }

    else if (commandIndex < sizeof(commandBuffer) - 1) {
      commandBuffer[commandIndex++] = c;
    }

    else {
      commandIndex = 0;
      Serial.println("ERROR:COMMAND_TOO_LONG");
    }
  }
}
