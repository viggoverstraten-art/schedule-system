// ── Constants ─────────────────────────────────────────────────────────────────
const SHIFT_START = "07:00";
const SHIFT_END   = "16:00";
const PARSE_PROMPT = `Je krijgt een foto van een werkplanning. Extraheer alle shifts als JSON array.

Elk blok heeft:
- Bovenaan "Opdrachtgever: XY" (de naam van de opdrachtgever)
- Een adres/locatie
- Een meldtijd + context (bijv. "6:15 zaak", "7 uur aanwezig", "6:00 zaak")
  De tijd (HH:MM) is het MELDTIJDSTIP, niet de werktijd. Dit gaat in de beschrijving.
  De context (zaak, aanwezig, etc.) hoort ook bij de beschrijving.
- Optioneel een voertuig (bijv. "Grijze bus", "Witte bus", "Pu 2 + aanganger")
- Namen van medewerkers

Geef terug als JSON array met per shift:
- opdrachtgever: string of null
- location: adres/locatienaam
- reportTime: meldtijd als "HH:MM" of null
- reportContext: context bij de meldtijd (bijv. "zaak", "aanwezig") of null
- vehicle: voertuig of null
- employees: array van namen

Geef ALLEEN de JSON array terug, geen uitleg of markdown.`;

// ── State ─────────────────────────────────────────────────────────────────────
let employees = null;
let shifts    = null;
let imgBase64 = null;

// ── DOM ───────────────────────────────────────────────────────────────────────
const sbKeyEl     = document.getElementById("sbKey");
const dateEl      = document.getElementById("shiftDate");
const btnFetchEmp = document.getElementById("btnFetchEmp");
const empStatusEl = document.getElementById("empStatus");
const uploadZone  = document.getElementById("uploadZone");
const fileInput   = document.getElementById("fileInput");
const imgPreview  = document.getElementById("imgPreview");
const btnParse    = document.getElementById("btnParse");
const btnClearImg = document.getElementById("btnClearImg");
const shiftsLabel = document.getElementById("shiftsLabel");
const shiftsCont  = document.getElementById("shiftsContainer");
const runRow      = document.getElementById("runRow");
const btnRun      = document.getElementById("btnRun");
const runWarning  = document.getElementById("runWarning");
const logSection  = document.getElementById("logSection");
const logBox      = document.getElementById("logBox");

dateEl.value = new Date().toISOString().slice(0, 10);

// ── Logging ───────────────────────────────────────────────────────────────────
function log(msg, type = "info") {
  const ts = new Date().toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const line = document.createElement("div");
  line.className = "ll";
  line.innerHTML = `<span class="lt">${ts}</span><span class="lm-${type}">${msg}</span>`;
  logBox.appendChild(line);
  logSection.style.display = "block";
  logBox.scrollTop = logBox.scrollHeight;
}
function clearLog() { logBox.innerHTML = ""; logSection.style.display = "none"; }

// ── API helpers ───────────────────────────────────────────────────────────────

// Alle Shiftbase calls gaan via onze Netlify proxy
function sbFetch(path, opts = {}) {
  const url = `/api/shiftbase${path}`;
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Sb-Key": sbKeyEl.value.trim(),
      ...(opts.headers || {})
    }
  }).then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
  });
}

