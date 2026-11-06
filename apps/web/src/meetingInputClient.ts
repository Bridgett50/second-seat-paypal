export const MEETING_INPUT_CLIENT_JS = String.raw`(() => {
  if (document.body.dataset.aiDrafting !== "1") return;
  const root = document.getElementById("mr-root");
  if (!root) return;
  let busy = false;
  let gen = 0;
  const sec = document.createElement("section");
  const h2 = document.createElement("h2");
  h2.textContent = "Bring meeting text to your twin";
  sec.appendChild(h2);
  const p = document.createElement("p");
  p.textContent = "Import a meeting transcript excerpt. Google Meet is not connected. Your private redactor receives the text when you prepare; the AI receives only the context you approve. Email sending is unavailable.";
  sec.appendChild(p);
  const taLb = document.createElement("label");
  taLb.htmlFor = "mr-meeting-text";
  taLb.textContent = "Meeting transcript excerpt (up to 6,000 characters)";
  sec.appendChild(taLb);
  const ta = document.createElement("textarea");
  ta.id = "mr-meeting-text";
  sec.appendChild(ta);
  const fiLb = document.createElement("label");
  fiLb.htmlFor = "mr-meeting-file";
  fiLb.textContent = "Upload a .txt meeting transcript";
  sec.appendChild(fiLb);
  const fi = document.createElement("input");
  fi.type = "file";
  fi.id = "mr-meeting-file";
  fi.accept = ".txt,text/plain";
  sec.appendChild(fi);
  const btn = document.createElement("button");
  btn.id = "mr-meeting-prepare";
  btn.textContent = "Prepare meeting follow-up";
  sec.appendChild(btn);
  const st = document.createElement("div");
  st.id = "mr-meeting-status";
  sec.appendChild(st);
  root.parentNode.insertBefore(sec, root);
  const live = document.getElementById("mr-live");
  function setStatus(m) { if (st.textContent !== m) st.textContent = m; if (live && live.textContent !== m) live.textContent = m; }
  async function drain(r) { try { await r.text(); } catch {} }
  ta.addEventListener("input", () => { gen++; });
  fi.addEventListener("change", async () => {
    const f = fi.files && fi.files[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".txt")) { setStatus("File must be .txt"); return; }
    if (f.size > 24000) { setStatus("File too large"); return; }
    const g = gen;
    const capFile = f;
    let txt;
    try { txt = await capFile.text(); } catch { setStatus("Could not read file"); return; }
    if (gen !== g) return;
    if (!fi.files || fi.files[0] !== capFile) return;
    if (txt.includes("\u0000")) { setStatus("File contains NUL"); return; }
    if (txt.length > 6000 || txt.trim().length === 0) { setStatus("File text must be 1-6000 characters"); return; }
    ta.value = txt;
    gen++;
  });
  btn.addEventListener("click", () => {
    if (busy) return;
    const fail = "Preparation stopped. No automatic retry. Check the twin state; an incomplete import cannot be replaced in this prototype.";
    const raw = ta.value;
    if (!raw || raw.trim().length === 0 || raw.length > 6000 || raw.includes("\u0000")) { setStatus(fail); return; }
    gen++;
    const g0 = gen;
    const r0 = document.getElementById("mr-root");
    const roomId = r0 ? r0.dataset.roomId : "";
    busy = true;
    ta.disabled = true; fi.disabled = true; btn.disabled = true;
    function invalid() { const cr = document.getElementById("mr-root"); return !cr || cr.dataset.roomId !== roomId || gen !== g0; }
    (async () => {
      let res;
      try { res = await fetch("/api/meeting-room", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, action: "state" }), credentials: "same-origin" }); } catch { setStatus(fail); return; }
      if (invalid()) { setStatus(fail); return; }
      if (!res.ok) { await drain(res); setStatus(fail); return; }
      let body;
      try { body = await res.json(); } catch { setStatus(fail); return; }
      if (invalid()) { setStatus(fail); return; }
      const snap = body && typeof body === "object" ? body.snapshot : null;
      if (!snap || typeof snap !== "object" || snap.roomId !== roomId || snap.demo !== null) { setStatus(fail); return; }
      const view = snap.view && typeof snap.view === "object" ? snap.view : null;
      if (!view || typeof view !== "object" || view.twinStatus !== "active" || typeof view.selectedMeetingId !== "string" || !view.draft || typeof view.draft !== "object" || view.draft.sendState !== "unsent") { setStatus(fail); return; }
      if (snap.conversation && typeof snap.conversation === "object" && snap.conversation.utterances && snap.conversation.utterances.length > 0) { setStatus(fail); return; }
      const meetingId = view.selectedMeetingId;
      const chunks = [];
      for (let i = 0; i < raw.length;) {
        let e = Math.min(i + 2000, raw.length);
        if (e < raw.length) { const c = raw.charCodeAt(e - 1); if (c >= 0xD800 && c <= 0xDBFF) e--; }
        chunks.push(raw.slice(i, e));
        i = e;
      }
      for (let i = 0; i < chunks.length; i++) {
        if (invalid()) { setStatus(fail); return; }
        let r;
        try { r = await fetch("/api/meeting-room/conversation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, event: { version: 1, meetingId, utteranceId: crypto.randomUUID(), sequence: i + 1, revision: 1, speaker: "Imported meeting transcript", text: chunks[i] } }), credentials: "same-origin" }); } catch { setStatus(fail); return; }
        if (invalid()) { setStatus(fail); return; }
        if (!r.ok) { await drain(r); if (invalid()) { setStatus(fail); return; } setStatus(fail); return; }
        await drain(r); if (invalid()) { setStatus(fail); return; }
      }
      if (invalid()) { setStatus(fail); return; }
      let fr;
      try { fr = await fetch("/api/meeting-room/conversation/finish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId }), credentials: "same-origin" }); } catch { setStatus(fail); return; }
      if (invalid()) { setStatus(fail); return; }
      if (fr.status !== 202) { await drain(fr); if (invalid()) { setStatus(fail); return; } setStatus(fail); return; }
      await drain(fr); if (invalid()) { setStatus(fail); return; }
      ta.value = "";
      setStatus("Review the redacted context below before allowing AI drafting.");
    })();
  });
})();
`;