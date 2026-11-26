// Linked NDEF: bouwt en leest één NDEF URI-record in NTAG213-geheugen.
//
// Pure functies zonder Arduino-afhankelijkheden, zodat ze ook op een
// gewone computer getest kunnen worden (zie ../test/test_ndef.cpp).
//
// Indeling die wij schrijven (vanaf pagina 4, byte 0):
//   03 LL            NDEF-TLV met lengte LL
//   D1 01 PL 55 04   kort, well-known URI-record, prefix 0x04 = "https://"
//   <url zonder https://>
//   FE               terminator-TLV
//   00 ...           rest van het geheugen

#ifndef LINKED_NDEF_H
#define LINKED_NDEF_H

#include <stddef.h>
#include <stdint.h>
#include <string.h>

// NTAG213: pagina 4 t/m 39 = 36 pagina's = 144 bytes gebruikersgeheugen.
#define NTAG213_FIRST_USER_PAGE 4
#define NTAG213_USER_PAGES 36
#define NTAG213_USER_BYTES 144

// TLV (2) + recordkop (5) + terminator (1) = 8 bytes overhead.
#define LINKED_NDEF_OVERHEAD 8
#define LINKED_MAX_URL_SUFFIX (NTAG213_USER_BYTES - LINKED_NDEF_OVERHEAD)

// Genoeg voor de langste prefix ("https://www.") + inhoud + '\0'.
#define LINKED_URL_BUFFER (NTAG213_USER_BYTES + 16)

static const char LINKED_HTTPS[] = "https://";
#define LINKED_HTTPS_LENGTH 8

// Resultaat van het uitlezen van het gebruikersgeheugen.
enum LinkedNdefState {
  NDEF_BLANK = 0,    // alleen nullen, of een lege NDEF-TLV (03 00 FE)
  NDEF_URL = 1,      // één ondersteund URI-record gevonden
  NDEF_OTHER = 2,    // geldige NDEF, maar geen ondersteund URI-record
  NDEF_INVALID = 3,  // onleesbare of afgebroken inhoud
};

// Alleen zichtbare ASCII; geen spaties of stuurtekens op de tag.
static inline bool linkedIsUrlChar(char c) {
  return c > 0x20 && c < 0x7F;
}

// Geeft 0 terug als de URL past, anders een foutcode-tekst.
static inline const char *linkedCheckUrl(const char *url) {
  if (strncmp(url, LINKED_HTTPS, LINKED_HTTPS_LENGTH) != 0) {
    return "HTTPS_REQUIRED";
  }

  size_t suffixLength = strlen(url) - LINKED_HTTPS_LENGTH;

  if (suffixLength == 0) return "INVALID_URL";
  if (suffixLength > LINKED_MAX_URL_SUFFIX) return "URL_TOO_LONG";

  for (size_t i = LINKED_HTTPS_LENGTH; url[i] != '\0'; i++) {
    if (!linkedIsUrlChar(url[i])) return "INVALID_URL";
  }

  return 0;
}

// De verwachte byte op positie `index` voor deze URL. Zo hoeven we geen
// tweede buffer van 144 bytes te bewaren (de Uno heeft 2 KB SRAM).
// Ga ervan uit dat linkedCheckUrl(url) al 0 gaf.
static inline uint8_t linkedExpectedByte(const char *url, size_t index) {
  const char *suffix = url + LINKED_HTTPS_LENGTH;
  size_t suffixLength = strlen(suffix);

  switch (index) {
    case 0: return 0x03;
    case 1: return (uint8_t)(5 + suffixLength);
    case 2: return 0xD1;
    case 3: return 0x01;
    case 4: return (uint8_t)(1 + suffixLength);
    case 5: return 0x55;
    case 6: return 0x04;
  }

  if (index < 7 + suffixLength) return (uint8_t)suffix[index - 7];
  if (index == 7 + suffixLength) return 0xFE;
  return 0x00;
}

