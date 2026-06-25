import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE ───────────────────────────────────────────────────────────────────
// Set these in Vercel environment variables as VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || null;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || null;
const sb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Pull all rows from Supabase into localStorage on app start
async function syncFromSupabase() {
  if (!sb) return;
  try {
    const { data } = await sb.from("kv_store").select("key,value");
    if (data) {
      data.forEach(({ key, value }) => {
        localStorage.setItem("wvos:" + key, value);
      });
    }
  } catch(e) { console.warn("Supabase sync failed:", e); }
}

// Write a key to Supabase (fire and forget — localStorage already updated)
function sbSet(key, value) {
  if (!sb) return;
  sb.from("kv_store").upsert({ key, value }).then();
}

// Delete a key from Supabase
function sbDel(key) {
  if (!sb) return;
  sb.from("kv_store").delete().eq("key", key).then();
}

// ── BRAND ─────────────────────────────────────────────────────────────────────
const B = {
  orange:"#ff6700", black:"#000000", white:"#ffffff",
  card:"#0d0d0d", border:"#1a1a1a", muted:"#bbb", dim:"#888",
  fb:"#1877f2", msn:"#ff00a8", spotify:"#1db954",
};
const WV_LOGO = "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20776%20760%22%3E%3Cpath%20fill%3D%22%23fff%22%20d%3D%22M0%2C217V20C0%2C8%2C7%2C0%2C22%2C2c2%2C1%2C4%2C3%2C6%2C5%2C35%2C34%2C92%2C76%2C170%2C114%2C26%2C13%2C54%2C23%2C84%2C29%2C9%2C1%2C18-1%2C27-3%2C95-36%2C186-127%2C232-177%2C4-4%2C8-6%2C14-6%2C7%2C0%2C13%2C5%2C13%2C12v398c0%2C6-3%2C11-8%2C14L389%2C524c-4%2C3-8%2C6-10%2C11L310%2C681c-6%2C11-17%2C11-22%2C1L225%2C541c-2-4-5-6-8-8L5%2C405C2%2C403%2C0%2C400%2C0%2C396V217z%22/%3E%3C/svg%3E";

// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const SPLITS = [
  {label:"50/50",rate:0.035},{label:"55/45",rate:0.0275},
  {label:"60/40",rate:0.025},{label:"65/35",rate:0.0225},{label:"70/30",rate:0.020},
];
const PLATFORMS = ["Facebook","MSN","Spotify"];
const PLATFORM_COLOR = {Facebook:B.fb, MSN:B.msn, Spotify:B.spotify};
// Rev split targets: FB and MSN only (Spotify no split target)
const SPLIT_TARGETS = {Facebook:39.5, MSN:41.5};
const ACCENT_COLORS = ["#ff6700","#00d4ff","#ff2d78","#7c3aed","#16a34a","#f59e0b","#06b6d4","#ec4899","#84cc16","#f97316"];
const BADGE_EMOJIS = ["🏅","🥇","🔥","⚡","💎","🎯","🚀","👑","💪","🌟"];
const TITLE_OPTIONS = [
  "The Closer","The Researcher","The Organiser","The Hunter",
  "The Networker","The Strategist","The Negotiator","The Connector",
  "The Grinder","The Dealmaker",
];

// ── STORAGE ───────────────────────────────────────────────────────────────────
// Reads from localStorage (instant, synchronous).
// Writes go to localStorage immediately AND Supabase in the background.
// On app load, Supabase data is pulled into localStorage so all devices stay in sync.
const LS = {
  get(k){try{const v=localStorage.getItem("wvos:"+k);return v?JSON.parse(v):null;}catch{return null;}},
  set(k,v){
    try{
      const str=JSON.stringify(v);
      localStorage.setItem("wvos:"+k,str);
      sbSet(k, str); // sync to Supabase in background
      return true;
    }catch{return false;}
  },
  del(k){
    try{localStorage.removeItem("wvos:"+k);sbDel(k);}catch{}
  },
  keys(prefix){
    try{
      const out=[];
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(k&&k.startsWith("wvos:"+prefix))out.push(k.replace("wvos:",""));
      }
      return out;
    }catch{return[];}
  }
};

// ── DATA HELPERS ──────────────────────────────────────────────────────────────
const getUser = e => LS.get("user:"+e.toLowerCase());
const saveUser = u => LS.set("user:"+u.email.toLowerCase(), u);
const getAllUsers = () => LS.keys("user:").map(k=>LS.get(k)).filter(Boolean);
const getSignings = e => LS.get("signings:"+e.toLowerCase()) || [];
const saveSignings = (e,s) => LS.set("signings:"+e.toLowerCase(), s);
const getAllPendingSignings = () => {
  const all = [];
  LS.keys("signings:").forEach(k => {
    const s = LS.get(k) || [];
    s.filter(x=>x.status==="pending").forEach(x=>all.push(x));
  });
  return all.sort((a,b)=>b.submittedAt-a.submittedAt);
};
const getTargets = () => LS.get("targets:current") || {};
const saveTargets = t => LS.set("targets:current", t);
const getManagerSettings = email => LS.get("mgr-settings:"+email.toLowerCase()) || {};
const saveManagerSettings = (email, s) => LS.set("mgr-settings:"+email.toLowerCase(), s);
const getIncentive = () => LS.get("incentive:current");
const saveIncentive = i => LS.set("incentive:current", i);
const getBadges = () => LS.get("badges:all") || [];
const saveBadges = b => LS.set("badges:all", b);
const getAnnouncement = () => LS.get("announcement:current");
const saveAnnouncement = a => LS.set("announcement:current", a);
const clearAnnouncement = () => LS.del("announcement:current");
const getMeetingRecap = () => LS.get("meeting:recap");
const saveMeetingRecap = r => LS.set("meeting:recap", r);
const clearMeetingRecap = () => LS.del("meeting:recap");

// Activity feed — built from existing signing data across all users
function getActivityFeed(allUsers, limit=40) {
  const events = [];
  allUsers.forEach(u => {
    const signings = getSignings(u.email);
    signings.forEach(s => {
      if (s.status === "approved" && s.approvedAt) {
        events.push({ type:"approved", user:u, signing:s, ts:s.approvedAt });
      }
      if (s.status === "pending" && s.submittedAt) {
        events.push({ type:"submitted", user:u, signing:s, ts:s.submittedAt });
      }
      if (s.status === "rejected" && s.rejectedAt) {
        events.push({ type:"rejected", user:u, signing:s, ts:s.rejectedAt });
      }
    });
    const badges = getBadges().filter(b => b.recipientEmail === u.email);
    badges.forEach(b => {
      events.push({ type:"badge", user:u, badge:b, ts:b.awardedAt });
    });
  });
  return events.sort((a,b) => b.ts - a.ts).slice(0, limit);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs < 24) return `${hrs}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
const fmt$ = n => "$"+Number(n||0).toLocaleString("en-US",{maximumFractionDigits:0});
const fmtPct = n => Number(n||0).toFixed(1)+"%";
const initials = n => (n||"?").split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const quarterStart = () => { const n=new Date(),q=Math.floor(n.getMonth()/3); return new Date(n.getFullYear(),q*3,1).getTime(); };
const thirtyDaysAgo = () => Date.now()-30*24*60*60*1000;
const greeting = () => { const h=new Date().getHours(); return h<12?"Morning":h<17?"Afternoon":"Evening"; };
const wvPct = label => parseFloat(label)||50;

// Quarter helpers
function getQuarterBounds(offset=0) {
  const n=new Date(), q=Math.floor(n.getMonth()/3)+offset;
  const year = n.getFullYear() + Math.floor(q/4);
  const qq = ((q%4)+4)%4;
  return { start: new Date(year, qq*3, 1).getTime(), end: new Date(year, qq*3+3, 0, 23,59,59).getTime(), label:`Q${qq+1} ${year}` };
}
function getWeekStart(offset=0) {
  const n=new Date(); n.setHours(0,0,0,0);
  const day=n.getDay()||7; n.setDate(n.getDate()-day+1+(offset*7));
  return n.getTime();
}
function getMonthStart(offset=0) {
  const n=new Date(); return new Date(n.getFullYear(), n.getMonth()+offset, 1).getTime();
}
function daysInQuarter() {
  const {start,end}=getQuarterBounds(); return Math.ceil((end-start)/(1000*60*60*24));
}
function daysElapsedInQuarter() {
  const {start}=getQuarterBounds(); return Math.max(1, Math.ceil((Date.now()-start)/(1000*60*60*24)));
}
function daysLeftInQuarter() {
  const {end}=getQuarterBounds(); return Math.max(0, Math.ceil((end-Date.now())/(1000*60*60*24)));
}

// Streak logic
function calcStreaks(email) {
  // Weekly streak: 2+ deals each week for 2+ consecutive weeks
  // Hot week: 3+ deals in current week
  const all = getSignings(email).filter(s=>s.status==="approved"&&s.contractDate);
  const weeklyMap = {};
  all.forEach(s => {
    const d = new Date(s.contractDate);
    d.setHours(0,0,0,0);
    const day = d.getDay()||7; d.setDate(d.getDate()-day+1);
    const wk = d.getTime();
    weeklyMap[wk] = (weeklyMap[wk]||0)+1;
  });
  const weeks = Object.keys(weeklyMap).map(Number).sort((a,b)=>a-b);
  const weekMs = 7*24*60*60*1000;
  let weeklyStreak = 0;
  for (let i=weeks.length-1;i>=0;i--) {
    if (weeklyMap[weeks[i]]>=2) {
      if (i===weeks.length-1 || weeks[i+1]-weeks[i]===weekMs) weeklyStreak++;
      else break;
    } else break;
  }
  const thisWeekStart = getWeekStart(0);
  const thisWeekCount = all.filter(s=>new Date(s.contractDate).getTime()>=thisWeekStart).length;
  return { weeklyStreak, hotWeek: thisWeekCount>=3, thisWeekCount };
}

// Rank change: compare this week vs last week rankings
function getRankChange(email, allUsers, metric="total") {
  function weekScore(em, since) {
    const s=getSignings(em).filter(x=>x.status==="approved"&&x.contractDate&&new Date(x.contractDate).getTime()>=since);
    return s.length;
  }
  const thisWk=getWeekStart(0), lastWk=getWeekStart(-1);
  const thisRanks=[...allUsers].sort((a,b)=>weekScore(b.email,thisWk)-weekScore(a.email,thisWk));
  const lastRanks=[...allUsers].sort((a,b)=>weekScore(b.email,lastWk)-weekScore(a.email,lastWk));
  const thisPos=thisRanks.findIndex(u=>u.email===email);
  const lastPos=lastRanks.findIndex(u=>u.email===email);
  if (thisPos<0||lastPos<0) return 0;
  return lastPos-thisPos; // positive = moved up
}

// Forecast: pace-based with -20% pessimism
function calcForecast(signings, daysElapsed, daysTotal) {
  if (!daysElapsed) return 0;
  const pace = signings/daysElapsed;
  return Math.round(pace*daysTotal*0.8); // -20%
}

// Split trend: current quarter avg vs previous quarter avg
function splitTrend(email, platform) {
  const curr=getQuarterBounds(0), prev=getQuarterBounds(-1);
  const currDeals=platformSignings(email,platform,curr.start).filter(s=>s.split&&new Date(s.contractDate).getTime()<=curr.end);
  const prevDeals=platformSignings(email,platform,prev.start).filter(s=>s.split&&new Date(s.contractDate).getTime()<=prev.end);
  const avg=(deals)=>deals.length?deals.reduce((a,d)=>a+wvPct(d.split),0)/deals.length:null;
  return {curr:avg(currDeals),prev:avg(prevDeals)};
}

// ── PERFORMANCE SCORE ────────────────────────────────────────────────────────
// Composite 0-100 score: target attainment (40%) + split quality (30%) + activity (20%) + team rank (10%)
function calcPerformanceScore(email, allUsers, targets) {
  const qStart = quarterStart();
  const myTarget = targets[email] || {};

  // 1. Target attainment across platforms that have targets (40%)
  const platScores = PLATFORMS.map(p => {
    const sig = platformSignings(email, p, qStart).length;
    const tSig = myTarget[`signings_${p}`] || 0;
    if (!tSig) return null;
    return Math.min(100, Math.round((sig / tSig) * 100));
  }).filter(s => s !== null);
  const attainment = platScores.length > 0 ? platScores.reduce((a,b)=>a+b,0)/platScores.length : 50;

  // 2. Split quality vs target for FB and MSN (30%)
  const splitScores = ["Facebook","MSN"].map(p => {
    const avg = avgSplitForPlatform(email, p, qStart);
    const target = myTarget[`split_${p}`] || SPLIT_TARGETS[p] || 0;
    if (!avg || !target) return null;
    return Math.min(100, Math.round((avg / target) * 100));
  }).filter(s => s !== null);
  const splitQuality = splitScores.length > 0 ? splitScores.reduce((a,b)=>a+b,0)/splitScores.length : 50;

  // 3. Recent activity — signed something in last 14 days (20%)
  const twoWeeksAgo = Date.now() - 14*24*60*60*1000;
  const recentSigs = approvedSignings(email, twoWeeksAgo).length;
  const activity = recentSigs >= 2 ? 100 : recentSigs === 1 ? 60 : 15;

  // 4. Team rank by total signings this quarter (10%)
  const myTotal = approvedSignings(email, qStart).length;
  const allTotals = allUsers.map(u => approvedSignings(u.email, qStart).length).sort((a,b)=>b-a);
  const rankIdx = allTotals.findIndex(t => t <= myTotal);
  const rankPct = allTotals.length > 1 ? Math.round(((allTotals.length - rankIdx) / allTotals.length) * 100) : 50;

  const score = Math.round(attainment*0.40 + splitQuality*0.30 + activity*0.20 + rankPct*0.10);
  return { score: Math.min(100, Math.max(0, score)), attainment: Math.round(attainment), splitQuality: Math.round(splitQuality), activity, rankPct };
}

function perfScoreColor(score) {
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#d97706";
  return "#ef4444";
}

function perfScoreLabel(score) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "On track";
  if (score >= 50) return "Building";
  if (score >= 30) return "Needs focus";
  return "Off track";
}

// ── MOMENTUM INDICATOR ────────────────────────────────────────────────────────
// Compares last 4 weeks of signings vs previous 4 weeks
function calcMomentum(email) {
  const now = Date.now();
  const wk = 7*24*60*60*1000;
  const last4Start = now - 4*wk;
  const prev4Start = now - 8*wk;

  const last4 = approvedSignings(email, last4Start).length;
  const prev4 = approvedSignings(email, prev4Start).filter(s => {
    const t = new Date(s.contractDate).getTime();
    return t >= prev4Start && t < last4Start;
  }).length;

  if (prev4 === 0 && last4 === 0) return { trend:"neutral", pct:0, last4, prev4, label:"No data" };
  if (prev4 === 0 && last4 > 0) return { trend:"up", pct:100, last4, prev4, label:`↑ New activity` };
  if (prev4 > 0 && last4 === 0) return { trend:"down", pct:100, last4, prev4, label:`↓ Gone quiet` };

  const pct = Math.round(((last4 - prev4) / prev4) * 100);
  if (Math.abs(pct) <= 10) return { trend:"neutral", pct:0, last4, prev4, label:"→ Steady" };
  return {
    trend: pct > 0 ? "up" : "down",
    pct: Math.abs(pct),
    last4, prev4,
    label: pct > 0 ? `↑ ${Math.abs(pct)}% vs prev 4 wks` : `↓ ${Math.abs(pct)}% vs prev 4 wks`
  };
}

function momentumColor(trend) {
  if (trend === "up") return "#16a34a";
  if (trend === "down") return "#ef4444";
  return "#d97706";
}

function approvedSignings(email, since) {
  return getSignings(email).filter(s=>s.status==="approved"&&s.contractDate&&new Date(s.contractDate).getTime()>=(since||0));
}
function platformSignings(email, platform, since) {
  return approvedSignings(email, since).filter(s=>s.platform===platform);
}
function avgSplitForPlatform(email, platform, since) {
  const deals = platformSignings(email, platform, since).filter(s=>s.split);
  if (!deals.length) return 0;
  return deals.reduce((acc,d)=>acc+wvPct(d.split),0)/deals.length;
}

// ── EMAIL (Resend) ────────────────────────────────────────────────────────────
async function sendSigningNotification(rep, signing) {
  const key = typeof process!=="undefined"&&process.env?.RESEND_API_KEY ? process.env.RESEND_API_KEY : null;
  if (!key) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
      body: JSON.stringify({
        from:"Wild Vision Sales OS <hello@wildvision.io>",
        to:["frazer@wildvision.io"],
        subject:`New Signing Pending Approval — ${rep.nickname||rep.displayName} · ${signing.dealName}`,
        text:`${rep.nickname||rep.displayName} has logged a new signing for approval.\n\nDeal: ${signing.dealName}\nPlatform: ${signing.platform}\nSplit: ${signing.split||"N/A"}\nContract Date: ${signing.contractDate}\n\nLog in to the Sales OS to review and approve.`,
      })
    });
  } catch(e){ console.error("Email failed:",e); }
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState("login");
  const [allUsers, setAllUsers] = useState([]);
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    // Pull latest data from Supabase into localStorage first, THEN render login screen
    // This ensures invite codes and user accounts are available before the rep tries to use them
    syncFromSupabase().finally(() => {
      if (!getUser("frazer@wildvision.io")) {
        saveUser({email:"frazer@wildvision.io",password:"WildVision123",role:"manager",displayName:"Frazer",nickname:"Frazer",title:"Head of Sales",bio:"",accentColor:"#ff6700",photo:null,setupComplete:true,createdAt:Date.now()});
      }
      const saved = sessionStorage.getItem("wv_dash_user");
      if (saved) { try { const u=JSON.parse(saved); setUser(u); setView(u.setupComplete?"dashboard":"setup"); } catch {} }
      setSyncing(false);
    });
  }, []);

  function refreshAllUsers() { setAllUsers(getAllUsers().filter(u=>u.setupComplete)); }
  function refreshUser() { if(!user)return; const u=getUser(user.email); if(u){setUser(u);sessionStorage.setItem("wv_dash_user",JSON.stringify(u));} }
  function switchUser(email) { const u=getUser(email); if(u){setUser(u);setView("dashboard");} }

  function doLogin(email, password) {
    const u = getUser(email.toLowerCase());
    if (!u) return "No account found for that email.";
    if (u.password !== password) return "Incorrect password.";
    sessionStorage.setItem("wv_dash_user", JSON.stringify(u));
    setUser(u);
    setAllUsers(getAllUsers().filter(x=>x.setupComplete)); // populate immediately on login
    setView(u.setupComplete ? "dashboard" : "setup");
    return null;
  }

  function doLogout() {
    sessionStorage.removeItem("wv_dash_user");
    setUser(null);
    setView("login");
  }

  useEffect(() => { if(user) refreshAllUsers(); }, [user?.email]);

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:B.black,color:B.white}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Barlow+Condensed:wght@600;700;800&family=Space+Mono:wght@400;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;} ::-webkit-scrollbar-track{background:#000;} ::-webkit-scrollbar-thumb{background:#222;border-radius:2px;}
        .card{background:${B.card};border:1px solid ${B.border};border-radius:12px;}
        .btn{border:none;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:600;border-radius:8px;transition:all 0.15s;display:inline-flex;align-items:center;gap:6px;}
        .btn-p{background:${B.orange};color:#fff;padding:10px 20px;font-size:13px;}
        .btn-p:hover:not(:disabled){background:#e55d00;transform:translateY(-1px);}
        .btn-p:disabled{opacity:0.4;cursor:not-allowed;}
        .btn-g{background:transparent;color:#ccc;border:1px solid #222;padding:8px 16px;font-size:13px;}
        .btn-g:hover{border-color:#444;color:#fff;}
        .btn-sm{padding:6px 12px;font-size:12px;}
        input,select,textarea{background:#0a0a0a;border:1px solid #1e1e1e;color:#fff;padding:10px 14px;border-radius:8px;font-family:'DM Sans',sans-serif;font-size:14px;width:100%;outline:none;transition:border-color 0.2s;}
        input:focus,select:focus,textarea:focus{border-color:${B.orange};}
        input::placeholder,textarea::placeholder{color:#555;}
        select option{background:#0a0a0a;}
        label{display:block;font-size:11px;font-weight:600;color:#bbb;margin-bottom:5px;letter-spacing:0.07em;text-transform:uppercase;}
        .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;}
        .nav{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:500;color:#bbb;transition:all 0.15s;border:none;background:none;width:100%;}
        .nav:hover{background:#111;color:#fff;}
        .nav.on{background:${B.orange}18;color:${B.orange};}
        .fi{animation:fadeIn 0.25s ease;}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
      {syncing && (
        <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:20}}>
          <img src={WV_LOGO} alt="" style={{width:40,height:40,objectFit:"contain"}} />
          <div style={{width:32,height:32,border:"3px solid #1a1a1a",borderTopColor:B.orange,borderRadius:"50%",animation:"spin 0.7s linear infinite"}} />
          <div style={{fontSize:13,color:"#555",letterSpacing:"0.06em",textTransform:"uppercase"}}>Loading...</div>
        </div>
      )}
      {!syncing && view==="login" && <LoginScreen doLogin={doLogin} />}
      {!syncing && view==="setup" && user && <SetupScreen user={user} refreshUser={refreshUser} setView={setView} />}
      {!syncing && user && user.setupComplete && view!=="login" && view!=="setup" && (
        <Shell user={user} view={view} setView={setView} doLogout={doLogout} allUsers={allUsers} refreshAllUsers={refreshAllUsers} refreshUser={refreshUser} switchUser={switchUser} />
      )}
    </div>
  );
}


// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginScreen({ doLogin }) {
  const [tab, setTab] = useState("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [invCode, setInvCode] = useState("");
  const [err, setErr] = useState("");

  function tryLogin(e) {
    e.preventDefault(); setErr("");
    if (!email.trim()||!pw){setErr("Enter your email and password.");return;}
    const r = doLogin(email.trim().toLowerCase(), pw);
    if (r) setErr(r);
  }

  function trySignUp(e) {
    e.preventDefault(); setErr("");
    if (!email.trim()||!pw){setErr("Email and password are required.");return;}
    if (pw.length<6){setErr("Password must be at least 6 characters.");return;}
    if (pw!==pw2){setErr("Passwords don't match.");return;}
    if (getUser(email.trim().toLowerCase())){setErr("Account already exists. Sign in instead.");return;}
    const u={
      email:email.trim().toLowerCase(), password:pw,
      role:"rep",
      displayName:email.trim().split("@")[0],
      nickname:email.trim().split("@")[0],
      title:"", bio:"", accentColor:B.orange, photo:null,
      setupComplete:false, fromInvite:false, createdAt:Date.now(),
    };
    saveUser(u);
    const r = doLogin(u.email, pw);
    if (r) setErr(r);
  }

  function tryInvite(e) {
    e.preventDefault(); setErr("");
    if (!invCode.trim()){setErr("Enter your invite code.");return;}
    const inv = LS.get("invite:"+invCode.trim().toUpperCase());
    if (!inv){setErr("Invalid invite code. Check with your manager.");return;}
    if (inv.used){setErr("This invite has already been used.");return;}
    if (getUser(inv.email)){setErr("Account already exists for that email. Sign in instead.");return;}
    const u={email:inv.email,password:"changeme123",role:inv.role||"rep",displayName:inv.email.split("@")[0],nickname:inv.email.split("@")[0],title:"",bio:"",accentColor:B.orange,photo:null,setupComplete:false,fromInvite:true,createdAt:Date.now()};
    saveUser(u);
    LS.set("invite:"+invCode.trim().toUpperCase(),{...inv,used:true});
    const r = doLogin(inv.email,"changeme123");
    if (r) setErr(r);
  }

  const T = t => ({flex:1,padding:"7px",border:"none",background:tab===t?"#1a1a1a":"transparent",color:tab===t?"#fff":B.muted,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",borderRadius:6,transition:"all 0.15s"});

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:36}}>
          <img src={WV_LOGO} alt="" style={{width:34,height:34,objectFit:"contain"}} />
          <div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:17,letterSpacing:"0.06em",textTransform:"uppercase",color:"#bbb"}}>Wild Vision</div>
            <div style={{fontSize:12,color:"#bbb",letterSpacing:"0.1em",textTransform:"uppercase"}}>Sales OS</div>
          </div>
        </div>
        <div style={{display:"flex",gap:3,background:"#0a0a0a",border:`1px solid ${B.border}`,borderRadius:8,padding:3,marginBottom:22}}>
          <button style={T("signin")} onClick={()=>{setTab("signin");setErr("");}}>Sign In</button>
          <button style={T("signup")} onClick={()=>{setTab("signup");setErr("");}}>Sign Up</button>
          <button style={T("invite")} onClick={()=>{setTab("invite");setErr("");}}>Invite Code</button>
        </div>
        {err&&<div style={{color:"#ef4444",fontSize:13,marginBottom:14,padding:"8px 12px",background:"#ef444418",borderRadius:6,border:"1px solid #ef444433"}}>{err}</div>}
        {tab==="signin"&&(
          <form onSubmit={tryLogin} className="fi">
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:30,fontWeight:700,textTransform:"uppercase",marginBottom:18}}>Welcome back.</div>
            <div style={{display:"grid",gap:12,marginBottom:16}}>
              <div><label>Email</label><input type="email" placeholder="you@wildvision.io" value={email} onChange={e=>setEmail(e.target.value)} /></div>
              <div><label>Password</label><input type="password" placeholder="••••••••" value={pw} onChange={e=>setPw(e.target.value)} /></div>
            </div>
            <button type="submit" className="btn btn-p" style={{width:"100%",justifyContent:"center"}}>Sign In →</button>
          </form>
        )}
        {tab==="signup"&&(
          <form onSubmit={trySignUp} className="fi">
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:30,fontWeight:700,textTransform:"uppercase",marginBottom:18}}>Create account.</div>
            <div style={{display:"grid",gap:12,marginBottom:16}}>
              <div><label>Email</label><input type="email" placeholder="you@wildvision.io" value={email} onChange={e=>setEmail(e.target.value)} /></div>
              <div><label>Password</label><input type="password" placeholder="Min 6 characters" value={pw} onChange={e=>setPw(e.target.value)} /></div>
              <div><label>Confirm Password</label><input type="password" placeholder="Repeat password" value={pw2} onChange={e=>setPw2(e.target.value)} /></div>
            </div>
            <button type="submit" className="btn btn-p" style={{width:"100%",justifyContent:"center"}}>Create Account →</button>
          </form>
        )}
        {tab==="invite"&&(
          <form onSubmit={tryInvite} className="fi">
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:30,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Join the team.</div>
            <p style={{color:"#e5e5e5",fontSize:14,marginBottom:16}}>Enter the invite code from your manager.</p>
            <div style={{marginBottom:16}}>
              <label>Invite Code</label>
              <input placeholder="WV-XXXX-XXXX" value={invCode} onChange={e=>setInvCode(e.target.value.toUpperCase())} style={{fontFamily:"'Space Mono',monospace",letterSpacing:"0.1em"}} />
            </div>
            <button type="submit" className="btn btn-p" style={{width:"100%",justifyContent:"center"}}>Activate →</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── SETUP ─────────────────────────────────────────────────────────────────────
function SetupScreen({ user, refreshUser, setView }) {
  const needsPassword = user.fromInvite === true;
  const totalSteps = needsPassword ? 3 : 2;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({displayName:user.displayName||"",title:"",bio:"",accentColor:B.orange,photo:null,pw:"",pw2:""});
  const [err, setErr] = useState("");
  const fileRef = useRef();

  function finish() {
    if (needsPassword) {
      if (form.pw.length<6){setErr("Password must be at least 6 characters.");return;}
      if (form.pw!==form.pw2){setErr("Passwords don't match.");return;}
    }
    const updated={...user,displayName:form.displayName.trim(),nickname:form.displayName.trim(),title:form.title,bio:form.bio,accentColor:form.accentColor,photo:form.photo,setupComplete:true,updatedAt:Date.now()};
    if (needsPassword) updated.password = form.pw;
    saveUser(updated); refreshUser(); setView("dashboard");
  }

  const c = form.accentColor;
  const stepLabels = needsPassword ? ["Profile","Personalise","Password"] : ["Profile","Personalise"];

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:460}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:32}}>
          <img src={WV_LOGO} alt="" style={{width:26,height:26,objectFit:"contain"}} />
          <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:14,letterSpacing:"0.06em",textTransform:"uppercase",color:"#bbb"}}>Wild Vision Sales OS</span>
        </div>
        <div style={{display:"flex",gap:5,marginBottom:28}}>
          {stepLabels.map((s,i)=>(
            <div key={s} style={{flex:1}}>
              <div style={{height:3,borderRadius:2,background:i<=step?c:"#1a1a1a",transition:"background 0.3s"}} />
              <div style={{fontSize:10,color:i<=step?c:B.muted,marginTop:3,textTransform:"uppercase",letterSpacing:"0.06em"}}>{s}</div>
            </div>
          ))}
        </div>

        {step===0&&(
          <div className="fi">
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:700,textTransform:"uppercase",marginBottom:18}}>Set up your profile.</div>
            <div style={{display:"grid",gap:14}}>
              <div><label>Your Name</label><input placeholder="First and last name" value={form.displayName} onChange={e=>setForm(p=>({...p,displayName:e.target.value}))} /></div>
              <div>
                <label>Profile Photo (optional)</label>
                <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const r=new FileReader();r.onload=ev=>setForm(p=>({...p,photo:ev.target.result}));r.readAsDataURL(e.target.files[0]);}} />
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div onClick={()=>fileRef.current?.click()} style={{width:50,height:50,borderRadius:"50%",background:c+"22",border:`2px solid ${c}44`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",cursor:"pointer"}}>
                    {form.photo?<img src={form.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:18,color:c}}>{initials(form.displayName||"?")}</span>}
                  </div>
                  <button type="button" className="btn btn-g btn-sm" onClick={()=>fileRef.current?.click()}>Upload photo</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step===1&&(
          <div className="fi">
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:700,textTransform:"uppercase",marginBottom:18}}>Make it yours.</div>
            <div style={{display:"grid",gap:16}}>
              <div>
                <label>Your Title</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginTop:4}}>
                  {TITLE_OPTIONS.map(t=>(
                    <div key={t} onClick={()=>setForm(p=>({...p,title:t}))} style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${form.title===t?c:"#1e1e1e"}`,background:form.title===t?c+"18":"transparent",cursor:"pointer",fontSize:13,color:form.title===t?c:"#bbb",transition:"all 0.15s",fontWeight:form.title===t?600:400}}>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
              <div><label>Message (optional)</label><input placeholder='"Signed 12 this quarter. Just warming up."' value={form.bio} onChange={e=>setForm(p=>({...p,bio:e.target.value}))} /></div>
              <div>
                <label>Accent Colour</label>
                <div style={{display:"flex",gap:7,flexWrap:"wrap",marginTop:7}}>
                  {ACCENT_COLORS.map(col=>(
                    <div key={col} onClick={()=>setForm(p=>({...p,accentColor:col}))} style={{width:28,height:28,borderRadius:"50%",background:col,cursor:"pointer",border:`3px solid ${form.accentColor===col?"#fff":"transparent"}`,transform:form.accentColor===col?"scale(1.15)":"scale(1)",transition:"all 0.15s"}} />
                  ))}
                </div>
              </div>
            </div>
            {/* Preview */}
            <div style={{marginTop:18,padding:14,background:"#0a0a0a",borderRadius:10,border:`1px solid ${c}33`}}>
              <div style={{fontSize:11,color:"#ddd",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.07em"}}>Preview</div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <div style={{width:42,height:42,borderRadius:"50%",background:c+"22",border:`2px solid ${c}`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden"}}>
                  {form.photo?<img src={form.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:15,color:c}}>{initials(form.displayName||"?")}</span>}
                </div>
                <div>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:17}}>{form.displayName||"Your Name"}</div>
                  {form.title&&<div style={{fontSize:11,color:c,fontWeight:600}}>{form.title}</div>}
                  {form.bio&&<div style={{fontSize:12,color:"#e5e5e5",marginTop:1}}>{form.bio}</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {needsPassword&&step===2&&(
          <div className="fi">
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:28,fontWeight:700,textTransform:"uppercase",marginBottom:18}}>Set your password.</div>
            <div style={{display:"grid",gap:12}}>
              <div><label>New Password</label><input type="password" placeholder="Min 6 characters" value={form.pw} onChange={e=>setForm(p=>({...p,pw:e.target.value}))} /></div>
              <div><label>Confirm</label><input type="password" value={form.pw2} onChange={e=>setForm(p=>({...p,pw2:e.target.value}))} /></div>
            </div>
          </div>
        )}

        {err&&<div style={{color:"#ef4444",fontSize:13,marginTop:12}}>{err}</div>}
        <div style={{display:"flex",gap:10,marginTop:22}}>
          {step>0&&<button className="btn btn-g" onClick={()=>{setStep(s=>s-1);setErr("");}}>← Back</button>}
          {step<totalSteps-1
            ?<button className="btn btn-p" onClick={()=>{setErr("");if(!form.displayName.trim()){setErr("Name is required.");return;}setStep(s=>s+1);}} style={{flex:1,justifyContent:"center"}}>Continue →</button>
            :<button className="btn btn-p" onClick={finish} style={{flex:1,justifyContent:"center"}}>Launch Dashboard →</button>
          }
        </div>
      </div>
    </div>
  );
}

