import { prayerPoints, verseFor, knownFor } from "./prayer.js";

const LEVELS = [
  { key: "Primary", label: "Primary", color: "var(--primary)", hex: "#2f6db5", on: true },
  { key: "Secondary", label: "Secondary", color: "var(--secondary)", hex: "#c2453d", on: true },
  { key: "Mixed Levels", label: "Mixed levels", color: "var(--mixed)", hex: "#7b4bb3", on: true },
  { key: "Junior College", label: "JC / CI", color: "var(--jc)", hex: "#2d8a6a", on: false },
];
const levelOf = (s) =>
  LEVELS.find((l) => l.key === s.level) ?? (/centralised/i.test(s.level ?? "") ? LEVELS[3] : LEVELS[2]);

const PRAYED_KEY = "prayersg:prayed:schools";
const store = {
  load() {
    try { return new Set(JSON.parse(localStorage.getItem(PRAYED_KEY) || "[]")); } catch { return new Set(); }
  },
  save(set) {
    try { localStorage.setItem(PRAYED_KEY, JSON.stringify([...set])); } catch { /* private mode */ }
  },
};

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const url = (u) => (u && !/^https?:\/\//i.test(u) ? `https://${u}` : u);

const $ = (id) => document.getElementById(id);
const state = {
  schools: [],
  prayed: store.load(),
  levels: new Set(LEVELS.filter((l) => l.on).map((l) => l.key)),
  zone: "",
  query: "",
  hidePrayed: false,
  current: null,
};

// ---------- Map ----------
const SG_BOUNDS = L.latLngBounds([1.144, 103.585], [1.494, 104.13]);
const map = L.map("map", {
  center: [1.3521, 103.8198],
  zoom: 12,
  minZoom: 10,
  zoomSnap: 0.25,
  maxZoom: 19,
  maxBounds: SG_BOUNDS.pad(1),
  zoomControl: false,
  preferCanvas: true,
});
L.control.zoom({ position: "topright" }).addTo(map);
L.tileLayer("https://www.onemap.gov.sg/maps/tiles/Grey/{z}/{x}/{y}.png", {
  detectRetina: true,
  maxZoom: 19,
  minNativeZoom: 11, // OneMap has no tiles below 11; scale those down on small screens
  attribution:
    '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:16px;width:16px;vertical-align:middle"> ' +
    '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> © contributors | ' +
    '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>',
}).addTo(map);

const markers = new Map(); // school name -> circleMarker
const layer = L.layerGroup().addTo(map);

function styleFor(s) {
  const prayed = state.prayed.has(s.name);
  const active = state.current === s;
  return {
    radius: active ? 10 : 6,
    color: prayed ? "#b5832a" : "#ffffff",
    weight: prayed ? 3 : 1.5,
    fillColor: levelOf(s).hex,
    fillOpacity: prayed ? 0.55 : 0.9,
  };
}

function buildMarkers() {
  for (const s of state.schools) {
    const m = L.circleMarker([s.lat, s.lng], styleFor(s))
      .bindTooltip(esc(s.name), { className: "school-tip", direction: "top", offset: [0, -6] })
      .on("click", () => openSchool(s));
    markers.set(s.name, m);
  }
}

// ---------- Filtering ----------
function matches(s) {
  if (!state.levels.has(levelOf(s).key)) return false;
  if (state.zone && s.zone !== state.zone) return false;
  if (state.hidePrayed && state.prayed.has(s.name)) return false;
  if (state.query) {
    const q = state.query.toLowerCase();
    const hay = `${s.name} ${s.area ?? ""} ${s.address ?? ""} ${s.postal}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}
const visible = () => state.schools.filter(matches);

function render() {
  const list = visible();
  layer.clearLayers();
  for (const s of list) layer.addLayer(markers.get(s.name).setStyle(styleFor(s)));

  $("list-count").textContent = `${list.length} school${list.length === 1 ? "" : "s"}`;
  $("list").innerHTML = list
    .map((s, i) => `
      <li data-i="${i}">
        <span class="dot" style="background:${levelOf(s).color}"></span>
        <span class="name">${esc(s.name)}<br><span class="area">${esc(s.area ?? "")}</span></span>
        ${state.prayed.has(s.name) ? '<span class="check" title="Prayed">✓</span>' : ""}
      </li>`)
    .join("");
  $("list").onclick = (e) => {
    const li = e.target.closest("li");
    if (li) openSchool(list[Number(li.dataset.i)]);
  };

  const done = list.filter((s) => state.prayed.has(s.name)).length;
  const total = state.schools.filter((s) => state.levels.has(levelOf(s).key) && (!state.zone || s.zone === state.zone)).length;
  const prayedTotal = state.schools.filter((s) => state.levels.has(levelOf(s).key) && (!state.zone || s.zone === state.zone) && state.prayed.has(s.name)).length;
  $("progress-text").textContent = `Prayed for ${prayedTotal} of ${total} schools`;
  $("progress-fill").style.width = total ? `${(prayedTotal / total) * 100}%` : "0";
  $("pray-through").textContent = done === list.length && list.length
    ? "You've prayed for all of these 🙏"
    : "Pray through these schools";
}

function setupFilters() {
  $("level-chips").innerHTML = LEVELS.map((l) => `
    <button class="chip" data-key="${l.key}" aria-pressed="${state.levels.has(l.key)}">
      <span class="dot" style="background:${l.color}"></span>${l.label}
    </button>`).join("");
  $("level-chips").onclick = (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    const k = b.dataset.key;
    state.levels.has(k) ? state.levels.delete(k) : state.levels.add(k);
    b.setAttribute("aria-pressed", state.levels.has(k));
    render();
  };

  const zones = [...new Set(state.schools.map((s) => s.zone).filter(Boolean))].sort();
  $("zone").insertAdjacentHTML("beforeend", zones.map((z) => `<option>${esc(z)}</option>`).join(""));
  $("zone").onchange = (e) => { state.zone = e.target.value; render(); fitVisible(); };
  $("search").oninput = (e) => { state.query = e.target.value.trim(); render(); };
  $("hide-prayed").onchange = (e) => { state.hidePrayed = e.target.checked; render(); };
  $("pray-through").onclick = () => {
    const list = visible();
    const next = list.find((s) => !state.prayed.has(s.name)) ?? list[0];
    if (next) openSchool(next);
  };
}

function fitVisible() {
  const list = visible();
  if (list.length) map.fitBounds(L.latLngBounds(list.map((s) => [s.lat, s.lng])).pad(0.05), panelPadding());
}
// keep dots clear of the side panel (desktop) or bottom sheet (mobile)
const panelPadding = () =>
  window.innerWidth > 720 ? { paddingTopLeft: [400, 0] } : { paddingBottomRight: [0, window.innerHeight * 0.55] };

// ---------- Detail ----------
function openSchool(s) {
  const prev = state.current;
  state.current = s;
  if (prev) markers.get(prev.name)?.setStyle(styleFor(prev));
  markers.get(s.name)?.setStyle(styleFor(s)).bringToFront();

  const zoom = Math.max(map.getZoom(), 15);
  if (window.innerWidth > 720) {
    // keep the dot clear of the side panel
    const p = map.project([s.lat, s.lng], zoom).subtract([200, 0]);
    map.flyTo(map.unproject(p, zoom), zoom, { duration: 0.6 });
  } else {
    const p = map.project([s.lat, s.lng], zoom).add([0, window.innerHeight * 0.27]);
    map.flyTo(map.unproject(p, zoom), zoom, { duration: 0.6 });
  }

  history.replaceState(null, "", `#school=${slug(s.name)}`);
  renderDetail(s);
}

function renderDetail(s) {
  const prayed = state.prayed.has(s.name);
  const [ref, verse] = verseFor(s);
  const tags = knownFor(s);
  const meta = [s.level, s.area, s.zone && `${s.zone} region`].filter(Boolean).join(" · ");
  const links = [
    s.website && `<a href="${esc(url(s.website))}" target="_blank" rel="noopener">School website ↗</a>`,
    `<a href="https://www.moe.gov.sg/schoolfinder/schooldetail?schoolname=${slug(s.name)}" target="_blank" rel="noopener">MOE SchoolFinder ↗</a>`,
    `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + " Singapore " + s.postal)}" target="_blank" rel="noopener">Directions ↗</a>`,
  ].filter(Boolean).join("");

  const distinctive = (s.distinctive ?? []).map((d) => `<li><strong>${esc(d.kind)}${d.domain ? ` · ${esc(d.domain)}` : ""}</strong>${esc(d.title)}</li>`).join("");
  const more = [
    s.programmes?.length && `<p><strong>MOE programmes:</strong> ${s.programmes.map(esc).join(", ")}</p>`,
    s.ccas?.length && `<p><strong>CCAs:</strong> ${s.ccas.map(esc).join(", ")}</p>`,
    s.motherTongues?.length && `<p><strong>Mother tongue languages:</strong> ${s.motherTongues.map(esc).join(", ")}</p>`,
    s.address && `<p><strong>Address:</strong> ${esc(s.address)}, Singapore ${esc(s.postal)}</p>`,
    s.mrt && `<p><strong>Nearest MRT:</strong> ${esc(s.mrt)}</p>`,
  ].filter(Boolean).join("");

  $("detail-view").innerHTML = `
    <button class="back" id="back">← All schools</button>
    <h2>${esc(s.name)}</h2>
    <p class="meta">${esc(meta)}</p>
    ${tags.length ? `<div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
    <div class="links">${links}</div>

    <blockquote class="verse">${esc(verse)}<cite>${esc(ref)}</cite></blockquote>

    ${distinctive ? `<h3>Known for</h3><ul class="known">${distinctive}</ul>` : ""}

    <h3>Pray for</h3>
    <ul class="prayers">
      ${prayerPoints(s).map((p) => `<li><strong>${esc(p.title)}</strong>${esc(p.text)}</li>`).join("")}
    </ul>

    ${more ? `<details><summary>More about this school</summary>${more}</details>` : ""}

    <div class="actions">
      <button class="primary-btn amen-btn ${prayed ? "done" : ""}" id="amen">${prayed ? "✓ Prayed" : "Amen — I've prayed"}</button>
      <button class="ghost-btn" id="next" title="Next school">Next →</button>
    </div>`;

  $("list-view").hidden = true;
  $("detail-view").hidden = false;
  $("detail-view").scrollTop = 0;

  $("back").onclick = closeDetail;
  $("amen").onclick = () => {
    state.prayed.has(s.name) ? state.prayed.delete(s.name) : state.prayed.add(s.name);
    store.save(state.prayed);
    render();
    renderDetail(s);
    if (state.prayed.has(s.name)) setTimeout(() => goNext(s), 500);
  };
  $("next").onclick = () => goNext(s);
}

function goNext(from) {
  if (state.current !== from) return;
  const list = visible();
  const i = list.indexOf(from);
  const after = [...list.slice(i + 1), ...list.slice(0, Math.max(i, 0))];
  const next = after.find((s) => !state.prayed.has(s.name)) ?? after[0];
  if (next) openSchool(next);
}

function closeDetail() {
  const prev = state.current;
  state.current = null;
  if (prev) markers.get(prev.name)?.setStyle(styleFor(prev));
  history.replaceState(null, "", location.pathname + location.search);
  $("detail-view").hidden = true;
  $("list-view").hidden = false;
  render();
}

// ---------- Boot ----------
async function boot() {
  let data;
  try {
    const res = await fetch("data/schools.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch {
    $("list-view").hidden = true;
    $("empty-view").hidden = false;
    $("progress-text").textContent = "No school data loaded";
    return;
  }
  state.schools = data.schools.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
  buildMarkers();
  setupFilters();
  render();
  fitVisible();

  const m = location.hash.match(/school=([\w-]+)/);
  const linked = m && state.schools.find((s) => slug(s.name) === m[1]);
  if (linked) openSchool(linked);
}

boot();
