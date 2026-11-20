/* FRITZ!DECT Thermostat Card – radiator thermostat as a dial with target temperature, window/summer/holiday state,
   schedule, battery and 24-hour history. Works with any climate entity; the extra sensors come from the AVM FRITZ!SmartHome integration.
   MIT License – see LICENSE */
const FTC_VERSION = '1.0.2';
const FTC_LANG = (h) => { const l = ((h && ((h.locale && h.locale.language) || h.language)) || 'en').slice(0, 2); return l === 'de' ? 'de' : 'en'; };
const FTC_I18N = {
  en: { notFound: (e) => `Thermostat ${e} not found`, unavailable: 'unavailable', window: 'Window open', off: 'off', heating: (t) => `heating to ${t}°`, target: (t) => `target ${t}°`, comfort: 'Comfort', eco: 'Eco', offBtn: 'Off', winChip: '🪟 Window open – heating paused', summer: '☀️ Summer mode', holiday: '🧳 Holiday mode', battery: (v) => `🔋 Battery ${v} %`, next: (d, p, t) => `From ${d}: ${p}${t}`, schedule: 'schedule', windowShort: 'Window', h24: (lo, hi) => `last 24 h · ${lo}–${hi} °C`, legend: '— room &nbsp;┄ target', colder: 'colder', warmer: 'warmer', clock: '' },
  de: { notFound: (e) => `Thermostat ${e} nicht gefunden`, unavailable: 'nicht erreichbar', window: 'Fenster offen', off: 'aus', heating: (t) => `heizt auf ${t}°`, target: (t) => `Ziel ${t}°`, comfort: 'Komfort', eco: 'Eco', offBtn: 'Aus', winChip: '🪟 Fenster offen – Heizung pausiert', summer: '☀️ Sommermodus', holiday: '🧳 Urlaubsmodus', battery: (v) => `🔋 Batterie ${v} %`, next: (d, p, t) => `Ab ${d}: ${p}${t}`, schedule: 'Zeitplan', windowShort: 'Fenster', h24: (lo, hi) => `vor 24 Std · ${lo}–${hi} °C`, legend: '— Raum &nbsp;┄ Ziel', colder: 'kälter', warmer: 'wärmer', clock: ' Uhr' },
};
// Entity-ID suffixes of the FRITZ!SmartHome sensors in German and English installations; override with `sensors:`.
const FTC_SUF = {
  battery: ['sensor', ['batterie', 'battery']],
  eco: ['sensor', ['eco_temperatur', 'eco_temperature']],
  comfort: ['sensor', ['komfort_temperatur', 'comfort_temperature']],
  next_time: ['sensor', ['nachste_geplante_anderungszeit', 'next_scheduled_change_time']],
  next_temp: ['sensor', ['nachste_geplante_temperatur', 'next_scheduled_temperature']],
  next_preset: ['sensor', ['nachste_geplante_voreinstellung', 'next_scheduled_preset']],
  window: ['binary_sensor', ['offenes_fenster_erkannt', 'open_window_detected', 'window_open']],
  summer: ['binary_sensor', ['sommermodus', 'summer_mode']],
  holiday: ['binary_sensor', ['urlaubsmodus', 'holiday_mode']],
};
class FritzdectThermostatCard extends HTMLElement {
  static getStubConfig() { return { entity: '' }; }
  setConfig(c) { if (!c || !c.entity) throw new Error('entity (climate) is required'); this._c = c; this._p = c.prefix || c.entity.split('.')[1]; this._pend = null; if (!this.shadowRoot) this.attachShadow({ mode: 'open' }); }
  getCardSize() { return 6; }
  getGridOptions() { return { columns: 12, rows: 'auto', min_columns: 6 }; }
  disconnectedCallback() { clearTimeout(this._tm); }
  _R(p, key) {
    const h = this._hass, own = p === this._p && this._c.sensors && this._c.sensors[key];
    if (own) return h.states[own];
    const [dom, sufs] = FTC_SUF[key];
    for (const s of sufs) { const st = h.states[`${dom}.${p}_${s}`]; if (st) return st; }
    return undefined;
  }
  _rel(p) { return Object.keys(FTC_SUF).map((k) => this._R(p, k)).filter(Boolean); }

  set hass(h) {
    this._hass = h;
    const c = this._c, ids = [c.entity].concat(c.members || []);
    const sig = ids.map((i) => { const s = h.states[i]; return s ? s.state + s.attributes.temperature + s.attributes.current_temperature + s.attributes.preset_mode : '-'; }).join('|') + '#' + [this._p].concat((c.members || []).map((m) => m.split('.')[1])).map((p) => this._rel(p).map((s) => s.state).join(',')).join('|') + FTC_LANG(h);
    if (sig !== this._sig) { this._sig = sig; this._render(); }
    if (!this._busy && (!this._hist || Date.now() - this._hist.t > 600000)) this._load();
  }

