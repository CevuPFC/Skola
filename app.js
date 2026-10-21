// 1) Otvori Firebase konzolu i zameni vrednosti ispod svojim Firebase web config podacima.
const firebaseConfig = {
    apiKey: "AIzaSyAW0FdDUrADjtQgpEMh3KJnMIKCboB_Sg0",
    authDomain: "skola-8b5ca.firebaseapp.com",
    projectId: "skola-8b5ca",
    storageBucket: "skola-8b5ca.firebasestorage.app",
    messagingSenderId: "1025473511419",
    appId: "1:1025473511419:web:ae37d3134fcf2d1be8155e"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, setDoc, deleteDoc, onSnapshot,
  query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = id => document.getElementById(id);
const authView = $("authView"), appView = $("appView");
const setupWarning = $("setupWarning");
const isConfigured = !firebaseConfig.apiKey.startsWith("OVDE_") &&
  !firebaseConfig.projectId.startsWith("OVDE_");
if (!isConfigured) setupWarning.classList.remove("hidden");

let auth, db, currentUser = null, notes = [], subjects = [], activeSubject = null, activeNoteId = null;
let stopNotes = null, stopSubjects = null, saveTimer = null, isApplyingNote = false;
const defaultSubjects = ["Matematika", "Programiranje", "Računarske mreže", "Operativni sistemi", "Engleski", "Ostalo"];

function setAuthMessage(message, error = true) {
  $("authMessage").textContent = message;
  $("authMessage").style.color = error ? "#ffabb5" : "#83e0b3";
}
function setSync(message, state = "") {
  $("syncStatus").className = "sync-status " + state;
  $("syncStatus").innerHTML = `<span class="sync-dot"></span> ${message}`;
}
function showOnly(view) {
  ["welcomeView", "editorView", "listView"].forEach(id => $(id).classList.toggle("hidden", id !== view));
}
function safeDate(value) {
  if (value?.toDate) return value.toDate();
  return value ? new Date(value) : new Date();
}
function escapeHTML(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function plainText(html = "") {
  const el = document.createElement("div"); el.innerHTML = html;
  return (el.textContent || el.innerText || "").trim();
}
function subjectNotes(subjectId) { return notes.filter(n => n.subjectId === subjectId); }

function renderSubjects() {
  const list = $("subjectList"); list.replaceChildren();
  subjects.forEach(s => {
    const b = document.createElement("button");
    b.className = "subject-item" + (activeSubject === s.id ? " active" : "");
    b.innerHTML = `<span>▤</span><span>${escapeHTML(s.name)}</span><span class="count">${subjectNotes(s.id).length}</span>`;
    b.addEventListener("click", () => { activeSubject = s.id; activeNoteId = null; renderSubjects(); renderNoteList(); showOnly("listView"); });
    list.appendChild(b);
  });
}
function renderNoteList() {
  const subject = subjects.find(s => s.id === activeSubject);
  $("listTitle").textContent = subject ? subject.name : "Sve beleške";
  const term = $("searchInput").value.trim().toLocaleLowerCase("sr");
  const results = notes.filter(n => (!activeSubject || n.subjectId === activeSubject) &&
    (!term || (n.title + " " + plainText(n.body)).toLocaleLowerCase("sr").includes(term)))
    .sort((a,b) => safeDate(b.updatedAt).getTime() - safeDate(a.updatedAt).getTime());
  const grid = $("notesGrid"); grid.replaceChildren();
  if (!results.length) {
    const empty = document.createElement("div"); empty.className = "empty-state";
    empty.textContent = term ? "Nema beleški koje odgovaraju pretrazi." : "Ovde još nema beleški. Napravi prvu!";
    grid.appendChild(empty); return;
  }
  results.forEach(n => {
    const card = document.createElement("button"); card.className = "note-card";
    const date = safeDate(n.updatedAt).toLocaleDateString("sr-RS", {day:"numeric",month:"short",year:"numeric"});
    card.innerHTML = `<h3>${escapeHTML(n.title || "Bez naslova")}</h3><p>${escapeHTML(plainText(n.body) || "Prazna beleška")}</p><time>${date}</time>`;
    card.addEventListener("click", () => openNote(n.id));
    grid.appendChild(card);
  });
}
function updateWordCount() {
  const words = plainText($("noteBody").innerHTML).split(/\s+/).filter(Boolean).length;
  $("wordCount").textContent = `${words} ${words === 1 ? "reč" : "reči"}`;
}
function openNote(id) {
  const note = notes.find(n => n.id === id); if (!note) return;
  activeNoteId = id; activeSubject = note.subjectId; isApplyingNote = true;
  $("crumbSubject").textContent = subjects.find(s => s.id === note.subjectId)?.name || "Predmet";
  $("noteTitle").value = note.title || "";
  $("noteBody").innerHTML = note.body || "";
  updateWordCount(); isApplyingNote = false;
  renderSubjects(); showOnly("editorView");
}
async function createNote() {
  if (!currentUser) return;
  if (!subjects.length) { alert("Prvo dodaj predmet."); return; }
  const subjectId = activeSubject || subjects[0].id;
  try {
    setSync("Kreiranje…");
    const ref = await addDoc(collection(db, "users", currentUser.uid, "notes"), {
      title: "Nova beleška", body: "", subjectId, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
    activeSubject = subjectId;
    // Add a temporary local copy so the editor opens before the cloud snapshot arrives.
    notes.unshift({id:ref.id, title:"Nova beleška", body:"", subjectId, createdAt:new Date(), updatedAt:new Date()});
    openNote(ref.id);
    $("noteTitle").focus(); $("noteTitle").select();
    setSync("Sinhronizovano", "ok");
  } catch (e) { setSync("Greška pri čuvanju", "error"); alert("Nije moguće napraviti belešku: " + e.message); }
}
function scheduleSave() {
  if (isApplyingNote || !activeNoteId || !currentUser) return;
  updateWordCount();
  $("lastSaved").textContent = "Čuvanje…";
  setSync("Čuvanje…");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveCurrentNote, 650);
}
async function saveCurrentNote() {
  const id = activeNoteId; if (!id || !currentUser) return;
  const title = $("noteTitle").value.trim() || "Bez naslova";
  const body = $("noteBody").innerHTML;
  const subjectId = activeSubject || subjects[0]?.id;
  try {
    await setDoc(doc(db, "users", currentUser.uid, "notes", id), {
      title, body, subjectId, updatedAt: serverTimestamp()
    }, {merge:true});
    $("lastSaved").textContent = "Sačuvano u oblaku";
    setSync("Sinhronizovano", "ok");
  } catch (e) {
    $("lastSaved").textContent = "Greška pri čuvanju";
    setSync("Greška pri čuvanju", "error");
    console.error(e);
  }
}
async function addSubject() {
  const name = prompt("Naziv novog predmeta:");
  if (!name?.trim()) return;
  try {
    await addDoc(collection(db, "users", currentUser.uid, "subjects"), {name:name.trim(), createdAt:serverTimestamp()});
  } catch (e) { alert("Nije moguće dodati predmet: " + e.message); }
}
async function deleteCurrentNote() {
  if (!activeNoteId || !confirm("Da li sigurno želiš da obrišeš ovu belešku? Ova radnja se sinhronizuje na svim uređajima.")) return;
  try {
    await deleteDoc(doc(db, "users", currentUser.uid, "notes", activeNoteId));
    activeNoteId = null; showOnly("listView"); setSync("Sinhronizovano", "ok");
  } catch (e) { alert("Brisanje nije uspelo: " + e.message); }
}
function exportCurrentNote() {
  const note = notes.find(n => n.id === activeNoteId);
  if (!note) return;
  const content = `${$("noteTitle").value.trim() || "Bez naslova"}\n${"=".repeat(40)}\n\n${plainText($("noteBody").innerHTML)}\n`;
  const blob = new Blob([content], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = ($("noteTitle").value.trim() || "beleska").replace(/[\\/:*?"<>|]/g,"_") + ".txt";
  a.click(); URL.revokeObjectURL(url);
}
function startDataListeners(user) {
  if (stopNotes) stopNotes(); if (stopSubjects) stopSubjects();
  setSync("Učitavanje…");
  stopSubjects = onSnapshot(query(collection(db, "users", user.uid, "subjects"), orderBy("name")),
    async snap => {
      subjects = snap.docs.map(d => ({id:d.id, ...d.data()}));
      if (!subjects.length) {
        for (const name of defaultSubjects) {
          await addDoc(collection(db, "users", user.uid, "subjects"), {name, createdAt:serverTimestamp()});
        }
        return;
      }
      if (!activeSubject || !subjects.some(s => s.id === activeSubject)) activeSubject = subjects[0].id;
      renderSubjects(); renderNoteList();
    }, err => { console.error(err); setSync("Greška sa predmetima", "error"); });
  stopNotes = onSnapshot(query(collection(db, "users", user.uid, "notes"), orderBy("updatedAt", "desc")),
    snap => {
      notes = snap.docs.map(d => ({id:d.id, ...d.data()}));
      renderSubjects(); renderNoteList();
      if (activeNoteId) {
        const fresh = notes.find(n => n.id === activeNoteId);
        if (fresh && document.activeElement !== $("noteTitle") && ! $("noteBody").contains(document.activeElement)) {
          isApplyingNote = true; $("noteTitle").value = fresh.title || ""; $("noteBody").innerHTML = fresh.body || ""; updateWordCount(); isApplyingNote = false;
        }
      }
      setSync("Sinhronizovano", "ok");
    }, err => { console.error(err); setSync("Greška sa beleškama", "error"); });
}
function setupApp(user) {
  currentUser = user; authView.classList.add("hidden"); appView.classList.remove("hidden");
  $("userEmail").textContent = user.email || "Prijavljen korisnik";
  startDataListeners(user); showOnly("welcomeView");
}
function cleanupApp() {
  currentUser = null; notes = []; subjects = []; activeNoteId = null; activeSubject = null;
  if (stopNotes) stopNotes(); if (stopSubjects) stopSubjects();
  stopNotes = stopSubjects = null;
  appView.classList.add("hidden"); authView.classList.remove("hidden");
}

$("loginBtn").addEventListener("click", async () => {
  if (!isConfigured) return setAuthMessage("Prvo podesi Firebase u app.js.");
  try { setAuthMessage("Prijavljivanje…", false); await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch(e) { setAuthMessage(authError(e)); }
});
$("registerBtn").addEventListener("click", async () => {
  if (!isConfigured) return setAuthMessage("Prvo podesi Firebase u app.js.");
  try { setAuthMessage("Pravljenje naloga…", false); await createUserWithEmailAndPassword(auth, $("email").value.trim(), $("password").value); }
  catch(e) { setAuthMessage(authError(e)); }
});
function authError(e) {
  const map = {
    "auth/invalid-email":"Unesi ispravnu imejl adresu.",
    "auth/missing-password":"Unesi lozinku.",
    "auth/weak-password":"Lozinka mora imati najmanje 6 znakova.",
    "auth/email-already-in-use":"Nalog sa ovom imejl adresom već postoji.",
    "auth/invalid-credential":"Imejl ili lozinka nisu ispravni.",
    "auth/too-many-requests":"Previše pokušaja. Pokušaj kasnije."
  };
  return map[e.code] || e.message || "Došlo je do greške.";
}
$("logoutBtn").addEventListener("click", () => signOut(auth));
$("newNoteBtn").addEventListener("click", createNote);
$("welcomeNewBtn").addEventListener("click", createNote);
$("listNewBtn").addEventListener("click", createNote);
$("addSubjectBtn").addEventListener("click", addSubject);
$("deleteNoteBtn").addEventListener("click", deleteCurrentNote);
$("exportBtn").addEventListener("click", exportCurrentNote);
$("noteTitle").addEventListener("input", scheduleSave);
$("noteBody").addEventListener("input", scheduleSave);
$("searchInput").addEventListener("input", () => { renderNoteList(); if (!$("listView").classList.contains("hidden")) showOnly("listView"); });
document.querySelectorAll("[data-command]").forEach(button => button.addEventListener("click", () => {
  $("noteBody").focus();
  const command = button.dataset.command, value = button.dataset.value;
  if (command === "formatBlock") document.execCommand(command, false, value);
  else document.execCommand(command, false, null);
  scheduleSave();
}));
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); clearTimeout(saveTimer); saveCurrentNote(); }
});
if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app); db = getFirestore(app);
    onAuthStateChanged(auth, user => user ? setupApp(user) : cleanupApp());
  } catch (e) {
    setupWarning.classList.remove("hidden");
    setAuthMessage("Firebase podešavanja nisu ispravna: " + e.message);
  }
}
