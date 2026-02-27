import { useEffect, useMemo, useState } from "react";
import "./App.css";

const CATEGORIES = [
  "CPU",
  "Motherboard",
  "RAM",
  "SSD",
  "GPU",
  "PSU",
  "Case",
  "Cooler",
  "Other",
];

const LS_KEY = "pcbuild_multi_v1";

function formatRp(n) {
  return new Intl.NumberFormat("id-ID").format(n || 0);
}

function parsePriceToInt(input) {
  const digits = String(input ?? "").replace(/[^\d]/g, "");
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isFinite(n) ? n : 0;
}

// Best-effort: ambil nama dari URL (slug) tanpa fetch (anti CORS)
function guessNameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);

    // Tokopedia: /shop/slug  |  lainnya: ambil part terakhir
    const rawSlug = parts.length >= 2 ? parts[1] : parts[parts.length - 1] || "";
    if (!rawSlug) return "";

    // slug -> words
    let words = rawSlug
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ");

    // buang angka tracking super panjang (misal 16+ digit)
    words = words.filter((w) => !(w.length >= 14 && /^\d+$/.test(w)));

    // buang kata sampah umum
    const stop = new Set([
      "official",
      "ori",
      "original",
      "garansi",
      "warranty",
      "ready",
      "stock",
      "promo",
      "murah",
      "termurah",
      "gratis",
      "ongkir",
      "free",
      "diskon",
      "best",
      "seller",
      "tokopedia",
      "shopee",
    ]);
    words = words.filter((w) => !stop.has(w.toLowerCase()));

    // rapihin casing + acronym
    const acronyms = new Set([
      "ssd", "nvme", "pcie", "gen3", "gen4", "ddr4", "ddr5", "ram", "gpu", "cpu",
      "rtx", "gtx", "rx", "psu", "tb", "gb", "mhz", "hz", "m2", "m.2", "itx", "atx",
    ]);

    const titled = words
      .map((w) => {
        const lw = w.toLowerCase();

        // keep numbers and sizes
        if (/^\d+([.,]\d+)?(tb|gb|mhz|hz)$/i.test(w)) return w.toUpperCase();
        if (/^\d+$/.test(w)) return w;

        // acronym
        if (acronyms.has(lw)) return w.toUpperCase();

        // RTX3060 / RX6600
        if (/^(rtx|gtx|rx)\d+/i.test(w)) return w.toUpperCase();

        // normal Title Case
        return lw.charAt(0).toUpperCase() + lw.slice(1);
      })
      .join(" ");

    return titled.trim();
  } catch {
    return "";
  }
}
function buildShareText(items) {
  const grouped = new Map();
  for (const it of items) {
    if (!grouped.has(it.category)) grouped.set(it.category, []);
    grouped.get(it.category).push(it);
  }

  let out = "PC BUILD LIST\n\n";
  for (const cat of CATEGORIES) {
    const arr = grouped.get(cat) || [];
    if (!arr.length) continue;
    out += `${cat}\n`;
    for (const it of arr) {
      out += `- ${it.name} — Rp ${formatRp(it.price)}\n`;
      if (it.url) out += `  ${it.url}\n`;
      if (it.note) out += `  Note: ${it.note}\n`;
    }
    out += "\n";
  }
  const total = items.reduce((s, it) => s + (it.price || 0), 0);
  out += `TOTAL: Rp ${formatRp(total)}\n`;
  return out;
}

/* ===============================
   POWER ESTIMATOR SECTION
   =============================== */

/*
  Helper: bulatkan PSU ke standar umum market
  Contoh standar PSU:
  450 / 550 / 650 / 750 / 850 / 1000
*/
function roundToPsuStandard(watt) {
  const standards = [450, 550, 650, 750, 850, 1000];
  return standards.find((s) => watt <= s) || 1000;
}

/*
  Detect perkiraan watt CPU berdasarkan nama
  Ini heuristic ringan (bukan database penuh)
*/
function detectCpuWatt(name) {
  const n = name.toLowerCase();

  // AMD Ryzen TDP umum
  if (/ryzen\s*5\s*5600|ryzen\s*5\s*5500|ryzen\s*5\s*3600/.test(n)) return 65;
  if (/ryzen\s*7\s*5800x/.test(n)) return 105;
  if (/ryzen\s*9/.test(n)) return 105;

  // Intel generasi umum
  if (/i5-12400|i5 12400/.test(n)) return 65;
  if (/i7-12700k|i9-12900k/.test(n)) return 125;

  // fallback default CPU mid range
  return 95;
}

