export const SELECTED_CONFIG_URL = 'https://raw.githubusercontent.com/AprilCaptain/mytv/main/configs/selected.json';
// Keep the original qist choices and add a small source list shipped with My TV.
export const BUILTIN_CONFIGS = [
  { name: '电视', url: 'https://raw.githubusercontent.com/qist/tvbox/master/jsm.json', default: true },
  { name: '精选点播', url: SELECTED_CONFIG_URL, reference: 'https://github.com/AprilCaptain/mytv/blob/main/docs/SOURCES.md' },
  { name: '饭太硬', url: 'http://www.饭太硬.top/tv/', fallbackUrl: 'https://raw.githubusercontent.com/qist/tvbox/master/fty.json', fallbackName: '饭太硬（qist）' },
  { name: 'okjack', url: 'https://jihulab.com/okcaptain/kko/raw/main/ok.txt' },
  { name: '王二小放牛娃', url: 'http://tvbox.王二小放牛娃.xyz' },
  { name: '摸鱼儿', url: 'http://我不是.摸鱼儿.top' },
  { name: '霜辉月明 py', url: 'https://raw.githubusercontent.com/lm317379829/PyramidStore/pyramid/py.json' },
  { name: '小米小爆脾气', url: 'http://xhww.fun/小米/DEMO.json' },
  { name: '南风', url: 'https://agit.ai/Yoursmile7/TVBox/raw/branch/master/XC.json' },
  { name: '神器', url: 'https://神器每日推送.tk/pz.json' },
  { name: '巧技', url: 'http://pandown.pro/tvbox/tvbox.json' },
  { name: 'Ray', url: 'https://100km.top/0' },
  { name: '俊于', url: 'http://home.jundie.top:81/top98.json' },
  { name: '橘子柚', url: 'https://raw.githubusercontent.com/hackyjso/box/main/jzy.txt' },
  { name: '潇洒', url: 'https://raw.githubusercontent.com/qist/tvbox/master/xiaosa/api.json' },
  { name: '饭太硬（qist）', url: 'https://raw.githubusercontent.com/qist/tvbox/master/fty.json' }
];
