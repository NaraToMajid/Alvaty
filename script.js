// ==================== SUPABASE CLIENT ====================
// Keys loaded from window (injected by index.html from .env equivalent)
const SUPABASE_URL = window.ENV_SUPABASE_URL || 'https://mqonelsoqyvrasrzrzfl.supabase.co';
const SUPABASE_ANON = window.ENV_SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1xb25lbHNvcXl2cmFzcnpyemZsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5NjEzOTQsImV4cCI6MjA4MTUzNzM5NH0.exHvN0BA3P71DcZbavZ0DMk8pUEpWQ6VCuH672wEdJ4';

const SupabaseClient = {
  async query(table, method='GET', body=null, filters='', order='', limit='') {
    let url = `${SUPABASE_URL}/rest/v1/${table}?`;
    if(filters) url += filters + '&';
    if(order) url += `order=${order}&`;
    if(limit) url += `limit=${limit}&`;
    const opts = {
      method,
      headers:{
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
        'Prefer': method==='POST' ? 'return=representation' : (method==='PATCH'||method==='DELETE' ? 'return=representation' : '')
      }
    };
    if(body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if(!res.ok){ const e = await res.text(); throw new Error(e); }
    if(method==='DELETE') return true;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : [];
  },
  async select(table, filters='', order='created_at.desc', limit='50'){
    return this.query(table,'GET',null,filters,order,limit);
  },
  async insert(table, data){
    return this.query(table,'POST',data,'','','');
  },
  async update(table, data, filters){
    return this.query(table,'PATCH',data,filters,'','');
  },
  async delete(table, filters){
    return this.query(table,'DELETE',null,filters,'','');
  },
  async upload(bucket, path, file){
    const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
    const res = await fetch(url, {
      method:'POST',
      headers:{'apikey':SUPABASE_ANON,'Authorization':`Bearer ${SUPABASE_ANON}`,'Content-Type':file.type,'x-upsert':'true'},
      body: file
    });
    if(!res.ok) throw new Error(await res.text());
    return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  }
};

// ==================== APP STATE ====================
let currentUser = null;
let currentTab = 'home';
let currentChatUser = null;
let currentPostId = null;
let currentReplyMsg = null;
let storyData = [];
let storyIndex = 0;
let storyTimer = null;
let allChats = [];
let chatPollingInterval = null;

// ==================== INIT ====================
(async()=>{
  const saved = localStorage.getItem('altavy_user');
  if(saved){ currentUser = JSON.parse(saved); await initApp(); }
  const theme = localStorage.getItem('altavy_theme')||'dark';
  applyTheme(theme);
})();

// ==================== ROUTING ====================
function pushRoute(path){ history.pushState({path},'',path); }

window.addEventListener('popstate', e=>{
  if(document.getElementById('chat-room').classList.contains('active')) closeChatRoom();
  else if(document.getElementById('post-detail').classList.contains('active')) closePostDetail();
  else if(document.getElementById('user-profile').classList.contains('active')) closeUserProfile();
  else if(document.getElementById('settings-page').classList.contains('active')) closeSettings();
  else if(document.getElementById('story-viewer').classList.contains('active')) closeStory();
});

// ==================== PAGES ====================
function showPage(name){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
}

async function initApp(){
  if(currentUser.is_admin){ showPage('admin'); loadAdminDashboard(); return; }
  showPage('main');
  pushRoute('/');
  loadFeed();
  loadStories();
  loadReels();
  loadChats();
  loadNotifications();
  renderMyProfile();
  // Poll for new messages/notifs every 30s
  startPolling();
}

function startPolling(){
  if(chatPollingInterval) clearInterval(chatPollingInterval);
  chatPollingInterval = setInterval(async()=>{
    if(currentTab==='chat') loadChats();
    if(currentTab==='notif') loadNotifications();
    // Update badge counts
    await updateBadges();
    // Mark chat messages as read if chat room is open
    if(currentChatUser) await markMessagesRead();
  }, 8000);
}

async function updateBadges(){
  if(!currentUser) return;
  try {
    const unreadNotifs = await SupabaseClient.select('Notifications_Alvaty',`user_id=eq.${currentUser.id_user}&status_dibaca=eq.false`,'created_at.desc','100');
    const badge = document.getElementById('notif-badge');
    const sideBadge = document.getElementById('sidebar-notif-badge');
    const count = unreadNotifs.length;
    if(badge){ badge.textContent=count; badge.style.display=count>0?'flex':'none'; }
    if(sideBadge){ sideBadge.textContent=count; sideBadge.style.display=count>0?'flex':'none'; }

    const msgs = await SupabaseClient.select('Messages_Alvaty',`receiver_id=eq.${currentUser.id_user}&read=eq.false`,'created_at.desc','100');
    const chatBadge = document.getElementById('chat-badge');
    const sideChat = document.getElementById('sidebar-chat-badge');
    const cm = msgs.length;
    if(chatBadge){ chatBadge.textContent=cm; chatBadge.style.display=cm>0?'flex':'none'; }
    if(sideChat){ sideChat.textContent=cm; sideChat.style.display=cm>0?'flex':'none'; }
  } catch(e){}
}

// ==================== THEME ====================
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t==='light'?'light':'');
  localStorage.setItem('altavy_theme', t);
  document.getElementById('theme-dark-btn')?.classList.toggle('active', t==='dark');
  document.getElementById('theme-light-btn')?.classList.toggle('active', t==='light');
}
function setTheme(t){ applyTheme(t); showToast('Tema '+(t==='dark'?'gelap':'terang')+' diaktifkan'); }

// ==================== AUTH ====================
async function doLogin(){
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  err.classList.remove('show');
  if(!u||!p){ err.textContent='Isi semua field.'; err.classList.add('show'); return; }
  if(u==='admin' && p==='Rantauprapat123'){
    currentUser = {id:'admin',username:'admin',is_admin:true};
    localStorage.setItem('altavy_user', JSON.stringify(currentUser));
    await initApp(); return;
  }
  try {
    const rows = await SupabaseClient.select('Users_Alvaty', `username=eq.${encodeURIComponent(u)}`,'created_at.desc','1');
    if(!rows.length){ err.textContent='Username tidak ditemukan.'; err.classList.add('show'); return; }
    const user = rows[0];
    if(user.password_hash !== p){ err.textContent='Password salah.'; err.classList.add('show'); return; }
    currentUser = user;
    localStorage.setItem('altavy_user', JSON.stringify(currentUser));
    await initApp();
  } catch(e){ err.textContent='Gagal login. Coba lagi.'; err.classList.add('show'); }
}

async function doRegister(){
  const u = document.getElementById('reg-username').value.trim();
  const p = document.getElementById('reg-password').value;
  const c = document.getElementById('reg-confirm').value;
  const err = document.getElementById('reg-error');
  err.classList.remove('show');
  if(!u||!p||!c){ err.textContent='Isi semua field.'; err.classList.add('show'); return; }
  if(p.length<6){ err.textContent='Password minimal 6 karakter.'; err.classList.add('show'); return; }
  if(p!==c){ err.textContent='Password tidak cocok.'; err.classList.add('show'); return; }
  if(!/^[a-zA-Z0-9_]{3,20}$/.test(u)){ err.textContent='Username 3-20 karakter (huruf, angka, _).'; err.classList.add('show'); return; }
  try {
    const existing = await SupabaseClient.select('Users_Alvaty', `username=eq.${encodeURIComponent(u)}`,'created_at.desc','1');
    if(existing.length){ err.textContent='Username sudah dipakai.'; err.classList.add('show'); return; }
    const newUser = await SupabaseClient.insert('Users_Alvaty',{username:u,password_hash:p,bio:'',foto_profil_url:''});
    currentUser = Array.isArray(newUser)?newUser[0]:newUser;
    localStorage.setItem('altavy_user', JSON.stringify(currentUser));
    await initApp();
  } catch(e){ err.textContent='Gagal daftar: '+e.message; err.classList.add('show'); }
}

function doLogout(){
  currentUser=null;
  if(chatPollingInterval) clearInterval(chatPollingInterval);
  localStorage.removeItem('altavy_user');
  closeSettings(); showPage('landing');
}

// ==================== TAB NAVIGATION ====================
function switchTab(tab, el){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  if(el) el.classList.add('active');
  // Also mark sidebar item active
  const sideItem = document.getElementById('sidebar-nav-'+tab);
  if(sideItem) sideItem.classList.add('active');
  currentTab = tab;

  // Desktop: FAB hidden, show create button in sidebar for home/reels
  // Mobile FAB
  const fab = document.getElementById('fab-btn');
  if(fab) fab.style.display = (tab==='home'||tab==='reels') ? 'flex' : 'none';

  if(tab==='home') loadFeed();
  if(tab==='reels') loadReels();
  if(tab==='chat') loadChats();
  if(tab==='notif'){ loadNotifications(); markNotifsRead(); }
  if(tab==='profile') renderMyProfile();

  const routes = {home:'/',reels:'/reels',chat:'/chat',notif:'/notifications',profile:'/profile'};
  pushRoute(routes[tab]||'/');
}

// ==================== UTILS ====================
function avatarEl(u, size=38){
  if(u.foto_profil_url) return `<img src="${u.foto_profil_url}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;" alt="${u.username}">`;
  const colors = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899'];
  const color = colors[(u.username||'A').charCodeAt(0)%colors.length];
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:${size*0.4}px;flex-shrink:0;">${(u.username||'?')[0].toUpperCase()}</div>`;
}

