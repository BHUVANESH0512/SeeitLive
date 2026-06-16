// Fetch repository contents via Git Trees API

const MAX_REPO_SIZE = 30 * 1024 * 1024; // 30MB limit

/**
 * Parses a GitHub URL into owner and repo.
 */
export function parseGitHubUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      let repo = parts[1];
      if (repo.endsWith('.git')) {
        repo = repo.replace(/\.git$/, '');
      }
      return { owner: parts[0], repo };
    }
  } catch (e) {
    // invalid URL
  }
  return null;
}

/**
 * Gets authentication headers if VITE_GITHUB_TOKEN is provided.
 */
function getHeaders() {
  const token = import.meta.env.VITE_GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Fetches repository metadata.
 */
export async function fetchRepoMeta(owner, repo) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: getHeaders() });
  if (!res.ok) {
     if (res.status === 403 || res.status === 429) {
         throw new Error(`GitHub API rate limit hit! You have made over 60 requests in the last hour. Please add VITE_GITHUB_TOKEN to .env.`);
     }
     throw new Error(`Repo not found or private (Status: ${res.status})`);
  }
  const data = await res.json();
  
  if (data.size * 1024 > MAX_REPO_SIZE) {
    throw new Error(`Repo is too large to preview in-browser (>30MB).`);
  }
  
  return {
    name: data.name,
    full_name: data.full_name,
    description: data.description,
    stars: data.stargazers_count,
    language: data.language,
    updated_at: data.pushed_at || data.updated_at
  };
}

/**
 * Core function to fetch the full file tree.
 */
export async function fetchRepoTree(owner, repo) {
  // First, get the default branch if we don't have it
  const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: getHeaders() });
  if (!metaRes.ok) throw new Error('Repo not found');
  const meta = await metaRes.json();
  const branch = meta.default_branch || 'main';

  // Fetch the full tree recursively
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  const treeRes = await fetch(treeUrl, { headers: getHeaders() });
  
  if (!treeRes.ok) {
    if (treeRes.status === 403 || treeRes.status === 429) {
      throw new Error('GitHub API rate limit hit. Please try again later or add a VITE_GITHUB_TOKEN to .env.');
    }
    throw new Error('Failed to fetch repository tree.');
  }
  
  const treeData = await treeRes.json();
  if (treeData.truncated) {
    throw new Error('Repository is too large (tree truncated).');
  }

  // Filter out node_modules and hidden directories to save size
  const validFiles = treeData.tree.filter(item => {
    if (item.type !== 'blob') return false;
    const path = item.path;
    if (path.includes('node_modules/') || path.includes('.git/')) return false;
    // can add more exclusion rules if needed, e.g. ignoring large binary paths
    return true;
  });

  return { files: validFiles, branch };
}

/**
 * Fetches the base64 content of a specific blob via the GitHub API blob URL.
 */
export async function fetchFileContentBase64(blobUrl) {
  const res = await fetch(blobUrl, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch blob: ${res.status}`);
  const data = await res.json();
  return data.content; // This is base64 encoded by GitHub
}

/**
 * Base64 decodes back to string. Assumes utf-8.
 */
export function decodeBase64ToText(base64Str) {
  // Handle new lines that GitHub puts in base64
  const cleaned = base64Str.replace(/\n/g, '');
  // atob decodes to binary string, then we decode URI component for utf-8
  try {
    const binString = atob(cleaned);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
        bytes[i] = binString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.error("Decoding error:", e);
    return "";
  }
}

/**
 * Detects if a file is binary based on extension
 */
export function isBinaryFile(path) {
  const binaryExts = ['.png', '.jpg', '.jpeg', '.ico', '.svg', '.gif', '.webp', '.woff', '.woff2', '.ttf', '.eot', '.mp4', '.mp3'];
  const ext = path.slice((path.lastIndexOf('.') - 1 >>> 0) + 2).toLowerCase();
  return binaryExts.includes('.' + ext);
}

/**
 * Converts GitHub base64 to a data URI for binary files
 */
export function getDataUriForBinary(path, base64Str) {
  const ext = path.slice((path.lastIndexOf('.') - 1 >>> 0) + 2).toLowerCase();
  let mime = 'application/octet-stream';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) {
    mime = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    if (ext === 'ico') mime = 'image/x-icon';
  } else if (ext === 'svg') {
    mime = 'image/svg+xml';
  } else if (['woff', 'woff2', 'ttf', 'eot'].includes(ext)) {
    mime = `font/${ext}`;
  }
  const cleaned = base64Str.replace(/\n/g, '');
  return `data:${mime};base64,${cleaned}`;
}
