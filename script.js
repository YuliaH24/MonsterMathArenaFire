/* Monster Math Arena - Firebase edition
   1) Paste your Firebase Web App config into firebaseConfig below.
   2) Enable Anonymous Authentication.
   3) Create Realtime Database.
   4) Deploy this folder to GitHub Pages.
*/
const firebaseConfig = {
  apiKey: "AIzaSyCfzAaIdXgYv4Wl9Z5F-oVEk0pdRdqHgPk",
  authDomain: "monster-math-arena.firebaseapp.com",
  databaseURL: "https://monster-math-arena-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "monster-math-arena",
  storageBucket: "monster-math-arena.firebasestorage.app",
  messagingSenderId: "375468706758",
  appId: "1:375468706758:web:1fee313817b58dcf8e00c7"
};

const MAX_PLAYERS = 30;
const TOTAL_QUESTIONS = 10;
const POINTS = 10;
const QUESTION_SECONDS = 12;

const $ = (id) => document.getElementById(id);
const screens = ["homeScreen","lobbyScreen","gameScreen","resultScreen"];

let db, auth, user;
let roomId = null;
let playerName = "";
let isHost = false;
let roomRef = null;
let roomListener = null;
let answered = false;
let questionStartedAt = 0;
let timerHandle = null;
let lastRound = 0;
let cleanupFns = [];

const multiplication = (a,b) => `${a} × ${b}`;
const rand = (min,max) => Math.floor(Math.random()*(max-min+1))+min;

function showScreen(id){
  screens.forEach(s => $(s).classList.toggle("active", s === id));
}
function error(msg){ $("homeError").textContent = msg || ""; }
function normalizeCode(v){ return (v||"").trim().toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6); }
function escapeText(v){ return String(v ?? ""); }

function makeQuestion(){
  const a = rand(3,9), b = rand(3,9);
  const correct = a*b;
  const options = new Set([correct]);
  while(options.size < 4){
    const mode = Math.random() < 0.45 ? "add8" : "near";
    let value;
    if(mode === "add8") value = 8 + rand(1,16);
    else value = Math.max(0, correct + rand(-8,8));
    options.add(value);
  }
  return {
    text: multiplication(a,b),
    options: [...options].sort(() => Math.random()-0.5),
    correct,
    startedAt: firebase.database.ServerValue.TIMESTAMP
  };
}

async function boot(){
  try{
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    auth = firebase.auth();
    await auth.signInAnonymously();
    user = auth.currentUser;
    if(!user) throw new Error("Autentikasi anonim gagal.");
  }catch(e){
    error("Firebase belum dikonfigurasi. Isi firebaseConfig di script.js lalu aktifkan Anonymous Auth.");
    console.error(e);
    $("createBtn").disabled = true;
    $("joinBtn").disabled = true;
  }
}
boot();

$("joinBtn").addEventListener("click", () => {
  if ($("joinBox").classList.contains("hidden")) {
    $("joinBox").classList.remove("hidden");
    $("roomInput").focus();
  } else {
    joinRoom();
  }
});

$("createBtn").addEventListener("click", createRoom);

async function createRoom(){
  error("");
  if(!user) return;
  playerName = $("nameInput").value.trim();
  if(!playerName) return error("Nama wajib diisi.");
  if(playerName.length > 24) return error("Nama maksimal 24 karakter.");

  roomId = randomRoomCode();
  isHost = true;
  roomRef = db.ref(`rooms/${roomId}`);

  const initial = {
    hostId: user.uid,
    status: "lobby",
    currentQuestion: 0,
    question: null,
    createdAt: firebase.database.ServerValue.TIMESTAMP,
    participants: {
      [user.uid]: {
        name: playerName,
        score: 0,
        totalTime: 0,
        answered: false,
        joinedAt: firebase.database.ServerValue.TIMESTAMP
      }
    }
  };

  try{
    await roomRef.set(initial);
    bindRoom();
    renderLobby();
  }catch(e){
    console.error(e);
    error("Gagal membuat arena: " + e.message);
  }
}

$("roomInput").addEventListener("input", e => e.target.value = normalizeCode(e.target.value));
$("roomInput").addEventListener("keydown", e => { if(e.key==="Enter") joinRoom(); });
$("joinBtn").addEventListener("dblclick", joinRoom);

async function joinRoom(){
  error("");
  if(!user) return;
  playerName = $("nameInput").value.trim();
  roomId = normalizeCode($("roomInput").value);
  if(!playerName) return error("Nama wajib diisi.");
  if(!roomId || roomId.length !== 6) return error("Masukkan kode arena 6 karakter.");
  try{
    const snap = await db.ref(`rooms/${roomId}`).once("value");
    if(!snap.exists()) return error("Arena tidak ditemukan.");
    const room = snap.val();
    if(room.status !== "lobby") return error("Pertandingan sudah dimulai.");
    const count = Object.keys(room.participants || {}).length;
    if(count >= MAX_PLAYERS) return error("Arena sudah penuh (30 peserta).");
    isHost = false;
    roomRef = db.ref(`rooms/${roomId}`);
    await roomRef.child(`participants/${user.uid}`).set({
      name: playerName, score:0, totalTime:0, answered:false,
      joinedAt: firebase.database.ServerValue.TIMESTAMP
    });
    bindRoom();
    renderLobby();
  }catch(e){
    console.error(e);
    error("Gagal masuk arena: " + e.message);
  }
}

