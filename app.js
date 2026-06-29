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
let profileSort = 'newest';
let replyToCommentId = null;
let activeFeedTab = 'foryou';
let activeTag = null;
let linkPreviewCache = {};
let feedCache = [];
let postsPage = 0;
let isLoadingPosts = false;
let hasMorePosts = true;
let profileTab = 'posts';
let settingsTab = 'profile';

function updatePostInCache(postId, updateFn) {
    const post = feedCache.find(p => p.id === postId);
    if (post) {
        updateFn(post);
        renderFeedContent();
    }
}

async function fetchFeedPosts(isInfinite = false) {
    if (isLoadingPosts) return;
    isLoadingPosts = true;
    
    if (!isInfinite) {
        postsPage = 0;
        hasMorePosts = true;
        feedCache = [];
    }
    
    const start = postsPage * 10;
    const end = start + 9;
    
    let query = sb.from('csns_posts').select(`*, csns_profiles:user_id (*), csns_post_repos (*), csns_likes (user_id), csns_reactions (user_id, type), csns_bookmarks (user_id), parent:parent_post_id (*, csns_profiles:user_id (*)), csns_polls (*, csns_poll_votes (user_id, option_index))`).order('created_at', { ascending: false }).range(start, end);
    
    const { data, error } = await query;
    if (error) { isLoadingPosts = false; return; }
    
    if (data.length < 10) hasMorePosts = false;
    feedCache = isInfinite ? [...feedCache, ...data] : data;
    postsPage++;
    isLoadingPosts = false;
    
    renderFeedContent();
    setupInfiniteScroll();
}

function setupInfiniteScroll() {
    const sentinel = document.getElementById('infinite-scroll-sentinel');
    if (!sentinel) return;
    
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMorePosts && !isLoadingPosts) {
            fetchFeedPosts(true);
        }
    }, { threshold: 1.0 });
    
    observer.observe(sentinel);
}

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === '/' || (e.metaKey && e.key === 'k') || (e.ctrlKey && e.key === 'k')) {
        e.preventDefault();
        document.querySelector('.search-box')?.focus();
    }
});

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

async function fetchTrendingRepos() {
    const trendEl = document.getElementById('trending-repos');
    if (!trendEl) return;
    try {
        const res = await fetch(`https://api.github.com/search/repositories?q=stars:%3E10000&sort=stars&order=desc&per_page=3`);
        if (!res.ok) throw new Error("Rate limited");
        const data = await res.json();
        if (data.items) {
            trendEl.innerHTML = data.items.map(r => `
                <div class="trend-item">
                    <div class="font-mono" style="color: var(--accent-primary); font-size: 0.9rem;">${r.full_name}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">${r.stargazers_count} stars</div>
                </div>
            `).join('');
        }
    } catch (e) {
        trendEl.innerHTML = `
            <div class="trend-item"><div class="font-mono" style="color: var(--accent-primary); font-size: 0.9rem;">vercel / next.js</div><div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">The React Framework</div></div>
            <div class="trend-item"><div class="font-mono" style="color: var(--accent-primary); font-size: 0.9rem;">supabase / supabase</div><div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">Backend as a Service</div></div>
        `;
    }
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

window.loginWithGithub = async function() { await sb.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: window.location.origin + window.location.pathname } }); }
window.loginWithGitlab = async function() { await sb.auth.signInWithOAuth({ provider: 'gitlab', options: { redirectTo: window.location.origin + window.location.pathname } }); }
window.logout = async function() { await sb.auth.signOut(); currentUser = null; currentView = 'feed'; renderApp(); }

sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && !currentUser) checkAuth();
    else if (event === 'SIGNED_OUT') checkAuth();
});

async function createNotification(actorId, userId, type, postId = null) {
    if (actorId === userId) return;
    await sb.from('csns_notifications').insert({ actor_id: actorId, user_id: userId, type, post_id: postId });
}

