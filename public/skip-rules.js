// Pure rules shared by the settings form, persistence validation and player.
export function skipTimeError({ mode, intro, outro }) {
  if (!['position', 'duration'].includes(mode)) return '请选择按位置或按时长跳过。';
  if (![intro, outro].every(n => Number.isInteger(n) && n >= 0 && n <= 7200))
    return '时间必须在 00:00～120:00 之间。';
  if (!intro && !outro) return '请至少设置片头或片尾时间。';
  if (mode === 'position' && intro > 0 && outro > 0 && intro >= outro)
    return '片尾开始位置必须晚于片头结束位置，两个位置不能相同或交叉。';
  return '';
}

export function skipWindows(settings, rule, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const intro = settings.skipIntro && rule.intro > 0 ? rule.intro : null;
  const outro = settings.skipOutro && rule.outro > 0 ?
    (rule.mode === 'duration' ? duration - rule.outro : rule.outro) : null;
  const validIntro = intro !== null && intro > 0 && intro < duration;
  const validOutro = outro !== null && outro > 0 && outro < duration;
  const crossed = validIntro && validOutro && outro <= intro;
  const warnings = [];
  if (intro !== null && !validIntro) warnings.push('片头时间超出本集时长');
  if (outro !== null && !validOutro) warnings.push('片尾时间超出本集时长');
  if (crossed) warnings.push('片头片尾区间相同或交叉，本集不跳过片尾');
  // Keep a valid intro even when the outro is invalid, rather than suppressing both.
  return { introEnd: validIntro ? intro : null, outroStart: validOutro && !crossed ? outro : null, warning: warnings.join('；') };
}