/* The Join button is single-click for the form. The lobby enter shortcut is
   handled by a small separate helper button behavior below. */
const originalJoinClick = $("joinBtn").onclick;

$("leaveLobbyBtn").addEventListener("click", leaveRoom);
$("startBtn").addEventListener("click", startGame);
$("playAgainBtn").addEventListener("click", () => location.reload());

async function leaveRoom(){
  try{
    if(roomRef && user && !isHost) await roomRef.child(`participants/${user.uid}`).remove();
  }catch(e){ console.warn(e); }
  cleanup();
  location.reload();
}

function cleanup(){
  if(roomListener && roomRef) roomRef.off("value", roomListener);
  roomListener = null;
  clearInterval(timerHandle);
  cleanupFns.forEach(fn => fn());
  cleanupFns = [];
}

function bindRoom(){
  showScreen("lobbyScreen");
  $("roomCode").textContent = roomId;
  $("gameRoomCode").textContent = roomId;
  roomListener = snap => {
    const room = snap.val();
    if(!room){
      cleanup(); location.reload(); return;
    }
    renderLobbyData(room);
    if(room.status === "playing") renderGameData(room);
    if(room.status === "finished") renderResults(room);
  };
  roomRef.on("value", roomListener);
}

function renderLobby(){
  showScreen("lobbyScreen");
}

function renderLobbyData(room){
  const participants = Object.entries(room.participants || {});
  $("playerCount").textContent = `${participants.length}/${MAX_PLAYERS}`;
  $("playerList").innerHTML = participants
    .sort((a,b)=>(a[1].joinedAt||0)-(b[1].joinedAt||0))
    .map(([id,p]) => `<div class="player"><span>👹</span><span>${escapeText(p.name)}</span>${id===room.hostId?'<span class="crown">👑</span>':''}</div>`)
    .join("");
  const host = room.hostId === user?.uid;
  $("startBtn").classList.toggle("hidden", !host);
  $("hostHint").textContent = host ? "Anda adalah host. Bagikan kode arena kepada peserta." : "Tunggu host memulai pertandingan.";
  $("lobbyStatus").textContent = participants.length < 2
    ? "Minimal 1 peserta sudah cukup untuk tes. Untuk pertandingan kelas, tunggu semua peserta masuk."
    : "Semua siap? Host dapat memulai pertandingan.";
}

async function startGame(){
  if(!roomRef || !isHost) return;
  const snap = await roomRef.once("value");
  const room = snap.val();
  if(!room || room.hostId !== user.uid) return;
  const q = makeQuestion();
  const updates = {};
  Object.keys(room.participants || {}).forEach(id => {
    updates[`participants/${id}/score`] = 0;
    updates[`participants/${id}/totalTime`] = 0;
    updates[`participants/${id}/answered`] = false;
  });
  updates.status = "playing";
  updates.currentQuestion = 1;
  updates.question = q;
  await roomRef.update(updates);
}

function renderGameData(room){
  showScreen("gameScreen");
  const round = Number(room.currentQuestion || 1);
  $("roundLabel").textContent = `${round}/${TOTAL_QUESTIONS}`;
  const q = room.question;
  if(!q) return;

  if(round !== lastRound){
    lastRound = round;
    answered = false;
    questionStartedAt = Date.now();
    renderQuestion(q);
    startTimer();
  } else if($("questionText").textContent !== q.text){
    renderQuestion(q);
  }

  renderFeed(room);
  if(room.question?.winnerName){
    $("gameMessage").textContent = `⚡ ${room.question.winnerName} menjawab benar!`;
  }
}

function renderQuestion(q){
  $("questionText").textContent = `${q.text} = ?`;
  $("answers").innerHTML = q.options.map(v =>
    `<button class="answer" data-value="${v}">${v}</button>`
  ).join("");
  document.querySelectorAll(".answer").forEach(btn => {
    btn.addEventListener("click", () => submitAnswer(Number(btn.dataset.value), btn));
  });
  $("gameMessage").textContent = "";
}

function startTimer(){
  clearInterval(timerHandle);
  const end = questionStartedAt + QUESTION_SECONDS*1000;
  const tick = () => {
    const remain = Math.max(0, end-Date.now());
    $("timer").textContent = `⏱️ ${(remain/1000).toFixed(1)} detik`;
    if(remain <= 0){
      clearInterval(timerHandle);
      if(!answered) lockAnswers("Waktu habis.");
    }
  };
  tick(); timerHandle = setInterval(tick,80);
}

function lockAnswers(message){
  document.querySelectorAll(".answer").forEach(b=>b.disabled=true);
  if(message) $("gameMessage").textContent = message;
}

