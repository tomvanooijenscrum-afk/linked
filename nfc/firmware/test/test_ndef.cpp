// Host-test voor linked_ndef.h (zonder Arduino of PN532).
// Bouwen en draaien:  c++ -std=c++11 -Wall -Wextra -o /tmp/test_ndef \
//   nfc/firmware/test/test_ndef.cpp && /tmp/test_ndef

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include "../linked_nfc/linked_ndef.h"

static int failures = 0;

#define CHECK(condition)                                              \
  do {                                                                \
    if (!(condition)) {                                               \
      std::printf("FAIL %s:%d  %s\n", __FILE__, __LINE__, #condition); \
      failures++;                                                     \
    }                                                                 \
  } while (0)

static void clear(uint8_t *memory) {
  std::memset(memory, 0, NTAG213_USER_BYTES);
}

int main() {
  uint8_t memory[NTAG213_USER_BYTES];
  char url[LINKED_URL_BUFFER];

  // Leeg geheugen en een lege NDEF-melding gelden allebei als leeg.
  clear(memory);
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_BLANK);
  memory[0] = 0x03;
  memory[1] = 0x00;
  memory[2] = 0xFE;
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_BLANK);

  // Bouwen en teruglezen geven exact dezelfde URL.
  const char *link = "https://linked.example/?t=AbCdEfGhIjKlMnOpQrStUv";
  CHECK(linkedCheckUrl(link) == 0);
  linkedBuildNdef(link, memory);
  CHECK(memory[0] == 0x03);
  CHECK(memory[1] == 5 + std::strlen(link) - 8);
  CHECK(memory[2] == 0xD1 && memory[5] == 0x55 && memory[6] == 0x04);
  CHECK(memory[7 + std::strlen(link) - 8] == 0xFE);
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_URL);
  CHECK(std::strcmp(url, link) == 0);
  CHECK(linkedMatchesUrl(link, memory));
  CHECK(!linkedMatchesUrl("https://linked.example/?t=other", memory));

  // Eén veranderde byte wordt bij de controle opgemerkt.
  memory[20] ^= 0x01;
  CHECK(!linkedMatchesUrl(link, memory));

  // Een langere oude link achter de terminator telt mee bij vergelijken.
  linkedBuildNdef(link, memory);
  memory[100] = 0x41;
  CHECK(!linkedMatchesUrl(link, memory));

  // URL-controles.
  CHECK(std::strcmp(linkedCheckUrl("http://linked.example"), "HTTPS_REQUIRED") == 0);
  CHECK(std::strcmp(linkedCheckUrl("https://"), "INVALID_URL") == 0);
  CHECK(std::strcmp(linkedCheckUrl("https://a b"), "INVALID_URL") == 0);
  std::string longest = "https://" + std::string(LINKED_MAX_URL_SUFFIX, 'a');
  CHECK(linkedCheckUrl(longest.c_str()) == 0);
  linkedBuildNdef(longest.c_str(), memory);
  CHECK(memory[NTAG213_USER_BYTES - 1] == 0xFE);
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_URL);
  CHECK(longest == url);
  std::string tooLong = longest + "a";
  CHECK(std::strcmp(linkedCheckUrl(tooLong.c_str()), "URL_TOO_LONG") == 0);

  // Door een telefoon geschreven tag: andere prefix en een NULL-TLV vooraf.
  clear(memory);
  const uint8_t phone[] = {
    0x00, 0x03, 0x10, 0xD1, 0x01, 0x0C, 0x55, 0x02,
    'e', 'x', 'a', 'm', 'p', 'l', 'e', '.', 'o', 'r', 'g', 0xFE,
  };
  std::memcpy(memory, phone, sizeof(phone));
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_URL);
  CHECK(std::strcmp(url, "https://www.example.org") == 0);

  // Een tekstrecord is geldige NDEF maar geen link.
  clear(memory);
  const uint8_t text[] = {
    0x03, 0x08, 0xD1, 0x01, 0x04, 0x54, 0x02, 'e', 'n', 'x', 0xFE,
  };
  std::memcpy(memory, text, sizeof(text));
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_OTHER);

  // Afgebroken schrijfactie: TLV-lengte loopt voorbij het record.
  clear(memory);
  memory[0] = 0x03;
  memory[1] = 0x30;
  memory[2] = 0xD1;
  memory[3] = 0x01;
  memory[4] = 0x40;
  memory[5] = 0x55;
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_INVALID);

  // Willekeurige rommel zonder NDEF.
  clear(memory);
  memory[0] = 0xFE;
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_INVALID);
  clear(memory);
  memory[0] = 0x03;
  memory[1] = 0xFF;
  CHECK(linkedParseNdef(memory, url, sizeof(url)) == NDEF_INVALID);

  // Te kleine uitvoerbuffer wordt geweigerd in plaats van overschreven.
  linkedBuildNdef(link, memory);
  char tiny[10];
  CHECK(linkedParseNdef(memory, tiny, sizeof(tiny)) == NDEF_INVALID);

  if (failures) {
    std::printf("%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("Passed: NDEF build, parse, verify, limits and foreign tags.\n");
  return 0;
}