  async _load() {
    if (!this._hass.callWS) return; this._busy = true;
    const e = this._c.entity, now = new Date(); let pts = [];
    try {
      const r = await this._hass.callWS({ type: 'history/history_during_period', start_time: new Date(now.getTime() - 864e5).toISOString(), end_time: now.toISOString(), entity_ids: [e], minimal_response: false, no_attributes: false, significant_changes_only: false });
      let la = {};
      pts = ((r && r[e]) || []).map((x) => { const a = x.a || x.attributes || la; la = a; return { t: x.lu != null ? x.lu * 1000 : new Date(x.last_updated).getTime(), c: a.current_temperature == null ? NaN : Number(a.current_temperature), z: Number(a.temperature) }; }).filter((p) => !isNaN(p.c));
    } catch (err) { pts = []; }
    this._hist = { t: Date.now(), pts }; this._busy = false; this._render();
  }

  _set(v) {
    const h = this._hass, e = this._c.entity; this._pend = v; this._render();
    clearTimeout(this._tm); this._tm = setTimeout(() => { h.callService('climate', 'set_temperature', { entity_id: e, temperature: this._pend }); setTimeout(() => { this._pend = null; this._render(); }, 4000); }, 900);
  }

  _render() {
    const h = this._hass, c = this._c; if (!h) return;
    const T = FTC_I18N[FTC_LANG(h)], loc = (h.locale && h.locale.language) || h.language || 'en';
    const s = h.states[c.entity], esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
    const de = (v, d) => (v == null || isNaN(v) ? '–' : Number(v).toLocaleString(loc, { minimumFractionDigits: d == null ? 1 : d, maximumFractionDigits: d == null ? 1 : d }));
    if (!s) { this.shadowRoot.innerHTML = `<ha-card style="padding:14px">${esc(T.notFound(c.entity))}</ha-card>`; return; }
    const R = (p, k) => this._R(p, k), on = (x) => !!x && x.state === 'on', num = (x) => (x && !isNaN(parseFloat(x.state)) ? parseFloat(x.state) : null);
    const a = s.attributes, P = this._p, rmin = Number(a.min_temp), rmax = Number(a.max_temp), lim = isFinite(rmin) && isFinite(rmax) && rmax > rmin, min = lim ? rmin : 8, max = lim ? rmax : 28, mcur = (c.members || []).map((id) => h.states[id] && h.states[id].attributes.current_temperature).filter((v) => v != null).map(Number), cur = a.current_temperature != null ? Number(a.current_temperature) : mcur.length ? mcur.reduce((x, y) => x + y, 0) / mcur.length : NaN, off = s.state === 'off' || s.state === 'unavailable';
    const tgt = this._pend != null ? this._pend : Number(a.temperature), win = on(R(P, 'window')), summer = on(R(P, 'summer')), holiday = on(R(P, 'holiday'));
    const heating = !off && !win && !summer && !isNaN(tgt) && !isNaN(cur) && tgt > cur + 0.2;
    const col = s.state === 'unavailable' ? '#9aa0a6' : win ? '#3d8bd9' : off ? '#9aa0a6' : heating ? '#f4731f' : '#2aa39a';
    const A0 = 135, SW = 270, pol = (deg, r) => { const k = (deg * Math.PI) / 180; return [100 + r * Math.cos(k), 100 + r * Math.sin(k)]; };
    const arc = (fr, to, r) => { const [x1, y1] = pol(fr, r), [x2, y2] = pol(to, r); return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${to - fr > 180 ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; };
    const ang = (v) => A0 + (Math.max(min, Math.min(max, v)) - min) / (max - min) * SW;
    const ticks = []; for (let v = Math.ceil(min / 2) * 2; v <= max; v += 2) { const [x1, y1] = pol(ang(v), 92), [x2, y2] = pol(ang(v), 97); ticks.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="tk"/>`); }
    const cm = !isNaN(cur) ? pol(ang(cur), 80) : null;
    const dial = `<svg viewBox="0 0 200 186" class="dl">
<defs><radialGradient id="kn" cx="40%" cy="32%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e6ea"/></radialGradient></defs>
${ticks.join('')}<path d="${arc(A0, A0 + SW, 80)}" class="tr"/>
${!off && !isNaN(tgt) ? `<path d="${arc(A0, Math.max(A0 + 1, ang(tgt)), 80)}" fill="none" stroke="${col}" stroke-width="11" stroke-linecap="round"${heating ? '><animate attributeName="opacity" values="1;.6;1" dur="2.2s" repeatCount="indefinite"/></path>' : '/>'}` : ''}
<circle cx="100" cy="100" r="64" fill="url(#kn)" stroke="rgba(0,0,0,.10)"/>
${cm ? `<circle cx="${cm[0].toFixed(1)}" cy="${cm[1].toFixed(1)}" r="5" fill="#fff" stroke="#333" stroke-width="2"/>` : ''}
<text x="100" y="${win || off ? 96 : 100}" text-anchor="middle" class="big">${de(cur)}<tspan class="un">°</tspan></text>
<text x="100" y="121" text-anchor="middle" class="sm" fill="${col}">${s.state === 'unavailable' ? T.unavailable : win ? T.window : off ? T.off : heating ? T.heating(de(tgt)) : T.target(de(tgt))}</text>
<text x="34" y="180" class="mm">${de(min, min % 1 ? 1 : 0)}°</text><text x="166" y="180" text-anchor="end" class="mm">${de(max, max % 1 ? 1 : 0)}°</text>
</svg>`;
    const kom = num(R(P, 'comfort')), eco = num(R(P, 'eco')), pm = a.preset_mode;
    const pre = (id, icon, label, t) => `<button class="ps${!off && pm === id ? ' on' : ''}" data-pre="${id}">${icon} ${label}${t != null ? `<small>${de(t)}°</small>` : ''}</button>`;
    const bat = num(R(P, 'battery')), nt = R(P, 'next_time'), ntemp = num(R(P, 'next_temp')), npre = R(P, 'next_preset');
    const chips = [win && ['b', T.winChip], summer && ['g', T.summer], holiday && ['g', T.holiday], bat != null && bat <= (c.battery_low || 15) && ['w', T.battery(de(bat, 0))]].filter(Boolean);
    let next = '';
    if (nt && !isNaN(new Date(nt.state))) { const d = new Date(nt.state), today = d.toDateString() === new Date().toDateString(); next = T.next(`${today ? '' : d.toLocaleDateString(loc, { weekday: 'short' }) + ' '}${d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })}${T.clock}`, { comfort: T.comfort, eco: T.eco }[npre && npre.state] || T.schedule, ntemp != null ? ' ' + de(ntemp) + '°' : ''); }
    const mem = (c.members || []).map((id) => { const m = h.states[id]; if (!m) return ''; const p = id.split('.')[1], mb = num(R(p, 'battery')), mw = on(R(p, 'window')); return `<div class="mr" data-e="${esc(id)}"><span>🌡️ ${esc(m.attributes.friendly_name || id)}</span><b>${de(Number(m.attributes.current_temperature))}°</b>${mw ? `<i class="b">${T.windowShort}</i>` : ''}${mb != null ? `<i class="${mb <= (c.battery_low || 15) ? 'w' : ''}">🔋 ${de(mb, 0)} %</i>` : ''}</div>`; }).join('');
    let chart = '';
    const pts = this._hist ? this._hist.pts : null;
    if (pts && pts.length > 1) {
      const W = 300, H = 62, t0 = Date.now() - 864e5, vs = pts.flatMap((p) => [p.c, isNaN(p.z) ? p.c : p.z]), lo = Math.floor(Math.min(...vs) - 0.5), hi = Math.ceil(Math.max(...vs) + 0.5);
      const X = (t) => Math.max(0, ((t - t0) / 864e5) * W), Y = (v) => 4 + (1 - (v - lo) / (hi - lo)) * (H - 8);
      let zp = ''; pts.forEach((p, i) => { if (isNaN(p.z)) return; zp += (zp ? ` L${X(p.t).toFixed(1)},${Y(pts[i - 1] && !isNaN(pts[i - 1].z) ? pts[i - 1].z : p.z).toFixed(1)} L` : 'M') + `${X(p.t).toFixed(1)},${Y(p.z).toFixed(1)}`; });
      const last = pts[pts.length - 1];
      chart = `<div class="cw" data-e="${esc(c.entity)}"><svg viewBox="0 0 ${W} ${H}" class="ch" preserveAspectRatio="none">${zp ? `<path d="${zp} L${W},${Y(isNaN(last.z) ? last.c : last.z).toFixed(1)}" class="zl"/>` : ''}<polyline points="${pts.map((p) => X(p.t).toFixed(1) + ',' + Y(p.c).toFixed(1)).join(' ')} ${W},${Y(last.c).toFixed(1)}" class="cl" stroke="${col}"/></svg><div class="xl"><span>${T.h24(lo, hi)}</span><span>${T.legend}</span></div></div>`;
    }
    this.shadowRoot.innerHTML = `<style>
ha-card{display:block;padding:14px;overflow:hidden}
.hd{display:flex;justify-content:space-between;align-items:center}.tt{font-size:18px}
.wrap{position:relative;max-width:250px;margin:0 auto}
.dl{width:100%;display:block;cursor:pointer}
.tr{fill:none;stroke:rgba(127,127,127,.22);stroke-width:11;stroke-linecap:round}.tk{stroke:rgba(127,127,127,.45);stroke-width:1.2}
.big{font-size:40px;font-weight:700;fill:#22262b;font-variant-numeric:tabular-nums}.un{font-size:22px}.sm{font-size:12.5px;font-weight:600}.mm{font-size:10px;fill:var(--secondary-text-color,#888)}
.pm{position:absolute;left:0;right:0;bottom:2px;display:flex;justify-content:center;gap:44px}
button{font:inherit;border:none;cursor:pointer;color:var(--primary-text-color,#222)}
.rb{width:42px;height:42px;border-radius:50%;font-size:24px;line-height:1;background:rgba(127,127,127,.16)}.rb:active{background:rgba(127,127,127,.35)}
.prs{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:8px}
.ps{font-size:12.5px;padding:6px 12px;border-radius:99px;background:rgba(127,127,127,.14)}.ps small{margin-left:5px;opacity:.75}.ps.on{background:${col};color:#fff}
.cps{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:10px}.cp{font-size:12.5px;padding:4px 10px;border-radius:99px;font-weight:600}
.cp.b{background:rgba(61,139,217,.16);color:#1f6fb8}.cp.g{background:rgba(127,127,127,.16)}.cp.w{background:rgba(255,179,0,.22);color:#9a6700}
.nx{text-align:center;font-size:12.5px;color:var(--secondary-text-color,#666);margin-top:8px}
.mr{display:flex;gap:8px;align-items:center;font-size:13px;padding:6px 0;border-top:1px solid var(--divider-color,#e3e3e3);cursor:pointer}.mr span{flex:1}.mr i{font-style:normal;font-size:11.5px;padding:2px 7px;border-radius:99px;background:rgba(127,127,127,.14)}.mr i.w{background:rgba(255,179,0,.22);color:#9a6700}.mr i.b{background:rgba(61,139,217,.16);color:#1f6fb8}
.ms{margin-top:10px}
.cw{margin-top:10px;cursor:pointer}.ch{width:100%;height:62px;display:block}.cl{fill:none;stroke-width:2;vector-effect:non-scaling-stroke}.zl{fill:none;stroke:var(--secondary-text-color,#888);stroke-width:1.2;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}
.xl{display:flex;justify-content:space-between;font-size:10.5px;color:var(--secondary-text-color,#666)}
</style><ha-card><div class="hd"><div class="tt">${esc(c.title || a.friendly_name || '')}</div></div>
<div class="wrap">${dial}<div class="pm"><button class="rb" data-d="-0.5" aria-label="${T.colder}">−</button><button class="rb" data-d="0.5" aria-label="${T.warmer}">+</button></div></div>
<div class="prs">${pre('comfort', '☀️', T.comfort, kom)}${pre('eco', '🌙', T.eco, eco)}<button class="ps${off ? ' on' : ''}" data-pre="off">⏻ ${T.offBtn}</button></div>
${chips.length ? `<div class="cps">${chips.map((x) => `<span class="cp ${x[0]}">${x[1]}</span>`).join('')}</div>` : ''}
${next ? `<div class="nx">🕒 ${esc(next)}</div>` : ''}
${mem ? `<div class="ms">${mem}</div>` : ''}${chart}</ha-card>`;
    const Q = this.shadowRoot, more = (id) => this.dispatchEvent(new CustomEvent('hass-more-info', { detail: { entityId: id }, bubbles: true, composed: true }));
    Q.querySelectorAll('.rb').forEach((b) => b.addEventListener('click', () => { const base = isNaN(tgt) ? (isNaN(cur) ? 20 : Math.round(cur * 2) / 2) : tgt; this._set(Math.max(min, Math.min(max, base + Number(b.dataset.d)))); }));
    Q.querySelectorAll('.ps').forEach((b) => b.addEventListener('click', () => { const p = b.dataset.pre; if (p === 'off') h.callService('climate', 'set_hvac_mode', { entity_id: c.entity, hvac_mode: off ? 'heat' : 'off' }); else h.callService('climate', 'set_preset_mode', { entity_id: c.entity, preset_mode: p }); }));
    Q.querySelectorAll('[data-e]').forEach((e) => e.addEventListener('click', () => more(e.dataset.e)));
    Q.querySelector('.dl').addEventListener('click', () => more(c.entity));
  }
}
if (!customElements.get('fritzdect-thermostat-card')) customElements.define('fritzdect-thermostat-card', FritzdectThermostatCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'fritzdect-thermostat-card')) window.customCards.push({ type: 'fritzdect-thermostat-card', name: 'FRITZ!DECT Thermostat Card', description: 'Radiator thermostat as a dial with window, summer and holiday state, schedule and history' });
console.info(`%c FRITZDECT-THERMOSTAT-CARD %c ${FTC_VERSION} `, 'color:#fff;background:#f4731f;font-weight:700', 'color:#f4731f;background:#fff');
