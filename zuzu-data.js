/* ZUZU <-> Supabase layer. Loaded after the main script and shares its globals. */
const sb = supabase.createClient(ZUZU_CONFIG.url, ZUZU_CONFIG.key);
let user = null, queue = Promise.resolve();
const known = { ids: new Set(), liked: new Set(), saved: new Set(), comments: new Map() };
const nameOf = u => (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || (u.email || 'Reader').split('@')[0];
const initialsOf = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

let me = null, allMine = [];
const cssUrl = u => "url('" + encodeURI(u).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29') + "')";
async function load() {
  const { data, error } = await sb.from('stories').select('*, likes(count), comments(author_name,text,created_at)').order('created_at', { ascending: false }).limit(150);
  if (error) { showToast('Could not load stories'); return; }
  const ids = [...new Set(data.map(r => r.author_id))];
  const { data: ps } = ids.length ? await sb.from('profiles').select('*').in('user_id', ids) : { data: [] };
  const prof = new Map((ps || []).map(p => [p.user_id, p]));
  me = user ? (prof.get(user.id) || (await sb.from('profiles').select('*').eq('user_id', user.id).maybeSingle()).data) : null;
  const now = Date.now();
  const all = data.map(r => {
    const p = prof.get(r.author_id) || {}, name = p.display_name || r.author_name;
    const live = r.status === 'published' && new Date(r.publish_at).getTime() <= now;
    return {
      id: r.id, title: r.title, category: r.category, author: name, initials: initialsOf(name), avatar: p.avatar_url || '',
      time: fmt(r.publish_at), read: r.read_min, likes: r.likes[0] ? r.likes[0].count : 0,
      comments: r.comments.sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map(c => ({ author: c.author_name, text: c.text })),
      excerpt: r.excerpt, image: r.image_url || PLACEHOLDER, rawImage: r.image_url || '', body: r.body,
      mine: !!user && r.author_id === user.id, publishAt: r.publish_at, live, state: r.status === 'draft' ? 'Draft' : (live ? 'Live' : 'Scheduled')
    };
  });
  stories = all.filter(s => s.live);
  allMine = all.filter(s => s.mine);
  known.ids = new Set(stories.map(s => s.id));
  known.comments = new Map(stories.map(s => [s.id, s.comments.length]));
  likedIds = new Set(); savedIds = new Set();
  if (user) {
    const [l, v] = await Promise.all([sb.from('likes').select('story_id').eq('user_id', user.id), sb.from('saves').select('story_id').eq('user_id', user.id)]);
    likedIds = new Set((l.data || []).map(x => x.story_id)); savedIds = new Set((v.data || []).map(x => x.story_id));
  }
  known.liked = new Set(likedIds); known.saved = new Set(savedIds);
  refreshAvatar();
  if (document.getElementById('acctRoot')) renderAccountPage(); else renderFeed();
}

// The page changes local state, then calls saveStorage(); we push the differences to Supabase.
async function sync() {
  if (!user) return;
  const name = nameOf(user);
  for (const [now, was, table] of [[likedIds, known.liked, 'likes'], [savedIds, known.saved, 'saves']]) {
    for (const id of now) if (!was.has(id) && known.ids.has(id)) await sb.from(table).insert({ story_id: id, user_id: user.id });
    for (const id of was) if (!now.has(id)) await sb.from(table).delete().match({ story_id: id, user_id: user.id });
  }
  for (const s of stories) {
    if (!known.ids.has(s.id)) continue;
    for (const c of s.comments.slice(known.comments.get(s.id) || 0)) await sb.from('comments').insert({ story_id: s.id, user_id: user.id, author_name: name, text: c.text });
  }
  await load();
}
saveStorage = () => { queue = queue.then(sync).catch(() => showToast('Could not save - please try again')); };

