// INITIALIZE SUPABASE
const SUPABASE_URL = 'https://tvxugmumfvgnvjacwwfz.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2eHVnbXVtZnZnbnZqYWN3d2Z6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NjQ1MzEsImV4cCI6MjA5NjM0MDUzMX0.76wR9dblt8W9u-OioqQH7NOethNq1BMfjTDl9xcpYYI'; 
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = document.getElementById('app');

// State
let currentUser = null;
let currentView = 'feed'; // 'feed' or 'profile'

// ==========================================
// AUTH & ROUTING
// ==========================================

async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        const { data } = await supabase.from('csns_profiles').select('*').eq('id', session.user.id).single();
        currentUser = data;
    }
    renderApp();
}

async function loginWithGithub() {
    await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.href }
    });
}

async function logout() {
    await supabase.auth.signOut();
    currentUser = null;
    renderApp();
}

supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN') checkAuth();
    if (event === 'SIGNED_OUT') checkAuth();
});

// ==========================================
// DATA FETCHING
// ==========================================

async function fetchPosts(profileId = null) {
    let query = supabase.from('csns_posts').select(`
        *,
        csns_profiles:user_id (*),
        csns_post_repos (*),
        csns_likes (user_id)
    `).order('created_at', { ascending: false });

    if (profileId) query = query.eq('user_id', profileId);

    const { data } = await query;
    return data || [];
}

// ==========================================
// ACTIONS (Post, Like, Follow)
// ==========================================

async function handlePost() {
    const content = document.getElementById('post-content').value;
    const repoUrl = document.getElementById('repo-url').value;
    if (!content.trim()) return;

    const { data: newPost, error } = await supabase.from('csns_posts').insert({
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
                await supabase.from('csns_post_repos').insert({
                    post_id: newPost.id,
                    platform,
                    owner: parts[0],
                    repo_name: parts[1],
                    repo_url: repoUrl
                });
            }
        } catch(e) { /* Invalid URL, ignore */ }
    }

    document.getElementById('post-content').value = '';
    document.getElementById('repo-url').value = '';
    renderApp();
}

async function handleLike(postId, isLiked) {
    if (!currentUser) return alert('Please login to like posts.');
    if (isLiked) {
        await supabase.from('csns_likes').delete().match({ post_id: postId, user_id: currentUser.id });
    } else {
        await supabase.from('csns_likes').insert({ post_id: postId, user_id: currentUser.id });
    }
    renderApp();
}

async function handleFollow(targetId, isFollowing) {
    if (!currentUser) return;
    if (isFollowing) {
        await supabase.from('csns_follows').delete().match({ follower_id: currentUser.id, following_id: targetId });
    } else {
        await supabase.from('csns_follows').insert({ follower_id: currentUser.id, following_id: targetId });
    }
    renderApp();
}

// ==========================================
// UI RENDERING
// ==========================================

async function renderApp() {
    if (currentView.startsWith('profile_')) {
        const profileId = currentView.split('_')[1];
        await renderProfile(profileId);
    } else {
        await renderFeed();
    }
}

async function renderFeed() {
    const posts = await fetchPosts();
    
    app.innerHTML = `
        <header class="sticky top-0 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 p-4 z-10 flex justify-between items-center">
            <h1 class="text-2xl font-black text-cyan-400 tracking-tight">CodeSNS</h1>
            ${currentUser ? `
                <div class="flex items-center gap-3">
                    <span class="text-sm text-slate-400 font-mono">@${currentUser.username}</span>
                    <button onclick="logout()" class="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-md transition">Logout</button>
                </div>
            ` : `
                <button onclick="loginWithGithub()" class="bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold px-4 py-2 rounded-md flex items-center gap-2 transition">
                    <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                    Sign in
                </button>
            `}
        </header>

        ${currentUser ? `
            <div class="border-b border-slate-800 p-4 space-y-3">
                <textarea id="post-content" placeholder="What are you building?" class="w-full bg-transparent text-slate-200 placeholder-slate-500 focus:outline-none resize-none text-lg" rows="3"></textarea>
                <input id="repo-url" type="text" placeholder="Link GitHub/GitLab repo (optional)" class="w-full bg-slate-900 text-sm text-slate-300 placeholder-slate-600 rounded-md p-2 border border-slate-800 focus:border-cyan-500 focus:outline-none font-mono">
                <div class="flex justify-end">
                    <button onclick="handlePost()" class="bg-cyan-500 hover:bg-cyan-600 text-white font-semibold px-5 py-2 rounded-full flex items-center gap-2 transition">Post</button>
                </div>
            </div>
        ` : `
            <div class="p-8 text-center border-b border-slate-800">
                <p class="text-slate-400">Sign in with GitHub to join the conversation.</p>
            </div>
        `}

        <div id="feed" class="divide-y divide-slate-800">
            ${posts.map(post => renderPostCard(post)).join('') || '<p class="p-8 text-center text-slate-500">No posts yet. Be the first to share your code!</p>'}
        </div>
    `;
}