// Claude aanroepen via onze Netlify proxy
function claudeFetch(body) {
  return fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then(res => res.json());
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildRemark(shift) {
  const parts = [];
  if (shift.reportTime) {
    const ctx = shift.reportContext ? ` ${shift.reportContext}` : "";
    parts.push(`Melden ${shift.reportTime}${ctx}`);
  }
  if (shift.vehicle) parts.push(shift.vehicle);
  return parts.join(" | ");
}

function matchEmployee(name) {
  if (!employees) return null;
  const n = name.toLowerCase().trim();
  return (
    employees.find(e => `${e.first_name} ${e.last_name}`.toLowerCase() === n) ||
    employees.find(e => e.first_name && e.first_name.toLowerCase() === n) ||
    employees.find(e => e.first_name && e.first_name.toLowerCase().startsWith(n)) ||
    null
  );
}

function spinner(white = false) {
  return `<span class="spinner${white ? " spinner-w" : ""}"></span>`;
}

// ── Fetch employees ───────────────────────────────────────────────────────────
btnFetchEmp.addEventListener("click", async () => {
  if (!sbKeyEl.value.trim()) return;
  btnFetchEmp.disabled = true;
  btnFetchEmp.innerHTML = `${spinner()} Ophalen...`;
  empStatusEl.innerHTML = "";
  try {
    const data = await sbFetch("/users?limit=250");
    const raw = data.data || data.users || data || [];
    employees = raw.map(item => item.User || item);
    console.log("Employees:", employees);
    empStatusEl.innerHTML = `<div class="status-bar status-ok">✓ ${employees.length} medewerkers</div>`;
    if (shifts) renderShifts();
  } catch (e) {
    empStatusEl.innerHTML = `<div class="status-bar status-err">✗ ${e.message}</div>`;
  } finally {
    btnFetchEmp.disabled = false;
    btnFetchEmp.innerHTML = "👥 Opvragen medewerkers";
  }
});

// ── Image upload ──────────────────────────────────────────────────────────────
fileInput.addEventListener("change", e => handleFile(e.target.files[0]));
uploadZone.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("drag"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("drag"));
uploadZone.addEventListener("drop", e => {
  e.preventDefault();
  uploadZone.classList.remove("drag");
  handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    imgBase64 = e.target.result.split(",")[1];
    imgPreview.src = e.target.result;
    imgPreview.style.display = "block";
    btnParse.disabled = false;
    btnClearImg.style.display = "inline-flex";
    shifts = null;
    renderShifts();
  };
  reader.readAsDataURL(file);
}

btnClearImg.addEventListener("click", () => {
  imgBase64 = null;
  imgPreview.src = "";
  imgPreview.style.display = "none";
  fileInput.value = "";
  btnParse.disabled = true;
  btnClearImg.style.display = "none";
  shifts = null;
  renderShifts();
});

// ── Parse photo ───────────────────────────────────────────────────────────────
btnParse.addEventListener("click", async () => {
  if (!imgBase64) return;
  btnParse.disabled = true;
  btnParse.innerHTML = `${spinner()} Analyseert...`;
  clearLog();
  log("Foto wordt geanalyseerd...", "info");
  try {
    const d = await claudeFetch({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: imgBase64 } },
          { type: "text", text: PARSE_PROMPT }
        ]
      }]
    });

    const txt = (d.content || []).find(b => b.type === "text");
    if (!txt) throw new Error("Geen respons van Claude");

    const parsed = JSON.parse(txt.text.replace(/```json|```/g, "").trim());
    shifts = parsed.map(s => ({
      ...s,
      employeeMap: Object.fromEntries(
        (s.employees || []).map(name => {
          const m = matchEmployee(name);
          return [name, m ? String(m.id) : ""];
        })
      )
    }));

    log(`${shifts.length} shift(s) gevonden`, "ok");
    shifts.forEach(s => {
      const matched = Object.values(s.employeeMap).filter(Boolean).length;
      log(`  → ${s.location} | ${s.opdrachtgever || "geen opdrachtgever"} | ${matched}/${s.employees.length} gekoppeld`, "info");
    });
    renderShifts();
  } catch (e) {
    log("Fout: " + e.message, "err");
  } finally {
    btnParse.disabled = false;
    btnParse.innerHTML = "⚡ Parseer foto";
  }
});

