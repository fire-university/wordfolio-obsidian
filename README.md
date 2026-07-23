# WordFolio

Offline English–Traditional Chinese dictionary for Obsidian.

Hover any English word to see UK/US phonetics, pronunciation and a Traditional
Chinese definition — **fully offline**. Save words to a Markdown vocabulary
notebook and review them with FSRS spaced repetition.

## Why another dictionary plugin

Every Chinese-facing dictionary plugin for Obsidian routes through Youdao, so
they all give **Simplified** Chinese, and they all need a network connection.
The offline ones (WordNet-based) are English–English only. And the ones that
save your words either lock them in IndexedDB, where they never reach your
vault, or call a repeating timer "spaced repetition".

WordFolio is the combination nobody ships:

|                       | WordFolio | Fingertip Translation | Dictionary (phibr0) | Language Learner | Dictionary Lexicon |
| --------------------- | :-------: | :-------------------: | :-----------------: | :--------------: | :----------------: |
| Traditional Chinese   |     ✓     |           —           |          —          |        —         |         —          |
| Works offline         |     ✓     |           —           |       partial       |        —         |         ✓          |
| UK + US phonetics     |     ✓     |           ✓           |          —          |        —         |         —          |
| UK + US pronunciation |     ✓     |           ✓           |          —          |        —         |         —          |
| Vocabulary in Markdown|     ✓     |           —           |          —          |        —         |         ✓          |
| Real spaced repetition|     ✓     |           —           |     via plugin      |    via plugin    |    timer only      |

## Data

- **[ECDICT](https://github.com/skywind3000/ECDICT)** (MIT) — definitions, word
  frequency (BNC/COCA), Collins/Oxford grading, exam tags, inflections.
  Converted to Traditional Chinese at build time with
  [opencc-js](https://github.com/nk2028/opencc-js) `s2twp`.
- **[ipa-dict](https://github.com/open-dict-data/ipa-dict)** (MIT) — separate
  UK and US IPA.
- Pronunciation audio is fetched once from Youdao's `dictvoice` endpoint and
  cached in the plugin folder; the system voice covers anything not cached.

The shipped dictionary is 59,137 entries and 17.9 MB, split into per-letter
shards so a lookup only ever parses one small file.

## Development

```bash
npm install
npm run fetch:sources   # ~73 MB into vendor/ (gitignored)
npm run build:dict      # → dict/
npm test                # dictionary + scheduling checks
npm run deploy          # build and copy into your vault
```

`npm run deploy` writes to the Obsidian vault at the default iCloud path; set
`WORDFOLIO_VAULT` to point somewhere else.

## Licence

MIT
