import { useState, useRef } from "react";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// Shift times are always fixed
const SHIFT_START = "07:00";
const SHIFT_END   = "16:00";

const PARSE_PROMPT = `Je krijgt een foto van een werkplanning. Extraheer alle shifts als JSON array.

Elk blok heeft:
- Bovenaan "Opdrachtgever: XY" (de naam van de opdrachtgever)
- Een adres/locatie
- Een meldtijd + context (bijv. "6:15 zaak", "7 uur aanwezig", "6:00 zaak")
  → De tijd (HH:MM) is het MELDTIJDSTIP, NIET de werktijd. Dit gaat in de beschrijving.
  → De context (zaak, aanwezig, etc.) hoort ook bij de beschrijving.
- Optioneel een voertuig (bijv. "Grijze bus", "Witte bus", "Pu 2 + aanganger")
- Namen van medewerkers

Geef terug als JSON array met per shift:
- opdrachtgever: string of null
- location: adres/locatienaam
- reportTime: meldtijd als "HH:MM" of null
- reportContext: de context bij de meldtijd (bijv. "zaak", "aanwezig") of null
- vehicle: voertuig of null
- employees: array van namen

Voorbeeld output:
[
  {
    "opdrachtgever": "Jansen BV",
    "location": "Bankastraat 7 Amsterdam",
    "reportTime": "06:15",
    "reportContext": "zaak",
    "vehicle": "Pu 2 + aanganger",
    "employees": ["Luuk", "Paolo", "Hamza"]
  },
  {
    "opdrachtgever": null,
    "location": "Marktstraat 118 Schagen",
    "reportTime": "06:00",
    "reportContext": "zaak",
    "vehicle": "Grijze bus",
    "employees": ["Rafael", "Joschua", "Jeron"]
  }
]

Geef ALLEEN de JSON array terug, geen uitleg of markdown.`;

// Build the remark string from parsed fields
function buildRemark(shift) {
  const parts = [];
  if (shift.reportTime) {
    const ctx = shift.reportContext ? ` ${shift.reportContext}` : "";
    parts.push(`Melden ${shift.reportTime}${ctx}`);
  }
  if (shift.vehicle) parts.push(shift.vehicle);
  return parts.join(" | ");
}

