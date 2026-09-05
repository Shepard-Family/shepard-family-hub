const cfg = window.FAMILY_HUB_CONFIG || {};
const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes('PASTE_') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes('PASTE_');
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
let session=null, profile=null, myPerson=null, people=[], events=[], rsvps=[], prefs=null, currentView='home', authMode='signin';
const app=document.getElementById('app');

function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtDate(d,o={month:'short',day:'numeric'}){if(!d)return 'Not set';return new Date(d+'T12:00:00').toLocaleDateString('en-US',o)}
function initials(p){return `${p?.first_name?.[0]||''}${p?.last_name?.[0]||''}`.toUpperCase()||'FM'}
function formatTime(t){if(!t)return 'Time TBD';const [h,m]=t.split(':').map(Number);return new Date(2026,0,1,h,m).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}
function isAdmin(){return profile?.role==='admin'}
function birthdayNext(p){if(!p.birthday)return new Date(2999,0,1);const now=new Date(),[,m,d]=p.birthday.split('-').map(Number);let x=new Date(now.getFullYear(),m-1,d);const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());if(x<today)x=new Date(now.getFullYear()+1,m-1,d);return x}
function setNav(v){document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.go===v))}
function go(v){currentView=v;setNav(v);render();window.scrollTo({top:0,behavior:'smooth'})}
document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b)go(b.dataset.go)});

window.setAuthMode=function(mode){authMode=mode;document.getElementById('authTitle').textContent=mode==='signin'?'Sign in':'Create account';document.getElementById('nameFields').classList.toggle('hidden',mode==='signin');document.getElementById('accessCodeField').classList.toggle('hidden',mode==='signin');document.getElementById('authSubmit').textContent=mode==='signin'?'Sign in':'Create account';document.getElementById('signInTab').className=mode==='signin'?'btn':'btn secondary';document.getElementById('signUpTab').className=mode==='signup'?'btn':'btn secondary';document.getElementById('authMessage').textContent='';}

document.getElementById('authForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!configured){document.getElementById('authMessage').textContent='Setup needed: add your Supabase URL and anon key to config.js.';return}
  const email=document.getElementById('authEmail').value.trim(), password=document.getElementById('authPassword').value;
  const msg=document.getElementById('authMessage'); msg.textContent='Working…';
  if(authMode==='signup'){
    const first=document.getElementById('authFirst').value.trim(),last=document.getElementById('authLast').value.trim();
    const accessCode=document.getElementById('authAccessCode').value.trim().toUpperCase();
    if(!first||!last){msg.textContent='Enter first and last name.';return}
    if(!accessCode){msg.textContent='Enter the Family Access Code.';return}
    const check=await sb.rpc('validate_family_access_code',{p_code:accessCode});
    if(check.error){msg.textContent='Could not verify the Family Access Code. Make sure you ran access_code_update.sql in Supabase.';return}
    if(check.data!==true){msg.textContent='That Family Access Code is not valid. Check the code and try again.';return}
    const {data,error}=await sb.auth.signUp({email,password,options:{data:{first_name:first,last_name:last,family_access_code:accessCode}}});
    if(error){msg.textContent=error.message.includes('Database error')?'Account could not be created. Check the Family Access Code or Supabase setup.':error.message;return}
    msg.textContent=data.session?'Account created. Loading…':'Account created. Check your email to confirm your address, then sign in.';
    if(data.session) await bootstrap();
  }else{
    const {error}=await sb.auth.signInWithPassword({email,password});
    if(error){msg.textContent=error.message;return}
    await bootstrap();
  }
});

