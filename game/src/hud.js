// NEON RUSH — DOM HUD and screens.
// The 3D scene lives on the WebGL canvas; everything textual lives here as
// DOM, so it stays crisp and readable when a screenshot is shrunk: position,
// lap, speed, boost meter, race time, best lap, position tower, minimap,
// wind, league points/credits, and the menu / countdown / pause / results /
// season / champion screens. All blinking is driven by the race's fixed
// frame counter, never wall time.

import { TRACK_POINTS, trackBounds, trackVersion, TRACKS, activeTrackIndex } from './track.js';
import { standings, playerPosition, formatTime, championIndex } from './race.js';
import { DIFFICULTIES, UPGRADE_LINES, buyUpgrade } from './league.js';

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
    leagueLine: el('league-line'),
    speed: el('speed'),
    boostFill: el('boost-fill'),
    boostLabel: el('boost-label'),
    offTrack: el('offtrack'),
    wind: el('wind'),
    towerList: el('tower-list'),
    minimap: el('minimap'),
    toast: el('toast'),
    menu: el('menu'),
    menuPress: el('menu-press'),
    menuLeagueNote: el('menu-league-note'),
    countdown: el('countdown'),
    paused: el('paused'),
    results: el('results'),
    resultsTitle: el('results-title'),
    resultsSub: el('results-sub'),
    resultsTable: el('results-table'),
    resultsPress: el('results-press'),
    season: el('season'),
    seasonTitle: el('season-title'),
    seasonSub: el('season-sub'),
    seasonTable: el('season-table'),
    shop: el('shop'),
    seasonPress: el('season-press'),
    champion: el('champion'),
    championTitle: el('champion-title'),
    championSub: el('champion-sub'),
    championTable: el('champion-table'),
    championPress: el('champion-press'),
  };
  const mapCtx = hud.minimap.getContext('2d');
  let mapBounds = null;
  let mapVersion = -1;
  let seasonSig = '';
  // The race object, refreshed every update(); menu/shop buttons mutate
  // its menuSel / league through this reference.
  let raceRef = null;

  // Menu buttons: static HTML, wired once. They write straight into the
  // race's menuSel; the frame loop re-renders the selection classes.
  document.querySelectorAll('#menu [data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!raceRef) return;
      raceRef.menuSel.mode = btn.getAttribute('data-mode');
    });
  });
  document.querySelectorAll('#menu [data-track]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!raceRef) return;
      if (raceRef.menuSel.mode === 'league') return; // league runs all 3 in order
      const i = Number(btn.getAttribute('data-track'));
      if (raceRef.unlocks[i]) raceRef.menuSel.trackIndex = i;
    });
  });
  document.querySelectorAll('#menu [data-diff]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!raceRef) return;
      raceRef.menuSel.difficulty = Number(btn.getAttribute('data-diff'));
    });
  });

  function drawMinimap(race) {
    if (mapVersion !== trackVersion) {
      mapBounds = trackBounds();
      mapVersion = trackVersion;
    }
    const bounds = mapBounds;
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
        : `L${Math.min(kart.lap + 1, race.laps)}`;
      html += `<li class="${kart.isPlayer ? 'me' : ''}"><span class="dot" style="background:${kart.color}"></span><span class="tname">${i + 1}. ${kart.name}</span><span class="tgap">${gap}</span></li>`;
    });
    hud.towerList.innerHTML = html;
  }

  function drawResults(race) {
    const order = standings(race);
    const pos = playerPosition(race);
    const trackName = TRACKS[activeTrackIndex].name;
    if (pos === 1) {
      hud.resultsTitle.textContent = `YOU WIN THE ${trackName}!`;
      hud.resultsTitle.className = 'gold';
    } else if (pos <= 3) {
      hud.resultsTitle.textContent = 'PODIUM FINISH!';
      hud.resultsTitle.className = '';
    } else if (pos === 8) {
      hud.resultsTitle.textContent = 'LAST PLACE — OUT OF THE POINTS — TRY AGAIN';
      hud.resultsTitle.className = 'lost';
    } else {
      hud.resultsTitle.textContent = 'OUT OF THE POINTS — TRY AGAIN';
      hud.resultsTitle.className = 'lost';
    }
    let sub =
      `You finished ${ordinal(pos)}  ·  Total ${formatTime(race.player.finishTime || race.raceTime)}  ·  Best lap ${formatTime(race.player.bestLap)}`;
    if (race.mode === 'league' && race.resultsData) {
      sub += `  ·  +${race.resultsData.points} PTS  ·  +${race.resultsData.credits} CR`;
    }
    hud.resultsSub.textContent = sub;
    let html = '';
    order.forEach((kart, i) => {
      const right = kart.finished
        ? formatTime(kart.finishTime)
        : `LAP ${Math.min(kart.lap + 1, race.laps)}`;
      html += `<div class="row ${kart.isPlayer ? 'me' : ''}"><span class="dot" style="background:${kart.color}"></span><span class="rpos">${i + 1}.</span><span class="rname">${kart.name}</span><span class="rlap">Best ${formatTime(kart.bestLap)}</span><span class="rtime">${right}</span></div>`;
    });
    hud.resultsTable.innerHTML = html;
    if (race.mode === 'league') {
      hud.resultsPress.textContent =
        race.league.raceIndex >= 2
          ? 'PRESS ENTER FOR THE CHAMPION'
          : 'PRESS ENTER FOR SEASON STANDINGS';
    } else {
      hud.resultsPress.textContent = 'PRESS R TO RACE AGAIN';
    }
  }

  function drawSeason(race) {
    const league = race.league;
    hud.seasonTitle.textContent = `SEASON STANDINGS — AFTER RACE ${league.raceIndex + 1}/3`;
    const nextTrack = TRACKS[league.trackOrder[league.raceIndex + 1]];
    hud.seasonSub.textContent =
      `Next: ${nextTrack.name}  ·  Your credits: ${league.credits} CR  ·  Spend them in the garage, then race on`;
    // Championship order: points desc, wins desc.
    const order = race.karts.slice().sort((a, b) => {
      if (league.points[b.id] !== league.points[a.id]) return league.points[b.id] - league.points[a.id];
      return league.wins[b.id] - league.wins[a.id];
    });
    let html = '';
    order.forEach((kart, i) => {
      html += `<div class="row ${kart.isPlayer ? 'me' : ''}"><span class="dot" style="background:${kart.color}"></span><span class="rpos">${i + 1}.</span><span class="rname">${kart.name}</span><span class="rpts">${league.points[kart.id]} PTS</span><span class="rwins">${league.wins[kart.id]} W</span></div>`;
    });
    hud.seasonTable.innerHTML = html;
    // Shop: rebuild only when credits/upgrades/race changed, so a click
    // never lands on an element this frame replaces.
    const sig = `${league.credits}|${league.upgrades.speed}${league.upgrades.handling}${league.upgrades.boost}|${league.raceIndex}`;
    if (sig !== seasonSig) {
      seasonSig = sig;
      let shop = '';
      UPGRADE_LINES.forEach((line, li) => {
        const level = league.upgrades[line.id] || 0;
        const maxed = level >= line.costs.length;
        const cost = maxed ? 0 : line.costs[level];
        const afford = !maxed && league.credits >= cost;
        const pips = '●'.repeat(level) + '○'.repeat(line.costs.length - level);
        shop += `<div class="shop-row"><span class="sname">${line.name}</span><span class="sdesc">${line.desc}</span><span class="spips">${pips}</span><button class="opt-btn sbuy" type="button" data-line="${line.id}" ${maxed || !afford ? 'disabled' : ''}>${maxed ? 'MAX' : `BUY ${cost} CR [${li + 1}]`}</button></div>`;
      });
      hud.shop.innerHTML = shop;
      hud.shop.querySelectorAll('[data-line]').forEach((btn) => {
        btn.addEventListener('click', () => {
          if (raceRef && raceRef.league) buyUpgrade(raceRef.league, btn.getAttribute('data-line'));
        });
      });
    }
  }

  function drawChampion(race) {
    const league = race.league;
    const order = standings(race);
    const champ = championIndex(league, order);
    const champKart = race.karts[champ];
    if (champKart.isPlayer) {
      hud.championTitle.textContent = 'YOU ARE THE NEON LEAGUE CHAMPION!';
      hud.championTitle.className = 'gold';
    } else {
      hud.championTitle.textContent = `${champKart.name} WINS THE LEAGUE`;
      hud.championTitle.className = 'lost';
    }
    hud.championSub.textContent =
      `Final points: ${league.points[champ]}  ·  Wins: ${league.wins[champ]}  ·  Your points: ${league.points[0]} — ${champKart.isPlayer ? 'the trophy is yours' : 'so close — run it back'}`;
    const finalOrder = race.karts.slice().sort((a, b) => {
      if (league.points[b.id] !== league.points[a.id]) return league.points[b.id] - league.points[a.id];
      return league.wins[b.id] - league.wins[a.id];
    });
    let html = '';
    finalOrder.forEach((kart, i) => {
      html += `<div class="row ${kart.isPlayer ? 'me' : ''}"><span class="dot" style="background:${kart.color}"></span><span class="rpos">${i + 1}.</span><span class="rname">${kart.name}</span><span class="rpts">${league.points[kart.id]} PTS</span><span class="rwins">${league.wins[kart.id]} W</span></div>`;
    });
    hud.championTable.innerHTML = html;
  }

  function renderMenu(race) {
    const sel = race.menuSel;
    document.querySelectorAll('#menu [data-mode]').forEach((btn) => {
      btn.classList.toggle('sel', btn.getAttribute('data-mode') === sel.mode);
    });
    document.querySelectorAll('#menu [data-track]').forEach((btn) => {
      const i = Number(btn.getAttribute('data-track'));
      btn.classList.toggle('sel', sel.mode === 'single' && i === sel.trackIndex);
      btn.classList.toggle('locked', sel.mode === 'league' || !race.unlocks[i]);
    });
    document.querySelectorAll('#menu [data-diff]').forEach((btn) => {
      btn.classList.toggle('sel', Number(btn.getAttribute('data-diff')) === sel.difficulty);
    });
    if (sel.mode === 'league') {
      hud.menuLeagueNote.textContent =
        'Neon League: 3 races, one per track · points 25-18-15-12-10-8-6-4 · finish to earn credits, buy upgrades between races';
    } else {
      const track = TRACKS[sel.trackIndex];
      const locked = race.unlocks[sel.trackIndex] ? '' : ' — LOCKED: finish League race 1 to unlock';
      hud.menuLeagueNote.textContent =
        `Single race: ${track.laps} laps on ${track.name} (${track.tagline})${locked}`;
    }
  }

  function blink(race) {
    return Math.sin(race.frame * 0.09) > -0.2;
  }

  function windArrow(w) {
    const mag = Math.hypot(w.x, w.y);
    if (mag < 4) return null;
    const ang = Math.atan2(-w.y, w.x); // screen: +x right, +y plan = up on screen? plan y maps to -z; keep it simple: 8-way by angle
    const dirs = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
    const idx = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    const bars = mag > 12 ? '▮▮▮' : mag > 7 ? '▮▮' : '▮';
    return `WIND ${dirs[idx]} ${bars}`;
  }

  return {
    update(race) {
      raceRef = race;
      const state = race.state;
      const inRace = state === 'racing' || state === 'countdown' || state === 'paused';
      hud.root.style.display = inRace ? 'block' : 'none';
      hud.menu.style.display = state === 'menu' ? 'flex' : 'none';
      hud.paused.style.display = state === 'paused' ? 'flex' : 'none';
      hud.results.style.display = state === 'results' ? 'flex' : 'none';
      hud.season.style.display = state === 'season' ? 'flex' : 'none';
      hud.champion.style.display = state === 'champion' ? 'flex' : 'none';

      if (state === 'menu') {
        renderMenu(race);
        hud.menuPress.style.opacity = blink(race) ? '1' : '0.15';
        return;
      }
      if (state === 'results') {
        drawResults(race);
        hud.resultsPress.style.opacity = blink(race) ? '1' : '0.15';
        return;
      }
      if (state === 'season') {
        drawSeason(race);
        hud.seasonPress.style.opacity = blink(race) ? '1' : '0.15';
        return;
      }
      if (state === 'champion') {
        drawChampion(race);
        hud.championPress.style.opacity = blink(race) ? '1' : '0.15';
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
      hud.lap.textContent = `LAP ${Math.min(player.lap + 1, race.laps)}/${race.laps}`;
      hud.time.textContent = formatTime(race.raceTime);
      hud.best.textContent = `BEST LAP ${formatTime(player.bestLap)}`;
      if (race.mode === 'league' && race.league) {
        hud.leagueLine.style.display = 'block';
        hud.leagueLine.textContent =
          `PTS ${race.league.points[0]} · CR ${race.league.credits} · RACE ${race.league.raceIndex + 1}/3`;
      } else {
        hud.leagueLine.style.display = 'none';
      }
      hud.speed.textContent = String(Math.round(Math.abs(player.speed) * 0.55));
      hud.boostFill.style.width = `${Math.round(player.boostMeter * 100)}%`;
      hud.boostFill.className = player.boostMeter > 0.99 ? 'full' : '';
      hud.boostLabel.textContent = player.drifting
        ? 'DRIFTING…'
        : player.boosting
          ? 'BOOSTING!'
          : 'BOOST [SPACE]';
      hud.offTrack.style.display = player.offTrack ? 'block' : 'none';
      const wind = windArrow(race.wind || { x: 0, y: 0 });
      if (wind && state === 'racing') {
        hud.wind.style.display = 'block';
        hud.wind.textContent = wind;
      } else {
        hud.wind.style.display = 'none';
      }
      drawTower(race);
      drawMinimap(race);
    },
  };
}
