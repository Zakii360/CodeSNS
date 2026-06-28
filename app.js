const SUPABASE_URL = 'https://tvxugmumfvgnvjacwwfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2eHVnbXVtZnZnbnZqYWN3d2Z6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NjQ1MzEsImV4cCI6MjA5NjM0MDUzMX0.76wR9dblt8W9u-OioqQH7NOethNq1BMfjTDl9xcpYYI';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
    }
});

const app = document.getElementById('app');
let currentUser = null;
let currentView = 'feed'; 
let selectedImageFile = null;
let devTip = "Use `git commit --amend` to modify your most recent commit without creating a new one.";

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
                id: session.user.id,
                username: username,
                full_name: meta.full_name || username,
                avatar_url: meta.avatar_url,
                github_url: `https://github.com/${meta.user_name}`
            }).select().single();
            profile = newProfile;
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
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') checkAuth();
});

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

window.handlePost = async function() {
    const content = document.getElementById('post-content').value;
    const repoUrl = document.getElementById('repo-url').value;
    if (!content.trim()) return;

    let imageUrl = null;
    
    if (selectedImageFile) {
        const fileName = `${Date.now()}_${selectedImageFile.name}`;
        const { data: uploadData, error: uploadError } = await sb.storage.from('post_images').upload(fileName, selectedImageFile);
        if (!uploadError) {
            imageUrl = sb.storage.from('post_images').getPublicUrl(fileName).data.publicUrl;
        }
        selectedImageFile = null;
    }

    const { data: newPost, error } = await sb.from('csns_posts').insert({
        content, user_id: currentUser.id, image_url: imageUrl
    }).select('id').single();

    if (error) { alert('Error posting'); return; }

    if (repoUrl) {
        try {
            const u = new URL(repoUrl);
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length >= 2 && (u.hostname.includes('github') || u.hostname.includes('gitlab'))) {
                const platform = u.hostname.includes('github') ? 'github' : 'gitlab';
                await sb.from('csns_post_repos').insert({
                    post_id: newPost.id, platform,
                    owner: parts[0], repo_name: parts[1], repo_url: repoUrl
                });
            }
        } catch(e) {}
    }
    renderApp();
}

window.handleLike = async function(postId, isLiked) {
    if (!currentUser) return alert('Please login to like posts.');
    if (isLiked) {
        await sb.from('csns_likes').delete().match({ post_id: postId, user_id: currentUser.id });
    } else {
        await sb.from('csns_likes').insert({ post_id: postId, user_id: currentUser.id });
    }
    renderApp();
}

window.handleFollow = async function(targetId, isFollowing) {
    if (!currentUser) return;
    if (isFollowing) {
        await sb.from('csns_follows').delete().match({ follower_id: currentUser.id, following_id: targetId });
    } else {
        await sb.from('csns_follows').insert({ follower_id: currentUser.id, following_id: targetId });
    }
    renderApp();
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
        
        if (currentUser) {
            html += `<div class="comment-input-area"><input id="comment-input-${postId}" type="text" placeholder="Tweet your reply..."><button onclick="submitComment('${postId}')" class="btn btn-primary btn-sm">Reply</button></div>`;
        }
        section.innerHTML = html || '<div style="padding: 1rem; text-align: center; color: var(--text-muted);">No comments yet.</div>';
    } else {
        section.style.display = 'none';
    }
}

window.submitComment = async function(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    if (!input.value.trim()) return;
    await sb.from('csns_comments').insert({ post_id: postId, user_id: currentUser.id, content: input.value });
    toggleComments(postId);
    setTimeout(() => toggleComments(postId), 200);
}

window.showEditProfile = function() {
    const modal = document.getElementById('edit-modal');
    modal.style.display = 'flex';
    document.getElementById('edit-fullname').value = currentUser.full_name || '';
    document.getElementById('edit-bio').value = currentUser.bio || '';
    document.getElementById('edit-avatar-url').value = currentUser.avatar_url || '';
    document.getElementById('edit-banner-url').value = currentUser.banner_url || '';
}

window.closeEditProfile = function() {
    document.getElementById('edit-modal').style.display = 'none';
}