function matchEmployee(name, list) {
  const n = name.toLowerCase().trim();
  return (
    list.find(e => `${e.first_name} ${e.last_name}`.toLowerCase() === n) ||
    list.find(e => e.first_name?.toLowerCase() === n) ||
    list.find(e => e.first_name?.toLowerCase().startsWith(n)) ||
    null
  );
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500&display=swap');
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0e0e0e}
  .app{min-height:100vh;background:#0e0e0e;color:#e8e8e8;font-family:'IBM Plex Sans',sans-serif;padding:32px 24px;max-width:900px;margin:0 auto}
  .header{display:flex;align-items:baseline;gap:16px;margin-bottom:40px;border-bottom:1px solid #222;padding-bottom:20px}
  .header h1{font-family:'IBM Plex Mono',monospace;font-size:18px;font-weight:600;color:#fff;letter-spacing:-0.5px}
  .sub{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#444;text-transform:uppercase;letter-spacing:1px}
  .section{margin-bottom:32px}
  .slabel{font-family:'IBM Plex Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#555;margin-bottom:10px}
  .row{display:flex;gap:12px;flex-wrap:wrap}
  .inp{background:#161616;border:1px solid #2a2a2a;color:#e8e8e8;font-family:'IBM Plex Mono',monospace;font-size:13px;padding:10px 14px;border-radius:4px;outline:none;transition:border-color .15s;flex:1;min-width:180px}
  .inp:focus{border-color:#f0a500}
  .inp::placeholder{color:#3a3a3a}
  .upload-zone{border:1px dashed #2a2a2a;border-radius:6px;padding:28px;text-align:center;cursor:pointer;transition:all .15s;background:#111;position:relative}
  .upload-zone:hover,.upload-zone.drag{border-color:#f0a500;background:#141414}
  .upload-zone input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%}
  .preview-img{max-height:150px;border-radius:4px;border:1px solid #2a2a2a;margin-top:12px}
  .btn{font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;letter-spacing:.5px;padding:10px 20px;border:none;border-radius:4px;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:8px;text-transform:uppercase;white-space:nowrap}
  .btn-primary{background:#f0a500;color:#0e0e0e}
  .btn-primary:hover:not(:disabled){background:#ffb820}
  .btn-primary:disabled{opacity:.35;cursor:not-allowed}
  .btn-ghost{background:#1e1e1e;color:#888;border:1px solid #2a2a2a}
  .btn-ghost:hover:not(:disabled){border-color:#444;color:#ccc}
  .btn-ghost:disabled{opacity:.35;cursor:not-allowed}
  .btn-green{background:#16a34a;color:#fff}
  .btn-green:hover:not(:disabled){background:#15803d}
  .btn-green:disabled{opacity:.35;cursor:not-allowed}
  .btn-red{background:#1e1e1e;color:#ef4444;border:1px solid #2a2a2a;padding:5px 11px;font-size:11px}
  .btn-red:hover{border-color:#ef4444}

  .card{background:#131313;border:1px solid #222;border-radius:6px;padding:18px 20px;margin-bottom:12px}
  .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap}
  .card-title{font-family:'IBM Plex Mono',monospace;font-size:13px;color:#f0a500;font-weight:600}
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
  .badge{font-family:'IBM Plex Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:3px;background:#1e1e1e;color:#666;border:1px solid #2a2a2a}
  .badge-purple{color:#a78bfa;border-color:#2d2040;background:#1a1528}
  .badge-blue{color:#38bdf8;border-color:#0e2a38;background:#0c1f2c}
  .badge-orange{color:#fb923c;border-color:#3a1e00;background:#1e1000}
  .badge-green{color:#4ade80;border-color:#1e3a1e;background:#0e1a0e}
  .badge-yellow{color:#fbbf24;border-color:#3a2e00;background:#1e1800}

  .remark-preview{font-family:'IBM Plex Mono',monospace;font-size:11px;color:#555;background:#0a0a0a;border:1px solid #1a1a1a;border-radius:3px;padding:8px 12px;margin-bottom:14px}
  .remark-preview span{color:#888}

  .emp-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
  .emp-row{display:flex;align-items:center;gap:8px}
  .emp-name{font-family:'IBM Plex Mono',monospace;font-size:12px;color:#888;min-width:80px;white-space:nowrap}
  .emp-sel{width:100%;background:#0e0e0e;border:1px solid #222;color:#ccc;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:6px 10px;border-radius:3px;outline:none;appearance:none;transition:border-color .15s;cursor:pointer}
  .emp-sel:focus{border-color:#f0a500}
  .emp-sel.ok{border-color:#16a34a44;color:#4ade80;background:#0e1a0e}
  .emp-sel.warn{border-color:#854d0e44;color:#fbbf24;background:#1a1000}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
  .dot-g{background:#4ade80}
  .dot-y{background:#fbbf24}
  .dot-r{background:#ef4444}
  .dot-dim{background:#444}

  .divider{border:none;border-top:1px solid #1e1e1e;margin:28px 0}
  .hint{font-size:11px;color:#3a3a3a;margin-top:6px;font-family:'IBM Plex Mono',monospace}
  .status-bar{display:inline-flex;align-items:center;gap:8px;font-family:'IBM Plex Mono',monospace;font-size:11px;padding:8px 12px;border-radius:4px;background:#161616;border:1px solid #222}
  .status-ok{border-color:#1e3a1e;background:#0e1a0e;color:#4ade80}
  .status-err{border-color:#3a1e1e;background:#1a0e0e;color:#f87171}

  .log{background:#0a0a0a;border:1px solid #1e1e1e;border-radius:4px;padding:14px 16px;font-family:'IBM Plex Mono',monospace;font-size:11px;max-height:220px;overflow-y:auto;line-height:2}
  .ll{display:flex;gap:10px}
  .lt{color:#2a2a2a;min-width:64px}
  .lm-ok{color:#4ade80}
  .lm-err{color:#f87171}
  .lm-info{color:#93c5fd}
  .lm-warn{color:#fbbf24}

  .spinner{width:13px;height:13px;border:2px solid #333;border-top-color:#f0a500;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
  .spinner-w{border-color:#ffffff22;border-top-color:#fff}
  @keyframes spin{to{transform:rotate(360deg)}}
  .empty{text-align:center;padding:40px;font-family:'IBM Plex Mono',monospace;font-size:12px;color:#2a2a2a}

  .inp-sm{background:#0e0e0e;border:1px solid #222;color:#ccc;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:6px 10px;border-radius:3px;outline:none;transition:border-color .15s}
  .inp-sm:focus{border-color:#f0a500}
  .inp-sm::placeholder{color:#333}

  .odr-inp{background:#0e0e0e;border:1px solid #2a2a2a;color:#fb923c;font-family:'IBM Plex Mono',monospace;font-size:12px;padding:5px 10px;border-radius:3px;outline:none;transition:border-color .15s;width:100%}
  .odr-inp:focus{border-color:#f0a500}
  .odr-inp::placeholder{color:#333}

  .step-row{display:flex;gap:8px;align-items:center;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#444;margin-bottom:6px}
  .step-num{width:20px;height:20px;border-radius:50%;background:#1e1e1e;border:1px solid #2a2a2a;display:flex;align-items:center;justify-content:center;font-size:10px;color:#555;flex-shrink:0}
`;

function useLog() {
  const [logs, setLogs] = useState([]);
  const add = (msg, type = "info") => {
    const ts = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(p => [...p, { ts, msg, type }]);
  };
  return { logs, add, clear: () => setLogs([]) };
}

export default function App() {
  const [sbKey, setSbKey]         = useState("");
  const [date, setDate]           = useState(() => new Date().toISOString().slice(0, 10));
  const [employees, setEmployees] = useState(null);
  const [fetchingEmp, setFetchingEmp] = useState(false);
  const [empStatus, setEmpStatus] = useState(null);

  const [imgData, setImgData]     = useState(null);
  const [imgPrev, setImgPrev]     = useState(null);
  const [drag, setDrag]           = useState(false);
  const [parsing, setParsing]     = useState(false);
  const [shifts, setShifts]       = useState(null);
  const [running, setRunning]     = useState(false);

  const { logs, add, clear } = useLog();
  const logRef = useRef(null);
  const scroll = () => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; };

  // ── SB helpers ────────────────────────────────────────────────────
  const sbFetch = async (path, opts = {}) => {
    const res = await fetch(`https://api.shiftbase.com/api/v2${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", "X-Api-Key": sbKey, ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
    return data;
  };

  // ── Fetch employees ────────────────────────────────────────────────
  const fetchEmployees = async () => {
    setFetchingEmp(true); setEmpStatus(null);
    try {
      const data = await sbFetch("/employees?limit=250");
      const list = data.data || data.employees || data || [];
      setEmployees(list);
      setEmpStatus("ok");
      add(`${list.length} medewerkers geladen`, "ok");
      if (shifts) setShifts(autoMatch(shifts, list));
    } catch (e) { setEmpStatus("err"); add("Medewerkers ophalen mislukt: " + e.message, "err"); }
    finally { setFetchingEmp(false); setTimeout(scroll, 80); }
  };

  // ── Auto-match names → employee IDs ───────────────────────────────
  const autoMatch = (parsed, empList) =>
    parsed.map(s => ({
      ...s,
      employeeMap: Object.fromEntries(
        s.employees.map(n => {
          const m = matchEmployee(n, empList);
          return [n, m ? String(m.id) : ""];
        })
      )
    }));

  // ── Image upload ───────────────────────────────────────────────────
  const handleImg = file => {
    if (!file) return;
    const r = new FileReader();
    r.onload = e => { setImgPrev(e.target.result); setImgData(e.target.result.split(",")[1]); setShifts(null); };
    r.readAsDataURL(file);
  };

  // ── Parse photo ────────────────────────────────────────────────────
  const parsePhoto = async () => {
    if (!imgData) return;
    setParsing(true); clear();
    add("Foto wordt geanalyseerd...", "info");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CLAUDE_MODEL, max_tokens: 1000,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: imgData } },
            { type: "text", text: PARSE_PROMPT }
          ]}]
        })
      });
      const d = await res.json();
      const txt = d.content?.find(b => b.type === "text")?.text || "[]";
      const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
      const withMap = parsed.map(s => ({
        ...s,
        employeeMap: Object.fromEntries((s.employees || []).map(n => [n, ""]))
      }));
      const final = employees ? autoMatch(withMap, employees) : withMap;
      setShifts(final);
      add(`${final.length} shift(s) gevonden`, "ok");
      final.forEach(s => {
        const matched = Object.values(s.employeeMap).filter(Boolean).length;
        add(`  → ${s.location} | ${s.opdrachtgever || "geen opdrachtgever"} | ${matched}/${s.employees.length} gekoppeld`, "info");
      });
    } catch (e) { add("Fout: " + e.message, "err"); }
    finally { setParsing(false); setTimeout(scroll, 80); }
  };

  // ── Update helpers ─────────────────────────────────────────────────
  const updShift  = (i, k, v) => setShifts(p => p.map((s, j) => j === i ? { ...s, [k]: v } : s));
  const updEmp    = (i, name, v) => setShifts(p => p.map((s, j) =>
    j !== i ? s : { ...s, employeeMap: { ...s.employeeMap, [name]: v } }));
  const remShift  = i => setShifts(p => p.filter((_, j) => j !== i));

  // ── Main run: teams → shifts → employees ──────────────────────────
  const runAll = async () => {
    setRunning(true); clear();
    const teamCache = {}; // name → id

    // 1. Fetch existing teams
    add("Teams ophalen...", "info");
    let existingTeams = [];
    try {
      const td = await sbFetch("/teams?limit=250");
      existingTeams = td.data || td.teams || td || [];
      add(`${existingTeams.length} bestaande teams gevonden`, "ok");
    } catch (e) { add("Teams ophalen mislukt: " + e.message, "err"); setRunning(false); return; }

    // 2. Fetch existing shifts for this date
    add(`Bestaande shifts ophalen voor ${date}...`, "info");
    let existingShifts = [];
    try {
      const sd = await sbFetch(`/shifts?start=${date}T00:00:00&end=${date}T23:59:59&limit=500`);
      existingShifts = sd.data || sd.shifts || sd || [];
      add(`${existingShifts.length} bestaande shifts gevonden`, "ok");
    } catch (e) { add("Shifts ophalen mislukt (doorgaan zonder check): " + e.message, "warn"); }

    setTimeout(scroll, 80);

    // 3. Process each shift block
    for (const shift of shifts) {
      const remark = buildRemark(shift);
      add(`── ${shift.location}`, "info");

      // 3a. Resolve team (opdrachtgever)
      let teamId = null;
      if (shift.opdrachtgever) {
        const odrName = shift.opdrachtgever.trim();
        if (teamCache[odrName]) {
          teamId = teamCache[odrName];
          add(`  Team "${odrName}" al verwerkt (id: ${teamId})`, "ok");
        } else {
          const found = existingTeams.find(t => t.name?.toLowerCase() === odrName.toLowerCase());
          if (found) {
            teamId = found.id;
            add(`  Team "${odrName}" bestaat al (id: ${teamId})`, "ok");
          } else {
            add(`  Team "${odrName}" aanmaken...`, "info");
            try {
              const nt = await sbFetch("/teams", { method: "POST", body: JSON.stringify({ name: odrName }) });
              teamId = (nt.data || nt)?.id;
              existingTeams.push({ id: teamId, name: odrName });
              add(`  ✓ Team "${odrName}" aangemaakt (id: ${teamId})`, "ok");
            } catch (e) { add(`  ✗ Team aanmaken mislukt: ${e.message}`, "err"); }
          }
          if (teamId) teamCache[odrName] = teamId;
        }
      }

      // 3b. Resolve shift (check if address already exists for this team/date)
      let shiftId = null;
      const matchedShift = existingShifts.find(es =>
        es.name?.toLowerCase() === shift.location.toLowerCase() &&
        (!teamId || es.team_id === teamId || es.department_id === teamId)
      );

      if (matchedShift) {
        shiftId = matchedShift.id;
        add(`  Shift "${shift.location}" bestaat al (id: ${shiftId})`, "ok");
      } else {
        add(`  Shift "${shift.location}" aanmaken...`, "info");
        try {
          const body = {
            name: shift.location,
            start: `${date}T${SHIFT_START}:00`,
            end:   `${date}T${SHIFT_END}:00`,
            remark,
            ...(teamId ? { team_id: teamId } : {})
          };
          const ns = await sbFetch("/shifts", { method: "POST", body: JSON.stringify(body) });
          shiftId = (ns.data || ns)?.id;
          existingShifts.push({ id: shiftId, name: shift.location, team_id: teamId });
          add(`  ✓ Shift aangemaakt — ${SHIFT_START}→${SHIFT_END} | "${remark}"`, "ok");
        } catch (e) { add(`  ✗ Shift aanmaken mislukt: ${e.message}`, "err"); }
      }

      // 3c. Assign employees
      for (const [name, empId] of Object.entries(shift.employeeMap)) {
        if (!empId) { add(`  Overgeslagen: ${name} (niet gekoppeld)`, "warn"); continue; }
        if (!shiftId) { add(`  Overgeslagen: ${name} (geen shift ID)`, "warn"); continue; }
        add(`  Medewerker ${name} koppelen...`, "info");
        try {
          // Try assigning via shift employee endpoint; fallback to creating individual shift
          await sbFetch(`/shifts/${shiftId}/employees`, {
            method: "POST",
            body: JSON.stringify({ employee_id: Number(empId) })
          });
          add(`  ✓ ${name} gekoppeld aan shift`, "ok");
        } catch (e) {
          // Fallback: create a personal shift copy
          try {
            await sbFetch("/shifts", {
              method: "POST",
              body: JSON.stringify({
                name: shift.location,
                employee_id: Number(empId),
                start: `${date}T${SHIFT_START}:00`,
                end:   `${date}T${SHIFT_END}:00`,
                remark,
                ...(teamId ? { team_id: teamId } : {})
              })
            });
            add(`  ✓ ${name} — persoonlijke shift aangemaakt`, "ok");
          } catch (e2) { add(`  ✗ ${name}: ${e2.message}`, "err"); }
        }
        await new Promise(r => setTimeout(r, 150));
        setTimeout(scroll, 50);
      }
      setTimeout(scroll, 50);
    }

    add("── Klaar", "ok");
    setRunning(false);
    setTimeout(scroll, 100);
  };

  // ── Derived counts ─────────────────────────────────────────────────
  const totalEmp  = shifts ? shifts.reduce((a, s) => a + Object.keys(s.employeeMap).length, 0) : 0;
  const mappedEmp = shifts ? shifts.reduce((a, s) => a + Object.values(s.employeeMap).filter(Boolean).length, 0) : 0;

  return (
    <>
      <style>{css}</style>
      <div className="app">

        <div className="header">
          <h1>⬡ Shiftbase Auto-Import</h1>
          <span className="sub">Planning → Teams → Shifts → Medewerkers</span>
        </div>

        {/* Config */}
        <div className="section">
          <div className="slabel">Configuratie</div>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="inp" type="password" placeholder="Shiftbase API key"
              value={sbKey} onChange={e => setSbKey(e.target.value)} />
            <input className="inp" type="date" value={date}
              onChange={e => setDate(e.target.value)} style={{ maxWidth: 180 }} />
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn btn-ghost" onClick={fetchEmployees} disabled={!sbKey || fetchingEmp}>
              {fetchingEmp ? <><span className="spinner" /> Ophalen...</> : "👥 Haal medewerkers op"}
            </button>
            {empStatus === "ok" && employees &&
              <div className="status-bar status-ok">✓ {employees.length} medewerkers</div>}
            {empStatus === "err" &&
              <div className="status-bar status-err">✗ Ophalen mislukt</div>}
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            Shift tijden zijn altijd <strong style={{ color: "#888" }}>07:00 → 16:00</strong>.
            Het meldtijdstip uit de foto gaat in de omschrijving.
          </p>
        </div>

        <hr className="divider" />

        {/* Upload */}
        <div className="section">
          <div className="slabel">Planning foto</div>
          <div className={`upload-zone ${drag ? "drag" : ""}`}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleImg(e.dataTransfer.files[0]); }}>
            <input type="file" accept="image/*" onChange={e => handleImg(e.target.files[0])} />
            <div style={{ fontSize: 26, marginBottom: 8 }}>📷</div>
            <div style={{ fontFamily: "IBM Plex Mono", fontSize: 12, color: "#555" }}>
              <strong style={{ color: "#888" }}>Klik of sleep</strong> een planningsfoto
            </div>
            {imgPrev && <img src={imgPrev} alt="" className="preview-img" />}
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
            <button className="btn btn-primary" onClick={parsePhoto} disabled={!imgData || parsing}>
              {parsing ? <><span className="spinner" /> Analyseert...</> : "⚡ Parseer foto"}
            </button>
            {imgData && (
              <button className="btn btn-ghost" onClick={() => { setImgData(null); setImgPrev(null); setShifts(null); }}>
                Wis foto
              </button>
            )}
          </div>
        </div>

        <hr className="divider" />

        {/* Shifts */}
        <div className="section">
          <div className="slabel">
            Shifts
            {shifts && <span style={{ color: "#444", marginLeft: 8 }}>
              — {shifts.length} locatie(s) · {mappedEmp}/{totalEmp} medewerkers gekoppeld
            </span>}
          </div>

          {!shifts && <div className="empty">Parseer eerst een foto</div>}

          {shifts && shifts.map((shift, idx) => {
            const remark = buildRemark(shift);
            return (
              <div key={idx} className="card">
                <div className="card-head">
                  <div style={{ flex: 1 }}>
                    {/* Opdrachtgever */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ fontFamily: "IBM Plex Mono", fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 1, whiteSpace: "nowrap" }}>Opdrachtgever</span>
                      <input
                        className="odr-inp"
                        placeholder="naam opdrachtgever"
                        value={shift.opdrachtgever || ""}
                        onChange={e => updShift(idx, "opdrachtgever", e.target.value)}
                      />
                    </div>
                    <div className="card-title">{shift.location}</div>
                    <div className="badges">
                      <span className="badge badge-purple">⏰ Melden {shift.reportTime || "—"}</span>
                      {shift.reportContext && <span className="badge badge-purple">{shift.reportContext}</span>}
                      {shift.vehicle && <span className="badge badge-blue">🚌 {shift.vehicle}</span>}
                      <span className="badge badge-green">Shift {SHIFT_START} → {SHIFT_END}</span>
                    </div>
                  </div>
                  <button className="btn btn-red" onClick={() => remShift(idx)}>✕</button>
                </div>

                {/* Remark preview */}
                <div className="remark-preview">
                  Omschrijving: <span>{remark || <em style={{ color: "#333" }}>leeg</em>}</span>
                </div>

                {/* Employees */}
                <div style={{ fontFamily: "IBM Plex Mono", fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
                  Medewerkers
                </div>
                <div className="emp-grid">
                  {Object.entries(shift.employeeMap).map(([name, empId]) => (
                    <div key={name} className="emp-row">
                      <span className="emp-name">{name}</span>
                      {employees ? (
                        <select className={`emp-sel ${empId ? "ok" : "warn"}`}
                          value={empId} onChange={e => updEmp(idx, name, e.target.value)}>
                          <option value="">— selecteer —</option>
                          {employees.map(e => (
                            <option key={e.id} value={String(e.id)}>
                              {e.first_name} {e.last_name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className="inp-sm" placeholder="Haal medewerkers op" disabled style={{ flex: 1 }} />
                      )}
                      <span className={`dot ${empId ? "dot-g" : "dot-y"}`} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {shifts && shifts.length > 0 && (
            <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-green" onClick={runAll}
                disabled={running || !sbKey || mappedEmp === 0}>
                {running
                  ? <><span className="spinner spinner-w" /> Verwerken...</>
                  : `🚀 Verwerk alle shifts`}
              </button>
              {mappedEmp < totalEmp && (
                <span style={{ fontFamily: "IBM Plex Mono", fontSize: 11, color: "#fbbf24" }}>
                  ⚠ {totalEmp - mappedEmp} medewerker(s) niet gekoppeld
                </span>
              )}
            </div>
          )}
        </div>

        {/* Log */}
        {logs.length > 0 && (
          <>
            <hr className="divider" />
            <div className="section">
              <div className="slabel">Verwerking log</div>
              <div className="log" ref={logRef}>
                {logs.map((l, i) => (
                  <div key={i} className="ll">
                    <span className="lt">{l.ts}</span>
                    <span className={`lm-${l.type}`}>{l.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
