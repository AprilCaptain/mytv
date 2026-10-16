import { formatTime, seekBounds, seekTarget, hoverTime } from './player-utils.js';

export function createPlayer(video, stage, actions={}) {
  const $ = id => document.getElementById(id);
  const controls = $('player-controls'), seek = $('player-seek'), tooltip = $('seek-tooltip');
  const toggle = $('player-toggle'), mute = $('player-mute'), volume = $('player-volume');
  const speed = $('player-speed'), quality=$('player-quality'),fullscreen = $('player-fullscreen'), feedback = $('seek-feedback');
  let idleTimer, feedbackTimer, scrubbing = false, controlsHovered = false, speedOpen = false;
  let lastVolume=video.volume||1;
  const bounds = () => seekBounds(video.duration, video.seekable);

  function showControls() {
    stage.classList.remove('controls-idle');clearTimeout(idleTimer);
    const keyboardFocus = controls.contains(document.activeElement) && document.activeElement.matches(':focus-visible');
    if (!video.paused && !video.ended && !controlsHovered && !scrubbing && !speedOpen && !keyboardFocus)
      idleTimer = setTimeout(() => { stage.classList.add('controls-idle');tooltip.hidden = true; }, 2600);
  }
  function announce(text) {
    feedback.textContent = text;feedback.hidden = false;clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => feedback.hidden = true, 1200);showControls();
  }
  function refresh() {
    const range = bounds(), current = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    seek.disabled = !range;
    if (range) {
      seek.min = String(range.start);seek.max = String(range.end);
      if (!scrubbing) seek.value = String(Math.max(range.start, Math.min(range.end, current)));
      const percentage = (current - range.start) / (range.end - range.start) * 100;
      let buffered = current;
      if (video.buffered.length) buffered = video.buffered.end(video.buffered.length - 1);
      seek.style.setProperty('--played', Math.max(0, Math.min(100, percentage)) + '%');
      seek.style.setProperty('--buffered', Math.max(0, Math.min(100, (buffered - range.start) / (range.end - range.start) * 100)) + '%');
    } else { seek.value = '0';seek.style.setProperty('--played', '0%');seek.style.setProperty('--buffered', '0%');tooltip.hidden = true; }
    const time = formatTime(current) + ' / ' + (video.duration === Infinity ? '直播' : formatTime(video.duration));
    $('player-time').textContent = time;seek.setAttribute('aria-valuetext', time);
    toggle.textContent = video.paused ? '▶' : 'Ⅱ';toggle.setAttribute('aria-label', video.paused ? '播放' : '暂停');
    mute.textContent = video.muted || video.volume === 0 ? '∅' : '♪';mute.setAttribute('aria-label', video.muted ? '取消静音' : '静音');
    volume.value = String(video.muted ? 0 : video.volume);speed.value = String(video.playbackRate);
  }
  async function playPause() {
    if (!video.currentSrc) return;
    if (video.paused) try { actions.onPlay?.();await video.play(); } catch { announce('暂时无法播放，请检查线路。'); }
    else video.pause();
    showControls();
  }
  function jump(delta) {
    const value = seekTarget(video.currentTime, delta, bounds());
    if (value === null) return;
    try { actions.onSeek?.();video.currentTime = value;announce((delta < 0 ? '后退' : '前进') + Math.abs(delta) + ' 秒 · ' + formatTime(value));refresh(); } catch {}
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
      else video.webkitEnterFullscreen?.();
    } catch { announce('浏览器暂时无法进入全屏。'); }
    showControls();
  }
  function toggleMute() {
    if(video.muted||video.volume===0){video.muted=false;video.volume=lastVolume;}
    else {lastVolume=video.volume;video.muted=true;}
    refresh();showControls();
  }
  toggle.addEventListener('click', playPause);
  video.addEventListener('click', () => { video.focus();void playPause(); });
  video.addEventListener('dblclick', () => void toggleFullscreen());
  fullscreen.addEventListener('click', () => void toggleFullscreen());
  document.addEventListener('fullscreenchange', () => {
    controlsHovered = controls.matches(':hover');
    fullscreen.setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '全屏');showControls();
  });
  mute.addEventListener('click', toggleMute);
  volume.addEventListener('input', () => { video.volume = Number(volume.value);video.muted = video.volume === 0;if(video.volume>0)lastVolume=video.volume;showControls(); });
  for(const menu of [speed,quality]){
    menu.addEventListener('pointerdown', () => { speedOpen = true;showControls(); });
    menu.addEventListener('blur', () => { speedOpen = false;showControls(); });
    menu.addEventListener('keydown', event => { if (event.key === 'Escape' || event.key === 'Enter') { speedOpen = false;showControls(); } });
  }
  quality.addEventListener('change',()=>{speedOpen=false;actions.onQualityChange?.(quality.value);showControls();});
  speed.addEventListener('change', () => { speedOpen = false;video.defaultPlaybackRate=Number(speed.value);video.playbackRate = Number(speed.value);showControls(); });
  seek.addEventListener('pointerdown', () => { scrubbing = true;showControls(); });
  const endScrubbing = () => { if (scrubbing) { scrubbing = false;refresh();showControls(); } };
  window.addEventListener('pointerup', endScrubbing);
  window.addEventListener('pointercancel', endScrubbing);
  seek.addEventListener('input', () => { if (bounds()) { actions.onSeek?.();video.currentTime = Number(seek.value);refresh();showControls(); } });
  seek.addEventListener('pointermove', event => {
    const rect = seek.getBoundingClientRect(), range = bounds(), time = hoverTime(event.clientX, rect.left, rect.width, range);
    if (time === null) { tooltip.hidden = true;return; }
    tooltip.hidden = false;tooltip.textContent = formatTime(time);
    const half = Math.max(28, tooltip.offsetWidth / 2);
    tooltip.style.left = Math.max(half, Math.min(rect.width - half, event.clientX - rect.left)) + 'px';showControls();
  });
  seek.addEventListener('pointerleave', () => tooltip.hidden = true);
  seek.addEventListener('blur', () => { if (!seek.matches(':hover')) tooltip.hidden = true; });
  stage.addEventListener('pointermove', event => { if (event.target !== speed&&event.target!==quality) speedOpen = false;showControls(); });
  stage.addEventListener('pointerleave', showControls);
  controls.addEventListener('pointerenter', event => { controlsHovered = event.pointerType !== 'touch';showControls(); });
  controls.addEventListener('pointerleave', () => { controlsHovered = false;showControls(); });
  stage.addEventListener('focusin', showControls);
  stage.addEventListener('focusout', () => { queueMicrotask(showControls); });
  stage.addEventListener('keydown', showControls);
  document.addEventListener('keydown', event => {
    if ($('watch-view').hidden || document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target.isContentEditable || target.closest('textarea,select') || target.closest('input') && target !== seek) return;
    const key = event.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowright') { event.preventDefault();jump(key === 'arrowleft' ? -10 : 10); }
    else if ((key === ' ' || key === 'k') && !target.closest('button,a')) { event.preventDefault();void playPause(); }
    else if (key === 'f') { event.preventDefault();void toggleFullscreen(); }
    else if (key === 'm') { event.preventDefault();toggleMute(); }
  });
  for (const name of ['loadedmetadata','durationchange','timeupdate','progress','volumechange','ratechange','play','pause','ended','emptied'])
    video.addEventListener(name, () => { refresh();if (['play','pause','ended'].includes(name)) showControls(); });
  video.controls = false;video.tabIndex = 0;controls.hidden = false;refresh();
  return { reset() { clearTimeout(idleTimer);clearTimeout(feedbackTimer);scrubbing = false;speedOpen = false;controlsHovered = controls.matches(':hover');tooltip.hidden = true;feedback.hidden = true;stage.classList.remove('controls-idle');refresh(); } };
}
