const SUPABASE_URL = 'https://tvxugmumfvgnvjacwwfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2eHVnbXVtZnZnbnZqYWN3d2Z6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NjQ1MzEsImV4cCI6MjA5NjM0MDUzMX0.76wR9dblt8W9u-OioqQH7NOethNq1BMfjTDl9xcpYYI';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true }
});

const app = document.getElementById('app');
let currentUser = null;
let currentView = 'feed'; 
let selectedImageFile = null;
let devTip = "Use `git commit --amend` to modify your most recent commit without creating a new one.";
let activeChatUser = null;
let selectedPostType = 'post';
let searchTimeout = null;
let verifyMethod = 'dns';

async function fetchDevTip() {
    try {
        const { data, error } = await sb.functions.invoke('groq-tip');
        if (!error && data.tip) {
            devTip = data.tip;
            const tipElement = document.getElementById('dev-tip-text');
            if (tipElement) tipElement.innerText = devTip;
        }
    } catch (e) {}
}

async function checkAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        let { data: profile } = await sb.from('csns_profiles').select('*').eq('id', session.user.id).single();
        if (!profile) {
            const meta = session.user.user_metadata;
            const username = meta.user_name || meta.full_name || session.user.email.split('@')[0];
            const { data: newProfile } = await sb.from('csns_profiles').insert({
                id: session.user.id, username, full_name: meta.full_name || username,
                avatar_url: meta.avatar_url, github_url: `https://github.com/${meta.user_name}`
            }).select().single();
            profile = newProfile;
        }
        
        if (session.user.email.endsWith('@360-search.com') && !profile.is_premium) {
            const { data: updated } = await sb.from('csns_profiles').update({ is_premium: true, is_verified: true }).eq('id', session.user.id).select().single();
            profile = updated;
        }
        
        currentUser = profile;
    } else {
        currentUser = null;
    }
    renderApp();
}

window.loginWithGithub = async function() {
    const redirectUrl = window.location.origin + window.location.pathname;
    await sb.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: redirectUrl } });
}

window.loginWithGitlab = async function() {
    const redirectUrl = window.location.origin + window.location.pathname;
    await sb.auth.signInWithOAuth({ provider: 'gitlab', options: { redirectTo: redirectUrl } });
}

window.logout = async function() {
    await sb.auth.signOut();
    currentUser = null;
    currentView = 'feed';
    renderApp();
}

sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && !currentUser) checkAuth();
    else if (event === 'SIGNED_OUT') checkAuth();
});

// ==========================================
// HELPERS & INTEGRATIONS
// ==========================================
async function createNotification(actorId, userId, type, postId = null) {
    if (actorId === userId) return;
    await sb.from('csns_notifications').insert({ actor_id: actorId, user_id: userId, type, post_id: postId });
}

async function fetchTrendingRepos() {
    try {
        const date = new Date();
        date.setDate(date.getDate() - 7);
        const dateStr = date.toISOString().split('T')[0];
        const res = await fetch(`https://api.github.com/search/repositories?q=created:>${dateStr}&sort=stars&order=desc&per_page=3`);
        const data = await res.json();
        const trendEl = document.getElementById('trending-repos');
        if (trendEl && data.items) {
            trendEl.innerHTML = data.items.map(r => `
                <div class="trend-item">
                    <div class="font-mono" style="color: var(--accent-primary); font-size: 0.9rem;">${r.full_name}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem; display: flex; align-items: center; gap: 0.5rem;">
                        <svg style="width: 12px; height: 12px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 18.896l-7.416 3.917 1.48-8.279L0 8.306l8.332-1.151z"/></svg>
                        ${r.stargazers_count} - ${r.description ? r.description.substring(0, 30) + '...' : 'No desc'}
                    </div>
                </div>
            `).join('');
        }
    } catch (e) {}
}

async function fetchNotifications() {
    if (!currentUser) return [];
    const { data } = await sb.from('csns_notifications').select('*, actor:actor_id(*)').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(15);
    return data || [];
}

// FIX: Runs after HTML is rendered to fetch repo stats
async function initRepoStats() {
    const embeds = document.querySelectorAll('.repo-embed[data-owner]');
    for (const el of embeds) {
        const owner = el.dataset.owner;
        const repo = el.dataset.repo;
        const statsEl = el.querySelector('.repo-stats');
        if (!statsEl || statsEl.dataset.loaded) continue;
        statsEl.dataset.loaded = 'true';
        
        try {
            const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
            if (!res.ok) continue;
            const data = await res.json();
            statsEl.innerHTML = `
                <span class="repo-stat"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg> ${data.stargazers_count}</span>
                <span class="repo-stat"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:14px;height:14px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" /></svg> ${data.forks_count}</span>
                <span class="repo-stat" style="color: ${data.language ? '#a855f7' : '#fff'};">${data.language || 'Code'}</span>
            `;
        } catch (e) {}
    }
}

