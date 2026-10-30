#!/usr/bin/env node
// Builds data/schools.json from MOE's School Directory on data.gov.sg,
// geocoding each school's postal code with OneMap (Singapore Land Authority).
//
//   node scripts/build-schools.mjs
//
// Needs Node 18+ (global fetch). Optional env: DATA_GOV_SG_API_KEY.
// Geocodes are cached in data/geocode-cache.json so reruns are quick.

import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT = new URL("../data/schools.json", import.meta.url);
const CACHE = new URL("../data/geocode-cache.json", import.meta.url);

// "General information of schools" (MOE)
const GENERAL_INFO_ID = "d_688b934f82c1059ed0a6993d2a829089";
// "School Directory and Information" collection, which also holds the
// CCA, subjects, MOE programmes and distinctive programmes datasets.
const MOE_COLLECTION_ID = "457";

const headers = process.env.DATA_GOV_SG_API_KEY
  ? { "x-api-key": process.env.DATA_GOV_SG_API_KEY }
  : {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * 2 ** i);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} for ${url}`);
  }
  throw new Error(`Gave up after ${tries} tries: ${url}`);
}

async function fetchDataset(id) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const url = `https://data.gov.sg/api/action/datastore_search?resource_id=${id}&limit=1000&offset=${offset}`;
    const { result } = await getJson(url);
    rows.push(...result.records);
    if (rows.length >= result.total || result.records.length === 0) break;
  }
  return rows;
}

// Returns [{ id, name }] for the collection's datasets, or [] if unavailable.
async function collectionDatasets(collectionId) {
  try {
    const meta = await getJson(
      `https://api-production.data.gov.sg/v2/public/api/collections/${collectionId}/metadata`
    );
    const ids = meta?.data?.collectionMetadata?.childDatasets ?? [];
    const out = [];
    for (const id of ids) {
      const m = await getJson(
        `https://api-production.data.gov.sg/v2/public/api/datasets/${id}/metadata`
      );
      out.push({ id, name: (m?.data?.name ?? "").toLowerCase() });
    }
    return out;
  } catch (err) {
    console.warn(`! Could not list collection ${collectionId}: ${err.message}`);
    return [];
  }
}