function timeAgo(d){
  const diff = (Date.now()-new Date(d))/1000;
  if(diff<60) return 'Baru saja';
  if(diff<3600) return Math.floor(diff/60)+'m';
  if(diff<86400) return Math.floor(diff/3600)+'j';
  return Math.floor(diff/86400)+'h';
}

function showToast(msg, type=''){
  const t = document.getElementById('toast');
  t.textContent=msg; t.className='toast show '+(type||'');
  setTimeout(()=>t.className='toast',2500);
}

// ==================== FEED ====================
async function loadFeed(){
  const fl = document.getElementById('feed-list');
  fl.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const posts = await SupabaseClient.select('Posts_Alvaty','','created_at.desc','30');
    const userIds = [...new Set(posts.map(p=>p.user_id))];
    const users = {};
    for(const uid of userIds){
      const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${uid}`,'created_at.asc','1');
      if(u[0]) users[uid]=u[0];
    }
    if(!posts.length){ fl.innerHTML='<div class="empty-state"><i class="fa fa-images"></i><p>Belum ada postingan</p></div>'; return; }
    let html='';
    for(const post of posts){
      const u = users[post.user_id]||{username:'unknown',foto_profil_url:''};
      const isVideo = post.media_type==='video';
      html += `
      <div class="post-card" id="post-${post.id_post}">
        <div class="post-header">
          <div class="post-avatar" onclick="openUserProfile('${u.id_user}','${u.username}')">${avatarEl(u,38)}</div>
          <div class="post-info">
            <div class="post-username" onclick="openUserProfile('${u.id_user}','${u.username}')">${u.username}</div>
            <div class="post-time">${timeAgo(post.created_at)}</div>
          </div>
          ${currentUser&&post.user_id===currentUser.id_user?`<button class="icon-btn" onclick="deletePost('${post.id_post}')"><i class="fa fa-trash"></i></button>`:''}
        </div>
        ${post.media_url?`<div class="post-media-wrap">${isVideo?`<video src="${post.media_url}" controls playsinline style="width:100%;max-height:500px;object-fit:cover;display:block;"></video>`:`<img class="post-media" src="${post.media_url}" loading="lazy" alt="post">`}</div>`:''}
        <div class="post-actions">
          <button class="post-action-btn" id="like-btn-${post.id_post}" onclick="toggleLike('${post.id_post}','post')">
            <i class="fa fa-heart"></i><span id="like-count-${post.id_post}">0</span>
          </button>
          <button class="post-action-btn" onclick="openPostDetail('${post.id_post}')">
            <i class="fa fa-comment"></i><span id="cmt-count-${post.id_post}">0</span>
          </button>
          <button class="post-action-btn" id="save-btn-${post.id_post}" onclick="toggleSave('${post.id_post}','post')">
            <i class="fa fa-bookmark"></i>
          </button>
          <button class="post-action-btn" onclick="sharePost('${post.id_post}')">
            <i class="fa fa-share"></i>
          </button>
        </div>
        ${post.caption?`<div class="post-caption"><strong class="post-username" style="cursor:pointer;" onclick="openUserProfile('${u.id_user}','${u.username}')">${u.username}</strong> ${post.caption}</div>`:''}
        <div style="padding:0 1rem 0.5rem;font-size:0.8rem;color:var(--text3);cursor:pointer;" onclick="openPostDetail('${post.id_post}')">Lihat komentar</div>
      </div>`;
    }
    fl.innerHTML = html;
    for(const post of posts){ loadPostCounts(post.id_post); }
  } catch(e){ fl.innerHTML='<div class="empty-state"><i class="fa fa-exclamation-circle"></i><p>Gagal memuat feed</p></div>'; }
}

async function loadPostCounts(pid){
  try {
    const likes = await SupabaseClient.select('Likes_Alvaty',`target_id=eq.${pid}&type_target=eq.post`,'created_at.asc','1000');
    const cmts = await SupabaseClient.select('Comments_Alvaty',`post_id=eq.${pid}`,'created_at.asc','1000');
    const lc = document.getElementById('like-count-'+pid);
    const cc = document.getElementById('cmt-count-'+pid);
    if(lc) lc.textContent = likes.length;
    if(cc) cc.textContent = cmts.length;
    if(currentUser){
      const myLike = likes.find(l=>l.user_id===currentUser.id_user);
      const btn = document.getElementById('like-btn-'+pid);
      if(btn&&myLike) btn.classList.add('liked');
      const mySave = await SupabaseClient.select('Likes_Alvaty',`target_id=eq.${pid}&type_target=eq.save_post&user_id=eq.${currentUser.id_user}`,'created_at.asc','1');
      const sbtn = document.getElementById('save-btn-'+pid);
      if(sbtn&&mySave.length) sbtn.classList.add('saved');
    }
  } catch(e){}
}

async function toggleLike(targetId, type){
  if(!currentUser) return;
  const btn = document.getElementById('like-btn-'+targetId);
  try {
    const existing = await SupabaseClient.select('Likes_Alvaty',`user_id=eq.${currentUser.id_user}&target_id=eq.${targetId}&type_target=eq.${type}`,'created_at.asc','1');
    if(existing.length){
      await SupabaseClient.delete('Likes_Alvaty',`id_like=eq.${existing[0].id_like}`);
      btn?.classList.remove('liked');
    } else {
      await SupabaseClient.insert('Likes_Alvaty',{user_id:currentUser.id_user,target_id:targetId,type_target:type});
      btn?.classList.add('liked');
    }
    loadPostCounts(targetId);
  } catch(e){}
}

async function toggleSave(targetId, type){
  if(!currentUser) return;
  const btn = document.getElementById('save-btn-'+targetId);
  try {
    const existing = await SupabaseClient.select('Likes_Alvaty',`user_id=eq.${currentUser.id_user}&target_id=eq.${targetId}&type_target=eq.save_${type}`,'created_at.asc','1');
    if(existing.length){
      await SupabaseClient.delete('Likes_Alvaty',`id_like=eq.${existing[0].id_like}`);
      btn?.classList.remove('saved'); showToast('Dihapus dari favorit');
    } else {
      await SupabaseClient.insert('Likes_Alvaty',{user_id:currentUser.id_user,target_id:targetId,type_target:`save_${type}`});
      btn?.classList.add('saved'); showToast('Disimpan ke favorit','success');
    }
  } catch(e){}
}

async function deletePost(pid){
  if(!confirm('Hapus postingan ini?')) return;
  try { await SupabaseClient.delete('Posts_Alvaty',`id_post=eq.${pid}`); loadFeed(); showToast('Postingan dihapus'); } catch(e){}
}

function sharePost(pid){
  const url = `${location.origin}/post/${pid}`;
  navigator.clipboard?.writeText(url).then(()=>showToast('Link disalin!','success'));
}

// ==================== CREATE ====================
function openCreatePost(){
  // On desktop we can show a different approach, but modal works universally
  openModal('modal-create-post');
}

function openCreateReel(){ openModal('modal-create-reel'); }

// ==================== STORIES ====================
async function loadStories(){
  const row = document.getElementById('stories-row');
  try {
    const now = new Date().toISOString();
    const stories = await SupabaseClient.select('Stories_Alvaty',`expired_at=gt.${now}`,'created_at.desc','50');
    const userIds = [...new Set(stories.map(s=>s.user_id))];
    const users = {};
    for(const uid of userIds){
      const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${uid}`,'created_at.asc','1');
      if(u[0]) users[uid]=u[0];
    }
    const grouped = {};
    for(const s of stories){ if(!grouped[s.user_id]) grouped[s.user_id]=[]; grouped[s.user_id].push(s); }
    row.innerHTML = `<div style="flex-shrink:0"><div class="story-add-btn" onclick="openAddStory()"><i class="fa fa-plus" style="color:var(--text2);font-size:1.1rem;"></i></div><div class="story-name">Story</div></div>`;
    for(const uid of Object.keys(grouped)){
      const u = users[uid]||{username:'?',foto_profil_url:''};
      const isMine = currentUser && uid===currentUser.id_user;
      const storyList = grouped[uid];
      const div = document.createElement('div');
      div.style.flexShrink='0';
      div.innerHTML = `<div class="story-item" onclick="viewStory(${JSON.stringify(storyList).replace(/"/g,'&quot;')})">
        <div class="story-ring ${isMine?'':''}">
          <div class="story-avatar">${u.foto_profil_url?`<img src="${u.foto_profil_url}" style="width:100%;height:100%;object-fit:cover;">`:(u.username[0]||'?').toUpperCase()}</div>
        </div>
        <div class="story-name">${isMine?'Kamu':u.username}</div>
      </div>`;
      row.appendChild(div);
    }
    storyData = stories;
  } catch(e){}
}

function viewStory(stories){
  const sv = document.getElementById('story-viewer');
  sv.classList.add('active');
  storyIndex = 0;
  storyData = stories;
  showStoryAt(0);
}