async function ensureProfile(){
  const uid=session.user.id, meta=session.user.user_metadata||{};
  let {data:p}=await sb.from('profiles').select('*').eq('user_id',uid).maybeSingle();
  if(!p){
    const first=meta.first_name||'',last=meta.last_name||'';
    const res=await sb.from('profiles').insert({user_id:uid,first_name:first,last_name:last,role:'member'}).select().single();
    if(res.error) throw res.error; p=res.data;
  }
  profile=p;
  let {data:person}=await sb.from('people').select('*').eq('linked_user_id',uid).maybeSingle();
  if(!person){
    const res=await sb.from('people').insert({linked_user_id:uid,created_by:uid,first_name:p.first_name||meta.first_name||'Family',last_name:p.last_name||meta.last_name||'Member',preferred_name:p.first_name||meta.first_name||'Family',person_type:'adult',email:session.user.email,approved:false}).select().single();
    if(res.error) throw res.error; person=res.data;
  }
  myPerson=person;
  let {data:pref}=await sb.from('notification_preferences').select('*').eq('user_id',uid).maybeSingle();
  if(!pref){const res=await sb.from('notification_preferences').insert({user_id:uid}).select().single(); if(!res.error)pref=res.data}
  prefs=pref;
}

async function loadData(){
  const [pr,ev,rv]=await Promise.all([
    sb.from('people').select('*').order('last_name').order('first_name'),
    sb.from('events').select('*').order('event_date'),
    sb.from('rsvps').select('*')
  ]);
  if(pr.error)throw pr.error;if(ev.error)throw ev.error;if(rv.error)throw rv.error;
  people=pr.data||[];events=ev.data||[];rsvps=rv.data||[];
  myPerson=people.find(p=>p.linked_user_id===session.user.id)||myPerson;
}

async function bootstrap(){
  if(!sb)return;
  const {data}=await sb.auth.getSession();session=data.session;
  if(!session){showAuth();return}
  try{await ensureProfile();await loadData();showApp();render();}
  catch(err){console.error(err);showAuth();document.getElementById('authMessage').textContent='Database setup is incomplete: '+err.message}
}
function showAuth(){document.getElementById('authScreen').classList.remove('hidden');document.getElementById('mainShell').classList.add('hidden')}
function showApp(){document.getElementById('authScreen').classList.add('hidden');document.getElementById('mainShell').classList.remove('hidden');document.getElementById('avatarBtn').textContent=initials(profile)}
window.refreshAll=async function(){await loadData();render();showToast('Family data refreshed')}

function render(){({home:renderHome,birthdays:renderBirthdays,events:renderEvents,family:renderFamily,profile:renderProfile,signup:renderSignup,admin:renderAdmin}[currentView]||renderHome)()}
function approvalBanner(){return myPerson&&!myPerson.approved?`<div class="setup-banner"><strong>Your account is waiting for family-admin approval.</strong><br><span class="hint">You can still add your household members. Approved directory information becomes visible to the rest of the family.</span></div>`:''}