window.saveProfile = async function() {
    const fullName = document.getElementById('edit-fullname').value;
    const bio = document.getElementById('edit-bio').value;
    const avatarUrl = document.getElementById('edit-avatar-url').value;
    const bannerUrl = document.getElementById('edit-banner-url').value;
    
    const { data } = await sb.from('csns_profiles').update({ 
        full_name: fullName, 
        bio: bio, 
        avatar_url: avatarUrl,
        banner_url: bannerUrl
    }).eq('id', currentUser.id).select().single();
    
    currentUser = data;
    closeEditProfile();
    renderApp();
}

async function renderApp() {
    if (currentView.startsWith('profile_')) {
        await renderProfile(currentView.split('_')[1]);
    } else {
        await renderFeed();
    }
}

function renderLayout(centerContent, activeNav = 'home') {
    const avatarUrl = currentUser?.avatar_url || `https://ui-avatars.com/api/?name=${currentUser?.username || 'Guest'}`;
    
    return `
        <div class="main-layout">
            <div id="edit-modal" class="modal-overlay" style="display: none;">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2 class="modal-title">Edit Profile</h2>
                        <button class="modal-close" onclick="closeEditProfile()">&times;</button>
                    </div>
                    <div class="modal-input-group">
                        <label class="modal-label">Full Name</label>
                        <input id="edit-fullname" type="text" class="modal-input">
                    </div>
                    <div class="modal-input-group">
                        <label class="modal-label">Bio</label>
                        <textarea id="edit-bio" class="banner-input"></textarea>
                    </div>
                    <div class="modal-input-group">
                        <label class="modal-label">Avatar Image URL</label>
                        <input id="edit-avatar-url" type="text" class="modal-input" placeholder="https://...">
                    </div>
                    <div class="modal-input-group">
                        <label class="modal-label">Banner Image URL</label>
                        <input id="edit-banner-url" type="text" class="modal-input" placeholder="https://...">
                    </div>
                    <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;">
                        <button class="btn btn-ghost btn-sm" onclick="closeEditProfile()">Cancel</button>
                        <button class="btn btn-primary btn-sm" onclick="saveProfile()">Save</button>
                    </div>
                </div>
            </div>

            <aside class="left-sidebar">
                <div class="logo">⚡ CodeSNS</div>
                <nav style="flex: 1;">
                    <a class="nav-item ${activeNav === 'home' ? 'active' : ''}" onclick="currentView='feed'; renderApp()">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
                        <span>Home</span>
                    </a>
                    ${currentUser ? `
                        <a class="nav-item ${activeNav === 'profile' ? 'active' : ''}" onclick="currentView='profile_${currentUser.id}'; renderApp()">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                            <span>Profile</span>
                        </a>
                        <a class="nav-item" onclick="showEditProfile()">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                            <span>Edit Profile</span>
                        </a>
                    ` : ''}
                </nav>
                
                ${currentUser ? `
                    <div class="user-card" onclick="logout()">
                        <img src="${avatarUrl}" class="post-avatar" style="width: 40px; height: 40px;">
                        <div style="overflow: hidden;">
                            <div style="font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${currentUser?.full_name}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted);" class="font-mono">@${currentUser.username}</div>
                        </div>
                    </div>
                ` : `
                    <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-top: auto; padding: 0 0.5rem;">
                        <button onclick="loginWithGithub()" class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;">GitHub</button>
                        <button onclick="loginWithGitlab()" class="btn btn-ghost btn-sm" style="width: 100%; justify-content: center;">GitLab</button>
                    </div>
                `}
            </aside>

            <main class="center-feed">${centerContent}</main>

            <aside class="right-sidebar">
                <input type="text" class="search-box" placeholder="Search CodeSNS...">
                <div class="widget">
                    <h3 class="widget-title">🔥 Trending Repos</h3>
                    <div class="trend-item">
                        <div class="font-mono" style="color: var(--accent-primary); font-size: 0.9rem;">vercel / next.js</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">The React Framework for the Web</div>
                    </div>
                    <div class="trend-item">
                        <div class="font-mono" style="color: var(--accent-primary); font-size: 0.9rem;">supabase / supabase</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">The open source Firebase alternative.</div>
                    </div>
                </div>
                <div class="widget">
                    <h3 class="widget-title">💡 AI Dev Tip</h3>
                    <p id="dev-tip-text" style="font-size: 0.9rem; color: var(--text-secondary); line-height: 1.5;">
                        ${devTip}
                    </p>
                </div>
            </aside>
        </div>
    `;
}

