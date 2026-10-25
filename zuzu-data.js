/* ZUZU <-> Supabase layer. Loaded after the main script and shares its globals. */
const sb = supabase.createClient(ZUZU_CONFIG.url, ZUZU_CONFIG.key);
let user = null, queue = Promise.resolve();
const known = { ids: new Set(), liked: new Set(), saved: new Set(), comments: new Map() };
const nameOf = u => (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || (u.email || 'Reader').split('@')[0];
const initialsOf = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function load() {
  const { data, error } = await sb.from('stories').select('*, likes(count), comments(author_name,text,created_at)').order('created_at', { ascending: false }).limit(100);
  if (error) { showToast('Could not load stories'); return; }
  stories = data.map(r => ({
    id: r.id, title: r.title, category: r.category, author: r.author_name, initials: initialsOf(r.author_name),
    time: fmt(r.created_at), read: r.read_min, likes: r.likes[0] ? r.likes[0].count : 0,
    comments: r.comments.sort((a, b) => (a.created_at < b.created_at ? -1 : 1)).map(c => ({ author: c.author_name, text: c.text })),
    excerpt: r.excerpt, image: r.image_url || PLACEHOLDER, body: r.body
  }));
  known.ids = new Set(stories.map(s => s.id));
  known.comments = new Map(stories.map(s => [s.id, s.comments.length]));
  likedIds = new Set(); savedIds = new Set();
  if (user) {
    const [l, v] = await Promise.all([sb.from('likes').select('story_id').eq('user_id', user.id), sb.from('saves').select('story_id').eq('user_id', user.id)]);
    likedIds = new Set((l.data || []).map(x => x.story_id)); savedIds = new Set((v.data || []).map(x => x.story_id));
  }
  known.liked = new Set(likedIds); known.saved = new Set(savedIds);
  renderFeed();
}

// The page changes local state, then calls saveStorage(); we push the differences to Supabase.
async function sync() {
  if (!user) return;
  const name = nameOf(user);
  for (const s of stories.filter(s => !known.ids.has(s.id))) {
    await sb.from('stories').insert({ author_id: user.id, author_name: name, title: s.title, category: s.category, excerpt: s.excerpt, body: s.body, image_url: /^https:\/\/\S+$/i.test(s.image) ? s.image : null, read_min: s.read });
  }
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
  if (t.closest('#avatarBtn') || (!user && t.closest('[data-like],[data-save],[data-view="Write"],[data-view="Account"]'))) {
    e.preventDefault(); e.stopImmediatePropagation(); openAuth();
  } else if (t.closest('#contactLink')) { e.preventDefault(); openContact(); }
}, true);

document.addEventListener('submit', async e => {
  const f = e.target;
  if (!user && f.id === 'commentForm') { e.preventDefault(); e.stopImmediatePropagation(); openAuth(); return; }
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
  if (b.id === 'signOutBtn') { await sb.auth.signOut(); closeModal(); }
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