/*
  Detect perkiraan watt GPU berdasarkan nama
*/
function detectGpuWatt(name) {
  const n = name.toLowerCase();

  if (/rtx\s*3060/.test(n)) return 170;
  if (/rtx\s*4060/.test(n)) return 115;
  if (/rtx\s*3070/.test(n)) return 220;
  if (/rtx\s*3080/.test(n)) return 320;
  if (/rtx\s*4090/.test(n)) return 450;

  if (/rx\s*6600/.test(n)) return 132;
  if (/rx\s*6700/.test(n)) return 230;
  if (/rx\s*6800/.test(n)) return 250;

  // fallback GPU mid range
  return 200;
}

/*
  Main estimator function
  Menghitung:
  - CPU watt
  - GPU watt
  - Overhead 90W (mobo, ram, ssd, fan, dll)
  - Headroom multiplier 1.5
*/
function estimatePower(items) {
  const cpu = items.find((i) => i.category === "CPU");
  const gpu = items.find((i) => i.category === "GPU");
  const psu = items.find((i) => i.category === "PSU");

  const cpuWatt = cpu ? detectCpuWatt(cpu.name) : 0;
  const gpuWatt = gpu ? detectGpuWatt(gpu.name) : 0;

  const overhead = 90; // asumsi komponen lain

  const rawTotal = cpuWatt + gpuWatt + overhead;

  const recommendedRaw = rawTotal * 1.5;
  const recommendedPsu = roundToPsuStandard(recommendedRaw);

  // Detect watt PSU dari nama jika ada angka seperti 550W
  let selectedPsuWatt = 0;
  if (psu) {
    const match = psu.name.match(/(\d{3,4})\s*w/i);
    if (match) selectedPsuWatt = parseInt(match[1]);
  }

  return {
    cpuWatt,
    gpuWatt,
    overhead,
    rawTotal,
    recommendedPsu,
    selectedPsuWatt,
  };
}

/* ===============================
   SOCKET COMPATIBILITY SECTION
   =============================== */

/*
  Detect socket CPU dari nama
*/
function detectCpuSocket(name) {
  const n = name.toLowerCase();

  // AMD
  if (/ryzen/.test(n)) return "AM4";
  if (/am5/.test(n)) return "AM5";

  // Intel generasi 12+
  if (/12\d{2}|13\d{2}|14\d{2}/.test(n)) return "LGA1700";

  // Intel lama
  if (/10\d{2}|11\d{2}/.test(n)) return "LGA1200";

  return null;
}

/*
  Detect socket Motherboard dari nama
*/
function detectMoboSocket(name) {
  const n = name.toLowerCase();

  if (/b450|b550|x470|x570|a320/.test(n)) return "AM4";
  if (/b650|x670/.test(n)) return "AM5";

  if (/b660|z690|z790|h610/.test(n)) return "LGA1700";
  if (/b460|z490/.test(n)) return "LGA1200";

  return null;
}

/*
  Check compatibility result
*/
function checkCpuMoboCompatibility(items) {
  const cpu = items.find((i) => i.category === "CPU");
  const mobo = items.find((i) => i.category === "Motherboard");

  if (!cpu || !mobo) return null;

  const cpuSocket = detectCpuSocket(cpu.name);
  const moboSocket = detectMoboSocket(mobo.name);

  if (!cpuSocket || !moboSocket) return null;

  return {
    cpuSocket,
    moboSocket,
    compatible: cpuSocket === moboSocket,
  };
}

/* ===============================
   DDR (RAM) COMPATIBILITY SECTION
   =============================== */

function detectRamDdr(name) {
  const n = name.toLowerCase();
  if (n.includes("ddr5")) return "DDR5";
  if (n.includes("ddr4")) return "DDR4";
  return null;
}

