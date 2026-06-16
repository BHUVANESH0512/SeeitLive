import { useState, useRef, useEffect } from 'react';
import { Play, RefreshCw, ExternalLink, Menu, FileCode2, History } from 'lucide-react';
import { parseGitHubUrl, fetchRepoMeta, fetchRepoTree, fetchFileContentBase64, isBinaryFile, getDataUriForBinary, decodeBase64ToText } from './services/github';
import { detectStack, buildVirtualFileMap } from './services/builder.js';
import { buildWithWebContainers } from './services/webcontainer';
import { marked } from 'marked';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';

// Configure marked
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  }
});

function App() {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [meta, setMeta] = useState(null);
  const [stack, setStack] = useState(null);
  const [logs, setLogs] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [readmeHtml, setReadmeHtml] = useState('');
  const [activeTab, setActiveTab] = useState('preview');
  const [history, setHistory] = useState([]);

  const logsEndRef = useRef(null);

  useEffect(() => {
    // Load history
    const saved = localStorage.getItem('repoHistory');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  useEffect(() => {
    // scroll logs to bottom
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (type, msg) => {
    setLogs(prev => [...prev, { type, msg }]);
  };

  const handleRun = async (fetchUrl = url) => {
    setUrlError('');
    const parsed = parseGitHubUrl(fetchUrl);
    if (!parsed) {
      setUrlError('Enter a valid GitHub repo URL');
      return;
    }

    // Save to history
    const newHistory = [{ url: fetchUrl, name: `${parsed.owner}/${parsed.repo}`, date: Date.now() }, ...history.filter(h => h.url !== fetchUrl)].slice(0, 5);
    setHistory(newHistory);
    localStorage.setItem('repoHistory', JSON.stringify(newHistory));

    setIsLoading(true);
    setLogs([]);
    setMeta(null);
    setStack(null);
    setPreviewUrl(null);
    setReadmeHtml('');
    setActiveTab('preview');

    try {
      addLog('info', `Fetching metadata for ${parsed.owner}/${parsed.repo}...`);
      const repoMeta = await fetchRepoMeta(parsed.owner, parsed.repo);
      setMeta(repoMeta);

      addLog('info', 'Fetching repository tree...');
      const { files, branch } = await fetchRepoTree(parsed.owner, parsed.repo);
      
      const fileCount = files.length;
      addLog('log', `Found ${fileCount} files in tree.`);

      // Stack Detection
      const stackInfo = detectStack(files);
      setStack(stackInfo);
      addLog('success', `Detected Stack: ${stackInfo.label}`);

      if (stackInfo.type === 'unknown') {
         addLog('error', 'Unsupported stack. Cannot build or render.');
         // Try to find readme
         await loadReadme(files, parsed);
         setIsLoading(false);
         setActiveTab('readme');
         return;
      }

      // Fetch all blobs in parallel
      addLog('info', `Fetching ${fileCount} file contents from GitHub...`);
      const filesMap = {};
      
      // Batch fetching to avoid overwhelming browser
      const batchSize = 10;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        await Promise.all(batch.map(async file => {
           try {
              const base64 = await fetchFileContentBase64(file.url);
              const isBinary = isBinaryFile(file.path);
              if (isBinary) {
                filesMap[file.path] = { isBinary: true, dataUri: getDataUriForBinary(file.path, base64) };
              } else {
                filesMap[file.path] = { isBinary: false, text: decodeBase64ToText(base64) };
              }
              // Add to readme if is readme
              if (file.path.toLowerCase() === 'readme.md') {
                 setReadmeHtml(marked.parse(filesMap[file.path].text));
              }
           } catch(e) {
              addLog('error', `Failed to fetch ${file.path}`);
           }
        }));
      }

      let renderMap = filesMap;
      if (stackInfo.workingDir) {
         renderMap = {};
         for (const [path, file] of Object.entries(filesMap)) {
            if (path.startsWith(stackInfo.workingDir)) {
               renderMap[path.substring(stackInfo.workingDir.length)] = file;
            }
         }
      }

      if (stackInfo.type === 'webcontainer') {
         const { previewUrl: devUrl } = await buildWithWebContainers(renderMap, (logInfo) => addLog(logInfo.type, logInfo.msg));
         setPreviewUrl(devUrl);
         addLog('success', `Dev Server is ready! Loading preview...`);
      } else {
         // Static handling
         const { blobUrls, entryUrl } = await buildVirtualFileMap(renderMap, (logInfo) => addLog(logInfo.type, logInfo.msg));
         if (entryUrl) {
           setPreviewUrl(entryUrl);
           addLog('success', `Static Preview ready! Loading ${entryUrl}`);
         } else {
           addLog('error', 'No index.html found after processing static files.');
         }
      }

    } catch (err) {
      addLog('error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadReadme = async (files, parsed) => {
      const readmeNode = files.find(f => f.path.toLowerCase() === 'readme.md');
      if (readmeNode) {
          try {
             const base64 = await fetchFileContentBase64(readmeNode.url);
             setReadmeHtml(marked.parse(decodeBase64ToText(base64)));
          } catch(e) {}
      }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleRun();
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0a0a0a] text-[#f3f4f6]">
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-[#222]">
        <div className="font-mono text-xl font-bold tracking-tight">RepoPreview</div>
        <div className="text-[#9ca3af] text-sm">Paste a repo. See it live.</div>
      </header>

      {/* Main Bar */}
      <div className="px-6 py-4 bg-[#111] border-b border-[#222]">
        <div className="max-w-4xl mx-auto relative">
          <div className="flex gap-3">
             <input 
               type="text" 
               className={`flex-1 bg-[#1a1a1a] border ${urlError ? 'border-red-500' : 'border-[#333]'} rounded px-4 py-2 font-mono text-sm focus:outline-none focus:border-[#3b82f6]`}
               placeholder="https://github.com/username/repository"
               value={url}
               onChange={(e) => { setUrl(e.target.value); setUrlError(''); }}
               onKeyDown={handleKeyDown}
             />
             <button 
               onClick={() => handleRun()} 
               disabled={isLoading}
               className="bg-[#3b82f6] hover:bg-[#2563eb] text-white px-6 py-2 rounded font-medium flex items-center gap-2 disabled:opacity-50"
             >
               {isLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
               Run
             </button>
          </div>
          {urlError && <div className="text-red-500 text-xs mt-2">{urlError}</div>}
          {stack && (
            <div className="flex items-center gap-2 mt-3">
               <span className="text-xs text-[#9ca3af]">Detected Stack:</span>
               <span className={`text-xs px-2 py-0.5 rounded ${stack.type === 'static' ? 'bg-orange-500/20 text-orange-400' : stack.type === 'webcontainer' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                 {stack.label}
               </span>
            </div>
          )}
        </div>
      </div>

      {/* Workspace */}
      <div className="flex-1 flex overflow-hidden">
         {/* Left Panel */}
         <div className="w-[35%] min-w-[300px] border-r border-[#222] flex flex-col bg-[#111]">
            {meta && (
              <div className="p-4 border-b border-[#222]">
                <h2 className="text-lg font-bold truncate">{meta.full_name}</h2>
                <p className="text-sm text-[#9ca3af] mt-1 mb-3 line-clamp-2">{meta.description}</p>
                <div className="flex gap-4 text-xs text-[#9ca3af]">
                  <span>⭐ {meta.stars}</span>
                  <span>{meta.language}</span>
                  <span>Updated: {new Date(meta.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
            )}
            
            {/* Terminal */}
            <div className="flex-1 bg-[#0d0d0d] p-4 overflow-y-auto font-mono text-xs whitespace-pre-wrap flex flex-col gap-1.5">
               {logs.map((log, i) => (
                  <div key={i} className="flex">
                    <span className="w-8 shrink-0">
                      {log.type === 'info' && <span className="text-yellow-500">[INFO]</span>}
                      {log.type === 'success' && <span className="text-green-500">[OK]</span>}
                      {log.type === 'error' && <span className="text-red-500">[ERR]</span>}
                      {log.type === 'log' && <span className="text-gray-500">[LOG]</span>}
                    </span>
                    <span className={`${log.type === 'error' ? 'text-red-400' : log.type === 'log' ? 'text-gray-400' : 'text-gray-200'} ml-2`}>
                      {log.msg}
                    </span>
                  </div>
               ))}
               <div ref={logsEndRef} />
            </div>
         </div>

         {/* Right Panel */}
         <div className="flex-1 flex flex-col bg-white">
            <div className="bg-[#1a1a1a] border-b border-[#333] flex justify-between items-center px-4 h-[40px]">
               <div className="flex gap-1">
                 <button className={`px-3 py-1 text-sm rounded-t ${activeTab === 'preview' ? 'bg-[#333] text-white' : 'text-[#9ca3af] hover:text-white'}`} onClick={() => setActiveTab('preview')}>Live Preview</button>
                 <button className={`px-3 py-1 text-sm rounded-t ${activeTab === 'readme' ? 'bg-[#333] text-white' : 'text-[#9ca3af] hover:text-white'}`} onClick={() => setActiveTab('readme')}>README.md</button>
               </div>
               {previewUrl && (
                 <div className="flex gap-3">
                   <button onClick={() => { /* no-op for blob reload */ }} className="text-[#9ca3af] hover:text-white" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
                   <a href={previewUrl} target="_blank" rel="noreferrer" className="text-[#9ca3af] hover:text-white" title="Open in new tab"><ExternalLink className="w-4 h-4" /></a>
                 </div>
               )}
            </div>

            <div className="flex-1 relative bg-white">
               {activeTab === 'preview' && (
                  previewUrl ? (
                    <iframe 
                      src={previewUrl} 
                      className="w-full h-full border-none bg-white"
                      sandbox="allow-scripts allow-forms allow-same-origin"
                      title="Preview"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[#0a0a0a]">
                      {isLoading ? (
                        <div className="text-center">
                          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-[#3b82f6] mb-4" />
                          <div className="text-[#9ca3af] font-mono animate-pulse">Building Preview...</div>
                        </div>
                      ) : (
                        <div className="text-[#333] flex flex-col items-center">
                          <FileCode2 className="w-16 h-16 mb-4" />
                          <div>No preview loaded</div>
                        </div>
                      )}
                    </div>
                  )
               )}

               {activeTab === 'readme' && (
                  <div className="w-full h-full bg-[#161b22] text-[#c9d1d9] p-8 overflow-y-auto w-full">
                     <div 
                        className="markdown-body max-w-3xl mx-auto" 
                        dangerouslySetInnerHTML={{ __html: readmeHtml || '<i>No README found</i>' }} 
                     />
                  </div>
               )}
            </div>
         </div>
      </div>
    </div>
  );
}

export default App;