async function renderProfile(profileId) {
    const { data: profile } = await supabase.from('csns_profiles').select('*').eq('id', profileId).single();
    const posts = await fetchPosts(profileId);
    
    // Check if current user is following
    let isFollowing = false;
    if (currentUser) {
        const { data } = await supabase.from('csns_follows').select('*').match({ follower_id: currentUser.id, following_id: profileId });
        isFollowing = data.length > 0;
    }

    app.innerHTML = `
        <header class="sticky top-0 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 p-4 z-10 flex items-center gap-4">
            <button onclick="currentView='feed'; renderApp()" class="text-slate-400 hover:text-white">← Back</button>
            <h1 class="text-xl font-bold text-slate-100">Profile</h1>
        </header>

        <div class="p-6 border-b border-slate-800 bg-slate-900/50">
            <div class="flex items-start justify-between">
                <div>
                    <h2 class="text-2xl font-bold text-slate-100">${profile.full_name || profile.username}</h2>
                    <p class="text-slate-400 font-mono">@${profile.username}</p>
                </div>
                ${currentUser && currentUser.id !== profileId ? `
                    <button onclick="handleFollow('${profileId}', ${isFollowing})" class="${isFollowing ? 'bg-slate-800 text-slate-300' : 'bg-cyan-500 text-white'} px-4 py-2 rounded-md text-sm font-semibold transition">
                        ${isFollowing ? 'Following' : 'Follow'}
                    </button>
                ` : ''}
            </div>
            ${profile.bio ? `<p class="mt-4 text-slate-300">${profile.bio}</p>` : ''}
        </div>

        <div id="feed" class="divide-y divide-slate-800">
            ${posts.map(post => renderPostCard(post)).join('') || '<p class="p-8 text-center text-slate-500">This user hasn\'t posted yet.</p>'}
        </div>
    `;
}

function renderPostCard(post) {
    const isLiked = currentUser ? post.csns_likes.some(l => l.user_id === currentUser.id) : false;
    const timeAgo = new Date(post.created_at).toLocaleDateString();

    return `
        <div class="p-4 hover:bg-slate-900/50 transition-colors">
            <div class="flex space-x-3">
                <div onclick="currentView='profile_${post.user_id}'; renderApp()" class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold text-slate-300 shrink-0 cursor-pointer hover:ring-2 ring-cyan-500">
                    ${post.csns_profiles?.username[0].toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center space-x-2 cursor-pointer" onclick="currentView='profile_${post.user_id}'; renderApp()">
                        <span class="font-bold text-slate-100 truncate hover:underline">${post.csns_profiles?.full_name || post.csns_profiles?.username}</span>
                        <span class="text-slate-500 text-sm">@${post.csns_profiles?.username}</span>
                        <span class="text-slate-600 text-xs">•</span>
                        <span class="text-slate-500 text-sm">${timeAgo}</span>
                    </div>
                    
                    <p class="mt-1 text-slate-300 whitespace-pre-wrap break-words">${post.content}</p>

                    ${post.csns_post_repos && post.csns_post_repos.length > 0 ? `
                        <div class="mt-3 border border-slate-800 rounded-lg overflow-hidden bg-slate-900/70">
                            ${post.csns_post_repos.map(repo => `
                                <div class="p-4">
                                    <a href="${repo.repo_url}" target="_blank" class="flex items-center space-x-2 text-cyan-400 font-mono text-sm hover:underline">
                                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                                        <span class="font-semibold">${repo.owner}</span>
                                        <span class="text-slate-600">/</span>
                                        <span class="font-semibold text-slate-200">${repo.repo_name}</span>
                                    </a>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}

                    <div class="flex items-center space-x-6 mt-3 text-slate-500">
                        <button onclick="handleLike('${post.id}', ${isLiked})" class="flex items-center space-x-1 hover:text-rose-500 transition-colors ${isLiked ? 'text-rose-500' : ''}">
                            <svg class="w-4 h-4" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
                            <span class="text-xs">${post.csns_likes.length}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Start the app
checkAuth();