// ── SHELL ─────────────────────────────────────────────────────────────────────
function Shell({ user, view, setView, doLogout, allUsers, refreshAllUsers, refreshUser, switchUser }) {
  const [open, setOpen] = useState(true);
  const pendingCount = user.role==="manager" ? getAllPendingSignings().length : 0;
  const nav = [
    {id:"dashboard",icon:"⚡",label:"Dashboard"},
    {id:"stats",icon:"📊",label:"My Stats"},
    {id:"signings",icon:"✍️",label:"Log Signing"},
    {id:"leaderboard",icon:"🏆",label:"Leaderboard"},
    {id:"calculator",icon:"💰",label:"Comm. Calc"},
    {id:"targets",icon:"🎯",label:"Targets"},
    {id:"incentive",icon:"🔥",label:"Incentives"},
    {id:"profile",icon:"👤",label:"My Profile"},
    ...(user.role==="manager"?[{id:"admin",icon:"⚙️",label:"Manager",badge:pendingCount}]:[]),
  ];
  return (
    <div style={{display:"flex",minHeight:"100vh"}}>
      <div style={{width:open?240:64,background:"#050505",borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",flexShrink:0,transition:"width 0.2s",overflow:"hidden"}}>
        <div style={{padding:"20px 16px",borderBottom:`1px solid ${B.border}`,display:"flex",alignItems:"center",gap:12}}>
          <img src={WV_LOGO} alt="" style={{width:30,height:30,objectFit:"contain",flexShrink:0}} />
          {open&&<div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:16,letterSpacing:"0.06em",textTransform:"uppercase",whiteSpace:"nowrap"}}>Sales OS</div>}
        </div>
        <nav style={{flex:1,padding:"12px 8px",display:"flex",flexDirection:"column",gap:3}}>
          {nav.map(item=>(
            <button key={item.id} className={`nav${view===item.id?" on":""}`} onClick={()=>setView(item.id)} style={{justifyContent:open?"flex-start":"center",padding:"11px 14px",fontSize:15}}>
              <span style={{fontSize:18,flexShrink:0}}>{item.icon}</span>
              {open&&<span style={{whiteSpace:"nowrap",flex:1}}>{item.label}</span>}
              {open&&item.badge>0&&<span style={{background:"#ef4444",color:"#fff",borderRadius:10,padding:"2px 8px",fontSize:11,fontWeight:600,flexShrink:0}}>{item.badge}</span>}
            </button>
          ))}
        </nav>
        <div style={{padding:"12px 8px",borderTop:`1px solid ${B.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px"}}>
            <Avatar user={user} size={32} />
            {open&&<div style={{flex:1,minWidth:0}}><div style={{fontSize:14,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#fff"}}>{user.nickname||user.displayName}</div><button onClick={doLogout} style={{background:"none",border:"none",color:B.muted,fontSize:12,cursor:"pointer",padding:0,fontFamily:"'DM Sans',sans-serif"}}>Sign out</button></div>}
          </div>
        </div>
        {/* Dev user switcher — manager only */}
        {open&&user.email==="frazer@wildvision.io"&&(
          <div style={{padding:"8px 10px",borderTop:`1px solid ${B.border}`,background:"#0a0500"}}>
            <div style={{fontSize:9,color:"#d97706",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Dev: Switch User</div>
            <select onChange={e=>switchUser(e.target.value)} value={user.email} style={{fontSize:11,padding:"4px 6px",background:"#1a0e00",border:"1px solid #d9770644",color:"#d97706",borderRadius:4,width:"100%"}}>
              <option value="frazer@wildvision.io">Frazer (Manager)</option>
              <option value="rep1@wildvision.io">Flash (Rep)</option>
              <option value="rep2@wildvision.io">Hunter (Rep)</option>
            </select>
          </div>
        )}
        <button onClick={()=>setOpen(o=>!o)} style={{background:"none",border:"none",color:B.muted,cursor:"pointer",padding:"10px",fontSize:13,borderTop:`1px solid ${B.border}`}}>{open?"◀":"▶"}</button>
      </div>
      <div style={{flex:1,overflow:"auto",padding:26}}>
        {view==="dashboard"&&<Dashboard user={user} allUsers={allUsers} announcement={getAnnouncement()} />}
        {view==="stats"&&<RepStats user={user} allUsers={allUsers} />}
        {view==="signings"&&<LogSigning user={user} refreshUser={refreshUser} />}
        {view==="leaderboard"&&<Leaderboard user={user} allUsers={allUsers} />}
        {view==="calculator"&&<Calculator user={user} />}
        {view==="targets"&&<Targets user={user} allUsers={allUsers} />}
        {view==="incentive"&&<Incentives user={user} allUsers={allUsers} />}
        {view==="profile"&&<Profile user={user} refreshUser={refreshUser} />}
        {view==="admin"&&user.role==="manager"&&<Admin user={user} allUsers={allUsers} refreshAllUsers={refreshAllUsers} />}
      </div>
    </div>
  );
}

// ── AVATAR ────────────────────────────────────────────────────────────────────
function Avatar({ user, size=38 }) {
  const c = user?.accentColor||B.orange;
  return (
    <div style={{width:size,height:size,borderRadius:"50%",background:c+"22",border:`2px solid ${c}55`,display:"flex",alignItems:"center",justifyContent:"center",overflow:"hidden",flexShrink:0}}>
      {user?.photo?<img src={user.photo} style={{width:"100%",height:"100%",objectFit:"cover"}}/>:<span style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:size*0.36,color:c}}>{initials(user?.nickname||user?.displayName||"?")}</span>}
    </div>
  );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({ user, allUsers, announcement }) {
  const targets = getTargets();
  const badges = getBadges().filter(b=>b.recipientEmail===user.email);
  const incentive = getIncentive();
  const myTarget = targets[user.email]||{};
  const qStart = quarterStart();
  const pendingCount = getSignings(user.email).filter(s=>s.status==="pending").length;
  const perfData = calcPerformanceScore(user.email, allUsers, targets);
  const momentum = calcMomentum(user.email);
  const c = user.accentColor||B.orange;
  const daysLeft = daysLeftInQuarter();
  const daysElapsed = daysElapsedInQuarter();
  const daysTotal = daysInQuarter();
  const q = Math.floor(new Date().getMonth()/3);
  const wkStart = getWeekStart(0), lastWkStart = getWeekStart(-1), lastWkEnd = getWeekStart(0);
  const moStart = getMonthStart(0), lastMoStart = getMonthStart(-1), lastMoEnd = getMonthStart(0);
  const streaks = calcStreaks(user.email);

  const platforms = PLATFORMS.map(p=>({
    platform:p,
    color:PLATFORM_COLOR[p],
    signings:platformSignings(user.email,p,qStart).length,
    target:myTarget[`signings_${p}`]||0,
    avgSplit:SPLIT_TARGETS[p]!=null?avgSplitForPlatform(user.email,p,qStart):null,
    splitTarget:myTarget[`split_${p}`]||SPLIT_TARGETS[p]||null,
    thisWeek:platformSignings(user.email,p,wkStart).length,
    lastWeek:platformSignings(user.email,p,lastWkStart).filter(s=>new Date(s.contractDate).getTime() < lastWkEnd).length,
    thisMonth:platformSignings(user.email,p,moStart).length,
    lastMonth:platformSignings(user.email,p,lastMoStart).filter(s=>new Date(s.contractDate).getTime() < lastMoEnd).length,
    forecast:calcForecast(platformSignings(user.email,p,qStart).length, daysElapsed, daysTotal),
    splitTrend:SPLIT_TARGETS[p]!=null?splitTrend(user.email,p):null,
  }));

  const totalSignings=platforms.reduce((s,p)=>s+p.signings,0);
  const totalTarget=platforms.reduce((s,p)=>s+(p.target||0),0);
  const totalForecast=platforms.reduce((s,p)=>s+p.forecast,0);

  return (
    <div className="fi">
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:40,fontWeight:700,textTransform:"uppercase",lineHeight:0.95,marginBottom:5}}>
            {greeting()},<br/><span style={{color:c}}>{user.nickname||user.displayName}.</span>
          </div>
          {user.title&&<div style={{fontSize:14,color:c,fontWeight:600,letterSpacing:"0.04em"}}>{user.title}</div>}
        </div>
        <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:25,fontWeight:700,color:c}}>{daysLeft}</div>
            <div style={{fontSize:13,color:"#ddd"}}>days left in Q{q+1}</div>
            <div style={{fontSize:12,color:"#ddd",marginTop:3}}>{new Date().toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>
          </div>
          {streaks.hotWeek&&<span style={{fontSize:14,fontWeight:600,color:"#f59e0b",background:"#f59e0b18",border:"1px solid #f59e0b33",borderRadius:12,padding:"2px 8px"}}>🔥 {streaks.thisWeekCount} this week</span>}
          {streaks.weeklyStreak>=2&&<span style={{fontSize:14,fontWeight:600,color:"#16a34a",background:"#16a34a18",border:"1px solid #16a34a33",borderRadius:12,padding:"2px 8px"}}>🔁 {streaks.weeklyStreak}-week streak</span>}
        </div>
      </div>

      {/* Team announcement banner */}
      {announcement&&(
        <div style={{background:`linear-gradient(135deg,${B.orange}22,#0d0d0d)`,border:`1px solid ${B.orange}55`,borderRadius:10,padding:"12px 18px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18,flexShrink:0}}>{announcement.emoji||"📣"}</span>
            <div>
              <div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{announcement.text}</div>
              {announcement.from&&<div style={{fontSize:12,color:"#e5e5e5",marginTop:2}}>From {announcement.from} · {timeAgo(announcement.ts)}</div>}
            </div>
          </div>
        </div>
      )}

      {/* Weekly meeting recap */}
      {(() => {
        const recap = getMeetingRecap();
        if (!recap) return null;
        return (
          <div style={{background:"#0a0d12",border:"1px solid #3b82f644",borderRadius:12,padding:"16px 20px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:16}}>📋</span>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#60a5fa",letterSpacing:"0.04em",textTransform:"uppercase"}}>Weekly Meeting Recap</div>
                  {recap.date&&<div style={{fontSize:11,color:"#555",marginTop:1}}>{recap.date}</div>}
                </div>
              </div>
              {recap.link&&<a href={recap.link} target="_blank" rel="noreferrer" style={{fontSize:12,color:"#3b82f6",textDecoration:"none",fontWeight:600}}>View recording →</a>}
            </div>
            {recap.summary&&<div style={{fontSize:13,color:"#ccc",lineHeight:1.6,marginBottom:recap.tasks?.length?12:0,whiteSpace:"pre-wrap"}}>{recap.summary}</div>}
            {recap.tasks?.length>0&&(
              <div>
                <div style={{fontSize:11,fontWeight:600,color:"#60a5fa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Your Tasks</div>
                <div style={{display:"grid",gap:5}}>
                  {recap.tasks.filter(t=>!t.assignee||t.assignee===user.nickname||t.assignee===user.displayName||t.assignee==="All").map((t,i)=>(
                    <div key={i} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"7px 10px",background:"#080808",borderRadius:7,border:"1px solid #1e2a3a"}}>
                      <span style={{color:"#3b82f6",flexShrink:0,marginTop:1}}>◦</span>
                      <div>
                        <div style={{fontSize:13,color:"#ddd"}}>{t.task}</div>
                        {t.assignee&&t.assignee!=="All"&&<div style={{fontSize:11,color:"#555",marginTop:1}}>→ {t.assignee}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Pending approval notice */}
      {pendingCount>0&&(
        <div style={{background:"#1a1200",border:"1px solid #d97706",borderRadius:10,padding:"10px 16px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{fontSize:15,color:"#d97706"}}>⏳ <strong>{pendingCount} signing{pendingCount>1?"s":""}</strong> awaiting approval — won't count toward targets until approved</div>
        </div>
      )}

      {/* Performance Score + Momentum */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:10,marginBottom:14}}>
        {/* Performance Score */}
        <div className="card" style={{padding:18,borderColor:perfScoreColor(perfData.score)+"44",background:`linear-gradient(135deg,${perfScoreColor(perfData.score)}0a,#0d0d0d)`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontSize:11,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Performance Score</div>
              <div style={{display:"flex",alignItems:"flex-end",gap:10,marginBottom:4}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:56,fontWeight:700,color:perfScoreColor(perfData.score),lineHeight:1}}>{perfData.score}</div>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:18,color:"#555",lineHeight:1,paddingBottom:6}}>/100</div>
              </div>
              <div style={{fontSize:13,fontWeight:600,color:perfScoreColor(perfData.score)}}>{perfScoreLabel(perfData.score)}</div>
            </div>
            {/* Score breakdown */}
            <div style={{display:"grid",gap:5,minWidth:140}}>
              {[
                {label:"Target Attainment",val:perfData.attainment,weight:"40%"},
                {label:"Split Quality",val:perfData.splitQuality,weight:"30%"},
                {label:"Recent Activity",val:perfData.activity,weight:"20%"},
                {label:"Team Rank",val:perfData.rankPct,weight:"10%"},
              ].map(s=>(
                <div key={s.label}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                    <span style={{fontSize:10,color:"#777"}}>{s.label}</span>
                    <span style={{fontSize:10,color:perfScoreColor(s.val),fontWeight:600}}>{s.val}</span>
                  </div>
                  <div style={{height:3,background:"#111",borderRadius:2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${s.val}%`,background:perfScoreColor(s.val),borderRadius:2,transition:"width 0.5s"}} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Momentum */}
        <div className="card" style={{padding:18,borderColor:momentumColor(momentum.trend)+"44",background:`linear-gradient(135deg,${momentumColor(momentum.trend)}0a,#0d0d0d)`,display:"flex",flexDirection:"column",justifyContent:"space-between"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Momentum</div>
          <div>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:36,fontWeight:700,color:momentumColor(momentum.trend),lineHeight:1,marginBottom:4}}>
              {momentum.trend==="up"?"↑":momentum.trend==="down"?"↓":"→"}
              {momentum.pct>0?` ${momentum.pct}%`:""}
            </div>
            <div style={{fontSize:13,color:"#ddd",fontWeight:600,marginBottom:8}}>{momentum.label}</div>
            <div style={{display:"flex",gap:12}}>
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:700,color:momentumColor(momentum.trend)}}>{momentum.last4}</div>
                <div style={{fontSize:10,color:"#666"}}>last 4 wks</div>
              </div>
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:700,color:"#555"}}>{momentum.prev4}</div>
                <div style={{fontSize:10,color:"#666"}}>prev 4 wks</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Platform cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        {platforms.map(p=>{
          const pct=p.target>0?Math.min(100,Math.round((p.signings/p.target)*100)):null;
          const wkDiff=p.thisWeek-p.lastWeek;
          const moDiff=p.thisMonth-p.lastMonth;
          return (
            <div key={p.platform} className="card" style={{padding:16,borderColor:p.color+"33"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontWeight:700,fontSize:14,color:p.color}}>{p.platform}</div>
                {pct!==null&&<span style={{fontSize:14,fontWeight:600,color:pct>=100?"#16a34a":pct>=70?"#d97706":"#ef4444"}}>{pct}%</span>}
              </div>
              <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:40,fontWeight:700,color:p.color,lineHeight:1,marginBottom:2}}>
                {p.signings}<span style={{fontSize:15,color:"#e5e5e5",fontWeight:400}}>{p.target>0?` / ${p.target}`:""}</span>
              </div>
              <div style={{fontSize:15,color:"#ddd",marginBottom:p.target>0?6:4}}>signings this quarter</div>
              {p.target>0&&<div style={{height:4,background:"#111",borderRadius:2,overflow:"hidden",marginBottom:6}}><div style={{height:"100%",width:`${pct}%`,background:p.color,borderRadius:2,transition:"width 0.5s"}} /></div>}

              {/* Week/month comparison */}
              <div style={{display:"flex",gap:8,marginBottom:p.avgSplit!=null?6:0}}>
                <span style={{fontSize:14,color:wkDiff>0?"#16a34a":wkDiff<0?"#ef4444":B.muted}}>Wk: {p.thisWeek} {wkDiff!==0?`(${wkDiff>0?"+":""}${wkDiff})`:""}</span>
                <span style={{fontSize:14,color:moDiff>0?"#16a34a":moDiff<0?"#ef4444":B.muted}}>Mo: {p.thisMonth} {moDiff!==0?`(${moDiff>0?"+":""}${moDiff})`:""}</span>
              </div>

              {/* Split quality */}
              {p.avgSplit!=null&&p.avgSplit>0&&(
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:15,color:"#ddd"}}>Avg split</span>
                  <span style={{fontSize:14,fontWeight:600,color:p.avgSplit>=(p.splitTarget||0)?"#16a34a":"#ef4444"}}>
                    {fmtPct(p.avgSplit)}{p.splitTarget?` / ${fmtPct(p.splitTarget)}`:""}</span>
                </div>
              )}
              {/* Split trend */}
              {p.splitTrend&&p.splitTrend.curr!=null&&p.splitTrend.prev!=null&&(
                <div style={{fontSize:9,color:(p.splitTrend.curr-p.splitTrend.prev)>=0?"#16a34a":"#ef4444",marginTop:2}}>
                  Split vs last Q: {(p.splitTrend.curr-p.splitTrend.prev)>0?"+":""}{(p.splitTrend.curr-p.splitTrend.prev).toFixed(1)}%
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Personal forecast card */}
      <div className="card" style={{padding:16,marginBottom:12}}>
        <div style={{fontSize:15,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:12}}>Personal Forecast — Q{q+1}</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:10}}>
          {platforms.map(p=>{
            const gap=p.target>0?p.target-p.signings:null;
            const overUnder=p.target>0?Math.round(((p.forecast-p.target)/p.target)*100):null;
            return (
              <div key={p.platform} style={{textAlign:"center",padding:"10px 8px",background:"#080808",borderRadius:8,border:`1px solid ${p.color}22`}}>
                <div style={{fontSize:14,color:p.color,fontWeight:600,marginBottom:4}}>{p.platform}</div>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:25,fontWeight:700,color:overUnder!=null&&overUnder>=0?"#16a34a":"#ef4444"}}>{p.forecast}</div>
                <div style={{fontSize:9,color:B.muted}}>forecast</div>
                {gap!=null&&<div style={{fontSize:9,marginTop:3,color:gap<=0?"#16a34a":"#d97706"}}>{gap<=0?"On track":"Need "+gap+" more"}</div>}
                {overUnder!=null&&<div style={{fontSize:9,color:overUnder>=0?"#16a34a":"#ef4444",marginTop:1}}>{overUnder>=0?"+":""}{overUnder}% vs target</div>}
              </div>
            );
          })}
        </div>
        <div style={{fontSize:14,color:"#e5e5e5",fontStyle:"italic"}}>Forecast based on current pace with a -20% adjustment. {daysLeft} days remaining in Q{q+1}.</div>
      </div>

      {incentive&&(
        <div style={{background:`linear-gradient(135deg,${B.orange}18,#0d0d0d)`,border:`1px solid ${B.orange}44`,borderRadius:12,padding:14,marginBottom:12}}>
          <div style={{fontSize:14,fontWeight:600,color:B.orange,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3}}>🔥 Current Incentive</div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:23,fontWeight:700,marginBottom:2}}>{incentive.title}</div>
          <div style={{fontSize:14,color:"#ddd"}}>{incentive.description}</div>
          {incentive.reward&&<div style={{fontSize:15,color:"#f59e0b",marginTop:3,fontWeight:600}}>Prize: {incentive.reward}</div>}
        </div>
      )}

      {/* Recent signings */}
      <div className="card" style={{padding:16}}>
        <div style={{fontSize:15,fontWeight:600,color:B.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Recent Approved Signings</div>
        {(() => {
          const all=getSignings(user.email).filter(s=>s.status==="approved").slice(-5).reverse();
          if (!all.length) return <div style={{color:"#e5e5e5",fontSize:15,textAlign:"center",padding:"16px 0"}}>No approved signings yet. Log your first once the contract is complete.</div>;
          return <div style={{display:"grid",gap:6}}>
            {all.map((s,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 11px",background:"#080808",borderRadius:8,border:`1px solid ${B.border}`}}>
                <div><div style={{fontWeight:500,fontSize:14,color:"#fff"}}>{s.dealName}</div><div style={{fontSize:14,color:"#e5e5e5"}}>{s.platform}{s.split?" · "+s.split:""} · {s.contractDate}</div></div>
                <span style={{fontSize:15,color:PLATFORM_COLOR[s.platform]||c,fontWeight:600}}>{s.platform}</span>
              </div>
            ))}
          </div>;
        })()}
      </div>

      {badges.length>0&&(
        <div className="card" style={{padding:14,marginTop:10}}>
          <div style={{fontSize:15,fontWeight:600,color:B.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8}}>Badges</div>
          <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
            {badges.map((b,i)=>(
              <div key={i} style={{display:"flex",alignItems:"center",gap:6,background:"#f59e0b18",border:"1px solid #f59e0b44",borderRadius:8,padding:"5px 10px"}}>
                <span style={{fontSize:14}}>{b.emoji||"🏅"}</span>
                <div><div style={{fontSize:15,fontWeight:600,color:"#f59e0b"}}>{b.name}</div><div style={{fontSize:15,color:"#ddd"}}>{new Date(b.awardedAt).toLocaleDateString("en-GB")}</div></div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── REP STATS (Phase 2 — Close Rate + Cycle Speed) ───────────────────────────
const PLATFORM_MAP_STATS = {
  "Facebook":"Facebook","Microsoft Start":"MSN","Spotify":"Spotify",
};
const SALES_CLOSED_STAGES = ["Ready to Submit to Platform","Awaiting Platform Approval","Ready to go Live","Live"];

// Compute stats from a set of Zoho deals
function computeStats(deals) {
  const normPlat = d => PLATFORM_MAP_STATS[d.Associated_Platform?.name || d.Associated_Platform || ""] || (d.Associated_Platform?.name || "Other");
  const salesClosed = deals.filter(d => SALES_CLOSED_STAGES.includes(d.Stage));
  const lost = deals.filter(d => d.Stage === "Lost");
  const live = deals.filter(d => d.Stage === "Live");
  const closedTotal = salesClosed.length + lost.length;
  const closeRate = closedTotal > 0 ? Math.round((salesClosed.length / closedTotal) * 100) : null;

  const contractOrBeyond = deals.filter(d => {
    const ORDER = ["CM's to Approve","Meeting With Creator","Interested","Conversations on Pause","Reviewing Terms","Contract sent for Signature","Ready to Submit to Platform","Awaiting Platform Approval","Ready to go Live","Live"];
    return ORDER.indexOf(d.Stage) >= 4;
  });
  const contractClosed = contractOrBeyond.filter(d => SALES_CLOSED_STAGES.includes(d.Stage));
  const contractLost = contractOrBeyond.filter(d => d.Stage === "Lost");
  const contractTotal = contractClosed.length + contractLost.length;
  const contractRate = contractTotal > 0 ? Math.round((contractClosed.length / contractTotal) * 100) : null;

  const cycleDeals = salesClosed.filter(d => d.Created_Time && d.Closing_Date);
  const avgCycle = cycleDeals.length > 0
    ? Math.round(cycleDeals.reduce((s,d) => s + Math.max(0, Math.floor((new Date(d.Closing_Date)-new Date(d.Created_Time))/864e5)), 0) / cycleDeals.length)
    : null;

  const platRates = PLATFORMS.map(p => {
    const pRaw = p === "MSN" ? "Microsoft Start" : p;
    const pClosed = salesClosed.filter(d => (d.Associated_Platform?.name||d.Associated_Platform) === pRaw || normPlat(d) === p);
    const pLost = lost.filter(d => (d.Associated_Platform?.name||d.Associated_Platform) === pRaw || normPlat(d) === p);
    const t = pClosed.length + pLost.length;
    return { platform:p, closed:pClosed.length, lost:pLost.length, total:t, rate: t>0 ? Math.round((pClosed.length/t)*100) : null };
  });

  const platCycles = PLATFORMS.map(p => {
    const pRaw = p === "MSN" ? "Microsoft Start" : p;
    const pd = cycleDeals.filter(d => (d.Associated_Platform?.name||d.Associated_Platform) === pRaw || normPlat(d) === p);
    const avg = pd.length > 0 ? Math.round(pd.reduce((s,d) => s + Math.max(0, Math.floor((new Date(d.Closing_Date)-new Date(d.Created_Time))/864e5)), 0) / pd.length) : null;
    return { platform:p, avgDays:avg, count:pd.length };
  });

  return { salesClosed, lost, live, closeRate, contractRate, contractClosed, contractTotal, avgCycle, platRates, platCycles, normPlat };
}

// Historical quarter comparison — groups deals by quarter of closing date
function buildQuarterHistory(deals) {
  const buckets = {};
  deals.forEach(d => {
    const dt = d.Closing_Date ? new Date(d.Closing_Date) : d.Created_Time ? new Date(d.Created_Time) : null;
    if (!dt) return;
    const y = dt.getFullYear(), q = Math.floor(dt.getMonth()/3);
    const key = `${y}-Q${q+1}`;
    if (!buckets[key]) buckets[key] = { label:`Q${q+1} ${y}`, deals:[], year:y, q };
    buckets[key].deals.push(d);
  });
  return Object.entries(buckets)
    .sort(([a],[b]) => a < b ? -1 : 1)
    .slice(-6) // last 6 quarters
    .map(([key, val]) => ({ ...val, ...computeStats(val.deals) }));
}

function getDemoDeals() {
  const now = Date.now(), iso = days => new Date(now-days*864e5).toISOString(), d = days => iso(days).split("T")[0];
  return [
    // This quarter
    {Deal_Name:"Creator A",Stage:"Ready to Submit to Platform",Associated_Platform:{name:"Facebook"},WV_Percentage:60,Created_Time:iso(45),Closing_Date:d(10)},
    {Deal_Name:"Creator B",Stage:"Awaiting Platform Approval",Associated_Platform:{name:"Microsoft Start"},WV_Percentage:55,Created_Time:iso(38),Closing_Date:d(8)},
    {Deal_Name:"Creator C",Stage:"Ready to Submit to Platform",Associated_Platform:{name:"Spotify"},WV_Percentage:50,Created_Time:iso(30),Closing_Date:d(5)},
    {Deal_Name:"Creator D",Stage:"Live",Associated_Platform:{name:"Facebook"},WV_Percentage:65,Created_Time:iso(70),Closing_Date:d(15)},
    {Deal_Name:"Creator E",Stage:"Live",Associated_Platform:{name:"Microsoft Start"},WV_Percentage:55,Created_Time:iso(50),Closing_Date:d(25)},
    {Deal_Name:"Creator F",Stage:"Lost",Associated_Platform:{name:"Facebook"},WV_Percentage:0,Created_Time:iso(55),Closing_Date:d(15)},
    {Deal_Name:"Creator G",Stage:"Lost",Associated_Platform:{name:"Microsoft Start"},WV_Percentage:0,Created_Time:iso(40),Closing_Date:d(12)},
    // Last quarter (offset ~100 days)
    {Deal_Name:"Old Deal A",Stage:"Ready to Submit to Platform",Associated_Platform:{name:"Facebook"},WV_Percentage:60,Created_Time:iso(130),Closing_Date:d(95)},
    {Deal_Name:"Old Deal B",Stage:"Live",Associated_Platform:{name:"Microsoft Start"},WV_Percentage:55,Created_Time:iso(120),Closing_Date:d(100)},
    {Deal_Name:"Old Deal C",Stage:"Lost",Associated_Platform:{name:"Spotify"},WV_Percentage:0,Created_Time:iso(115),Closing_Date:d(105)},
    {Deal_Name:"Old Deal D",Stage:"Awaiting Platform Approval",Associated_Platform:{name:"Facebook"},WV_Percentage:60,Created_Time:iso(140),Closing_Date:d(108)},
  ];
}

function RepStats({ user, allUsers }) {
  const [zohoDeals, setZohoDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState("quarter");
  const [activeTab, setActiveTab] = useState("overview"); // overview | history
  const c = user.accentColor || B.orange;
  const isManager = user.role === "manager";
  const q = Math.floor(new Date().getMonth()/3);

  useEffect(() => { loadDeals(); }, [user.email]);

  async function loadDeals() {
    setLoading(true); setError(null);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","anthropic-dangerous-direct-browser-access":"true"},
        body:JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:8000,
          system:`You are a data assistant. Fetch Zoho CRM deals. Return ONLY a raw JSON array, no markdown, no explanation. Each object: Deal_Name, Stage, Associated_Platform (name string), WV_Percentage, Closing_Date, Created_Time.`,
          messages:[{role:"user",content:`Fetch all deals from Zoho CRM where Owner email is "${user.email}". All stages including Lost and Live. Return only JSON array.`}],
          mcp_servers:[{type:"url",url:"https://claude-zohocrm.zohomcp.eu/mcp/message",name:"zoho-crm"}]
        })
      });
      if (!resp.ok) throw new Error("API "+resp.status);
      const data = await resp.json();
      const text = data.content?.find(b=>b.type==="text")?.text?.trim()||"";
      const s=text.indexOf("["), e=text.lastIndexOf("]");
      if (s===-1) throw new Error("no_data");
      setZohoDeals(JSON.parse(text.slice(s,e+1)));
    } catch(err) {
      setZohoDeals(getDemoDeals()); setError("demo");
    }
    setLoading(false);
  }

  function filterByPeriod(deals) {
    if (period==="all") return deals;
    const qStart = quarterStart();
    return deals.filter(d => {
      const t = d.Closing_Date ? new Date(d.Closing_Date).getTime() : new Date(d.Created_Time).getTime();
      return t >= qStart;
    });
  }

  const periodDeals = filterByPeriod(zohoDeals);
  const stats = computeStats(periodDeals);
  const liveAll = zohoDeals.filter(d=>d.Stage==="Live");
  const history = buildQuarterHistory(zohoDeals);

  const T = t => ({padding:"7px 14px",border:"none",background:activeTab===t?c:"transparent",color:activeTab===t?"#fff":"#bbb",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",borderRadius:6,transition:"all 0.15s"});

  return (
    <div className="fi">
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,flexWrap:"wrap",gap:12}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:44,fontWeight:700,textTransform:"uppercase"}}>My Stats</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",background:"#0a0a0a",border:`1px solid ${B.border}`,borderRadius:8,padding:3,gap:2}}>
            {[["quarter",`Q${q+1} Only`],["all","All Time"]].map(([k,l])=>(
              <button key={k} onClick={()=>setPeriod(k)} style={{padding:"6px 14px",borderRadius:6,border:"none",background:period===k?c:"transparent",color:period===k?"#fff":"#bbb",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all 0.15s"}}>{l}</button>
            ))}
          </div>
          <button onClick={loadDeals} disabled={loading} style={{background:"#1a1a1a",border:`1px solid ${c}44`,color:c,padding:"8px 14px",borderRadius:8,fontSize:13,fontWeight:600,cursor:loading?"not-allowed":"pointer",fontFamily:"'DM Sans',sans-serif"}}>{loading?"...":"↻"}</button>
        </div>
      </div>
      <p style={{color:"#ddd",fontSize:15,marginBottom:4}}>Stats up to handoff — once it reaches Ready to Submit or Awaiting Platform Approval, it's out of your hands.</p>
      <p style={{color:"#777",fontSize:13,marginBottom:20}}>Live from Zoho CRM.</p>

      {error==="demo"&&<div style={{background:"#1a1200",border:"1px solid #d9770644",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:13,color:"#d97706"}}>⚡ Demo data — live Zoho data loads in Bolt.</div>}

      {loading&&<div style={{display:"flex",alignItems:"center",gap:14,padding:"40px 0"}}><div style={{width:28,height:28,border:"3px solid #1a1a1a",borderTopColor:c,borderRadius:"50%",animation:"spin 0.7s linear infinite"}} /><div style={{color:"#ddd",fontSize:15}}>Loading from Zoho...</div></div>}

      {!loading&&<>
        {/* Tab bar */}
        <div style={{display:"flex",gap:3,background:"#0a0a0a",border:`1px solid ${B.border}`,borderRadius:8,padding:3,marginBottom:20,width:"fit-content"}}>
          <button style={T("overview")} onClick={()=>setActiveTab("overview")}>Overview</button>
          <button style={T("history")} onClick={()=>setActiveTab("history")}>Quarter History</button>
          {isManager&&<button style={T("team")} onClick={()=>setActiveTab("team")}>Team Stats</button>}
        </div>

        {/* ── OVERVIEW ── */}
        {activeTab==="overview"&&<>
          {/* Key numbers */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
            {[
              {label:"Close Rate",val:stats.closeRate!==null?stats.closeRate+"%":"—",sub:`${stats.salesClosed.length} closed · ${stats.lost.length} lost`,col:stats.closeRate!==null?(stats.closeRate>=60?"#16a34a":stats.closeRate>=40?"#d97706":"#ef4444"):"#aaa"},
              {label:"Contract Rate",val:stats.contractRate!==null?stats.contractRate+"%":"—",sub:`${stats.contractClosed.length} of ${stats.contractTotal} from contract`,col:stats.contractRate!==null?(stats.contractRate>=70?"#16a34a":"#d97706"):"#aaa"},
              {label:"Avg Cycle",val:stats.avgCycle!==null?stats.avgCycle+"d":"—",sub:"pitch to handoff",col:c},
              {label:"Deals Live",val:stats.live.length,sub:`Q${q+1} · ${liveAll.length} all time`,col:"#16a34a"},
            ].map(s=>(
              <div key={s.label} className="card" style={{padding:16}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:36,fontWeight:700,color:s.col,lineHeight:1,marginBottom:4}}>{s.val}</div>
                <div style={{fontSize:11,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{s.label}</div>
                <div style={{fontSize:12,color:"#777"}}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Platform close rate */}
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Close Rate by Platform</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {stats.platRates.map(p=>{
                const pc=PLATFORM_COLOR[p.platform];
                return (
                  <div key={p.platform} style={{background:"#080808",borderRadius:10,padding:"14px 16px",border:`1px solid ${pc}33`}}>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,color:pc,marginBottom:8}}>{p.platform}</div>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:32,fontWeight:700,color:p.rate!==null?(p.rate>=50?"#16a34a":"#d97706"):"#555",lineHeight:1,marginBottom:4}}>{p.rate!==null?p.rate+"%":"—"}</div>
                    <div style={{fontSize:12,color:"#aaa",marginBottom:p.total>0?8:0}}>{p.closed} closed · {p.lost} lost</div>
                    {p.total>0&&<div style={{height:5,background:"#111",borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${p.rate}%`,background:p.rate>=50?"#16a34a":"#d97706",borderRadius:3,transition:"width 0.5s"}} /></div>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cycle speed */}
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Sales Cycle Speed</div>
            <div style={{fontSize:13,color:"#777",marginBottom:14}}>Days from deal created to reaching Ready to Submit / Awaiting Platform Approval.</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {stats.platCycles.map(p=>{
                const pc=PLATFORM_COLOR[p.platform];
                return (
                  <div key={p.platform} style={{background:"#080808",borderRadius:10,padding:"14px 16px",border:`1px solid ${pc}33`}}>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,color:pc,marginBottom:8}}>{p.platform}</div>
                    <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:32,fontWeight:700,color:p.avgDays!==null?c:"#555",lineHeight:1,marginBottom:4}}>{p.avgDays!==null?p.avgDays+"d":"—"}</div>
                    <div style={{fontSize:12,color:"#aaa"}}>{p.count} deal{p.count!==1?"s":""}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent live deals */}
          {liveAll.length>0&&(
            <div className="card" style={{padding:20}}>
              <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>Recent Live Deals</div>
              <div style={{fontSize:13,color:"#777",marginBottom:14}}>Deals that made it all the way to Live — ops got them over the line.</div>
              <div style={{display:"grid",gap:8}}>
                {liveAll.slice(0,8).map((d,i)=>{
                  const plat=stats.normPlat(d),pc=PLATFORM_COLOR[plat]||"#888";
                  const cyc=d.Created_Time&&d.Closing_Date?Math.floor((new Date(d.Closing_Date)-new Date(d.Created_Time))/864e5):null;
                  return (
                    <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#080808",borderRadius:8,border:"1px solid #1e1e1e"}}>
                      <div>
                        <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:3}}>{d.Deal_Name}</div>
                        <div style={{display:"flex",gap:7,alignItems:"center"}}>
                          <span style={{fontSize:11,background:pc+"22",color:pc,border:`1px solid ${pc}33`,borderRadius:6,padding:"1px 7px",fontWeight:600}}>{plat}</span>
                          {d.WV_Percentage>0&&<span style={{fontSize:11,color:"#bbb"}}>WV {d.WV_Percentage}%</span>}
                          {d.Closing_Date&&<span style={{fontSize:11,color:"#777"}}>{new Date(d.Closing_Date).toLocaleDateString("en-GB")}</span>}
                        </div>
                      </div>
                      {cyc!==null&&<div style={{textAlign:"right",flexShrink:0}}><div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:700,color:c}}>{cyc}d</div><div style={{fontSize:10,color:"#777"}}>total cycle</div></div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>}

        {/* ── QUARTER HISTORY ── */}
        {activeTab==="history"&&<>
          <p style={{color:"#ddd",fontSize:14,marginBottom:20}}>Close rate and cycle speed across the last 6 quarters. Spot trends in your performance over time.</p>
          {history.length===0
            ?<div className="card" style={{padding:40,textAlign:"center",color:"#555"}}>Not enough historical data yet.</div>
            :<>
              {/* Close rate trend bars */}
              <div className="card" style={{padding:20,marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:20}}>Close Rate Trend</div>
                <div style={{display:"flex",alignItems:"flex-end",gap:10,height:140,marginBottom:12}}>
                  {history.map((qh,i)=>{
                    const rate=qh.closeRate||0, isCurrent=i===history.length-1;
                    const h=Math.max(4,Math.round((rate/100)*120));
                    return (
                      <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                        <div style={{fontSize:13,fontWeight:700,color:isCurrent?c:"#ddd"}}>{rate>0?rate+"%":"—"}</div>
                        <div style={{width:"100%",height:`${h}px`,background:isCurrent?c:rate>=60?"#16a34a44":rate>=40?"#d9770644":"#ef444444",borderRadius:"4px 4px 0 0",border:`1px solid ${isCurrent?c:rate>=60?"#16a34a":rate>=40?"#d97706":"#ef4444"}`,transition:"height 0.5s"}} />
                      </div>
                    );
                  })}
                </div>
                <div style={{display:"flex",gap:10}}>
                  {history.map((qh,i)=>(
                    <div key={i} style={{flex:1,textAlign:"center",fontSize:11,color:i===history.length-1?c:"#666"}}>{qh.label}</div>
                  ))}
                </div>
              </div>

              {/* Cycle speed trend */}
              <div className="card" style={{padding:20,marginBottom:14}}>
                <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:20}}>Avg Cycle Speed Trend</div>
                {(() => {
                  const maxCyc = Math.max(...history.map(h=>h.avgCycle||0),1);
                  return (
                    <>
                      <div style={{display:"flex",alignItems:"flex-end",gap:10,height:140,marginBottom:12}}>
                        {history.map((qh,i)=>{
                          const cyc=qh.avgCycle||0, isCurrent=i===history.length-1;
                          const h=Math.max(4,Math.round((cyc/maxCyc)*120));
                          return (
                            <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                              <div style={{fontSize:13,fontWeight:700,color:isCurrent?c:"#ddd"}}>{cyc>0?cyc+"d":"—"}</div>
                              <div style={{width:"100%",height:`${h}px`,background:isCurrent?c+"44":"#33333388",borderRadius:"4px 4px 0 0",border:`1px solid ${isCurrent?c:"#444"}`,transition:"height 0.5s"}} />
                            </div>
                          );
                        })}
                      </div>
                      <div style={{display:"flex",gap:10}}>
                        {history.map((qh,i)=>(
                          <div key={i} style={{flex:1,textAlign:"center",fontSize:11,color:i===history.length-1?c:"#666"}}>{qh.label}</div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Quarter table */}
              <div className="card" style={{padding:20}}>
                <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Quarter Breakdown</div>
                <div style={{display:"grid",gap:8}}>
                  {[...history].reverse().map((qh,i)=>{
                    const isCurrent=i===0;
                    return (
                      <div key={i} style={{display:"grid",gridTemplateColumns:"100px repeat(4,1fr)",gap:8,padding:"12px 14px",background:isCurrent?c+"0a":"#080808",borderRadius:8,border:`1px solid ${isCurrent?c+"44":"#1e1e1e"}`}}>
                        <div style={{fontSize:13,fontWeight:700,color:isCurrent?c:"#ddd"}}>{qh.label}{isCurrent&&" ●"}</div>
                        <div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:qh.closeRate!==null?(qh.closeRate>=60?"#16a34a":qh.closeRate>=40?"#d97706":"#ef4444"):"#555"}}>{qh.closeRate!==null?qh.closeRate+"%":"—"}</div><div style={{fontSize:10,color:"#666"}}>close rate</div></div>
                        <div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:c}}>{qh.avgCycle!==null?qh.avgCycle+"d":"—"}</div><div style={{fontSize:10,color:"#666"}}>avg cycle</div></div>
                        <div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:"#16a34a"}}>{qh.salesClosed.length}</div><div style={{fontSize:10,color:"#666"}}>closed</div></div>
                        <div style={{textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:qh.lost.length>0?"#ef4444":"#555"}}>{qh.lost.length}</div><div style={{fontSize:10,color:"#666"}}>lost</div></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          }
        </>}

        {/* ── TEAM STATS (manager only) ── */}
        {activeTab==="team"&&isManager&&<TeamStatsView allUsers={allUsers} c={c} q={q} />}
      </>}
    </div>
  );
}

// ── TEAM STATS VIEW ───────────────────────────────────────────────────────────
function TeamStatsView({ allUsers, c, q }) {
  const [teamDeals, setTeamDeals] = useState({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("closeRate"); // closeRate | cycle | closed

  useEffect(() => { loadTeamDeals(); }, []);

  async function loadTeamDeals() {
    setLoading(true);
    // In Bolt this fetches per rep from Zoho. In artifact, uses demo data.
    const demo = {};
    allUsers.forEach(u => {
      const now = Date.now(), iso = d => new Date(now-d*864e5).toISOString(), ds = d => iso(d).split("T")[0];
      // Vary demo data per user to make comparison meaningful
      const seed = u.email.charCodeAt(0) % 5;
      demo[u.email] = [
        {Deal_Name:"Deal 1",Stage:"Ready to Submit to Platform",Associated_Platform:{name:"Facebook"},WV_Percentage:60,Created_Time:iso(40+seed*5),Closing_Date:ds(10+seed)},
        {Deal_Name:"Deal 2",Stage:"Awaiting Platform Approval",Associated_Platform:{name:"Microsoft Start"},WV_Percentage:55,Created_Time:iso(35+seed*3),Closing_Date:ds(8+seed)},
        {Deal_Name:"Deal 3",Stage:"Live",Associated_Platform:{name:"Spotify"},WV_Percentage:50,Created_Time:iso(60+seed*4),Closing_Date:ds(20+seed*2)},
        ...(seed>2?[{Deal_Name:"Deal 4",Stage:"Lost",Associated_Platform:{name:"Facebook"},WV_Percentage:0,Created_Time:iso(50+seed*2),Closing_Date:ds(15+seed)}]:[]),
      ];
    });
    setTeamDeals(demo);
    setLoading(false);
  }

  if (loading) return <div style={{display:"flex",alignItems:"center",gap:14,padding:"40px 0"}}><div style={{width:28,height:28,border:"3px solid #1a1a1a",borderTopColor:c,borderRadius:"50%",animation:"spin 0.7s linear infinite"}} /><div style={{color:"#ddd",fontSize:15}}>Loading team data...</div></div>;

  const repStats = allUsers.map(u => {
    const deals = teamDeals[u.email] || [];
    const s = computeStats(deals);
    return { u, ...s, dealCount: deals.length };
  });

  const sorted = [...repStats].sort((a,b) => {
    if (sortBy==="closeRate") return (b.closeRate||0)-(a.closeRate||0);
    if (sortBy==="cycle") return (a.avgCycle||999)-(b.avgCycle||999); // lower is better
    return b.salesClosed.length - a.salesClosed.length;
  });

  const sortBtn = (k,l) => (
    <button key={k} onClick={()=>setSortBy(k)} style={{padding:"5px 12px",borderRadius:6,border:"none",background:sortBy===k?c:"transparent",color:sortBy===k?"#fff":"#bbb",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all 0.15s"}}>{l}</button>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:10}}>
        <p style={{color:"#ddd",fontSize:14}}>Close rate and cycle speed per rep. Sort to see who's performing where.</p>
        <div style={{display:"flex",background:"#0a0a0a",border:`1px solid ${B.border}`,borderRadius:8,padding:3,gap:2}}>
          {sortBtn("closeRate","Close Rate")}
          {sortBtn("cycle","Cycle Speed")}
          {sortBtn("closed","Deals Closed")}
        </div>
      </div>

      {/* Team summary strip */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:18}}>
        {[
          {label:"Team Avg Close Rate",val:(() => { const rs=repStats.filter(r=>r.closeRate!==null); return rs.length>0?Math.round(rs.reduce((s,r)=>s+(r.closeRate||0),0)/rs.length)+"%":"—"; })(),col:"#16a34a"},
          {label:"Team Avg Cycle",val:(() => { const rs=repStats.filter(r=>r.avgCycle!==null); return rs.length>0?Math.round(rs.reduce((s,r)=>s+(r.avgCycle||0),0)/rs.length)+"d":"—"; })(),col:c},
          {label:"Total Deals Closed",val:repStats.reduce((s,r)=>s+r.salesClosed.length,0),col:"#ddd"},
        ].map(s=>(
          <div key={s.label} className="card" style={{padding:14}}>
            <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:30,fontWeight:700,color:s.col,lineHeight:1,marginBottom:4}}>{s.val}</div>
            <div style={{fontSize:11,color:"#aaa",textTransform:"uppercase",letterSpacing:"0.06em"}}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Per rep cards */}
      <div style={{display:"grid",gap:10}}>
        {sorted.map((rs,i)=>{
          const repC = rs.u.accentColor||B.orange;
          const maxClosed = Math.max(...sorted.map(r=>r.salesClosed.length),1);
          return (
            <div key={rs.u.email} className="card" style={{padding:18,borderColor:repC+"33",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${Math.max(3,Math.round((rs.salesClosed.length/maxClosed)*100))}%`,background:repC+"08"}} />
              <div style={{position:"relative",display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
                <Avatar user={rs.u} size={36} />
                <div style={{minWidth:120}}>
                  <div style={{fontSize:15,fontWeight:600,color:"#fff"}}>{rs.u.nickname||rs.u.displayName}</div>
                  {rs.u.title&&<div style={{fontSize:11,color:repC}}>{rs.u.title}</div>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,flex:1}}>
                  {[
                    {label:"Close Rate",val:rs.closeRate!==null?rs.closeRate+"%":"—",col:rs.closeRate!==null?(rs.closeRate>=60?"#16a34a":rs.closeRate>=40?"#d97706":"#ef4444"):"#555"},
                    {label:"Contract Rate",val:rs.contractRate!==null?rs.contractRate+"%":"—",col:rs.contractRate!==null?(rs.contractRate>=70?"#16a34a":"#d97706"):"#555"},
                    {label:"Avg Cycle",val:rs.avgCycle!==null?rs.avgCycle+"d":"—",col:repC},
                    {label:"Closed · Lost",val:`${rs.salesClosed.length} · ${rs.lost.length}`,col:"#ddd"},
                  ].map(s=>(
                    <div key={s.label} style={{textAlign:"center"}}>
                      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:700,color:s.col,lineHeight:1,marginBottom:2}}>{s.val}</div>
                      <div style={{fontSize:10,color:"#666",textTransform:"uppercase",letterSpacing:"0.05em"}}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Platform breakdown per rep */}
              <div style={{position:"relative",display:"flex",gap:8,marginTop:12,flexWrap:"wrap"}}>
                {PLATFORMS.map(p=>{
                  const pr=rs.platRates.find(x=>x.platform===p);
                  if (!pr||pr.total===0) return null;
                  const pc=PLATFORM_COLOR[p];
                  return (
                    <span key={p} style={{fontSize:11,background:pc+"18",color:pc,border:`1px solid ${pc}33`,borderRadius:7,padding:"3px 9px",fontWeight:600}}>
                      {p}: {pr.rate}% ({pr.closed}/{pr.total})
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── LOG SIGNING ───────────────────────────────────────────────────────────────
function LogSigning({ user, refreshUser }) {
  const [form, setForm] = useState({dealName:"",platform:"Facebook",split:"60/40",contractDate:"",notes:""});
  const [submitted, setSubmitted] = useState(false);
  const [err, setErr] = useState("");
  const needsSplit = form.platform !== "Spotify";

  const todayStr = () => new Date().toISOString().split("T")[0];

  function submit() {
    if (!form.dealName.trim()){setErr("Creator / deal name is required.");return;}
    // Block if exact duplicate already logged
    const dupeCheck = getSignings(user.email);
    const dupe = dupeCheck.find(s =>
      s.dealName.toLowerCase().trim() === form.dealName.toLowerCase().trim() &&
      s.platform === form.platform &&
      (s.status === "pending" || s.status === "approved")
    );
    if (dupe) {
      setErr(`You've already logged ${form.dealName} on ${form.platform} — it's currently ${dupe.status}. If this is a different deal, adjust the creator name to distinguish it.`);
      return;
    }
    if (!form.platform){setErr("Platform is required.");return;}
    if (form.platform!=="Spotify"&&!form.split){setErr("Revenue split is required.");return;}
    if (!form.contractDate){setErr("Contract completion date is required. Only submit once both parties have signed.");return;}
    setErr("");
    const signing = {
      id: Date.now()+"-"+Math.random().toString(36).slice(2,7),
      dealName: form.dealName.trim(),
      platform: form.platform,
      split: needsSplit ? form.split : null,
      contractDate: form.contractDate,
      notes: form.notes.trim(),
      status: "pending",
      submittedAt: Date.now(),
      submittedBy: user.email,
      submittedByName: user.nickname||user.displayName,
    };
    const existing = getSignings(user.email);
    saveSignings(user.email, [...existing, signing]);
    sendSigningNotification(user, signing);
    setSubmitted(true);
    setForm({dealName:"",platform:"Facebook",split:"60/40",contractDate:"",notes:""});
  }

  function duplicateSigning(s) {
    setForm({
      dealName: s.dealName,
      platform: s.platform,
      split: s.split || "60/40",
      contractDate: "",
      notes: s.notes || "",
    });
    setSubmitted(false);
    setErr("");
    // Scroll to top of form
    window.scrollTo({top:0,behavior:"smooth"});
  }

  const c = user.accentColor||B.orange;
  const pending = getSignings(user.email).filter(s=>s.status==="pending");
  const approved = getSignings(user.email).filter(s=>s.status==="approved").slice(-10).reverse();
  const lastDeal = approved[0] || pending[pending.length-1] || null;

  // Check if an identical deal (same name + platform) already exists pending or approved
  const allSignings = getSignings(user.email);
  const duplicateDeal = form.dealName.trim() ? allSignings.find(s =>
    s.dealName.toLowerCase().trim() === form.dealName.toLowerCase().trim() &&
    s.platform === form.platform &&
    (s.status === "pending" || s.status === "approved")
  ) : null;

  function copyLastDeal() {
    if (!lastDeal) return;
    setForm({
      dealName: lastDeal.dealName,
      platform: lastDeal.platform || "Facebook",
      split: lastDeal.split || "60/40",
      contractDate: lastDeal.contractDate || "",
      notes: lastDeal.notes || "",
    });
    setSubmitted(false);
    setErr("");
  }

  return (
    <div className="fi" style={{maxWidth:640}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6,flexWrap:"wrap",gap:12}}>
        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:44,fontWeight:700,textTransform:"uppercase"}}>Log a Signing</div>
        {lastDeal&&(
          <button onClick={copyLastDeal}
            style={{background:"#1a1a1a",border:`1px solid ${c}55`,color:c,padding:"10px 18px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",alignSelf:"center"}}>
            ⧉ Copy Last Deal
          </button>
        )}
      </div>
      <p style={{color:"#ddd",fontSize:16,marginBottom:26}}>Submit once the contract is fully signed by both parties. It counts toward the quarter the contract was completed in.</p>

      {submitted&&(
        <div style={{background:"#0a150a",border:"1px solid #1a3a1a",borderRadius:12,padding:"16px 20px",marginBottom:20,fontSize:16,color:"#4ade80"}}>
          🎉 Deal submitted! It will show on your dashboard once approved.
        </div>
      )}

      {duplicateDeal&&(
        <div style={{background:"#1a0e00",border:"1px solid #d9770688",borderRadius:10,padding:"12px 18px",marginBottom:16,display:"flex",gap:12,alignItems:"flex-start"}}>
          <span style={{fontSize:18,flexShrink:0}}>⚠️</span>
          <div>
            <div style={{fontSize:14,fontWeight:600,color:"#d97706",marginBottom:2}}>Already logged</div>
            <div style={{fontSize:13,color:"#e5c97e"}}>
              <strong>{form.dealName}</strong> on <strong>{form.platform}</strong> is already {duplicateDeal.status === "pending" ? "pending approval" : "approved"} from {duplicateDeal.contractDate}. Double-check before submitting again.
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{padding:28,marginBottom:18}}>
        <div style={{display:"grid",gap:18}}>
          <div>
            <label style={{fontSize:13,marginBottom:8}}>Creator / Deal Name</label>
            <input placeholder="e.g. MrBeast, MKBHD, Typical Gamer" value={form.dealName} onChange={e=>setForm(p=>({...p,dealName:e.target.value}))} style={{fontSize:16,padding:"13px 16px"}} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <div>
              <label style={{fontSize:13,marginBottom:8}}>Platform</label>
              <select value={form.platform} onChange={e=>setForm(p=>({...p,platform:e.target.value}))} style={{fontSize:16,padding:"13px 16px"}}>
                {PLATFORMS.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            {needsSplit&&(
              <div>
                <label style={{fontSize:13,marginBottom:8}}>Revenue Split</label>
                <select value={form.split} onChange={e=>setForm(p=>({...p,split:e.target.value}))} style={{fontSize:16,padding:"13px 16px"}}>
                  {SPLITS.map(s=><option key={s.label}>{s.label}</option>)}
                </select>
              </div>
            )}
            {!needsSplit&&<div style={{display:"flex",alignItems:"flex-end",paddingBottom:4}}><span style={{fontSize:15,color:"#ddd"}}>Spotify — no split required</span></div>}
          </div>
          <div>
            <label style={{fontSize:13,marginBottom:8}}>Contract Completion Date</label>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <input type="date" value={form.contractDate} onChange={e=>setForm(p=>({...p,contractDate:e.target.value}))} style={{flex:1,fontSize:16,padding:"13px 16px"}} />
              <button type="button" onClick={()=>setForm(p=>({...p,contractDate:todayStr()}))}
                style={{background:"#1a1a1a",border:"1px solid #444",color:"#fff",padding:"13px 18px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
                Today
              </button>
            </div>
          </div>
          <div>
            <label style={{fontSize:13,marginBottom:8}}>Notes (optional)</label>
            <textarea rows={3} placeholder="Anything else worth noting..." value={form.notes} onChange={e=>setForm(p=>({...p,notes:e.target.value}))} style={{fontSize:15,padding:"13px 16px"}} />
          </div>
        </div>
        {err&&<div style={{color:"#ef4444",fontSize:14,marginTop:12}}>{err}</div>}
        <button className="btn btn-p" onClick={submit} style={{marginTop:20,width:"100%",justifyContent:"center",padding:"14px 24px",fontSize:16}}>Submit for Approval ✓</button>
      </div>

      {/* Pending signings */}
      {pending.length>0&&(
        <div className="card" style={{padding:20,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14,color:"#ddd"}}>Pending Approval ({pending.length})</div>
          <div style={{display:"grid",gap:10}}>
            {pending.map((s,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px",background:"#080808",borderRadius:10,border:"1px solid #222"}}>
                <div><div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:3}}>{s.dealName}</div><div style={{fontSize:14,color:"#ddd"}}>{s.platform}{s.split?` · ${s.split}`:""} · {s.contractDate}</div></div>
                <span className="tag" style={{background:"#d9770618",color:"#d97706",fontSize:12,padding:"4px 10px"}}>Pending</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Previous signings with duplicate button */}
      {approved.length>0&&(
        <div className="card" style={{padding:20}}>
          <div style={{fontSize:13,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6,color:"#ddd"}}>Previous Signings</div>
          <div style={{fontSize:14,color:"#bbb",marginBottom:14}}>Hit Duplicate to pre-fill the form with a previous deal's details.</div>
          <div style={{display:"grid",gap:10}}>
            {approved.map((s,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px",background:"#080808",borderRadius:10,border:"1px solid #222"}}>
                <div>
                  <div style={{fontSize:16,fontWeight:600,color:"#fff",marginBottom:3}}>{s.dealName}</div>
                  <div style={{fontSize:14,color:"#ddd"}}>{s.platform}{s.split?` · ${s.split}`:""} · {s.contractDate}</div>
                </div>
                <button onClick={()=>duplicateSigning(s)}
                  style={{background:"transparent",border:`1px solid ${c}66`,color:c,padding:"10px 18px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>
                  Duplicate
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LEADERBOARD ───────────────────────────────────────────────────────────────
function AnimatedNumber({ value, color, size=28 }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start=0, steps=20, inc=value/steps, i=0;
    const t=setInterval(()=>{ i++; start=Math.min(value,Math.round(start+inc)); setDisplay(start); if(i>=steps){clearInterval(t);setDisplay(value);} },30);
    return ()=>clearInterval(t);
  }, [value]);
  return <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:size,fontWeight:700,color,lineHeight:1}}>{display}</span>;
}

function Leaderboard({ user, allUsers }) {
  const [metric, setMetric] = useState("total");
  const [period, setPeriod] = useState("quarter");
  const MEDALS=["🥇","🥈","🥉"];

  const cutoff = period==="quarter"?quarterStart():period==="month"?getMonthStart(0):getWeekStart(0);

  function score(u) {
    const p = metric==="total"?null:metric;
    if (p) {
      const s=platformSignings(u.email,p,cutoff);
      return s.length;
    }
    return approvedSignings(u.email,cutoff).length;
  }

  function getAvgSplit(u) {
    const deals=approvedSignings(u.email,cutoff).filter(s=>s.split&&SPLIT_TARGETS[s.platform]);
    if(!deals.length) return null;
    return deals.reduce((a,d)=>a+wvPct(d.split),0)/deals.length;
  }

  const sorted=[...allUsers].sort((a,b)=>score(b)-score(a));
  const T=(v,cur,col)=>({padding:"5px 11px",borderRadius:6,border:"none",background:cur===v?(col||B.orange):"transparent",color:cur===v?"#fff":B.muted,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",transition:"all 0.15s"});

  return (
    <div className="fi">
      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:40,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>Leaderboard</div>
      <p style={{color:"#e5e5e5",fontSize:14,marginBottom:20}}>Stay hungry.</p>

      {/* Controls */}
      <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{display:"flex",background:"#0a0a0a",border:`1px solid ${B.border}`,borderRadius:8,padding:3,gap:2}}>
          {[["total","Total"],["Facebook","FB"],["MSN","MSN"],["Spotify","Spotify"]].map(([k,l])=>(
            <button key={k} onClick={()=>setMetric(k)} style={T(k,metric,k==="total"?B.orange:PLATFORM_COLOR[k])}>{l}</button>
          ))}
        </div>
        <div style={{display:"flex",background:"#0a0a0a",border:`1px solid ${B.border}`,borderRadius:8,padding:3,gap:2}}>
          {[["quarter","Quarter"],["month","Month"],["week","Week"]].map(([k,l])=>(
            <button key={k} onClick={()=>setPeriod(k)} style={{...T(k,period),...(period===k?{background:"#222"}:{})}}>{l}</button>
          ))}
        </div>
      </div>

      {sorted.length===0?<div className="card" style={{padding:48,textAlign:"center",color:B.dim}}>No team members yet.</div>:(
        <div style={{display:"grid",gap:8}}>
          {sorted.map((u,i)=>{
            const isMe=u.email===user.email, c=u.accentColor||B.orange;
            const s=score(u), max=score(sorted[0])||1;
            const rankChange=getRankChange(u.email,allUsers);
            const streaks=calcStreaks(u.email);
            const avgSp=getAvgSplit(u);
            const spTarget=SPLIT_TARGETS.Facebook; // use as benchmark
            const pData=PLATFORMS.map(p=>({p,n:platformSignings(u.email,p,cutoff).length,col:PLATFORM_COLOR[p]}));
            const perf=calcPerformanceScore(u.email,allUsers,getTargets());
            const mom=calcMomentum(u.email);

            return (
              <div key={u.email} className="card" style={{padding:16,borderColor:isMe?c+"66":B.border,background:isMe?c+"08":B.card,position:"relative",overflow:"hidden"}}>
                {/* Background bar */}
                <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${Math.max(3,Math.round((s/max)*100))}%`,background:c+"0a",transition:"width 0.8s ease"}} />
                <div style={{position:"relative",display:"flex",alignItems:"center",gap:12}}>
                  {/* Rank */}
                  <div style={{width:30,textAlign:"center",flexShrink:0}}>
                    {i<3?<span style={{fontSize:23}}>{MEDALS[i]}</span>:<span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:23,fontWeight:700,color:B.dim}}>#{i+1}</span>}
                  </div>
                  {/* Avatar */}
                  <Avatar user={u} size={40} />
                  {/* Info */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:3,flexWrap:"wrap"}}>
                      <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:23,fontWeight:700}}>{u.nickname||u.displayName}</span>
                      {isMe&&<span className="tag" style={{background:c+"22",color:c,fontSize:9}}>YOU</span>}
                      {streaks.hotWeek&&<span style={{fontSize:14,background:"#f59e0b18",color:"#f59e0b",border:"1px solid #f59e0b33",borderRadius:10,padding:"1px 6px",fontWeight:600}}>🔥 {streaks.thisWeekCount} this wk</span>}
                      {streaks.weeklyStreak>=2&&<span style={{fontSize:14,background:"#16a34a18",color:"#16a34a",border:"1px solid #16a34a33",borderRadius:10,padding:"1px 6px",fontWeight:600}}>🔁 {streaks.weeklyStreak}wk</span>}
                    </div>
                    {u.title&&<div style={{fontSize:15,color:c,fontWeight:600,marginBottom:2}}>{u.title}</div>}
                    {u.bio&&<div style={{fontSize:13,color:"#bbb",marginBottom:4,fontStyle:"italic"}}>{u.bio}</div>}
                    {/* Platform pills */}
                    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                      {pData.map(({p,n,col})=>(
                        <span key={p} style={{fontSize:14,background:col+"18",color:col,border:`1px solid ${col}33`,borderRadius:8,padding:"1px 7px",fontWeight:600}}>
                          {({Facebook:"FB",MSN:"MSN",Spotify:"SP"}[p]||p.slice(0,2))} {n}
                        </span>
                      ))}
                      {avgSp!=null&&<span style={{fontSize:14,background:avgSp>=spTarget?"#16a34a18":"#ef444418",color:avgSp>=spTarget?"#16a34a":"#ef4444",border:`1px solid ${avgSp>=spTarget?"#16a34a":"#ef4444"}33`,borderRadius:8,padding:"1px 7px",fontWeight:600}}>
                        ⊘ {fmtPct(avgSp)}
                      </span>}
                    </div>
                  </div>
                  {/* Score + rank change + perf score + momentum */}
                  <div style={{textAlign:"right",flexShrink:0,display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
                    <div style={{display:"flex",alignItems:"flex-end",gap:8}}>
                      <div style={{textAlign:"right"}}>
                        <AnimatedNumber value={s} color={c} size={28} />
                        <div style={{fontSize:13,color:"#ddd",textTransform:"uppercase",letterSpacing:"0.05em"}}>signings</div>
                        {rankChange!==0&&<div style={{fontSize:12,color:rankChange>0?"#16a34a":"#ef4444",fontWeight:600,marginTop:1}}>{rankChange>0?"↑":"↓"}{Math.abs(rankChange)} this wk</div>}
                      </div>
                      <div style={{textAlign:"center",padding:"6px 10px",background:perfScoreColor(perf.score)+"18",border:`1px solid ${perfScoreColor(perf.score)}44`,borderRadius:8,minWidth:52}}>
                        <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:700,color:perfScoreColor(perf.score),lineHeight:1}}>{perf.score}</div>
                        <div style={{fontSize:9,color:"#666",textTransform:"uppercase",letterSpacing:"0.04em"}}>score</div>
                      </div>
                    </div>
                    <div style={{fontSize:11,fontWeight:600,color:momentumColor(mom.trend),background:momentumColor(mom.trend)+"18",border:`1px solid ${momentumColor(mom.trend)}33`,borderRadius:6,padding:"2px 8px"}}>
                      {mom.trend==="up"?"↑":mom.trend==="down"?"↓":"→"} {mom.pct>0?mom.pct+"%":"Steady"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CALCULATOR ────────────────────────────────────────────────────────────────
function Calculator({ user }) {
  const [rev, setRev] = useState("");
  const [split, setSplit] = useState("60/40");
  const [months, setMonths] = useState(6);
  const [result, setResult] = useState(null);
  const c = user.accentColor||B.orange;

  function calc() { const r=parseFloat(rev.replace(/[^0-9.]/g,"")); if(!r||r<=0)return; const t=SPLITS.find(s=>s.label===split)||SPLITS[2]; setResult({monthly:r*t.rate,quarterly:r*t.rate*3,total:r*t.rate*months,rate:t.rate,rev:r,split,months}); }

  return (
    <div className="fi" style={{maxWidth:640}}>
      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:44,fontWeight:700,textTransform:"uppercase",marginBottom:6}}>Commission Calculator</div>
      <p style={{color:"#ddd",fontSize:16,marginBottom:26}}>A quick aide — based on estimated monthly revenue. Actual commission is confirmed by the business.</p>
      <div className="card" style={{padding:28,marginBottom:18}}>
        <div style={{display:"grid",gap:18,marginBottom:20}}>
          <div>
            <label style={{fontSize:13,marginBottom:8}}>Estimated Monthly Revenue (USD)</label>
            <input placeholder="e.g. 10000" value={rev} onChange={e=>setRev(e.target.value)} onKeyDown={e=>e.key==="Enter"&&calc()} style={{fontSize:16,padding:"13px 16px"}} />
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <div>
              <label style={{fontSize:13,marginBottom:8}}>Revenue Split</label>
              <select value={split} onChange={e=>setSplit(e.target.value)} style={{fontSize:16,padding:"13px 16px"}}>
                {SPLITS.map(s=><option key={s.label}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{fontSize:13,marginBottom:8}}>Commission Period</label>
              <select value={months} onChange={e=>setMonths(parseInt(e.target.value))} style={{fontSize:16,padding:"13px 16px"}}>
                <option value={3}>3 months</option>
                <option value={6}>6 months</option>
              </select>
            </div>
          </div>
        </div>
        <button className="btn btn-p" onClick={calc} style={{width:"100%",justifyContent:"center",padding:"14px 24px",fontSize:16}}>Calculate →</button>
      </div>
      {result&&(
        <div className="card fi" style={{padding:26,borderColor:c+"44"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
            {[
              {label:"Monthly",val:fmt$(result.monthly),sub:`${(result.rate*100).toFixed(2)}% of ${fmt$(result.rev)}`},
              {label:"Per Quarter",val:fmt$(result.quarterly),sub:"Paid quarterly"},
              {label:`${result.months}mo Total`,val:fmt$(result.total),sub:`Over ${result.months} months`}
            ].map(s=>(
              <div key={s.label} style={{textAlign:"center",padding:"18px 12px",background:"#080808",borderRadius:10}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:32,fontWeight:700,color:c,marginBottom:4}}>{s.val}</div>
                <div style={{fontSize:12,fontWeight:600,color:"#bbb",textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:4}}>{s.label}</div>
                <div style={{fontSize:13,color:"#aaa"}}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:14,color:"#bbb",fontStyle:"italic",textAlign:"center"}}>Estimate only — actual commission confirmed by the business.</div>
        </div>
      )}
    </div>
  );
}

// ── TARGETS ───────────────────────────────────────────────────────────────────
function Targets({ user, allUsers }) {
  const [targets, setTargets] = useState(getTargets());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(targets);
  const [settings, setSettings] = useState(getManagerSettings(user.email));
  const isManager = user.role === "manager";
  const now = new Date(), q = Math.floor(now.getMonth() / 3);
  const qStart = quarterStart(), daysElapsed = daysElapsedInQuarter(), daysTotal = daysInQuarter(), daysLeft = daysLeftInQuarter();

  function save() { saveTargets(draft); setTargets(draft); setEditing(false); }
  function setDraftVal(email, field, val) { setDraft(p => ({ ...p, [email]: { ...p[email], [field]: parseFloat(val) || 0 } })); }
  function toggleWeakFlag() {
    const updated = { ...settings, hideWeakFlag: !settings.hideWeakFlag };
    setSettings(updated); saveManagerSettings(user.email, updated);
  }

  // Team aggregates per platform
  const teamData = PLATFORMS.map(p => {
    const teamSigs = allUsers.reduce((s, u) => s + platformSignings(u.email, p, qStart).length, 0);
    const teamTarget = allUsers.reduce((s, u) => s + (targets[u.email]?.[`signings_${p}`] || 0), 0);
    const teamForecast = allUsers.reduce((s, u) => s + calcForecast(platformSignings(u.email, p, qStart).length, daysElapsed, daysTotal), 0);
    const teamAvgSplit = SPLIT_TARGETS[p] != null ? (() => {
      const all = allUsers.flatMap(u => platformSignings(u.email, p, qStart).filter(s => s.split));
      return all.length ? all.reduce((a, d) => a + wvPct(d.split), 0) / all.length : 0;
    })() : null;
    const pct = teamTarget > 0 ? Math.min(100, Math.round((teamSigs / teamTarget) * 100)) : null;
    const gap = teamTarget > 0 ? teamTarget - teamSigs : null;
    const overUnder = teamTarget > 0 ? Math.round(((teamForecast - teamTarget) / teamTarget) * 100) : null;
    const onTrack = overUnder != null ? overUnder >= 0 : null;
    return { platform: p, color: PLATFORM_COLOR[p], teamSigs, teamTarget, teamForecast, teamAvgSplit, splitTarget: SPLIT_TARGETS[p] || null, pct, gap, overUnder, onTrack };
  });

  const weakest = [...teamData].filter(p => p.teamTarget > 0).sort((a, b) => (a.pct || 0) - (b.pct || 0))[0];

  // Individual data for the viewing user
  const myData = (() => {
    const t = targets[user.email] || {};
    return PLATFORMS.map(p => {
      const sig = platformSignings(user.email, p, qStart).length;
      const tSig = t[`signings_${p}`] || 0;
      const pct = tSig > 0 ? Math.min(100, Math.round((sig / tSig) * 100)) : null;
      const gap = tSig > 0 ? tSig - sig : null;
      const forecast = calcForecast(sig, daysElapsed, daysTotal);
      const avgSp = SPLIT_TARGETS[p] != null ? avgSplitForPlatform(user.email, p, qStart) : null;
      const tSplit = t[`split_${p}`] || SPLIT_TARGETS[p] || null;
      return { platform: p, color: PLATFORM_COLOR[p], sig, tSig, pct, gap, forecast, avgSp, tSplit };
    });
  })();

  const totalGap = myData.reduce((s, p) => s + Math.max(0, p.gap || 0), 0);
  const focusPlatform = myData.filter(p => p.tSig > 0).sort((a, b) => (a.pct || 0) - (b.pct || 0))[0];

  return (
    <div className="fi">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 44, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>Targets</div>
          <div style={{ fontSize: 14, color: B.orange, fontWeight: 600 }}>Q{q + 1} {now.getFullYear()} &nbsp;·&nbsp; {daysLeft} days left</div>
          <div style={{fontSize:12,color:"#ddd",marginTop:2}}>{now.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {isManager && <button className="btn btn-g btn-sm" onClick={toggleWeakFlag}>{settings.hideWeakFlag ? "Show" : "Hide"} Weak Flag</button>}
          {isManager && !editing && <button className="btn btn-g btn-sm" onClick={() => setEditing(true)}>Edit Targets</button>}
          {isManager && editing && <><button className="btn btn-g btn-sm" onClick={() => { setEditing(false); setDraft(targets); }}>Cancel</button><button className="btn btn-p btn-sm" onClick={save}>Save</button></>}
        </div>
      </div>

      {/* Weakest platform alert */}
      {isManager && weakest && !settings.hideWeakFlag && weakest.pct < 70 && (
        <div style={{ background: "#1a0808", border: "1px solid #ef444455", borderRadius: 10, padding: "12px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 14, color: "#ef4444" }}>⚠️ <strong>{weakest.platform}</strong> is furthest behind at {weakest.pct}% to target — focus team effort here.</div>
          <span style={{ fontSize: 13, color: PLATFORM_COLOR[weakest.platform], fontWeight: 700, background: PLATFORM_COLOR[weakest.platform] + "22", borderRadius: 6, padding: "3px 10px" }}>{weakest.platform}</span>
        </div>
      )}

      {/* ── PERSONAL FOCUS PROMPT ── */}
      {focusPlatform && focusPlatform.gap > 0 && (
        <div style={{ background: `linear-gradient(135deg,${focusPlatform.color}18,#0d0d0d)`, border: `1px solid ${focusPlatform.color}44`, borderRadius: 12, padding: "16px 20px", marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: focusPlatform.color, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>Your Focus This Quarter</div>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            {focusPlatform.gap} more <span style={{ color: focusPlatform.color }}>{focusPlatform.platform}</span> signing{focusPlatform.gap > 1 ? "s" : ""} needed
          </div>
          <div style={{ fontSize: 14, color: "#ccc" }}>
            {focusPlatform.forecast >= focusPlatform.tSig
              ? `You're on track — forecast puts you at ${focusPlatform.forecast} by end of quarter. Keep the pace.`
              : `Current pace puts you at ${focusPlatform.forecast}. You need to pick up the rate to hit ${focusPlatform.tSig}.`
            }
            {totalGap > focusPlatform.gap && ` You also have ${totalGap - focusPlatform.gap} gap${totalGap - focusPlatform.gap > 1 ? "s" : ""} across other platforms.`}
          </div>
        </div>
      )}

      {/* ── PERSONAL PLATFORM CARDS ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
        {myData.map(p => {
          const statusColor = p.pct == null ? B.muted : p.pct >= 100 ? "#16a34a" : p.pct >= 70 ? "#d97706" : "#ef4444";
          const statusLabel = p.pct == null ? "No target" : p.pct >= 100 ? "✓ On target" : p.gap > 0 ? `${p.gap} to go` : "On target";
          return (
            <div key={p.platform} className="card" style={{ padding: 18, borderColor: p.color + "44", position: "relative", overflow: "hidden" }}>
              {/* Subtle bg fill */}
              <div style={{ position: "absolute", left: 0, bottom: 0, width: `${p.pct || 0}%`, height: "3px", background: p.color }} />
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 15, fontWeight: 700, color: p.color, marginBottom: 10, letterSpacing: "0.04em" }}>{p.platform}</div>

              {/* Big signing number */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, marginBottom: 4 }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 48, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{p.sig}</div>
                {p.tSig > 0 && <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 22, color: B.muted, lineHeight: 1, paddingBottom: 4 }}>/ {p.tSig}</div>}
              </div>
              <div style={{ fontSize: 12, color: B.muted, marginBottom: 10 }}>signings</div>

              {/* Progress bar */}
              {p.tSig > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ height: 6, background: "#111", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${p.pct}%`, background: p.color, borderRadius: 3, transition: "width 0.6s" }} />
                  </div>
                </div>
              )}

              {/* Status label */}
              <div style={{ fontSize: 13, fontWeight: 600, color: statusColor, marginBottom: p.avgSp ? 8 : 0 }}>{statusLabel}</div>

              {/* Forecast */}
              {p.tSig > 0 && (
                <div style={{ fontSize: 12, color: "#aaa", marginBottom: p.avgSp ? 6 : 0 }}>
                  Forecast: <span style={{ color: p.forecast >= p.tSig ? "#16a34a" : "#d97706", fontWeight: 600 }}>{p.forecast}</span>
                </div>
              )}

              {/* Split quality */}
              {p.avgSp != null && p.avgSp > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: B.muted }}>Avg split</span>
                  <span style={{ color: p.avgSp >= (p.tSplit || 0) ? "#16a34a" : "#ef4444", fontWeight: 600 }}>{fmtPct(p.avgSp)}{p.tSplit ? " / " + fmtPct(p.tSplit) : ""}</span>
                </div>
              )}

              {/* Manager edit inputs */}
              {editing && isManager && (
                <div style={{ marginTop: 10, display: "grid", gap: 5 }}>
                  <input type="number" placeholder="Signings target" value={draft[user.email]?.[`signings_${p.platform}`] || ""} onChange={e => setDraftVal(user.email, `signings_${p.platform}`, e.target.value)} style={{ fontSize: 12, padding: "4px 8px" }} />
                  {SPLIT_TARGETS[p.platform] != null && <input type="number" placeholder="Split target %" value={draft[user.email]?.[`split_${p.platform}`] || ""} onChange={e => setDraftVal(user.email, `split_${p.platform}`, e.target.value)} style={{ fontSize: 12, padding: "4px 8px" }} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── TEAM VIEW (manager sees all reps, reps see team totals) ── */}
      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
          {isManager ? "Team Overview" : "Team Targets"}
        </div>

        {/* Team platform totals */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: isManager ? 20 : 0 }}>
          {teamData.map(p => (
            <div key={p.platform} style={{ background: "#080808", borderRadius: 10, padding: "14px 16px", border: `1px solid ${p.color}33` }}>
              <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, fontWeight: 700, color: p.color, marginBottom: 8 }}>{p.platform}</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 5, marginBottom: 3 }}>
                <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 36, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{p.teamSigs}</div>
                {p.teamTarget > 0 && <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 18, color: B.muted, lineHeight: 1, paddingBottom: 3 }}>/ {p.teamTarget}</div>}
              </div>
              <div style={{ fontSize: 12, color: B.muted, marginBottom: p.teamTarget > 0 ? 8 : 4 }}>team signings</div>
              {p.teamTarget > 0 && <>
                <div style={{ height: 5, background: "#111", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                  <div style={{ height: "100%", width: `${p.pct}%`, background: p.color, borderRadius: 3, transition: "width 0.6s" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: p.pct >= 100 ? "#16a34a" : p.pct >= 70 ? "#d97706" : "#ef4444", fontWeight: 600 }}>{p.pct}%</span>
                  <span style={{ color: p.onTrack ? "#16a34a" : "#d97706" }}>Forecast: {p.teamForecast}</span>
                </div>
              </>}
              {p.teamAvgSplit != null && p.teamAvgSplit > 0 && (
                <div style={{ fontSize: 12, marginTop: 6, color: p.teamAvgSplit >= (p.splitTarget || 0) ? "#16a34a" : "#d97706" }}>
                  Avg split: {fmtPct(p.teamAvgSplit)}{p.splitTarget ? " / " + fmtPct(p.splitTarget) : ""}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Manager: per-rep breakdown */}
        {isManager && allUsers.length > 0 && (
          <div style={{ display: "grid", gap: 10 }}>
            {allUsers.map(u => {
              const t = targets[u.email] || {};
              const c = u.accentColor || B.orange;
              return (
                <div key={u.email} style={{ background: "#080808", borderRadius: 10, padding: "14px 16px", border: `1px solid ${c}22` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    <Avatar user={u} size={28} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#fff" }}>{u.nickname || u.displayName}</div>
                      {u.title && <div style={{ fontSize: 12, color: c }}>{u.title}</div>}
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {PLATFORMS.map(p => {
                      const sig = platformSignings(u.email, p, qStart).length;
                      const tSig = t[`signings_${p}`] || 0;
                      const pct = tSig > 0 ? Math.min(100, Math.round((sig / tSig) * 100)) : null;
                      const forecast = calcForecast(sig, daysElapsed, daysTotal);
                      const pc = PLATFORM_COLOR[p];
                      const gap = tSig > 0 ? tSig - sig : null;
                      return (
                        <div key={p} style={{ padding: "10px 12px", background: "#0a0a0a", borderRadius: 8, border: `1px solid ${pc}22` }}>
                          <div style={{ fontSize: 12, color: pc, fontWeight: 700, marginBottom: 6 }}>{p}</div>
                          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, marginBottom: 2 }}>
                            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 26, fontWeight: 700, color: "#fff", lineHeight: 1 }}>{sig}</span>
                            {tSig > 0 && <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 14, color: B.muted, lineHeight: 1, paddingBottom: 2 }}>/ {tSig}</span>}
                          </div>
                          {tSig > 0 && <>
                            <div style={{ height: 4, background: "#111", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
                              <div style={{ height: "100%", width: `${pct}%`, background: pc, borderRadius: 2, transition: "width 0.5s" }} />
                            </div>
                            <div style={{ fontSize: 12, color: gap <= 0 ? "#16a34a" : "#d97706", fontWeight: 600 }}>
                              {gap <= 0 ? "✓ On target" : `${gap} to go`}
                            </div>
                            <div style={{ fontSize: 11, color: "#999" }}>Forecast: <span style={{ color: forecast >= tSig ? "#16a34a" : "#d97706", fontWeight: 600 }}>{forecast}</span></div>
                          </>}
                          {!tSig && <div style={{ fontSize: 11, color: B.muted }}>No target set</div>}
                          {editing && <input type="number" placeholder="Target" value={draft[u.email]?.[`signings_${p}`] || ""} onChange={e => setDraftVal(u.email, `signings_${p}`, e.target.value)} style={{ marginTop: 6, fontSize: 12, padding: "4px 8px" }} />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rep contribution (manager view) */}
      {isManager && allUsers.length > 0 && teamData.some(p => p.teamSigs > 0) && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 14 }}>Who's Contributing</div>
          <div style={{ display: "grid", gap: 14 }}>
            {PLATFORMS.map(p => {
              const total = teamData.find(x => x.platform === p)?.teamSigs || 0;
              if (!total) return null;
              return (
                <div key={p}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, color: PLATFORM_COLOR[p], fontWeight: 700, background: PLATFORM_COLOR[p] + "18", border: `1px solid ${PLATFORM_COLOR[p]}33`, borderRadius: 6, padding: "2px 10px" }}>{p}</span>
                    <span style={{ fontSize: 13, color: "#aaa" }}>{total} signings</span>
                  </div>
                  <div style={{ display: "grid", gap: 5 }}>
                    {allUsers.map(u => {
                      const uSig = platformSignings(u.email, p, qStart).length;
                      const pct = total > 0 ? Math.round((uSig / total) * 100) : 0;
                      const uc = u.accentColor || B.orange;
                      const avgSp = SPLIT_TARGETS[p] ? avgSplitForPlatform(u.email, p, qStart) : null;
                      return (
                        <div key={u.email} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 90, fontSize: 13, color: "#ddd", fontWeight: 500, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.nickname || u.displayName}</div>
                          <div style={{ flex: 1, height: 7, background: "#111", borderRadius: 4, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${pct}%`, background: uc, borderRadius: 4, transition: "width 0.5s" }} />
                          </div>
                          <div style={{ width: 36, textAlign: "right", fontSize: 13, color: "#fff", fontWeight: 600, flexShrink: 0 }}>{uSig}</div>
                          {avgSp > 0 && <div style={{ width: 52, textAlign: "right", fontSize: 12, color: avgSp >= (SPLIT_TARGETS[p] || 0) ? "#16a34a" : "#d97706", fontWeight: 600, flexShrink: 0 }}>{fmtPct(avgSp)}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }).filter(Boolean)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── INCENTIVES ────────────────────────────────────────────────────────────────
function Incentives({ user, allUsers }) {
  const [incentive, setIncentive] = useState(getIncentive());
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(incentive||{title:"",description:"",metric:"total",goal:"",deadline:"",reward:""});
  const isManager = user.role==="manager";
  const MEDALS=["🥇","🥈","🥉"];

  function goLive() { const i={...form,goal:parseFloat(form.goal)||0,deadline:form.deadline?new Date(form.deadline).getTime():null,updatedAt:Date.now()}; saveIncentive(i);setIncentive(i);setEditing(false); }

  function progress(u) {
    const cutoff = incentive?.deadline?Date.now()-30*24*60*60*1000:quarterStart();
    const all=approvedSignings(u.email,cutoff);
    return incentive?.metric==="total"?all.length:all.filter(s=>s.platform===incentive.metric).length;
  }

  const sorted = incentive?[...allUsers].sort((a,b)=>progress(b)-progress(a)):[];

  return (
    <div className="fi">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:22}}>
        <div><div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:38,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>🔥 Incentives</div><p style={{color:"#e5e5e5",fontSize:14}}>Live competition.</p></div>
        {isManager&&!editing&&<button className="btn btn-g btn-sm" onClick={()=>setEditing(true)}>Set Incentive</button>}
      </div>
      {editing&&(
        <div className="card fi" style={{padding:20,marginBottom:20,borderColor:B.orange+"44"}}>
          <div style={{fontSize:11,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Set Incentive</div>
          <div style={{display:"grid",gap:12}}>
            <div><label>Title</label><input placeholder='"Holiday to Ibiza 🏖️"' value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} /></div>
            <div><label>Description</label><textarea rows={2} value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} /></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label>Metric</label><select value={form.metric} onChange={e=>setForm(p=>({...p,metric:e.target.value}))}><option value="total">Most Total Signings</option>{PLATFORMS.map(p=><option key={p} value={p}>Most {p} Signings</option>)}</select></div>
              <div><label>Goal</label><input type="number" value={form.goal} onChange={e=>setForm(p=>({...p,goal:e.target.value}))} /></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label>Deadline</label><input type="date" value={form.deadline} onChange={e=>setForm(p=>({...p,deadline:e.target.value}))} /></div>
              <div><label>Reward</label><input placeholder='"£500 + dinner"' value={form.reward} onChange={e=>setForm(p=>({...p,reward:e.target.value}))} /></div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:14}}><button className="btn btn-g btn-sm" onClick={()=>setEditing(false)}>Cancel</button><button className="btn btn-p btn-sm" onClick={goLive}>Go Live 🔥</button></div>
        </div>
      )}
      {!incentive&&!editing&&<div className="card" style={{padding:48,textAlign:"center"}}><div style={{fontSize:32,marginBottom:10}}>🏆</div><div style={{color:"#e5e5e5",fontSize:14}}>{isManager?"Set an incentive above to fire up the team.":"No active incentive. Check back soon."}</div></div>}
      {incentive&&<>
        <div style={{background:`linear-gradient(135deg,${B.orange}22,#0d0d0d)`,border:`1px solid ${B.orange}55`,borderRadius:14,padding:22,marginBottom:18}}>
          <div style={{fontSize:10,fontWeight:600,color:B.orange,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:7}}>Active Incentive</div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:32,fontWeight:700,marginBottom:5}}>{incentive.title}</div>
          <div style={{fontSize:13,color:"#ddd",marginBottom:8}}>{incentive.description}</div>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            {incentive.reward&&<div><span style={{fontSize:12,color:"#e5e5e5"}}>Prize: </span><span style={{fontSize:13,fontWeight:600,color:"#f59e0b"}}>{incentive.reward}</span></div>}
            {incentive.goal&&<div><span style={{fontSize:12,color:"#e5e5e5"}}>Goal: </span><span style={{fontSize:13,fontWeight:600}}>{incentive.goal} signings</span></div>}
            {incentive.deadline&&<div><span style={{fontSize:12,color:"#e5e5e5"}}>Ends: </span><span style={{fontSize:13,fontWeight:600}}>{new Date(incentive.deadline).toLocaleDateString("en-GB")}</span></div>}
          </div>
        </div>
        <div style={{display:"grid",gap:8}}>
          {sorted.map((u,i)=>{
            const p=progress(u),goal=parseFloat(incentive.goal)||1,pct=Math.min(100,Math.round((p/goal)*100)),c=u.accentColor||B.orange,isMe=u.email===user.email;
            return (
              <div key={u.email} className="card" style={{padding:14,borderColor:isMe?c+"44":B.border}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:7}}>
                  <span style={{fontSize:17,width:24,textAlign:"center"}}>{i<3?MEDALS[i]:`#${i+1}`}</span>
                  <Avatar user={u} size={30} />
                  <div style={{flex:1}}><div style={{fontWeight:500,fontSize:13}}>{u.nickname||u.displayName}{isMe?" (You)":""}</div></div>
                  <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:22,fontWeight:700,color:c}}>{p}</div>
                </div>
                <div style={{height:4,background:"#111",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${c},${c}99)`,borderRadius:2,transition:"width 0.5s"}} /></div>
                <div style={{fontSize:11,color:"#ddd",marginTop:3,textAlign:"right"}}>{pct}% of goal</div>
              </div>
            );
          })}
        </div>
      </>}
    </div>
  );
}

// ── PROFILE ───────────────────────────────────────────────────────────────────
function Profile({ user, refreshUser }) {
  const [form, setForm] = useState({displayName:user.displayName||"",title:user.title||"",bio:user.bio||"",accentColor:user.accentColor||B.orange,photo:user.photo||null,pw:"",pw2:""});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef();
  const c = form.accentColor;

  function save() {
    if (form.pw&&form.pw.length<6){setErr("Password must be at least 6 characters.");return;}
    if (form.pw&&form.pw!==form.pw2){setErr("Passwords don't match.");return;}
    setErr("");
    const updated={...user,displayName:form.displayName.trim(),nickname:form.displayName.trim(),title:form.title,bio:form.bio,accentColor:form.accentColor,photo:form.photo};
    if (form.pw) updated.password=form.pw;
    saveUser(updated); refreshUser(); setSaved(true); setTimeout(()=>setSaved(false),2000);
    setForm(p=>({...p,pw:"",pw2:""}));
  }

  return (
    <div className="fi" style={{maxWidth:480}}>
      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:38,fontWeight:700,textTransform:"uppercase",marginBottom:22}}>My Profile</div>
      <div style={{background:`linear-gradient(135deg,${c}18,#0d0d0d)`,border:`1px solid ${c}44`,borderRadius:14,padding:20,marginBottom:22,display:"flex",alignItems:"center",gap:14}}>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={e=>{const r=new FileReader();r.onload=ev=>setForm(p=>({...p,photo:ev.target.result}));r.readAsDataURL(e.target.files[0]);}} />
        <div onClick={()=>fileRef.current?.click()} style={{cursor:"pointer",position:"relative"}}>
          <Avatar user={{...user,...form}} size={56} />
          <div style={{position:"absolute",bottom:0,right:0,width:17,height:17,background:c,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9}}>✏️</div>
        </div>
        <div>
          <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:20,fontWeight:700}}>{form.displayName||user.displayName}</div>
          {form.title&&<div style={{fontSize:11,color:c,fontWeight:600}}>{form.title}</div>}
          {form.bio&&<div style={{fontSize:12,color:"#e5e5e5",marginTop:2}}>{form.bio}</div>}
          <div style={{fontSize:11,color:B.dim,marginTop:3}}>{user.email}</div>
        </div>
      </div>
      <div className="card" style={{padding:20}}>
        <div style={{display:"grid",gap:14}}>
          <div><label>Name</label><input value={form.displayName} onChange={e=>setForm(p=>({...p,displayName:e.target.value}))} /></div>
          <div>
            <label>Title</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginTop:4}}>
              {TITLE_OPTIONS.map(t=>(
                <div key={t} onClick={()=>setForm(p=>({...p,title:t}))} style={{padding:"8px 10px",borderRadius:7,border:`1px solid ${form.title===t?c:"#1e1e1e"}`,background:form.title===t?c+"18":"transparent",cursor:"pointer",fontSize:12,color:form.title===t?c:"#bbb",transition:"all 0.15s",fontWeight:form.title===t?600:400}}>
                  {t}
                </div>
              ))}
            </div>
          </div>
          <div><label>Message</label><input value={form.bio} onChange={e=>setForm(p=>({...p,bio:e.target.value}))} /></div>
          <div><label>Accent Colour</label><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>{ACCENT_COLORS.map(col=><div key={col} onClick={()=>setForm(p=>({...p,accentColor:col}))} style={{width:26,height:26,borderRadius:"50%",background:col,cursor:"pointer",border:`3px solid ${form.accentColor===col?"#fff":"transparent"}`,transform:form.accentColor===col?"scale(1.2)":"scale(1)",transition:"all 0.15s"}} />)}</div></div>
          <div style={{borderTop:`1px solid ${B.border}`,paddingTop:14}}>
            <div style={{fontSize:11,fontWeight:600,color:B.muted,letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:10}}>Change Password (optional)</div>
            <div style={{display:"grid",gap:10}}>
              <div><label>New Password</label><input type="password" placeholder="Leave blank to keep current" value={form.pw} onChange={e=>setForm(p=>({...p,pw:e.target.value}))} /></div>
              <div><label>Confirm</label><input type="password" value={form.pw2} onChange={e=>setForm(p=>({...p,pw2:e.target.value}))} /></div>
            </div>
          </div>
        </div>
        {err&&<div style={{color:"#ef4444",fontSize:13,marginTop:10}}>{err}</div>}
        <button className="btn btn-p" onClick={save} style={{marginTop:14,width:"100%",justifyContent:"center"}}>{saved?"✓ Saved!":"Save Changes"}</button>
      </div>
    </div>
  );
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
function Admin({ user, allUsers, refreshAllUsers }) {
  const [tab, setTab] = useState("summary");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("rep");
  const [code, setCode] = useState("");
  const [bForm, setBForm] = useState({recipientEmail:"",name:"",emoji:"🏅",note:""});
  const [badgeSaved, setBadgeSaved] = useState(false);
  const [badges, setBadges] = useState(getBadges());
  const [pending, setPending] = useState(getAllPendingSignings());
  const [editSigning, setEditSigning] = useState(null);
  const [announcement, setAnnouncement] = useState(getAnnouncement()||{text:"",emoji:"📣"});
  const [annSaved, setAnnSaved] = useState(false);
  const [recap, setRecap] = useState(getMeetingRecap()||{date:"",summary:"",link:"",tasks:[]});
  const [recapSaved, setRecapSaved] = useState(false);
  const [newTask, setNewTask] = useState({task:"",assignee:"All"});
  const taskAssignees = ["All", ...allUsers.map(u => u.nickname||u.displayName)];
  const [addForm, setAddForm] = useState({repEmail:"",dealName:"",platform:"Facebook",split:"60/40",contractDate:"",notes:""});
  const [addSubmitted, setAddSubmitted] = useState(false);
  const [addErr, setAddErr] = useState("");

  const qStart = quarterStart();
  const daysElapsed = daysElapsedInQuarter();
  const daysTotal = daysInQuarter();
  const daysLeft = daysLeftInQuarter();
  const now = new Date();
  const q = Math.floor(now.getMonth()/3);

  function refreshPending() { setPending(getAllPendingSignings()); }

  function approveSigning(s) {
    const all=getSignings(s.submittedBy);
    saveSignings(s.submittedBy,all.map(x=>x.id===s.id?{...x,status:"approved",approvedAt:Date.now(),approvedBy:user.email}:x));
    refreshPending();
  }
  function rejectSigning(s) {
    const all=getSignings(s.submittedBy);
    saveSignings(s.submittedBy,all.map(x=>x.id===s.id?{...x,status:"rejected",rejectedAt:Date.now()}:x));
    refreshPending();
  }
  function saveEdit() {
    if (!editSigning) return;
    const all=getSignings(editSigning.submittedBy);
    saveSignings(editSigning.submittedBy,all.map(x=>x.id===editSigning.id?{...editSigning,status:"approved",approvedAt:Date.now(),approvedBy:user.email}:x));
    setEditSigning(null); refreshPending();
  }
  function genInvite() {
    if (!email.trim()) return;
    const c="WV-"+Math.random().toString(36).slice(2,6).toUpperCase()+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
    LS.set("invite:"+c,{email:email.trim().toLowerCase(),role,used:false,createdAt:Date.now(),createdBy:user.email});
    setCode(c);
  }
  function awardBadge() {
    if (!bForm.recipientEmail||!bForm.name) return;
    const updated=[...badges,{...bForm,awardedAt:Date.now(),awardedBy:user.email}];
    saveBadges(updated); setBadges(updated);
    setBadgeSaved(true); setBForm({recipientEmail:"",name:"",emoji:"🏅",note:""});
    setTimeout(()=>setBadgeSaved(false),2000);
  }
  function saveRecap() {
    if (!recap.summary.trim()&&!recap.tasks.length) return;
    const r={...recap, updatedAt:Date.now(), updatedBy:user.email};
    saveMeetingRecap(r); setRecapSaved(true);
    setTimeout(()=>setRecapSaved(false),2000);
  }
  function removeRecap() { clearMeetingRecap(); setRecap({date:"",summary:"",link:"",tasks:[]}); }
  function addTask() {
    if (!newTask.task.trim()) return;
    setRecap(p=>({...p,tasks:[...p.tasks,{...newTask,id:Date.now()}]}));
    setNewTask({task:"",assignee:"All"});
  }
  function removeTask(id) { setRecap(p=>({...p,tasks:p.tasks.filter(t=>t.id!==id)})); }

  function postAnnouncement() {
    if (!announcement.text.trim()) return;
    const a={...announcement,from:user.nickname||user.displayName,ts:Date.now()};
    saveAnnouncement(a); setAnnSaved(true);
    setTimeout(()=>setAnnSaved(false),2000);
  }
  function removeAnnouncement() { clearAnnouncement(); setAnnouncement({text:"",emoji:"📣"}); }

  function submitForRep() {
    if (!addForm.repEmail){setAddErr("Select a team member.");return;}
    if (!addForm.dealName.trim()){setAddErr("Deal name is required.");return;}
    if (!addForm.contractDate){setAddErr("Contract date is required.");return;}
    if (addForm.platform!=="Spotify"&&!addForm.split){setAddErr("Revenue split is required.");return;}
    setAddErr("");
    const rep = allUsers.find(u=>u.email===addForm.repEmail);
    const signing = {
      id: Date.now()+"-"+Math.random().toString(36).slice(2,7),
      dealName: addForm.dealName.trim(),
      platform: addForm.platform,
      split: addForm.platform!=="Spotify"?addForm.split:null,
      contractDate: addForm.contractDate,
      notes: addForm.notes.trim(),
      status: "approved",
      submittedAt: Date.now(),
      approvedAt: Date.now(),
      approvedBy: user.email,
      submittedBy: addForm.repEmail,
      submittedByName: rep?.nickname||rep?.displayName||addForm.repEmail,
      addedByManager: true,
    };
    const existing = getSignings(addForm.repEmail);
    saveSignings(addForm.repEmail, [...existing, signing]);
    setAddSubmitted(true);
    setAddForm(p=>({...p,dealName:"",contractDate:"",notes:"",split:"60/40"}));
    setTimeout(()=>setAddSubmitted(false),3000);
  }

  const todayStr = () => new Date().toISOString().split("T")[0];

  const T = t => ({padding:"7px 13px",border:"none",background:tab===t?B.orange:"transparent",color:tab===t?"#fff":B.muted,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",borderRadius:6,transition:"all 0.15s",whiteSpace:"nowrap"});

  // ── EXECUTIVE SUMMARY DATA ────────────────────────────────────────────────
  const teamTotals = PLATFORMS.map(p => {
    const sigs = allUsers.reduce((s,u)=>s+platformSignings(u.email,p,qStart).length,0);
    const target = allUsers.reduce((s,u)=>s+(getTargets()[u.email]?.[`signings_${p}`]||0),0);
    const forecast = allUsers.reduce((s,u)=>s+calcForecast(platformSignings(u.email,p,qStart).length,daysElapsed,daysTotal),0);
    const avgSplit = SPLIT_TARGETS[p]!=null ? (() => {
      const all=allUsers.flatMap(u=>platformSignings(u.email,p,qStart).filter(s=>s.split));
      return all.length?all.reduce((a,d)=>a+wvPct(d.split),0)/all.length:0;
    })() : null;
    const pct = target>0?Math.min(100,Math.round((sigs/target)*100)):null;
    return {p,sigs,target,forecast,avgSplit,pct,splitTarget:SPLIT_TARGETS[p]||null};
  });

  const totalSigs = teamTotals.reduce((s,p)=>s+p.sigs,0);
  const totalTarget = teamTotals.reduce((s,p)=>s+(p.target||0),0);
  const totalForecast = teamTotals.reduce((s,p)=>s+p.forecast,0);
  const overallPct = totalTarget>0?Math.round((totalSigs/totalTarget)*100):null;
  const onStreak = allUsers.filter(u=>calcStreaks(u.email).weeklyStreak>=2);
  const weakestP = teamTotals.filter(p=>p.target>0).sort((a,b)=>(a.pct||0)-(b.pct||0))[0];

  function buildSummary() {
    const summary = [];
    if (overallPct!=null) {
      summary.push("The team is tracking at "+overallPct+"% of Q"+(q+1)+" target with "+daysLeft+" days remaining.");
    }
    teamTotals.forEach(({p,sigs,target,forecast,pct,avgSplit,splitTarget}) => {
      if (!target) return;
      const status = pct>=100?"on target":pct>=80?"on pace":pct>=60?"slightly behind":"behind";
      let ln = p+" is "+status+" — "+sigs+" of "+target+" signed";
      if (forecast!==sigs) ln += ", forecasting "+forecast+" by quarter end";
      ln += ".";
      if (avgSplit!=null&&avgSplit>0&&splitTarget) {
        const splitStatus = avgSplit>=splitTarget?"above":"below";
        ln += " Average split is "+fmtPct(avgSplit)+" — "+splitStatus+" the "+fmtPct(splitTarget)+" target.";
      }
      summary.push(ln);
    });
    if (onStreak.length>0) {
      summary.push(onStreak.map(u=>u.nickname||u.displayName).join(", ")+" "+(onStreak.length===1?"is":"are")+" on a weekly signing streak.");
    }
    if (pending.length>0) {
      summary.push(pending.length+" signing"+(pending.length>1?"s":"")+" currently awaiting approval.");
    }
    return summary;
  }

  // ── MONTH TO MONTH DATA ────────────────────────────────────────────────────
  function getMonthLabel(offset) {
    const d = new Date(now.getFullYear(), now.getMonth()+offset, 1);
    return d.toLocaleDateString("en-GB",{month:"short",year:"numeric"});
  }
  const months = [-5,-4,-3,-2,-1,0].map(offset => {
    const start = getMonthStart(offset);
    const end = offset===0 ? Date.now() : getMonthStart(offset+1);
    const label = getMonthLabel(offset);
    const perRep = allUsers.map(u => {
      const sigs = getSignings(u.email).filter(s=>s.status==="approved"&&s.contractDate&&new Date(s.contractDate).getTime()>=start&&new Date(s.contractDate).getTime() < end);
      return { u, total:sigs.length, byPlatform: PLATFORMS.reduce((acc,p)=>({...acc,[p]:sigs.filter(s=>s.platform===p).length}),{}) };
    });
    const total = perRep.reduce((s,r)=>s+r.total,0);
    const byPlatform = PLATFORMS.reduce((acc,p)=>({...acc,[p]:perRep.reduce((s,r)=>s+r.byPlatform[p],0)}),{});
    return {label,start,end,total,byPlatform,perRep};
  });

  // ── ACTIVITY FEED ─────────────────────────────────────────────────────────
  const feed = getActivityFeed(allUsers, 50);

  const ACTIVITY_ICONS = { approved:"✅", submitted:"📋", rejected:"❌", badge:"🏅" };

  function activityText(event) {
    const name = event.user?.nickname||event.user?.displayName||"Someone";
    if (event.type==="approved") return `${name} had a signing approved — ${event.signing.dealName} (${event.signing.platform}${event.signing.split?" · "+event.signing.split:""})`;
    if (event.type==="submitted") return `${name} submitted a signing for approval — ${event.signing.dealName} (${event.signing.platform})`;
    if (event.type==="rejected") return `${name}'s signing was rejected — ${event.signing.dealName}`;
    if (event.type==="badge") return `${name} was awarded the ${event.badge.emoji} ${event.badge.name} badge`;
    return "";
  }

  const summaryLines = buildSummary();  // auto-generated status report

  return (
    <div className="fi">
      <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:44,fontWeight:700,textTransform:"uppercase",marginBottom:22}}>Manager</div>

      {/* Tab bar */}
      <div style={{display:"flex",gap:3,background:"#0a0a0a",border:`1px solid ${B.border}`,borderRadius:8,padding:3,marginBottom:22,flexWrap:"wrap"}}>
        <button style={T("summary")} onClick={()=>setTab("summary")}>Summary</button>
        <button style={T("activity")} onClick={()=>setTab("activity")}>Activity</button>
        <button style={T("monthly")} onClick={()=>setTab("monthly")}>Month vs Month</button>
        <button style={T("recap")} onClick={()=>setTab("recap")}>Meeting Recap</button>
        <button style={T("announce")} onClick={()=>setTab("announce")}>Announce</button>
        <button style={T("approvals")} onClick={()=>setTab("approvals")}>
          Approvals {pending.length>0&&<span style={{background:"#ef4444",color:"#fff",borderRadius:9,padding:"1px 6px",fontSize:10,fontWeight:600,marginLeft:4}}>{pending.length}</span>}
        </button>
        <button style={T("add")} onClick={()=>setTab("add")}>Add Deal</button>
        <button style={T("team")} onClick={()=>setTab("team")}>Team</button>
        <button style={T("invite")} onClick={()=>setTab("invite")}>Invite</button>
        <button style={T("badges")} onClick={()=>setTab("badges")}>Badges</button>
      </div>

      {/* ── EXECUTIVE SUMMARY ── */}
      {tab==="summary"&&(
        <div>
          <div className="card" style={{padding:24,marginBottom:14,background:"linear-gradient(135deg,#0d0d0d,#0a0a0a)",borderColor:"#ffffff18"}}>
            <div style={{fontSize:11,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:16}}>Executive Summary · Q{q+1} {now.getFullYear()}</div>
            {summaryLines.length===0
              ? <div style={{color:"#e5e5e5",fontSize:14}}>No data yet — set targets and log some signings to generate a summary.</div>
              : summaryLines.map((line,i)=>(
                  <div key={i} style={{display:"flex",gap:12,marginBottom:i<summaryLines.length-1?10:0}}>
                    <div style={{width:4,background:i===0?B.orange:"#333",borderRadius:2,flexShrink:0,marginTop:3}} />
                    <p style={{fontSize:14,color:i===0?"#fff":"#ccc",lineHeight:1.6,margin:0}}>{line}</p>
                  </div>
                ))
            }
          </div>

          {/* Key numbers row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
            {[
              {label:"Total Signings",val:totalSigs,sub:totalTarget>0?`Target: ${totalTarget}`:"No target",col:B.orange},
              {label:"Overall Forecast",val:totalForecast,sub:totalTarget>0?`${Math.round(((totalForecast-totalTarget)/Math.max(totalTarget,1))*100)}% vs target`:"—",col:totalTarget>0&&totalForecast>=totalTarget?"#16a34a":"#d97706"},
              {label:"Days Left in Q",val:daysLeft,sub:`of ${daysTotal} total`,col:"#aaa"},
              {label:"Pending Approval",val:pending.length,sub:pending.length>0?"Action needed":"All clear ✓",col:pending.length>0?"#ef4444":"#16a34a"},
            ].map(s=>(
              <div key={s.label} className="card" style={{padding:16}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:36,fontWeight:700,color:s.col,lineHeight:1,marginBottom:4}}>{s.val}</div>
                <div style={{fontSize:11,fontWeight:600,color:"#e5e5e5",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:2}}>{s.label}</div>
                <div style={{fontSize:12,color:"#e5e5e5"}}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Per platform strip */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
            {teamTotals.map(({p,sigs,target,forecast,pct,avgSplit,splitTarget})=>(
              <div key={p} className="card" style={{padding:16,borderColor:PLATFORM_COLOR[p]+"44"}}>
                <div style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:14,fontWeight:700,color:PLATFORM_COLOR[p],marginBottom:8}}>{p}</div>
                <div style={{display:"flex",alignItems:"flex-end",gap:5,marginBottom:6}}>
                  <span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:34,fontWeight:700,color:"#fff",lineHeight:1}}>{sigs}</span>
                  {target>0&&<span style={{fontFamily:"'Barlow Condensed',sans-serif",fontSize:16,color:"#ddd",lineHeight:1,paddingBottom:2}}>/ {target}</span>}
                </div>
                {target>0&&<>
                  <div style={{height:5,background:"#111",borderRadius:3,overflow:"hidden",marginBottom:6}}>
                    <div style={{height:"100%",width:`${pct}%`,background:PLATFORM_COLOR[p],borderRadius:3,transition:"width 0.5s"}} />
                  </div>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:12}}>
                    <span style={{color:pct>=100?"#16a34a":pct>=70?"#d97706":"#ef4444",fontWeight:600}}>{pct}%</span>
                    <span style={{color:"#e5e5e5"}}>Forecast: <span style={{color:forecast>=target?"#16a34a":"#d97706",fontWeight:600}}>{forecast}</span></span>
                  </div>
                </>}
                {avgSplit!=null&&avgSplit>0&&splitTarget&&(
                  <div style={{fontSize:12,marginTop:6,color:avgSplit>=splitTarget?"#16a34a":"#d97706"}}>Split: {fmtPct(avgSplit)} / {fmtPct(splitTarget)}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── ACTIVITY FEED ── */}
      {tab==="activity"&&(
        <div>
          <p style={{color:"#e5e5e5",fontSize:14,marginBottom:18}}>Everything that's happened across the team, most recent first.</p>
          {feed.length===0
            ?<div className="card" style={{padding:40,textAlign:"center",color:"#ddd"}}>No activity yet — starts filling up once the team logs signings.</div>
            :<div style={{display:"grid",gap:7}}>
              {feed.map((event,i)=>{
                const c = event.user?.accentColor||B.orange;
                return (
                  <div key={i} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"12px 16px",background:"#0a0a0a",borderRadius:10,border:"1px solid #1a1a1a"}}>
                    <div style={{width:32,height:32,borderRadius:"50%",background:c+"22",border:`1px solid ${c}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:14}}>
                      {ACTIVITY_ICONS[event.type]||"•"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,color:"#ddd",lineHeight:1.5}}>{activityText(event)}</div>
                      <div style={{fontSize:12,color:"#e5e5e5",marginTop:2}}>{timeAgo(event.ts)}</div>
                    </div>
                    <Avatar user={event.user} size={26} />
                  </div>
                );
              })}
            </div>
          }
        </div>
      )}

      {/* ── MONTH VS MONTH ── */}
      {tab==="monthly"&&(
        <div>
          <p style={{color:"#e5e5e5",fontSize:14,marginBottom:18}}>Team signings by month. Based on contract completion date.</p>

          {/* Team totals bar chart */}
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:16}}>Team Total — Last 6 Months</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120,marginBottom:12}}>
              {months.map((mo,i)=>{
                const max = Math.max(...months.map(m=>m.total),1);
                const h = Math.max(4,Math.round((mo.total/max)*100));
                const isCurrent = i===months.length-1;
                return (
                  <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                    <div style={{fontSize:13,fontWeight:700,color:isCurrent?B.orange:"#ddd"}}>{mo.total||""}</div>
                    <div style={{width:"100%",height:`${h}px`,background:isCurrent?B.orange:"#333",borderRadius:"4px 4px 0 0",transition:"height 0.4s",minHeight:4}} />
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8}}>
              {months.map((mo,i)=>(
                <div key={i} style={{flex:1,textAlign:"center",fontSize:11,color:i===months.length-1?B.orange:"#666"}}>{mo.label}</div>
              ))}
            </div>
          </div>

          {/* Platform breakdown */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
            {PLATFORMS.map(p=>{
              const pc = PLATFORM_COLOR[p];
              const maxVal = Math.max(...months.map(m=>m.byPlatform[p]||0),1);
              return (
                <div key={p} className="card" style={{padding:16,borderColor:pc+"33"}}>
                  <div style={{fontSize:13,fontWeight:700,color:pc,marginBottom:12}}>{p}</div>
                  <div style={{display:"flex",alignItems:"flex-end",gap:5,height:80,marginBottom:8}}>
                    {months.map((mo,i)=>{
                      const val = mo.byPlatform[p]||0;
                      const h = Math.max(3,Math.round((val/maxVal)*70));
                      const isCurrent = i===months.length-1;
                      return (
                        <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                          {val>0&&<div style={{fontSize:11,fontWeight:600,color:isCurrent?pc:"#ccc"}}>{val}</div>}
                          <div style={{width:"100%",height:`${h}px`,background:isCurrent?pc:pc+"44",borderRadius:"3px 3px 0 0",minHeight:3}} />
                        </div>
                      );
                    })}
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    {months.map((mo,i)=>(
                      <div key={i} style={{flex:1,textAlign:"center",fontSize:9,color:i===months.length-1?pc:"#555",overflow:"hidden",whiteSpace:"nowrap"}}>{mo.label.split(" ")[0]}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Per rep monthly table */}
          <div className="card" style={{padding:18}}>
            <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Per Rep Breakdown</div>
            {/* Header */}
            <div style={{display:"grid",gridTemplateColumns:`120px repeat(${months.length},1fr)`,gap:4,marginBottom:8}}>
              <div style={{fontSize:11,color:"#ddd"}} />
              {months.map((mo,i)=>(
                <div key={i} style={{fontSize:11,color:i===months.length-1?B.orange:"#666",textAlign:"center",fontWeight:i===months.length-1?700:400}}>{mo.label}</div>
              ))}
            </div>
            {allUsers.map(u=>{
              const c = u.accentColor||B.orange;
              return (
                <div key={u.email} style={{display:"grid",gridTemplateColumns:`120px repeat(${months.length},1fr)`,gap:4,marginBottom:6,alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <Avatar user={u} size={20} />
                    <span style={{fontSize:12,color:"#ddd",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.nickname||u.displayName}</span>
                  </div>
                  {months.map((mo,i)=>{
                    const repData = mo.perRep.find(r=>r.u.email===u.email);
                    const val = repData?.total||0;
                    const isCurrent = i===months.length-1;
                    return (
                      <div key={i} style={{textAlign:"center",padding:"4px 2px",background:val>0?(isCurrent?c+"22":"#111"):"transparent",borderRadius:5}}>
                        <span style={{fontSize:13,fontWeight:val>0?700:400,color:val>0?(isCurrent?c:"#ccc"):"#333"}}>{val||"—"}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ANNOUNCE ── */}
      {tab==="recap"&&(
        <div>
          <p style={{color:"#ddd",fontSize:14,marginBottom:20}}>Post the weekly meeting summary and task list. It appears as a card on every rep's dashboard until you clear it.</p>

          {recapSaved&&<div style={{background:"#0a150a",border:"1px solid #1a3a1a",borderRadius:10,padding:"10px 16px",marginBottom:14,fontSize:13,color:"#4ade80"}}>✓ Recap posted to all rep dashboards.</div>}

          <div className="card" style={{padding:22,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Meeting Details</div>
            <div style={{display:"grid",gap:12}}>
              <div><label>Meeting Date</label><input placeholder="e.g. 27 May 2026" value={recap.date} onChange={e=>setRecap(p=>({...p,date:e.target.value}))} /></div>
              <div><label>Fathom Recording Link (optional)</label><input placeholder="https://fathom.video/calls/..." value={recap.link} onChange={e=>setRecap(p=>({...p,link:e.target.value}))} /></div>
              <div>
                <label>Meeting Summary</label>
                <textarea rows={6} placeholder={"Paste the meeting summary here — key points, strategy updates, priorities for the week..."} value={recap.summary} onChange={e=>setRecap(p=>({...p,summary:e.target.value}))} style={{fontSize:13,lineHeight:1.6}} />
              </div>
            </div>
          </div>

          <div className="card" style={{padding:22,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Tasks</div>
            <div style={{display:"grid",gap:8,marginBottom:14}}>
              {recap.tasks.map((t,i)=>(
                <div key={t.id||i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"#080808",borderRadius:8,border:"1px solid #1e1e1e"}}>
                  <div>
                    <div style={{fontSize:13,color:"#fff",marginBottom:2}}>{t.task}</div>
                    <div style={{fontSize:11,color:"#3b82f6",fontWeight:600}}>{t.assignee==="All"?"Everyone":t.assignee}</div>
                  </div>
                  <button onClick={()=>removeTask(t.id||i)} style={{background:"transparent",border:"none",color:"#ef4444",cursor:"pointer",fontSize:16,padding:"2px 6px"}}>×</button>
                </div>
              ))}
              {recap.tasks.length===0&&<div style={{color:"#555",fontSize:13}}>No tasks added yet.</div>}
            </div>
            <div style={{display:"grid",gap:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10}}>
                <div><label>Task</label><input placeholder="e.g. Focus all new outreach on MSN this week" value={newTask.task} onChange={e=>setNewTask(p=>({...p,task:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addTask()} /></div>
                <div style={{minWidth:140}}><label>Assign to</label><select value={newTask.assignee} onChange={e=>setNewTask(p=>({...p,assignee:e.target.value}))}>{taskAssignees.filter((v,i,a)=>a.indexOf(v)===i).map(a=><option key={a}>{a}</option>)}</select></div>
              </div>
              <button className="btn btn-g btn-sm" onClick={addTask} disabled={!newTask.task.trim()} style={{width:"fit-content"}}>+ Add Task</button>
            </div>
          </div>

          <div style={{display:"flex",gap:8}}>
            <button className="btn btn-p" onClick={saveRecap} disabled={!recap.summary.trim()&&!recap.tasks.length} style={{justifyContent:"center"}}>{recapSaved?"✓ Posted!":"Post to Team"}</button>
            {getMeetingRecap()&&<button className="btn btn-g" onClick={removeRecap}>Clear Recap</button>}
          </div>

          {/* Preview */}
          {(recap.summary||recap.tasks.length>0)&&(
            <div style={{marginTop:20}}>
              <div style={{fontSize:12,fontWeight:600,color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Preview (as reps see it)</div>
              <div style={{background:"#0a0d12",border:"1px solid #3b82f644",borderRadius:12,padding:"16px 20px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:16}}>📋</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:"#60a5fa",textTransform:"uppercase"}}>Weekly Meeting Recap</div>
                      {recap.date&&<div style={{fontSize:11,color:"#555",marginTop:1}}>{recap.date}</div>}
                    </div>
                  </div>
                  {recap.link&&<span style={{fontSize:12,color:"#3b82f6",fontWeight:600}}>View recording →</span>}
                </div>
                {recap.summary&&<div style={{fontSize:13,color:"#ccc",lineHeight:1.6,marginBottom:recap.tasks.length?12:0,whiteSpace:"pre-wrap"}}>{recap.summary.slice(0,300)}{recap.summary.length>300?"...":""}</div>}
                {recap.tasks.length>0&&(
                  <div>
                    <div style={{fontSize:11,fontWeight:600,color:"#60a5fa",textTransform:"uppercase",marginBottom:6}}>Tasks</div>
                    {recap.tasks.slice(0,3).map((t,i)=>(
                      <div key={i} style={{display:"flex",gap:8,padding:"5px 8px",background:"#080808",borderRadius:6,marginBottom:4}}>
                        <span style={{color:"#3b82f6"}}>◦</span>
                        <div style={{fontSize:12,color:"#ddd"}}>{t.task} <span style={{color:"#3b82f6",fontSize:11}}>— {t.assignee==="All"?"Everyone":t.assignee}</span></div>
                      </div>
                    ))}
                    {recap.tasks.length>3&&<div style={{fontSize:11,color:"#555"}}>+{recap.tasks.length-3} more tasks...</div>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab==="announce"&&(
        <div>
          <p style={{color:"#e5e5e5",fontSize:14,marginBottom:18}}>Post a message that appears as a banner on every rep's dashboard until you remove it.</p>
          <div className="card" style={{padding:20,marginBottom:14}}>
            <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Post Announcement</div>
            <div style={{display:"grid",gap:12,marginBottom:14}}>
              <div>
                <label>Emoji</label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
                  {["📣","🔥","🎉","✅","⚡","🏆","💪","🚀","👀","💬"].map(e=>(
                    <div key={e} onClick={()=>setAnnouncement(p=>({...p,emoji:e}))} style={{width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:7,border:`2px solid ${announcement.emoji===e?B.orange:"#222"}`,cursor:"pointer",fontSize:17,background:announcement.emoji===e?B.orange+"18":"transparent"}}>{e}</div>
                  ))}
                </div>
              </div>
              <div>
                <label>Message</label>
                <textarea rows={3} placeholder="e.g. Great week everyone — 14 signings across the team. Lets close Q3 strong" value={announcement.text} onChange={e=>setAnnouncement(p=>({...p,text:e.target.value}))} />
                <div style={{fontSize:11,color:"#e5e5e5",marginTop:4,textAlign:"right"}}>{announcement.text.length}/200</div>
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn btn-p btn-sm" onClick={postAnnouncement} disabled={!announcement.text.trim()}>{annSaved?"✓ Posted!":"Post to Team"}</button>
              {getAnnouncement()&&<button className="btn btn-g btn-sm" onClick={removeAnnouncement}>Remove Current</button>}
            </div>
          </div>
          {/* Preview */}
          {announcement.text&&(
            <div>
              <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Preview</div>
              <div style={{background:`linear-gradient(135deg,${B.orange}22,#0d0d0d)`,border:`1px solid ${B.orange}55`,borderRadius:10,padding:"12px 18px",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18}}>{announcement.emoji||"📣"}</span>
                <div>
                  <div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{announcement.text}</div>
                  <div style={{fontSize:12,color:"#e5e5e5",marginTop:2}}>From {user.nickname||user.displayName} · just now</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── APPROVALS ── */}
      {tab==="add"&&(
        <div>
          <p style={{color:"#ddd",fontSize:15,marginBottom:22}}>Add a signing directly for a team member. It will be marked as approved immediately and count toward their targets.</p>
          {addSubmitted&&(
            <div style={{background:"#0a150a",border:"1px solid #1a3a1a",borderRadius:12,padding:"14px 18px",marginBottom:18,fontSize:15,color:"#4ade80"}}>
              ✓ Deal added and approved for {allUsers.find(u=>u.email===addForm.repEmail)?.nickname||addForm.repEmail}.
            </div>
          )}
          <div className="card" style={{padding:26}}>
            <div style={{display:"grid",gap:16}}>
              <div>
                <label style={{fontSize:13,marginBottom:8}}>Team Member</label>
                <select value={addForm.repEmail} onChange={e=>setAddForm(p=>({...p,repEmail:e.target.value}))} style={{fontSize:16,padding:"13px 16px"}}>
                  <option value="">Select a rep...</option>
                  {allUsers.map(u=><option key={u.email} value={u.email}>{u.nickname||u.displayName}</option>)}
                </select>
              </div>
              <div>
                <label style={{fontSize:13,marginBottom:8}}>Creator / Deal Name</label>
                <input placeholder="e.g. MrBeast, MKBHD" value={addForm.dealName} onChange={e=>setAddForm(p=>({...p,dealName:e.target.value}))} style={{fontSize:16,padding:"13px 16px"}} />
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                <div>
                  <label style={{fontSize:13,marginBottom:8}}>Platform</label>
                  <select value={addForm.platform} onChange={e=>setAddForm(p=>({...p,platform:e.target.value}))} style={{fontSize:16,padding:"13px 16px"}}>
                    {PLATFORMS.map(p=><option key={p}>{p}</option>)}
                  </select>
                </div>
                {addForm.platform!=="Spotify"&&(
                  <div>
                    <label style={{fontSize:13,marginBottom:8}}>Revenue Split</label>
                    <select value={addForm.split} onChange={e=>setAddForm(p=>({...p,split:e.target.value}))} style={{fontSize:16,padding:"13px 16px"}}>
                      {SPLITS.map(s=><option key={s.label}>{s.label}</option>)}
                    </select>
                  </div>
                )}
                {addForm.platform==="Spotify"&&<div style={{display:"flex",alignItems:"flex-end",paddingBottom:4}}><span style={{fontSize:15,color:"#ddd"}}>Spotify — no split required</span></div>}
              </div>
              <div>
                <label style={{fontSize:13,marginBottom:8}}>Contract Completion Date</label>
                <div style={{display:"flex",gap:10,alignItems:"center"}}>
                  <input type="date" value={addForm.contractDate} onChange={e=>setAddForm(p=>({...p,contractDate:e.target.value}))} style={{flex:1,fontSize:16,padding:"13px 16px"}} />
                  <button type="button" onClick={()=>setAddForm(p=>({...p,contractDate:todayStr()}))}
                    style={{background:"#1a1a1a",border:"1px solid #444",color:"#fff",padding:"13px 18px",borderRadius:8,fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap",flexShrink:0}}>
                    Today
                  </button>
                </div>
              </div>
              <div>
                <label style={{fontSize:13,marginBottom:8}}>Notes (optional)</label>
                <textarea rows={2} placeholder="Any additional context..." value={addForm.notes} onChange={e=>setAddForm(p=>({...p,notes:e.target.value}))} style={{fontSize:15,padding:"13px 16px"}} />
              </div>
            </div>
            {addErr&&<div style={{color:"#ef4444",fontSize:14,marginTop:12}}>{addErr}</div>}
            <button className="btn btn-p" onClick={submitForRep} style={{marginTop:20,width:"100%",justifyContent:"center",padding:"14px 24px",fontSize:16}}>Add Deal for Rep ✓</button>
          </div>
        </div>
      )}

      {tab==="approvals"&&(
        <div>
          {pending.length===0
            ?<div className="card" style={{padding:40,textAlign:"center",color:"#ddd"}}>No pending signings. All clear ✓</div>
            :<div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:14,color:"#ddd"}}>{pending.length} signing{pending.length>1?"s":""} awaiting approval</div>
                <button className="btn btn-p btn-sm" onClick={()=>{
                  pending.forEach(s=>{
                    const all=getSignings(s.submittedBy);
                    saveSignings(s.submittedBy,all.map(x=>x.id===s.id?{...x,status:"approved",approvedAt:Date.now(),approvedBy:user.email}:x));
                  });
                  refreshPending();
                }}>✓ Approve All</button>
              </div>
              <div style={{display:"grid",gap:10}}>
              {pending.map(s=>(
                <div key={s.id} className="card" style={{padding:18,borderColor:"#d9770633"}}>
                  {editSigning?.id===s.id?(
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.07em",textTransform:"uppercase",marginBottom:12}}>Edit — {s.submittedByName}</div>
                      <div style={{display:"grid",gap:10,marginBottom:14}}>
                        <div><label>Deal Name</label><input value={editSigning.dealName} onChange={e=>setEditSigning(p=>({...p,dealName:e.target.value}))} /></div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                          <div><label>Platform</label><select value={editSigning.platform} onChange={e=>setEditSigning(p=>({...p,platform:e.target.value}))}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></div>
                          {editSigning.platform!=="Spotify"&&<div><label>Split</label><select value={editSigning.split||"60/40"} onChange={e=>setEditSigning(p=>({...p,split:e.target.value}))}>{SPLITS.map(s=><option key={s.label}>{s.label}</option>)}</select></div>}
                        </div>
                        <div><label>Contract Date</label><input type="date" value={editSigning.contractDate} onChange={e=>setEditSigning(p=>({...p,contractDate:e.target.value}))} /></div>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button className="btn btn-p btn-sm" onClick={saveEdit}>Approve Edited ✓</button>
                        <button className="btn btn-g btn-sm" onClick={()=>setEditSigning(null)}>Cancel</button>
                      </div>
                    </div>
                  ):(
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div>
                          <div style={{fontSize:14,fontWeight:600,color:"#fff",marginBottom:3}}>{s.dealName}</div>
                          <div style={{fontSize:13,color:"#e5e5e5"}}>{s.submittedByName} · {s.platform}{s.split?" · "+s.split:""} · {s.contractDate}</div>
                          {s.notes&&<div style={{fontSize:13,color:"#e5e5e5",marginTop:3,fontStyle:"italic"}}>"{s.notes}"</div>}
                        </div>
                        <span style={{fontSize:12,color:PLATFORM_COLOR[s.platform]||B.orange,fontWeight:700,background:PLATFORM_COLOR[s.platform]+"22",borderRadius:6,padding:"2px 8px"}}>{s.platform}</span>
                      </div>
                      <div style={{display:"flex",gap:8}}>
                        <button className="btn btn-p btn-sm" onClick={()=>approveSigning(s)}>✓ Approve</button>
                        <button className="btn btn-g btn-sm" onClick={()=>setEditSigning({...s})}>Edit</button>
                        <button onClick={()=>rejectSigning(s)} style={{padding:"6px 12px",fontSize:12,background:"transparent",border:"1px solid #3a1a1a",color:"#ef4444",borderRadius:8,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>✗ Reject</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              </div>
            </div>
          }
        </div>
      )}

      {/* ── TEAM ── */}
      {tab==="team"&&(
        <div className="card" style={{padding:18}}>
          <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>Team ({allUsers.length})</div>
          {allUsers.length===0?<div style={{color:"#ddd",fontSize:14}}>No team members yet.</div>:<div style={{display:"grid",gap:7}}>
            {allUsers.map(u=>(
              <div key={u.email} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",background:"#080808",borderRadius:8}}>
                <Avatar user={u} size={32} />
                <div style={{flex:1}}>
                  <div style={{fontSize:14,fontWeight:600,color:"#fff"}}>{u.nickname||u.displayName}</div>
                  <div style={{fontSize:12,color:"#aaa"}}>{u.email} · {u.role}</div>
                </div>
                {u.title&&<span style={{fontSize:12,color:u.accentColor||B.orange,fontWeight:600,marginRight:8}}>{u.title}</span>}
                {u.email!=="frazer@wildvision.io"&&(
                  <button onClick={()=>{
                    if(!window.confirm(`Delete account for ${u.nickname||u.displayName}? This cannot be undone.`))return;
                    LS.del("user:"+u.email.toLowerCase());
                    LS.del("signings:"+u.email.toLowerCase());
                    refreshAllUsers();
                  }} style={{background:"transparent",border:"1px solid #3a1a1a",color:"#ef4444",padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",flexShrink:0}}>
                    Delete
                  </button>
                )}
              </div>
            ))}
          </div>}
        </div>
      )}

      {/* ── INVITE ── */}
      {tab==="invite"&&(
        <div className="card" style={{padding:20}}>
          <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Invite Team Member</div>
          <div style={{display:"grid",gap:12,marginBottom:12}}>
            <div><label>Their Email</label><input type="email" placeholder="rep@wildvision.io" value={email} onChange={e=>setEmail(e.target.value)} /></div>
            <div><label>Role</label><select value={role} onChange={e=>setRole(e.target.value)}><option value="rep">Sales Rep</option><option value="manager">Manager</option></select></div>
          </div>
          <button className="btn btn-p btn-sm" onClick={genInvite} disabled={!email.trim()}>Generate Invite Code</button>
          {code&&<div style={{marginTop:14,padding:"12px 16px",background:"#080808",border:`1px solid ${B.orange}44`,borderRadius:8}}>
            <div style={{fontSize:11,color:"#ddd",marginBottom:5,textTransform:"uppercase",letterSpacing:"0.07em"}}>Code for {email}</div>
            <div style={{fontFamily:"'Space Mono',monospace",fontSize:18,fontWeight:700,color:B.orange,letterSpacing:"0.1em"}}>{code}</div>
            <div style={{fontSize:12,color:"#e5e5e5",marginTop:5}}>They use this on the "Invite Code" tab at login.</div>
          </div>}
        </div>
      )}

      {/* ── BADGES ── */}
      {tab==="badges"&&(
        <div className="card" style={{padding:20}}>
          <div style={{fontSize:12,fontWeight:600,color:"#e5e5e5",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:14}}>Award a Badge</div>
          <div style={{display:"grid",gap:12,marginBottom:14}}>
            <div><label>Team Member</label><select value={bForm.recipientEmail} onChange={e=>setBForm(p=>({...p,recipientEmail:e.target.value}))}><option value="">Select...</option>{allUsers.map(u=><option key={u.email} value={u.email}>{u.nickname||u.displayName}</option>)}</select></div>
            <div><label>Badge Name</label><input placeholder='"Deal Machine" or "Top Split"' value={bForm.name} onChange={e=>setBForm(p=>({...p,name:e.target.value}))} /></div>
            <div><label>Emoji</label><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>{BADGE_EMOJIS.map(e=><div key={e} onClick={()=>setBForm(p=>({...p,emoji:e}))} style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",borderRadius:7,border:`2px solid ${bForm.emoji===e?B.orange:"#222"}`,cursor:"pointer",fontSize:16,background:bForm.emoji===e?B.orange+"18":"transparent"}}>{e}</div>)}</div></div>
            <div><label>Note (optional)</label><input placeholder="Why they earned it..." value={bForm.note} onChange={e=>setBForm(p=>({...p,note:e.target.value}))} /></div>
          </div>
          <button className="btn btn-p btn-sm" onClick={awardBadge} disabled={!bForm.recipientEmail||!bForm.name}>{badgeSaved?"✓ Awarded!":`Award ${bForm.emoji} Badge`}</button>
        </div>
      )}
    </div>
  );
}
