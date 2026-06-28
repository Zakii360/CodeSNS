// ==========================================
// 1. INITIALIZATION & CONFIG
// ==========================================
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

// ==========================================
// 2. AUTH & ROUTING
// ==========================================
async function checkAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        // Fetch profile
        let { data: profile } = await sb.from('csns_profiles').select('*').eq('id', session.user.id).single();
        
        // Fallback: If trigger missed, create profile manually
        if (!profile) {
            const meta = session.user.user_metadata;
            const username = meta.user_name || meta.full_name || session.user.email.split('@')[0];
            const { data: newProfile } = await sb.from('csns_profiles').insert({
                id: session.user.id,
                username: username,
                full_name: meta.full_name || username,
                avatar_url: meta.avatar_url
            }).select().single();
            profile = newProfile;
        }
        
        // Update missing avatar/github url if they logged in before but lacked metadata
        if (profile && !profile.avatar_url && session.user.user_metadata.avatar_url) {
            const { data: updated } = await sb.from('csns_profiles').update({
                avatar_url: session.user.user_metadata.avatar_url,
                github_url: `https://github.com/${session.user.user_metadata.user_name}`
            }).eq('id', session.user.id).select().single();
            profile = updated;
        }

        currentUser = profile;
    } else {
        currentUser = null;
    }
    renderApp();
}

window.loginWithGithub = async function() {
    await sb.auth.signInWithOAuth({
        provider: 'github',
        options: { 
            redirectTo: window.location.href 
        }
    });
}

window.logout = async function() {
    await sb.auth.signOut();
    currentUser = null;
    currentView = 'feed';
    renderApp();
}

sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        checkAuth();
    }
});

// ==========================================
// 3. DATA FETCHING
// ==========================================
async function fetchPosts(profileId = null) {
    let query = sb.from('csns_posts').select(`
        *,
        csns_profiles:user_id (*),
        csns_post_repos (*),
        csns_likes (user_id)
    `).order('created_at', { ascending: false });

    if (profileId) query = query.eq('user_id', profileId);
    const { data } = await query;
    return data || [];
}

async function fetchComments(postId) {
    const { data } = await sb.from('csns_comments')
        .select('*, csns_profiles:user_id (*)')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
    return data || [];
}