window.toggleNotifDropdown = async function(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('notif-dropdown');
    if (dropdown.classList.contains('active')) {
        dropdown.classList.remove('active');
        return;
    }
    dropdown.classList.add('active');
    dropdown.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Loading...</div>';
    const notifs = await fetchNotifications();
    if (notifs.length === 0) {
        dropdown.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No notifications yet.</div>';
        return;
    }
    dropdown.innerHTML = notifs.map(n => `
        <div class="notif-item ${!n.read ? 'unread' : ''}" onclick="handleNotifClick('${n.id}', '${n.type}', '${n.post_id || ''}', '${n.actor_id}')">
            <img src="${n.actor?.avatar_url || `https://ui-avatars.com/api/?name=${n.actor?.username}`}" class="post-avatar" style="width: 32px; height: 32px;">
            <div style="flex: 1;">
                <span style="font-weight: 700;">@${n.actor?.username}</span> ${n.type === 'like' ? 'liked your post' : n.type === 'comment' ? 'commented on your post' : n.type === 'follow' ? 'followed you' : 'sent you a message'}
            </div>
            ${!n.read ? '<div class="notif-dot"></div>' : ''}
        </div>
    `).join('');
    const unreadIds = notifs.filter(n => !n.read).map(n => n.id);
    if (unreadIds.length > 0) await sb.from('csns_notifications').update({ read: true }).in('id', unreadIds);
}

window.handleNotifClick = async function(id, type, postId, actorId) {
    document.getElementById('notif-dropdown').classList.remove('active');
    if (type === 'follow') { currentView = `profile_${actorId}`; renderApp(); }
    else if (type === 'message') { activeChatUser = actorId; currentView = 'messages'; renderApp(); }
    else if (postId) { currentView = 'feed'; renderApp(); setTimeout(() => toggleComments(postId), 500); }
}

// ==========================================
// ACTIONS
// ==========================================
window.setPostType = function(type) {
    selectedPostType = type;
    document.querySelectorAll('.type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === type));
}

window.handleImageSelect = function(input) {
    if (input.files && input.files[0]) {
        selectedImageFile = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('image-preview').src = e.target.result;
            document.getElementById('image-preview').style.display = 'block';
        };
        reader.readAsDataURL(selectedImageFile);
    }
}

window.handlePost = async function(parentId = null, isRepost = false) {
    let content = '';
    let postType = 'post';
    if (!parentId) {
        content = document.getElementById('post-content').value;
        postType = selectedPostType;
    } else {
        if (!isRepost) content = document.getElementById('quote-content').value;
    }
    if (!content.trim() && !isRepost) return;

    let imageUrl = null;
    if (selectedImageFile && !parentId) {
        const fileName = `${Date.now()}_${selectedImageFile.name}`;
        const { data: uploadData } = await sb.storage.from('post_images').upload(fileName, selectedImageFile);
        if (uploadData) imageUrl = sb.storage.from('post_images').getPublicUrl(fileName).data.publicUrl;
        selectedImageFile = null;
    }

    const { data: newPost, error } = await sb.from('csns_posts').insert({
        content, user_id: currentUser.id, image_url: imageUrl,
        parent_post_id: parentId, is_repost: isRepost, post_type: postType
    }).select('id, user_id').single();

    if (error) return;

    if (!parentId) {
        const repoUrl = document.getElementById('repo-url').value;
        if (repoUrl) {
            try {
                const u = new URL(repoUrl);
                const parts = u.pathname.split('/').filter(Boolean);
                if (parts.length >= 2 && (u.hostname.includes('github') || u.hostname.includes('gitlab'))) {
                    const platform = u.hostname.includes('github') ? 'github' : 'gitlab';
                    await sb.from('csns_post_repos').insert({ post_id: newPost.id, platform, owner: parts[0], repo_name: parts[1], repo_url: repoUrl });
                }
            } catch(e) {}
        }
    }
    if (parentId) {
        const { data: parentPost } = await sb.from('csns_posts').select('user_id').eq('id', parentId).single();
        if (parentPost) createNotification(currentUser.id, parentPost.user_id, isRepost ? 'repost' : 'comment', parentId);
    }
    closeQuoteModal();
    renderApp();
}

window.handleLike = async function(postId, isLiked, ownerId) {
    if (!currentUser) return alert('Please login to like posts.');
    if (isLiked) await sb.from('csns_likes').delete().match({ post_id: postId, user_id: currentUser.id });
    else {
        await sb.from('csns_likes').insert({ post_id: postId, user_id: currentUser.id });
        createNotification(currentUser.id, ownerId, 'like', postId);
    }
    renderApp();
}

window.handleBookmark = async function(postId, isSaved) {
    if (!currentUser) return alert('Please login to save posts.');
    if (isSaved) await sb.from('csns_bookmarks').delete().match({ post_id: postId, user_id: currentUser.id });
    else await sb.from('csns_bookmarks').insert({ post_id: postId, user_id: currentUser.id });
    renderApp();
}

window.handleFollow = async function(targetId, isFollowing) {
    if (!currentUser) return;
    if (isFollowing) await sb.from('csns_follows').delete().match({ follower_id: currentUser.id, following_id: targetId });
    else {
        await sb.from('csns_follows').insert({ follower_id: currentUser.id, following_id: targetId });
        createNotification(currentUser.id, targetId, 'follow');
    }
    renderApp();
}

window.copyCode = function(btn) {
    navigator.clipboard.writeText(btn.previousElementSibling.innerText);
    btn.innerText = 'Copied!';
    setTimeout(() => btn.innerText = 'Copy', 2000);
}

window.showQuoteModal = function(postId, isRepost) {
    const modal = document.getElementById('quote-modal');
    modal.style.display = 'flex';
    modal.dataset.postId = postId;
    modal.dataset.isRepost = isRepost;
    document.getElementById('quote-content').style.display = isRepost ? 'none' : 'block';
}

window.closeQuoteModal = function() { document.getElementById('quote-modal').style.display = 'none'; }
window.submitQuote = function() {
    const modal = document.getElementById('quote-modal');
    handlePost(modal.dataset.postId, modal.dataset.isRepost === 'true');
}

window.toggleComments = async function(postId) {
    const section = document.getElementById(`comments-${postId}`);
    if (section.style.display === 'none' || !section.innerHTML) {
        section.style.display = 'block';
        section.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Loading...</div>';
        const { data: comments } = await sb.from('csns_comments').select('*, csns_profiles:user_id (*)').eq('post_id', postId).order('created_at', { ascending: true });
        let html = comments.map(c => `
            <div class="comment-item">
                <img src="${c.csns_profiles?.avatar_url || `https://ui-avatars.com/api/?name=${c.csns_profiles?.username}`}" class="post-avatar" style="width: 32px; height: 32px;">
                <div>
                    <div style="display: flex; gap: 0.5rem; align-items: center;">
                        <span style="font-weight: 700; font-size: 0.9rem;">${c.csns_profiles?.full_name || c.csns_profiles?.username}</span>
                        <span style="font-size: 0.8rem; color: var(--text-muted);" class="font-mono">@${c.csns_profiles?.username}</span>
                    </div>
                    <p style="color: var(--text-secondary); margin-top: 0.25rem; font-size: 0.9rem;">${c.content}</p>
                </div>
            </div>
        `).join('');
        if (currentUser) html += `<div class="comment-input-area"><input id="comment-input-${postId}" type="text" placeholder="Tweet your reply..."><button onclick="submitComment('${postId}')" class="btn btn-primary btn-sm">Reply</button></div>`;
        section.innerHTML = html || '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No comments yet.</div>';
    } else {
        section.style.display = 'none';
    }
}

window.submitComment = async function(postId, ownerId) {
    const input = document.getElementById(`comment-input-${postId}`);
    if (!input.value.trim()) return;
    await sb.from('csns_comments').insert({ post_id: postId, user_id: currentUser.id, content: input.value });
    createNotification(currentUser.id, ownerId, 'comment', postId);
    toggleComments(postId);
    setTimeout(() => toggleComments(postId), 200);
}

window.updateDnsHost = function(domain) {
    if (domain && domain.trim() !== '') {
        document.getElementById('dns-info').style.display = 'block';
        document.getElementById('dns-host').innerText = `_codesns.${domain}`;
    } else {
        document.getElementById('dns-info').style.display = 'none';
    }
}

window.setVerifyMethod = function(method) {
    verifyMethod = method;
    document.querySelectorAll('.verify-method-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('dns-instructions').style.display = method === 'dns' ? 'block' : 'none';
    document.getElementById('html-instructions').style.display = method === 'html' ? 'block' : 'none';
}

window.copyDnsValue = function(type = 'dns') {
    const value = document.getElementById(type === 'html' ? 'html-txt' : 'dns-txt').innerText;
    navigator.clipboard.writeText(value);
    alert('Copied to clipboard!');
}

window.showEditProfile = function() {
    document.getElementById('edit-modal').style.display = 'flex';
    document.getElementById('edit-fullname').value = currentUser.full_name || '';
    document.getElementById('edit-bio').value = currentUser.bio || '';
    document.getElementById('edit-avatar-url').value = currentUser.avatar_url || '';
    document.getElementById('edit-banner-url').value = currentUser.banner_url || '';
    document.getElementById('edit-linkedin').value = currentUser.linkedin_url || '';
    document.getElementById('edit-twitter').value = currentUser.twitter_url || '';
    document.getElementById('edit-gitlab').value = currentUser.gitlab_url || '';
    document.getElementById('edit-domain').value = currentUser.custom_domain || '';
    
    document.getElementById('dns-txt').innerText = `codesns-verify=${currentUser.id}`;
    document.getElementById('html-txt').innerText = `codesns-verify=${currentUser.id}`;
    
    if (currentUser.custom_domain && !currentUser.domain_verified) {
        document.getElementById('dns-info').style.display = 'block';
        document.getElementById('dns-host').innerText = `_codesns.${currentUser.custom_domain}`;
    } else {
        document.getElementById('dns-info').style.display = 'none';
    }
}

window.closeEditProfile = function() { document.getElementById('edit-modal').style.display = 'none'; }

window.saveProfile = async function() {
    const { data } = await sb.from('csns_profiles').update({ 
        full_name: document.getElementById('edit-fullname').value, 
        bio: document.getElementById('edit-bio').value, 
        avatar_url: document.getElementById('edit-avatar-url').value,
        banner_url: document.getElementById('edit-banner-url').value,
        linkedin_url: document.getElementById('edit-linkedin').value,
        twitter_url: document.getElementById('edit-twitter').value,
        gitlab_url: document.getElementById('edit-gitlab').value,
        custom_domain: document.getElementById('edit-domain').value
    }).eq('id', currentUser.id).select().single();
    currentUser = data;
    closeEditProfile();
    renderApp();
}

window.verifyDomain = async function() {
    const btn = document.getElementById('verify-btn');
    const statusEl = document.getElementById('dns-status');
    const domainInput = document.getElementById('edit-domain').value;
    
    if (!domainInput) return alert("Please enter a domain first.");
    
    btn.innerText = 'Verifying...';
    statusEl.style.display = 'block';
    statusEl.className = 'dns-status';
    statusEl.innerText = 'Checking records...';
    
    try {
        const { data, error } = await sb.functions.invoke('verify-domain', {
            body: { domain: domainInput, userId: currentUser.id, method: verifyMethod },
            method: 'POST'
        });
        
        if (error) throw new Error(error.message || 'Failed to verify domain.');
        
        if (data && data.success) {
            statusEl.className = 'dns-status success';
            statusEl.innerText = 'Domain verified successfully!';
            currentUser.domain_verified = true;
            currentUser.custom_domain = domainInput;
            setTimeout(() => { closeEditProfile(); renderApp(); }, 1500);
        } else {
            throw new Error(data?.error || 'Verification failed.');
        }
    } catch (error) {
        statusEl.className = 'dns-status error';
        statusEl.innerText = error.message;
        btn.innerText = 'Verify Domain';
    }
}

window.startDm = function(userId) { if (!currentUser) return; activeChatUser = userId; currentView = 'messages'; renderApp(); }
window.selectConversation = function(userId) { activeChatUser = userId; renderMessages(); }
window.sendDm = async function() {
    const input = document.getElementById('dm-input');
    if (!input.value.trim() || !activeChatUser) return;
    await sb.from('csns_messages').insert({ sender_id: currentUser.id, receiver_id: activeChatUser, content: input.value });
    createNotification(currentUser.id, activeChatUser, 'message');
    input.value = '';
    renderMessages();
}

window.handleSearchInput = function(e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    const resultsDiv = document.getElementById('search-results');
    if (!query) { resultsDiv.style.display = 'none'; return; }
    searchTimeout = setTimeout(async () => {
        resultsDiv.style.display = 'block';
        resultsDiv.innerHTML = '<div class="search-item">Searching...</div>';
        const cleanQuery = query.replace('@', '');
        const { data } = await sb.from('csns_profiles').select('*').ilike('username', `%${cleanQuery}%`).limit(5);
        if (!data || data.length === 0) resultsDiv.innerHTML = '<div class="search-item">No users found.</div>';
        else resultsDiv.innerHTML = data.map(u => `
            <div class="search-item" onclick="currentView='profile_${u.id}'; renderApp(); document.getElementById('search-results').style.display='none';">
                <img src="${u.avatar_url || `https://ui-avatars.com/api/?name=${u.username}`}" class="post-avatar" style="width: 32px; height: 32px;">
                <div><div style="font-weight: 700; font-size: 0.9rem;">${u.full_name || u.username}</div><div style="font-size: 0.8rem; color: var(--text-muted);" class="font-mono">@${u.username}</div></div>
            </div>
        `).join('');
    }, 300);
}

// ==========================================
// RENDERING
// ==========================================
async function renderApp() {
    if (currentView.startsWith('profile_')) await renderProfile(currentView.split('_')[1]);
    else if (currentView === 'news') await renderNews();
    else if (currentView === 'following') await renderFollowing();
    else if (currentView === 'messages') await renderMessages();
    else if (currentView === 'saved') await renderSaved();
    else await renderFeed();
}

function renderLayout(centerContent, activeNav = 'home') {
    const avatarUrl = currentUser?.avatar_url || `https://ui-avatars.com/api/?name=${currentUser?.username || 'Guest'}`;
    return `
        <div class="main-layout" onclick="document.getElementById('notif-dropdown')?.classList.remove('active'); document.getElementById('search-results')?.style.setProperty('display', 'none')">
            <div id="edit-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content" style="max-height: 90vh; overflow-y: auto;">
                    <div class="modal-header"><h2 class="modal-title">Edit Profile</h2><button class="modal-close" onclick="closeEditProfile()">&times;</button></div>
                    <div class="modal-input-group"><label class="modal-label">Full Name</label><input id="edit-fullname" type="text" class="modal-input"></div>
                    <div class="modal-input-group"><label class="modal-label">Bio</label><textarea id="edit-bio" class="banner-input"></textarea></div>
                    <div class="modal-input-group"><label class="modal-label">Avatar Image URL</label><input id="edit-avatar-url" type="text" class="modal-input" placeholder="https://..."></div>
                    <div class="modal-input-group"><label class="modal-label">Banner Image URL</label><input id="edit-banner-url" type="text" class="modal-input" placeholder="https://..."></div>
                    <div class="modal-input-group"><label class="modal-label">GitHub URL</label><input id="edit-github" type="text" class="modal-input" placeholder="https://github.com/..." value="${currentUser?.github_url || ''}"></div>
                    <div class="modal-input-group"><label class="modal-label">GitLab URL</label><input id="edit-gitlab" type="text" class="modal-input" placeholder="https://gitlab.com/..."></div>
                    
                    <div class="modal-input-group"><label class="modal-label">Custom Domain (Premium)</label><input id="edit-domain" type="text" class="modal-input" placeholder="yourdomain.com" oninput="updateDnsHost(this.value)">
                    <div id="dns-info" style="display: none; margin-top: 1rem; border-top: 1px solid var(--border-light); padding-top: 1rem;">
                        <h3 style="font-size: 0.9rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-primary);">Domain Verification</h3>
                        <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
                            <button class="verify-method-btn active" onclick="setVerifyMethod('dns')">DNS TXT</button>
                            <button class="verify-method-btn" onclick="setVerifyMethod('html')">HTML File</button>
                        </div>
                        
                        <div id="dns-instructions">
                            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">Add a <strong>TXT record</strong> to your domain's DNS settings.</p>
                            <div style="display: grid; grid-template-columns: 100px 1fr; gap: 0.5rem; font-size: 0.8rem; margin-bottom: 1rem; align-items: center;">
                                <span style="color: var(--text-muted);">Record Type:</span>
                                <span class="dns-info-box" style="margin:0; padding: 4px 8px;">TXT</span>
                                <span style="color: var(--text-muted);">Name/Host:</span>
                                <span id="dns-host" class="dns-info-box" style="margin:0; padding: 4px 8px;">_codesns.yourdomain.com</span>
                                <span style="color: var(--text-muted);">Value:</span>
                                <div style="display:flex; align-items:center; gap:0.5rem;">
                                    <span id="dns-txt" class="dns-info-box" style="margin:0; padding: 4px 8px; flex:1;">codesns-verify=...</span>
                                    <button onclick="copyDnsValue('dns')" class="btn btn-ghost btn-sm" style="padding: 4px 8px;">Copy</button>
                                </div>
                            </div>
                        </div>

                        <div id="html-instructions" style="display: none;">
                            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.75rem;">Create an HTML file and upload it to your website's root directory.</p>
                            <div style="display: grid; grid-template-columns: 100px 1fr; gap: 0.5rem; font-size: 0.8rem; margin-bottom: 1rem; align-items: center;">
                                <span style="color: var(--text-muted);">File Name:</span>
                                <span class="dns-info-box" style="margin:0; padding: 4px 8px;">codesns-verify.html</span>
                                <span style="color: var(--text-muted);">Content:</span>
                                <div style="display:flex; align-items:center; gap:0.5rem;">
                                    <span id="html-txt" class="dns-info-box" style="margin:0; padding: 4px 8px; flex:1;">codesns-verify=...</span>
                                    <button onclick="copyDnsValue('html')" class="btn btn-ghost btn-sm" style="padding: 4px 8px;">Copy</button>
                                </div>
                            </div>
                        </div>

                        <button id="verify-btn" class="btn btn-primary btn-sm" style="width: 100%;" onclick="verifyDomain()">Verify Domain</button>
                        <div id="dns-status" class="dns-status" style="display: none; text-align: center;"></div>
                    </div></div>
                    
                    <div class="modal-input-group"><label class="modal-label">LinkedIn URL</label><input id="edit-linkedin" type="text" class="modal-input" placeholder="https://linkedin.com/in/..."></div>
                    <div class="modal-input-group"><label class="modal-label">Twitter URL</label><input id="edit-twitter" type="text" class="modal-input" placeholder="https://twitter.com/..."></div>
                    
                    <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;"><button class="btn btn-ghost btn-sm" onclick="closeEditProfile()">Cancel</button><button class="btn btn-primary btn-sm" onclick="saveProfile()">Save</button></div>
                </div>
            </div>
            <div id="quote-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content"><div class="modal-header"><h2 class="modal-title">Quote Post</h2><button class="modal-close" onclick="closeQuoteModal()">&times;</button></div>
                <textarea id="quote-content" class="modal-input modal-textarea" placeholder="Add a comment..." rows="4"></textarea>
                <div style="display: flex; justify-content: flex-end; margin-top: 1rem;"><button class="btn btn-primary btn-sm" onclick="submitQuote()">Post</button></div></div>
            </div>

            <aside class="left-sidebar">
                <div class="logo">⚡ CodeSNS</div>
                <nav style="flex: 1;">
                    <a class="nav-item ${activeNav === 'home' ? 'active' : ''}" onclick="currentView='feed'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg><span>Home</span></a>
                    <a class="nav-item ${activeNav === 'following' ? 'active' : ''}" onclick="currentView='following'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg><span>Following</span></a>
                    <a class="nav-item ${activeNav === 'saved' ? 'active' : ''}" onclick="currentView='saved'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg><span>Saved</span></a>
                    <a class="nav-item ${activeNav === 'news' ? 'active' : ''}" onclick="currentView='news'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg><span>Dev News</span></a>
                    <a class="nav-item ${activeNav === 'messages' ? 'active' : ''}" onclick="currentView='messages'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg><span>Messages</span></a>
                    ${currentUser ? `
                        <a class="nav-item ${activeNav === 'profile' ? 'active' : ''}" onclick="currentView='profile_${currentUser.id}'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg><span>Profile</span></a>
                        <a class="nav-item" onclick="showEditProfile()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg><span>Edit Profile</span></a>
                    ` : ''}
                </nav>
                ${currentUser ? `
                    <div style="position: relative; margin-bottom: 1rem;">
                        <div class="user-card" onclick="toggleNotifDropdown(event)">
                            <img src="${avatarUrl}" class="post-avatar" style="width: 40px; height: 40px;">
                            <div style="overflow: hidden;"><div style="font-weight: 700; font-size: 0.9rem;">${currentUser?.full_name}</div><div style="font-size: 0.8rem; color: var(--text-muted);" class="font-mono">Notifications</div></div>
                            <svg style="width: 20px; height: 20px; color: var(--accent-primary);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                        </div>
                        <div id="notif-dropdown" class="notif-dropdown"></div>
                    </div>
                    <div class="user-card" onclick="logout()" style="margin-top: 0;">
                        <div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
                            <svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                        </div>
                        <div style="overflow: hidden;"><div style="font-weight: 700; font-size: 0.9rem;">Logout</div></div>
                    </div>
                ` : `<div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: auto; padding: 0 0.5rem;"><button onclick="loginWithGithub()" class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;">GitHub</button><button onclick="loginWithGitlab()" class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;">GitLab</button></div>`}
            </aside>

            <main class="center-feed">${centerContent}</main>

            <aside class="right-sidebar">
                <div style="position: relative;">
                    <input type="text" class="search-box" placeholder="Search @users..." oninput="handleSearchInput(event)" onclick="event.stopPropagation()">
                    <div id="search-results" class="search-results" style="display: none;"></div>
                </div>
                <div class="widget"><h3 class="widget-title">🔥 Trending Repos</h3><div id="trending-repos"><div class="trend-item">Loading GitHub repos...</div></div></div>
                <div class="widget"><h3 class="widget-title">💡 AI Dev Tip</h3><p id="dev-tip-text" style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">${devTip}</p></div>
            </aside>
        </div>
    `;
}

async function fetchFeedPosts() {
    return await sb.from('csns_posts').select(`*, csns_profiles:user_id (*), csns_post_repos (*), csns_likes (user_id), csns_bookmarks (user_id), parent:parent_post_id (*, csns_profiles:user_id (*))`).order('created_at', { ascending: false });
}

async function renderFeed() {
    const { data: posts } = await fetchFeedPosts();
    const centerContent = `
        <header class="page-header"><h1 class="page-title">Home</h1></header>
        ${currentUser ? `
            <div class="composer fade-in">
                <img src="${currentUser.avatar_url || `https://ui-avatars.com/api/?name=${currentUser.username}`}" class="post-avatar">
                <div style="flex: 1;">
                    <div class="composer-types">
                        <button class="type-btn active" data-type="post" onclick="setPostType('post')">Post</button>
                        <button class="type-btn" data-type="review" onclick="setPostType('review')">Code Review</button>
                        <button class="type-btn" data-type="challenge" onclick="setPostType('challenge')">Challenge</button>
                    </div>
                    <textarea id="post-content" placeholder="What did you code today?" rows="3"></textarea>
                    <input id="repo-url" type="text" placeholder="Attach GitHub/GitLab repo link (optional)">
                    <div class="upload-btn-wrapper">
                        <label class="upload-btn"><svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span>Add Image</span><input id="image-upload" type="file" accept="image/*" style="display: none;" onchange="handleImageSelect(this)"></label>
                        <img id="image-preview" class="image-preview" style="display: none;" />
                    </div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 1rem;"><button onclick="handlePost()" class="btn btn-primary">Post Code</button></div>
                </div>
            </div>
        ` : `<div style="padding: 3rem 2rem; text-align: center; border-bottom: 1px solid var(--border-light);"><h2 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Welcome to CodeSNS</h2><p style="color: var(--text-muted); margin-bottom: 1.5rem;">Sign in to join the conversation.</p><div style="display: flex; gap: 0.75rem; justify-content: center;"><button onclick="loginWithGithub()" class="btn btn-ghost">GitHub</button><button onclick="loginWithGitlab()" class="btn btn-ghost">GitLab</button></div></div>`}
        <div id="feed">${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No posts yet.</div>'}</div>
    `;
    app.innerHTML = renderLayout(centerContent, 'home');
    fetchTrendingRepos();
    applySyntaxHighlighting();
    initRepoStats();
}

async function renderSaved() {
    if (!currentUser) { app.innerHTML = renderLayout('<div class="empty-state">Sign in to view saved posts.</div>', 'saved'); return; }
    const { data: bookmarks } = await sb.from('csns_bookmarks').select('post_id').eq('user_id', currentUser.id);
    const postIds = bookmarks.map(b => b.post_id);
    let posts = [];
    if (postIds.length > 0) {
        const { data } = await fetchFeedPosts();
        posts = data.filter(p => postIds.includes(p.id));
    }
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Saved Posts</h1></header><div id="feed">${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No saved posts yet.</div>'}</div>`, 'saved');
    fetchTrendingRepos();
    applySyntaxHighlighting();
    initRepoStats();
}

async function renderFollowing() {
    if (!currentUser) { app.innerHTML = renderLayout('<div class="empty-state">Sign in to see following feed.</div>', 'following'); return; }
    const { data: follows } = await sb.from('csns_follows').select('following_id').eq('follower_id', currentUser.id);
    const followingIds = follows.map(f => f.following_id);
    let posts = [];
    if (followingIds.length > 0) {
        const res = await fetchFeedPosts();
        posts = res.data.filter(p => followingIds.includes(p.user_id));
    }
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Following</h1></header><div id="feed">${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">Feed is empty.</div>'}</div>`, 'following');
    fetchTrendingRepos();
    applySyntaxHighlighting();
    initRepoStats();
}

async function renderNews() {
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Dev News</h1></header><div id="news-feed" style="padding: 1rem; text-align: center; color: var(--text-muted);">Fetching top tech articles...</div>`, 'news');
    fetchTrendingRepos();
    try {
        const res = await fetch('https://dev.to/api/articles?per_page=20&top=7');
        const items = await res.json();
        document.getElementById('news-feed').innerHTML = items.map(item => `
            <a href="${item.url}" target="_blank" class="news-item">${item.cover_image ? `<img src="${item.cover_image}" class="news-image" alt="${item.title}">` : ''}<div class="news-content"><div class="news-title">${item.title}</div><div class="news-meta"><span class="news-tag">#${item.tag_list[0] || 'dev'}</span><span>by ${item.user.name}</span></div></div></a>
        `).join('');
    } catch (e) { document.getElementById('news-feed').innerHTML = '<div style="padding: 2rem; text-align: center;">Failed to load news.</div>'; }
}

async function renderMessages() {
    if (!currentUser) { app.innerHTML = renderLayout('<div class="empty-state">Sign in to view messages.</div>', 'messages'); return; }
    const { data: messages } = await sb.from('csns_messages').select('*, sender:sender_id(*), receiver:receiver_id(*)').or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`).order('created_at', { ascending: false });
    const conversations = {};
    messages.forEach(msg => {
        const otherUser = msg.sender_id === currentUser.id ? msg.receiver : msg.sender;
        if (!conversations[otherUser.id]) conversations[otherUser.id] = { user: otherUser, lastMessage: msg };
    });
    const conversationList = Object.values(conversations).sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
    let chatHtml = `<div class="empty-state"><h3>Select a conversation</h3></div>`;
    if (activeChatUser) {
        const { data: chatMessages } = await sb.from('csns_messages').select('*, sender:sender_id(*)').or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChatUser}),and(sender_id.eq.${activeChatUser},receiver_id.eq.${currentUser.id})`).order('created_at', { ascending: true });
        const otherProfile = conversationList.find(c => c.user.id === activeChatUser)?.user || (await sb.from('csns_profiles').select('*').eq('id', activeChatUser).single()).data;
        chatHtml = `<div class="chat-window"><div class="chat-header"><img src="${otherProfile?.avatar_url || `https://ui-avatars.com/api/?name=${otherProfile?.username}`}" class="post-avatar" style="width: 32px; height: 32px;"><span>${otherProfile?.full_name || otherProfile?.username}</span></div><div class="chat-messages">${chatMessages.map(msg => `<div class="message-bubble ${msg.sender_id === currentUser.id ? 'message-sent' : 'message-received'}">${msg.content}</div>`).join('')}</div><div class="chat-input-area"><input id="dm-input" class="chat-input" placeholder="Type a message..." onkeypress="if(event.key==='Enter') sendDm()"><button onclick="sendDm()" class="btn btn-primary btn-sm">Send</button></div></div>`;
    }
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Messages</h1></header><div class="chat-layout"><div class="conversation-list">${conversationList.length > 0 ? conversationList.map(c => `<div class="conversation-item ${activeChatUser === c.user.id ? 'active' : ''}" onclick="selectConversation('${c.user.id}')"><img src="${c.user.avatar_url || `https://ui-avatars.com/api/?name=${c.user.username}`}" class="post-avatar" style="width: 40px; height: 40px;"><div style="overflow: hidden;"><div style="font-weight: 700; font-size: 0.9rem;">${c.user.full_name || c.user.username}</div><div style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.lastMessage.content}</div></div></div>`).join('') : '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No conversations.</div>'}</div>${chatHtml}</div>`, 'messages');
    fetchTrendingRepos();
}