// ── Render shifts ─────────────────────────────────────────────────────────────
function renderShifts() {
  if (!shifts || shifts.length === 0) {
    shiftsCont.innerHTML = '<div class="empty">Parseer eerst een foto</div>';
    runRow.style.display = "none";
    shiftsLabel.textContent = "Shifts";
    return;
  }

  const totalEmp  = shifts.reduce((a, s) => a + Object.keys(s.employeeMap).length, 0);
  const mappedEmp = shifts.reduce((a, s) => a + Object.values(s.employeeMap).filter(Boolean).length, 0);
  shiftsLabel.innerHTML = `Shifts <span style="color:#444;margin-left:8px">— ${shifts.length} locatie(s) · ${mappedEmp}/${totalEmp} gekoppeld</span>`;

  shiftsCont.innerHTML = shifts.map((shift, idx) => {
    const remark = buildRemark(shift);
    const empRows = Object.entries(shift.employeeMap).map(([name, empId]) => {
      if (employees) {
        const opts = employees.map(e =>
          `<option value="${e.id}"${String(e.id) === empId ? " selected" : ""}>${e.first_name} ${e.last_name}</option>`
        ).join("");
        return `<div class="emp-row">
          <span class="emp-name">${name}</span>
          <select class="emp-sel ${empId ? "matched" : "unmatched"}" data-shift="${idx}" data-name="${encodeURIComponent(name)}">
            <option value="">— selecteer —</option>${opts}
          </select>
          <span class="dot ${empId ? "dot-g" : "dot-y"}"></span>
        </div>`;
      }
      return `<div class="emp-row">
        <span class="emp-name">${name}</span>
        <input class="inp-sm" placeholder="Haal medewerkers op" disabled />
        <span class="dot dot-y"></span>
      </div>`;
    }).join("");

    return `<div class="card" data-idx="${idx}">
      <div class="card-head">
        <div style="flex:1">
          <div class="odr-row">
            <span class="odr-label">Opdrachtgever</span>
            <input class="odr-inp" data-shift="${idx}" data-field="opdrachtgever" placeholder="naam opdrachtgever" value="${shift.opdrachtgever || ""}" />
          </div>
          <div class="card-title">${shift.location}</div>
          <div class="badges">
            <span class="badge badge-purple">⏰ Melden ${shift.reportTime || "—"}</span>
            ${shift.reportContext ? `<span class="badge badge-purple">${shift.reportContext}</span>` : ""}
            ${shift.vehicle ? `<span class="badge badge-blue">🚌 ${shift.vehicle}</span>` : ""}
            <span class="badge badge-green">Shift ${SHIFT_START} → ${SHIFT_END}</span>
          </div>
        </div>
        <button class="btn btn-red" data-remove="${idx}">✕</button>
      </div>
      <div class="remark-preview">Omschrijving: <span>${remark || "—"}</span></div>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Medewerkers</div>
      <div class="emp-grid">${empRows}</div>
    </div>`;
  }).join("");

  runRow.style.display = "flex";
  btnRun.disabled = mappedEmp === 0 || !sbKeyEl.value.trim();
  runWarning.textContent = mappedEmp < totalEmp ? `⚠ ${totalEmp - mappedEmp} medewerker(s) niet gekoppeld` : "";

  shiftsCont.querySelectorAll("[data-remove]").forEach(btn =>
    btn.addEventListener("click", () => { shifts.splice(Number(btn.dataset.remove), 1); renderShifts(); })
  );
  shiftsCont.querySelectorAll("[data-field='opdrachtgever']").forEach(inp =>
    inp.addEventListener("input", () => { shifts[Number(inp.dataset.shift)].opdrachtgever = inp.value; })
  );
  shiftsCont.querySelectorAll(".emp-sel").forEach(sel =>
    sel.addEventListener("change", () => {
      shifts[Number(sel.dataset.shift)].employeeMap[decodeURIComponent(sel.dataset.name)] = sel.value;
      sel.className = "emp-sel " + (sel.value ? "matched" : "unmatched");
      sel.parentElement.querySelector(".dot").className = "dot " + (sel.value ? "dot-g" : "dot-y");
      updateStats();
    })
  );
}

function updateStats() {
  const totalEmp  = shifts.reduce((a, s) => a + Object.keys(s.employeeMap).length, 0);
  const mappedEmp = shifts.reduce((a, s) => a + Object.values(s.employeeMap).filter(Boolean).length, 0);
  shiftsLabel.innerHTML = `Shifts <span style="color:#444;margin-left:8px">— ${shifts.length} locatie(s) · ${mappedEmp}/${totalEmp} gekoppeld</span>`;
  btnRun.disabled = mappedEmp === 0 || !sbKeyEl.value.trim();
  runWarning.textContent = mappedEmp < totalEmp ? `⚠ ${totalEmp - mappedEmp} medewerker(s) niet gekoppeld` : "";
}