async function renderFeed() {
    const { data: posts } = await sb.from('csns_posts').select(`*, csns_profiles:user_id (*), csns_post_repos (*), csns_likes (user_id)`).order('created_at', { ascending: false });
    const centerContent = `
        <header class="page-header"><h1 class="page-title">Home</h1></header>

        ${currentUser ? `
            <div class="composer fade-in">
                <img src="${currentUser.avatar_url || `https://ui-avatars.com/api/?name=${currentUser.username}`}" class="post-avatar">
                <div style="flex: 1;">
                    <textarea id="post-content" placeholder="What did you code today?" rows="3"></textarea>
                    <input id="repo-url" type="text" placeholder="Attach GitHub/GitLab repo link (optional)">
                    
                    <div class="upload-btn-wrapper">
                        <label class="upload-btn">
                            <svg style="width: 20px; height: 20px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            <span>Add Image</span>
                            <input id="image-upload" type="file" accept="image/*" style="display: none;" onchange="handleImageSelect(this)">
                        </label>
                        <img id="image-preview" class="image-preview" style="display: none;" />
                    </div>
                    
                    <div style="display: flex; justify-content: flex-end; margin-top: 1rem;">
                        <button onclick="handlePost()" class="btn btn-primary">Post Code</button>
                    </div>
                </div>
            </div>
        ` : `
            <div style="padding: 3rem 2rem; text-align: center; border-bottom: 1px solid var(--border-light);">
                <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Welcome to CodeSNS</h2>
                <p style="color: var(--text-muted); margin-bottom: 1.5rem;">Sign in to join the conversation.</p>
                <div style="display: flex; gap: 0.75rem; justify-content: center;">
                    <button onclick="loginWithGithub()" class="btn btn-ghost">GitHub</button>
                    <button onclick="loginWithGitlab()" class="btn btn-ghost">GitLab</button>
                </div>
            </div>
        `}

        <div id="feed">
            ${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No posts yet. Be the first to share!</div>'}
        </div>
    `;
    app.innerHTML = renderLayout(centerContent, 'home');
}

