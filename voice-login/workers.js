/* ============================================================================
   AURA Voice Login  —  voice-login/workers.js
   ----------------------------------------------------------------------------
   Default worker directory for the login module. Identity fields only; the
   app's own dataset (web/aura-api.js WORKERS) can be passed in instead since
   it uses the same `match` token shape.

   `match` tokens are what the spoken transcript is searched for: Latin and
   Devanagari name spellings, common ASR misspellings, centre numbers in
   digits and words, and Urdu-script variants (Whisper Tiny sometimes emits
   Hindi audio as Urdu script; these tokens absorb that before the
   transliteration layer runs).

   In production this list is generated from the worker table in db/.
   ============================================================================ */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.AURA_WORKERS = factory(); }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return [
    {
      id: 'AWW_KH_04',
      av: { en: 'M', hi: 'म' },
      name: { en: 'Meera Devi', hi: 'मीरा देवी' },
      centre: 'AWC 04',
      block: { en: 'Khunti, Jharkhand', hi: 'खूंटी, झारखंड' },
      childCount: 26,
      match: ['meera', 'मीरा', '04', 'char', 'chaar', 'चार', 'میرا', 'मीरा देवी', 'मीरादेवी', 'मिर', 'મીરા', 'ચાર', 'മീര', 'നാല്', '4']
    },
    {
      id: 'AWW_MU_12',
      av: { en: 'S', hi: 'सु' },
      name: { en: 'Sunita Kumari', hi: 'सुनीता कुमारी' },
      centre: 'AWC 12',
      block: { en: 'Murhu, Jharkhand', hi: 'मुरहू, झारखंड' },
      childCount: 31,
      match: ['sunita', 'सुनीता', '12', 'barah', 'बारह', 'سنیتا', 'सुनिता', 'सनिता', 'सनीता', 'સુનીતા', 'બાર', 'സുനിത', 'പന്ത്രണ്ട്', '12']
    },
    {
      id: 'AWW_KA_07',
      av: { en: 'P', hi: 'फू' },
      name: { en: 'Phoolmani Devi', hi: 'फूलमणि देवी' },
      centre: 'AWC 07',
      block: { en: 'Karra, Jharkhand', hi: 'कर्रा, झारखंड' },
      childCount: 19,
      match: ['phoolmani', 'phulmani', 'फूलमणि', '07', 'saat', 'सात', 'پھولمنی', 'फूलमनी', 'फुलमनी', 'फूलनी', 'ફૂલમણિ', 'સાત', 'ഫൂൽമണി', 'ഏഴ്', '7']
    },
    {
      id: 'AWW_TO_21',
      av: { en: 'R', hi: 'रे' },
      name: { en: 'Rekha Devi', hi: 'रेखा देवी' },
      centre: 'AWC 21',
      block: { en: 'Torpa, Jharkhand', hi: 'तोरपा, झारखंड' },
      childCount: 24,
      match: ['rekha', 'रेखा', '21', 'ikkis', 'इक्कीस', 'ریکھا', 'रीखा', 'रेका', 'રેખા', 'એકવીસ', 'രേഖ', 'ഇരുപത്തിയൊന്ന്', '21']
    }
  ];
}));