function renderHome(){
 const upcoming=[...people].filter(p=>p.birthday&&p.approved).sort((a,b)=>birthdayNext(a)-birthdayNext(b)).slice(0,4); const next=events.find(e=>new Date(e.event_date+'T23:59:59')>=new Date())||events[0];
 app.innerHTML=`${approvalBanner()}<section class="hero"><div class="eyebrow">Private family dashboard</div><h1>Welcome, ${esc(profile.first_name||myPerson?.preferred_name||'family')}.</h1><p>This version is connected to a shared Supabase database. Changes made by one authorized family member can be seen by the others.</p><div class="hero-actions"><button class="btn secondary" data-go="signup">+ Add family member</button>${isAdmin()?'<button class="btn" data-go="admin" style="background:#f4b942;color:#26364b">Admin dashboard</button>':''}</div></section>
 <section class="section grid three"><div class="card stat"><span class="stat-icon">👨‍👩‍👧‍👦</span><div><strong>${people.filter(p=>p.approved).length}</strong><small>Approved family members</small></div></div><div class="card stat"><span class="stat-icon">🎂</span><div><strong>${upcoming.length}</strong><small>Upcoming birthdays</small></div></div><div class="card stat"><span class="stat-icon">📅</span><div><strong>${events.length}</strong><small>Family events</small></div></div></section>
 <section class="section grid two"><div class="card"><div class="section-head"><div><h2>Upcoming birthdays</h2><p>Approved family directory</p></div><button class="link-btn" data-go="birthdays">See all</button></div><div class="list">${upcoming.map(personRow).join('')||'<div class="notice">No birthdays have been added yet.</div>'}</div></div>
 <div class="card event-card">${next?eventSummary(next):'<div class="notice">No family events yet.</div>'}</div></section>`;
}
function personRow(p){return `<div class="list-item"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(p.preferred_name||p.first_name)} ${esc(p.last_name)}</strong><small>${fmtDate(p.birthday,{month:'long',day:'numeric'})} • ${esc(p.household_name||'Family')}</small></div></div>`}
function eventSummary(e){const counts=countRsvps(e.id),mine=rsvps.find(r=>r.event_id===e.id&&r.user_id===session.user.id)?.response;return `<div class="section-head"><div><h2>Next family event</h2><p>${counts.yes} going • ${counts.maybe} maybe</p></div></div><div class="eyebrow">${fmtDate(e.event_date,{weekday:'long',month:'long',day:'numeric'})}</div><h3>${esc(e.title)}</h3><div class="event-meta"><span>🕘 ${formatTime(e.event_time)}</span><span>📍 ${esc(e.location||'Location TBD')}</span></div><p class="muted">${esc(e.description||'')}</p><div class="event-footer"><span class="pill ${mine==='yes'?'green':'gold'}">Your RSVP: ${mine||'none'}</span><button class="btn small" data-go="events">View events</button></div>`}

function renderBirthdays(){const list=people.filter(p=>p.approved&&p.birthday).sort((a,b)=>{const da=new Date(a.birthday+'T12:00'),db=new Date(b.birthday+'T12:00');return da.getMonth()-db.getMonth()||da.getDate()-db.getDate()});app.innerHTML=`<div class="page-title"><h1>Birthdays 🎂</h1><p>Approved family birthdays from the shared directory.</p></div><div class="toolbar"><input id="birthdaySearch" class="search" placeholder="Search family…" oninput="filterBirthdayList(this.value)"></div><div id="birthdayList">${birthdayCards(list)}</div>`}
function birthdayCards(list){return `<div class="grid two">${list.map(p=>`<div class="card"><div class="list-item" style="padding:0;border:0"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(p.preferred_name||p.first_name)} ${esc(p.last_name)}</strong><small>${fmtDate(p.birthday,{month:'long',day:'numeric'})} • ${esc(p.household_name||'Family')}</small></div></div></div>`).join('')||'<div class="card">No birthdays found.</div>'}</div>`}
window.filterBirthdayList=q=>{q=q.toLowerCase();document.getElementById('birthdayList').innerHTML=birthdayCards(people.filter(p=>p.approved&&p.birthday&&`${p.first_name} ${p.last_name} ${p.preferred_name||''}`.toLowerCase().includes(q)))}

