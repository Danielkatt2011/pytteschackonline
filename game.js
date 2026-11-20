(() => {
  const $ = (id) => document.getElementById(id);
  const pieces = { K:"♔", Q:"♕", R:"♖", B:"♗", N:"♘", P:"♙", k:"♚", q:"♛", r:"♜", b:"♝", n:"♞", p:"♟" };
  const files = "abcde";
  let supabase, channel, room = null, player = null, state = null, selected = null, legalTargets = [];
  let pollTimer = null;
  function initialBoard() {
    return [
      ["r","n","b","q","k"],
      ["p","p","p","p","p"],
      [null,null,null,null,null],
      [null,null,null,null,null],
      ["P","P","P","P","P"],
      ["R","N","B","Q","K"]
    ];
  }
  function initialState() { return { board: initialBoard(), turn:"w", status:"playing", winner:null, whiteCaptured:[], blackCaptured:[], lastMove:null }; }
  const side = p => p && (p === p.toUpperCase() ? "w" : "b");
  const inside = (r,c) => r>=0 && r<6 && c>=0 && c<5;
  const own = (p,s) => p && side(p)===s;
  const enemy = (p,s) => p && side(p)!==s;
  function movesFor(board,r,c) {
    const p=board[r][c]; if(!p) return [];
    const s=side(p), type=p.toUpperCase(), out=[];
    const add=(rr,cc)=>{ if(!inside(rr,cc)||own(board[rr][cc],s)) return false; out.push([rr,cc]); return !board[rr][cc]; };
    if(type==="P") {
      const d=s==="w"?-1:1, start=s==="w"?4:1;
      if(inside(r+d,c)&&!board[r+d][c]) { out.push([r+d,c]); if(r===start&&!board[r+2*d][c]) out.push([r+2*d,c]); }
      for(const dc of [-1,1]) if(inside(r+d,c+dc)&&enemy(board[r+d][c+dc],s)) out.push([r+d,c+dc]);
    } else if(type==="N") {
      for(const [dr,dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(r+dr,c+dc);
    } else if(type==="K") {
      for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc) add(r+dr,c+dc);
    } else {
      const dirs=[];
      if(type==="B"||type==="Q") dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      if(type==="R"||type==="Q") dirs.push([-1,0],[1,0],[0,-1],[0,1]);
      for(const [dr,dc] of dirs) { let rr=r+dr,cc=c+dc; while(inside(rr,cc)) { if(!add(rr,cc)) break; rr+=dr; cc+=dc; } }
    }
    return out;
  }
  function applyMove(st, from, to) {
    const next=structuredClone(st), [r,c]=from,[rr,cc]=to, piece=next.board[r][c], taken=next.board[rr][cc], s=side(piece);
    if(!piece || s!==next.turn || !movesFor(next.board,r,c).some(([x,y])=>x===rr&&y===cc)) throw new Error("Ogiltigt drag.");
    if(taken) (s==="w"?next.whiteCaptured:next.blackCaptured).push(taken);
    next.board[rr][cc]=piece; next.board[r][c]=null;
    if(piece==="P"&&rr===0) next.board[rr][cc]="Q";
    if(piece==="p"&&rr===5) next.board[rr][cc]="q";
    if(taken && taken.toUpperCase()==="K") { next.status="finished"; next.winner=s; }
    next.turn=s==="w"?"b":"w"; next.lastMove={from,to};
    return next;
  }
  function validState(st) { return st && Array.isArray(st.board) && st.board.length===6 && st.board.every(row=>Array.isArray(row)&&row.length===5); }
  function render() {
    if(!state) return;
    const boardEl=$("board");
    boardEl.innerHTML="";
    // The DOM order and coordinates remain unchanged. CSS rotates the view for Black.
    boardEl.classList.toggle("rotated", player==="b");
    for(let r=0;r<6;r++) for(let c=0;c<5;c++) {
      const p=state.board[r][c], b=document.createElement("button");
      b.type="button";
      b.className=`square ${(r+c)%2?"dark":"light"}`;
      if(selected && selected[0]===r&&selected[1]===c) b.classList.add("selected");
      if(legalTargets.some(([x,y])=>x===r&&y===c)) b.classList.add(p?"capture":"target");
      b.setAttribute("aria-label",`${files[c]}${6-r}${p?" "+p:" tom"}`);
      if(p) {
        const glyph=document.createElement("span");
        glyph.className="piece "+(side(p)==="w"?"piece-white":"piece-black");
        glyph.textContent=pieces[p];
        b.appendChild(glyph);
      }
      b.addEventListener("click",()=>onSquare(r,c)); boardEl.appendChild(b);
    }
    $("whiteCaptured").textContent=state.whiteCaptured.map(p=>pieces[p]).join(" ");
    $("blackCaptured").textContent=state.blackCaptured.map(p=>pieces[p]).join(" ");
    $("turnText").textContent=state.status==="finished"?(state.winner==="w"?"Vit":"Svart")+" vann!":state.turn==="w"?"Vit står på tur":"Svart står på tur";
    $("gameMessage").textContent=state.status==="finished"?"Kungen har slagits. Spelet är slut.":player===state.turn?"Det är din tur.":"Väntar på motståndarens drag.";
    $("newGameButton").classList.toggle("hidden", state.status!=="finished");
  }
  function onSquare(r,c) {
    if(!state||state.status!=="playing"||state.turn!==player) return;
    const p=state.board[r][c];
    if(selected && legalTargets.some(([x,y])=>x===r&&y===c)) { sendMove(selected,[r,c]); selected=null; legalTargets=[]; return; }
    if(p&&side(p)===player) { selected=[r,c]; legalTargets=movesFor(state.board,r,c); }
    else { selected=null; legalTargets=[]; }
    render();
  }
  async function saveState(next) {
    const {error}=await supabase.from("pytta_rooms").update({game_state:next,updated_at:new Date().toISOString()}).eq("code",room);
    if(error) throw error;
    state=next; render();
  }
  async function sendMove(from,to) {
    try { await saveState(applyMove(state,from,to)); }
    catch(e) { showStatus(e.message||"Kunde inte spara draget."); await refresh(); }
  }
  async function refresh() {
    if(!room) return;
    const {data,error}=await supabase.from("pytta_rooms").select("game_state,white_token,black_token").eq("code",room).maybeSingle();
    if(error) { $("connectionText").textContent="Anslutningsproblem"; return; }
    if(!data) { leaveGame("Rummet finns inte längre."); return; }
    if(validState(data.game_state) && (!state || JSON.stringify(state)!==JSON.stringify(data.game_state))) { state=data.game_state; render(); }
    $("connectionText").textContent=data.black_token?"Båda spelarna anslutna":"Väntar på spelare 2";
  }
  function subscribe() {
    if(channel) supabase.removeChannel(channel);
    channel=supabase.channel("pytta-"+room).on("postgres_changes",{event:"UPDATE",schema:"public",table:"pytta_rooms",filter:"code=eq."+room},payload=>{
      if(validState(payload.new?.game_state)) { state=payload.new.game_state; render(); }
      $("connectionText").textContent=payload.new?.black_token?"Båda spelarna anslutna":"Väntar på spelare 2";
    }).subscribe();
    pollTimer=setInterval(refresh,2500);
  }
  function showStatus(msg) { $("lobbyStatus").textContent=msg; }
  function configured() {
    return window.PYTTE_SUPABASE_URL && !window.PYTTE_SUPABASE_URL.startsWith("DIN_") &&
      window.PYTTE_SUPABASE_ANON_KEY && !window.PYTTE_SUPABASE_ANON_KEY.startsWith("DIN_");
  }
  async function createRoom() {
    const code=Math.random().toString(36).slice(2,8).toUpperCase();
    const token=crypto.randomUUID();
    const {error}=await supabase.from("pytta_rooms").insert({code,white_token:token,game_state:initialState()});
    if(error) throw error;
    player="w"; sessionStorage.setItem("pytta_"+code,token); await enterRoom(code);
  }
  async function joinRoom(code) {
    const {data,error}=await supabase.from("pytta_rooms").select("black_token").eq("code",code).maybeSingle();
    if(error) throw error; if(!data) throw new Error("Rummet hittades inte.");
    if(data.black_token) throw new Error("Rummet är redan fullt.");
    const token=crypto.randomUUID();
    const {error:upErr}=await supabase.from("pytta_rooms").update({black_token:token}).eq("code",code).is("black_token",null);
    if(upErr) throw upErr;
    player="b"; sessionStorage.setItem("pytta_"+code,token); await enterRoom(code);
  }
  async function enterRoom(code) {
    room=code; $("lobby").classList.add("hidden"); $("game").classList.remove("hidden"); $("roomCode").textContent=code;
    await refresh(); subscribe();
  }
  function leaveGame(message="") {
    if(channel) supabase.removeChannel(channel); channel=null;
    if(pollTimer) clearInterval(pollTimer); pollTimer=null;
    room=null; player=null; state=null; selected=null; legalTargets=[];
    $("game").classList.add("hidden"); $("lobby").classList.remove("hidden"); $("lobbyStatus").textContent=message;
  }
  async function start() {
    if(!window.supabase || !configured()) { showStatus("Fyll i Supabase URL och anon key i config.js först."); $("createButton").disabled=true; $("joinButton").disabled=true; return; }
    supabase=window.supabase.createClient(window.PYTTE_SUPABASE_URL,window.PYTTE_SUPABASE_ANON_KEY);
    $("createButton").addEventListener("click",async()=>{ try { showStatus("Skapar rum…"); await createRoom(); } catch(e) { showStatus(e.message); } });
    $("joinButton").addEventListener("click",async()=>{ try { showStatus("Ansluter…"); await joinRoom($("roomInput").value.trim().toUpperCase()); } catch(e) { showStatus(e.message); } });
    $("roomInput").addEventListener("keydown",e=>{if(e.key==="Enter")$("joinButton").click();});
    $("copyButton").addEventListener("click",()=>navigator.clipboard.writeText(room).then(()=>$("copyButton").textContent="Kopierad!"));
    $("leaveButton").addEventListener("click",()=>leaveGame());
    $("newGameButton").addEventListener("click",async()=>{ if(player!=="w") return; try { await saveState(initialState()); } catch(e){showStatus(e.message);} });
    $("rulesButton").addEventListener("click",()=>$("rulesDialog").showModal());
    $("closeRules").addEventListener("click",()=>$("rulesDialog").close());
  }
  document.addEventListener("DOMContentLoaded",start);
})();