function detectMoboDdr(name) {
  const n = name.toLowerCase();

  // paling akurat kalau nama mobo mencantumkan DDR4/DDR5
  if (n.includes("ddr5")) return "DDR5";
  if (n.includes("ddr4")) return "DDR4";

  // fallback heuristic chipset:
  // AMD AM4 biasanya DDR4
  if (/b450|b550|x470|x570|a320/.test(n)) return "DDR4";

  // AMD AM5 biasanya DDR5
  if (/b650|x670/.test(n)) return "DDR5";

  // Intel:
  // B660/Z690/Z790/H610 bisa DDR4 atau DDR5 → unknown kalau tidak tertulis
  if (/b660|z690|z790|h610/.test(n)) return null;

  // Intel lama umumnya DDR4
  if (/b460|z490/.test(n)) return "DDR4";

  return null;
}

function checkRamMoboDdr(items) {
  const ram = items.find((i) => i.category === "RAM");
  const mobo = items.find((i) => i.category === "Motherboard");
  if (!ram || !mobo) return null;

  const ramDdr = detectRamDdr(ram.name);
  const moboDdr = detectMoboDdr(mobo.name);

  // kalau salah satu tidak ketahuan, return null (nanti UI bilang "unknown")
  if (!ramDdr || !moboDdr) {
    return { ramDdr, moboDdr, compatible: null };
  }

  return { ramDdr, moboDdr, compatible: ramDdr === moboDdr };
}

function buildCsv(items) {
  // CSV sederhana: category,name,price,url,note
  const escape = (s) => `"${String(s ?? "").replaceAll('"', '""')}"`;
  const lines = [
    ["category", "name", "price", "url", "note"].map(escape).join(","),
    ...items.map((it) =>
      [it.category, it.name, it.price, it.url, it.note].map(escape).join(",")
    ),
  ];
  return lines.join("\n");
}