function openAuth() {
  if (user) {
    openModal('<div class="modal-head"><h2>Signed in</h2><button class="btn-close" id="closeModalBtn">✕</button></div><p style="margin-bottom:18px"><b>' + escapeHtml(nameOf(user)) + '</b><br><small>' + escapeHtml(user.email || '') + '</small></p><button class="secondary-btn" id="signOutBtn">Sign out</button>');
    return;
  }
  openModal('<div class="modal-head"><h2>Join ZUZU</h2><button class="btn-close" id="closeModalBtn">✕</button></div>' +
    '<button class="primary-btn" id="googleBtn" style="width:100%;justify-content:center;margin-bottom:16px">Continue with Google</button>' +
    '<form id="authForm"><div class="form-field"><label>EMAIL</label><input id="authEmail" type="email" required></div>' +
    '<div class="form-field"><label>PASSWORD (8+ characters)</label><input id="authPass" type="password" minlength="8" required></div>' +
    '<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="primary-btn" type="submit">Sign in</button><button class="secondary-btn" type="button" id="signUpBtn">Create account</button></div></form>' +
    '<p id="authMsg" style="margin-top:14px;font-size:13px;color:var(--muted)">By continuing you agree to our <a href="terms.html" style="text-decoration:underline">Terms</a> and <a href="privacy.html" style="text-decoration:underline">Privacy Policy</a>.</p>');
}

function openContact() {
  openModal('<div class="modal-head"><h2>Contact &amp; Support</h2><button class="btn-close" id="closeModalBtn">✕</button></div>' +
    '<form id="contactForm"><div class="form-field"><label>NAME</label><input id="cName" required maxlength="80" value="' + (user ? escapeHtml(nameOf(user)) : '') + '"></div>' +
    '<div class="form-field"><label>EMAIL</label><input id="cEmail" type="email" required maxlength="120" value="' + (user ? escapeHtml(user.email || '') : '') + '"></div>' +
    '<div class="form-field"><label>MESSAGE</label><textarea id="cMsg" required minlength="5" maxlength="2000" placeholder="Question, complaint or feedback…"></textarea></div>' +
    '<button class="primary-btn" type="submit">Send message</button></form>');
}

// Guards (capture phase, so they run before the page's own handlers)
document.addEventListener('click', e => {
  const t = e.target;
  if (!user && t.closest('#avatarBtn,[data-like],[data-save],[data-view="Write"],[data-view="Account"]')) {
    e.preventDefault(); e.stopImmediatePropagation(); openAuth();
  } else if (t.closest('#contactLink')) { e.preventDefault(); openContact(); }
}, true);

document.addEventListener('submit', async e => {
  const f = e.target;
  if (!user && f.id === 'commentForm') { e.preventDefault(); e.stopImmediatePropagation(); openAuth(); return; }
  if (f.id === 'writerForm') { e.preventDefault(); e.stopImmediatePropagation(); await saveStory(e); return; }
  if (f.id === 'profileForm') {
    e.preventDefault();
    const pic = pPic.value.trim();
    const { error } = await sb.from('profiles').upsert({ user_id: user.id, display_name: pName.value.trim(), username: pUser.value.trim().toLowerCase() || null, bio: pBio.value.trim() || null, avatar_url: /^https:\/\/\S+$/i.test(pic) ? pic : null, updated_at: new Date().toISOString() });
    if (error) { showToast(error.code === '23505' ? 'That username is already taken' : 'Could not save profile'); return; }
    closeModal(); await load(); showToast('Profile updated'); return;
  }
  if (f.id === 'authForm') {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: authEmail.value, password: authPass.value });
    if (error) authMsg.textContent = error.message;
  }
  if (f.id === 'contactForm') {
    e.preventDefault();
    const { error } = await sb.from('support_messages').insert({ name: cName.value.trim(), email: cEmail.value.trim(), message: cMsg.value.trim(), user_id: user ? user.id : null });
    if (error) { showToast('Could not send - please try again'); return; }
    closeModal(); showToast('Message sent - thank you!');
  }
}, true);

document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'googleBtn') await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  if (b.id === 'signOutBtn') { await sb.auth.signOut(); closeModal(); setView('Home'); }
  if (b.id === 'signUpBtn') {
    if (!authEmail.reportValidity() || !authPass.reportValidity()) return;
    const { error } = await sb.auth.signUp({ email: authEmail.value, password: authPass.value, options: { emailRedirectTo: location.origin + location.pathname } });
    authMsg.textContent = error ? error.message : 'Almost there - check your email to confirm your account.';
  }
});

sb.auth.onAuthStateChange((ev, session) => {
  user = session ? session.user : null;
  avatarBtn.textContent = user ? initialsOf(nameOf(user)) : '👤';
  if (ev === 'SIGNED_IN') closeModal();
  setTimeout(load, 0);
});