const clean = (v) => {
  const s = String(v ?? "").trim();
  return s === "" || s.toLowerCase() === "na" ? null : s;
};
const titleCase = (s) =>
  s && s.toLowerCase().replace(/(^|[\s(\-/.&])([a-z])/g, (_, p, c) => p + c.toUpperCase()).replace(/\b(Moe|Sap|Ip|Ite|Jc)\b/g, (w) => w.toUpperCase());
const keyOf = (name) => String(name ?? "").trim().toUpperCase();
const yes = (v) => String(v ?? "").trim().toLowerCase() === "yes";

async function geocode(postal, cache) {
  if (cache[postal]) return cache[postal];
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postal}&returnGeom=Y&getAddrDetails=N&pageNum=1`;
  const data = await getJson(url);
  const hit = data.results?.[0];
  if (!hit) return null;
  const ll = [Number(hit.LATITUDE), Number(hit.LONGITUDE)];
  cache[postal] = ll;
  await sleep(250); // stay well under OneMap's rate limit
  return ll;
}

function groupBy(rows, nameCol, pick) {
  const map = new Map();
  for (const r of rows) {
    const k = keyOf(r[nameCol]);
    const v = pick(r);
    if (!k || !v) continue;
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(v);
  }
  return map;
}

async function main() {
  console.log("Fetching MOE general information of schools…");
  const general = await fetchDataset(GENERAL_INFO_ID);
  console.log(`  ${general.length} schools`);

  // Optional enrichment: what each school is known for.
  const extras = await collectionDatasets(MOE_COLLECTION_ID);
  const find = (word) => extras.find((d) => d.name.includes(word) && d.id !== GENERAL_INFO_ID);
  const load = async (word) => {
    const d = find(word);
    if (!d) return [];
    console.log(`Fetching ${d.name}…`);
    const rows = await fetchDataset(d.id).catch((e) => (console.warn(`! ${e.message}`), []));
    console.log(`  ${rows.length} rows; columns: ${Object.keys(rows[0] ?? {}).join(", ")}`);
    return rows;
  };
  // Column names vary between dataset versions, so match by pattern.
  const col = (rows, ...patterns) => {
    const keys = Object.keys(rows[0] ?? {});
    for (const re of patterns) {
      const k = keys.find((key) => re.test(key));
      if (k) return k;
    }
    return null;
  };
  const [ccaRows, progRows, distinctRows] = [
    await load("co-curricular"),
    await load("moe programmes"),
    await load("distinctive"),
  ];

  const nameCol = (rows) => col(rows, /^school_name$/i, /school.*name/i) ?? "school_name";
  const ccaCol = col(ccaRows, /cca_customi[sz]ed_name/i, /cca_generic_name/i, /cca.*name/i, /^cca/i);
  const ccas = groupBy(ccaRows, nameCol(ccaRows), (r) => titleCase(clean(r[ccaCol])));
  const progCol = col(progRows, /programme_desc/i, /programme/i);
  const programmes = groupBy(progRows, nameCol(progRows), (r) => clean(r[progCol]));

  // Distinctive programmes: ALP (Applied Learning) and LLP (Learning for Life)
  // columns such as alp_domain/alp_title, llp_domain1/llp_title1, …
  const distinctCols = Object.keys(distinctRows[0] ?? {})
    .map((k) => k.match(/^(alp|llp)_title(\d*)$/i))
    .filter(Boolean);
  const distinctName = nameCol(distinctRows);
  const distinctive = new Map();
  for (const r of distinctRows) {
    const k = keyOf(r[distinctName]);
    const items = distinctive.get(k) ?? [];
    for (const [key, kind, n] of distinctCols) {
      const title = clean(r[key]);
      if (title && !items.some((i) => i.title === title))
        items.push({ kind: kind.toUpperCase(), domain: clean(r[`${kind}_domain${n}`]), title });
    }
    if (items.length) distinctive.set(k, items);
  }
  console.log(
    `Enrichment: CCAs for ${ccas.size} schools (column ${ccaCol}), programmes for ${programmes.size}, ` +
      `distinctive programmes for ${distinctive.size} (columns ${distinctCols.map((m) => m[0]).join(", ") || "none"})`
  );

  const cache = JSON.parse(await readFile(CACHE, "utf8").catch(() => "{}"));
  const schools = [];
  let missing = 0;
  for (const r of general) {
    const postal = String(r.postal_code ?? "").trim().padStart(6, "0");
    const ll = await geocode(postal, cache).catch(() => null);
    if (!ll) {
      missing++;
      console.warn(`! No location for ${r.school_name} (${postal})`);
      continue;
    }
    const k = keyOf(r.school_name);
    const vps = ["first", "second", "third", "fourth", "fifth", "sixth"]
      .map((n) => titleCase(clean(r[`${n}_vp_name`])))
      .filter(Boolean);
    schools.push({
      name: titleCase(clean(r.school_name)),
      level: titleCase(clean(r.mainlevel_code)), // Primary / Secondary / Mixed Levels / Junior College / Centralised Institute
      type: titleCase(clean(r.type_code)),
      nature: titleCase(clean(r.nature_code)),
      session: titleCase(clean(r.session_code)),
      zone: titleCase(clean(r.zone_code)),
      area: titleCase(clean(r.dgp_code)),
      address: titleCase(clean(r.address)),
      postal,
      lat: ll[0],
      lng: ll[1],
      website: clean(r.url_address),
      phone: clean(r.telephone_no),
      email: clean(r.email_address)?.toLowerCase() ?? null,
      mrt: clean(r.mrt_desc),
      principal: titleCase(clean(r.principal_name)),
      vicePrincipals: vps,
      sap: yes(r.sap_ind),
      autonomous: yes(r.autonomous_ind),
      gifted: yes(r.gifted_ind),
      ip: yes(r.ip_ind),
      motherTongues: ["1", "2", "3"].map((n) => titleCase(clean(r[`mothertongue${n}_code`]))).filter(Boolean),
      ccas: [...(ccas.get(k) ?? [])].sort(),
      programmes: [...(programmes.get(k) ?? [])].sort(),
      distinctive: distinctive.get(k) ?? [],
    });
  }

  schools.sort((a, b) => a.name.localeCompare(b.name));
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(CACHE, JSON.stringify(cache, null, 0) + "\n");
  await writeFile(
    OUT,
    JSON.stringify(
      {
        source: "Ministry of Education, via data.gov.sg (Singapore Open Data Licence). Locations: OneMap, Singapore Land Authority.",
        generatedAt: new Date().toISOString(),
        count: schools.length,
        schools,
      },
      null,
      1
    ) + "\n"
  );
  console.log(`Wrote ${schools.length} schools (${missing} without a location).`);
  if (schools.length === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