async function showStoryAt(i){
  if(i>=storyData.length){ closeStory(); return; }
  storyIndex = i;
  const s = storyData[i];
  const prog = document.getElementById('story-progress');
  prog.innerHTML = storyData.map((_,j)=>`<div class="story-progress-bar"><div class="story-progress-fill" id="spf-${j}" style="width:${j<i?'100%':'0%'}"></div></div>`).join('');
  try {
    const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${s.user_id}`,'created_at.asc','1');
    const user = u[0]||{username:'?'};
    document.getElementById('sv-username').textContent = user.username;
    const ava = document.getElementById('sv-avatar');
    ava.innerHTML = user.foto_profil_url?`<img src="${user.foto_profil_url}" style="width:100%;height:100%;object-fit:cover;">`:(user.username[0]||'?').toUpperCase();
  } catch(e){}
  document.getElementById('sv-time').textContent = timeAgo(s.created_at);
  const media = document.getElementById('sv-media');
  const isVideo = s.media_url?.match(/\.(mp4|mov|webm)/i);
  media.innerHTML = s.media_url
    ? (isVideo?`<video src="${s.media_url}" autoplay muted playsinline style="width:100%;height:100%;object-fit:contain;"></video>`:`<img src="${s.media_url}" style="max-width:100%;max-height:100%;object-fit:contain;">`)
    : '<div style="color:#fff;font-size:2rem;">📷</div>';
  clearTimeout(storyTimer);
  setTimeout(()=>{ const fill=document.getElementById('spf-'+i); if(fill) fill.style.width='100%'; },50);
  storyTimer = setTimeout(()=>showStoryAt(i+1), 5000);
  const sv = document.getElementById('story-viewer');
  sv.onclick = (e)=>{ if(e.clientX>window.innerWidth/2) showStoryAt(i+1); else showStoryAt(Math.max(0,i-1)); };
}

function closeStory(){
  document.getElementById('story-viewer').classList.remove('active');
  clearTimeout(storyTimer);
}

// ==================== REELS ====================
async function loadReels(){
  const rc = document.getElementById('reels-container');
  rc.innerHTML='<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const reels = await SupabaseClient.select('Reels_Alvaty','','created_at.desc','20');
    if(!reels.length){ rc.innerHTML='<div class="empty-state" style="height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;"><i class="fa fa-film"></i><p>Belum ada reels</p></div>'; return; }
    const userIds = [...new Set(reels.map(r=>r.user_id))];
    const users = {};
    for(const uid of userIds){
      const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${uid}`,'created_at.asc','1');
      if(u[0]) users[uid]=u[0];
    }
    rc.innerHTML = reels.map(r=>{
      const u = users[r.user_id]||{username:'unknown'};
      return `<div class="reel-item" id="reel-${r.id_reel}">
        <video class="reel-video" src="${r.video_url}" loop muted playsinline onclick="toggleReelPlay(this)"></video>
        <div class="reel-overlay"></div>
        <div class="reel-info">
          <div class="reel-username" onclick="openUserProfile('${u.id_user}','${u.username}')">@${u.username}</div>
          <div class="reel-caption">${r.caption||''}</div>
        </div>
        <div class="reel-actions">
          <button class="reel-btn" id="rl-${r.id_reel}" onclick="toggleLikeReel('${r.id_reel}',this)">
            <i class="fa fa-heart"></i><span id="rl-count-${r.id_reel}">0</span>
          </button>
          <button class="reel-btn" onclick="openReelComments('${r.id_reel}')">
            <i class="fa fa-comment"></i><span>0</span>
          </button>
          <button class="reel-btn" id="rs-${r.id_reel}" onclick="toggleSave('${r.id_reel}','reel')">
            <i class="fa fa-bookmark"></i>
          </button>
          <button class="reel-btn" onclick="sharePost('${r.id_reel}')">
            <i class="fa fa-share"></i>
          </button>
          ${currentUser&&r.user_id===currentUser.id_user?`<button class="reel-btn" onclick="deleteReel('${r.id_reel}')"><i class="fa fa-trash"></i></button>`:''}
        </div>
      </div>`;
    }).join('');
    const observer = new IntersectionObserver(entries=>{
      entries.forEach(e=>{
        const v = e.target.querySelector('video');
        if(e.isIntersecting) v?.play().catch(()=>{});
        else { v?.pause(); }
      });
    },{threshold:0.7});
    rc.querySelectorAll('.reel-item').forEach(el=>observer.observe(el));
    for(const r of reels) loadReelLikes(r.id_reel);
  } catch(e){ rc.innerHTML='<div class="empty-state" style="height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;"><i class="fa fa-exclamation"></i><p>Gagal memuat reels</p></div>'; }
}

function toggleReelPlay(v){ v.paused?v.play():v.pause(); }

async function loadReelLikes(rid){
  try {
    const likes = await SupabaseClient.select('Likes_Alvaty',`target_id=eq.${rid}&type_target=eq.reel`,'created_at.asc','1000');
    const el = document.getElementById('rl-count-'+rid);
    if(el) el.textContent = likes.length;
    if(currentUser){
      const my = likes.find(l=>l.user_id===currentUser.id_user);
      if(my) document.getElementById('rl-'+rid)?.classList.add('liked');
    }
  } catch(e){}
}

async function toggleLikeReel(rid, btn){
  if(!currentUser) return;
  try {
    const ex = await SupabaseClient.select('Likes_Alvaty',`user_id=eq.${currentUser.id_user}&target_id=eq.${rid}&type_target=eq.reel`,'created_at.asc','1');
    if(ex.length){ await SupabaseClient.delete('Likes_Alvaty',`id_like=eq.${ex[0].id_like}`); btn.classList.remove('liked'); }
    else { await SupabaseClient.insert('Likes_Alvaty',{user_id:currentUser.id_user,target_id:rid,type_target:'reel'}); btn.classList.add('liked'); }
    loadReelLikes(rid);
  } catch(e){}
}

async function deleteReel(rid){
  if(!confirm('Hapus reels ini?')) return;
  try { await SupabaseClient.delete('Reels_Alvaty',`id_reel=eq.${rid}`); loadReels(); }catch(e){}
}

function openReelComments(rid){ openPostDetail(rid); }