document.querySelector('main').insertAdjacentHTML('beforeend', '<footer class="site-footer"><a href="about.html">About</a><a href="privacy.html">Privacy Policy</a><a href="terms.html">Terms &amp; Conditions</a><a href="#" id="contactLink">Contact &amp; Support</a><span>© ZUZU</span></footer>');
if (location.hash === '#contact') openContact();

// ===== Profile, account page, drafts / scheduling / editing =====
document.getElementById('themeToggle')?.remove();   // theme switch now lives inside the Account page
function refreshAvatar() {
  const p = me || {};
  avatarBtn.textContent = user ? (p.avatar_url ? '' : initialsOf(p.display_name || nameOf(user))) : '👤';
  avatarBtn.style.backgroundImage = user && p.avatar_url ? cssUrl(p.avatar_url) : '';
  avatarBtn.style.backgroundSize = 'cover'; avatarBtn.style.backgroundPosition = 'center';
}

function renderAccountPage() {
  if (!user) { feedContainer.innerHTML = '<p style="padding:30px;color:var(--muted)">Please sign in to see your account.</p>'; return; }
  const p = me || {}, name = p.display_name || nameOf(user);
  const row = s => '<div class="mini-row"><div style="flex:1;min-width:180px"><b>' + escapeHtml(s.title) + '</b><div style="font-size:12.5px;color:var(--muted);margin-top:4px"><span class="badge">' + s.state + '</span> ' +
    (s.state === 'Scheduled' ? 'goes live ' + escapeHtml(new Date(s.publishAt).toLocaleString()) : escapeHtml(s.time)) + '</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="secondary-btn" data-act="edit" data-id="' + s.id + '">Edit</button>' +
    (s.state !== 'Live' ? '<button class="secondary-btn" data-act="pub" data-id="' + s.id + '">Publish now</button>' : '') +
    '<button class="secondary-btn" data-act="del" data-id="' + s.id + '">Delete</button></div></div>';
  feedContainer.innerHTML = '<div id="acctRoot"><div class="mini-row" style="padding:22px;gap:16px;justify-content:flex-start"><div class="avatar" style="width:72px;height:72px;font-size:24px;' +
    (p.avatar_url ? 'background-image:' + cssUrl(p.avatar_url) + ';background-size:cover;background-position:center;color:transparent' : '') + '">' + escapeHtml(initialsOf(name)) + '</div>' +
    '<div style="flex:1;min-width:180px"><h2 style="font-size:22px">' + escapeHtml(name) + '</h2><p style="color:var(--muted);font-size:13.5px">' + (p.username ? '@' + escapeHtml(p.username) + ' · ' : '') + escapeHtml(user.email || '') + '</p>' +
    (p.bio ? '<p style="margin-top:6px;font-size:14px">' + escapeHtml(p.bio) + '</p>' : '') + '</div></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;margin:14px 0 26px"><button class="primary-btn" data-act="profile">Edit profile</button><button class="secondary-btn" data-act="theme">Dark / Light mode</button><button class="secondary-btn" id="signOutBtn">Sign out</button></div>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><h3>Your writings (' + allMine.length + ')</h3><button class="primary-btn" data-act="write">Write new story</button></div>' +
    (allMine.length ? allMine.map(row).join('') : '<p style="color:var(--muted)">Nothing yet. Your first story is one tap away.</p>') + '</div>';
}

function openProfile() {
  const p = me || {};
  openModal('<div class="modal-head"><h2>Edit profile</h2><button class="btn-close" id="closeModalBtn">✕</button></div><form id="profileForm">' +
    '<div class="form-field"><label>DISPLAY NAME</label><input id="pName" required maxlength="60" value="' + escapeHtml(p.display_name || nameOf(user)) + '"></div>' +
    '<div class="form-field"><label>USERNAME (a-z, 0-9, _ · 3 to 20)</label><input id="pUser" pattern="[a-z0-9_]{3,20}" maxlength="20" value="' + escapeHtml(p.username || '') + '"></div>' +
    '<div class="form-field"><label>BIO</label><textarea id="pBio" maxlength="300">' + escapeHtml(p.bio || '') + '</textarea></div>' +
    '<div class="form-field"><label>PROFILE PHOTO LINK (https://…, square works best)</label><input id="pPic" type="url" value="' + escapeHtml(p.avatar_url || '') + '"></div>' +
    '<button class="primary-btn" type="submit">Save profile</button></form>');
}