// ==========================================
// 4. ACTIONS (Post, Like, Follow, Comment)
// ==========================================
window.handlePost = async function() {
    const content = document.getElementById('post-content').value;
    const repoUrl = document.getElementById('repo-url').value;
    if (!content.trim()) return;

    const { data: newPost, error } = await sb.from('csns_posts').insert({
        content,
        user_id: currentUser.id
    }).select('id').single();

    if (error) { alert('Error posting'); return; }

    if (repoUrl) {
        try {
            const u = new URL(repoUrl);
            const parts = u.pathname.split('/').filter(Boolean);
            if (parts.length >= 2 && (u.hostname.includes('github') || u.hostname.includes('gitlab'))) {
                const platform = u.hostname.includes('github') ? 'github' : 'gitlab';
                await sb.from('csns_post_repos').insert({
                    post_id: newPost.id,
                    platform,
                    owner: parts[0],
                    repo_name: parts[1],
                    repo_url: repoUrl
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
    if (section.classList.contains('hidden')) {
        section.classList.remove('hidden');
        section.innerHTML = '<div class="p-4 text-center text-sm text-slate-500">Loading comments...</div>';
        const comments = await fetchComments(postId);
        
        let html = comments.map(c => `
            <div class="flex space-x-3 p-3 border-t border-slate-800">
                <img src="${c.csns_profiles?.avatar_url || `https://ui-avatars.com/api/?name=${c.csns_profiles?.username}`}" class="w-8 h-8 rounded-full">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-bold text-slate-200">${c.csns_profiles?.full_name || c.csns_profiles?.username}</span>
                        <span class="text-xs text-slate-500">@${c.csns_profiles?.username}</span>
                    </div>
                    <p class="text-sm text-slate-300 mt-1">${c.content}</p>
                </div>
            </div>
        `).join('');
        
        html += currentUser ? `
            <div class="p-3 border-t border-slate-800 flex gap-2">
                <input id="comment-input-${postId}" type="text" placeholder="Tweet your reply..." class="flex-1 bg-slate-900 text-sm text-slate-200 placeholder-slate-500 focus:outline-none p-2 rounded-md border border-slate-800 focus:border-cyan-500">
                <button onclick="submitComment('${postId}')" class="bg-cyan-500 hover:bg-cyan-600 text-white text-sm font-bold px-4 py-2 rounded-full">Reply</button>
            </div>
        ` : '';
        
        section.innerHTML = html || '<div class="p-4 text-center text-sm text-slate-500">No comments yet. Start the conversation!</div>';
    } else {
        section.classList.add('hidden');
    }
}

window.submitComment = async function(postId) {
    const input = document.getElementById(`comment-input-${postId}`);
    const content = input.value;
    if (!content.trim()) return;
    
    await sb.from('csns_comments').insert({
        post_id: postId,
        user_id: currentUser.id,
        content
    });
    toggleComments(postId);
    setTimeout(() => toggleComments(postId), 200); // Reopen to show new comment
}

// ==========================================
// 5. UI RENDERING & LAYOUT
// ==========================================
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
        <div class="flex max-w-screen-xl mx-auto">
            <!-- LEFT SIDEBAR -->
            <aside class="hidden md:flex flex-col w-20 lg:w-64 h-screen sticky top-0 p-2 lg:p-4 border-r border-slate-800">
                <div class="flex-1 space-y-2 mt-4">
                    <button onclick="currentView='feed'; renderApp()" class="flex items-center justify-center lg:justify-start gap-4 p-3 rounded-full hover:bg-slate-900 w-full transition-colors ${activeNav === 'home' ? 'text-cyan-400' : 'text-slate-200'}">
                        <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                        <span class="hidden lg:block text-xl font-black">CodeSNS</span>
                    </button>

                    ${currentUser ? `
                        <button onclick="currentView='profile_${currentUser.id}'; renderApp()" class="flex items-center justify-center lg:justify-start gap-4 p-3 rounded-full hover:bg-slate-900 w-full transition-colors ${activeNav === 'profile' ? 'text-cyan-400' : 'text-slate-200'}">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                            <span class="hidden lg:block text-lg font-medium">Profile</span>
                        </button>
                    ` : ''}
                </div>

                <div class="mb-4">
                    ${currentUser ? `
                        <button onclick="logout()" class="flex items-center justify-center lg:justify-start gap-4 p-3 rounded-full hover:bg-slate-900 w-full transition-colors text-slate-200">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                            <span class="hidden lg:block text-lg font-medium">Logout</span>
                        </button>
                        <div class="hidden lg:flex items-center gap-2 mt-4 p-2">
                            <img src="${avatarUrl}" class="w-10 h-10 rounded-full">
                            <div class="overflow-hidden">
                                <div class="font-bold text-sm truncate">${currentUser.full_name}</div>
                                <div class="text-slate-500 text-sm truncate">@${currentUser.username}</div>
                            </div>
                        </div>
                    ` : `
                        <button onclick="loginWithGithub()" class="bg-cyan-500 hover:bg-cyan-600 text-white font-bold py-2 px-4 rounded-full w-full text-sm">Sign In</button>
                    `}
                </div>
            </aside>

            <!-- CENTER MAIN FEED -->
            <main class="flex-1 max-w-xl border-x border-slate-800 min-h-screen">
                ${centerContent}
            </main>

            <!-- RIGHT SIDEBAR -->
            <aside class="hidden lg:block w-80 h-screen sticky top-0 p-4 space-y-4 overflow-y-auto">
                <div class="bg-slate-900 rounded-2xl p-4">
                    <h2 class="text-xl font-black mb-4 text-slate-100">Trending Repositories</h2>
                    <div class="space-y-3">
                        <div class="border-b border-slate-800 pb-3">
                            <div class="flex items-center gap-2 text-sm text-cyan-400 font-mono">
                                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                                facebook / react
                            </div>
                            <p class="text-xs text-slate-400 mt-1">The library for web and native UIs.</p>
                        </div>
                        <div class="border-b border-slate-800 pb-3">
                            <div class="flex items-center gap-2 text-sm text-cyan-400 font-mono">
                                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                                supabase / supabase
                            </div>
                            <p class="text-xs text-slate-400 mt-1">The open source Firebase alternative.</p>
                        </div>
                        <div>
                            <div class="flex items-center gap-2 text-sm text-cyan-400 font-mono">
                                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                                tailwindlabs / tailwindcss
                            </div>
                            <p class="text-xs text-slate-400 mt-1">A utility-first CSS framework for rapid UI development.</p>
                        </div>
                    </div>
                </div>
            </aside>
        </div>
    `;
}

async function renderFeed() {
    const posts = await fetchPosts();
    const centerContent = `
        <header class="sticky top-0 bg-black/80 backdrop-blur-md border-b border-slate-800 p-4 z-10 flex justify-between items-center">
            <h1 class="text-xl font-black text-slate-100">Home</h1>
            <div class="text-cyan-400 font-mono text-sm">#devlife</div>
        </header>

        ${currentUser ? `
            <div class="border-b border-slate-800 p-4 space-y-4">
                <div class="flex gap-4">
                    <img src="${currentUser.avatar_url || `https://ui-avatars.com/api/?name=${currentUser.username}`}" class="w-12 h-12 rounded-full">
                    <div class="flex-1">
                        <textarea id="post-content" placeholder="What did you code today?" class="w-full bg-transparent text-xl text-slate-200 placeholder-slate-500 focus:outline-none resize-none border-0" rows="3"></textarea>
                        <input id="repo-url" type="text" placeholder="Attach GitHub/GitLab repo link" class="w-full bg-slate-900 text-sm text-slate-300 placeholder-slate-600 rounded-md p-2 border border-slate-800 focus:border-cyan-500 focus:outline-none font-mono mt-2">
                    </div>
                </div>
                <div class="flex justify-end">
                    <button onclick="handlePost()" class="bg-cyan-500 hover:bg-cyan-600 text-white font-bold px-6 py-2 rounded-full transition-colors">Post</button>
                </div>
            </div>
        ` : `
            <div class="p-8 text-center border-b border-slate-800">
                <div class="mb-4">
                    <svg class="w-16 h-16 mx-auto text-cyan-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                </div>
                <h2 class="text-2xl font-black text-slate-100 mb-2">Welcome to CodeSNS</h2>
                <p class="text-slate-400 mb-4">Sign in with GitHub to see what developers are building.</p>
                <button onclick="loginWithGithub()" class="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-sm font-bold px-6 py-3 rounded-md flex items-center gap-2 transition mx-auto">
                    <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                    Sign in with GitHub
                </button>
            </div>
        `}

        <div id="feed" class="divide-y divide-slate-800">
            ${posts.map(post => renderPostCard(post)).join('') || '<p class="p-8 text-center text-slate-500 text-lg">No posts yet. Be the first to share your code!</p>'}
        </div>
    `;
    
    app.innerHTML = renderLayout(centerContent, 'home');
}

async function renderProfile(profileId) {
    const { data: profile } = await sb.from('csns_profiles').select('*').eq('id', profileId).single();
    const posts = await fetchPosts(profileId);
    
    let isFollowing = false;
    if (currentUser) {
        const { data } = await sb.from('csns_follows').select('*').match({ follower_id: currentUser.id, following_id: profileId });
        isFollowing = data.length > 0;
    }

    const centerContent = `
        <header class="sticky top-0 bg-black/80 backdrop-blur-md border-b border-slate-800 p-4 z-10 flex items-center gap-6">
            <button onclick="currentView='feed'; renderApp()" class="text-slate-200 hover:text-cyan-400">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
            </button>
            <div>
                <h1 class="text-xl font-black text-slate-100">${profile.full_name || profile.username}</h1>
                <p class="text-xs text-slate-500">${posts.length} Posts</p>
            </div>
        </header>

        <!-- Banner & Profile Info -->
        <div class="border-b border-slate-800">
            <div class="h-32 bg-gradient-to-r from-slate-800 to-slate-900"></div>
            <div class="p-4 relative">
                <img src="${profile.avatar_url || `https://ui-avatars.com/api/?name=${profile.username}`}" class="w-20 h-20 rounded-full border-4 border-black absolute -top-10 left-4 bg-slate-800">
                <div class="flex justify-end mb-4">
                    ${currentUser && currentUser.id !== profileId ? `
                        <button onclick="handleFollow('${profileId}', ${isFollowing})" class="${isFollowing ? 'bg-transparent border border-slate-700 text-slate-200 hover:bg-slate-900 hover:border-rose-500 hover:text-rose-500' : 'bg-cyan-500 hover:bg-cyan-600 text-white'} px-4 py-2 rounded-full text-sm font-bold transition-colors">
                            ${isFollowing ? 'Following' : 'Follow'}
                        </button>
                    ` : currentUser && currentUser.id === profileId ? `
                        <span class="text-xs text-slate-500 border border-slate-800 px-3 py-1 rounded-full">This is you</span>
                    ` : ''}
                </div>
                <div class="mt-4">
                    <h2 class="text-xl font-black text-slate-100">${profile.full_name || profile.username}</h2>
                    <p class="text-slate-500 font-mono">@${profile.username}</p>
                    ${profile.bio ? `<p class="mt-2 text-slate-300">${profile.bio}</p>` : '<p class="mt-2 text-slate-500 text-sm italic">No bio yet.</p>'}
                </div>
            </div>
        </div>

        <div id="feed" class="divide-y divide-slate-800">
            ${posts.map(post => renderPostCard(post)).join('') || '<p class="p-8 text-center text-slate-500 text-lg">No posts yet.</p>'}
        </div>
    `;

    app.innerHTML = renderLayout(centerContent, 'profile');
}

function renderPostCard(post) {
    const isLiked = currentUser ? post.csns_likes.some(l => l.user_id === currentUser.id) : false;
    const timeAgo = new Date(post.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
    
    // Parse markdown-like code blocks ```
    let contentHtml = post.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/```([\s\S]*?)```/g, '<div class="code-block">$1</div>')
        .replace(/\n/g, '<br>');

    return `
        <div class="p-4 hover:bg-slate-950 transition-colors cursor-pointer" onclick="currentView='profile_${post.user_id}'; renderApp()">
            <div class="flex gap-3" onclick="event.stopPropagation()">
                <img src="${post.csns_profiles?.avatar_url || `https://ui-avatars.com/api/?name=${post.csns_profiles?.username}`}" class="w-10 h-10 rounded-full hover:opacity-80 cursor-pointer" onclick="currentView='profile_${post.user_id}'; renderApp()">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-1 flex-wrap">
                        <span class="font-bold text-slate-100 hover:underline cursor-pointer" onclick="currentView='profile_${post.user_id}'; renderApp()">${post.csns_profiles?.full_name || post.csns_profiles?.username}</span>
                        <span class="text-slate-500 text-sm">@${post.csns_profiles?.username}</span>
                        <span class="text-slate-600 text-xs">•</span>
                        <span class="text-slate-500 text-sm">${timeAgo}</span>
                    </div>
                    
                    <div class="mt-1 text-slate-300 leading-relaxed">${contentHtml}</div>

                    ${post.csns_post_repos && post.csns_post_repos.length > 0 ? `
                        <div class="mt-3 border border-slate-800 rounded-xl overflow-hidden bg-slate-900 hover:border-slate-700 transition-colors">
                            ${post.csns_post_repos.map(repo => `
                                <a href="${repo.repo_url}" target="_blank" class="block p-4">
                                    <div class="flex items-center gap-2 mb-2">
                                        <svg class="w-5 h-5 text-slate-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                                        <span class="text-cyan-400 font-bold text-sm">${repo.owner} / ${repo.repo_name}</span>
                                    </div>
                                    <p class="text-xs text-slate-500 font-mono truncate">${repo.repo_url}</p>
                                </a>
                            `).join('')}
                        </div>
                    ` : ''}

                    <div class="flex items-center gap-8 mt-3 text-slate-500">
                        <button onclick="toggleComments('${post.id}')" class="flex items-center gap-2 hover:text-cyan-400 transition-colors group">
                            <div class="p-2 rounded-full group-hover:bg-cyan-500/10">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
                            </div>
                            <span class="text-xs">Reply</span>
                        </button>
                        <button onclick="handleLike('${post.id}', ${isLiked})" class="flex items-center gap-2 hover:text-rose-500 transition-colors group ${isLiked ? 'text-rose-500' : ''}">
                            <div class="p-2 rounded-full group-hover:bg-rose-500/10">
                                <svg class="w-4 h-4" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                            </div>
                            <span class="text-xs">${post.csns_likes.length}</span>
                        </button>
                    </div>

                    <!-- Comment Section -->
                    <div id="comments-${post.id}" class="hidden mt-3 bg-slate-900/50 rounded-xl border border-slate-800 overflow-hidden"></div>
                </div>
            </div>
        </div>
    `;
}

// Start the app
checkAuth();
