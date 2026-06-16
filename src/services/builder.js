// Service to handle static rendering and URL rewriting

export function detectStack(tree) {
  const packageJsonFile = tree.find(f => f.path.endsWith('package.json') && !f.path.includes('node_modules/'));
  const indexHtmlFile = tree.find(f => f.path.endsWith('index.html') && !f.path.includes('node_modules/'));
  
  if (packageJsonFile) {
    const parts = packageJsonFile.path.split('/');
    parts.pop();
    const workingDir = parts.length > 0 ? parts.join('/') + '/' : '';
    
    return {
      type: 'webcontainer',
      label: 'Node Build Required',
      runCommand: 'npm run build',
      installCommand: 'npm install',
      workingDir
    };
  } else if (indexHtmlFile) {
    const parts = indexHtmlFile.path.split('/');
    parts.pop();
    const workingDir = parts.length > 0 ? parts.join('/') + '/' : '';
    
    return {
      type: 'static',
      label: 'Static HTML',
      entryFile: 'index.html',
      workingDir
    };
  }
  
  return {
    type: 'unknown',
    label: 'Unsupported Stack',
    workingDir: ''
  };
}

/**
 * Normalizes a relative path against a base path
 */
function resolveRelativePath(basePath, relativePath) {
  if (relativePath.startsWith('/')) {
    return relativePath.substring(1);
  }
  if (!relativePath.startsWith('.')) {
    return relativePath; // Assume it's a sibling or sub-path directly if no ./
  }
  
  const baseParts = basePath.split('/');
  baseParts.pop(); // Remove the current file name to get directory
  
  const relParts = relativePath.split('/');
  
  for (const part of relParts) {
    if (part === '.') continue;
    if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  
  return baseParts.join('/');
}

/**
 * Builds a virtual file map (Blob URLs) from fetched files.
 * @param filesMap Record<path, {isBinary, text, dataUri}>
 */
export async function buildVirtualFileMap(filesMap, onLog) {
  onLog({ type: 'info', msg: 'Building virtual file map...' });
  const blobUrls = {};

  // First pass: generate Blob URLs for non-HTML/CSS and handle binaries
  for (const [path, file] of Object.entries(filesMap)) {
    if (file.isBinary) {
      blobUrls[path] = file.dataUri;
    } else if (!path.endsWith('.html') && !path.endsWith('.css')) {
      const blob = new Blob([file.text], { type: getMimeType(path) });
      blobUrls[path] = URL.createObjectURL(blob);
    }
  }

  // Second pass: Inline CSS @imports
  for (const [path, file] of Object.entries(filesMap)) {
    if (path.endsWith('.css')) {
      let cssText = file.text;
      
      // Inline @imports iteratively
      const importRegex = /@import\s+(?:url\()?['"]?(.*?)['"]?\)?;/g;
      cssText = cssText.replace(importRegex, (match, importPath) => {
        const resolvedPath = resolveRelativePath(path, importPath);
        if (filesMap[resolvedPath] && !filesMap[resolvedPath].isBinary) {
           return filesMap[resolvedPath].text; // Inline the text
        }
        return match; // fallback
      });
      
      // Update the text in map so it can be blobbed
      filesMap[path].text = cssText;
    }
  }

  // Third pass: Blob CSS files and rewrite url()s inside them
  for (const [path, file] of Object.entries(filesMap)) {
    if (path.endsWith('.css')) {
      let cssText = file.text;
      const urlRegex = /url\(['"]?(.*?)['"]?\)/g;
      cssText = cssText.replace(urlRegex, (match, urlPath) => {
        if (urlPath.startsWith('data:') || urlPath.startsWith('http')) return match;
        const resolvedPath = resolveRelativePath(path, urlPath);
        const targetUrl = blobUrls[resolvedPath] || filesMap[resolvedPath]?.dataUri;
        if (targetUrl) {
          return `url("${targetUrl}")`;
        }
        return match;
      });
      
      const blob = new Blob([cssText], { type: 'text/css' });
      blobUrls[path] = URL.createObjectURL(blob);
    }
  }

  // Fourth pass: Rewrite HTML dependencies natively
  let entryHtmlUrl = null;
  for (const [path, file] of Object.entries(filesMap)) {
    if (path.endsWith('.html')) {
        let htmlText = file.text;

        // Replace src="", href=""
        const attrRegex = /(src|href)=['"](.*?)['"]/g;
        htmlText = htmlText.replace(attrRegex, (match, attrName, attrValue) => {
           if (attrValue.startsWith('http') || attrValue.startsWith('data:') || attrValue.startsWith('#')) return match;
           const resolvedPath = resolveRelativePath(path, attrValue);
           const targetUrl = blobUrls[resolvedPath];
           if (targetUrl) {
             return `${attrName}="${targetUrl}"`;
           }
           return match;
        });

        // Some frameworks use <script type="module" src="...">
        const blob = new Blob([htmlText], { type: 'text/html' });
        blobUrls[path] = URL.createObjectURL(blob);
        
        // Pick entry point
        if (path === 'index.html' || path.endsWith('/index.html')) {
          entryHtmlUrl = blobUrls[path];
        }
    }
  }

  onLog({ type: 'success', msg: 'Virtual file map created successfully.' });
  return { blobUrls, entryUrl: entryHtmlUrl || Object.values(blobUrls).find(url => url.startsWith('blob:')) };
}

function getMimeType(path) {
  if (path.endsWith('.js')) return 'text/javascript';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.xml')) return 'application/xml';
  return 'text/plain';
}

export function cleanupVirtualMap(blobUrls) {
  for (const url of Object.values(blobUrls)) {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}