let editing = null;
function openWriter(story) {
  editing = story && story.id ? story : null;
  const s = editing || {};
  const when = s.state === 'Scheduled' ? new Date(new Date(s.publishAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  const cats = ['Essays', 'Stories', 'Technology', 'Life', 'Culture', 'Travel', 'Urdu'].map(c => '<option' + (c === s.category ? ' selected' : '') + '>' + c + '</option>').join('');
  openModal('<div class="modal-head"><h2>' + (editing ? 'Edit your story' : 'Write a story') + '</h2><button class="btn-close" id="closeModalBtn">✕</button></div><form id="writerForm">' +
    '<div class="form-field"><label>STORY TITLE</label><input id="postTitle" required maxlength="120" value="' + escapeHtml(s.title || '') + '"></div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px"><div class="form-field"><label>TOPIC</label><select id="postCategory">' + cats + '</select></div>' +
    '<div class="form-field"><label>COVER IMAGE LINK (OPTIONAL)</label><input id="postImage" type="url" placeholder="https://… (3:2 works best)" value="' + escapeHtml(s.rawImage || '') + '"></div></div>' +
    '<div class="form-field"><label>STORY BODY</label><textarea id="postBody" required>' + escapeHtml(s.body || '') + '</textarea></div>' +
    '<div class="form-field"><label>PUBLISH LATER? PICK A DATE &amp; TIME (OPTIONAL)</label><input id="postWhen" type="datetime-local" value="' + when + '"></div>' +
    '<div style="display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:10px"><button type="button" class="secondary-btn" id="closeModalBtn2">Cancel</button>' +
    '<button type="submit" value="draft" class="secondary-btn">Save draft</button><button type="submit" value="publish" class="primary-btn">' + (editing && editing.state === 'Live' ? 'Update story' : 'Publish ↗') + '</button></div></form>');
}

async function saveStory(e) {
  const draft = e.submitter && e.submitter.value === 'draft', ed = editing;
  const g = id => document.getElementById(id).value.trim();
  const img = g('postImage'), body = g('postBody'), when = g('postWhen');
  const nowIso = new Date().toISOString();
  const row = {
    title: g('postTitle'), category: postCategory.value, body, excerpt: body.slice(0, 140) + (body.length > 140 ? '...' : ''),
    read_min: Math.max(1, Math.ceil(body.split(/\s+/).length / 190)), image_url: /^https:\/\/\S+$/i.test(img) ? img : null,
    status: draft ? 'draft' : 'published',
    publish_at: draft ? (ed ? ed.publishAt : nowIso) : when ? new Date(when).toISOString() : (ed && ed.state === 'Live' ? ed.publishAt : nowIso),
    edited_at: ed ? nowIso : null
  };
  const r = ed ? await sb.from('stories').update(row).eq('id', ed.id).select()
               : await sb.from('stories').insert({ ...row, author_id: user.id, author_name: (me && me.display_name) || nameOf(user) }).select();
  if (r.error || !r.data || !r.data.length) { showToast(ed ? 'Could not save - editing closes 24 hours after publishing' : 'Could not save'); return; }
  closeModal(); await load();
  showToast(draft ? 'Draft saved' : new Date(row.publish_at) > new Date() ? 'Story scheduled' : ed ? 'Story updated' : 'Story published!');
  setView('Account');
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const id = Number(b.dataset.id), s = allMine.find(x => x.id === id), a = b.dataset.act;
  if (a === 'write') openWriter();
  if (a === 'edit' && s) openWriter(s);
  if (a === 'profile') openProfile();
  if (a === 'theme') { const n = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', n); store.set('zuzu_theme', n); }
  if (a === 'del' && s && confirm('Delete "' + s.title + '" permanently?')) { await sb.from('stories').delete().eq('id', id); await load(); showToast('Story deleted'); }
  if (a === 'pub' && s) { await sb.from('stories').update({ status: 'published', publish_at: new Date().toISOString() }).eq('id', id); await load(); showToast('Published!'); }
});
