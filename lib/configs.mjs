export const SELECTED_CONFIG_URL = 'https://raw.githubusercontent.com/AprilCaptain/mytv/main/configs/selected.json';
export const WEB_CONFIG_URL = 'https://raw.githubusercontent.com/AprilCaptain/mytv/main/configs/websites.json';
export const LIBRARY_CONFIG_URL = 'https://raw.githubusercontent.com/AprilCaptain/mytv/main/configs/library.json';
// Local source collections use checked-in snapshots, never remote executable rules.
export const BUILTIN_CONFIGS = [
  { name: '电视', url: 'https://raw.githubusercontent.com/qist/tvbox/master/jsm.json', default: true },
  { name: '综合片库', url: LIBRARY_CONFIG_URL, reference: 'https://github.com/AprilCaptain/mytv/blob/main/docs/SOURCE-EXPANSION.md' },
  { name: '精选点播', url: SELECTED_CONFIG_URL, reference: 'https://github.com/AprilCaptain/mytv/blob/main/docs/SOURCES.md' },
  { name: '网页精选', url: WEB_CONFIG_URL, reference: 'https://github.com/AprilCaptain/mytv/blob/main/docs/WEB-SOURCES.md' },
  { name: '橘子柚', url: 'https://raw.githubusercontent.com/hackyjso/box/main/jzy.txt', reference: 'https://github.com/AprilCaptain/mytv/blob/main/docs/CONFIGS.md' }
];
