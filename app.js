const cfg = window.FAMILY_HUB_CONFIG || {};
const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes('PASTE_') && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes('PASTE_');
const sb = configured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
let session=null, profile=null, myPerson=null, people=[], events=[], rsvps=[], prefs=null, currentView='home', authMode='signin', eventImageUrls={};
const app=document.getElementById('app');

function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2300)}
function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmtDate(d,o={month:'short',day:'numeric'}){if(!d)return 'Not set';return new Date(d+'T12:00:00').toLocaleDateString('en-US',o)}
function initials(p){return `${p?.first_name?.[0]||''}${p?.last_name?.[0]||''}`.toUpperCase()||'FM'}
function formatTime(t){if(!t)return 'Time TBD';const [h,m]=t.split(':').map(Number);return new Date(2026,0,1,h,m).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}
function isAdmin(){return profile?.role==='admin'}
function displayName(p){if(!p)return 'Family Member';return [p.preferred_name||p.first_name,p.last_name,p.suffix].filter(Boolean).join(' ')}
function legalName(p){if(!p)return 'Family Member';return [p.first_name,p.last_name,p.suffix].filter(Boolean).join(' ')}
function formatAddress(p){if(!p)return 'Not set';const street=[p.address_line1,p.address_line2].filter(Boolean).join(', '),csz=[p.city,[p.state,p.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');return [street,csz].filter(Boolean).join(' • ')||'Not set'}
function canManagePerson(p){return !!p&&(isAdmin()||p.linked_user_id===session?.user?.id||p.created_by===session?.user?.id)}
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
    const suffix=document.getElementById('authSuffix').value.trim(),preferred=document.getElementById('authPreferred').value.trim();
    const birthday=document.getElementById('authBirthday').value,phone=document.getElementById('authPhone').value.trim();
    const address_line1=document.getElementById('authAddress1').value.trim(),address_line2=document.getElementById('authAddress2').value.trim();
    const city=document.getElementById('authCity').value.trim(),state=document.getElementById('authState').value.trim(),postal_code=document.getElementById('authPostal').value.trim();
    const accessCode=document.getElementById('authAccessCode').value.trim().toUpperCase();
    if(!first||!last){msg.textContent='Enter first and last name.';return}
    if(!birthday){msg.textContent='Enter your birthday.';return}
    if(!accessCode){msg.textContent='Enter the Family Access Code.';return}
    const check=await sb.rpc('validate_family_access_code',{p_code:accessCode});
    if(check.error){msg.textContent='Could not verify the Family Access Code. Make sure you ran access_code_update.sql in Supabase.';return}
    if(check.data!==true){msg.textContent='That Family Access Code is not valid. Check the code and try again.';return}
    const {data,error}=await sb.auth.signUp({email,password,options:{data:{first_name:first,last_name:last,suffix,preferred_name:preferred,birthday,phone,address_line1,address_line2,city,state,postal_code,family_access_code:accessCode}}});
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
    const res=await sb.from('people').insert({linked_user_id:uid,created_by:uid,first_name:p.first_name||meta.first_name||'Family',last_name:p.last_name||meta.last_name||'Member',suffix:meta.suffix||null,preferred_name:meta.preferred_name||p.first_name||meta.first_name||'Family',birthday:meta.birthday||null,person_type:'adult',phone:meta.phone||null,email:session.user.email,address_line1:meta.address_line1||null,address_line2:meta.address_line2||null,city:meta.city||null,state:meta.state||null,postal_code:meta.postal_code||null,approved:false}).select().single();
    if(res.error) throw res.error; person=res.data;
  }
  myPerson=person;
  let {data:pref}=await sb.from('notification_preferences').select('*').eq('user_id',uid).maybeSingle();
  if(!pref){const res=await sb.from('notification_preferences').insert({user_id:uid,phone:person?.phone||meta.phone||null}).select().single(); if(!res.error)pref=res.data}
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
  eventImageUrls={};
  const withImages=events.filter(e=>e.invitation_image_path);
  await Promise.all(withImages.map(async e=>{
    const {data,error}=await sb.storage.from('event-invitations').createSignedUrl(e.invitation_image_path,3600);
    if(!error&&data?.signedUrl)eventImageUrls[e.id]=data.signedUrl;
  }));
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
 const today=new Date(); today.setHours(0,0,0,0);
 const cutoff=new Date(today); cutoff.setDate(cutoff.getDate()+30);
 const upcoming=[...people]
   .filter(p=>p.birthday&&p.approved)
   .filter(p=>{const nextBirthday=birthdayNext(p); return nextBirthday>=today&&nextBirthday<=cutoff})
   .sort((a,b)=>birthdayNext(a)-birthdayNext(b));
 const next=events.find(e=>new Date(e.event_date+'T23:59:59')>=new Date())||events[0];
 app.innerHTML=`${approvalBanner()}<section class="hero"><div class="eyebrow">Private family dashboard</div><h1>Welcome, ${esc(profile.first_name||myPerson?.preferred_name||'family')}.</h1><p>This version is connected to a shared Supabase database. Changes made by one authorized family member can be seen by the others.</p><div class="hero-actions"><button class="btn secondary" data-go="signup">+ Add family member</button>${isAdmin()?'<button class="btn" data-go="admin" style="background:#f4b942;color:#26364b">Admin dashboard</button>':''}</div></section>
 <section class="section grid three"><div class="card stat"><span class="stat-icon">👨‍👩‍👧‍👦</span><div><strong>${people.filter(p=>p.approved).length}</strong><small>Approved family members</small></div></div><div class="card stat"><span class="stat-icon">🎂</span><div><strong>${upcoming.length}</strong><small>Upcoming birthdays</small></div></div><div class="card stat"><span class="stat-icon">📅</span><div><strong>${events.length}</strong><small>Family events</small></div></div></section>
 <section class="section grid two"><div class="card"><div class="section-head"><div><h2>Upcoming birthdays</h2><p>Approved family directory</p></div><button class="link-btn" data-go="birthdays">See all</button></div><div class="list">${upcoming.map(personRow).join('')||'<div class="notice">No family birthdays in the next 30 days.</div>'}</div></div>
 <div class="card event-card">${next?eventSummary(next):'<div class="notice">No family events yet.</div>'}</div></section>`;
}
function personRow(p){return `<div class="list-item"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(displayName(p))}</strong><small>${fmtDate(p.birthday,{month:'long',day:'numeric'})} • ${esc(p.household_name||'Family')}</small></div></div>`}
function eventSummary(e){const counts=countRsvps(e.id),mine=rsvps.find(r=>r.event_id===e.id&&r.user_id===session.user.id)?.response;const image=eventImageUrls[e.id]?`<img class="event-invite-image" src="${esc(eventImageUrls[e.id])}" alt="${esc(e.title)} invitation">`:'';return `<div class="section-head"><div><h2>Next family event</h2><p>${counts.yes} going • ${counts.maybe} maybe</p></div></div>${image}<div class="eyebrow">${fmtDate(e.event_date,{weekday:'long',month:'long',day:'numeric'})}</div><h3>${esc(e.title)}</h3><div class="event-meta"><span>🕘 ${formatTime(e.event_time)}</span><span>📍 ${esc(e.location||'Location TBD')}</span></div><p class="muted">${esc(e.description||'')}</p><div class="event-footer"><span class="pill ${mine==='yes'?'green':'gold'}">Your RSVP: ${mine||'none'}</span><button class="btn small" data-go="events">View events</button></div>`}

function birthdaySort(a,b){const da=new Date(a.birthday+'T12:00'),db=new Date(b.birthday+'T12:00');return da.getMonth()-db.getMonth()||da.getDate()-db.getDate()||displayName(a).localeCompare(displayName(b))}
function renderBirthdays(){const list=people.filter(p=>p.approved&&p.birthday).sort(birthdaySort);app.innerHTML=`<div class="page-title"><h1>Birthdays 🎂</h1><p>Approved family birthdays organized by month and date.</p></div><div class="toolbar"><input id="birthdaySearch" class="search" placeholder="Search family…" oninput="filterBirthdayList(this.value)"></div><div id="birthdayList">${birthdayCards(list)}</div>`}
function currentAge(person){
 if(!person?.birthday)return null;
 const parts=person.birthday.split('-').map(Number);
 if(parts.length!==3||parts.some(Number.isNaN))return null;
 const [birthYear,birthMonth,birthDay]=parts;
 const today=new Date();
 let age=today.getFullYear()-birthYear;
 const hasHadBirthday=(today.getMonth()+1>birthMonth)||((today.getMonth()+1===birthMonth)&&today.getDate()>=birthDay);
 if(!hasHadBirthday)age--;
 return age>=0?age:null;
}
function birthdayCards(list){
 if(!list.length)return '<div class="card">No birthdays found.</div>';
 const months=Array.from({length:12},()=>[]);
 [...list].sort(birthdaySort).forEach(p=>{
   const parts=p.birthday.split('-').map(Number);
   const monthIndex=parts[1]-1;
   if(monthIndex>=0&&monthIndex<12)months[monthIndex].push(p);
 });
 return months.map((monthList,monthIndex)=>{
   if(!monthList.length)return '';
   const monthName=new Date(2000,monthIndex,1).toLocaleDateString(undefined,{month:'long'});
   return `<section style="margin:0 0 28px">
     <div style="background:var(--primary,#1f5f99);color:white;border-radius:14px;padding:12px 16px;margin-bottom:12px">
       <h2 style="margin:0;font-size:1.25rem">${monthName}</h2>
     </div>
     <div class="grid two">
       ${monthList.map(p=>{
         const age=currentAge(p);
         return `<div class="card"><div class="list-item" style="padding:0;border:0"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(displayName(p))}</strong><small>${fmtDate(p.birthday,{month:'long',day:'numeric'})}${age!==null?` • Age ${age}`:''} • ${esc(p.household_name||'Family')}</small></div></div></div>`;
       }).join('')}
     </div>
   </section>`;
 }).join('');
}
window.filterBirthdayList=q=>{q=q.toLowerCase();const list=people.filter(p=>p.approved&&p.birthday&&`${p.first_name} ${p.last_name} ${p.preferred_name||''} ${p.suffix||''}`.toLowerCase().includes(q)).sort(birthdaySort);document.getElementById('birthdayList').innerHTML=birthdayCards(list)}