async function submitAnswer(value, button){
  if(answered || !roomRef || !user) return;
  answered = true;
  const elapsed = Math.max(0, Date.now()-questionStartedAt);
  document.querySelectorAll(".answer").forEach(b=>b.disabled=true);
  button.classList.add("selected");

  const snap = await roomRef.once("value");
  const room = snap.val();
  if(!room || room.status !== "playing" || !room.question || room.question.winnerId) return;
  const correct = Number(room.question.correct) === value;

  if(correct){
    const resultRef = roomRef.child(`questionResults/${room.currentQuestion}/${user.uid}`);
    await resultRef.set({correct:true, elapsedMs:elapsed, submittedAt:firebase.database.ServerValue.TIMESTAMP, name:playerName});
  }else{
    $("gameMessage").textContent = "Jawaban salah. Tunggu soal berikutnya.";
    await roomRef.child(`questionResults/${room.currentQuestion}/${user.uid}`).set({
      correct:false, elapsedMs:elapsed, submittedAt:firebase.database.ServerValue.TIMESTAMP, name:playerName
    });
  }
}

function renderFeed(room){
  const qres = room.questionResults?.[room.currentQuestion] || {};
  const items = Object.values(qres).filter(x=>x.correct).sort((a,b)=>(a.elapsedMs||0)-(b.elapsedMs||0)).slice(0,5);
  $("feed").innerHTML = items.length ? items.map(x =>
    `<div class="feed-item">⚔️ <strong>${escapeText(x.name)}</strong> menjawab benar dalam ${(x.elapsedMs/1000).toFixed(2)} dtk</div>`
  ).join("") : `<div class="muted">Belum ada jawaban benar.</div>`;
}

async function hostProcessQuestion(room){
  if(!isHost || !roomRef || room.status !== "playing") return;
  const round = Number(room.currentQuestion || 1);
  const qres = room.questionResults?.[round] || {};
  const correct = Object.values(qres).filter(x=>x.correct);
  if(correct.length === 0){
    // Wait until timer expires before moving on.
    return;
  }
  const winner = correct.sort((a,b)=>(a.elapsedMs||0)-(b.elapsedMs||0))[0];
  if(room.question?.winnerId) return;

  const winnerEntry = Object.entries(qres).find(([id,x]) => x === winner);
  if(!winnerEntry) return;
  const winnerId = winnerEntry[0];
  const updates = {};
  updates[`participants/${winnerId}/score`] = (room.participants?.[winnerId]?.score || 0) + POINTS;
  updates[`participants/${winnerId}/totalTime`] = (room.participants?.[winnerId]?.totalTime || 0) + winner.elapsedMs;
  updates[`question/winnerId`] = winnerId;
  updates[`question/winnerName`] = winner.name;
  await roomRef.update(updates);
  setTimeout(async()=>advanceQuestion(), 900);
}

async function advanceQuestion(){
  if(!isHost || !roomRef) return;
  const snap = await roomRef.once("value");
  const room = snap.val();
  if(!room || room.status !== "playing" || !room.question) return;
  const round = Number(room.currentQuestion||1);
  // prevent duplicate transitions using a host-only local guard
  if(advanceQuestion.locked) return;
  advanceQuestion.locked = true;
  try{
    if(round >= TOTAL_QUESTIONS){
      await roomRef.update({status:"finished"});
    }else{
      const q = makeQuestion();
      const updates = {currentQuestion:round+1, question:q};
      Object.keys(room.participants||{}).forEach(id => updates[`participants/${id}/answered`] = false);
      await roomRef.update(updates);
    }
  }finally{
    setTimeout(()=>advanceQuestion.locked=false, 1200);
  }
}

// Host polling: awards first correct answer and also advances after timeout.
setInterval(async()=>{
  if(!isHost || !roomRef) return;
  try{
    const snap = await roomRef.once("value");
    const room = snap.val();
    if(!room || room.status!=="playing" || !room.question) return;
    await hostProcessQuestion(room);
    const qStarted = Number(room.question.startedAt);
    // Firebase server timestamp resolves to a number in reads.
    if(qStarted && Date.now() - qStarted >= QUESTION_SECONDS*1000 && !room.question.winnerId){
      await advanceQuestion();
    }
  }catch(e){ console.warn(e); }
}, 500);

function renderResults(room){
  showScreen("resultScreen");
  $("resultRoom").textContent = `Arena ${roomId}`;
  const entries = Object.values(room.participants || {})
    .sort((a,b)=>(b.score||0)-(a.score||0) || (a.totalTime||0)-(b.totalTime||0));
  $("leaderboard").innerHTML = entries.map((p,i) => `
    <div class="rank ${i===0?'first':''}">
      <div class="rank-num">${i+1}</div>
      <div><div class="rank-name">${i===0?'👑 ':''}${escapeText(p.name)}</div>
      <div class="rank-meta">${((p.totalTime||0)/1000).toFixed(2)} detik total</div></div>
      <div class="score">${p.score||0}</div>
    </div>
  `).join("");
  clearInterval(timerHandle);
}

function randomRoomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out="";
  for(let i=0;i<6;i++) out += chars[rand(0,chars.length-1)];
  return out;
}

/* Convenience: pressing Enter in the room code field joins. */
$("roomInput").addEventListener("keydown", e => {
  if(e.key === "Enter") joinRoom();
});

