# Third-party notices

WordFolio itself is MIT licensed (see `LICENSE`). The offline dictionary it
downloads is **built from third-party data**, and those sources keep their own
licences. This file lists every one of them.

The build pipeline is `tools/build-dict.mjs`; the raw inputs it downloads are
listed in `tools/fetch-sources.mjs`.

---

## ECDICT

English–Chinese dictionary data: definitions, phonetics, part of speech,
Collins/Oxford grading, exam tags, BNC/COCA frequency ranks, and inflection
tables. The Traditional Chinese in WordFolio is produced by converting ECDICT's
Simplified Chinese at build time with `opencc-js` (`s2twp`).

- Source: <https://github.com/skywind3000/ECDICT>
- Files used: `ecdict.csv`, `lemma.en.txt`
- Licence: MIT — Copyright (c) 2025 Linwei

## ipa-dict

British and American IPA transcriptions. ECDICT carries a single phonetic
field; the UK/US pair comes from here.

- Source: <https://github.com/open-dict-data/ipa-dict>
- Files used: `data/en_UK.txt`, `data/en_US.txt`
- Licence: MIT — Copyright (c) 2016 dohliam

## WordNet 3.1

Synonyms, antonyms and the example sentences that appear in WordFolio's offline
`examples` and `synonyms` sections. ECDICT's English `definition` field is also
derived from WordNet.

- Source: <https://wordnet.princeton.edu/>
- Files used: `wn3.1.dict.tar.gz`
- Licence: WordNet 3.1 licence (reproduced in full below, as that licence
  requires)

```
This software and database is being provided to you, the LICENSEE, by
Princeton University under the following license.  By obtaining, using
and/or copying this software and database, you agree that you have
read, understood, and will comply with these terms and conditions.:

Permission to use, copy, modify and distribute this software and
database and its documentation for any purpose and without fee or
royalty is hereby granted, provided that you agree to comply with
the following copyright notice and statements, including the disclaimer,
and that the same appear on ALL copies of the software, database and
documentation, including modifications that you make for internal
use or for distribution.

WordNet 3.1 Copyright 2011 by Princeton University.  All rights reserved.

THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR
IMPLIED.  BY WAY OF EXAMPLE, BUT NOT LIMITATION, PRINCETON
UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES OF MERCHANT-
ABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE
OF THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT
INFRINGE ANY THIRD PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR
OTHER RIGHTS.

The name of Princeton University or Princeton may not be used in
advertising or publicity pertaining to distribution of the software
and/or database.  Title to copyright in this software, database and
any associated documentation shall at all times remain with
Princeton University and LICENSEE agrees to preserve same.
```

---

## Bundled npm dependencies

- **ts-fsrs** — the FSRS spaced-repetition scheduler. MIT.
- **opencc-js** — Simplified → Traditional conversion. Build-time only; it is
  not shipped in `main.js`. MIT.

---

## Looked up on demand, not redistributed

WordFolio can show entries from four websites. Nothing from them is bundled,
built into the dictionary, or re-published: each entry is fetched from the
publisher's own public page **only when you look that word up**, and the result
is cached on your machine so the same word is not fetched twice. Every one of
these sections is a checkbox in the settings, and turning it off stops all
network access to that site.

- Cambridge Dictionary (English–Chinese Traditional) — <https://dictionary.cambridge.org>
- Longman Dictionary of Contemporary English — <https://www.ldoceonline.com>
- Oxford Learner's Dictionaries — <https://www.oxfordlearnersdictionaries.com>
- Wiktionary — <https://en.wiktionary.org> (text under CC BY-SA 4.0)

The content on those sites belongs to their publishers and is subject to their
own terms of use.

## Pronunciation audio

Recorded pronunciation is fetched from Youdao's public `dictvoice` endpoint when
you play it, and cached locally. If that is unavailable, WordFolio falls back to
your operating system's built-in speech synthesis. No audio is bundled.