function countRsvps(eventId){const x=rsvps.filter(r=>r.event_id===eventId);return {yes:x.filter(r=>r.response==='yes').length,maybe:x.filter(r=>r.response==='maybe').length,no:x.filter(r=>r.response==='no').length}}
function renderEvents(){app.innerHTML=`<div class="page-title"><h1>Family Events 📅</h1><p>Shared events and live RSVPs.</p></div>${isAdmin()?'<div class="toolbar"><button class="btn" onclick="openEventForm()">+ Create event</button></div>':''}<div class="grid two">${events.map(e=>{const c=countRsvps(e.id),mine=rsvps.find(r=>r.event_id===e.id&&r.user_id===session.user.id)?.response;return `<div class="card event-card"><div class="eyebrow">${fmtDate(e.event_date,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div><h2>${esc(e.title)}</h2><div class="event-meta"><span>🕘 ${formatTime(e.event_time)}</span><span>📍 ${esc(e.location||'TBD')}</span></div><p class="muted">${esc(e.description||'')}</p><div class="event-footer"><span class="pill green">${c.yes} yes</span><span class="pill gold">${c.maybe} maybe</span><span class="pill red">${c.no} no</span></div><div class="form-actions"><button class="btn small ${mine==='yes'?'':'secondary'}" onclick="setRsvp('${e.id}','yes')">Yes</button><button class="btn small ${mine==='maybe'?'':'secondary'}" onclick="setRsvp('${e.id}','maybe')">Maybe</button><button class="btn small ${mine==='no'?'danger':'secondary'}" onclick="setRsvp('${e.id}','no')">No</button></div></div>`}).join('')||'<div class="card">No events yet.</div>'}</div>`}
window.setRsvp=async(eventId,response)=>{const {error}=await sb.from('rsvps').upsert({event_id:eventId,user_id:session.user.id,response,updated_at:new Date().toISOString()});if(error)return showToast(error.message);await loadData();renderEvents();showToast('RSVP updated')}

function renderFamily(){const approved=people.filter(p=>p.approved);const mine=people.filter(p=>p.created_by===session.user.id&&!p.approved);app.innerHTML=`<div class="page-title"><h1>Family Directory 👨‍👩‍👧‍👦</h1><p>Approved family members plus submissions you manage.</p></div><div class="toolbar"><input id="familySearch" class="search" placeholder="Search name or household…" oninput="filterFamily(this.value)"><button class="btn" data-go="signup">+ Add family</button></div>${mine.length?`<section class="section"><h2>Your pending submissions</h2><div class="grid two">${mine.map(personCard).join('')}</div></section>`:''}<div id="familyGrid" class="grid two">${approved.map(personCard).join('')||'<div class="card">No approved family records yet.</div>'}</div>`}
function personCard(p){return `<div class="card"><div class="list-item" style="padding:0;border:0"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(p.preferred_name||p.first_name)} ${esc(p.last_name)}</strong><small>${esc(p.person_type)} • ${esc(p.household_name||'No household')}</small>${p.birthday?`<small>🎂 ${fmtDate(p.birthday,{month:'long',day:'numeric'})}</small>`:''}</div>${p.approved?'<span class="pill green">Approved</span>':'<span class="pill gold">Pending</span>'}</div></div>`}
window.filterFamily=q=>{q=q.toLowerCase();document.getElementById('familyGrid').innerHTML=people.filter(p=>p.approved&&`${p.first_name} ${p.last_name} ${p.preferred_name||''} ${p.household_name||''}`.toLowerCase().includes(q)).map(personCard).join('')||'<div class="card">No matching family members.</div>'}

function renderSignup(){const adults=people.filter(p=>p.approved&&p.person_type!=='child');app.innerHTML=`<div class="page-title"><h1>Add Family Member</h1><p>Add yourself, a spouse/partner, or a child. New records require admin approval.</p></div><div class="card"><form id="personForm" class="form-grid"><div class="field"><label>First name</label><input name="first_name" required></div><div class="field"><label>Last name</label><input name="last_name" required></div><div class="field"><label>Preferred name</label><input name="preferred_name"></div><div class="field"><label>Birthday</label><input name="birthday" type="date"></div><div class="field"><label>Person type</label><select name="person_type"><option value="adult">Adult family member</option><option value="child">Child</option><option value="spouse">Spouse</option><option value="partner">Partner</option><option value="other">Other relative</option></select></div><div class="field"><label>Household</label><input name="household_name" placeholder="Shepard Household"></div><div class="field"><label>Phone (optional)</label><input name="phone" inputmode="tel"></div><div class="field"><label>Email (optional)</label><input name="email" type="email"></div><div class="field full"><label>Parent / guardian (optional)</label><select name="parent_id"><option value="">None</option>${adults.map(p=>`<option value="${p.id}">${esc(p.preferred_name||p.first_name)} ${esc(p.last_name)}</option>`).join('')}</select></div><div class="field full"><div class="notice">For privacy, this submission starts as <strong>Pending</strong>. A family admin approves it before it appears to everyone.</div></div><div class="field full"><div class="form-actions"><button class="btn secondary" type="button" data-go="family">Cancel</button><button class="btn">Submit family profile</button></div></div></form></div>`;document.getElementById('personForm').addEventListener('submit',submitPerson)}
async function submitPerson(e){e.preventDefault();const fd=new FormData(e.target),obj=Object.fromEntries(fd.entries()),parentId=obj.parent_id;delete obj.parent_id;Object.keys(obj).forEach(k=>obj[k]===''&&(obj[k]=null));obj.created_by=session.user.id;obj.approved=false;const {data,error}=await sb.from('people').insert(obj).select().single();if(error)return showToast(error.message);if(parentId){const r=await sb.from('relationships').insert({person_id:data.id,related_person_id:parentId,relationship_type:'parent',created_by:session.user.id});if(r.error)showToast('Profile added, but relationship needs review: '+r.error.message)}await loadData();go('family');showToast('Family profile submitted for approval')}

function renderProfile(){app.innerHTML=`${approvalBanner()}<div class="page-title"><h1>My Profile 👤</h1><p>Your account, family profile, and private notification preferences.</p></div><div class="grid two"><div class="card"><div class="list-item"><div class="person-icon" style="width:58px;height:58px">${initials(profile)}</div><div class="list-main"><strong>${esc(profile.first_name)} ${esc(profile.last_name)}</strong><small>${esc(profile.role.replace('_',' '))} • ${esc(session.user.email)}</small></div><span class="pill ${myPerson?.approved?'green':'gold'}">${myPerson?.approved?'Approved':'Pending'}</span></div><div class="setting-row"><div><strong>Birthday</strong><small>${fmtDate(myPerson?.birthday,{month:'long',day:'numeric'})}</small></div></div><div class="setting-row"><div><strong>Household</strong><small>${esc(myPerson?.household_name||'Not set')}</small></div></div></div><div class="card"><div class="section-head"><div><h2>Text alert preferences</h2><p>These settings are private to your account.</p></div></div>${toggleRow('Birthday reminders','birthday_alerts',prefs?.birthday_alerts)}${toggleRow('Event reminders','event_alerts',prefs?.event_alerts)}${toggleRow('Family announcements','announcement_alerts',prefs?.announcement_alerts)}<div class="setting-row"><div><strong>SMS consent</strong><small>${prefs?.sms_consent?'Opted in':'Not opted in'}</small></div><button class="btn small secondary" onclick="editSms()">Edit</button></div></div></div><section class="section"><div class="card"><div class="form-actions">${isAdmin()?'<button class="btn" data-go="admin">Admin Dashboard</button>':''}<button class="btn secondary" onclick="signOut()">Sign out</button></div></div></section>`}
function toggleRow(title,key,val){return `<div class="setting-row"><div><strong>${title}</strong></div><button class="toggle ${val?'on':''}" onclick="togglePref('${key}')"></button></div>`}
window.togglePref=async key=>{const value=!prefs?.[key];const {data,error}=await sb.from('notification_preferences').update({[key]:value,updated_at:new Date().toISOString()}).eq('user_id',session.user.id).select().single();if(error)return showToast(error.message);prefs=data;renderProfile();showToast('Preference updated')}
window.editSms=()=>{modal(`<div class="modal-head"><div><div class="eyebrow">SMS preferences</div><h2>Text alerts</h2></div><button class="close" onclick="closeModal()">✕</button></div><form id="smsForm" class="form-grid"><div class="field full"><label>Mobile phone</label><input name="phone" required value="${esc(prefs?.phone||'')}"></div><div class="field full"><label class="check-row"><input name="consent" type="checkbox" ${prefs?.sms_consent?'checked':''}><span>I consent to receive recurring family SMS alerts. Message/data rates may apply. I can opt out later.</span></label></div><div class="field full"><button class="btn">Save SMS settings</button></div></form>`);document.getElementById('smsForm').addEventListener('submit',saveSms)}
async function saveSms(e){e.preventDefault();const fd=new FormData(e.target),consent=fd.has('consent');const {data,error}=await sb.from('notification_preferences').update({phone:fd.get('phone'),sms_consent:consent,consented_at:consent?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('user_id',session.user.id).select().single();if(error)return showToast(error.message);prefs=data;closeModal();renderProfile();showToast('SMS settings saved')}
window.signOut=async()=>{await sb.auth.signOut();session=null;profile=null;people=[];events=[];showAuth()}

function renderAdmin(){if(!isAdmin()){go('home');return}const pending=people.filter(p=>!p.approved);app.innerHTML=`<div class="page-title"><h1>Admin Dashboard</h1><p>Approve family submissions and create shared events.</p></div><section class="section grid three"><div class="card stat"><span class="stat-icon">⏳</span><div><strong>${pending.length}</strong><small>Pending approvals</small></div></div><div class="card stat"><span class="stat-icon">👥</span><div><strong>${people.filter(p=>p.approved).length}</strong><small>Approved people</small></div></div><div class="card stat"><span class="stat-icon">📅</span><div><strong>${events.length}</strong><small>Events</small></div></div></section><section class="section"><div class="card"><div class="section-head"><div><h2>Pending family submissions</h2><p>Approve only people you recognize.</p></div><button class="btn small" onclick="openEventForm()">+ Event</button></div><div class="list">${pending.map(p=>`<div class="list-item"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(p.first_name)} ${esc(p.last_name)}</strong><small>${esc(p.person_type)} • ${esc(p.household_name||'No household')}</small></div><button class="btn small secondary" onclick="deletePerson('${p.id}')">Reject</button><button class="btn small" onclick="approvePerson('${p.id}')">Approve</button></div>`).join('')||'<div class="notice">No pending submissions.</div>'}</div></div></section>`}
window.approvePerson=async id=>{const {error}=await sb.from('people').update({approved:true}).eq('id',id);if(error)return showToast(error.message);await loadData();renderAdmin();showToast('Family member approved')}
window.deletePerson=async id=>{const {error}=await sb.from('people').delete().eq('id',id);if(error)return showToast(error.message);await loadData();renderAdmin();showToast('Submission rejected')}
window.openEventForm=()=>{if(!isAdmin())return;modal(`<div class="modal-head"><div><div class="eyebrow">Admin</div><h2>Create family event</h2></div><button class="close" onclick="closeModal()">✕</button></div><form id="eventForm" class="form-grid"><div class="field full"><label>Event title</label><input name="title" required></div><div class="field"><label>Date</label><input name="event_date" type="date" required></div><div class="field"><label>Time</label><input name="event_time" type="time"></div><div class="field full"><label>Location</label><input name="location"></div><div class="field full"><label>Description</label><textarea name="description" rows="4"></textarea></div><div class="field full"><button class="btn">Create event</button></div></form>`);document.getElementById('eventForm').addEventListener('submit',createEvent)}
async function createEvent(e){e.preventDefault();const obj=Object.fromEntries(new FormData(e.target).entries());Object.keys(obj).forEach(k=>obj[k]===''&&(obj[k]=null));obj.created_by=session.user.id;const {error}=await sb.from('events').insert(obj);if(error)return showToast(error.message);closeModal();await loadData();go('events');showToast('Family event created')}
function modal(html){const d=document.createElement('div');d.id='modalRoot';d.className='modal-backdrop';d.innerHTML=`<div class="modal">${html}</div>`;d.addEventListener('click',e=>{if(e.target===d)closeModal()});document.body.appendChild(d)}
window.closeModal=()=>document.getElementById('modalRoot')?.remove();

if(configured){sb.auth.onAuthStateChange((_event,s)=>{session=s;if(!s)showAuth()});bootstrap()}else{showAuth();document.getElementById('authMessage').textContent='First-time setup: edit config.js and paste your Supabase URL and anon key.'}