window.toggleNotifDropdown = async function(e) {
    e.stopPropagation();
    const dropdown = document.getElementById('notif-dropdown');
    if (dropdown.classList.contains('active')) { dropdown.classList.remove('active'); return; }
    dropdown.classList.add('active');
    dropdown.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Loading...</div>';
    const { data: notifs } = await sb.from('csns_notifications').select('*, actor:actor_id(*)').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(15);
    if (!notifs || notifs.length === 0) { dropdown.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-muted);">No notifications yet.</div>'; return; }
    dropdown.innerHTML = notifs.map(n => `
        <div class="notif-item ${!n.read ? 'unread' : ''}" onclick="handleNotifClick('${n.id}', '${n.type}', '${n.post_id || ''}', '${n.actor_id}')">
            <img src="${n.actor?.avatar_url || `https://ui-avatars.com/api/?name=${n.actor?.username}`}" class="post-avatar" style="width: 32px; height: 32px;">
            <div style="flex: 1;"><span style="font-weight: 700;">@${n.actor?.username}</span> ${n.type === 'like' ? 'liked your post' : n.type === 'comment' ? 'commented on your post' : n.type === 'follow' ? 'followed you' : 'sent you a message'}</div>
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

window.setPostType = function(type) { selectedPostType = type; document.querySelectorAll('.type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === type)); }
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

window.togglePollComposer = function() { const div = document.getElementById('poll-composer'); div.style.display = div.style.display === 'none' ? 'block' : 'none'; }

window.handlePost = async function(parentId = null, isRepost = false) {
    let content = ''; let postType = 'post'; let community = null;
    if (!parentId) { content = document.getElementById('post-content').value; postType = selectedPostType; community = document.getElementById('post-community')?.value || null; } 
    else { if (!isRepost) content = document.getElementById('quote-content').value; }
    if (!content.trim() && !isRepost) return;

    let imageUrl = null;
    if (selectedImageFile && !parentId) {
        const fileName = `${Date.now()}_${selectedImageFile.name}`;
        const { data: uploadData } = await sb.storage.from('post_images').upload(fileName, selectedImageFile);
        if (uploadData) imageUrl = sb.storage.from('post_images').getPublicUrl(fileName).data.publicUrl;
        selectedImageFile = null;
    }

    const { data: newPost, error } = await sb.from('csns_posts').insert({
        content, user_id: currentUser.id, image_url: imageUrl, parent_post_id: parentId, is_repost: isRepost, post_type: postType, community
    }).select('id, user_id').single();

    if (error) { alert('Error creating post: ' + error.message); return; }

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

        const pollComposer = document.getElementById('poll-composer');
        if (pollComposer && pollComposer.style.display !== 'none') {
            let pollOptions = [];
            for (let i = 1; i <= 3; i++) { const val = document.getElementById(`poll-opt-${i}`).value.trim(); if (val) pollOptions.push(val); }
            if (pollOptions.length > 1) { await sb.from('csns_polls').insert({ post_id: newPost.id, options: pollOptions }); }
        }
    }

    if (parentId) {
        const { data: parentPost } = await sb.from('csns_posts').select('user_id').eq('id', parentId).single();
        if (parentPost) createNotification(currentUser.id, parentPost.user_id, isRepost ? 'repost' : 'comment', parentId);
    }
    closeQuoteModal();
    fetchFeedPosts(false);
}

window.votePoll = async function(pollId, optionIndex) {
    if (!currentUser) return alert('Please login to vote.');
    const { error } = await sb.from('csns_poll_votes').insert({ poll_id: pollId, user_id: currentUser.id, option_index: optionIndex });
    if (error) alert('Error voting: ' + error.message);
    fetchFeedPosts(false);
}

window.deletePost = async function(postId) {
    if (!confirm('Are you sure you want to delete this post?')) return;
    const { error } = await sb.from('csns_posts').delete().eq('id', postId);
    if (error) alert('Error deleting: ' + error.message);
    fetchFeedPosts(false);
}

window.handleLike = async function(postId, ownerId) {
    if (!currentUser) return alert('Please login to like.');
    const isLiked = feedCache.find(p => p.id === postId)?.csns_likes.some(l => l.user_id === currentUser.id);
    updatePostInCache(postId, (post) => {
        if (isLiked) post.csns_likes = post.csns_likes.filter(l => l.user_id !== currentUser.id);
        else post.csns_likes.push({ user_id: currentUser.id });
    });
    if (isLiked) { await sb.from('csns_likes').delete().match({ post_id: postId, user_id: currentUser.id }); } 
    else { await sb.from('csns_likes').insert({ post_id: postId, user_id: currentUser.id }); createNotification(currentUser.id, ownerId, 'like', postId); }
}

window.handleReaction = async function(postId, type, ownerId) {
    if (!currentUser) return alert('Please login to react.');
    const existing = feedCache.find(p => p.id === postId)?.csns_reactions.find(r => r.user_id === currentUser.id);
    updatePostInCache(postId, (post) => {
        if (existing) { if (existing.type === type) post.csns_reactions = post.csns_reactions.filter(r => r.user_id !== currentUser.id); else existing.type = type; } 
        else { post.csns_reactions.push({ user_id: currentUser.id, type }); }
    });
    if (existing) { if (existing.type === type) await sb.from('csns_reactions').delete().match({ id: existing.id }); else await sb.from('csns_reactions').update({ type }).eq('id', existing.id); } 
    else { await sb.from('csns_reactions').insert({ post_id: postId, user_id: currentUser.id, type }); }
}

window.handleBookmark = async function(postId, isSaved) {
    if (!currentUser) return alert('Please login to save posts.');
    updatePostInCache(postId, (post) => {
        if (isSaved) post.csns_bookmarks = post.csns_bookmarks.filter(b => b.user_id !== currentUser.id);
        else post.csns_bookmarks.push({ user_id: currentUser.id });
    });
    if (isSaved) await sb.from('csns_bookmarks').delete().match({ post_id: postId, user_id: currentUser.id });
    else await sb.from('csns_bookmarks').insert({ post_id: postId, user_id: currentUser.id });
}

window.handleFollow = async function(targetId, isFollowing) {
    if (!currentUser) return;
    if (isFollowing) await sb.from('csns_follows').delete().match({ follower_id: currentUser.id, following_id: targetId });
    else { await sb.from('csns_follows').insert({ follower_id: currentUser.id, following_id: targetId }); createNotification(currentUser.id, targetId, 'follow'); }
    renderApp();
}

window.copyCode = function(btn) { navigator.clipboard.writeText(btn.closest('.code-block-wrapper').querySelector('code').innerText); btn.innerText = 'Copied!'; setTimeout(() => btn.innerText = 'Copy', 2000); }
window.runCode = function(btn) {
    const wrapper = btn.closest('.code-block-wrapper');
    const outputDiv = wrapper.querySelector('.code-output');
    try {
        let logs = [];
        const oldLog = console.log;
        console.log = (...args) => logs.push(args.join(' '));
        const result = eval(wrapper.querySelector('code').innerText);
        console.log = oldLog;
        outputDiv.innerText = logs.join('\n') + (result !== undefined ? '\n' + result : '');
        if (!outputDiv.innerText) outputDiv.innerText = 'Code executed successfully.';
    } catch (e) { outputDiv.innerText = 'Error: ' + e.message; }
    outputDiv.style.display = 'block';
}

window.showQuoteModal = function(postId, isRepost) { const modal = document.getElementById('quote-modal'); modal.style.display = 'flex'; modal.dataset.postId = postId; modal.dataset.isRepost = isRepost; document.getElementById('quote-content').style.display = isRepost ? 'none' : 'block'; }
window.closeQuoteModal = function() { document.getElementById('quote-modal').style.display = 'none'; }
window.submitQuote = function() { const modal = document.getElementById('quote-modal'); handlePost(modal.dataset.postId, modal.dataset.isRepost === 'true'); }

window.toggleComments = async function(postId, ownerId) {
    const section = document.getElementById(`comments-${postId}`);
    if (section.style.display === 'none' || !section.innerHTML) {
        section.style.display = 'block';
        section.innerHTML = '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">Loading...</div>';
        const { data: comments } = await sb.from('csns_comments').select('*, csns_profiles:user_id (*)').eq('post_id', postId).order('created_at', { ascending: true });
        
        const renderComments = (parentId = null, depth = 0) => {
            return comments.filter(c => (c.parent_comment_id || null) === parentId).map(c => `
                <div class="comment-item" style="margin-left: ${depth * 2}rem;">
                    <img src="${c.csns_profiles?.avatar_url || `https://ui-avatars.com/api/?name=${c.csns_profiles?.username}`}" class="post-avatar" style="width: 32px; height: 32px;">
                    <div style="flex: 1;">
                        <div style="display: flex; gap: 0.5rem; align-items: center;"><span style="font-weight: 700; font-size: 0.9rem;">${c.csns_profiles?.full_name || c.csns_profiles?.username}</span><span style="font-size: 0.8rem; color: var(--text-muted);" class="font-mono">@${c.csns_profiles?.username}</span></div>
                        <p style="color: var(--text-secondary); margin-top: 0.25rem; font-size: 0.9rem;">${c.content}</p>
                        ${currentUser ? `<button class="reply-btn" onclick="setReplyTo('${c.id}', '${postId}')">Reply</button>` : ''}
                    </div>
                </div>${renderComments(c.id, depth + 1)}`).join('');
        };

        let html = renderComments();
        if (currentUser) html += `<div class="comment-input-area"><input id="comment-input-${postId}" type="text" placeholder="Tweet your reply..."><button onclick="submitComment('${postId}', '${ownerId}')" class="btn btn-primary btn-sm">Reply</button></div>`;
        section.innerHTML = html || '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No comments yet.</div>';
    } else { section.style.display = 'none'; }
}

window.setReplyTo = function(commentId, postId) { replyToCommentId = commentId; const input = document.getElementById(`comment-input-${postId}`); input.placeholder = "Replying to comment..."; input.focus(); }
window.submitComment = async function(postId, ownerId) {
    const input = document.getElementById(`comment-input-${postId}`);
    if (!input.value.trim()) return;
    const { error } = await sb.from('csns_comments').insert({ post_id: postId, user_id: currentUser.id, content: input.value, parent_comment_id: replyToCommentId });
    if (error) alert('Error commenting: ' + error.message);
    createNotification(currentUser.id, ownerId, 'comment', postId);
    replyToCommentId = null;
    toggleComments(postId, ownerId);
    setTimeout(() => toggleComments(postId, ownerId), 200);
}

window.searchTag = function(tag) { activeTag = tag; currentView = 'feed'; renderApp(); }
window.setFeedTab = function(tab) { activeFeedTab = tab; activeTag = null; renderApp(); }
window.toggleTheme = function() { document.body.classList.toggle('light-theme'); localStorage.setItem('theme', document.body.classList.contains('light-theme') ? 'light' : 'dark'); }

window.handleSearchInput = function(e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    const resultsDiv = document.getElementById('search-results');
    if (!query) { resultsDiv.style.display = 'none'; return; }
    searchTimeout = setTimeout(async () => {
        resultsDiv.style.display = 'block'; resultsDiv.innerHTML = '<div class="search-item">Searching...</div>';
        const { data: users } = await sb.from('csns_profiles').select('*').ilike('username', `%${query.replace('@', '')}%`).limit(3);
        const { data: posts } = await sb.from('csns_posts').select('id, content').ilike('content', `%${query}%`).limit(3);
        let html = '';
        if (users && users.length > 0) {
            html += '<div class="search-category">Users</div>';
            html += users.map(u => `<div class="search-item" onclick="currentView='profile_${u.id}'; renderApp(); document.getElementById('search-results').style.display='none';"><img src="${u.avatar_url || `https://ui-avatars.com/api/?name=${u.username}`}" class="post-avatar" style="width: 24px; height: 24px;"><div><div style="font-weight: 700; font-size: 0.8rem;">${u.full_name || u.username}</div><div style="font-size: 0.7rem; color: var(--text-muted);" class="font-mono">@${u.username}</div></div></div>`).join('');
        }
        if (posts && posts.length > 0) {
            html += '<div class="search-category">Posts</div>';
            html += posts.map(p => `<div class="search-item" onclick="currentView='feed'; activeTag=null; renderApp(); document.getElementById('search-results').style.display='none';"><div style="font-size: 0.8rem; color: var(--text-secondary);">${p.content.substring(0, 40)}...</div></div>`).join('');
        }
        if (!html) html = '<div class="search-item">No results found.</div>';
        resultsDiv.innerHTML = html;
    }, 300);
}

window.showVerifyModal = function() { document.getElementById('verify-modal').style.display = 'flex'; document.getElementById('verify-step-1').style.display = 'block'; document.getElementById('verify-step-2').style.display = 'none'; }
window.closeVerifyModal = function() { document.getElementById('verify-modal').style.display = 'none'; }
window.sendVerificationCode = async function() {
    const email = document.getElementById('verify-email').value;
    if (!email.endsWith('@360-search.com')) return alert('Email must end in @360-search.com');
    const btn = document.querySelector('#verify-step-1 button'); btn.innerText = 'Sending...'; btn.disabled = true;
    try {
        const { error } = await sb.functions.invoke('send-verification', { body: { email, userId: currentUser.id }, method: 'POST' });
        if (error) throw error;
        document.getElementById('verify-step-1').style.display = 'none'; document.getElementById('verify-step-2').style.display = 'block';
    } catch (err) { alert('Failed to send code: ' + err.message); btn.innerText = 'Send Code'; btn.disabled = false; }
}
window.confirmVerificationCode = async function() {
    const code = document.getElementById('verify-code-input').value;
    const btn = document.querySelector('#verify-step-2 button'); btn.innerText = 'Verifying...'; btn.disabled = true;
    try {
        const { data, error } = await sb.from('csns_email_verifications').select('*').eq('user_id', currentUser.id).eq('code', code).order('created_at', { ascending: false }).limit(1).single();
        if (error || !data) throw new Error('Invalid code.');
        const { data: updatedProfile } = await sb.from('csns_profiles').update({ is_verified: true, is_premium: true }).eq('id', currentUser.id).select().single();
        currentUser = updatedProfile; closeVerifyModal(); renderApp();
    } catch (err) { alert(err.message); btn.innerText = 'Verify'; btn.disabled = false; }
}

window.saveProfileSettings = async function() {
    const { data, error } = await sb.from('csns_profiles').update({ 
        full_name: document.getElementById('settings-fullname').value, 
        bio: document.getElementById('settings-bio').value, 
        avatar_url: document.getElementById('settings-avatar').value,
        banner_url: document.getElementById('settings-banner').value,
        github_url: document.getElementById('settings-github').value, 
        gitlab_url: document.getElementById('settings-gitlab').value,
        linkedin_url: document.getElementById('settings-linkedin').value,
        twitter_url: document.getElementById('settings-twitter').value,
        accent_color: document.getElementById('settings-accent').value,
        readme: document.getElementById('settings-readme').value
    }).eq('id', currentUser.id).select().single();
    if (error) { alert('Error saving: ' + error.message); return; }
    currentUser = data; alert('Saved successfully!'); renderApp();
}

window.setProfileTab = function(tab) { profileTab = tab; renderApp(); }
window.setSettingsTab = function(tab) { settingsTab = tab; renderApp(); }

window.createCommunity = async function() {
    const name = prompt('Enter community name (e.g., react, rust):');
    if (!name) return;
    const { error } = await sb.from('csns_communities').insert({ name: name.toLowerCase(), description: 'A community for ' + name, creator_id: currentUser.id });
    if (error) { alert('Error creating community: ' + error.message); return; }
    alert('Community created!'); renderCommunities();
}

window.createEvent = async function() {
    const title = prompt('Event title:'); if (!title) return;
    const date = prompt('Event date (YYYY-MM-DDTHH:MM):'); if (!date) return;
    const url = prompt('Event URL (optional):');
    const { error } = await sb.from('csns_events').insert({ user_id: currentUser.id, title, event_date: date, url });
    if (error) { alert('Error creating event: ' + error.message); return; }
    alert('Event created!'); renderEvents();
}

async function renderApp() {
    if (localStorage.getItem('theme') === 'light' && !document.body.classList.contains('light-theme')) document.body.classList.add('light-theme');
    document.documentElement.style.setProperty('--accent-primary', currentUser?.accent_color || '#00d4ff');
    if (currentView.startsWith('profile_')) await renderProfile(currentView.split('_')[1]);
    else if (currentView === 'news') await renderNews();
    else if (currentView === 'jobs') await renderJobs();
    else if (currentView === 'following') await renderFollowing();
    else if (currentView === 'messages') await renderMessages();
    else if (currentView === 'saved') await renderSaved();
    else if (currentView === 'communities') await renderCommunities();
    else if (currentView === 'events') await renderEvents();
    else if (currentView === 'settings') await renderSettings();
    else await renderFeed();
    fetchTrendingRepos(); // Ensure trending repos load globally
}

function renderLayout(centerContent, activeNav = 'home') {
    const avatarUrl = currentUser?.avatar_url || `https://ui-avatars.com/api/?name=${currentUser?.username || 'Guest'}`;
    return `
        <div class="main-layout" onclick="document.getElementById('notif-dropdown')?.classList.remove('active'); document.getElementById('search-results')?.style.setProperty('display', 'none')">
            <div id="quote-modal" class="modal-overlay" style="display: none;"><div class="modal-content"><div class="modal-header"><h2 class="modal-title">Quote Post</h2><button class="modal-close" onclick="closeQuoteModal()">&times;</button></div><textarea id="quote-content" class="modal-input modal-textarea" placeholder="Add a comment..." rows="4"></textarea><div style="display: flex; justify-content: flex-end; margin-top: 1rem;"><button class="btn btn-primary btn-sm" onclick="submitQuote()">Post</button></div></div></div>
            <div id="verify-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header"><h2 class="modal-title">Get Verified</h2><button class="modal-close" onclick="closeVerifyModal()">&times;</button></div>
                    <div id="verify-step-1" class="verify-step"><p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem;">Enter your @360-search.com email to receive a verification code.</p><input id="verify-email" type="email" class="modal-input" placeholder="yourname@360-search.com"><button onclick="sendVerificationCode()" class="btn btn-primary" style="width: 100%;">Send Code</button></div>
                    <div id="verify-step-2" class="verify-step" style="display: none;"><p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 1rem;">Enter the 6-digit code sent to your email.</p><input id="verify-code-input" type="text" maxlength="6" class="modal-input verify-code-input" placeholder="123456"><button onclick="confirmVerificationCode()" class="btn btn-primary" style="width: 100%;">Verify</button></div>
                </div>
            </div>
            <aside class="left-sidebar">
                <div class="logo"><svg style="width: 28px; height: 28px; color: var(--accent-primary);" fill="currentColor" viewBox="0 0 24 24"><path d="M13 2L3 14h7v8l10-12h-7V2z"/></svg> CodeSNS</div>
                <nav style="flex: 1;">
                    <a class="nav-item ${activeNav === 'home' ? 'active' : ''}" onclick="currentView='feed'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg><span>Home</span></a>
                    <a class="nav-item ${activeNav === 'following' ? 'active' : ''}" onclick="currentView='following'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg><span>Following</span></a>
                    <a class="nav-item ${activeNav === 'communities' ? 'active' : ''}" onclick="currentView='communities'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg><span>Communities</span></a>
                    <a class="nav-item ${activeNav === 'events' ? 'active' : ''}" onclick="currentView='events'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span>Events</span></a>
                    <a class="nav-item ${activeNav === 'news' ? 'active' : ''}" onclick="currentView='news'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg><span>Dev News</span></a>
                    <a class="nav-item ${activeNav === 'jobs' ? 'active' : ''}" onclick="currentView='jobs'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg><span>Jobs</span></a>
                    <a class="nav-item ${activeNav === 'messages' ? 'active' : ''}" onclick="currentView='messages'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg><span>Messages</span></a>
                    <a class="nav-item ${activeNav === 'saved' ? 'active' : ''}" onclick="currentView='saved'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg><span>Saved</span></a>
                    ${currentUser ? `<a class="nav-item ${activeNav === 'profile' ? 'active' : ''}" onclick="currentView='profile_${currentUser.id}'; renderApp()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg><span>Profile</span></a>` : ''}
                </nav>
                <a class="nav-item theme-toggle" onclick="toggleTheme()"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg><span>Theme</span></a>
                ${currentUser ? `
                    ${!currentUser.is_verified ? `<button class="btn btn-ghost btn-sm" style="margin-bottom: 0.5rem; width: 100%;" onclick="showVerifyModal()">Get Verified</button>` : ''}
                    <div style="position: relative; margin-bottom: 1rem;">
                        <div class="user-card" onclick="toggleNotifDropdown(event)">
                            <img src="${avatarUrl}" class="post-avatar" style="width: 40px; height: 40px;">
                            <div style="overflow: hidden;"><div style="font-weight: 700; font-size: 0.9rem;">${currentUser?.full_name}</div><div style="font-size: 0.8rem; color: var(--text-muted);" class="font-mono">Alerts</div></div>
                            <svg style="width: 20px; height: 20px; color: var(--accent-primary);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                        </div>
                        <div id="notif-dropdown" class="notif-dropdown"></div>
                    </div>
                    <a class="nav-item logout-btn" onclick="logout()"><svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg><span>Logout</span></a>
                ` : `<div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: auto; padding: 0 0.5rem;"><button onclick="loginWithGithub()" class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;">GitHub</button><button onclick="loginWithGitlab()" class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;">GitLab</button></div>`}
            </aside>
            <main class="center-feed">${centerContent}</main>
            <aside class="right-sidebar">
                <div style="position: relative;"><input type="text" class="search-box" placeholder="Search users, posts, #tags... (Press /)" oninput="handleSearchInput(event)" onclick="event.stopPropagation()"><div id="search-results" class="search-results" style="display: none;"></div></div>
                <div class="widget"><h3 class="widget-title">🔥 Trending Repos</h3><div id="trending-repos"><div class="trend-item">Loading...</div></div></div>
                <div class="widget"><h3 class="widget-title">💡 AI Dev Tip</h3><p id="dev-tip-text" style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">${devTip}</p></div>
            </aside>
        </div>
    `;
}

function renderFeedContent() {
    let filteredPosts = feedCache;
    if (activeTag) filteredPosts = feedCache.filter(p => p.content.toLowerCase().includes(`#${activeTag.toLowerCase()}`));
    else if (activeFeedTab === 'trending') filteredPosts = [...feedCache].sort((a, b) => (b.csns_likes.length + b.csns_reactions.length) - (a.csns_likes.length + a.csns_reactions.length));
    
    const feedEl = document.getElementById('feed');
    if (feedEl) {
        feedEl.innerHTML = filteredPosts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No posts found.</div>';
        if (hasMorePosts) feedEl.innerHTML += '<div id="infinite-scroll-sentinel" style="padding: 2rem; text-align: center; color: var(--text-muted);">Loading more...</div>';
        applySyntaxHighlighting();
    }
}

async function renderFeed() {
    const centerContent = `
        <header class="page-header"><h1 class="page-title">Home</h1></header>
        <div class="feed-tabs">
            <div class="feed-tab ${activeFeedTab === 'foryou' && !activeTag ? 'active' : ''}" onclick="setFeedTab('foryou')">For You</div>
            <div class="feed-tab ${activeFeedTab === 'trending' && !activeTag ? 'active' : ''}" onclick="setFeedTab('trending')">Trending</div>
            ${activeTag ? `<div class="feed-tab active">#${activeTag}</div>` : ''}
        </div>
        ${currentUser ? `
            <div class="composer fade-in">
                <img src="${currentUser.avatar_url || `https://ui-avatars.com/api/?name=${currentUser.username}`}" class="post-avatar">
                <div style="flex: 1;">
                    <div class="composer-types"><button class="type-btn active" data-type="post" onclick="setPostType('post')">Post</button><button class="type-btn" data-type="review" onclick="setPostType('review')">Review</button><button class="type-btn" data-type="challenge" onclick="setPostType('challenge')">Challenge</button></div>
                    <textarea id="post-content" placeholder="What did you code today? Use #tags" rows="3"></textarea>
                    <input id="repo-url" type="text" placeholder="Attach GitHub/GitLab repo link (optional)">
                    <input id="post-community" type="text" placeholder="Community (e.g., react) - optional" style="margin-top: 0.5rem; background: var(--bg-surface); border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 0.5rem 1rem; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; outline: none; width: 100%;">
                    <div class="upload-btn-wrapper">
                        <label class="upload-btn"><svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span>Add Image</span><input id="image-upload" type="file" accept="image/*" style="display: none;" onchange="handleImageSelect(this)"></label>
                        <label class="upload-btn"><svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg><span>Add Poll</span><input type="checkbox" style="display: none;" onchange="togglePollComposer()"></label>
                        <img id="image-preview" class="image-preview" style="display: none;" />
                    </div>
                    <div id="poll-composer" style="display: none; margin-top: 0.5rem;"><input id="poll-opt-1" type="text" class="modal-input" placeholder="Option 1" style="margin-bottom: 0.5rem;"><input id="poll-opt-2" type="text" class="modal-input" placeholder="Option 2" style="margin-bottom: 0.5rem;"><input id="poll-opt-3" type="text" class="modal-input" placeholder="Option 3"></div>
                    <div style="display: flex; justify-content: flex-end; margin-top: 1rem;"><button onclick="handlePost()" class="btn btn-primary">Post Code</button></div>
                </div>
            </div>
        ` : `<div style="padding: 3rem 2rem; text-align: center; border-bottom: 1px solid var(--border-light);"><h2 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Welcome to CodeSNS</h2><p style="color: var(--text-muted); margin-bottom: 1.5rem;">Sign in to join the conversation.</p><div style="display: flex; gap: 0.75rem; justify-content: center;"><button onclick="loginWithGithub()" class="btn btn-ghost">GitHub</button><button onclick="loginWithGitlab()" class="btn btn-ghost">GitLab</button></div></div>`}
        <div id="feed"></div>
    `;
    app.innerHTML = renderLayout(centerContent, 'home');
    fetchFeedPosts(false);
}

async function renderJobs() {
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Developer Jobs</h1></header><div id="jobs-feed" style="padding: 1rem; text-align: center; color: var(--text-muted);">Fetching remote jobs...</div>`, 'jobs');
    try {
        const res = await fetch('https://www.arbeitnow.com/api/job-board-api');
        const data = await res.json();
        document.getElementById('jobs-feed').innerHTML = data.data.slice(0, 20).map(job => `<a href="${job.url}" target="_blank" class="job-item"><div class="job-title">${job.title}</div><div class="job-meta"><span>${job.company_name}</span><span>${job.location}</span>${job.remote ? '<span>Remote</span>' : ''}</div></a>`).join('');
    } catch (e) { document.getElementById('jobs-feed').innerHTML = '<div style="padding: 2rem; text-align: center;">Failed to load jobs.</div>'; }
}

async function renderSaved() {
    if (!currentUser) { app.innerHTML = renderLayout('<div class="empty-state">Sign in to view saved posts.</div>', 'saved'); return; }
    const { data: bookmarks } = await sb.from('csns_bookmarks').select('post_id').eq('user_id', currentUser.id);
    const postIds = bookmarks.map(b => b.post_id);
    let posts = [];
    if (postIds.length > 0) {
        const { data } = await sb.from('csns_posts').select(`*, csns_profiles:user_id (*), csns_post_repos (*), csns_likes (user_id), csns_reactions (user_id, type), csns_bookmarks (user_id), parent:parent_post_id (*, csns_profiles:user_id (*)), csns_polls (*, csns_poll_votes (user_id, option_index))`).in('id', postIds).order('created_at', { ascending: false });
        posts = data || [];
    }
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Saved Posts</h1></header><div id="feed">${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No saved posts yet.</div>'}</div>`, 'saved');
    applySyntaxHighlighting();
}

async function renderFollowing() {
    if (!currentUser) { app.innerHTML = renderLayout('<div class="empty-state">Sign in to see following feed.</div>', 'following'); return; }
    const { data: follows } = await sb.from('csns_follows').select('following_id').eq('follower_id', currentUser.id);
    const followingIds = follows.map(f => f.following_id);
    let posts = [];
    if (followingIds.length > 0) {
        const { data } = await sb.from('csns_posts').select(`*, csns_profiles:user_id (*), csns_post_repos (*), csns_likes (user_id), csns_reactions (user_id, type), csns_bookmarks (user_id), parent:parent_post_id (*, csns_profiles:user_id (*)), csns_polls (*, csns_poll_votes (user_id, option_index))`).in('user_id', followingIds).order('created_at', { ascending: false });
        posts = data || [];
    }
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Following</h1></header><div id="feed">${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">Feed is empty.</div>'}</div>`, 'following');
    applySyntaxHighlighting();
}

async function renderNews() {
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Dev News</h1></header><div id="news-feed" style="padding: 1rem; text-align: center; color: var(--text-muted);">Fetching top tech articles...</div>`, 'news');
    try {
        const res = await fetch('https://dev.to/api/articles?per_page=20&top=7'); const items = await res.json();
        document.getElementById('news-feed').innerHTML = items.map(item => `<a href="${item.url}" target="_blank" class="news-item">${item.cover_image ? `<img src="${item.cover_image}" class="news-image" alt="${item.title}">` : ''}<div class="news-content"><div class="news-title">${item.title}</div><div class="news-meta"><span class="news-tag">#${item.tag_list[0] || 'dev'}</span><span>by ${item.user.name}</span></div></div></a>`).join('');
    } catch (e) { document.getElementById('news-feed').innerHTML = '<div style="padding: 2rem; text-align: center;">Failed to load news.</div>'; }
}

async function renderMessages() {
    if (!currentUser) { app.innerHTML = renderLayout('<div class="empty-state">Sign in to view messages.</div>', 'messages'); return; }
    const { data: messages } = await sb.from('csns_messages').select('*, sender:sender_id(*), receiver:receiver_id(*)').or(`sender_id.eq.${currentUser.id},receiver_id.eq.${currentUser.id}`).order('created_at', { ascending: false });
    const conversations = {};
    messages.forEach(msg => { const otherUser = msg.sender_id === currentUser.id ? msg.receiver : msg.sender; if (!conversations[otherUser.id]) conversations[otherUser.id] = { user: otherUser, lastMessage: msg }; });
    const conversationList = Object.values(conversations).sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at));
    let chatHtml = `<div class="empty-state"><h3>Select a conversation</h3></div>`;
    if (activeChatUser) {
        const { data: chatMessages } = await sb.from('csns_messages').select('*, sender:sender_id(*)').or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChatUser}),and(sender_id.eq.${activeChatUser},receiver_id.eq.${currentUser.id})`).order('created_at', { ascending: true });
        const otherProfile = conversationList.find(c => c.user.id === activeChatUser)?.user || (await sb.from('csns_profiles').select('*').eq('id', activeChatUser).single()).data;
        chatHtml = `<div class="chat-window"><div class="chat-header"><img src="${otherProfile?.avatar_url || `https://ui-avatars.com/api/?name=${otherProfile?.username}`}" class="post-avatar" style="width: 32px; height: 32px;"><span>${otherProfile?.full_name || otherProfile?.username}</span></div><div class="chat-messages">${chatMessages.map(msg => `<div class="message-bubble ${msg.sender_id === currentUser.id ? 'message-sent' : 'message-received'}">${msg.content}</div>`).join('')}</div><div class="chat-input-area"><input id="dm-input" class="chat-input" placeholder="Type a message..." onkeypress="if(event.key==='Enter') sendDm()"><button onclick="sendDm()" class="btn btn-primary btn-sm">Send</button></div></div>`;
    }
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Messages</h1></header><div class="chat-layout"><div class="conversation-list">${conversationList.length > 0 ? conversationList.map(c => `<div class="conversation-item ${activeChatUser === c.user.id ? 'active' : ''}" onclick="selectConversation('${c.user.id}')"><img src="${c.user.avatar_url || `https://ui-avatars.com/api/?name=${c.user.username}`}" class="post-avatar" style="width: 40px; height: 40px;"><div style="overflow: hidden;"><div style="font-weight: 700; font-size: 0.9rem;">${c.user.full_name || c.user.username}</div><div style="font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${c.lastMessage.content}</div></div></div>`).join('') : '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No conversations.</div>'}</div>${chatHtml}</div>`, 'messages');
}

window.selectConversation = function(userId) { activeChatUser = userId; renderMessages(); }
window.sendDm = async function() { const input = document.getElementById('dm-input'); if (!input.value.trim() || !activeChatUser) return; const { error } = await sb.from('csns_messages').insert({ sender_id: currentUser.id, receiver_id: activeChatUser, content: input.value }); if (error) alert('Error sending message: ' + error.message); createNotification(currentUser.id, activeChatUser, 'message'); input.value = ''; renderMessages(); }

async function renderCommunities() {
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Communities</h1><button onclick="createCommunity()" class="btn btn-primary btn-sm" style="margin-left: auto;">+ New Community</button></header><div id="communities-list"></div>`, 'communities');
    const { data: communities, error } = await sb.from('csns_communities').select('*').order('created_at', { ascending: false });
    const listEl = document.getElementById('communities-list');
    if (error) { listEl.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--accent-danger);">Error loading communities: ${error.message}</div>`; return; }
    if (!communities || communities.length === 0) { listEl.innerHTML = '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No communities yet. Create one!</div>'; return; }
    listEl.innerHTML = communities.map(c => `<a class="community-card" onclick="searchTag('${c.name}')"><div class="community-name">c/${c.name}</div><div style="font-size: 0.9rem; color: var(--text-muted);">${c.description}</div></a>`).join('');
}

async function renderEvents() {
    app.innerHTML = renderLayout(`<header class="page-header"><h1 class="page-title">Events</h1><button onclick="createEvent()" class="btn btn-primary btn-sm" style="margin-left: auto;">+ New Event</button></header><div id="events-list"></div>`, 'events');
    const { data: events, error } = await sb.from('csns_events').select('*').order('event_date', { ascending: true });
    const listEl = document.getElementById('events-list');
    if (error) { listEl.innerHTML = `<div style="padding: 2rem; text-align: center; color: var(--accent-danger);">Error loading events: ${error.message}</div>`; return; }
    if (!events || events.length === 0) { listEl.innerHTML = '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No events yet. Create one!</div>'; return; }
    listEl.innerHTML = events.map(e => `<a href="${e.url || '#'}" target="_blank" class="event-item"><div class="event-title">${e.title}</div><div style="font-size: 0.9rem; color: var(--text-muted);">${new Date(e.event_date).toLocaleString()}</div>${e.description ? `<p style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--text-secondary);">${e.description}</p>` : ''}</a>`).join('');
}

async function renderSettings() {
    if (!currentUser) { app.innerHTML = renderLayout('<div class="empty-state">Sign in to view settings.</div>', 'settings'); return; }
    let centerContent = `
        <header class="page-header"><h1 class="page-title">Settings</h1></header>
        <div class="settings-layout">
            <div class="settings-nav">
                <div class="settings-tab ${settingsTab === 'profile' ? 'active' : ''}" onclick="setSettingsTab('profile')">Profile</div>
                <div class="settings-tab ${settingsTab === 'readme' ? 'active' : ''}" onclick="setSettingsTab('readme')">Readme</div>
            </div>
            <div style="flex: 1;">
    `;
    if (settingsTab === 'profile') {
        centerContent += `
            <div class="settings-form">
                <div class="modal-input-group"><label class="modal-label">Full Name</label><input id="settings-fullname" type="text" class="modal-input" value="${currentUser.full_name || ''}"></div>
                <div class="modal-input-group"><label class="modal-label">Bio</label><textarea id="settings-bio" class="modal-input modal-textarea">${currentUser.bio || ''}</textarea></div>
                <div class="modal-input-group"><label class="modal-label">Accent Color</label><input id="settings-accent" type="color" class="modal-input" style="height: 40px; padding: 4px;" value="${currentUser.accent_color || '#00d4ff'}"></div>
                <div class="modal-input-group"><label class="modal-label">Avatar Image URL</label><input id="settings-avatar" type="text" class="modal-input" value="${currentUser.avatar_url || ''}"></div>
                <div class="modal-input-group"><label class="modal-label">Banner Image URL</label><input id="settings-banner" type="text" class="modal-input" value="${currentUser.banner_url || ''}"></div>
                <div class="modal-input-group"><label class="modal-label">GitHub URL</label><input id="settings-github" type="text" class="modal-input" value="${currentUser.github_url || ''}"></div>
                <div class="modal-input-group"><label class="modal-label">GitLab URL</label><input id="settings-gitlab" type="text" class="modal-input" value="${currentUser.gitlab_url || ''}"></div>
                <div class="modal-input-group"><label class="modal-label">LinkedIn URL</label><input id="settings-linkedin" type="text" class="modal-input" value="${currentUser.linkedin_url || ''}"></div>
                <div class="modal-input-group"><label class="modal-label">Twitter URL</label><input id="settings-twitter" type="text" class="modal-input" value="${currentUser.twitter_url || ''}"></div>
                <button onclick="saveProfileSettings()" class="btn btn-primary">Save Profile</button>
            </div>
        `;
    } else if (settingsTab === 'readme') {
        centerContent += `
            <div class="settings-form">
                <div class="modal-input-group"><label class="modal-label">Profile Readme (Markdown supported)</label><textarea id="settings-readme" class="modal-input" style="min-height: 300px; font-family: monospace;">${currentUser.readme || ''}</textarea></div>
                <button onclick="saveProfileSettings()" class="btn btn-primary">Save Readme</button>
            </div>
        `;
    }
    centerContent += `</div></div>`;
    app.innerHTML = renderLayout(centerContent, 'settings');
}

async function renderProfile(profileId) {
    const { data: profile } = await sb.from('csns_profiles').select('*').eq('id', profileId).single();
    const { data: allPosts } = await sb.from('csns_posts').select(`*, csns_profiles:user_id (*), csns_post_repos (*), csns_likes (user_id), csns_reactions (user_id, type), csns_bookmarks (user_id), parent:parent_post_id (*, csns_profiles:user_id (*)), csns_polls (*, csns_poll_votes (user_id, option_index))`).eq('user_id', profileId).order('created_at', { ascending: false });
    
    let posts = allPosts.filter(p => !p.pinned);
    let pinnedPosts = allPosts.filter(p => p.pinned);
    if (profileSort === 'oldest') posts.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
    else if (profileSort === 'popular') posts.sort((a,b) => b.csns_likes.length - a.csns_likes.length);

    let isFollowing = false;
    if (currentUser) { const { data } = await sb.from('csns_follows').select('*').match({ follower_id: currentUser.id, following_id: profileId }); isFollowing = data.length > 0; }
    const { count: csnsFollowers } = await sb.from('csns_follows').select('*', { count: 'exact', head: true }).eq('following_id', profileId);
    const { count: csnsFollowing } = await sb.from('csns_follows').select('*', { count: 'exact', head: true }).eq('follower_id', profileId);
    
    let badgeHtml = ''; let totalLikes = 0; let totalStars = 0; let ghFollowers = 0; let ghRepos = 0;
    posts.forEach(p => totalLikes += p.csns_likes.length);
    let achievements = [];
    if (posts.length > 0) achievements.push({ name: 'First Post', icon: 'post' });
    if (totalLikes >= 10) achievements.push({ name: 'Getting Likes', icon: 'heart' });
    if (profile.is_premium) achievements.push({ name: 'Premium', icon: 'crown' });

    let metaItems = [];
    if (profile.github_url) metaItems.push(`<a href="${profile.github_url}" target="_blank" class="profile-meta-item">GitHub</a>`);
    if (profile.gitlab_url) metaItems.push(`<a href="${profile.gitlab_url}" target="_blank" class="profile-meta-item">GitLab</a>`);

    if (profile.github_url) {
        const ghUsername = profile.github_url.split('github.com/')[1];
        if (ghUsername) {
            try {
                const ghRes = await fetch(`https://api.github.com/users/${ghUsername}`);
                const ghData = await ghRes.json();
                ghFollowers = ghData.followers || 0; ghRepos = ghData.public_repos || 0;
                const reposRes = await fetch(`https://api.github.com/users/${ghUsername}/repos?per_page=100`);
                const reposData = await reposRes.json();
                if (Array.isArray(reposData)) totalStars = reposData.reduce((acc, r) => acc + r.stargazers_count, 0);
                const score = ghFollowers + ghRepos + totalStars;
                let badgeClass = 'badge-junior'; let badgeText = 'Junior Dev';
                if (score > 50) { badgeClass = 'badge-mid'; badgeText = 'Mid Dev'; }
                if (score > 200) { badgeClass = 'badge-senior'; badgeText = 'Senior Dev'; }
                badgeHtml = `<span class="dev-badge ${badgeClass}">${badgeText}</span>`;
            } catch(e) {}
        }
    }

    const verifiedHtml = profile.is_verified ? `<span class="verified-badge"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : '';
    
    let tabContent = '';
    if (profileTab === 'posts') {
        let postsHtml = (pinnedPosts.length > 0 ? pinnedPosts.map(p => renderPostCard(p)).join('') : '') + posts.map(p => renderPostCard(p)).join('');
        tabContent = postsHtml || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No posts yet.</div>';
    } else if (profileTab === 'readme') {
        tabContent = `<div style="padding: 2rem; color: var(--text-secondary); line-height: 1.6;">${profile.readme ? profile.readme.replace(/\n/g, '<br>') : 'No readme yet.'}</div>`;
    }

    const centerContent = `
        <header class="page-header">
            <span class="header-back" onclick="currentView='feed'; renderApp()"><svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg></span>
            <div><h1 class="page-title">${profile.full_name || profile.username}</h1><div class="header-subtitle">${posts.length} Posts</div></div>
            ${currentUser && currentUser.id === profileId ? `<button onclick="currentView='settings'; renderApp()" class="btn btn-ghost btn-sm" style="margin-left: auto;">Settings</button>` : ''}
        </header>
        <div class="profile-header fade-in">
            <div class="profile-banner" style="${profile.banner_url ? `background-image: url('${profile.banner_url}')` : ''}"></div>
            <div class="profile-avatar-wrapper">
                <img src="${profile.avatar_url || `https://ui-avatars.com/api/?name=${profile.username}`}" class="profile-avatar-main">
                ${currentUser && currentUser.id !== profileId ? `<div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;"><button onclick="handleFollow('${profileId}', ${isFollowing})" class="btn ${isFollowing ? 'btn-ghost' : 'btn-primary'} btn-sm">${isFollowing ? 'Following' : 'Follow'}</button></div>` : ''}
            </div>
            <div class="profile-info">
                <h2 style="font-size: 1.5rem; font-weight: 800; display: flex; align-items: center; gap: 0.5rem;">${profile.full_name || profile.username} ${verifiedHtml} ${badgeHtml}</h2>
                <p style="color: var(--text-muted);" class="font-mono">@${profile.username}</p>
                ${profile.bio ? `<p class="profile-bio" style="margin-top: 0.5rem;">${profile.bio}</p>` : ''}
            </div>
            <div class="profile-section">
                <div class="section-label">CodeSNS Stats</div>
                <div class="stats-grid">
                    <div class="stat-box"><div class="stat-value">${posts.length}</div><div class="stat-label">Posts</div></div>
                    <div class="stat-box"><div class="stat-value">${csnsFollowers || 0}</div><div class="stat-label">Followers</div></div>
                    <div class="stat-box"><div class="stat-value">${csnsFollowing || 0}</div><div class="stat-label">Following</div></div>
                </div>
            </div>
            ${profile.github_url ? `
            <div class="profile-section">
                <div class="section-label">GitHub Stats</div>
                <div class="stats-grid">
                    <div class="stat-box"><div class="stat-value">${ghRepos}</div><div class="stat-label">Repos</div></div>
                    <div class="stat-box"><div class="stat-value">${totalStars}</div><div class="stat-label">Stars</div></div>
                    <div class="stat-box"><div class="stat-value">${ghFollowers}</div><div class="stat-label">Followers</div></div>
                </div>
            </div>` : ''}
            ${metaItems.length > 0 ? `<div class="profile-section"><div class="section-label">Details</div><div class="profile-meta-row" style="border: none; padding: 0; gap: 1rem 1.5rem;">${metaItems.join('')}</div></div>` : ''}
        </div>
        <div class="profile-tabs">
            <div class="profile-tab ${profileTab === 'posts' ? 'active' : ''}" onclick="setProfileTab('posts')">Posts</div>
            <div class="profile-tab ${profileTab === 'readme' ? 'active' : ''}" onclick="setProfileTab('readme')">Readme</div>
        </div>
        <div id="feed">${tabContent}</div>
    `;
    app.innerHTML = renderLayout(centerContent, 'profile');
    applySyntaxHighlighting();
}

function applySyntaxHighlighting() { document.querySelectorAll('pre code').forEach(block => { if (!block.dataset.highlighted) { hljs.highlightElement(block); block.dataset.highlighted = 'true'; } }); }

function renderPostCard(post) {
    const isSaved = currentUser ? post.csns_bookmarks.some(b => b.user_id === currentUser.id) : false;
    const isLiked = currentUser ? post.csns_likes.some(l => l.user_id === currentUser.id) : false;
    const timeAgo = new Date(post.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
    
    let contentHtml = post.content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/```([\s\S]*?)```/g, (match, p1) => `<div class="code-block-wrapper"><div class="code-actions"><button class="code-btn" onclick="copyCode(this)">Copy</button><button class="code-btn" onclick="runCode(this)">Run</button></div><pre class="code-block"><code class="hljs">${p1}</code></pre><div class="code-output"></div></div>`)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/#(\w+)/g, '<a class="hashtag" onclick="searchTag(\'$1\')">#$1</a>')
        .replace(/\n/g, '<br>');
        
    let pollHtml = '';
    if (post.csns_polls && post.csns_polls.length > 0) {
        const poll = post.csns_polls[0];
        const userVoteObj = currentUser ? poll.csns_poll_votes.find(v => v.user_id === currentUser.id) : null;
        const totalVotes = poll.csns_poll_votes.length;
        pollHtml += '<div class="poll-container">';
        poll.options.forEach((opt, index) => {
            const voteCount = poll.csns_poll_votes.filter(v => v.option_index === index).length;
            const percentage = totalVotes > 0 ? Math.round((voteCount / totalVotes) * 100) : 0;
            pollHtml += `<div class="poll-option" style="margin-bottom: 0.5rem;">`;
            if (userVoteObj || !currentUser) {
                pollHtml += `<div style="display: flex; justify-content: space-between;"><span>${opt} ${userVoteObj && userVoteObj.option_index === index ? '(You)' : ''}</span><span>${percentage}%</span></div><div class="poll-results-bar"><div class="poll-results-fill" style="width: ${percentage}%;"></div></div>`;
            } else {
                pollHtml += `<button onclick="votePoll('${poll.id}', ${index})" class="poll-btn">${opt}</button>`;
            }
            pollHtml += `</div>`;
        });
        pollHtml += '</div>';
    }

    const emojis = [
        { type: 'heart', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />' }, 
        { type: 'fire', icon: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.24 17 6.343 18.657 8 18 12 18 12s.5 1 1.5 1.5c0 0-1 2-2 3.157z" />' }
    ];
    const reactionHtml = emojis.map(r => {
        const count = post.csns_reactions.filter(l => l.type === r.type).length;
        const isActive = currentUser ? post.csns_reactions.some(l => l.user_id === currentUser.id && l.type === r.type) : false;
        return `<button onclick="handleReaction('${post.id}', '${r.type}', '${post.user_id}')" class="action-btn ${isActive ? 'liked' : ''}"><svg style="width: 18px; height: 18px;" fill="${isActive ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24">${r.icon}</svg> ${count > 0 ? count : ''}</button>`;
    }).join('');

    return `
        <div class="post-card fade-in" style="position: relative;" onclick="currentView='profile_${post.user_id}'; renderApp()">
            ${currentUser && currentUser.id === post.user_id ? `<button class="delete-post-btn" onclick="event.stopPropagation(); deletePost('${post.id}')"><svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>` : ''}
            <div style="display: flex; gap: 1rem;" onclick="event.stopPropagation()">
                <img src="${post.csns_profiles?.avatar_url || `https://ui-avatars.com/api/?name=${post.csns_profiles?.username}`}" class="post-avatar" onclick="currentView='profile_${post.user_id}'; renderApp()">
                <div style="flex: 1;">
                    <div class="post-header" style="margin-bottom: 0;">
                        <span class="post-name" onclick="currentView='profile_${post.user_id}'; renderApp()">${post.csns_profiles?.full_name || post.csns_profiles?.username}</span>
                        ${post.csns_profiles?.is_verified ? `<span class="verified-badge" style="width: 14px; height: 14px;"><svg style="width: 8px; height: 8px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>` : ''}
                        <span class="post-username">@${post.csns_profiles?.username}</span>
                        <span style="color: var(--text-muted); font-size: 0.9rem;">• ${timeAgo}</span>
                        ${post.community ? `<span style="color: var(--accent-primary); font-size: 0.8rem; margin-left: 0.5rem;">c/${post.community}</span>` : ''}
                    </div>
                    ${post.post_type !== 'post' ? `<div class="post-tag tag-${post.post_type}">${post.post_type}</div>` : ''}
                    <div class="post-content">${contentHtml}</div>
                    ${post.image_url ? `<img src="${post.image_url}" class="post-image" alt="Post image">` : ''}
                    ${pollHtml}
                    ${post.csns_post_repos && post.csns_post_repos.length > 0 ? post.csns_post_repos.map(repo => `<a href="${repo.repo_url}" target="_blank" class="repo-embed" data-owner="${repo.owner}" data-repo="${repo.repo_name}"><div class="repo-embed-content"><div class="repo-embed-header">${repo.platform === 'github' ? `<svg style="width: 20px; height: 20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>` : `<svg style="width: 20px; height: 20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M23.955 13.587l-1.347-4.135-2.664-8.197a.455.455 0 00-.867 0L16.413 9.45H7.587L4.923 1.255a.455.455 0 00-.867 0L1.392 9.452.045 13.587a.924.924 0 00.331 1.023L12 23.054l11.624-8.443a.92.92 0 00.331-1.024"/></svg>`} ${repo.owner} / ${repo.repo_name}</div><div class="repo-embed-desc font-mono">${repo.repo_url}</div><div class="repo-stats"><span class="repo-stat">Loading stats...</span></div></div></a>`).join('') : ''}
                    <div class="post-actions">
                        <button onclick="toggleComments('${post.id}', '${post.user_id}')" class="action-btn"><svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg></button>
                        <button onclick="showQuoteModal('${post.id}', false)" class="action-btn"><svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg></button>
                        <button onclick="handleLike('${post.id}', '${post.user_id}')" class="action-btn ${isLiked ? 'liked' : ''}"><svg style="width: 18px; height: 18px;" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg> ${post.csns_likes.length > 0 ? post.csns_likes.length : ''}</button>
                        ${reactionHtml}
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