// ── Run ───────────────────────────────────────────────────────────────────────
btnRun.addEventListener("click", async () => {
  btnRun.disabled = true;
  btnRun.innerHTML = `${spinner(true)} Verwerken...`;
  clearLog();

  const teamCache = {};
  const date = dateEl.value;

  log("Teams ophalen...", "info");
  let existingTeams = [];
  try {
    const td = await sbFetch("/teams?limit=250");
    existingTeams = td.data || td.teams || td || [];
    log(`${existingTeams.length} bestaande teams gevonden`, "ok");
  } catch (e) { log("Teams ophalen mislukt: " + e.message, "err"); btnRun.disabled = false; btnRun.textContent = "🚀 Verwerk alle shifts"; return; }

  log(`Shifts ophalen voor ${date}...`, "info");
  let existingShifts = [];
  try {
    const sd = await sbFetch(`/shifts?start=${date}T00:00:00&end=${date}T23:59:59&limit=500`);
    existingShifts = sd.data || sd.shifts || sd || [];
    log(`${existingShifts.length} bestaande shifts gevonden`, "ok");
  } catch (e) { log("Shifts ophalen mislukt (doorgaan): " + e.message, "warn"); }

  for (const shift of shifts) {
    const remark = buildRemark(shift);
    log(`── ${shift.location}`, "info");

    let teamId = null;
    if (shift.opdrachtgever) {
      const odrName = shift.opdrachtgever.trim();
      if (teamCache[odrName]) {
        teamId = teamCache[odrName];
        log(`  Team "${odrName}" al verwerkt`, "ok");
      } else {
        const found = existingTeams.find(t => t.name && t.name.toLowerCase() === odrName.toLowerCase());
        if (found) {
          teamId = found.id;
          log(`  Team "${odrName}" bestaat al`, "ok");
        } else {
          try {
            const nt = await sbFetch("/teams", { method: "POST", body: JSON.stringify({ name: odrName }) });
            teamId = (nt.data || nt).id;
            existingTeams.push({ id: teamId, name: odrName });
            log(`  ✓ Team "${odrName}" aangemaakt`, "ok");
          } catch (e) { log(`  ✗ Team aanmaken mislukt: ${e.message}`, "err"); }
        }
        if (teamId) teamCache[odrName] = teamId;
      }
    }

    let shiftId = null;
    const found = existingShifts.find(es =>
      es.name && es.name.toLowerCase() === shift.location.toLowerCase() &&
      (!teamId || es.team_id === teamId || es.department_id === teamId)
    );
    if (found) {
      shiftId = found.id;
      log(`  Shift "${shift.location}" bestaat al`, "ok");
    } else {
      try {
        const body = { name: shift.location, start: `${date}T${SHIFT_START}:00`, end: `${date}T${SHIFT_END}:00`, remark };
        if (teamId) body.team_id = teamId;
        const ns = await sbFetch("/shifts", { method: "POST", body: JSON.stringify(body) });
        shiftId = (ns.data || ns).id;
        existingShifts.push({ id: shiftId, name: shift.location, team_id: teamId });
        log(`  ✓ Shift aangemaakt — ${SHIFT_START}→${SHIFT_END} | "${remark}"`, "ok");
      } catch (e) { log(`  ✗ Shift aanmaken mislukt: ${e.message}`, "err"); }
    }

    for (const [name, empId] of Object.entries(shift.employeeMap)) {
      if (!empId)   { log(`  Overgeslagen: ${name} (niet gekoppeld)`, "warn"); continue; }
      if (!shiftId) { log(`  Overgeslagen: ${name} (geen shift ID)`, "warn"); continue; }
      try {
        await sbFetch(`/shifts/${shiftId}/employees`, { method: "POST", body: JSON.stringify({ employee_id: Number(empId) }) });
        log(`  ✓ ${name} gekoppeld`, "ok");
      } catch (e) {
        try {
          const body = { name: shift.location, employee_id: Number(empId), start: `${date}T${SHIFT_START}:00`, end: `${date}T${SHIFT_END}:00`, remark };
          if (teamId) body.team_id = teamId;
          await sbFetch("/shifts", { method: "POST", body: JSON.stringify(body) });
          log(`  ✓ ${name} — persoonlijke shift aangemaakt`, "ok");
        } catch (e2) { log(`  ✗ ${name}: ${e2.message}`, "err"); }
      }
      await new Promise(r => setTimeout(r, 150));
    }
  }

  log("── Klaar", "ok");
  btnRun.disabled = false;
  btnRun.textContent = "🚀 Verwerk alle shifts";
});