function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function App() {
  // state utama: kumpulan build
  const [builds, setBuilds] = useState(() => ({
    activeId: "default",
    byId: {
      default: {
        id: "default",
        name: "Build 1",
        items: [],
        budget: 0, // 0 = belum set
      },
    },
  }));

  const activeBuild = builds.byId[builds.activeId];

  // form input
  const [category, setCategory] = useState("CPU");
  const [name, setName] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");

  //generate share link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const data = params.get("data");

    if (data) {
      try {
        const decoded = JSON.parse(
          decodeURIComponent(escape(atob(data)))
        );

        const newId = crypto.randomUUID();

        setBuilds({
          activeId: newId,
          byId: {
            [newId]: {
              id: newId,
              name: decoded.name || "Shared Build",
              items: decoded.items || [],
            },
          },
        });

        // remove param biar URL bersih
        window.history.replaceState({}, "", "/");
      } catch (err) {
        console.error("Invalid share data");
      }
    }
  }, []);
  // load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.byId && parsed?.activeId) setBuilds(parsed);
      }
    } catch {
      // ignore
    }
  }, []);

  // save
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(builds));
    } catch {
      // ignore
    }
  }, [builds]);

  const total = useMemo(() => {
    return activeBuild.items.reduce((s, it) => s + (it.price || 0), 0);
  }, [activeBuild.items]);

  const power = useMemo(() => {
    return estimatePower(activeBuild.items);
  }, [activeBuild.items]);

  const compatibility = useMemo(() => {
    return checkCpuMoboCompatibility(activeBuild.items);
  }, [activeBuild.items]);

  const ddrCheck = useMemo(() => {
    return checkRamMoboDdr(activeBuild.items);
  }, [activeBuild.items]);

  function addItem() {
    const trimmedName = name.trim();
    const price = parsePriceToInt(priceInput);

    if (!trimmedName) return alert("Nama produk wajib diisi.");
    if (!price) return alert("Harga wajib diisi (angka).");

    const item = {
      id: crypto?.randomUUID?.() ?? String(Date.now()),
      category,
      name: trimmedName,
      price,
      url: url.trim(),
      note: note.trim(),
      addedAt: new Date().toISOString(),
    };

    const SINGLE_CATEGORIES = new Set([
      "CPU",
      "Motherboard",
      "GPU",
      "PSU",
      "Case",
      "Monitor",
    ]);

    setBuilds((prev) => {
      const b = prev.byId[prev.activeId];
      const updated = {
        ...prev,
        byId: {
          ...prev.byId,
          [prev.activeId]: {
            ...b,
            items: SINGLE_CATEGORIES.has(category)
              ? [item, ...b.items.filter((x) => x.category !== category)]
              : [item, ...b.items],
          },
        },
      };
      return updated;
    });

    setName("");
    setPriceInput("");
    setUrl("");
    setNote("");
  }

  function removeItem(itemId) {
    setBuilds((prev) => {
      const b = prev.byId[prev.activeId];
      return {
        ...prev,
        byId: {
          ...prev.byId,
          [prev.activeId]: {
            ...b,
            items: b.items.filter((x) => x.id !== itemId),
          },
        },
      };
    });
  }

  function clearBuild() {
    if (!confirm("Hapus semua item di build ini?")) return;
    setBuilds((prev) => {
      const b = prev.byId[prev.activeId];
      return {
        ...prev,
        byId: {
          ...prev.byId,
          [prev.activeId]: { ...b, items: [] },
        },
      };
    });
  }

  function createBuild() {
    const id = crypto?.randomUUID?.() ?? String(Date.now());
    const name = `Build ${Object.keys(builds.byId).length + 1}`;
    setBuilds((prev) => ({
      activeId: id,
      byId: {
        ...prev.byId,
        [id]: { id, name, items: [], budget: 0 },
      },
    }));
  }

  function renameBuild() {
    const newName = prompt("Nama build:", activeBuild.name);
    if (!newName) return;
    setBuilds((prev) => ({
      ...prev,
      byId: {
        ...prev.byId,
        [prev.activeId]: { ...prev.byId[prev.activeId], name: newName.trim() },
      },
    }));
  }

  function setActiveBudget(value) {
    setBuilds((prev) => {
      const b = prev.byId[prev.activeId];
      return {
        ...prev,
        byId: {
          ...prev.byId,
          [prev.activeId]: {
            ...b,
            budget: value,
          },
        },
      };
    });
  }

  function deleteBuild() {
    const ids = Object.keys(builds.byId);
    if (ids.length <= 1) return alert("Minimal harus ada 1 build.");
    if (!confirm("Hapus build ini?")) return;

    setBuilds((prev) => {
      const nextById = { ...prev.byId };
      delete nextById[prev.activeId];
      const nextActiveId = Object.keys(nextById)[0];
      return { activeId: nextActiveId, byId: nextById };
    });
  }

  async function copyShare() {
    const text = buildShareText(activeBuild.items);
    try {
      await navigator.clipboard.writeText(text);
      alert("List sudah dicopy (WA-ready).");
    } catch {
      alert("Gagal copy. Coba di browser lain.");
    }
  }

  function exportCsv() {
    const csv = buildCsv(activeBuild.items);
    const safeName = activeBuild.name.replaceAll(/[^\w\s-]/g, "").trim() || "build";
    downloadText(`${safeName}.csv`, csv, "text/csv;charset=utf-8");
  }

  function autoFillNameFromLink() {
    const guessed = guessNameFromUrl(url);
    if (!guessed) return alert("Tidak bisa tebak nama dari link. Isi manual saja.");
    if (!name.trim()) setName(guessed);
    else setName((prev) => (prev ? prev : guessed));
  }

  const buildOptions = Object.values(builds.byId);

  function generateShareLink() {
    const data = {
      name: activeBuild.name,
      items: activeBuild.items,
    };

    const json = JSON.stringify(data);
    const encoded = btoa(unescape(encodeURIComponent(json)));

    const url = `${window.location.origin}?data=${encoded}`;

    navigator.clipboard.writeText(url);
    alert("Share link copied!");
  }

  // UI simpel tapi rapi
  return (
    <div className="container">
      <h1 style={{ marginTop: 0 }}>PC Build Simulator</h1>

      {/* Build selector */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b>Build:</b>
        <select
          value={builds.activeId}
          onChange={(e) => setBuilds((p) => ({ ...p, activeId: e.target.value }))}
        >
          {buildOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <button onClick={createBuild}>+ New</button>
        <button onClick={renameBuild}>Rename</button>
        <button onClick={deleteBuild}>Delete</button>
      </div>

      <hr style={{ opacity: 0.2, margin: "14px 0" }} />
      {/* Budget */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <b>Budget (IDR):</b>
        <input
          value={activeBuild.budget ? String(activeBuild.budget) : ""}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d]/g, "");
            setActiveBudget(v ? Number(v) : 0);
          }}
          placeholder="Contoh: 8500000"
          inputMode="numeric"
          style={{ padding: 10, width: 200 }}
        />
        <span style={{ opacity: 0.75 }}>
          {activeBuild.budget ? `Rp ${formatRp(activeBuild.budget)}` : "Belum diset"}
        </span>
      </div>

      {/* Input */}
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 180px 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Kategori</div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%", padding: 10 }}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Nama Produk</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: ADATA LEGEND 710 1TB"
            style={{ width: "100%", padding: 10 }}
          />
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Harga (IDR)</div>
          <input
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="Contoh: 1.279.000"
            inputMode="numeric"
            style={{ width: "100%", padding: 10 }}
          />
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Preview: <b>Rp {formatRp(parsePriceToInt(priceInput))}</b>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Link (opsional)</div>
          <input
            value={url}
            onChange={(e) => {
              const v = e.target.value;
              setUrl(v);
              if (!name.trim()) {
                const g = guessNameFromUrl(v);
                if (g) setName(g);
              }
            }}
            placeholder="https://www.tokopedia.com/..."
            style={{ width: "100%", padding: 10 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            <button onClick={autoFillNameFromLink} type="button">Tebak Nama dari Link</button>
          </div>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Catatan (opsional)</div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contoh: garansi 3 tahun, seller official, dll"
            style={{ width: "100%", padding: 10 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={addItem}>+ Tambah</button>
        <button onClick={copyShare} disabled={!activeBuild.items.length}>Copy WA</button>
        <button onClick={exportCsv} disabled={!activeBuild.items.length}>Export CSV</button>
        <button onClick={generateShareLink}>
          Generate Share Link
        </button>
        <button onClick={clearBuild} disabled={!activeBuild.items.length}>Clear Build</button>
      </div>

      <hr style={{ opacity: 0.2, margin: "14px 0" }} />

      {/* List per kategori */}
      {CATEGORIES.map((cat) => {
        const catItems = activeBuild.items.filter((x) => x.category === cat);
        return (
          <div key={cat} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={{ margin: 0 }}>{cat}</h3>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{catItems.length} item</span>
            </div>

            {catItems.length === 0 ? (
              <div style={{ opacity: 0.5, padding: "6px 0" }}>Empty</div>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {catItems.map((it) => (
                  <div
                    key={it.id}
                    style={{
                      border: "1px solid rgba(0,0,0,0.2)",
                      borderRadius: 10,
                      padding: 10,
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {it.name}
                      </b>
                      {it.note ? <div style={{ fontSize: 12, opacity: 0.75 }}>{it.note}</div> : null}
                      {it.url ? (
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          <a href={it.url} target="_blank" rel="noreferrer">{it.url}</a>
                        </div>
                      ) : null}
                    </div>

                    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div><b>Rp {formatRp(it.price)}</b></div>
                      <button onClick={() => removeItem(it.id)} style={{ marginTop: 6 }}>
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <hr style={{ opacity: 0.2, margin: "14px 0" }} />

      <hr style={{ opacity: 0.2, margin: "14px 0" }} />

      <h2>Power Estimate</h2>

      <div style={{
        border: "1px solid rgba(0,0,0,0.2)",
        padding: 12,
        borderRadius: 8,
        marginBottom: 12
      }}>

        <div>CPU Estimate: {power.cpuWatt}W</div>
        <div>GPU Estimate: {power.gpuWatt}W</div>
        <div>Other Components (Overhead): {power.overhead}W</div>

        <hr />

        <div><b>Estimated Load: {power.rawTotal}W</b></div>
        <div><b>Recommended PSU: {power.recommendedPsu}W</b></div>

        {power.selectedPsuWatt > 0 && (
          <div style={{
            marginTop: 10,
            color: power.selectedPsuWatt < power.recommendedPsu ? "red" : "green",
            fontWeight: "bold"
          }}>
            {power.selectedPsuWatt < power.recommendedPsu
              ? "⚠ PSU mungkin kurang daya!"
              : "✓ PSU mencukupi"}
          </div>
        )}

      </div>

      <h2>Compatibility Check</h2>

      <div style={{
        border: "1px solid rgba(0,0,0,0.2)",
        padding: 12,
        borderRadius: 8,
        marginBottom: 12
      }}>

        {!compatibility && (
          <div style={{ opacity: 0.6 }}>
            Add CPU and Motherboard to check compatibility
          </div>
        )}

        {compatibility && (
          <>
            <div>CPU Socket: {compatibility.cpuSocket}</div>
            <div>Motherboard Socket: {compatibility.moboSocket}</div>

            <div style={{
              marginTop: 10,
              fontWeight: "bold",
              color: compatibility.compatible ? "green" : "red"
            }}>
              {compatibility.compatible
                ? "✓ CPU dan Motherboard kompatibel"
                : "⚠ CPU dan Motherboard tidak kompatibel"}
            </div>
          </>
        )}

      </div>

      <h2>DDR Check (RAM ↔ Motherboard)</h2>

      <div
        style={{
          border: "1px solid rgba(0,0,0,0.2)",
          padding: 12,
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        {!ddrCheck && (
          <div style={{ opacity: 0.6 }}>
            Add RAM and Motherboard to check DDR compatibility
          </div>
        )}

        {ddrCheck && (
          <>
            <div>RAM: {ddrCheck.ramDdr || "Unknown"}</div>
            <div>Motherboard: {ddrCheck.moboDdr || "Unknown"}</div>

            <div
              style={{
                marginTop: 10,
                fontWeight: "bold",
                color:
                  ddrCheck.compatible === null
                    ? "#999"
                    : ddrCheck.compatible
                      ? "green"
                      : "red",
              }}
            >
              {ddrCheck.compatible === null
                ? "ℹ Tidak bisa memastikan (pastikan nama RAM/Mobo mencantumkan DDR4/DDR5)"
                : ddrCheck.compatible
                  ? "✓ RAM dan Motherboard kompatibel (DDR match)"
                  : "⚠ RAM dan Motherboard tidak kompatibel (DDR beda)"}
            </div>
          </>
        )}
      </div>


      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, opacity: 0.75 }}>
          Saved otomatis di browser (localStorage). Kamu bisa bikin banyak build.
        </div>
        <div style={{ fontSize: 20 }}>
          TOTAL: <b>Rp {formatRp(total)}</b>
        </div>
      </div>


      {/* Budget status */}
      {activeBuild.budget > 0 && (
        <div style={{ marginTop: 14 }}>
          {(() => {
            const budget = activeBuild.budget;
            const diff = budget - total; // positif = sisa, negatif = over
            const pct = Math.min(100, Math.round((total / budget) * 100));

            const over = diff < 0;

            return (
              <div
                style={{
                  border: "1px solid rgba(0,0,0,0.2)",
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Budget</div>
                    <b>Rp {formatRp(budget)}</b>
                  </div>
                  <div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>{over ? "Over Budget" : "Sisa Budget"}</div>
                    <b style={{ color: over ? "red" : "green" }}>
                      Rp {formatRp(Math.abs(diff))}
                    </b>
                  </div>
                  <div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Progress</div>
                    <b style={{ color: over ? "red" : "inherit" }}>{pct}%</b>
                  </div>
                </div>

                <div style={{ marginTop: 10, height: 12, borderRadius: 999, background: "rgba(0,0,0,0.08)" }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: over ? "red" : "green",
                    }}
                  />
                </div>

                {over && (
                  <div style={{ marginTop: 10, color: "red", fontWeight: "bold" }}>
                    ⚠ Total melebihi budget.
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Sticky Bottom Summary */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "#111",
          color: "white",
          padding: "12px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 -2px 8px rgba(0,0,0,0.2)",
          zIndex: 1000,
        }}
      >
        <div>
          <b>Total:</b> Rp {formatRp(total)}
        </div>

        <div>
          {activeBuild.budget > 0 && (
            <>
              <b>Budget:</b> Rp {formatRp(activeBuild.budget)}{" "}
              {total > activeBuild.budget ? (
                <span style={{ color: "red" }}>⚠ Over</span>
              ) : (
                <span style={{ color: "lightgreen" }}>✓ OK</span>
              )}
            </>
          )}
        </div>

        <div>
          {power.selectedPsuWatt > 0 && (
            <>
              <b>PSU:</b>{" "}
              {power.selectedPsuWatt < power.recommendedPsu ? (
                <span style={{ color: "red" }}>Kurang</span>
              ) : (
                <span style={{ color: "lightgreen" }}>Aman</span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}