async function renderProfile(profileId) {
    const { data: profile } = await sb.from('csns_profiles').select('*').eq('id', profileId).single();
    const res = await fetchFeedPosts();
    const posts = res.data.filter(p => p.user_id === profileId);
    let isFollowing = false;
    if (currentUser) { const { data } = await sb.from('csns_follows').select('*').match({ follower_id: currentUser.id, following_id: profileId }); isFollowing = data.length > 0; }
    
    let badgeHtml = '';
    let ghStatsHtml = '';
    let achievementsHtml = '';
    let totalLikes = 0;
    posts.forEach(p => totalLikes += p.csns_likes.length);

    let achievements = [];
    if (posts.length > 0) achievements.push({ name: 'First Post', icon: 'post' });
    if (totalLikes >= 10) achievements.push({ name: 'Getting Likes', icon: 'heart' });
    if (totalLikes >= 100) achievements.push({ name: 'Community Pillar', icon: 'star' });
    if (profile.is_premium) achievements.push({ name: 'Premium', icon: 'crown', class: 'premium' });
    if (profile.domain_verified) achievements.push({ name: 'Domain Owner', icon: 'globe' });
    if (profile.linkedin_url) achievements.push({ name: 'LinkedIn', icon: 'linkedin', class: 'social' });

    let metaItems = [];
    if (profile.github_url) metaItems.push(`<a href="${profile.github_url}" target="_blank" class="profile-meta-item"><svg fill="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg> GitHub</a>`);
    if (profile.gitlab_url) metaItems.push(`<a href="${profile.gitlab_url}" target="_blank" class="profile-meta-item"><svg fill="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path d="M23.955 13.587l-1.347-4.135-2.664-8.197a.455.455 0 00-.867 0L16.413 9.45H7.587L4.923 1.255a.455.455 0 00-.867 0L1.392 9.452.045 13.587a.924.924 0 00.331 1.023L12 23.054l11.624-8.443a.92.92 0 00.331-1.024"/></svg> GitLab</a>`);

    if (profile.github_url) {
        const ghUsername = profile.github_url.split('github.com/')[1];
        if (ghUsername) {
            try {
                const ghRes = await fetch(`https://api.github.com/users/${ghUsername}`);
                const ghData = await ghRes.json();
                const score = (ghData.followers || 0) + (ghData.public_repos || 0);
                let badgeClass = 'badge-junior'; let badgeText = 'Junior Dev';
                if (score > 50) { badgeClass = 'badge-mid'; badgeText = 'Mid Dev'; }
                if (score > 200) { badgeClass = 'badge-senior'; badgeText = 'Senior Dev'; }
                badgeHtml = `<span class="dev-badge ${badgeClass}">${badgeText}</span>`;
                
                ghStatsHtml = `
                    <div class="profile-stats-row">
                        <div class="profile-stat">${ghData.public_repos || 0}<span> Repositories</span></div>
                        <div class="profile-stat">${ghData.followers || 0}<span> Followers</span></div>
                        <div class="profile-stat">${ghData.following || 0}<span> Following</span></div>
                    </div>
                `;

                if (ghData.company) metaItems.push(`<div class="profile-meta-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg> ${ghData.company}</div>`);
                if (ghData.location) metaItems.push(`<div class="profile-meta-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg> ${ghData.location}</div>`);
                if (ghData.blog) metaItems.push(`<a href="${ghData.blog.startsWith('http') ? ghData.blog : 'https://' + ghData.blog}" target="_blank" class="profile-meta-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg> Website</a>`);
                
                const joinDate = new Date(ghData.created_at).toLocaleDateString([], { year: 'numeric', month: 'short' });
                metaItems.push(`<div class="profile-meta-item"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> Joined ${joinDate}</div>`);

                if (ghData.followers > 10) achievements.push({ name: 'GH Rising', icon: 'github', class: 'github' });
                if (ghData.public_repos > 10) achievements.push({ name: 'Prolific', icon: 'code', class: 'github' });
            } catch(e) {}
        }
    }

    const iconMap = {
        post: '<path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>',
        heart: '<path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>',
        star: '<path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>',
        crown: '<path d="m2 4 3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M8 20h8"/>',
        globe: '<path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>',
        github: '<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>',
        code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
        linkedin: '<path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-4 0v7h-4v-7a6 6 0 016-6zM2 9h4v12H2zM4 2a2 2 0 110 4 2 2 0 010-4z"/>'
    };

    achievementsHtml = `<div class="achievements-row">${achievements.map(a => `
        <div class="achievement-badge ${a.class || ''}">
            <div class="achievement-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMap[a.icon] || iconMap.post}</svg></div>
            <span class="achievement-name">${a.name}</span>
        </div>
    `).join('')}</div>`;

    const verifiedHtml = profile.is_verified ? `<span class="verified-badge"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : '';
    const premiumHtml = profile.is_premium ? `<span class="premium-badge"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z"/></svg></span>` : '';
    
    let socialsHtml = '';
    if (profile.linkedin_url || profile.twitter_url || profile.github_url) {
        socialsHtml = `<div class="social-links">`;
        if (profile.github_url) socialsHtml += `<a href="${profile.github_url}" target="_blank" class="social-link"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg></a>`;
        if (profile.gitlab_url) socialsHtml += `<a href="${profile.gitlab_url}" target="_blank" class="social-link"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M23.955 13.587l-1.347-4.135-2.664-8.197a.455.455 0 00-.867 0L16.413 9.45H7.587L4.923 1.255a.455.455 0 00-.867 0L1.392 9.452.045 13.587a.924.924 0 00.331 1.023L12 23.054l11.624-8.443a.92.92 0 00.331-1.024"/></svg></a>`;
        if (profile.linkedin_url) socialsHtml += `<a href="${profile.linkedin_url}" target="_blank" class="social-link"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/></svg></a>`;
        if (profile.twitter_url) socialsHtml += `<a href="${profile.twitter_url}" target="_blank" class="social-link"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></a>`;
        socialsHtml += `</div>`;
    }

    const centerContent = `
        <header class="page-header"><span class="header-back" onclick="currentView='feed'; renderApp()"><svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg></span><div><h1 class="page-title">${profile.full_name || profile.username}</h1><div class="header-subtitle">${posts.length} Posts</div></div></header>
        <div class="profile-header fade-in">
            <div class="profile-banner" style="${profile.banner_url ? `background-image: url('${profile.banner_url}')` : ''}"></div>
            <div class="profile-avatar-wrapper"><img src="${profile.avatar_url || `https://ui-avatars.com/api/?name=${profile.username}`}" class="profile-avatar-main">
            ${currentUser && currentUser.id !== profileId ? `<div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;"><button onclick="handleFollow('${profileId}', ${isFollowing})" class="btn ${isFollowing ? 'btn-ghost' : 'btn-primary'} btn-sm">${isFollowing ? 'Following' : 'Follow'}</button><button onclick="startDm('${profileId}')" class="btn btn-ghost btn-sm"><svg style="width: 16px; height: 16px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>Message</button></div>` : currentUser && currentUser.id === profileId ? `<button onclick="showEditProfile()" class="btn btn-ghost btn-sm" style="margin-bottom: 1rem;">Edit Profile</button>` : ''}
            </div>
            <div class="profile-info">
                <h2 style="font-size: 1.5rem; font-weight: 800;">${profile.full_name || profile.username} ${verifiedHtml} ${premiumHtml} ${badgeHtml}</h2>
                <p style="color: var(--text-muted);" class="font-mono">@${profile.username}</p>
                ${profile.bio ? `<p class="profile-bio">${profile.bio}</p>` : '<p class="profile-bio" style="font-style: italic; color: var(--text-muted);">No bio yet.</p>'}
            </div>
            ${profile.domain_verified ? `
                <div class="profile-meta-row">
                    <a href="https://${profile.custom_domain}" target="_blank" class="profile-meta-item">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg>
                        ${profile.custom_domain}
                    </a>
                </div>
            ` : ''}
            ${metaItems.length > 0 ? `<div class="profile-meta-row">${metaItems.join('')}</div>` : ''}
            ${socialsHtml}
            ${ghStatsHtml}
            ${achievementsHtml}
        </div>
        <div id="feed">${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No posts yet.</div>'}</div>
    `;
    app.innerHTML = renderLayout(centerContent, 'profile');
    fetchTrendingRepos();
    applySyntaxHighlighting();
    initRepoStats();
}

function applySyntaxHighlighting() {
    document.querySelectorAll('pre code').forEach(block => {
        if (!block.dataset.highlighted) { hljs.highlightElement(block); block.dataset.highlighted = 'true'; }
    });
}

function renderPostCard(post) {
    const isLiked = currentUser ? post.csns_likes.some(l => l.user_id === currentUser.id) : false;
    const isSaved = currentUser ? post.csns_bookmarks.some(b => b.user_id === currentUser.id) : false;
    const timeAgo = new Date(post.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
    
    let contentHtml = post.content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/```([\s\S]*?)```/g, (match, p1) => `<div class="code-block-wrapper"><button class="copy-btn" onclick="copyCode(this)">Copy</button><pre class="code-block"><code class="hljs">${p1}</code></pre></div>`)
        .replace(/\n/g, '<br>');

    let parentHtml = '';
    if (post.parent) {
        const p = post.parent;
        parentHtml = `<div class="quote-embed" onclick="event.stopPropagation(); currentView='profile_${p.user_id}'; renderApp()"><span style="font-size: 0.8rem; color: var(--text-muted);">Quote from @${p.csns_profiles?.username}</span><p style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">${p.content.substring(0, 140)}...</p></div>`;
    }

    return `
        <div class="post-card fade-in" onclick="currentView='profile_${post.user_id}'; renderApp()">
            ${post.is_repost ? `<div class="repost-indicator"><svg style="width: 14px; height: 14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg> Reposted by @${post.csns_profiles?.username}</div>` : ''}
            <div style="display: flex; gap: 1rem;" onclick="event.stopPropagation()">
                <img src="${post.csns_profiles?.avatar_url || `https://ui-avatars.com/api/?name=${post.csns_profiles?.username}`}" class="post-avatar" onclick="currentView='profile_${post.user_id}'; renderApp()">
                <div style="flex: 1;">
                    <div class="post-header" style="margin-bottom: 0;">
                        <span class="post-name" onclick="currentView='profile_${post.user_id}'; renderApp()">${post.csns_profiles?.full_name || post.csns_profiles?.username}</span>
                        ${post.csns_profiles?.is_verified ? `<span class="verified-badge" style="width: 14px; height: 14px;"><svg style="width: 8px; height: 8px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : ''}
                        <span class="post-username">@${post.csns_profiles?.username}</span>
                        <span style="color: var(--text-muted); font-size: 0.9rem;">• ${timeAgo}</span>
                    </div>
                    ${post.post_type !== 'post' ? `<div class="post-tag tag-${post.post_type}">${post.post_type}</div>` : ''}
                    <div class="post-content">${contentHtml}</div>
                    ${parentHtml}
                    ${post.image_url ? `<img src="${post.image_url}" class="post-image" alt="Post image">` : ''}
                    ${post.csns_post_repos && post.csns_post_repos.length > 0 ? post.csns_post_repos.map(repo => `
                        <a href="${repo.repo_url}" target="_blank" class="repo-embed" data-owner="${repo.owner}" data-repo="${repo.repo_name}">
                            <div class="repo-embed-content">
                                <div class="repo-embed-header">${repo.platform === 'github' ? `<svg style="width: 20px; height: 20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>` : `<svg style="width: 20px; height: 20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M23.955 13.587l-1.347-4.135-2.664-8.197a.455.455 0 00-.867 0L16.413 9.45H7.587L4.923 1.255a.455.455 0 00-.867 0L1.392 9.452.045 13.587a.924.924 0 00.331 1.023L12 23.054l11.624-8.443a.92.92 0 00.331-1.024"/></svg>`} ${repo.owner} / ${repo.repo_name}</div>
                                <div class="repo-embed-desc font-mono">${repo.repo_url}</div>
                                <div class="repo-stats"><span class="repo-stat">Loading stats...</span></div>
                            </div>
                        </a>
                    `).join('') : ''}
                    <div class="post-actions">
                        <button onclick="toggleComments('${post.id}')" class="action-btn"><svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg></button>
                        <button onclick="showQuoteModal('${post.id}', false)" class="action-btn"><svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg></button>
                        <button onclick="showQuoteModal('${post.id}', true)" class="action-btn"><svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg></button>
                        <button onclick="handleLike('${post.id}', ${isLiked}, '${post.user_id}')" class="action-btn ${isLiked ? 'liked' : ''}"><svg style="width: 18px; height: 18px;" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg><span>${post.csns_likes.length}</span></button>
                        <button onclick="handleBookmark('${post.id}', ${isSaved})" class="action-btn ${isSaved ? 'saved' : ''}"><svg style="width: 18px; height: 18px;" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg></button>
                    </div>
                    <div id="comments-${post.id}" class="comment-section" style="display: none;"></div>
                </div>
            </div>
        </div>
    `;
}

fetchDevTip();
checkAuth();