// ==================== CHAT ====================
async function loadChats(){
  if(!currentUser) return;
  const wrap = document.getElementById('chat-list-wrap');
  wrap.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const msgs = await SupabaseClient.select('Messages_Alvaty',`sender_id=eq.${currentUser.id_user}&receiver_id=neq.${currentUser.id_user}`,'created_at.desc','100');
    const msgs2 = await SupabaseClient.select('Messages_Alvaty',`receiver_id=eq.${currentUser.id_user}`,'created_at.desc','100');
    const all = [...msgs,...msgs2];
    const partnerIds = [...new Set(all.map(m=>m.sender_id===currentUser.id_user?m.receiver_id:m.sender_id))];
    const users = [];
    for(const uid of partnerIds){
      const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${uid}`,'created_at.asc','1');
      if(u[0]) users.push(u[0]);
    }
    allChats = users;
    renderChatList(users, all);
  } catch(e){ wrap.innerHTML='<div class="empty-state"><i class="fa fa-comment-dots"></i><p>Belum ada percakapan</p></div>'; }
}

function renderChatList(users, allMsgs){
  const wrap = document.getElementById('chat-list-wrap');
  if(!users.length){ wrap.innerHTML='<div class="empty-state"><i class="fa fa-comment-dots"></i><p>Belum ada percakapan.<br>Cari pengguna lain untuk memulai chat.</p></div>'; return; }
  wrap.innerHTML = users.map(u=>{
    const lastMsg = allMsgs.filter(m=>(m.sender_id===u.id_user||m.receiver_id===u.id_user)).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
    const unread = allMsgs.filter(m=>m.sender_id===u.id_user&&m.receiver_id===currentUser.id_user&&!m.read).length;
    return `<div class="chat-item" onclick="openChatRoom('${u.id_user}','${u.username}','${u.foto_profil_url||''}')">
      <div class="chat-avatar">${avatarEl(u,46)}<div class="chat-online"></div></div>
      <div class="chat-info">
        <div class="chat-name">${u.username}</div>
        <div class="chat-preview">${lastMsg?(lastMsg.media_url?'📷 Gambar':lastMsg.message_text||''):'Mulai percakapan...'}</div>
      </div>
      <div class="chat-meta">
        <div class="chat-time">${lastMsg?timeAgo(lastMsg.created_at):''}</div>
        ${unread>0?`<div class="chat-unread">${unread}</div>`:''}
      </div>
    </div>`;
  }).join('');
}

function filterChats(){
  const q = document.getElementById('chat-search-input').value.toLowerCase();
  searchUsersForChat(q);
}

async function searchUsersForChat(q){
  if(!q){ loadChats(); return; }
  try {
    const users = await SupabaseClient.select('Users_Alvaty',`username=ilike.*${q}*`,'username.asc','10');
    const wrap = document.getElementById('chat-list-wrap');
    if(!users.length){ wrap.innerHTML='<div class="empty-state"><i class="fa fa-search"></i><p>Tidak ditemukan</p></div>'; return; }
    wrap.innerHTML = users.filter(u=>u.id_user!==currentUser.id_user).map(u=>`
      <div class="chat-item" onclick="openChatRoom('${u.id_user}','${u.username}','${u.foto_profil_url||''}')">
        <div class="chat-avatar">${avatarEl(u,46)}</div>
        <div class="chat-info"><div class="chat-name">${u.username}</div><div class="chat-preview">Mulai percakapan</div></div>
      </div>`).join('');
  } catch(e){}
}

async function openChatRoom(userId, username, avatarUrl){
  // Close any overlays that might be on top (or below) to ensure chat is visible
  // chat-room z-index is 700, above user-profile(600) — but we still open both
  // user presses "chat" from profile, both can be open simultaneously — that's fine
  // since chat z-index > profile z-index. Close profile if explicitly navigating to chat.
  currentChatUser = {id_user:userId, username, foto_profil_url:avatarUrl};
  document.getElementById('cr-name').textContent = username;
  document.getElementById('cr-status').textContent = 'Online';
  const ava = document.getElementById('cr-avatar');
  ava.innerHTML = avatarUrl?`<img src="${avatarUrl}" style="width:100%;height:100%;object-fit:cover;">`:(username[0]||'?').toUpperCase();
  // Close user-profile so chat appears cleanly on top without confusion
  document.getElementById('user-profile').classList.remove('active');
  document.getElementById('chat-room').classList.add('active');
  pushRoute(`/chat/${userId}`);
  await loadMessages();
  await markMessagesRead();
}

function closeChatRoom(){
  document.getElementById('chat-room').classList.remove('active');
  currentChatUser=null;
  pushRoute('/chat');
}

// Mark received messages as read
async function markMessagesRead(){
  if(!currentUser||!currentChatUser) return;
  try {
    await SupabaseClient.update(
      'Messages_Alvaty',
      {read:true},
      `sender_id=eq.${currentChatUser.id_user}&receiver_id=eq.${currentUser.id_user}&read=eq.false`
    );
    await updateBadges();
  } catch(e){}
}

async function loadMessages(){
  if(!currentUser||!currentChatUser) return;
  const msgs = document.getElementById('cr-messages');
  try {
    const sent = await SupabaseClient.select('Messages_Alvaty',`sender_id=eq.${currentUser.id_user}&receiver_id=eq.${currentChatUser.id_user}`,'created_at.asc','100');
    const recv = await SupabaseClient.select('Messages_Alvaty',`sender_id=eq.${currentChatUser.id_user}&receiver_id=eq.${currentUser.id_user}`,'created_at.asc','100');
    const all = [...sent,...recv].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));

    msgs.innerHTML = all.map(m=>{
      const isSent = m.sender_id===currentUser.id_user;
      // Read receipt: show for sent messages
      let readStatus = '';
      if(isSent){
        readStatus = `<div class="msg-read-status ${m.read?'read':''}">
          <i class="fa fa-check-double"></i>
          ${m.read?'<span style="font-size:0.6rem;">Dilihat</span>':''}
        </div>`;
      }
      return `<div class="chat-msg ${isSent?'sent':'received'}" id="msg-${m.id_message}">
        ${m.reply_to?`<div style="font-size:0.75rem;color:var(--text3);margin-bottom:3px;padding:3px 8px;background:var(--bg4);border-radius:8px;border-left:2px solid var(--accent);">↩ Balasan pesan</div>`:''}
        ${m.media_url?`<img class="msg-img" src="${m.media_url}" onclick="window.open('${m.media_url}')">`:
          `<div class="msg-bubble">${m.message_text||''}</div>`}
        <div style="display:flex;gap:0.4rem;align-items:center;">
          <span class="msg-time">${timeAgo(m.created_at)}</span>
          ${!isSent?`<button onclick="setReply('${m.id_message}','${(m.message_text||'').replace(/'/g,'&#39;')}')" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:0.7rem;padding:0;">↩ Balas</button>`:''}
          ${readStatus}
        </div>
      </div>`;
    }).join('');
    msgs.scrollTop = msgs.scrollHeight;
  } catch(e){}
}

function setReply(id, text){
  currentReplyMsg = id;
  document.getElementById('reply-bar').classList.add('active');
  document.getElementById('reply-preview').textContent = text.substring(0,50)+(text.length>50?'...':'');
  document.getElementById('cr-input').focus();
}
function cancelReply(){ currentReplyMsg=null; document.getElementById('reply-bar').classList.remove('active'); }

async function sendMessage(){
  const input = document.getElementById('cr-input');
  const text = input.value.trim();
  if(!text||!currentChatUser||!currentUser) return;
  input.value='';
  cancelReply();
  try {
    await SupabaseClient.insert('Messages_Alvaty',{sender_id:currentUser.id_user,receiver_id:currentChatUser.id_user,message_text:text,reply_to:currentReplyMsg||null,read:false});
    await addNotification(currentChatUser.id_user,'message',currentUser.id_user);
    await loadMessages();
  } catch(e){ showToast('Gagal kirim pesan','error'); }
}

async function sendChatImage(input){
  const file = input.files[0]; if(!file) return;
  try {
    const path = `chat/${Date.now()}_${file.name}`;
    const url = await SupabaseClient.upload('altavy-media', path, file);
    await SupabaseClient.insert('Messages_Alvaty',{sender_id:currentUser.id_user,receiver_id:currentChatUser.id_user,message_text:'',media_url:url,read:false});
    await loadMessages();
  } catch(e){ showToast('Gagal kirim gambar','error'); }
  input.value='';
}

// ==================== NOTIFICATIONS ====================
async function loadNotifications(){
  if(!currentUser) return;
  const list = document.getElementById('notif-list');
  try {
    const notifs = await SupabaseClient.select('Notifications_Alvaty',`user_id=eq.${currentUser.id_user}`,'created_at.desc','30');
    if(!notifs.length){ list.innerHTML='<div class="empty-state"><i class="fa fa-bell"></i><p>Belum ada notifikasi</p></div>'; return; }
    const icons = {like:'<i class="fa fa-heart" style="color:#fff;"></i>',comment:'<i class="fa fa-comment" style="color:#fff;"></i>',follow:'<i class="fa fa-user-plus" style="color:#fff;"></i>',message:'<i class="fa fa-comment-dots" style="color:#fff;"></i>',story:'<i class="fa fa-circle" style="color:#fff;"></i>'};
    const labels = {like:'menyukai postingan kamu',comment:'mengomentari postingan kamu',follow:'mulai mengikuti kamu',message:'mengirim pesan baru',story:'melihat story kamu'};
    const iconClass = {like:'like',comment:'comment',follow:'follow',message:'comment',story:'story'};
    list.innerHTML = notifs.map(n=>{
      const type = n.type_notification;
      const isUnread = !n.status_dibaca;
      return `<div class="notif-item ${isUnread?'unread':''}" id="notif-${n.id_notification}">
        <div style="display:flex;flex-direction:column;">
          <div class="notif-avatar" style="background:var(--bg3);">${'?'}</div>
          <div class="notif-icon ${iconClass[type]||'comment'}">${icons[type]||'🔔'}</div>
        </div>
        <div class="notif-text">
          <strong>Pengguna</strong> ${labels[type]||type}
          <div class="notif-time">${timeAgo(n.created_at)}</div>
        </div>
        ${isUnread?'<div class="notif-read-dot" title="Belum dibaca"></div>':'<i class="fa fa-check-double" style="color:var(--accent);font-size:0.75rem;" title="Sudah dibaca"></i>'}
      </div>`;
    }).join('');
    for(const n of notifs){
      try {
        if(n.target_id){
          const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${n.target_id}`,'created_at.asc','1');
          if(u[0]){
            const el = document.getElementById('notif-'+n.id_notification);
            if(el){
              el.querySelector('.notif-avatar').innerHTML = avatarEl(u[0],42);
              el.querySelector('.notif-text strong').textContent = u[0].username;
            }
          }
        }
      } catch(e){}
    }
    const unread = notifs.filter(n=>!n.status_dibaca).length;
    const badge = document.getElementById('notif-badge');
    const sideBadge = document.getElementById('sidebar-notif-badge');
    if(badge){ badge.textContent=unread; badge.style.display=unread>0?'flex':'none'; }
    if(sideBadge){ sideBadge.textContent=unread; sideBadge.style.display=unread>0?'flex':'none'; }
  } catch(e){}
}

async function markNotifsRead(){
  if(!currentUser) return;
  try {
    await SupabaseClient.update('Notifications_Alvaty',{status_dibaca:true},`user_id=eq.${currentUser.id_user}&status_dibaca=eq.false`);
    const badge = document.getElementById('notif-badge');
    const sideBadge = document.getElementById('sidebar-notif-badge');
    if(badge) badge.style.display='none';
    if(sideBadge) sideBadge.style.display='none';
    // Update notif items UI to show read
    document.querySelectorAll('.notif-item.unread').forEach(el=>{
      el.classList.remove('unread');
      const dot = el.querySelector('.notif-read-dot');
      if(dot) dot.outerHTML='<i class="fa fa-check-double" style="color:var(--accent);font-size:0.75rem;" title="Sudah dibaca"></i>';
    });
  } catch(e){}
}

async function addNotification(userId, type, targetId){
  if(!userId||userId===currentUser?.id_user) return;
  try {
    await SupabaseClient.insert('Notifications_Alvaty',{user_id:userId,type_notification:type,target_id:targetId,status_dibaca:false});
  } catch(e){}
}

// ==================== PROFILE ====================
async function renderMyProfile(){
  if(!currentUser) return;
  const content = document.getElementById('my-profile-content');
  content.innerHTML = '<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${currentUser.id_user}`,'created_at.asc','1');
    const user = u[0]||currentUser;
    currentUser = {...currentUser,...user};
    localStorage.setItem('altavy_user', JSON.stringify(currentUser));
    const posts = await SupabaseClient.select('Posts_Alvaty',`user_id=eq.${currentUser.id_user}`,'created_at.desc','50');
    const reels = await SupabaseClient.select('Reels_Alvaty',`user_id=eq.${currentUser.id_user}`,'created_at.desc','50');
    const followers = await SupabaseClient.select('Followers_Alvaty',`following_id=eq.${currentUser.id_user}`,'created_at.asc','1000');
    const following = await SupabaseClient.select('Followers_Alvaty',`follower_id=eq.${currentUser.id_user}`,'created_at.asc','1000');
    const saved = await SupabaseClient.select('Likes_Alvaty',`user_id=eq.${currentUser.id_user}&type_target=eq.save_post`,'created_at.desc','50');
    content.innerHTML = renderProfileHTML(user, posts, reels, followers, following, saved, true);
    pushRoute(`/profile`);
  } catch(e){ content.innerHTML='<div class="empty-state"><i class="fa fa-user"></i><p>Gagal memuat profil</p></div>'; }
}

