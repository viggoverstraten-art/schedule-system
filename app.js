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
- Optioneel één of meerdere voertuigen (bijv. "Grijze bus", "Witte bus", "Pu 2 + aanganger")
  Er kunnen meerdere voertuigen op aparte regels staan, neem ze allemaal mee.
- Namen van medewerkers

Geef terug als JSON array met per shift:
- opdrachtgever: string of null
- location: adres/locatienaam
- reportTime: meldtijd als "HH:MM" of null
- reportContext: context bij de meldtijd (bijv. "zaak", "aanwezig") of null
- vehicles: array van voertuigen (leeg array als geen voertuig)
- employees: array van namen

Geef ALLEEN de JSON array terug, geen uitleg of markdown.`;

// ── State ─────────────────────────────────────────────────────────────────────
let employees  = null;
let shifts     = null;
let imgBase64  = null;
let imgMimeType = "image/jpeg";

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
    if (!res.ok) {
      const detail = data.message || data.error || JSON.stringify(data);
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
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
  const vehicles = shift.vehicles || (shift.vehicle ? [shift.vehicle] : []);
  if (vehicles.length > 0) parts.push(vehicles.join(", "));
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
  imgMimeType = file.type || "image/jpeg";
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
          { type: "image", source: { type: "base64", media_type: imgMimeType, data: imgBase64 } },
          { type: "text", text: PARSE_PROMPT }
        ]
      }]
    });

    if (d.error) throw new Error(`Claude API fout: ${d.error.message || JSON.stringify(d.error)}`);
    const txt = (d.content || []).find(b => b.type === "text");
    if (!txt) throw new Error(`Geen respons van Claude (status: ${d.type || "onbekend"}, stop_reason: ${d.stop_reason || "?"})`);

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
            ${(shift.vehicles || (shift.vehicle ? [shift.vehicle] : [])).map(v => `<span class="badge badge-blue">🚌 ${v}</span>`).join("")}
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

  const date = dateEl.value;

  // team wordt per afdeling opgehaald (moet matchen met department)

  // Stap 2: haal alle bestaande afdelingen op
  log("Afdelingen ophalen...", "info");
  let departments = [];
  try {
    const dd = await sbFetch("/departments");
    const rawDepts = dd.data || dd.departments || dd || [];
    departments = rawDepts.map(d => d.Department || d);
    log(`${departments.length} afdelingen gevonden`, "ok");
  } catch (e) {
    log("Afdelingen ophalen mislukt: " + e.message, "err");
    btnRun.disabled = false; btnRun.textContent = "🚀 Verwerk alle shifts"; return;
  }

  for (const shift of shifts) {
    const remark = buildRemark(shift);
    const odrName = (shift.opdrachtgever || shift.location).trim();
    log(`── ${odrName} | ${shift.location}`, "info");

    // Stap 3: zoek of maak de afdeling aan (opdrachtgever)
    let departmentId = null;
    const existingDept = departments.find(d => d.name && d.name.toLowerCase() === odrName.toLowerCase());
    if (existingDept) {
      departmentId = String(existingDept.id);
      log(`  Afdeling "${odrName}" bestaat al (id: ${departmentId})`, "ok");
    } else {
      try {
        const nd = await sbFetch("/departments", {
          method: "POST",
          body: JSON.stringify({ name: odrName })
        });
        const created = nd.data ? (nd.data.Department || nd.data) : (nd.Department || nd);
        departmentId = String(created.id);
        departments.push({ id: departmentId, name: odrName });
        log(`  ✓ Afdeling "${odrName}" aangemaakt (id: ${departmentId})`, "ok");
      } catch (e) {
        log(`  ✗ Afdeling aanmaken mislukt: ${e.message}`, "err"); continue;
      }
    }

    // Stap 4: haal team op dat bij deze afdeling hoort
    let teamId = null;
    try {
      const td = await sbFetch(`/teams?department_id=${departmentId}`);
      const rawTeams = td.data || td.teams || td || [];
      const teams = rawTeams.map(t => t.Team || t);
      if (teams.length === 0) throw new Error("Geen team gevonden voor afdeling");
      teamId = String(teams[0].id);
      log(`  Team "${teams[0].name}" gevonden (id: ${teamId})`, "ok");
    } catch (e) {
      log(`  ✗ Team ophalen mislukt: ${e.message}`, "err"); continue;
    }

    // Stap 6: zoek of maak een shift-template aan binnen de afdeling op locatienaam
    let shiftId = null;
    try {
      const sd = await sbFetch(`/shifts?department_id=${departmentId}`);
      const rawShifts = sd.data || sd.shifts || sd || [];
      const deptShifts = rawShifts.map(s => s.Shift || s);
      const locLower = shift.location.toLowerCase();
      const found = deptShifts.find(s =>
        (s.long_name && s.long_name.toLowerCase() === locLower) ||
        (s.name && s.name.toLowerCase() === locLower)
      );
      if (found) {
        shiftId = String(found.id);
        log(`  Shift "${shift.location}" bestaat al (id: ${shiftId})`, "ok");
      }
    } catch (e) {
      log(`  Shifts ophalen mislukt (doorgaan): ${e.message}`, "warn");
    }

    if (!shiftId) {
      try {
        const ns = await sbFetch("/shifts", {
          method: "POST",
          body: JSON.stringify({
            Shift: {
              department_id: departmentId,
              name: shift.location.replace(/[^a-zA-Z0-9]/g, "").substring(0, 4).toUpperCase(),
              long_name: shift.location,
              description: remark || shift.location,
              starttime: `${SHIFT_START}:00`,
              endtime: `${SHIFT_END}:00`,
              break: 0,
            }
          })
        });
        const created = ns.data ? (ns.data.Shift || ns.data) : (ns.Shift || ns);
        shiftId = String(created.id);
        log(`  ✓ Shift template aangemaakt (id: ${shiftId})`, "ok");
      } catch (e) {
        log(`  ✗ Shift aanmaken mislukt: ${e.message}`, "err"); continue;
      }
    }

    // Stap 7: maak rooster aan per medewerker
    for (const [name, empId] of Object.entries(shift.employeeMap)) {
      if (!empId) { log(`  Overgeslagen: ${name} (niet gekoppeld)`, "warn"); continue; }
      try {
        await sbFetch("/rosters", {
          method: "POST",
          body: JSON.stringify({
            Roster: {
              id: null,
              date,
              department_id: departmentId,
              user_id: [empId],
              team_id: teamId,
              shift_id: shiftId,
              starttime: `${SHIFT_START}:00`,
              endtime: `${SHIFT_END}:00`,
              break: "0",
              paid_break: "0",
              description: remark || "",
              recurring: false,
            },
            Notify: false
          })
        });
        log(`  ✓ ${name} ingepland`, "ok");
      } catch (e) {
        log(`  ✗ ${name}: ${e.message}`, "err");
      }
      await new Promise(r => setTimeout(r, 150));
    }
  }

  log("── Klaar", "ok");
  btnRun.disabled = false;
  btnRun.textContent = "🚀 Verwerk alle shifts";
});