static inline void linkedBuildNdef(const char *url, uint8_t *memory) {
  for (size_t i = 0; i < NTAG213_USER_BYTES; i++) {
    memory[i] = linkedExpectedByte(url, i);
  }
}

static inline bool linkedMatchesUrl(const char *url, const uint8_t *memory) {
  for (size_t i = 0; i < NTAG213_USER_BYTES; i++) {
    if (memory[i] != linkedExpectedByte(url, i)) return false;
  }
  return true;
}

// URI-prefixcodes uit de NFC Forum URI RTD (de meestgebruikte).
static inline const char *linkedUriPrefix(uint8_t code) {
  switch (code) {
    case 0x00: return "";
    case 0x01: return "http://www.";
    case 0x02: return "https://www.";
    case 0x03: return "http://";
    case 0x04: return "https://";
    case 0x05: return "tel:";
    case 0x06: return "mailto:";
  }
  return 0;
}

// Leest het gebruikersgeheugen. Bij NDEF_URL staat de volledige URL
// (met prefix) in `url`. Slaat NULL-, Lock- en Memory-control-TLV's over.
static inline LinkedNdefState linkedParseNdef(
  const uint8_t *memory,
  char *url,
  size_t urlSize
) {
  if (urlSize > 0) url[0] = '\0';

  bool allZero = true;
  for (size_t i = 0; i < NTAG213_USER_BYTES; i++) {
    if (memory[i] != 0x00) {
      allZero = false;
      break;
    }
  }
  if (allZero) return NDEF_BLANK;

  size_t position = 0;

  while (position < NTAG213_USER_BYTES) {
    uint8_t type = memory[position];

    if (type == 0x00) {  // NULL-TLV
      position++;
      continue;
    }
    if (type == 0xFE) return NDEF_INVALID;  // terminator zonder NDEF
    if (position + 1 >= NTAG213_USER_BYTES) return NDEF_INVALID;

    uint8_t length = memory[position + 1];
    // Een lengte van 0xFF betekent een 3-byte lengte: past niet in 144 bytes.
    if (length == 0xFF) return NDEF_INVALID;

    if (type != 0x03) {  // Lock/Memory-control of onbekend: overslaan
      position += 2 + length;
      continue;
    }

    if (length == 0) return NDEF_BLANK;  // lege NDEF-melding

    size_t start = position + 2;
    if (start + length > NTAG213_USER_BYTES) return NDEF_INVALID;
    if (length < 4) return NDEF_INVALID;

    const uint8_t *record = memory + start;
    uint8_t header = record[0];
    bool isShort = header & 0x10;
    bool hasId = header & 0x08;
    uint8_t tnf = header & 0x07;

    if (!isShort) return NDEF_OTHER;

    uint8_t typeLength = record[1];
    uint8_t payloadLength = record[2];
    size_t typeStart = 3 + (hasId ? 1 : 0);
    uint8_t idLength = hasId ? record[3] : 0;
    size_t payloadStart = typeStart + typeLength + idLength;

    if (payloadStart + payloadLength > length) return NDEF_INVALID;

    bool isUri =
      tnf == 0x01 && typeLength == 1 && record[typeStart] == 0x55;
    if (!isUri || payloadLength < 1) return NDEF_OTHER;

    const char *prefix = linkedUriPrefix(record[payloadStart]);
    if (!prefix) return NDEF_OTHER;

    size_t prefixLength = strlen(prefix);
    size_t restLength = payloadLength - 1;
    if (prefixLength + restLength + 1 > urlSize) return NDEF_INVALID;

    memcpy(url, prefix, prefixLength);
    for (size_t i = 0; i < restLength; i++) {
      char c = (char)record[payloadStart + 1 + i];
      if (!linkedIsUrlChar(c)) {
        url[0] = '\0';
        return NDEF_INVALID;
      }
      url[prefixLength + i] = c;
    }
    url[prefixLength + restLength] = '\0';
    return NDEF_URL;
  }

  return NDEF_INVALID;
}

#endif
