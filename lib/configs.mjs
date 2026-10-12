export const SELECTED_CONFIG_URL = 'https://raw.githubusercontent.com/AprilCaptain/mytv/main/configs/selected.json';
// Retain configurations with usable catalog/search/media samples checked on 2026-10-12.
export const BUILTIN_CONFIGS = [
  { name: '电视', url: 'https://raw.githubusercontent.com/qist/tvbox/master/jsm.json', default: true },
  { name: '精选点播', url: SELECTED_CONFIG_URL, reference: 'https://github.com/AprilCaptain/mytv/blob/main/docs/SOURCES.md' },
  { name: '橘子柚', url: 'https://raw.githubusercontent.com/hackyjso/box/main/jzy.txt', reference: 'https://github.com/AprilCaptain/mytv/blob/main/docs/CONFIGS.md' }
];
