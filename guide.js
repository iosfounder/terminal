// tour's guide: true things about real places.
// Every sentence it shows or speaks is quoted from a source, and the source travels with it:
//   places and their stories  -> Wikipedia (geosearch + article introductions)
//   dates, listing, architect  -> Wikidata
//   the area you are in        -> OpenStreetMap's place lookup (Nominatim), then that place's own Wikipedia article
//   photo credits              -> Wikimedia Commons file information
const WP = "https://en.wikipedia.org/w/api.php?format=json&origin=*&";
const CM = "https://commons.wikimedia.org/w/api.php?format=json&origin=*&";
const NOM = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&extratags=1&accept-language=en&";

const places = new Map();                        // pageid -> place
const searched = [];                             // centres already searched, so we never ask twice for the same ground
// things with coordinates that are not places you can stand at: events, battles, disasters, lists, categories
const NOT_PLACE = new Set(["Q1190554", "Q1656682", "Q178561", "Q3839081", "Q2223653", "Q8065", "Q4167836", "Q13406463", "Q1914636", "Q645883", "Q18669875", "Q350604", "Q124734"]);

const rad = d => d * Math.PI / 180;
export const dist = (a, b) => { const R = 6371000, dl = rad(b.lat - a.lat), dn = rad(b.lng - a.lng), x = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const get = async (u, ms = 9000) => { const r = await fetch(u, { signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(r.status); return r.json(); };
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// Wikipedia introductions keep the pronunciation brackets' leftovers, e.g. "Charing Cross ( CHA-ring) is…"; drop only those
const clean = s => (s || "").replace(/\s*\(\s+[^()]*\)/g, "").replace(/\s*\(\s*;?\s*\)/g, "").replace(/\s{2,}/g, " ").trim();
const sentences = (s, n) => { const m = clean(s).match(/[^.!?]+[.!?]+(\s|$)/g) || [clean(s)]; return m.slice(0, n).join("").trim(); };

// Dates, listing, architect, height and what kind of thing it is, asked of Wikidata's query service for exactly
// those five facts (the full records of famous buildings run to megabytes; this answer is a few kilobytes)
const SPARQL = "https://query.wikidata.org/sparql?format=json&query=";
const qid = u => String(u).split("/").pop();
const isoYear = v => { const m = /^(-?)0*(\d+)-/.exec(v || ""); return m ? (m[1] ? -m[2] : +m[2]) : null; };
async function wikidata(ids) {
  const out = new Map();
  await Promise.all(chunks(ids, 50).map(async part => {
    const q = "SELECT ?item ?inc ?archL ?listL ?h ?kind WHERE { VALUES ?item { " + part.map(x => "wd:" + x).join(" ") + " } " +
      "OPTIONAL { ?item wdt:P571 ?inc } OPTIONAL { ?item wdt:P84 ?arch } OPTIONAL { ?item wdt:P1435 ?list } OPTIONAL { ?item wdt:P2048 ?h } OPTIONAL { ?item wdt:P31 ?kind } " +
      'SERVICE wikibase:label { bd:serviceParam wikibase:language "en". ?arch rdfs:label ?archL. ?list rdfs:label ?listL. } }';
    try {
      const j = await get(SPARQL + encodeURIComponent(q), 12000);
      for (const b of j.results.bindings) {
        const id = qid(b.item.value), f = out.get(id) || { kinds: [], year: null, listed: [], architect: [], height: null }; out.set(id, f);
        if (b.inc && f.year == null) f.year = isoYear(b.inc.value);
        if (b.archL && !/^Q\d+$/.test(b.archL.value) && !f.architect.includes(b.archL.value) && f.architect.length < 2) f.architect.push(b.archL.value);
        if (b.listL && !/^Q\d+$/.test(b.listL.value) && !f.listed.includes(b.listL.value)) f.listed.push(b.listL.value);
        if (b.h && f.height == null) f.height = Math.round(+b.h.value);
        if (b.kind) { const k = qid(b.kind.value); if (!f.kinds.includes(k)) f.kinds.push(k); }
      }
    } catch {}
  }));
  return out;
}

function score(p) {                              // how notable: listed, old, a real article, a picture
  let s = 1;
  if (p.listed.length) s += /grade i\b|category a|grade a/i.test(p.listed.join(" ")) ? 4 : 2.5;
  if (p.year != null) s += p.year < 1700 ? 3 : p.year < 1900 ? 2 : 1;
  if ((p.text || "").length > 220) s += 1;
  if (p.img) s += .7;
  return s;
}

// Real places with articles around a point. Results accumulate, so walking only asks for new ground.
export async function near(lat, lng, radius = 1000) {
  const c = { lat, lng }, hit = searched.find(s => s.r >= radius * .8 && dist(s, c) < s.r * .45);
  if (hit) await hit.p;                          // the same ground is already being fetched: wait for it rather than answer with nothing
  else { const s = { lat, lng, r: radius }; searched.push(s); await (s.p = load(lat, lng, radius)); }
  return [...places.values()].map(p => ({ p, d: dist(c, p) })).filter(o => o.d <= radius).sort((a, b) => b.p.score - a.p.score || a.d - b.d).map(o => o.p);
}
async function load(lat, lng, radius) {
    try {
      const g = await get(WP + "action=query&list=geosearch&gslimit=60&gsradius=" + Math.min(10000, Math.round(radius)) + "&gscoord=" + lat + "|" + lng);
      const fresh = (g.query && g.query.geosearch || []).filter(x => !places.has(x.pageid));
      const pages = (await Promise.all(chunks(fresh.map(x => x.pageid), 20).map(part =>
        get(WP + "action=query&prop=extracts|pageprops|pageimages|coordinates&exintro=1&explaintext=1&exsentences=4&exlimit=20&piprop=thumbnail|name&pithumbsize=640&ppprop=wikibase_item&pageids=" + part.join("|"))
          .then(j => Object.values(j.query && j.query.pages || {})).catch(() => [])))).flat();
      const wd = await wikidata(pages.map(p => p.pageprops && p.pageprops.wikibase_item).filter(Boolean));
      for (const p of pages) {
        const co = (p.coordinates || [])[0]; if (!co || !p.extract) continue;
        const q = p.pageprops && p.pageprops.wikibase_item, f = wd.get(q) || { kinds: [], year: null, listed: [], architect: [], height: null };
        if (f.kinds.some(k => NOT_PLACE.has(k))) continue;
        const pl = { id: p.pageid, title: p.title, lat: co.lat, lng: co.lon, text: clean(p.extract), q, img: p.pageimage || null, thumb: p.thumbnail ? p.thumbnail.source : null,
          year: f.year, listed: f.listed, architect: f.architect, height: f.height,
          url: "https://en.wikipedia.org/wiki/" + encodeURIComponent(p.title.replace(/ /g, "_")) };
        pl.score = score(pl); places.set(pl.id, pl);
      }
    } catch {}
}
export const byId = id => places.get(id);
// Places at about a given distance: Wikipedia returns only the nearest 60 to a point, so in a dense city the far ones
// never appear. Search six points on a ring at that distance as well.
export async function ring(lat, lng, d) {
  const kx = 111320 * Math.cos(rad(lat));
  const all = await Promise.all([0, 1, 2, 3, 4, 5].map(i => { const a = i / 6 * 2 * Math.PI; return near(lat + d * Math.cos(a) / 111320, lng + d * Math.sin(a) / kx, Math.min(900, d * .6)); }));
  const out = all.flat(), seen = new Set(); return out.filter(p => !seen.has(p.id) && seen.add(p.id)).sort((a, b) => b.score - a.score);
}

// The short, spoken version and the facts line. Both are built only from the source's own words and values.
export const short = p => sentences(p.text, 2);
export const story = p => sentences(p.text, 4);
export function facts(p) {
  const o = [];
  if (p.year != null) o.push(p.year < 0 ? -p.year + " BC" : String(p.year));
  if (p.listed.length) o.push(p.listed[0]);
  if (p.architect.length) o.push(p.architect.join(", "));
  if (p.height) o.push(p.height + " m");
  return o;
}
export const spoken = p => p.title + ". " + short(p) + (p.year != null && !short(p).includes(String(Math.abs(p.year))) ? " Dating from " + (p.year < 0 ? -p.year + " BC" : p.year) + "." : "");

// Which neighbourhood, village or park you're in, and that place's own first lines
let lastArea = null, areaAt0 = 0;
export async function area(lat, lng) {
  if (lastArea && dist(lastArea, { lat, lng }) < 350) return lastArea.v;
  if (Date.now() - areaAt0 < 20000) return lastArea ? lastArea.v : null;          // the lookup service asks for gentle use
  areaAt0 = Date.now();
  try {
    const j = await get(NOM + "lat=" + lat + "&lon=" + lng);
    if (!/^(suburb|quarter|neighbourhood|village|town|hamlet|city_district|borough|island|isolated_dwelling|locality|square)$/.test(j.addresstype || "")) { areaAt0 = 0; return lastArea ? lastArea.v : null; }   // only real neighbourhoods and villages, not "built-up areas" or regions
    const et = j.extratags || {}, name = j.name || (j.address && (j.address.suburb || j.address.neighbourhood || j.address.village || j.address.town)) || null;
    let line = "", url = null;
    if (et.wikipedia && /^en:/.test(et.wikipedia)) {
      const t = et.wikipedia.slice(3); url = "https://en.wikipedia.org/wiki/" + encodeURIComponent(t.replace(/ /g, "_"));
      try { const k = await get(WP + "action=query&prop=extracts&exintro=1&explaintext=1&exsentences=2&redirects=1&titles=" + encodeURIComponent(t));
        const pg = Object.values(k.query.pages)[0]; line = sentences(pg && pg.extract, 1); } catch {}
    }
    const v = name ? { name, kind: j.addresstype || j.type || "", line, url } : null;
    lastArea = { lat, lng, v }; return v;
  } catch { areaAt0 = 0; return lastArea ? lastArea.v : null; }              // a failed lookup is retried on the next position, not 20 seconds later
}

// Who took the photo and under which licence: shown with every picture
const credits = new Map();
export async function credit(file) {
  if (!file) return null; if (credits.has(file)) return credits.get(file);
  try {
    const j = await get(CM + "action=query&prop=imageinfo&iiprop=extmetadata&titles=File:" + encodeURIComponent(file));
    const ii = Object.values(j.query.pages)[0].imageinfo[0].extmetadata || {};
    const txt = h => (h && h.value ? String(h.value).replace(/<[^>]+>/g, "").trim() : "");
    const c = { by: txt(ii.Artist).slice(0, 60), lic: txt(ii.LicenseShortName), url: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(file) };
    credits.set(file, c); return c;
  } catch { return null; }
}

// Real photographs taken at a spot (Wikimedia Commons, searched by where the photo was taken), with who took them and the licence.
// The place's own article picture comes first when there is one. No stock images, nothing generated.
const shots = new Map();
// The pictures Wikipedia's editors chose for the place's own article come first; photos merely taken nearby only fill gaps
// (left to themselves they are often of events that happened there rather than of the place).
const NOT_PHOTO = /(logo|icon|flag|map|locator|location|symbol|coat[_ ]of[_ ]arms|signature|diagram|plan|commons-|wiki|\.svg)/i;
export async function photos(lat, lng, own, n = 5, radius = 160, article) {
  const k = lat.toFixed(4) + "," + lng.toFixed(4) + "," + (own || "") + "," + (article || ""); if (shots.has(k)) return shots.get(k);
  const txt = h => (h && h.value ? String(h.value).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "");
  const out = [], seen = new Set();
  const add = p => {
    const ii = p.imageinfo && p.imageinfo[0]; if (!ii || seen.has(p.title)) return;
    const m = ii.extmetadata || {}, w = ii.thumbwidth || ii.width, h = ii.thumbheight || ii.height;
    if (!/^image\/(jpeg|png|webp)$/.test(ii.mime || "") || !w || !h || w / h > 2.4 || h / w > 1.9 || (ii.width || 0) < 640) return;   // photographs, not maps, diagrams or slivers
    seen.add(p.title);
    out.push({ src: ii.thumburl || ii.url, by: txt(m.Artist).slice(0, 60), lic: txt(m.LicenseShortName), url: ii.descriptionurl, what: txt(m.ImageDescription).slice(0, 140) });
  };
  const ask = q => get(CM + "action=query&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1080&" + q).then(j => Object.values(j.query && j.query.pages || {})).catch(() => []);
  if (own) (await ask("titles=File:" + encodeURIComponent(own))).forEach(add);
  if (article && out.length < n) {
    try {
      const j = await get(WP + "action=query&prop=images&imlimit=40&redirects=1&titles=" + encodeURIComponent(article));
      const files = Object.values(j.query.pages).flatMap(p => (p.images || []).map(i => i.title)).filter(t => !NOT_PHOTO.test(t)).slice(0, 20);
      if (files.length) (await ask("titles=" + files.map(encodeURIComponent).join("|"))).forEach(add);
    } catch {}
  }
  if (out.length < n) (await ask("generator=geosearch&ggsnamespace=6&ggslimit=20&ggsradius=" + radius + "&ggscoord=" + lat + "|" + lng)).forEach(add);
  const r = out.slice(0, n); shots.set(k, r); return r;
}

// The phone's own voice, with a queue so lines never talk over each other.
// Priority: 3 briefing, 2 a stop's story, 1 everything else. A higher line interrupts a lower one; an equal one waits its turn.
// Each line is spoken a sentence at a time: shorter pieces sound the same, and Chrome otherwise goes quiet after ~15 seconds.
const FEMALE = /female|woman|samantha|serena|kate|martha|stephanie|fiona|moira|tessa|karen|victoria|allison|\bava\b|susan|zoe|libby|sonia|hazel|maisie|\bmia\b|emma|\bamy\b|olivia|aria|jenny|\bsara|zira|catherine|natasha|hollie|abbie|bella|ellie|\bsiri.*female/i;
const MALE = /\bmale\b|daniel|arthur|oliver|george|ryan|thomas|\bguy\b|david|\bmark\b|james|\balex\b|fred|rishi|aaron|\btom\b|gordon|lee\b/i;
const isFemale = v => FEMALE.test(v.name) && !(/\bmale\b/i.test(v.name) && !/female/i.test(v.name));
let voice = null, chosen = null, mode = "always", rate = 1, walking = false, cur = null, q = [], last = null, token = 0;
const rank = v => (isFemale(v) ? 0 : MALE.test(v.name) ? 20 : 10) + (/en-GB/i.test(v.lang) ? 0 : /^en/i.test(v.lang) ? 3 : 50) + (/natural|neural|online|premium|enhanced|google/i.test(v.name) ? 0 : 1);
export function voices() {                       // English voices on this phone, female and British first
  if (!("speechSynthesis" in window)) return [];
  return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .map(v => ({ id: v.voiceURI, name: v.name.replace(/^(Microsoft|Google)\s+/i, "").replace(/\s*-\s*English.*$/i, "").replace(/\s*\(.*\)$/, ""), lang: v.lang, female: isFemale(v) }));
}
const pickVoice = () => {
  const vs = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
  voice = (chosen && vs.find(v => v.voiceURI === chosen)) || vs.filter(v => /^en/i.test(v.lang)).sort((a, b) => rank(a) - rank(b))[0] || null;
};
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.addEventListener("voiceschanged", pickVoice); }
export const voiceName = () => voice ? voice.name : "";
const ok = () => "speechSynthesis" in window && mode !== "off" && (mode === "always" || walking);
export function setVoice(m, r, id) { if (m) mode = m; if (r) rate = r; if (id !== undefined) { chosen = id; pickVoice(); } if (!ok()) hush(); }
export const setWalking = w => { walking = w; if (!ok()) hush(); };
export function prime() {                        // called from a real tap: phones only allow speech once they've seen one
  if (!("speechSynthesis" in window)) return; const u = new SpeechSynthesisUtterance(" "); u.volume = 0; speechSynthesis.speak(u);
}

// Said the way a person would say it; the subtitles show exactly these words
export function speakable(s) {
  return String(s || "")
    .replace(/\[[^\]]*\]/g, "")                                  // footnote marks
    .replace(/\s*\([^()]*\)/g, "")                               // asides in brackets
    .replace(/\bc\.\s?(\d{3,4})/g, "circa $1")
    .replace(/\b(\d{3,4})\s?[–-]\s?(\d{2,4})\b/g, "$1 to $2")
    .replace(/\bSt\.?\s(?=[A-Z])/g, "Saint ")                    // St Paul's
    .replace(/(\b[A-Z][a-z]+)\sSt\b\.?/g, "$1 Street")           // Craven St
    .replace(/\bRd\b\.?/g, "Road").replace(/\bAve\b\.?/g, "Avenue").replace(/\bSq\b\.?/g, "Square")
    .replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").trim();
}
const pieces = s => s.split(/(?<=[.!?]["')\]]?)\s+(?=["'(\[]?[A-Z0-9])/).map(x => x.trim()).filter(Boolean);   // split at a sentence end followed by a new sentence; "0.5 miles" and "2,300" stay whole

const lineFns = [], wordFns = [], idleFns = [];
export const onLine = f => lineFns.push(f);       // a new piece starts: subtitles and slideshow captions
export const onWord = f => wordFns.push(f);       // the word being spoken, where the phone reports it
export const onIdle = f => idleFns.push(f);       // nothing left to say
function next() {
  if (cur) return;
  if (!q.length) { idleFns.forEach(f => f()); return; }
  const it = q[0];
  if (!it.parts) it.parts = pieces(speakable(it.text));
  const part = it.parts.shift(); if (!it.parts.length) q.shift();
  if (!part) { next(); return; }
  const my = ++token, u = new SpeechSynthesisUtterance(part);
  if (voice) u.voice = voice; u.lang = voice ? voice.lang : "en-GB"; u.rate = .98 * rate; u.pitch = 1;
  const done = () => { if (token === my) { clearTimeout(guard); cur = null; next(); } };
  const guard = setTimeout(done, 1200 + part.length * 110 / rate);              // if the phone never says "finished", move on anyway
  u.onend = done; u.onerror = done;
  u.onboundary = e => { if (token === my && e.name !== "sentence") wordFns.forEach(f => f(e.charIndex, e.charLength || 0)); };
  cur = { prio: it.prio, text: part }; last = it.text0 ? it : (it.text0 = it.text, it);
  lineFns.forEach(f => f(part)); speechSynthesis.speak(u);
}
export const busy = () => !!cur || q.length > 0;
export function say(text, on, prio = 1) {
  if (!text || on === false || !ok()) return null;
  if (cur && prio > cur.prio) { q = q.filter(i => i.prio >= prio); token++; cur = null; speechSynthesis.cancel(); }
  else if (cur && prio < cur.prio) return null;                                                      // something more important is talking
  if (q.length < 6) q.push({ text, prio }); next(); return true;
}
export function hush() { q = []; cur = null; token++; if ("speechSynthesis" in window) speechSynthesis.cancel(); idleFns.forEach(f => f()); }
export function skip() { if (!cur) return; token++; cur = null; if (q[0] && q[0].parts) q.shift(); if ("speechSynthesis" in window) speechSynthesis.cancel(); next(); }   // earphones' "next": the rest of this story
export function again() { if (last) { const t = last.text0 || last.text, p = last.prio; hush(); say(t, true, p); } }                 // earphones' "previous"
export const pause = () => { if ("speechSynthesis" in window) speechSynthesis.pause(); };
export const resume = () => { if ("speechSynthesis" in window) speechSynthesis.resume(); };