function renderProfileHTML(user, posts, reels, followers, following, saved, isOwn){
  const uid = user.id_user;
  return `
  <div class="profile-header">
    <div class="profile-top">
      <div class="profile-pic">${user.foto_profil_url?`<img src="${user.foto_profil_url}" style="width:100%;height:100%;object-fit:cover;">`:(user.username||'?')[0].toUpperCase()}</div>
      <div class="profile-stats">
        <div class="stat-item"><div class="stat-num">${posts.length}</div><div class="stat-label">Postingan</div></div>
        <div class="stat-item"><div class="stat-num">${followers.length}</div><div class="stat-label">Followers</div></div>
        <div class="stat-item"><div class="stat-num">${following.length}</div><div class="stat-label">Following</div></div>
      </div>
    </div>
    <div class="profile-bio-area">
      <div class="profile-username">${user.username||''}</div>
      <div class="profile-bio">${user.bio||'Belum ada bio.'}</div>
    </div>
    <div class="profile-actions">
      ${isOwn
        ? `<button class="btn-outline" onclick="openEditProfile()"><i class="fa fa-edit"></i> Edit Profil</button>`
        : `<button class="btn-follow" id="follow-btn-${uid}" onclick="toggleFollow('${uid}')">Ikuti</button>
           <button class="btn-outline" onclick="openChatRoom('${uid}','${user.username}','${user.foto_profil_url||''}')"><i class="fa fa-comment"></i></button>`
      }
    </div>
  </div>
  <div class="profile-tabs" id="profile-tabs-${uid}">
    <div class="profile-tab active" onclick="switchProfileTab('posts','${uid}',this)"><i class="fa fa-th"></i></div>
    <div class="profile-tab" onclick="switchProfileTab('reels','${uid}',this)"><i class="fa fa-film"></i></div>
    ${isOwn?`<div class="profile-tab" onclick="switchProfileTab('saved','${uid}',this)"><i class="fa fa-bookmark"></i></div>`:''}
  </div>
  <div class="profile-tab-content active" id="ptc-posts-${uid}">
    ${posts.length ? `<div class="post-grid">${posts.map(p=>`
      <div class="post-thumb" onclick="openPostDetail('${p.id_post}')">
        ${p.media_type==='video'
          ?`<video src="${p.media_url}" style="width:100%;height:100%;object-fit:cover;" muted></video><div class="video-badge"><i class="fa fa-video"></i></div>`
          :`<img src="${p.media_url}" loading="lazy" alt="post">`}
      </div>`).join('')}</div>`
    : '<div class="empty-state"><i class="fa fa-camera"></i><p>Belum ada postingan</p></div>'}
  </div>
  <div class="profile-tab-content" id="ptc-reels-${uid}">
    ${reels.length ? `<div class="post-grid">${reels.map(r=>`
      <div class="post-thumb" onclick="openReelById('${r.id_reel}')">
        <video src="${r.video_url}" style="width:100%;height:100%;object-fit:cover;" muted></video>
        <div class="video-badge"><i class="fa fa-film"></i></div>
      </div>`).join('')}</div>`
    : '<div class="empty-state"><i class="fa fa-film"></i><p>Belum ada reels</p></div>'}
  </div>
  ${isOwn?`<div class="profile-tab-content" id="ptc-saved-${uid}">
    ${saved.length ? '<div class="empty-state"><i class="fa fa-bookmark"></i><p>'+saved.length+' item tersimpan</p></div>' : '<div class="empty-state"><i class="fa fa-bookmark"></i><p>Belum ada yang disimpan</p></div>'}
  </div>`:''}`;
}

// FIX: switchProfileTab - safely traverse DOM
function switchProfileTab(tab, uid, el){
  // Find the tabs container by id, not via parentElement chain
  const tabsContainer = document.getElementById(`profile-tabs-${uid}`);
  if(tabsContainer){
    tabsContainer.querySelectorAll('.profile-tab').forEach(t=>t.classList.remove('active'));
  }
  el.classList.add('active');
  document.querySelectorAll(`[id^="ptc-"][id$="-${uid}"]`).forEach(c=>c.classList.remove('active'));
  const target = document.getElementById(`ptc-${tab}-${uid}`);
  if(target) target.classList.add('active');
}

async function openUserProfile(userId, username){
  if(currentUser&&userId===currentUser.id_user){ switchTab('profile',document.getElementById('nav-profile')); return; }
  pushRoute(`/profile/${username}`);
  const up = document.getElementById('user-profile');
  up.classList.add('active');
  document.getElementById('up-username').textContent = '@'+username;
  const content = document.getElementById('up-content');
  content.innerHTML='<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${userId}`,'created_at.asc','1');
    const user = u[0]||{username,id_user:userId};
    const posts = await SupabaseClient.select('Posts_Alvaty',`user_id=eq.${userId}`,'created_at.desc','50');
    const reels = await SupabaseClient.select('Reels_Alvaty',`user_id=eq.${userId}`,'created_at.desc','50');
    const followers = await SupabaseClient.select('Followers_Alvaty',`following_id=eq.${userId}`,'created_at.asc','1000');
    const following = await SupabaseClient.select('Followers_Alvaty',`follower_id=eq.${userId}`,'created_at.asc','1000');
    content.innerHTML = renderProfileHTML(user, posts, reels, followers, following, [], false);
    if(currentUser){
      const isFollow = await SupabaseClient.select('Followers_Alvaty',`follower_id=eq.${currentUser.id_user}&following_id=eq.${userId}`,'created_at.asc','1');
      const fbtn = document.getElementById(`follow-btn-${userId}`);
      if(fbtn&&isFollow.length){ fbtn.textContent='Mengikuti'; fbtn.classList.add('btn-following'); }
    }
  } catch(e){ content.innerHTML='<div class="empty-state"><i class="fa fa-user"></i><p>Gagal memuat profil</p></div>'; }
}

function closeUserProfile(){ document.getElementById('user-profile').classList.remove('active'); }

async function toggleFollow(userId){
  if(!currentUser) return;
  const btn = document.getElementById('follow-btn-'+userId);
  try {
    const ex = await SupabaseClient.select('Followers_Alvaty',`follower_id=eq.${currentUser.id_user}&following_id=eq.${userId}`,'created_at.asc','1');
    if(ex.length){ await SupabaseClient.delete('Followers_Alvaty',`id_follow=eq.${ex[0].id_follow}`); btn.textContent='Ikuti'; btn.classList.remove('btn-following'); }
    else {
      await SupabaseClient.insert('Followers_Alvaty',{follower_id:currentUser.id_user,following_id:userId});
      await addNotification(userId,'follow',currentUser.id_user);
      btn.textContent='Mengikuti'; btn.classList.add('btn-following');
    }
  } catch(e){}
}