async function renderProfile(profileId) {
    const { data: profile } = await sb.from('csns_profiles').select('*').eq('id', profileId).single();
    const { data: posts } = await sb.from('csns_posts').select(`*, csns_profiles:user_id (*), csns_post_repos (*), csns_likes (user_id)`).eq('user_id', profileId).order('created_at', { ascending: false });
    
    let isFollowing = false;
    if (currentUser) {
        const { data } = await sb.from('csns_follows').select('*').match({ follower_id: currentUser.id, following_id: profileId });
        isFollowing = data.length > 0;
    }

    const centerContent = `
        <header class="page-header">
            <span class="header-back" onclick="currentView='feed'; renderApp()">
                <svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </span>
            <div>
                <h1 class="page-title">${profile.full_name || profile.username}</h1>
                <div class="header-subtitle">${posts.length} Posts</div>
            </div>
        </header>

        <div class="profile-header fade-in">
            <div class="profile-banner" style="${profile.banner_url ? `background-image: url('${profile.banner_url}')` : ''}"></div>
            <div class="profile-avatar-wrapper">
                <img src="${profile.avatar_url || `https://ui-avatars.com/api/?name=${profile.username}`}" class="profile-avatar-main">
                ${currentUser && currentUser.id !== profileId ? `
                    <button onclick="handleFollow('${profileId}', ${isFollowing})" class="btn ${isFollowing ? 'btn-ghost' : 'btn-primary'} btn-sm" style="margin-bottom: 1rem;">
                        ${isFollowing ? 'Following' : 'Follow'}
                    </button>
                ` : currentUser && currentUser.id === profileId ? `
                    <button onclick="showEditProfile()" class="btn btn-ghost btn-sm" style="margin-bottom: 1rem;">Edit Profile</button>
                ` : ''}
            </div>
            <div class="profile-info">
                <h2 style="font-size: 1.5rem; font-weight: 800;">${profile.full_name || profile.username}</h2>
                <p style="color: var(--text-muted);" class="font-mono">@${profile.username}</p>
                ${profile.bio ? `<p class="profile-bio">${profile.bio}</p>` : '<p class="profile-bio" style="font-style: italic; color: var(--text-muted);">No bio yet.</p>'}
            </div>
        </div>

        <div id="feed">
            ${posts.map(post => renderPostCard(post)).join('') || '<div style="padding: 3rem; text-align: center; color: var(--text-muted);">No posts yet.</div>'}
        </div>
    `;
    app.innerHTML = renderLayout(centerContent, 'profile');
}

function renderPostCard(post) {
    const isLiked = currentUser ? post.csns_likes.some(l => l.user_id === currentUser.id) : false;
    const timeAgo = new Date(post.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
    
    let contentHtml = post.content
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/```([\s\S]*?)```/g, '<div class="code-block">$1</div>')
        .replace(/\n/g, '<br>');

    return `
        <div class="post-card fade-in" onclick="currentView='profile_${post.user_id}'; renderApp()">
            <div style="display: flex; gap: 1rem;" onclick="event.stopPropagation()">
                <img src="${post.csns_profiles?.avatar_url || `https://ui-avatars.com/api/?name=${post.csns_profiles?.username}`}" class="post-avatar" onclick="currentView='profile_${post.user_id}'; renderApp()">
                <div style="flex: 1;">
                    <div class="post-header" style="margin-bottom: 0;">
                        <span class="post-name" onclick="currentView='profile_${post.user_id}'; renderApp()">${post.csns_profiles?.full_name || post.csns_profiles?.username}</span>
                        <span class="post-username">@${post.csns_profiles?.username}</span>
                        <span style="color: var(--text-muted); font-size: 0.9rem;">• ${timeAgo}</span>
                    </div>
                    
                    <div class="post-content">${contentHtml}</div>

                    ${post.image_url ? `<img src="${post.image_url}" class="post-image" alt="Post image">` : ''}

                    ${post.csns_post_repos && post.csns_post_repos.length > 0 ? `
                        ${post.csns_post_repos.map(repo => `
                            <a href="${repo.repo_url}" target="_blank" class="repo-embed">
                                <div class="repo-embed-content">
                                    <div class="repo-embed-header">
                                        ${repo.platform === 'github' ? 
                                            `<svg style="width: 20px; height: 20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>` 
                                            : 
                                            `<svg style="width: 20px; height: 20px;" fill="currentColor" viewBox="0 0 24 24"><path d="M23.955 13.587l-1.347-4.135-2.664-8.197a.455.455 0 00-.867 0L16.413 9.45H7.587L4.923 1.255a.455.455 0 00-.867 0L1.392 9.452.045 13.587a.924.924 0 00.331 1.023L12 23.054l11.624-8.443a.92.92 0 00.331-1.024"/></svg>`
                                        }
                                        ${repo.owner} / ${repo.repo_name}
                                    </div>
                                    <div class="repo-embed-desc font-mono">${repo.repo_url}</div>
                                </div>
                            </a>
                        `).join('')}
                    ` : ''}

                    <div class="post-actions">
                        <button onclick="toggleComments('${post.id}')" class="action-btn">
                            <svg style="width: 18px; height: 18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                        </button>
                        <button onclick="handleLike('${post.id}', ${isLiked})" class="action-btn ${isLiked ? 'liked' : ''}">
                            <svg style="width: 18px; height: 18px;" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                            <span>${post.csns_likes.length}</span>
                        </button>
                    </div>

                    <div id="comments-${post.id}" class="comment-section" style="display: none;"></div>
                </div>
            </div>
        </div>
    `;
}

fetchDevTip();
checkAuth();
