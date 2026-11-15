// NEON RUSH — DOM HUD and screens.
// The 3D scene lives on the WebGL canvas; everything textual lives here as
// DOM, so it stays crisp and readable when a screenshot is shrunk: position,
// lap, speed, boost meter, race time, best lap, position tower, minimap,
// and the menu / countdown / pause / results screens. All blinking is
// driven by the race's fixed frame counter, never wall time.

import { TRACK_POINTS, trackBounds, LAP_COUNT } from './track.js';
import { standings, playerPosition, formatTime } from './race.js';

function ordinal(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

export function createHud() {
  const el = (id) => document.getElementById(id);
  const hud = {
    root: el('hud'),
    pos: el('pos'),
    posTotal: el('pos-total'),
    lap: el('lap'),
    time: el('time'),
    best: el('best'),
    speed: el('speed'),
    boostFill: el('boost-fill'),
    boostLabel: el('boost-label'),
    offTrack: el('offtrack'),
    towerList: el('tower-list'),
    minimap: el('minimap'),
    toast: el('toast'),
    menu: el('menu'),
    menuPress: el('menu-press'),
    countdown: el('countdown'),
    paused: el('paused'),
    results: el('results'),
    resultsTitle: el('results-title'),
    resultsSub: el('results-sub'),
    resultsTable: el('results-table'),
    resultsPress: el('results-press'),
  };
  const mapCtx = hud.minimap.getContext('2d');
  const bounds = trackBounds();

  function drawMinimap(race) {
    const w = hud.minimap.width;
    const h = hud.minimap.height;
    mapCtx.clearRect(0, 0, w, h);
    const scale = Math.min(
      (w - 16) / (bounds.maxX - bounds.minX),
      (h - 16) / (bounds.maxY - bounds.minY),
    );
    const ox = (w - (bounds.maxX - bounds.minX) * scale) / 2;
    const oy = (h - (bounds.maxY - bounds.minY) * scale) / 2;
    const px = (x) => ox + (x - bounds.minX) * scale;
    const py = (y) => oy + (y - bounds.minY) * scale;
    mapCtx.beginPath();
    for (let i = 0; i < TRACK_POINTS.length; i += 1) {
      if (i === 0) mapCtx.moveTo(px(TRACK_POINTS[i].x), py(TRACK_POINTS[i].y));
      else mapCtx.lineTo(px(TRACK_POINTS[i].x), py(TRACK_POINTS[i].y));
    }
    mapCtx.closePath();
    mapCtx.strokeStyle = '#22d3ee';
    mapCtx.lineWidth = 2;
    mapCtx.stroke();
    for (const kart of race.karts) {
      mapCtx.beginPath();
      mapCtx.arc(px(kart.x), py(kart.y), kart.isPlayer ? 5 : 3.5, 0, Math.PI * 2);
      mapCtx.fillStyle = kart.color;
      mapCtx.fill();
      if (kart.isPlayer) {
        mapCtx.strokeStyle = '#ffffff';
        mapCtx.lineWidth = 1.5;
        mapCtx.stroke();
      }
    }
  }

  function drawTower(race) {
    const order = standings(race);
    let html = '';
    order.forEach((kart, i) => {
      const gap = kart.finished
        ? formatTime(kart.finishTime)
        : `L${Math.min(kart.lap + 1, LAP_COUNT)}`;
      html += `<li class="${kart.isPlayer ? 'me' : ''}"><span class="dot" style="background:${kart.color}"></span><span class="tname">${i + 1}. ${kart.name}</span><span class="tgap">${gap}</span></li>`;
    });
    hud.towerList.innerHTML = html;
  }

  function drawResults(race) {
    const order = standings(race);
    const pos = playerPosition(race);
    hud.resultsTitle.textContent =
      pos === 1 ? 'YOU WIN THE NEON LOOP!' : pos <= 3 ? 'PODIUM FINISH!' : 'RACE COMPLETE';
    hud.resultsTitle.className = pos === 1 ? 'gold' : '';
    hud.resultsSub.textContent =
      `You finished ${ordinal(pos)}  ·  Total ${formatTime(race.player.finishTime || race.raceTime)}  ·  Best lap ${formatTime(race.player.bestLap)}`;
    let html = '';
    order.forEach((kart, i) => {
      const right = kart.finished
        ? formatTime(kart.finishTime)
        : `LAP ${Math.min(kart.lap + 1, LAP_COUNT)}`;
      html += `<div class="row ${kart.isPlayer ? 'me' : ''}"><span class="dot" style="background:${kart.color}"></span><span class="rpos">${i + 1}.</span><span class="rname">${kart.name}</span><span class="rlap">Best ${formatTime(kart.bestLap)}</span><span class="rtime">${right}</span></div>`;
    });
    hud.resultsTable.innerHTML = html;
  }

  function blink(race) {
    return Math.sin(race.frame * 0.09) > -0.2;
  }

  return {
    update(race) {
      const state = race.state;
      const inRace = state === 'racing' || state === 'countdown' || state === 'paused';
      hud.root.style.display = inRace ? 'block' : 'none';
      hud.menu.style.display = state === 'menu' ? 'flex' : 'none';
      hud.paused.style.display = state === 'paused' ? 'flex' : 'none';
      hud.results.style.display = state === 'results' ? 'flex' : 'none';

      if (state === 'menu') {
        hud.menuPress.style.opacity = blink(race) ? '1' : '0.15';
        return;
      }
      if (state === 'results') {
        drawResults(race);
        hud.resultsPress.style.opacity = blink(race) ? '1' : '0.15';
        return;
      }

      // Countdown number, big in the middle of the screen.
      if (state === 'countdown') {
        const n = Math.ceil(race.countdownT);
        hud.countdown.style.display = 'block';
        hud.countdown.textContent = n > 0 ? String(n) : 'GO!';
      } else {
        hud.countdown.style.display = 'none';
      }

      // Toast: GO! and mute notices, driven by the race's message timer.
      if (race.messageT > 0 && race.message) {
        hud.toast.style.display = 'block';
        hud.toast.textContent = race.message;
      } else {
        hud.toast.style.display = 'none';
      }

      const player = race.player;
      const pos = playerPosition(race);
      hud.pos.textContent = ordinal(pos);
      hud.pos.className = pos <= 3 ? 'podium' : '';
      hud.posTotal.textContent = `/ ${race.karts.length}`;
      hud.lap.textContent = `LAP ${Math.min(player.lap + 1, LAP_COUNT)}/${LAP_COUNT}`;
      hud.time.textContent = formatTime(race.raceTime);
      hud.best.textContent = `BEST LAP ${formatTime(player.bestLap)}`;
      hud.speed.textContent = String(Math.round(Math.abs(player.speed) * 0.55));
      hud.boostFill.style.width = `${Math.round(player.boostMeter * 100)}%`;
      hud.boostFill.className = player.boostMeter > 0.99 ? 'full' : '';
      hud.boostLabel.textContent = player.drifting
        ? 'DRIFTING…'
        : player.boosting
          ? 'BOOSTING!'
          : 'BOOST [SPACE]';
      hud.offTrack.style.display = player.offTrack ? 'block' : 'none';
      drawTower(race);
      drawMinimap(race);
    },
  };
}