function countRsvps(eventId){const x=rsvps.filter(r=>r.event_id===eventId);return {yes:x.filter(r=>r.response==='yes').length,maybe:x.filter(r=>r.response==='maybe').length,no:x.filter(r=>r.response==='no').length}}
function renderEvents(){app.innerHTML=`<div class="page-title"><h1>Family Events 📅</h1><p>Shared events and live RSVPs. Any signed-in family account can add an event.</p></div><div class="toolbar"><button class="btn" onclick="openEventForm()">+ Create event</button></div><div class="grid two">${events.map(e=>{const c=countRsvps(e.id),mine=rsvps.find(r=>r.event_id===e.id&&r.user_id===session.user.id)?.response;const image=eventImageUrls[e.id]?`<img class="event-invite-image" src="${esc(eventImageUrls[e.id])}" alt="${esc(e.title)} invitation">`:'';return `<div class="card event-card">${image}<div class="eyebrow">${fmtDate(e.event_date,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</div><h2>${esc(e.title)}</h2><div class="event-meta"><span>🕘 ${formatTime(e.event_time)}</span><span>📍 ${esc(e.location||'TBD')}</span></div><p class="muted">${esc(e.description||'')}</p><div class="event-footer"><span class="pill green">${c.yes} yes</span><span class="pill gold">${c.maybe} maybe</span><span class="pill red">${c.no} no</span></div><div class="form-actions"><button class="btn small ${mine==='yes'?'':'secondary'}" onclick="setRsvp('${e.id}','yes')">Yes</button><button class="btn small ${mine==='maybe'?'':'secondary'}" onclick="setRsvp('${e.id}','maybe')">Maybe</button><button class="btn small ${mine==='no'?'danger':'secondary'}" onclick="setRsvp('${e.id}','no')">No</button></div></div>`}).join('')||'<div class="card">No events yet.</div>'}</div>`}
window.setRsvp=async(eventId,response)=>{const {error}=await sb.from('rsvps').upsert({event_id:eventId,user_id:session.user.id,response,updated_at:new Date().toISOString()});if(error)return showToast(error.message);await loadData();renderEvents();showToast('RSVP updated')}

function renderFamily(){const approved=people.filter(p=>p.approved);const mine=people.filter(p=>p.created_by===session.user.id&&!p.approved);app.innerHTML=`<div class="page-title"><h1>Family Directory 👨‍👩‍👧‍👦</h1><p>Approved family members plus submissions you manage.</p></div><div class="toolbar"><input id="familySearch" class="search" placeholder="Search name or household…" oninput="filterFamily(this.value)"><button class="btn" data-go="signup">+ Add family</button></div>${mine.length?`<section class="section"><h2>Your pending submissions</h2><div class="grid two">${mine.map(personCard).join('')}</div></section>`:''}<div id="familyGrid" class="grid two">${approved.map(personCard).join('')||'<div class="card">No approved family records yet.</div>'}</div>`}
function personCard(p){const canDelete=isAdmin()&&p.linked_user_id!==session?.user?.id;return `<div class="card"><div class="list-item" style="padding:0;border:0;align-items:flex-start"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(displayName(p))}</strong><small>${esc(p.person_type)} • ${esc(p.household_name||'No household')}</small>${p.birthday?`<small>🎂 ${fmtDate(p.birthday,{month:'long',day:'numeric'})}</small>`:''}${p.phone?`<small>📱 ${esc(p.phone)}</small>`:'<small>📱 Not provided</small>'}${p.email?`<small>✉️ ${esc(p.email)}</small>`:'<small>✉️ Not provided</small>'}<small>🏠 ${esc(formatAddress(p))}</small></div><div style="display:flex;gap:6px;flex-direction:column;align-items:flex-end">${p.approved?'<span class="pill green">Approved</span>':'<span class="pill gold">Pending</span>'}${canManagePerson(p)?`<button class="btn small secondary" onclick="editPersonProfile('${p.id}')">Edit</button>`:''}${canDelete?`<button class="btn small danger" onclick="confirmDeleteFamilyMember('${p.id}')">Delete</button>`:''}</div></div></div>`}
window.filterFamily=q=>{q=q.toLowerCase();document.getElementById('familyGrid').innerHTML=people.filter(p=>p.approved&&`${p.first_name} ${p.last_name} ${p.suffix||''} ${p.preferred_name||''} ${p.household_name||''} ${p.phone||''} ${p.email||''} ${p.address_line1||''} ${p.city||''} ${p.state||''} ${p.postal_code||''}`.toLowerCase().includes(q)).map(personCard).join('')||'<div class="card">No matching family members.</div>'}

function renderSignup(){const adults=people.filter(p=>p.approved&&p.person_type!=='child');app.innerHTML=`<div class="page-title"><h1>Add Family Member</h1><p>Add an adult, spouse/partner, or child. Birthday is required; phone and email can be left blank for children who do not have them.</p></div><div class="card"><form id="personForm" class="form-grid"><div class="field"><label>First name</label><input name="first_name" required></div><div class="field"><label>Last name</label><input name="last_name" required></div><div class="field"><label>Suffix</label><select name="suffix"><option value="">None</option><option>Jr.</option><option>Sr.</option><option>II</option><option>III</option><option>IV</option><option>V</option></select></div><div class="field"><label>Preferred name</label><input name="preferred_name"></div><div class="field"><label>Birthday</label><input name="birthday" type="date" required></div><div class="field"><label>Person type</label><select name="person_type"><option value="adult">Adult family member</option><option value="child">Child</option><option value="spouse">Spouse</option><option value="partner">Partner</option><option value="other">Other relative</option></select></div><div class="field"><label>Household</label><input name="household_name" placeholder="Shepard Household"></div><div class="field"><label>Cell phone</label><input name="phone" inputmode="tel" autocomplete="tel" placeholder="Optional for children"></div><div class="field full"><label>Email address</label><input name="email" type="email" autocomplete="email" placeholder="Optional for children"></div><div class="field full"><label>Home street address</label><input name="address_line1" autocomplete="address-line1"></div><div class="field full"><label>Apartment / unit</label><input name="address_line2" autocomplete="address-line2"></div><div class="field"><label>City</label><input name="city" autocomplete="address-level2"></div><div class="field"><label>State</label><input name="state" autocomplete="address-level1" placeholder="NY"></div><div class="field"><label>ZIP code</label><input name="postal_code" autocomplete="postal-code" inputmode="numeric"></div><div class="field full"><label>Parent / guardian (optional)</label><select name="parent_id"><option value="">None</option>${adults.map(p=>`<option value="${p.id}">${esc(displayName(p))}</option>`).join('')}</select></div><div class="field full"><div class="notice">Contact information and home address are visible only inside the signed-in family directory. This submission starts as <strong>Pending</strong> until approved by a family admin.</div></div><div class="field full"><div class="form-actions"><button class="btn secondary" type="button" data-go="family">Cancel</button><button class="btn">Submit family profile</button></div></div></form></div>`;document.getElementById('personForm').addEventListener('submit',submitPerson)}
async function submitPerson(e){e.preventDefault();const fd=new FormData(e.target),obj=Object.fromEntries(fd.entries()),parentId=obj.parent_id;delete obj.parent_id;Object.keys(obj).forEach(k=>obj[k]===''&&(obj[k]=null));obj.created_by=session.user.id;obj.approved=false;const {data,error}=await sb.from('people').insert(obj).select().single();if(error)return showToast(error.message);if(parentId){const r=await sb.from('relationships').insert({person_id:data.id,related_person_id:parentId,relationship_type:'parent',created_by:session.user.id});if(r.error)showToast('Profile added, but relationship needs review: '+r.error.message)}await loadData();go('family');showToast('Family profile submitted for approval')}

function renderProfile(){app.innerHTML=`${approvalBanner()}<div class="page-title"><h1>My Profile 👤</h1><p>Your account, family profile, and private notification preferences.</p></div><div class="grid two"><div class="card"><div class="section-head"><div><h2>Family profile</h2><p>Keep your directory information current.</p></div><button class="btn small secondary" onclick="editPersonProfile('${myPerson?.id||''}')">Edit profile</button></div><div class="list-item"><div class="person-icon" style="width:58px;height:58px">${initials(myPerson||profile)}</div><div class="list-main"><strong>${esc(displayName(myPerson||profile))}</strong><small>${esc(profile.role.replace('_',' '))} • ${esc(session.user.email)}</small></div><span class="pill ${myPerson?.approved?'green':'gold'}">${myPerson?.approved?'Approved':'Pending'}</span></div><div class="setting-row"><div><strong>Birthday</strong><small>${fmtDate(myPerson?.birthday,{month:'long',day:'numeric',year:'numeric'})}</small></div></div><div class="setting-row"><div><strong>Cell phone</strong><small>${esc(myPerson?.phone||'Not set')}</small></div></div><div class="setting-row"><div><strong>Directory email</strong><small>${esc(myPerson?.email||session.user.email||'Not set')}</small></div></div><div class="setting-row"><div><strong>Home address</strong><small>${esc(formatAddress(myPerson))}</small></div></div><div class="setting-row"><div><strong>Household</strong><small>${esc(myPerson?.household_name||'Not set')}</small></div></div></div><div class="card"><div class="section-head"><div><h2>Text alert preferences</h2><p>These settings are private to your account.</p></div></div>${toggleRow('Birthday reminders','birthday_alerts',prefs?.birthday_alerts)}${toggleRow('Event reminders','event_alerts',prefs?.event_alerts)}${toggleRow('Family announcements','announcement_alerts',prefs?.announcement_alerts)}<div class="setting-row"><div><strong>SMS consent</strong><small>${prefs?.sms_consent?'Opted in':'Not opted in'}</small></div><button class="btn small secondary" onclick="editSms()">Edit</button></div></div></div><section class="section"><div class="card"><div class="form-actions">${isAdmin()?'<button class="btn" data-go="admin">Admin Dashboard</button>':''}<button class="btn secondary" onclick="signOut()">Sign out</button></div></div></section>`}

window.editPersonProfile=function(id){const p=people.find(x=>x.id===id)||myPerson;if(!p||!canManagePerson(p))return showToast('You do not have permission to edit this profile');const suffixes=['','Jr.','Sr.','II','III','IV','V'];modal(`<div class="modal-head"><div><div class="eyebrow">Family profile</div><h2>Edit ${esc(displayName(p))}</h2></div><button class="close" onclick="closeModal()">✕</button></div><form id="editPersonForm" class="form-grid"><div class="field"><label>First name</label><input name="first_name" required value="${esc(p.first_name||'')}"></div><div class="field"><label>Last name</label><input name="last_name" required value="${esc(p.last_name||'')}"></div><div class="field"><label>Suffix</label><select name="suffix">${suffixes.map(x=>`<option value="${x}" ${p.suffix===x?'selected':''}>${x||'None'}</option>`).join('')}</select></div><div class="field"><label>Preferred name</label><input name="preferred_name" value="${esc(p.preferred_name||'')}"></div><div class="field"><label>Birthday</label><input name="birthday" type="date" required value="${esc(p.birthday||'')}"></div><div class="field"><label>Household</label><input name="household_name" value="${esc(p.household_name||'')}"></div><div class="field"><label>Cell phone</label><input name="phone" inputmode="tel" value="${esc(p.phone||'')}"></div><div class="field"><label>Email address</label><input name="email" type="email" value="${esc(p.email||'')}"></div><div class="field full"><label>Home street address</label><input name="address_line1" value="${esc(p.address_line1||'')}"></div><div class="field full"><label>Apartment / unit</label><input name="address_line2" value="${esc(p.address_line2||'')}"></div><div class="field"><label>City</label><input name="city" value="${esc(p.city||'')}"></div><div class="field"><label>State</label><input name="state" value="${esc(p.state||'')}"></div><div class="field"><label>ZIP code</label><input name="postal_code" value="${esc(p.postal_code||'')}"></div>${p.linked_user_id===session.user.id?'<div class="field full"><div class="notice">If you change your email address, Supabase may send a confirmation message before your sign-in email changes.</div></div>':''}<div class="field full"><button class="btn">Save profile</button></div></form>`);document.getElementById('editPersonForm').addEventListener('submit',e=>savePersonProfile(e,p))}

async function savePersonProfile(e,p){e.preventDefault();const obj=Object.fromEntries(new FormData(e.target).entries());Object.keys(obj).forEach(k=>obj[k]===''&&(obj[k]=null));const {data,error}=await sb.from('people').update(obj).eq('id',p.id).select().single();if(error)return showToast(error.message);if(p.linked_user_id===session.user.id){const prof=await sb.from('profiles').update({first_name:obj.first_name,last_name:obj.last_name}).eq('user_id',session.user.id).select().single();if(!prof.error)profile=prof.data;await sb.auth.updateUser({data:{first_name:obj.first_name,last_name:obj.last_name,suffix:obj.suffix,preferred_name:obj.preferred_name,birthday:obj.birthday,phone:obj.phone,address_line1:obj.address_line1,address_line2:obj.address_line2,city:obj.city,state:obj.state,postal_code:obj.postal_code}});if(obj.email&&obj.email!==session.user.email){const authUpdate=await sb.auth.updateUser({email:obj.email});if(authUpdate.error)showToast('Profile saved; sign-in email was not changed: '+authUpdate.error.message)}if(prefs){const prefUpdate=await sb.from('notification_preferences').update({phone:obj.phone,updated_at:new Date().toISOString()}).eq('user_id',session.user.id).select().single();if(!prefUpdate.error)prefs=prefUpdate.data}}closeModal();await loadData();render();showToast('Family profile updated')}
function toggleRow(title,key,val){return `<div class="setting-row"><div><strong>${title}</strong></div><button class="toggle ${val?'on':''}" onclick="togglePref('${key}')"></button></div>`}
window.togglePref=async key=>{const value=!prefs?.[key];const {data,error}=await sb.from('notification_preferences').update({[key]:value,updated_at:new Date().toISOString()}).eq('user_id',session.user.id).select().single();if(error)return showToast(error.message);prefs=data;renderProfile();showToast('Preference updated')}
window.editSms=()=>{modal(`<div class="modal-head"><div><div class="eyebrow">SMS preferences</div><h2>Text alerts</h2></div><button class="close" onclick="closeModal()">✕</button></div><form id="smsForm" class="form-grid"><div class="field full"><label>Mobile phone</label><input name="phone" required value="${esc(prefs?.phone||'')}"></div><div class="field full"><label class="check-row"><input name="consent" type="checkbox" ${prefs?.sms_consent?'checked':''}><span>I consent to receive recurring family SMS alerts. Message/data rates may apply. I can opt out later.</span></label></div><div class="field full"><button class="btn">Save SMS settings</button></div></form>`);document.getElementById('smsForm').addEventListener('submit',saveSms)}
async function saveSms(e){e.preventDefault();const fd=new FormData(e.target),consent=fd.has('consent');const {data,error}=await sb.from('notification_preferences').update({phone:fd.get('phone'),sms_consent:consent,consented_at:consent?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq('user_id',session.user.id).select().single();if(error)return showToast(error.message);prefs=data;closeModal();renderProfile();showToast('SMS settings saved')}
window.signOut=async()=>{await sb.auth.signOut();session=null;profile=null;people=[];events=[];showAuth()}

function renderAdmin(){if(!isAdmin()){go('home');return}const pending=people.filter(p=>!p.approved);app.innerHTML=`<div class="page-title"><h1>Admin Dashboard</h1><p>Approve family submissions and create shared events.</p></div><section class="section grid three"><div class="card stat"><span class="stat-icon">⏳</span><div><strong>${pending.length}</strong><small>Pending approvals</small></div></div><div class="card stat"><span class="stat-icon">👥</span><div><strong>${people.filter(p=>p.approved).length}</strong><small>Approved people</small></div></div><div class="card stat"><span class="stat-icon">📅</span><div><strong>${events.length}</strong><small>Events</small></div></div></section><section class="section"><div class="card"><div class="section-head"><div><h2>Pending family submissions</h2><p>Approve only people you recognize.</p></div><button class="btn small" onclick="openEventForm()">+ Event</button></div><div class="list">${pending.map(p=>`<div class="list-item"><div class="person-icon">${initials(p)}</div><div class="list-main"><strong>${esc(displayName(p))}</strong><small>${esc(p.person_type)} • ${esc(p.household_name||'No household')}</small></div><button class="btn small secondary" onclick="deletePerson('${p.id}')">Reject</button><button class="btn small" onclick="approvePerson('${p.id}')">Approve</button></div>`).join('')||'<div class="notice">No pending submissions.</div>'}</div></div></section>`}
window.approvePerson=async id=>{const {error}=await sb.from('people').update({approved:true}).eq('id',id);if(error)return showToast(error.message);await loadData();renderAdmin();showToast('Family member approved')}
window.deletePerson=async id=>{if(!isAdmin())return showToast('Admin access required');await runAdminDeleteFamilyMember(id,'Submission rejected and removed')}

window.confirmDeleteFamilyMember=function(id){
  if(!isAdmin())return showToast('Admin access required');
  const p=people.find(x=>x.id===id);if(!p)return showToast('Family member not found');
  if(p.linked_user_id===session?.user?.id)return showToast('You cannot delete your own admin account from the app');
  const accountNote=p.linked_user_id?'<div class="notice" style="margin-top:12px"><strong>This person has a login account.</strong><br>Deleting them will also permanently delete that Supabase login account. Events and other family records they created will be reassigned to you so those records are not lost.</div>':'<div class="notice" style="margin-top:12px">This person does not have a login account. Their family-directory record and relationship links will be permanently removed.</div>';
  modal(`<div class="modal-head"><div><div class="eyebrow">Admin action</div><h2>Delete ${esc(displayName(p))}?</h2></div><button class="close" onclick="closeModal()">✕</button></div><p>This cannot be undone.</p>${accountNote}<div class="form-actions" style="margin-top:18px"><button class="btn secondary" onclick="closeModal()">Cancel</button><button class="btn danger" id="confirmMemberDeleteBtn" onclick="adminDeleteFamilyMember('${p.id}')">Delete family member</button></div>`);
}

window.adminDeleteFamilyMember=async function(id){
  const btn=document.getElementById('confirmMemberDeleteBtn');if(btn){btn.disabled=true;btn.textContent='Deleting…'}
  const ok=await runAdminDeleteFamilyMember(id,'Family member deleted');
  if(ok){closeModal();go('family')}
  else if(btn){btn.disabled=false;btn.textContent='Delete family member'}
}

async function runAdminDeleteFamilyMember(id,successMessage){
  if(!isAdmin()){showToast('Admin access required');return false}
  const {data,error}=await sb.functions.invoke('admin-delete-family-member',{body:{person_id:id}});
  if(error){showToast('Delete failed: '+error.message);return false}
  if(!data?.ok){showToast(data?.error||'Delete failed');return false}
  await loadData();render();showToast(successMessage);return true
}
window.openEventForm=()=>{modal(`<div class="modal-head"><div><div class="eyebrow">Family event</div><h2>Create family event</h2><p class="hint">Any signed-in family account may add an event.</p></div><button class="close" onclick="closeModal()">✕</button></div><form id="eventForm" class="form-grid"><div class="field full"><label>Event title</label><input name="title" required></div><div class="field"><label>Date</label><input name="event_date" type="date" required></div><div class="field"><label>Time</label><input name="event_time" type="time"></div><div class="field full"><label>Location</label><input name="location"></div><div class="field full"><label>Description</label><textarea name="description" rows="4"></textarea></div><div class="field full"><label>Event invitation picture <span class="muted">(optional)</span></label><input id="eventInvitationImage" name="invitation_image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><span class="hint">Upload a JPG, PNG, WEBP, or GIF invitation image. Maximum 8 MB.</span><img id="eventImagePreview" class="event-image-preview hidden" alt="Invitation preview"></div><div class="field full"><button class="btn">Create event</button></div></form>`);const input=document.getElementById('eventInvitationImage'),preview=document.getElementById('eventImagePreview');input.addEventListener('change',()=>{const f=input.files?.[0];if(!f){preview.classList.add('hidden');preview.removeAttribute('src');return}preview.src=URL.createObjectURL(f);preview.classList.remove('hidden')});document.getElementById('eventForm').addEventListener('submit',createEvent)}
async function createEvent(e){e.preventDefault();const form=e.target,fd=new FormData(form),file=fd.get('invitation_image');const obj={title:fd.get('title'),event_date:fd.get('event_date'),event_time:fd.get('event_time')||null,location:fd.get('location')||null,description:fd.get('description')||null,created_by:session.user.id};if(file&&file.size){if(!file.type.startsWith('image/'))return showToast('Invitation must be an image file');if(file.size>8*1024*1024)return showToast('Invitation image must be 8 MB or smaller')}const btn=form.querySelector('button[type=submit],button.btn');if(btn){btn.disabled=true;btn.textContent='Creating…'}const {data:eventRow,error}=await sb.from('events').insert(obj).select().single();if(error){if(btn){btn.disabled=false;btn.textContent='Create event'}return showToast(error.message)}let imageWarning='';if(file&&file.size){const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'')||'jpg';const path=`${session.user.id}/${eventRow.id}/${crypto.randomUUID()}.${ext}`;const upload=await sb.storage.from('event-invitations').upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type});if(upload.error){imageWarning=' Event created, but the invitation image could not be uploaded: '+upload.error.message}else{const update=await sb.from('events').update({invitation_image_path:path}).eq('id',eventRow.id);if(update.error)imageWarning=' Event created, but the invitation image could not be attached: '+update.error.message}}closeModal();await loadData();go('events');showToast(imageWarning||'Family event created')}
function modal(html){const d=document.createElement('div');d.id='modalRoot';d.className='modal-backdrop';d.innerHTML=`<div class="modal">${html}</div>`;d.addEventListener('click',e=>{if(e.target===d)closeModal()});document.body.appendChild(d)}
window.closeModal=()=>document.getElementById('modalRoot')?.remove();

if(configured){sb.auth.onAuthStateChange((_event,s)=>{session=s;if(!s)showAuth()});bootstrap()}else{showAuth();document.getElementById('authMessage').textContent='First-time setup: edit config.js and paste your Supabase URL and anon key.'}
