(() => {
  "use strict";

  const DATA = window.BXP_DATA;
  const ITEMS = DATA.items;
  const byId = Object.fromEntries(ITEMS.map(i => [i.id, i]));
  const isEvo = i => i.recipes.length > 0;
  const usedIn = {};
  ITEMS.forEach(r => r.recipes.forEach(parts => parts.forEach(p => {
    (usedIn[p] ||= []).push({ result: r.id, parts });
  })));

  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("bxp." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("bxp." + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  $("#ver").textContent = DATA.gameVersion ? `game v${DATA.gameVersion}` : "";

  // ---------- shared rendering ----------
  function icon(id, cls = "", attrs = "") {
    const it = byId[id];
    if (!it) return "";
    const img = it.icon
      ? `<img src="${esc(it.icon)}" alt="" loading="lazy">`
      : `<span class="pixel" style="color:${esc(it.color || "#fff")}">${esc(it.name[0])}</span>`;
    return `<span class="ico ${it.kind} ${cls}" data-id="${esc(id)}" title="${esc(it.name)}" tabindex="0" ${attrs}>${img}${it.dlc ? '<span class="dlc"></span>' : ""}</span>`;
  }
  const tierBadge = t => t ? `<span class="tier t${t}">T${t}</span>` : `<span class="tier">Base</span>`;
  const dlcOk = (it, dlc) => dlc || !it.dlc;
  const recipeDlcOk = (parts, dlc) => dlc || parts.every(p => !byId[p].dlc);

  // Try to express 2-part recipes as (A1 or A2…) + (B1 or B2…)
  function factor(recipes) {
    if (recipes.length < 2 || !recipes.every(r => r.length === 2)) return null;
    const key = (a, b) => [a, b].sort().join("|");
    const set = new Set(recipes.map(r => key(r[0], r[1])));
    const nb = x => new Set(recipes.flatMap(r => r[0] === x ? [r[1]] : r[1] === x ? [r[0]] : []));
    const [a, b] = recipes[0];
    const A = [...nb(b)], B = [...nb(a)];
    if (A.some(x => B.includes(x)) || A.length * B.length !== recipes.length) return null;
    for (const x of A) for (const y of B) if (!set.has(key(x, y))) return null;
    // put the single (shared) part first
    return A.length <= B.length ? [A, B] : [B, A];
  }

  // markFn(id) -> extra class for icon
  function formula(recipes, markFn = () => "") {
    const grp = ids => ids.length === 1
      ? icon(ids[0], markFn(ids[0]))
      : `<span class="alts">${ids.map(i => icon(i, markFn(i))).join('<span class="op or">or</span>')}</span>`;
    if (recipes.length === 1) {
      return `<div class="formula">${recipes[0].map(p => icon(p, markFn(p))).join('<span class="op">+</span>')}</div>`;
    }
    const f = factor(recipes);
    if (f) return `<div class="formula">${grp(f[0])}<span class="op">+</span>${grp(f[1])}</div>`;
    return `<div class="formula-lines">${recipes.map(r =>
      `<div class="formula">${r.map(p => icon(p, markFn(p))).join('<span class="op">+</span>')}</div>`
    ).join('<div class="orline">or</div>')}</div>`;
  }

  function prettyDesc(d) {
    return esc(d || "")
      .replace(/\{\[([a-z0-9_]+)\]\}/gi, (_, k) => `<span class="ph" title="${esc(k.replace(/_/g, " "))}">X</span>`)
      .replace(/[{}]/g, "");
  }

  // ---------- detail dialog ----------
  function openDetail(id) {
    const it = byId[id];
    if (!it) return;
    const made = it.recipes.length
      ? `<div class="dt-sec"><h4>Made from</h4>${it.recipes.map(r =>
          `<div class="dt-row">${r.map(p => icon(p, "sm")).join('<span class="op">+</span>')}<span class="n">${r.map(p => esc(byId[p].name)).join(" + ")}</span></div>`
        ).join("")}</div>`
      : "";
    const uses = (usedIn[id] || []);
    const used = uses.length
      ? `<div class="dt-sec"><h4>Used in</h4>${uses.map(u =>
          `<div class="dt-row">${u.parts.filter(p => p !== id).map(p => icon(p, "sm")).join('<span class="op">+</span>')}<span class="op">→</span>${icon(u.result, "sm")}<span class="n">${esc(byId[u.result].name)}${u.parts.length > 2 ? ` (with ${u.parts.filter(p => p !== id).map(p => esc(byId[p].name)).join(", ")})` : ` (with ${esc(byId[u.parts.find(p => p !== id)].name)})`}</span></div>`
        ).join("")}</div>`
      : "";
    const canAdd = currentView === "run" || currentView === "plan";
    $("#detailBody").innerHTML = `
      <div class="dt-head">${icon(id, "lg")}<div><h2>${esc(it.name)}</h2>
        <div style="display:flex;gap:6px;align-items:center;margin-top:4px">${tierBadge(it.tier)}
        <span class="tier">${it.kind === "ball" ? "Ball" : "Passive"}</span>${it.dlc ? '<span class="badge-dlc">Naturalist DLC</span>' : ""}</div></div></div>
      <div class="dt-desc">${prettyDesc(it.desc)}</div>${made}${used}
      ${canAdd ? `<div class="dt-actions"><button class="btn" data-add="${esc(id)}">${currentView === "plan" ? "Add as target" : "Add to run"}</button></div>` : ""}`;
    const dlg = $("#detail");
    if (!dlg.open) dlg.showModal();
  }
  $("#detail").addEventListener("click", e => {
    if (e.target === e.currentTarget) return e.currentTarget.close();
    const add = e.target.closest("[data-add]");
    if (add) { (currentView === "plan" ? addTarget : addToRun)(add.dataset.add); $("#detail").close(); return; }
    const ic = e.target.closest(".ico");
    if (ic) openDetail(ic.dataset.id);
  });

  // ---------- RUN PLANNER ----------
  const run = store.get("run", null) || { ballN: 4, passiveN: 4, ball: [null, null, null, null], passive: [null, null, null, null] };
  const opts = store.get("opts", { dlc: true, fusedEvolve: false });
  // drop unknown ids (after a data update)
  for (const k of ["ball", "passive"]) {
    run[k] = run[k].map(s => s && s.ids.every(i => byId[i]) ? s : null);
  }
  let fuseFrom = null;
  let msg = { text: "", cls: "" };
  const save = () => { store.set("run", run); store.set("opts", opts); };
  const setMsg = (text, cls = "") => { msg = { text, cls }; };

  for (const [sel, k] of [["#ballSlotCount", "ballN"], ["#passiveSlotCount", "passiveN"]]) {
    const el = $(sel);
    el.innerHTML = [1, 2, 3, 4, 5, 6].map(n => `<option ${n === run[k] ? "selected" : ""}>${n}</option>`).join("");
    el.addEventListener("change", () => {
      const kind = k === "ballN" ? "ball" : "passive";
      run[k] = +el.value;
      const filled = run[kind].filter(Boolean);
      run[kind] = Array.from({ length: run[k] }, (_, i) => run[kind][i] || null);
      const kept = run[kind].filter(Boolean).length;
      if (kept < filled.length) setMsg(`Removed ${filled.length - kept} item(s) that no longer fit.`, "warn");
      save(); renderRun();
    });
  }
  $("#optDlc").checked = opts.dlc;
  $("#optFusedEvolve").checked = opts.fusedEvolve;
  $("#optDlc").addEventListener("change", e => { opts.dlc = e.target.checked; save(); renderRun(); });
  $("#optFusedEvolve").addEventListener("change", e => { opts.fusedEvolve = e.target.checked; save(); renderRun(); });
  $("#btnReset").addEventListener("click", () => {
    run.ball = run.ball.map(() => null); run.passive = run.passive.map(() => null);
    fuseFrom = null; setMsg("Run cleared."); save(); renderRun();
  });

  const allHeld = kind => new Set(run[kind].filter(Boolean).flatMap(s => s.ids));
  const usableHeld = kind => new Set(run[kind].filter(s => s && (!s.fused || opts.fusedEvolve)).flatMap(s => s.ids));
  const fusedHeld = kind => new Set(run[kind].filter(s => s && s.fused).flatMap(s => s.ids));
  const freeSlots = kind => run[kind].filter(s => !s).length;

  function fuseCheck(a, b) {
    const sa = run.ball[a], sb = run.ball[b];
    if (!sb) return "Empty slot";
    if (sa.fused || sb.fused) return "Balls can only be fused once";
    const x = sa.ids[0], y = sb.ids[0];
    if (x === y) return "Can't fuse two balls of the same type";
    const evo = ITEMS.find(r => r.kind === "ball" && r.recipes.some(p => p.length === 2 && p.includes(x) && p.includes(y)));
    if (evo) return `These two already form an evolution (${evo.name})`;
    return "";
  }

  function renderSlots(kind) {
    const host = $(kind === "ball" ? "#ballSlots" : "#passiveSlots");
    host.innerHTML = run[kind].map((s, i) => {
      let cls = `slot ${kind} ${s ? "filled" : "empty"}`;
      let title = "Add";
      if (s && s.fused) cls += " fused";
      if (kind === "ball" && fuseFrom !== null) {
        if (i === fuseFrom) cls += " selecting";
        else { const why = fuseCheck(fuseFrom, i); cls += why ? " fuse-bad" : " fuse-target"; title = why || "Fuse with this ball"; }
      }
      let inner = "", name = "", acts = "", drag = "";
      if (s) {
        const its = s.ids.map(id => byId[id]);
        name = its.map(x => x.name).join(" + ");
        if (s.fused) {
          const lv = fuseLevels(s);
          title = `Fused: ${its.map((x, k) => `${x.name} (Lv ${lv[k]})`).join(" + ")}`;
          inner = `<div class="fuse-split">${its.map((x, k) => `<img class="half h${k}" src="${esc(x.icon)}" alt="">`).join("")}<span class="seam"></span></div>
            ${DATA.ui?.fusion ? `<img class="fuse-badge" src="${esc(DATA.ui.fusion)}" alt="">` : ""}
            <span class="lv">${lv[0]}·${lv[1]}</span>`;
        } else {
          title = name + (kind === "ball" ? " (drag onto another ball to fuse)" : "");
          inner = `<img src="${esc(its[0].icon)}" alt="">`;
        }
        drag = s.fused ? "" : 'draggable="true"';
        acts = `<div class="acts">
          ${kind === "ball" && !s.fused ? `<button data-act="fuse" title="Fuse with another ball">⧉</button>` : ""}
          ${s.fused ? `<button data-act="edit" title="Edit fusion">✎</button>` : ""}
          <button data-act="info" title="Details">i</button>
          <button data-act="remove" title="Remove">✕</button></div>`;
      }
      return `<div class="slot-wrap"><div class="${cls}" data-kind="${kind}" data-i="${i}" title="${esc(title)}" tabindex="0" role="button" ${drag}>${inner}${acts}${name ? `<span class="name">${esc(name)}</span>` : ""}</div></div>`;
    }).join("");
  }

  function analyse(kind) {
    const usable = usableHeld(kind), held = allHeld(kind), fused = fusedHeld(kind);
    const free = freeSlots(kind);
    const out = [];
    for (const r of ITEMS) {
      if (r.kind !== kind || !isEvo(r) || held.has(r.id) || !dlcOk(r, opts.dlc)) continue;
      let best = null;
      const viable = [];
      for (const parts of r.recipes) {
        if (!recipeDlcOk(parts, opts.dlc)) continue;
        if (!opts.fusedEvolve && parts.some(p => fused.has(p) && !usable.has(p))) continue;
        const have = parts.filter(p => usable.has(p));
        const miss = parts.filter(p => !usable.has(p));
        const e = { parts, have, miss };
        viable.push(e);
        if (!best || miss.length < best.miss.length || (miss.length === best.miss.length && have.length > best.have.length)) best = e;
      }
      if (!best) continue;
      if (usable.size && best.have.length === 0) continue;
      const tied = viable.filter(v => v.miss.length === best.miss.length);
      out.push({ r, best, viable, tied, blocked: best.miss.length > free });
    }
    return { out, usable, hasAny: held.size > 0 };
  }

  function evoCard(a, usable) {
    const { r, best, viable, tied, blocked } = a;
    const ready = best.miss.length === 0;
    const mark = id => usable.has(id) ? "held" : "miss";
    let need = "";
    if (!ready) {
      const opts_ = tied.map(t => t.miss.map(m => byId[m].name).join(" + "));
      need = `Needs ${[...new Set(opts_)].join(" or ")}${blocked ? " · no free slot" : ""}`;
    }
    return `<div class="evo-card ${ready ? "ready" : ""} ${blocked ? "blocked" : ""}">
      ${icon(r.id, "", 'data-role="result"')}
      <div class="info">
        <div class="nm"><span class="t">${esc(r.name)}</span>${tierBadge(r.tier)}${r.dlc ? '<span class="badge-dlc">DLC</span>' : ""}</div>
        ${formula(viable.map(v => v.parts), mark)}
        ${need ? `<div class="need">${esc(need)}</div>` : ""}
      </div>
      ${ready ? `<button class="btn small" data-evolve="${esc(r.id)}">Evolve</button>` : ""}
    </div>`;
  }

  function renderEvos(kind) {
    const host = $(kind === "ball" ? "#ballEvos" : "#passiveEvos");
    const { out, usable, hasAny } = analyse(kind);
    if (!hasAny) {
      host.innerHTML = `<div class="empty-note">Add ${kind === "ball" ? "balls" : "passives"} to see which evolutions they lead to.</div>`;
      return;
    }
    if (!usable.size) {
      host.innerHTML = `<div class="empty-note">Fused balls don't evolve further. Add more balls to see evolutions (or turn on “Fused balls can evolve”).</div>`;
      return;
    }
    const sortFn = (x, y) => x.r.tier - y.r.tier || x.r.name.localeCompare(y.r.name);
    const ready = out.filter(a => a.best.miss.length === 0).sort(sortFn);
    const one = out.filter(a => a.best.miss.length === 1).sort((x, y) => x.blocked - y.blocked || sortFn(x, y));
    const more = out.filter(a => a.best.miss.length >= 2).sort((x, y) => x.best.miss.length - y.best.miss.length || sortFn(x, y));
    const group = (cls, title, list) => list.length
      ? `<div class="evo-group ${cls}"><div class="gh">${title}<span class="count">${list.length}</span></div><div class="evo-list">${list.map(a => evoCard(a, usable)).join("")}</div></div>` : "";
    let html = group("ready", "Ready to evolve", ready) + group("one", "One away", one);
    if (more.length) html += `<details class="more evo-group" open><summary>Further away (${more.length})</summary><div class="evo-list">${more.map(a => evoCard(a, usable)).join("")}</div></details>`;
    host.innerHTML = html || `<div class="empty-note">No evolutions left for this combination.</div>`;
  }

  function renderRun() {
    renderSlots("ball"); renderSlots("passive");
    renderEvos("ball"); renderEvos("passive");
    const m = $("#runMsg");
    if (fuseFrom !== null) { m.textContent = `Fusing ${byId[run.ball[fuseFrom].ids[0]].name}: pick another fully upgraded ball (Esc to cancel).`; m.className = "run-msg warn"; }
    else { m.textContent = msg.text || "Click a slot to add a ball or passive. Click a dimmed part in an evolution to add it."; m.className = "run-msg " + msg.cls; }
  }

  function addToRun(id, slotIndex = null) {
    const it = byId[id];
    const kind = it.kind;
    if (allHeld(kind).has(id)) { setMsg(`${it.name} is already in your run.`, "warn"); renderRun(); return false; }
    const i = slotIndex ?? run[kind].findIndex(s => !s);
    if (i < 0) { setMsg(`No free ${kind} slot for ${it.name}.`, "bad"); renderRun(); return false; }
    run[kind][i] = { ids: [id] };
    setMsg(`Added ${it.name}.`);
    save(); renderRun(); return true;
  }

  function evolve(id) {
    const r = byId[id], kind = r.kind;
    const usable = usableHeld(kind);
    const parts = r.recipes.find(p => recipeDlcOk(p, opts.dlc) && p.every(x => usable.has(x)));
    if (!parts) return;
    const idx = parts.map(p => run[kind].findIndex(s => s && s.ids.includes(p) && (!s.fused || opts.fusedEvolve)));
    const target = Math.min(...idx);
    idx.forEach(i => { run[kind][i] = null; });
    run[kind][target] = { ids: [id] };
    setMsg(`Evolved ${parts.map(p => byId[p].name).join(" + ")} into ${r.name}.`);
    save(); renderRun();
  }

  function slotClick(kind, i, act) {
    const s = run[kind][i];
    if (kind === "ball" && fuseFrom !== null) {
      if (i === fuseFrom) { fuseFrom = null; renderRun(); return; }
      const from = fuseFrom;
      fuseFrom = null;
      doFuse(from, i);
      return;
    }
    if (act === "remove") { run[kind][i] = null; setMsg(""); save(); renderRun(); return; }
    if (act === "info") { openDetail(s.ids[0]); return; }
    if (act === "fuse") { fuseFrom = i; renderRun(); return; }
    if (act === "edit" || (s && s.fused && !act)) { openFuseEdit(i); return; }
    openPicker(kind, i);
  }

  const DEFAULT_FUSE_LV = 3; // fusion needs fully upgraded balls
  const fuseLevels = s => (s.levels && s.levels.length === 2) ? s.levels : [DEFAULT_FUSE_LV, DEFAULT_FUSE_LV];

  // fuse ball slot b into slot a (result lands in slot a)
  function doFuse(a, b) {
    const why = fuseCheck(a, b);
    if (why) { setMsg(why, "bad"); renderRun(); return; }
    const x = run.ball[a].ids[0], y = run.ball[b].ids[0];
    run.ball[a] = { ids: [x, y], fused: true, levels: [DEFAULT_FUSE_LV, DEFAULT_FUSE_LV] };
    run.ball[b] = null;
    setMsg(`Fused ${byId[x].name} + ${byId[y].name}. That frees a slot.`);
    save(); renderRun();
  }

  function unfuse(i) {
    const s = run.ball[i];
    const j = run.ball.findIndex((x, k) => !x && k !== i);
    run.ball[i] = { ids: [s.ids[0]] };
    if (j >= 0) run.ball[j] = { ids: [s.ids[1]] };
    setMsg(j >= 0 ? "Unfused." : `Unfused; no free slot, so ${byId[s.ids[1]].name} was dropped.`, j >= 0 ? "" : "warn");
    save(); renderRun();
  }

  // ---------- fusion editor ----------
  let fuseEditIdx = null;
  function openFuseEdit(i) {
    const s = run.ball[i];
    if (!s || !s.fused) return;
    fuseEditIdx = i;
    const lv = fuseLevels(s);
    $("#fuseEditBody").innerHTML = s.ids.map((id, k) => `
      <div class="fe-row">${icon(id)}<span class="fe-name">${esc(byId[id].name)}</span>
        <span class="mini">Level when fused</span>
        <span class="stepper">
          <button type="button" data-step="-1" data-k="${k}" aria-label="Lower level" ${lv[k] <= 1 ? "disabled" : ""}>−</button>
          <span class="val" data-val="${k}">${lv[k]}</span>
          <button type="button" data-step="1" data-k="${k}" aria-label="Raise level" ${lv[k] >= 10 ? "disabled" : ""}>+</button>
        </span></div>`).join("") +
      `<p class="fe-note">Fusing needs fully upgraded balls, so this starts at level ${DEFAULT_FUSE_LV}. Some upgrades raise the max level of fused balls. The level will feed the DPS calculator later.</p>`;
    $("#fuseEdit").showModal();
  }
  $("#fuseEdit").addEventListener("click", e => {
    if (e.target === e.currentTarget) return e.currentTarget.close();
    const step = e.target.closest("[data-step]");
    if (step && fuseEditIdx !== null) {
      const s = run.ball[fuseEditIdx];
      const k = +step.dataset.k;
      const lv = [...fuseLevels(s)];
      lv[k] = Math.min(10, Math.max(1, lv[k] + +step.dataset.step));
      s.levels = lv;
      const row = step.closest(".stepper");
      row.querySelector(".val").textContent = lv[k];
      row.querySelector('[data-step="-1"]').disabled = lv[k] <= 1;
      row.querySelector('[data-step="1"]').disabled = lv[k] >= 10;
      save(); renderSlots("ball");
      return;
    }
    if (e.target.closest("#feUnfuse")) { const i = fuseEditIdx; e.currentTarget.close(); unfuse(i); }
  });
  $("#fuseEdit").addEventListener("close", () => { fuseEditIdx = null; });

  // ---------- drag and drop ----------
  // ball onto ball = fuse; anything onto an empty slot of the same kind = move
  let dragFrom = null;
  const dropOk = (kind, to) => {
    if (!dragFrom || dragFrom.kind !== kind || dragFrom.i === to) return "";
    if (!run[kind][to]) return "move";
    if (kind === "ball" && !fuseCheck(dragFrom.i, to)) return "fuse";
    return "";
  };
  for (const sel of ["#ballSlots", "#passiveSlots"]) {
    const host = $(sel);
    host.addEventListener("dragstart", e => {
      const slot = e.target.closest(".slot.filled"); if (!slot) return;
      dragFrom = { kind: slot.dataset.kind, i: +slot.dataset.i };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", run[dragFrom.kind][dragFrom.i].ids[0]);
      slot.classList.add("dragging");
      // mark targets
      host.querySelectorAll(".slot").forEach(el => {
        const k = +el.dataset.i;
        if (k === dragFrom.i) return;
        const ok = dropOk(dragFrom.kind, k);
        el.classList.add(ok ? "drop-ok" : "drop-bad");
        if (!ok && el.classList.contains("filled") && dragFrom.kind === "ball") el.title = fuseCheck(dragFrom.i, k);
      });
    });
    host.addEventListener("dragover", e => {
      const slot = e.target.closest(".slot"); if (!slot || !dragFrom) return;
      if (dropOk(slot.dataset.kind, +slot.dataset.i)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; slot.classList.add("drop-hover"); }
    });
    host.addEventListener("dragleave", e => {
      const slot = e.target.closest(".slot"); if (slot && !slot.contains(e.relatedTarget)) slot.classList.remove("drop-hover");
    });
    host.addEventListener("drop", e => {
      const slot = e.target.closest(".slot"); if (!slot || !dragFrom) return;
      e.preventDefault();
      const kind = slot.dataset.kind, to = +slot.dataset.i, from = dragFrom.i;
      const how = dropOk(kind, to);
      dragFrom = null;
      if (how === "move") { run[kind][to] = run[kind][from]; run[kind][from] = null; setMsg(""); save(); renderRun(); }
      else if (how === "fuse") doFuse(to, from);
    });
    host.addEventListener("dragend", () => { dragFrom = null; renderSlots(sel === "#ballSlots" ? "ball" : "passive"); });
  }

  for (const sel of ["#ballSlots", "#passiveSlots"]) {
    $(sel).addEventListener("click", e => {
      const slot = e.target.closest(".slot"); if (!slot) return;
      const act = e.target.closest("[data-act]")?.dataset.act;
      slotClick(slot.dataset.kind, +slot.dataset.i, act);
    });
    $(sel).addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("slot")) {
        e.preventDefault(); slotClick(e.target.dataset.kind, +e.target.dataset.i);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && e.target.classList.contains("slot") && run[e.target.dataset.kind][+e.target.dataset.i]) {
        slotClick(e.target.dataset.kind, +e.target.dataset.i, "remove");
      }
    });
  }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && fuseFrom !== null) { fuseFrom = null; renderRun(); }
  });
  for (const sel of ["#ballEvos", "#passiveEvos"]) {
    $(sel).addEventListener("click", e => {
      const ev = e.target.closest("[data-evolve]");
      if (ev) return evolve(ev.dataset.evolve);
      const ic = e.target.closest(".ico");
      if (!ic) return;
      if (ic.classList.contains("miss")) addToRun(ic.dataset.id);
      else openDetail(ic.dataset.id);
    });
  }

  // ---------- picker ----------
  let pick = null;
  function openPicker(kind, slot, mode = "run") {
    pick = { kind, slot, mode };
    $("#pkTitle").textContent = (mode === "plan" ? "Target " : "Choose a ") + (kind === "ball" ? "ball" : "passive");
    $("#pkQ").value = "";
    renderPicker();
    $("#picker").showModal();
    $("#pkQ").focus();
  }
  function renderPicker() {
    const { kind, slot, mode } = pick;
    const q = $("#pkQ").value.trim().toLowerCase();
    let held, dlc;
    if (mode === "plan") {
      held = new Set(plan[kind].filter((x, i) => x && i !== slot));
      dlc = plan.dlc;
    } else {
      const cur = run[kind][slot];
      held = allHeld(kind);
      if (cur) cur.ids.forEach(i => held.delete(i));
      dlc = opts.dlc;
    }
    const list = ITEMS.filter(i => i.kind === kind && dlcOk(i, dlc) && (!q || i.name.toLowerCase().includes(q)));
    let secs = [[0, "Base"], [1, "Tier 1 evolutions"], [2, "Tier 2 evolutions"], [3, "Tier 3 evolutions"]];
    if (mode === "plan") secs = secs.reverse();
    const html = secs.map(([t, label]) => {
      const xs = list.filter(i => i.tier === t);
      if (!xs.length) return "";
      return `<div class="pk-sec"><h4>${label}</h4><div class="pk-grid">${xs.map(i =>
        `<button class="pk-item" data-id="${esc(i.id)}" ${held.has(i.id) ? "disabled title='Already in your run'" : ""}>${icon(i.id)}<span class="n">${esc(i.name)}</span></button>`
      ).join("")}</div></div>`;
    }).join("");
    $("#pkBody").innerHTML = html || `<div class="empty-note">Nothing matches.</div>`;
  }
  $("#pkQ").addEventListener("input", renderPicker);
  $("#pkQ").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); const b = $("#pkBody .pk-item:not([disabled])"); if (b) b.click(); }
  });
  $("#pkBody").addEventListener("click", e => {
    const b = e.target.closest(".pk-item"); if (!b || b.disabled) return;
    if (pick.mode === "plan") {
      plan[pick.kind][pick.slot] = b.dataset.id;
      savePlan(); renderPlan();
    } else {
      run[pick.kind][pick.slot] = null;
      addToRun(b.dataset.id, pick.slot);
    }
    $("#picker").close();
  });
  $("#picker").addEventListener("click", e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  // ---------- LEGEND ----------
  const leg = Object.assign({ q: "", kind: "ball", group: "tier", dlc: true, ing: null }, store.get("legend", {}));
  leg.ing = null;
  const saveLeg = () => store.set("legend", { kind: leg.kind, group: leg.group, dlc: leg.dlc });
  function segInit(sel, key) {
    const el = $(sel);
    el.querySelectorAll("button").forEach(b => b.classList.toggle("on", b.dataset.v === leg[key]));
    el.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      leg[key] = b.dataset.v;
      if (key === "kind") leg.ing = null;
      el.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      saveLeg(); renderLegend();
    });
  }
  segInit("#kindSeg", "kind");
  segInit("#groupSeg", "group");
  $("#legDlc").checked = leg.dlc;
  $("#legDlc").addEventListener("change", e => { leg.dlc = e.target.checked; saveLeg(); renderLegend(); });
  $("#q").addEventListener("input", e => { leg.q = e.target.value.trim().toLowerCase(); renderLegend(); });
  $("#ingClear").addEventListener("click", () => { leg.ing = null; renderLegend(); });
  $("#ingStrip").addEventListener("click", e => {
    const ic = e.target.closest(".ico"); if (!ic) return;
    leg.ing = leg.ing === ic.dataset.id ? null : ic.dataset.id;
    renderLegend();
  });
  $("#legend").addEventListener("click", e => {
    const ic = e.target.closest(".ico"); if (ic) openDetail(ic.dataset.id);
  });
  for (const host of ["#legend", "#ballEvos", "#passiveEvos", "#ingStrip"]) {
    $(host).addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("ico")) e.target.click(); });
  }

  function legCard(r) {
    const recipes = r.recipes.filter(p => recipeDlcOk(p, leg.dlc));
    const mark = id => leg.ing === id ? "held" : "";
    return `<div class="leg-card">
      <div class="res">${icon(r.id)}<span class="n">${esc(r.name)}</span>${r.dlc ? '<span class="badge-dlc">DLC</span>' : ""}</div>
      <span class="eq">=</span>
      <div class="parts">${formula(recipes, mark)}</div></div>`;
  }

  function renderLegend() {
    const kind = leg.kind;
    const evos = ITEMS.filter(r => r.kind === kind && isEvo(r) && dlcOk(r, leg.dlc) && r.recipes.some(p => recipeDlcOk(p, leg.dlc)));
    // ingredient strip
    const ingIds = new Set(evos.flatMap(r => r.recipes.filter(p => recipeDlcOk(p, leg.dlc)).flat()));
    const ings = ITEMS.filter(i => ingIds.has(i.id)).sort((a, b) => a.tier - b.tier);
    $("#ingStrip").innerHTML = ings.map(i => icon(i.id, `sm ${leg.ing === i.id ? "on" : ""}`)).join("");
    $("#ingClear").hidden = !leg.ing;

    const q = leg.q;
    const matches = r => {
      const ok = r.recipes.filter(p => recipeDlcOk(p, leg.dlc));
      if (leg.ing && !ok.some(p => p.includes(leg.ing))) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || ok.some(p => p.some(x => byId[x].name.toLowerCase().includes(q)));
    };
    const list = evos.filter(matches);
    const byName = (a, b) => a.name.localeCompare(b.name);
    let html = "";
    if (!list.length) html = `<div class="leg-empty">No evolutions match.</div>`;
    else if (leg.group === "tier") {
      const desc = { 1: "made from base items", 2: "base + evolved", 3: "evolved only" };
      for (const t of [1, 2, 3]) {
        const xs = list.filter(r => r.tier === t);
        if (xs.length) html += `<section class="leg-section"><h2>Tier ${t} <span class="sub">${desc[t]} · ${xs.length}</span></h2><div class="leg-grid">${xs.map(legCard).join("")}</div></section>`;
      }
    } else if (leg.group === "az") {
      html = `<div class="leg-grid">${list.slice().sort(byName).map(legCard).join("")}</div>`;
    } else {
      const heads = leg.ing ? [byId[leg.ing]] : ings;
      for (const h of heads) {
        const xs = list.filter(r => r.recipes.some(p => recipeDlcOk(p, leg.dlc) && p.includes(h.id)));
        if (!xs.length) continue;
        html += `<section class="leg-section"><h2>${icon(h.id, "sm")} ${esc(h.name)} <span class="sub">${xs.length} evolution${xs.length > 1 ? "s" : ""}</span></h2><div class="leg-grid">${xs.sort((a, b) => a.tier - b.tier || byName(a, b)).map(r => legCard(r).replace('class="leg-card"', 'class="leg-card"')).join("")}</div></section>`;
      }
    }
    // when grouping by ingredient, highlight that ingredient inside each section
    $("#legend").innerHTML = html;
  }

  // ---------- PLAN ----------
  const plan = Object.assign(
    { ballN: 4, passiveN: 4, ball: [], passive: [], dlc: true, overrides: {} },
    store.get("plan", {})
  );
  for (const k of ["ball", "passive"]) {
    plan[k] = Array.from({ length: plan[k + "N"] }, (_, i) => (plan[k][i] && byId[plan[k][i]]) ? plan[k][i] : null);
  }
  const savePlan = () => store.set("plan", plan);

  // Peak slots needed to build something from parts built one after another:
  // build the hungriest part first; finished parts sit in slots while the next is built.
  function peakOf(parts) {
    const ps = parts.map(p => p.peak).sort((a, b) => b - a);
    return Math.max(parts.length, 0, ...ps.map((p, i) => i + p));
  }
  const better = (a, b) => a.pickups - b.pickups || a.peak - b.peak;

  // All reasonable ways to build `id` from base items, best first.
  function buildOptions(id, stack = []) {
    const r = byId[id];
    let recs = r.recipes.map((p, i) => ({ p, i }))
      .filter(x => recipeDlcOk(x.p, plan.dlc) && !x.p.some(q => stack.includes(q) || q === id));
    const ov = plan.overrides[id];
    if (ov != null && recs.some(x => x.i === ov)) recs = recs.filter(x => x.i === ov);
    if (!recs.length) return [{ id, base: true, pickups: 1, peak: 1 }];
    const out = [];
    for (const { p, i } of recs) {
      let combos = [[]];
      for (const q of p) {
        const qo = buildOptions(q, [...stack, id]).slice(0, 3);
        const next = [];
        for (const c of combos) for (const o of qo) next.push([...c, o]);
        combos = next.slice(0, 60);
      }
      for (const parts of combos) {
        out.push({ id, recipe: i, parts, pickups: parts.reduce((s, x) => s + x.pickups, 0), peak: peakOf(parts) });
      }
    }
    return out.sort(better).slice(0, 6);
  }

  function solve(kind) {
    const targets = plan[kind].filter(Boolean);
    const slots = plan[kind + "N"];
    let combos = [[]];
    for (const t of targets) {
      const to = buildOptions(t).slice(0, 4);
      const next = [];
      for (const c of combos) for (const o of to) next.push([...c, o]);
      combos = next.slice(0, 3000);
    }
    let best = null;
    for (const c of combos) {
      const peak = peakOf(c), pickups = c.reduce((s, x) => s + x.pickups, 0);
      const over = peak > slots ? 1 : 0;
      // prefer: fits in slots, then fewest pickups, then lowest peak
      if (!best || (over - best.over || pickups - best.pickups || peak - best.peak) < 0) {
        best = { opts: c, peak, pickups, over };
      }
    }
    if (!best) return null;
    // steps
    const held = [], steps = [];
    const emit = opt => {
      if (opt.base) {
        const dupe = held.includes(opt.id);
        held.push(opt.id);
        steps.push({ t: "pick", id: opt.id, held: [...held], dupe });
        return;
      }
      [...opt.parts].sort((a, b) => b.peak - a.peak).forEach(emit);
      for (const p of opt.parts) { const i = held.lastIndexOf(p.id); if (i >= 0) held.splice(i, 1); }
      const dupe = held.includes(opt.id);
      held.push(opt.id);
      steps.push({ t: "evolve", id: opt.id, parts: opt.parts.map(p => p.id), held: [...held], dupe });
    };
    const ordered = [...best.opts].sort((a, b) => b.peak - a.peak);
    for (const o of ordered) {
      if (!o.base) steps.push({ t: "hdr", id: o.id });
      emit(o);
    }
    // warnings
    const warns = [];
    if (best.over) warns.push(`At the busiest point this needs ${best.peak} ${kind} slots, but you have ${slots}. Fusing finished balls frees slots, or drop a target.`);
    const dupes = [...new Set(steps.filter(s => s.dupe).map(s => byId[s.id].name))];
    if (dupes.length) warns.push(`You'd need to hold two of ${dupes.join(", ")} at once. You can't hold duplicates, so build those targets at different times or pick a different recipe.`);
    const inner = new Set();
    const walk = (o, root) => { if (!root && targets.includes(o.id)) inner.add(o.id); (o.parts || []).forEach(p => walk(p, false)); };
    best.opts.forEach(o => walk(o, true));
    inner.forEach(id => warns.push(`${byId[id].name} gets used up making another target, so you'd have to build it twice.`));
    return { ...best, steps, warns, slots, targets };
  }

  function addTarget(id) {
    const kind = byId[id].kind;
    if (plan[kind].includes(id)) return;
    const i = plan[kind].findIndex(x => !x);
    if (i < 0) return;
    plan[kind][i] = id;
    savePlan(); renderPlan();
  }

  for (const [sel, k] of [["#planBallN", "ballN"], ["#planPassiveN", "passiveN"]]) {
    const el = $(sel);
    el.innerHTML = [1, 2, 3, 4, 5, 6].map(n => `<option ${n === plan[k] ? "selected" : ""}>${n}</option>`).join("");
    el.addEventListener("change", () => {
      const kind = k === "ballN" ? "ball" : "passive";
      plan[k] = +el.value;
      plan[kind] = Array.from({ length: plan[k] }, (_, i) => plan[kind][i] || null);
      savePlan(); renderPlan();
    });
  }
  $("#planDlc").checked = plan.dlc;
  $("#planDlc").addEventListener("change", e => { plan.dlc = e.target.checked; savePlan(); renderPlan(); });
  $("#planReset").addEventListener("click", () => {
    plan.ball = plan.ball.map(() => null); plan.passive = plan.passive.map(() => null); plan.overrides = {};
    savePlan(); renderPlan();
  });

  function renderPlanSlots(kind) {
    $(kind === "ball" ? "#planBallSlots" : "#planPassiveSlots").innerHTML = plan[kind].map((id, i) => {
      const it = id && byId[id];
      return `<div class="slot-wrap"><div class="slot ${kind} ${it ? "filled" : "empty"}" data-kind="${kind}" data-i="${i}" tabindex="0" role="button" title="${it ? esc(it.name) : "Add target"}">
        ${it ? `<img src="${esc(it.icon)}" alt=""><div class="acts"><button data-act="info" title="Details">i</button><button data-act="remove" title="Remove">✕</button></div><span class="name">${esc(it.name)}</span>` : ""}
      </div></div>`;
    }).join("");
  }

  function heldRow(held, slots) {
    const free = Math.max(0, slots - held.length);
    return `<div class="held"><span class="lbl">${held.length}/${slots}</span>${held.map(h => icon(h)).join("")}${'<span class="free"></span>'.repeat(free)}</div>`;
  }

  function renderPlanKind(kind) {
    const host = $(kind === "ball" ? "#planBall" : "#planPassive");
    const s = solve(kind);
    if (!s || !s.targets.length) {
      host.innerHTML = `<div class="empty-note">Add target ${kind === "ball" ? "balls" : "passives"} to get a plan.</div>`;
      return;
    }
    // pickup summary
    const counts = {};
    s.steps.filter(x => x.t === "pick").forEach(x => { counts[x.id] = (counts[x.id] || 0) + 1; });
    const evoN = s.steps.filter(x => x.t === "evolve").length;
    const summary = `<div class="plan-card"><h4>Pick up</h4>
      <div class="plan-sum">${Object.entries(counts).map(([id, n]) =>
        n > 1 ? icon(id).replace(/<\/span>$/, `<span class="cnt">×${n}</span></span>`) : icon(id)).join("")}</div>
      <div class="plan-stat"><span><b>${s.pickups}</b> pickups</span><span><b>${evoN}</b> evolutions</span>
        <span class="${s.over ? "bad" : "ok"}">Peak <b>${s.peak}</b> / ${s.slots} slots</span></div>
      ${s.warns.length ? `<ul class="warn-list">${s.warns.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}</div>`;

    // recipe tree with alternative pickers
    const rows = [];
    const seen = new Set();
    const walk = (o, depth) => {
      if (o.base) return;
      const key = o.id + "@" + depth + "@" + rows.length;
      if (!seen.has(key)) {
        seen.add(key);
        const r = byId[o.id];
        const alts = r.recipes.map((p, i) => ({ p, i })).filter(x => recipeDlcOk(x.p, plan.dlc));
        const sel = alts.length > 1
          ? `<select data-ov="${esc(o.id)}" title="Choose recipe"><option value="">Auto (fewest pickups)</option>${alts.map(x =>
              `<option value="${x.i}" ${plan.overrides[o.id] === x.i ? "selected" : ""}>${esc(x.p.map(q => byId[q].name).join(" + "))}</option>`).join("")}</select>`
          : "";
        rows.push(`<div class="tree-row" style="padding-left:${depth * 18}px">${icon(o.id, "sm")}<span class="nm">${esc(r.name)}</span><span class="eq">=</span>${o.parts.map(p => icon(p.id, "sm")).join('<span class="op">+</span>')}${sel}</div>`);
      }
      o.parts.forEach(p => walk(p, depth + 1));
    };
    s.opts.forEach(o => walk(o, 0));
    const tree = rows.length ? `<div class="plan-card"><h4>Recipes used</h4><div class="tree">${rows.join("")}</div></div>` : "";

    // steps
    const steps = `<div class="plan-card"><h4>Order</h4><ol class="steps">${s.steps.map(st => {
      if (st.t === "hdr") return `<li class="hdr">Build ${esc(byId[st.id].name)}</li>`;
      const cls = [st.held.length > s.slots ? "over" : "", st.dupe ? "dupe" : ""].join(" ");
      const act = st.t === "pick"
        ? `<span class="verb pick">Pick up</span>${icon(st.id, "sm")}<span>${esc(byId[st.id].name)}</span>`
        : `<span class="verb evolve">Evolve</span>${st.parts.map(p => icon(p, "sm")).join('<span class="op">+</span>')}<span class="op">→</span>${icon(st.id, "sm")}<span>${esc(byId[st.id].name)}</span>`;
      return `<li class="${cls}"><div><div class="act">${act}</div>${heldRow(st.held, s.slots)}</div></li>`;
    }).join("")}</ol></div>`;

    host.innerHTML = summary + tree + steps;
  }

  function renderPlan() {
    renderPlanSlots("ball"); renderPlanSlots("passive");
    renderPlanKind("ball"); renderPlanKind("passive");
  }

  for (const sel of ["#planBallSlots", "#planPassiveSlots"]) {
    const el = $(sel);
    const act = (slot, a) => {
      const kind = slot.dataset.kind, i = +slot.dataset.i;
      if (a === "remove") { plan[kind][i] = null; savePlan(); renderPlan(); }
      else if (a === "info") openDetail(plan[kind][i]);
      else openPicker(kind, i, "plan");
    };
    el.addEventListener("click", e => {
      const slot = e.target.closest(".slot"); if (!slot) return;
      act(slot, e.target.closest("[data-act]")?.dataset.act);
    });
    el.addEventListener("keydown", e => {
      if (!e.target.classList.contains("slot")) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(e.target); }
      if (e.key === "Delete" || e.key === "Backspace") act(e.target, "remove");
    });
  }
  for (const sel of ["#planBall", "#planPassive"]) {
    const el = $(sel);
    el.addEventListener("change", e => {
      const s = e.target.closest("[data-ov]"); if (!s) return;
      if (s.value === "") delete plan.overrides[s.dataset.ov]; else plan.overrides[s.dataset.ov] = +s.value;
      savePlan(); renderPlan();
    });
    el.addEventListener("click", e => { const ic = e.target.closest(".ico"); if (ic) openDetail(ic.dataset.id); });
    el.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("ico")) e.target.click(); });
  }

  // ---------- routing ----------
  let currentView = "run";
  function route() {
    currentView = { "#legend": "legend", "#plan": "plan" }[location.hash] || "run";
    document.querySelectorAll(".view").forEach(v => { v.hidden = v.id !== "view-" + currentView; });
    document.querySelectorAll(".tabs a").forEach(a => a.classList.toggle("on", a.dataset.tab === currentView));
    if (currentView === "run") renderRun();
    else if (currentView === "plan") renderPlan();
    else renderLegend();
  }
  window.addEventListener("hashchange", route);
  route();
})();
