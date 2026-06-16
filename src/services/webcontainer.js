import { WebContainer } from '@webcontainer/api';

let webcontainerInstance = null;

/**
 * Normalizes a flat file map into a nested WebContainer FileSystemTree
 */
function buildFileSystemTree(filesMap) {
  const tree = {};
  
  for (const [path, fileObj] of Object.entries(filesMap)) {
    // WebContainers can only handle text or Uint8Array. 
    // We extracted text and binaries in the github service.
    const parts = path.split('/');
    let currentLevel = tree;
    
    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
            // It's a file
            if (fileObj.isBinary) {
                // Convert base64 dataURI back to Uint8Array for WebContainer
                let base64 = fileObj.dataUri.split(',')[1];
                let binaryStr = atob(base64);
                let bytes = new Uint8Array(binaryStr.length);
                for (let j = 0; j < binaryStr.length; j++) {
                    bytes[j] = binaryStr.charCodeAt(j);
                }
                currentLevel[part] = { file: { contents: bytes } };
            } else {
                currentLevel[part] = { file: { contents: fileObj.text } };
            }
        } else {
            // It's a directory
            if (!currentLevel[part]) {
                currentLevel[part] = { directory: {} };
            }
            currentLevel = currentLevel[part].directory;
        }
    }
  }
  
  return tree;
}

/**
 * Boots container, mounts files, runs install and build, and extracts /dist
 */
export async function buildWithWebContainers(filesMap, onLog) {
  if (!webcontainerInstance) {
    onLog({ type: 'info', msg: 'Booting WebContainer instance...' });
    webcontainerInstance = await WebContainer.boot();
  }

  const tree = buildFileSystemTree(filesMap);
  onLog({ type: 'info', msg: 'Mounting repository files...' });
  await webcontainerInstance.mount(tree);

  // npm install
  onLog({ type: 'info', msg: 'Running npm install (this may take a few minutes)... Check browser DevTools console for live logs.' });
  const installProcess = await webcontainerInstance.spawn('npm', ['install'], {
    env: { CI: 'true', NEXT_TELEMETRY_DISABLED: '1' }
  });
  
  installProcess.output.pipeTo(new WritableStream({
    write(data) {
      console.log(data);
    }
  }));
  
  const installExit = await installProcess.exit;
  if (installExit !== 0) {
    throw new Error('npm install failed');
  }
  onLog({ type: 'success', msg: 'Dependencies installed successfully.' });

  // Start dev server instead of build
  onLog({ type: 'info', msg: 'Starting Dev Server (Booting Next.js/Vite)... Check browser DevTools console for live logs.' });
  
  return new Promise(async (resolve, reject) => {
    // Attempt multiple common dev commands
    const startProcess = await webcontainerInstance.spawn('npm', ['run', 'dev'], {
       env: { CI: 'true', NEXT_TELEMETRY_DISABLED: '1' }
    });
    
    startProcess.output.pipeTo(new WritableStream({
      write(data) {
        console.log(data);
      }
    }));

    // Next.js can be tricky. We also mount a listener
    webcontainerInstance.on('server-ready', (port, url) => {
      onLog({ type: 'success', msg: `Server is ready at ${url}` });
      resolve({ previewUrl: url });
    });

    const buildExit = await startProcess.exit;
    // If it immediately failed, fallback to 'start' instead of dev if needed
    if (buildExit !== 0) {
      reject(new Error('Server crashed or failed to start.'));
    }
  });
}
