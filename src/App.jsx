import { useEffect, useMemo, useState } from "react";

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
    // Tokopedia: /<shop>/<product-slug>
    const parts = u.pathname.split("/").filter(Boolean);
    const slug = parts[1] || parts[0] || "";
    if (!slug) return "";
    return slug
      .replace(/[-_]+/g, " ")
      .replace(/\b\d+\b/g, (m) => m) // biarin angka
      .trim()
      .toUpperCase();
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

    setBuilds((prev) => {
      const b = prev.byId[prev.activeId];
      const updated = {
        ...prev,
        byId: {
          ...prev.byId,
          [prev.activeId]: {
            ...b,
            items: [item, ...b.items],
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
        [id]: { id, name, items: [] },
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

  // UI simpel tapi rapi
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 20, fontFamily: "system-ui" }}>
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
            onChange={(e) => setUrl(e.target.value)}
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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, opacity: 0.75 }}>
          Saved otomatis di browser (localStorage). Kamu bisa bikin banyak build.
        </div>
        <div style={{ fontSize: 20 }}>
          TOTAL: <b>Rp {formatRp(total)}</b>
        </div>
      </div>
    </div>
  );
}