// ==================== POST DETAIL ====================
async function openPostDetail(postId){
  currentPostId = postId;
  pushRoute(`/post/${postId}`);
  document.getElementById('post-detail').classList.add('active');
  const content = document.getElementById('pd-content');
  content.innerHTML='<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const posts = await SupabaseClient.select('Posts_Alvaty',`id_post=eq.${postId}`,'created_at.asc','1');
    const post = posts[0]; if(!post) return;
    const u = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${post.user_id}`,'created_at.asc','1');
    const user = u[0]||{username:'?'};
    const comments = await SupabaseClient.select('Comments_Alvaty',`post_id=eq.${postId}`,'created_at.asc','100');
    const commentUsers = {};
    for(const c of comments){
      if(!commentUsers[c.user_id]){
        const cu = await SupabaseClient.select('Users_Alvaty',`id_user=eq.${c.user_id}`,'created_at.asc','1');
        if(cu[0]) commentUsers[c.user_id]=cu[0];
      }
    }
    const isVideo = post.media_type==='video';
    content.innerHTML = `
      <div class="post-header">
        <div class="post-avatar" onclick="openUserProfile('${user.id_user}','${user.username}')">${avatarEl(user,38)}</div>
        <div class="post-info">
          <div class="post-username" onclick="openUserProfile('${user.id_user}','${user.username}')">${user.username}</div>
          <div class="post-time">${timeAgo(post.created_at)}</div>
        </div>
      </div>
      ${post.media_url?`<div class="post-media-wrap">${isVideo?`<video src="${post.media_url}" controls style="width:100%;max-height:400px;object-fit:cover;display:block;"></video>`:`<img class="post-media" src="${post.media_url}" alt="post">`}</div>`:''}
      <div class="post-actions">
        <button class="post-action-btn" id="like-btn-${postId}" onclick="toggleLike('${postId}','post')">
          <i class="fa fa-heart"></i><span id="like-count-${postId}">0</span>
        </button>
        <button class="post-action-btn" id="save-btn-${postId}" onclick="toggleSave('${postId}','post')">
          <i class="fa fa-bookmark"></i>
        </button>
      </div>
      ${post.caption?`<div class="post-caption"><strong>${user.username}</strong> ${post.caption}</div>`:''}
      <div class="comments-section">
        <div style="font-weight:700;font-size:0.9rem;margin-bottom:1rem;color:var(--text2);">Komentar (${comments.length})</div>
        ${comments.map(c=>{
          const cu = commentUsers[c.user_id]||{username:'?',foto_profil_url:''};
          return `<div class="comment-item">
            <div class="comment-avatar">${avatarEl(cu,32)}</div>
            <div class="comment-body">
              <span class="comment-user">${cu.username}</span>
              <div class="comment-text">${c.isi_komentar}</div>
              <div class="comment-actions">
                <button class="comment-action" onclick="likeComment('${c.id_komentar}')"><i class="fa fa-heart"></i> Suka</button>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    loadPostCounts(postId);
  } catch(e){ content.innerHTML='<div class="empty-state"><i class="fa fa-exclamation"></i><p>Gagal memuat</p></div>'; }
}

function closePostDetail(){ document.getElementById('post-detail').classList.remove('active'); currentPostId=null; }

async function submitComment(){
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if(!text||!currentPostId||!currentUser) return;
  input.value='';
  try {
    await SupabaseClient.insert('Comments_Alvaty',{post_id:currentPostId,user_id:currentUser.id_user,isi_komentar:text});
    await openPostDetail(currentPostId);
  } catch(e){ showToast('Gagal kirim komentar','error'); }
}

function likeComment(cid){ showToast('Komentar disukai','success'); }

// ==================== SETTINGS / PROFILE EDIT ====================
function openSettings(){ document.getElementById('settings-page').classList.add('active'); }
function closeSettings(){ document.getElementById('settings-page').classList.remove('active'); }
function openEditProfile(){ document.getElementById('edit-bio').value=currentUser?.bio||''; openModal('modal-edit-profile'); }
function openEditUsername(){ document.getElementById('new-username').value=currentUser?.username||''; openModal('modal-edit-username'); }
function openEditPassword(){ openModal('modal-edit-password'); }
function openAddStory(){ openModal('modal-add-story'); }
function openFeedback(){ openModal('modal-feedback'); }

function previewPostFile(input){
  const file=input.files[0]; if(!file) return;
  const prev=document.getElementById('post-preview');
  prev.style.display='block';
  const isVideo=file.type.startsWith('video');
  const url=URL.createObjectURL(file);
  prev.innerHTML=isVideo?`<video src="${url}" controls style="width:100%;max-height:250px;object-fit:cover;display:block;"></video>`:`<img src="${url}" style="width:100%;max-height:250px;object-fit:cover;display:block;">`;
  document.getElementById('post-upload-zone').style.display='none';
}

function previewReelFile(input){
  const file=input.files[0]; if(!file) return;
  const prev=document.getElementById('reel-preview');
  prev.style.display='block';
  prev.innerHTML=`<video src="${URL.createObjectURL(file)}" controls style="width:100%;max-height:250px;object-fit:cover;display:block;"></video>`;
}

function previewStoryFile(input){
  const file=input.files[0]; if(!file) return;
  const prev=document.getElementById('story-preview');
  prev.style.display='block';
  const isVideo=file.type.startsWith('video');
  const url=URL.createObjectURL(file);
  prev.innerHTML=isVideo?`<video src="${url}" controls style="width:100%;max-height:250px;"></video>`:`<img src="${url}" style="width:100%;max-height:250px;object-fit:cover;">`;
}

function previewProfilePic(input){
  const file=input.files[0]; if(!file) return;
  const url=URL.createObjectURL(file);
  document.getElementById('profile-pic-preview').style.display='block';
  document.getElementById('profile-preview-img').src=url;
}

async function submitPost(){
  const file=document.getElementById('post-file').files[0];
  const caption=document.getElementById('post-caption').value.trim();
  if(!file){showToast('Pilih foto atau video terlebih dahulu','error');return;}
  try {
    const path=`posts/${currentUser.id_user}/${Date.now()}_${file.name}`;
    const url=await SupabaseClient.upload('altavy-media',path,file);
    const isVideo=file.type.startsWith('video');
    await SupabaseClient.insert('Posts_Alvaty',{user_id:currentUser.id_user,media_url:url,media_type:isVideo?'video':'image',caption});
    closeModal('modal-create-post');
    document.getElementById('post-caption').value='';
    document.getElementById('post-preview').style.display='none';
    document.getElementById('post-upload-zone').style.display='block';
    showToast('Postingan berhasil dibuat','success');
    loadFeed();
  } catch(e){showToast('Gagal posting: '+e.message,'error');}
}

async function submitReel(){
  const file=document.getElementById('reel-file').files[0];
  const caption=document.getElementById('reel-caption').value.trim();
  if(!file){showToast('Pilih video terlebih dahulu','error');return;}
  try {
    const path=`reels/${currentUser.id_user}/${Date.now()}_${file.name}`;
    const url=await SupabaseClient.upload('altavy-media',path,file);
    await SupabaseClient.insert('Reels_Alvaty',{user_id:currentUser.id_user,video_url:url,caption});
    closeModal('modal-create-reel');
    document.getElementById('reel-caption').value='';
    document.getElementById('reel-preview').style.display='none';
    showToast('Reels berhasil diupload','success');
    loadReels();
  } catch(e){showToast('Gagal upload reels: '+e.message,'error');}
}

async function submitStory(){
  const file=document.getElementById('story-file').files[0];
  if(!file){showToast('Pilih foto atau video terlebih dahulu','error');return;}
  try {
    const path=`stories/${currentUser.id_user}/${Date.now()}_${file.name}`;
    const url=await SupabaseClient.upload('altavy-media',path,file);
    const expired=new Date(Date.now()+24*60*60*1000).toISOString();
    await SupabaseClient.insert('Stories_Alvaty',{user_id:currentUser.id_user,media_url:url,expired_at:expired});
    closeModal('modal-add-story');
    document.getElementById('story-preview').style.display='none';
    showToast('Story berhasil dibagikan','success');
    loadStories();
  } catch(e){showToast('Gagal upload story: '+e.message,'error');}
}

async function saveProfile(){
  const bio=document.getElementById('edit-bio').value.trim();
  const file=document.getElementById('profile-file').files[0];
  let photoUrl=currentUser.foto_profil_url||'';
  try {
    if(file){
      const path=`profiles/${currentUser.id_user}/${Date.now()}_${file.name}`;
      photoUrl=await SupabaseClient.upload('altavy-media',path,file);
    }
    await SupabaseClient.update('Users_Alvaty',{bio,foto_profil_url:photoUrl},`id_user=eq.${currentUser.id_user}`);
    currentUser.bio=bio; currentUser.foto_profil_url=photoUrl;
    localStorage.setItem('altavy_user',JSON.stringify(currentUser));
    closeModal('modal-edit-profile'); showToast('Profil diperbarui','success'); renderMyProfile();
  } catch(e){ showToast('Gagal update profil: '+e.message,'error'); }
}

async function saveUsername(){
  const u=document.getElementById('new-username').value.trim();
  const err=document.getElementById('username-error');
  err.classList.remove('show');
  if(!u||!/^[a-zA-Z0-9_]{3,20}$/.test(u)){err.textContent='Username tidak valid (3-20 karakter).';err.classList.add('show');return;}
  try {
    const ex=await SupabaseClient.select('Users_Alvaty',`username=eq.${encodeURIComponent(u)}`,'created_at.asc','1');
    if(ex.length&&ex[0].id_user!==currentUser.id_user){err.textContent='Username sudah dipakai.';err.classList.add('show');return;}
    await SupabaseClient.update('Users_Alvaty',{username:u},`id_user=eq.${currentUser.id_user}`);
    currentUser.username=u; localStorage.setItem('altavy_user',JSON.stringify(currentUser));
    closeModal('modal-edit-username'); showToast('Username diperbarui','success');
  } catch(e){err.textContent='Gagal.';err.classList.add('show');}
}

async function savePassword(){
  const old=document.getElementById('old-password').value;
  const newp=document.getElementById('new-password').value;
  const err=document.getElementById('password-error');
  err.classList.remove('show');
  if(!old||!newp){err.textContent='Isi semua field.';err.classList.add('show');return;}
  if(newp.length<6){err.textContent='Password minimal 6 karakter.';err.classList.add('show');return;}
  try {
    const u=await SupabaseClient.select('Users_Alvaty',`id_user=eq.${currentUser.id_user}`,'created_at.asc','1');
    if(!u[0]||u[0].password_hash!==old){err.textContent='Password lama salah.';err.classList.add('show');return;}
    await SupabaseClient.update('Users_Alvaty',{password_hash:newp},`id_user=eq.${currentUser.id_user}`);
    closeModal('modal-edit-password'); showToast('Password diperbarui','success');
  } catch(e){err.textContent='Gagal.';err.classList.add('show');}
}

async function submitFeedback(){
  const text=document.getElementById('feedback-text').value.trim();
  if(!text){showToast('Tulis pesan terlebih dahulu','error');return;}
  try {
    await SupabaseClient.insert('Feedback_Alvaty',{user_id:currentUser?.id_user||null,pesan:text});
    document.getElementById('feedback-text').value='';
    closeModal('modal-feedback'); showToast('Terima kasih atas masukan kamu!','success');
  } catch(e){showToast('Gagal kirim','error');}
}

// ==================== ADMIN ====================
function adminLogout(){
  currentUser=null; localStorage.removeItem('altavy_user'); showPage('landing');
}

// ==================== MODAL HELPERS ====================
function openModal(id){ document.getElementById(id).classList.add('active'); }
function closeModal(id){ document.getElementById(id).classList.remove('active'); }

document.querySelectorAll('.modal-overlay').forEach(m=>{
  m.addEventListener('click', e=>{ if(e.target===m) m.classList.remove('active'); });
});

function openReelById(rid){
  switchTab('reels', document.getElementById('nav-reels'));
  setTimeout(()=>{ const el=document.getElementById('reel-'+rid); if(el) el.scrollIntoView({behavior:'smooth'}); },500);
}


// ==================== SEARCH ====================
let searchDebounce = null;

function openSearchPage(){
  document.getElementById('search-page').classList.add('active');
  setTimeout(()=>document.getElementById('search-input')?.focus(), 150);
  loadAllUsersPreview();
}

function closeSearchPage(){
  document.getElementById('search-page').classList.remove('active');
  document.getElementById('search-input').value = '';
  document.getElementById('search-results-users').innerHTML = '';
  document.getElementById('search-results-posts').innerHTML = '';
}

async function loadAllUsersPreview(){
  try {
    const users = await SupabaseClient.select('Users_Alvaty','','username.asc','20');
    renderUserSearchResults(users.filter(u=>u.id_user!==currentUser?.id_user));
  } catch(e){}
}

function handleSearch(q){
  clearTimeout(searchDebounce);
  if(!q.trim()){
    loadAllUsersPreview();
    document.getElementById('search-results-posts').innerHTML = '';
    return;
  }
  searchDebounce = setTimeout(()=>doSearch(q.trim()), 300);
}

async function doSearch(q){
  try {
    // Search users
    const users = await SupabaseClient.select('Users_Alvaty',`username=ilike.*${q}*`,'username.asc','15');
    renderUserSearchResults(users.filter(u=>u.id_user!==currentUser?.id_user));
    // Search posts by caption
    const posts = await SupabaseClient.select('Posts_Alvaty',`caption=ilike.*${q}*`,'created_at.desc','12');
    renderPostSearchResults(posts);
  } catch(e){}
}

async function searchByTag(tag){
  document.getElementById('search-input').value = '#'+tag;
  const posts = await SupabaseClient.select('Posts_Alvaty',`caption=ilike.*${tag}*`,'created_at.desc','12');
  renderPostSearchResults(posts);
  document.getElementById('search-results-users').innerHTML = '';
}

async function renderUserSearchResults(users){
  const wrap = document.getElementById('search-results-users');
  if(!users.length){
    wrap.innerHTML = '<div class="empty-state" style="padding:1.5rem;"><i class="fa fa-user-slash"></i><p>Tidak ada pengguna ditemukan</p></div>';
    return;
  }
  // Check follow status
  let followedIds = new Set();
  if(currentUser){
    try {
      const following = await SupabaseClient.select('Followers_Alvaty',`follower_id=eq.${currentUser.id_user}`,'created_at.asc','500');
      following.forEach(f=>followedIds.add(f.following_id));
    } catch(e){}
  }
  wrap.innerHTML = users.map(u=>{
    const isFollowing = followedIds.has(u.id_user);
    return `<div class="search-user-item" onclick="openUserProfileFromSearch('${u.id_user}','${u.username}')">
      <div style="flex-shrink:0;">${avatarEl(u,44)}</div>
      <div style="flex:1;min-width:0;">
        <div class="search-user-name">${u.username}</div>
        <div class="search-user-bio">${u.bio||'Belum ada bio'}</div>
      </div>
      ${currentUser&&u.id_user!==currentUser.id_user?`<button class="search-user-follow ${isFollowing?'following':''}" onclick="event.stopPropagation();toggleFollowSearch('${u.id_user}',this)">${isFollowing?'Mengikuti':'Ikuti'}</button>`:''}
    </div>`;
  }).join('');
}

function renderPostSearchResults(posts){
  const wrap = document.getElementById('search-results-posts');
  const label = document.getElementById('search-posts-label');
  if(!posts.length){ wrap.innerHTML=''; if(label) label.style.display='none'; return; }
  if(label) label.style.display='block';
  wrap.innerHTML = posts.map(p=>`
    <div class="post-thumb" onclick="closeSearchPage();openPostDetail('${p.id_post}')">
      ${p.media_type==='video'
        ?`<video src="${p.media_url}" style="width:100%;height:100%;object-fit:cover;" muted></video><div class="video-badge"><i class="fa fa-video"></i></div>`
        :`<img src="${p.media_url}" loading="lazy" alt="post">`}
    </div>`).join('');
}

function openUserProfileFromSearch(userId, username){
  closeSearchPage();
  openUserProfile(userId, username);
}

async function toggleFollowSearch(userId, btn){
  if(!currentUser) return;
  const isFollowing = btn.classList.contains('following');
  try {
    if(isFollowing){
      const ex = await SupabaseClient.select('Followers_Alvaty',`follower_id=eq.${currentUser.id_user}&following_id=eq.${userId}`,'created_at.asc','1');
      if(ex.length) await SupabaseClient.delete('Followers_Alvaty',`id_follow=eq.${ex[0].id_follow}`);
      btn.textContent='Ikuti'; btn.classList.remove('following');
    } else {
      await SupabaseClient.insert('Followers_Alvaty',{follower_id:currentUser.id_user,following_id:userId});
      await addNotification(userId,'follow',currentUser.id_user);
      btn.textContent='Mengikuti'; btn.classList.add('following');
    }
  } catch(e){ showToast('Gagal','error'); }
}

// ==================== ADMIN ENHANCED ====================
async function loadAdminDashboard(){
  const content=document.getElementById('admin-content');
  content.innerHTML='<div class="loading-wrap"><div class="spinner"></div></div>';
  try {
    const [users,posts,reels,stories,comments,msgs,feedbacks,likes]=await Promise.all([
      SupabaseClient.select('Users_Alvaty','','created_at.desc','1000'),
      SupabaseClient.select('Posts_Alvaty','','created_at.desc','1000'),
      SupabaseClient.select('Reels_Alvaty','','created_at.desc','1000'),
      SupabaseClient.select('Stories_Alvaty','','created_at.desc','1000'),
      SupabaseClient.select('Comments_Alvaty','','created_at.desc','1000'),
      SupabaseClient.select('Messages_Alvaty','','created_at.desc','1000'),
      SupabaseClient.select('Feedback_Alvaty','','created_at.desc','100'),
      SupabaseClient.select('Likes_Alvaty','','created_at.desc','1000'),
    ]);

    // --- Compute stats ---
    const now = Date.now();
    const day = 86400000;
    const usersToday = users.filter(u=>now-new Date(u.created_at)<day).length;
    const postsToday = posts.filter(p=>now-new Date(p.created_at)<day).length;
    const msgsToday = msgs.filter(m=>now-new Date(m.created_at)<day).length;
    const likesToday = likes.filter(l=>now-new Date(l.created_at)<day).length;

    // Activity by hour (last 24h)
    const hourBuckets = Array(24).fill(0);
    posts.filter(p=>now-new Date(p.created_at)<day*1).forEach(p=>{
      const h = new Date(p.created_at).getHours();
      hourBuckets[h]++;
    });

    // Content type breakdown
    const imgPosts = posts.filter(p=>p.media_type!=='video').length;
    const vidPosts = posts.filter(p=>p.media_type==='video').length;
    const maxHour = Math.max(...hourBuckets,1);

    // Top 5 users by post count
    const userPostCount = {};
    posts.forEach(p=>{ userPostCount[p.user_id]=(userPostCount[p.user_id]||0)+1; });
    const topUsers = Object.entries(userPostCount).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topUserNames = {};
    for(const [uid] of topUsers){
      const u = users.find(x=>x.id_user===uid);
      topUserNames[uid] = u?.username||uid.substring(0,8);
    }
    const maxPosts = topUsers[0]?.[1]||1;

    // Recent activity feed
    const allActivity = [
      ...users.slice(0,5).map(u=>({type:'user',text:`@${u.username} mendaftar`,time:u.created_at,color:'green'})),
      ...posts.slice(0,5).map(p=>({type:'post',text:`Postingan baru dibuat`,time:p.created_at,color:'blue'})),
      ...msgs.slice(0,4).map(m=>({type:'msg',text:`Pesan baru dikirim`,time:m.created_at,color:'yellow'})),
      ...likes.slice(0,4).map(l=>({type:'like',text:`Like baru`,time:l.created_at,color:'red'})),
    ].sort((a,b)=>new Date(b.time)-new Date(a.time)).slice(0,15);

    content.innerHTML=`
    <!-- Admin Tabs -->
    <div class="admin-tabs">
      <button class="admin-tab-btn active" onclick="switchAdminTab('overview',this)">Overview</button>
      <button class="admin-tab-btn" onclick="switchAdminTab('users',this)">Pengguna</button>
      <button class="admin-tab-btn" onclick="switchAdminTab('content',this)">Konten</button>
      <button class="admin-tab-btn" onclick="switchAdminTab('feedback',this)">Saran</button>
    </div>

    <!-- OVERVIEW TAB -->
    <div class="admin-tab-panel active" id="admin-tab-overview">
      <!-- KPI Cards -->
      <div class="admin-kpi-grid">
        <div class="kpi-card"><div class="kpi-num">${users.length}</div><div class="kpi-label">Total Pengguna</div><div class="kpi-trend up">+${usersToday} hari ini</div></div>
        <div class="kpi-card"><div class="kpi-num">${posts.length}</div><div class="kpi-label">Total Postingan</div><div class="kpi-trend up">+${postsToday} hari ini</div></div>
        <div class="kpi-card"><div class="kpi-num">${msgs.length}</div><div class="kpi-label">Total Pesan</div><div class="kpi-trend up">+${msgsToday} hari ini</div></div>
        <div class="kpi-card"><div class="kpi-num">${likes.length}</div><div class="kpi-label">Total Like</div><div class="kpi-trend up">+${likesToday} hari ini</div></div>
        <div class="kpi-card"><div class="kpi-num">${reels.length}</div><div class="kpi-label">Total Reels</div><div class="kpi-trend ${reels.length>0?'up':''}">Video pendek</div></div>
        <div class="kpi-card"><div class="kpi-num">${stories.length}</div><div class="kpi-label">Total Stories</div><div class="kpi-trend">Aktif & expired</div></div>
        <div class="kpi-card"><div class="kpi-num">${comments.length}</div><div class="kpi-label">Komentar</div><div class="kpi-trend">Total diskusi</div></div>
        <div class="kpi-card"><div class="kpi-num">${feedbacks.length}</div><div class="kpi-label">Feedback</div><div class="kpi-trend">Masukan pengguna</div></div>
      </div>

      <!-- Chart: Post activity by hour -->
      <div class="admin-chart-wrap">
        <div class="admin-chart-title"><i class="fa fa-chart-bar" style="color:var(--accent);margin-right:6px;"></i>Aktivitas Postingan per Jam (24 jam terakhir)</div>
        ${hourBuckets.map((v,i)=>`
          <div class="chart-bar-row">
            <div class="chart-bar-label">${String(i).padStart(2,'0')}:00</div>
            <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${v?Math.max(4,(v/maxHour)*100):0}%"></div></div>
            <div class="chart-bar-val">${v}</div>
          </div>`).join('')}
      </div>

      <!-- Top Users Chart -->
      <div class="admin-chart-wrap">
        <div class="admin-chart-title"><i class="fa fa-trophy" style="color:var(--accent);margin-right:6px;"></i>Top 5 Pengguna Paling Aktif (Postingan)</div>
        ${topUsers.map(([uid,count])=>`
          <div class="chart-bar-row">
            <div class="chart-bar-label" style="font-weight:600;color:var(--text);">@${topUserNames[uid]}</div>
            <div class="chart-bar-track"><div class="chart-bar-fill" style="width:${Math.max(4,(count/maxPosts)*100)}%;background:linear-gradient(90deg,var(--accent2),#60ef90)"></div></div>
            <div class="chart-bar-val">${count}</div>
          </div>`).join('')}
        ${topUsers.length===0?'<div class="empty-state" style="padding:1rem;"><p>Belum ada data</p></div>':''}
      </div>

      <!-- Content breakdown + Activity -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
        <div class="admin-chart-wrap" style="margin-bottom:0;">
          <div class="admin-chart-title"><i class="fa fa-pie-chart" style="color:var(--accent);margin-right:6px;"></i>Tipe Konten</div>
          <div class="donut-wrap">
            <svg class="donut-svg" width="80" height="80" viewBox="0 0 80 80">
              ${(() => {
                const total = imgPosts+vidPosts||1;
                const imgAngle = (imgPosts/total)*360;
                const r=28, cx=40, cy=40;
                function arc(startDeg,endDeg,color){
                  const s=startDeg*Math.PI/180, e=endDeg*Math.PI/180;
                  const x1=cx+r*Math.cos(s-Math.PI/2), y1=cy+r*Math.sin(s-Math.PI/2);
                  const x2=cx+r*Math.cos(e-Math.PI/2), y2=cy+r*Math.sin(e-Math.PI/2);
                  const large=endDeg-startDeg>180?1:0;
                  return `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} Z" fill="${color}"/>`;
                }
                if(imgPosts===0) return `<circle cx="40" cy="40" r="28" fill="#3b82f6"/>`;
                if(vidPosts===0) return `<circle cx="40" cy="40" r="28" fill="var(--accent)"/>`;
                return arc(0,imgAngle,'var(--accent)')+arc(imgAngle,360,'#3b82f6');
              })()}
              <circle cx="40" cy="40" r="18" fill="var(--card)"/>
            </svg>
            <div class="donut-legend">
              <div class="donut-legend-item"><div class="donut-legend-dot" style="background:var(--accent)"></div>Foto (${imgPosts})</div>
              <div class="donut-legend-item"><div class="donut-legend-dot" style="background:#3b82f6"></div>Video (${vidPosts})</div>
              <div class="donut-legend-item"><div class="donut-legend-dot" style="background:#f59e0b"></div>Reels (${reels.length})</div>
            </div>
          </div>
        </div>
        <div class="admin-chart-wrap" style="margin-bottom:0;">
          <div class="admin-chart-title"><i class="fa fa-bolt" style="color:var(--accent);margin-right:6px;"></i>Aktivitas Terbaru</div>
          <div class="activity-feed">
            ${allActivity.map(a=>`
              <div class="activity-item">
                <div class="activity-dot ${a.color}"></div>
                <div class="activity-text">${a.text}</div>
                <div class="activity-time">${timeAgo(a.time)}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>

    <!-- USERS TAB -->
    <div class="admin-tab-panel" id="admin-tab-users">
      <div class="admin-section">
        <div class="admin-section-header"><div class="admin-section-title">Data Pengguna (${users.length})</div></div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>#</th><th>Username</th><th>Password</th><th>Bio</th><th>Daftar</th><th>Aksi</th></tr></thead>
            <tbody>${users.map((u,i)=>`<tr>
              <td>${i+1}</td>
              <td><strong>${u.username}</strong></td>
              <td><code style="font-size:0.78rem;background:var(--bg3);padding:2px 6px;border-radius:4px;">${u.password_hash}</code></td>
              <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${u.bio||'-'}</td>
              <td>${timeAgo(u.created_at)}</td>
              <td><button onclick="adminDeleteUser('${u.id_user}','${u.username}')" style="background:#ef4444;color:#fff;border:none;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:0.75rem;">Hapus</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- CONTENT TAB -->
    <div class="admin-tab-panel" id="admin-tab-content">
      <div class="admin-section">
        <div class="admin-section-header"><div class="admin-section-title">Postingan Terbaru (${posts.length})</div></div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>ID</th><th>User ID</th><th>Caption</th><th>Tipe</th><th>Waktu</th><th>Aksi</th></tr></thead>
            <tbody>${posts.slice(0,30).map(p=>`<tr>
              <td style="font-size:0.7rem;color:var(--text3);">${p.id_post?.substring(0,8)}...</td>
              <td style="font-size:0.7rem;">${p.user_id?.substring(0,8)}...</td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.caption||'-'}</td>
              <td><span style="background:var(--accent-glow);color:var(--accent);padding:2px 8px;border-radius:50px;font-size:0.75rem;">${p.media_type||'image'}</span></td>
              <td>${timeAgo(p.created_at)}</td>
              <td><button onclick="adminDeletePost('${p.id_post}')" style="background:#ef4444;color:#fff;border:none;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:0.75rem;">Hapus</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="admin-section">
        <div class="admin-section-header"><div class="admin-section-title">Reels (${reels.length})</div></div>
        <div class="admin-table-wrap">
          <table class="admin-table">
            <thead><tr><th>ID</th><th>User ID</th><th>Caption</th><th>Waktu</th><th>Aksi</th></tr></thead>
            <tbody>${reels.slice(0,20).map(r=>`<tr>
              <td style="font-size:0.7rem;color:var(--text3);">${r.id_reel?.substring(0,8)}...</td>
              <td style="font-size:0.7rem;">${r.user_id?.substring(0,8)}...</td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${r.caption||'-'}</td>
              <td>${timeAgo(r.created_at)}</td>
              <td><button onclick="adminDeleteReel('${r.id_reel}')" style="background:#ef4444;color:#fff;border:none;padding:3px 8px;border-radius:6px;cursor:pointer;font-size:0.75rem;">Hapus</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- FEEDBACK TAB -->
    <div class="admin-tab-panel" id="admin-tab-feedback">
      <div class="admin-section">
        <div class="admin-section-header"><div class="admin-section-title">Kritik & Saran (${feedbacks.length})</div></div>
        ${feedbacks.length?feedbacks.map(f=>`<div class="feedback-item">
          <div class="feedback-user"><i class="fa fa-user"></i> ${f.user_id?f.user_id.substring(0,12)+'...':'Anonim'}</div>
          <div class="feedback-text">${f.pesan}</div>
          <div class="feedback-time">${timeAgo(f.created_at)}</div>
        </div>`).join(''):'<div class="empty-state"><i class="fa fa-comment"></i><p>Belum ada kritik & saran</p></div>'}
      </div>
    </div>`;
  } catch(e){ content.innerHTML=`<div class="empty-state"><i class="fa fa-exclamation-triangle"></i><p>Gagal memuat: ${e.message}</p></div>`; }
}

function switchAdminTab(tab, btn){
  document.querySelectorAll('.admin-tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.admin-tab-panel').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('admin-tab-'+tab)?.classList.add('active');
}

async function adminDeleteUser(uid, username){
  if(!confirm(`Hapus pengguna @${username}? Ini tidak bisa dibatalkan.`)) return;
  try {
    await SupabaseClient.delete('Users_Alvaty',`id_user=eq.${uid}`);
    showToast('Pengguna dihapus','success');
    loadAdminDashboard();
  } catch(e){ showToast('Gagal hapus pengguna','error'); }
}

async function adminDeletePost(pid){
  if(!confirm('Hapus postingan ini?')) return;
  try {
    await SupabaseClient.delete('Posts_Alvaty',`id_post=eq.${pid}`);
    showToast('Postingan dihapus','success');
    loadAdminDashboard();
  } catch(e){ showToast('Gagal hapus','error'); }
}

async function adminDeleteReel(rid){
  if(!confirm('Hapus reels ini?')) return;
  try {
    await SupabaseClient.delete('Reels_Alvaty',`id_reel=eq.${rid}`);
    showToast('Reels dihapus','success');
    loadAdminDashboard();
  } catch(e){ showToast('Gagal hapus','error'); }
}
