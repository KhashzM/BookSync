// background.js (完整替换)

// ================== Offscreen Document Globals ==================
let creating; 
let offscreenPromiseResolver = null;

// ================== Offscreen Document Helpers ==================
async function setupOffscreenDocument(path) {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['DOM_PARSER'],
      justification: 'To parse WebDAV XML responses'
    });
    await creating;
    creating = null;
  }
}

async function parseXmlWithOffscreen(xmlString, log) {
  log.push('  - [Offscreen] 准备启动幕后文档进行解析...');
  await setupOffscreenDocument('offscreen.html');
  
  return new Promise((resolve, reject) => {
    offscreenPromiseResolver = { resolve, reject };
    log.push('  - [Offscreen] 发送XML到幕后文档.');
    chrome.runtime.sendMessage({
      action: 'parseXmlForOffscreen',
      xmlString: xmlString
    });
  });
}

// ================== Core Logic ==================

// 防抖计时器
let debounceTimer;
const DEBOUNCE_TIME = 3000;

// 书签事件监听
chrome.bookmarks.onCreated.addListener(handleBookmarkChange);
chrome.bookmarks.onRemoved.addListener(handleBookmarkChange);
chrome.bookmarks.onChanged.addListener(handleBookmarkChange);
chrome.bookmarks.onMoved.addListener(handleBookmarkChange);
chrome.bookmarks.onChildrenReordered.addListener(handleBookmarkChange);

// 浏览器启动/安装时检查更新
chrome.runtime.onStartup.addListener(checkWebDAVUpdates);
chrome.runtime.onInstalled.addListener(checkWebDAVUpdates);

function handleBookmarkChange() {
  chrome.storage.local.get(['autoBackupEnabled'], (result) => {
    if (result.autoBackupEnabled !== false) {
      clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => backupBookmarks(), DEBOUNCE_TIME);
    }
  });
}

function backupBookmarks(method, webdavConfig) {
    chrome.storage.local.get(['backupMethod', 'webdavConfig'], (result) => {
        const finalMethod = method || result.backupMethod || 'local';
        const finalConfig = webdavConfig || result.webdavConfig;

  chrome.bookmarks.getTree((bookmarkTree) => {
    const htmlContent = generateBookmarkHTML(bookmarkTree);
    const dateStr = getCurrentDateTime();
    const filename = `bookmarks-${dateStr}.html`;
    const blob = new Blob([htmlContent], { type: 'text/html' });

            if (finalMethod === 'local') {
                saveBlobAsLocalFile(blob, filename, finalMethod);
            } else if (finalMethod === 'webdav' && finalConfig) {
                uploadToWebDAV(blob, filename, finalConfig, finalMethod);
            }
        });
    });
}

function saveBlobAsLocalFile(blob, filename, method) {
    const reader = new FileReader();
    reader.onloadend = () => {
        chrome.downloads.download({
            url: reader.result,
          filename: filename,
          saveAs: false
        }, () => handlePostBackup(filename, method));
    };
    reader.readAsDataURL(blob);
}

function uploadToWebDAV(blob, filename, config, method) {
    const fullPath = config.url.replace(/\/+$/, '') + config.path.replace('{filename}', filename);
      blob.arrayBuffer().then(buffer => {
        fetch(fullPath, {
          method: 'PUT',
          headers: {
                'Authorization': 'Basic ' + btoa(config.username + ':' + config.password),
            'Content-Type': 'text/html'
          },
          body: buffer
        }).then(res => {
          if (res.ok || res.status === 201 || res.status === 204) {
            handlePostBackup(filename, method);
          } else {
                sendPopupMessage({ action: 'webdavUploadFailed', error: `上传失败，状态码 ${res.status}` });
          }
        }).catch(err => {
            sendPopupMessage({ action: 'webdavUploadFailed', error: err.message });
        });
  });
}

function handlePostBackup(filename, method) {
  const now = new Date();
  addToHistory(filename, now.toISOString());
  chrome.storage.local.set({ lastBackupFilename: filename });

    sendPopupMessage({
    action: "backupComplete",
    filename: filename,
        dateString: now.toLocaleDateString(),
        timeString: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    method: method
  });

  chrome.storage.local.get(['showNotifications'], (result) => {
    if (result.showNotifications !== false) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '书签已备份',
        message: `文件：${filename}`
      });
    }
  });
}

// 从HTML数据创建书签
async function importBookmarksFromHTML(bookmarksData, isAutoImport = false) {
  try {
    console.log('开始创建书签，数据:', bookmarksData);
    
    // 递归创建书签和文件夹
    await createBookmarksRecursively(bookmarksData, '1');
    
    console.log('书签创建完成');
    
    // 只有在手动导入时才通知popup
    if (!isAutoImport) {
      chrome.runtime.sendMessage({
        action: 'importResult',
        success: true,
        message: '书签导入成功！'
      });
    }
    
  } catch (error) {
    console.error('创建书签时出错:', error);
    if (!isAutoImport) {
      chrome.runtime.sendMessage({
        action: 'importResult',
        success: false,
        error: error.message
      });
    }
  }
}

// 递归创建书签和文件夹
async function createBookmarksRecursively(items, parentId) {
  console.log('开始递归创建，父ID:', parentId, '项目数量:', items.length);
  
  for (const item of items) {
    console.log('处理项目:', item);
    
    if (item.type === 'folder') {
      // 创建文件夹
      console.log('创建文件夹:', item.title);
      const folder = await chrome.bookmarks.create({
        parentId: parentId,
        title: item.title
      });
      console.log('文件夹创建成功，ID:', folder.id);
      
      // 递归创建子项目
      if (item.children && item.children.length > 0) {
        console.log('递归创建子项目，数量:', item.children.length);
        await createBookmarksRecursively(item.children, folder.id);
      }
    } else if (item.type === 'bookmark') {
      // 创建书签
      console.log('创建书签:', item.title, item.url);
      await chrome.bookmarks.create({
        parentId: parentId,
        title: item.title,
        url: item.url
      });
      console.log('书签创建成功');
    }
  }
  
  console.log('递归创建完成');
}

// ================== Message Listeners ==================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'offscreenParseResult') {
        if (request.success) {
          console.log('收到解析结果:', request.results);
          
          // 检查结果类型
          if (Array.isArray(request.results) && request.results.length > 0) {
            // 如果是href数组（XML解析结果），需要进一步处理
            if (typeof request.results[0] === 'string' && request.results[0].includes('/')) {
              // 这是XML解析的href数组，需要传递给parseXmlWithOffscreen的resolve
              if (offscreenPromiseResolver) {
                offscreenPromiseResolver.resolve(request.results);
                offscreenPromiseResolver = null;
              }
            } else {
              // 这是HTML解析的书签数据，开始创建书签
              // 检查是否是自动导入（通过检查是否有lastBackupFilename更新）
              const isAutoImport = !offscreenPromiseResolver;
              importBookmarksFromHTML(request.results, isAutoImport);
            }
          } else {
            // 空结果，传递给parseXmlWithOffscreen的resolve
            if (offscreenPromiseResolver) {
              offscreenPromiseResolver.resolve(request.results);
              offscreenPromiseResolver = null;
            }
          }
        } else {
          console.error('解析失败:', request.error);
          // 通知popup解析失败
          chrome.runtime.sendMessage({
            action: 'importResult',
            success: false,
            error: request.error
          });
          // 如果有等待的Promise，也要reject
          if (offscreenPromiseResolver) {
            offscreenPromiseResolver.reject(new Error(request.error));
            offscreenPromiseResolver = null;
          }
        }
    } else {
        const actions = {
            "manualBackup": () => backupBookmarks(request.method, request.webdavConfig),
            "testWebdav": () => testWebdav(request.config, sendResponse),
            "getWebDAVFileList": async () => {
                try {
                    const fileList = await getWebDAVFileListForPopup(request.config);
                    sendResponse({ fileList });
                } catch (error) {
                    console.error("获取WebDAV文件列表失败:", error);
                    sendResponse({ fileList: [] });
                }
            },
            "loadWebDAVFile": async () => {
                try {
                    const result = await loadWebDAVFileForPopup(request.config, request.filename);
                    sendResponse(result);
                } catch (error) {
                    console.error("加载WebDAV文件失败:", error);
                    sendResponse({ success: false, error: error.message });
                }
            },
            "importBookmarks": async () => {
                try {
                    console.log('开始导入书签，HTML内容长度:', request.htmlContent.length);
                    
                    // 先清空现有书签
                    const existingBookmarks = await chrome.bookmarks.getTree();
                    const bookmarkBar = existingBookmarks[0].children[0];
                    const otherBookmarks = existingBookmarks[0].children.find(n => n.id !== bookmarkBar.id);

                    console.log('清空现有书签...');
                    for (const child of bookmarkBar.children) await chrome.bookmarks.removeTree(child.id);
                    if (otherBookmarks) {
                        for (const child of otherBookmarks.children) await chrome.bookmarks.removeTree(child.id);
                    }

                    // 使用幕后文档解析HTML
                    console.log('设置幕后文档...');
                    await setupOffscreenDocument('offscreen.html');
                    
                    console.log('发送解析请求到幕后文档...');
                    chrome.runtime.sendMessage({
                        action: 'parseHtmlForOffscreen',
                        htmlString: request.htmlContent
                    });
                    
                } catch (error) {
                    console.error('导入书签失败:', error);
                    chrome.runtime.sendMessage({
                        action: 'importResult',
                        success: false,
                        error: error.message
                    });
                }
            },
            "getBookmarks": () => getBookmarks(),
            "deleteBookmarks": () => deleteBookmarks(),
            "exportBookmarks": () => exportBookmarks(request.format),
            "getWebDAVConfig": () => getWebDAVConfig(),
            "saveWebDAVConfig": () => saveWebDAVConfig(request.config),
            "testWebDAVConnection": () => testWebDAVConnection(request.config)
        };

        if (actions[request.action]) {
            actions[request.action]();
            return true; // Keep channel open for async response
        }
    }
});


async function testWebdav(config, sendResponse) {
    try {
        const res = await fetch(config.url, { method: 'PROPFIND', headers: { Authorization: 'Basic ' + btoa(config.username + ':' + config.password) } });
        if (res.ok || res.status === 207) {
            sendPopupMessage({ action: "webdavTestResult", success: true });
        } else {
            sendPopupMessage({ action: "webdavTestResult", success: false, error: `状态码 ${res.status}` });
        }
    } catch (err) {
        sendPopupMessage({ action: "webdavTestResult", success: false, error: err.message });
    }
}

async function getWebDAVFileListForPopup(webdavConfig, log = []) {
    try {
        log.push('1. 开始获取文件列表...');
        const { url, path, username, password } = webdavConfig;
        const webdavUrl = url.replace(/\/+$/, '');
        const webdavPath = path ? path.replace('{filename}', '') : '';
        const fullUrl = webdavUrl + webdavPath;
        log.push(`2. 构建请求URL: ${fullUrl}`);

        const res = await fetch(fullUrl, {
            method: 'PROPFIND',
            headers: { 'Authorization': 'Basic ' + btoa(username + ':' + password), 'Content-Type': 'application/xml', 'Depth': '1' },
            body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname /></d:prop></d:propfind>`
        });
        log.push(`3. PROPFIND 响应状态: ${res.status}`);
        if (!res.ok) throw new Error(`HTTP状态 ${res.status}`);

        const text = await res.text();
        log.push(`4. 收到XML，长度: ${text.length}.`);

        const hrefs = await parseXmlWithOffscreen(text, log);
        log.push(`5. 从幕后文档收到 ${hrefs.length} 个href.`);

        const files = [];
        for (const href of hrefs) {
            const decodedHref = decodeURIComponent(href);
            const filename = decodedHref.split('/').pop();
            log.push(`   - 正在处理 href: ${decodedHref}, 提取文件名: ${filename}`);

            if (filename && filename.startsWith('bookmarks-') && filename.endsWith('.html')) {
                const fullPath = new URL(decodedHref, fullUrl).pathname;
                files.push({ name: filename, path: fullPath });
                log.push(`   ✅ 成功添加文件: ${filename}, 路径: ${fullPath}`);
            } else {
                log.push(`   - 跳过非书签文件或目录.`);
            }
        }
        log.push(`6. 处理完毕，共找到 ${files.length} 个书签文件.`);
        return files.sort((a, b) => b.name.localeCompare(a.name));
    } catch (error) {
        log.push(`❌ 错误: ${error.message}`);
        console.error("获取WebDAV文件列表失败:", error);
        return [];
    }
}

async function loadWebDAVFileForPopup(webdavConfig, fileInfo) {
    try {
        const { name: filename, path: filePath } = fileInfo;
        const serverOrigin = new URL(webdavConfig.url).origin;
        const fullPath = serverOrigin + filePath;

        const res = await fetch(fullPath, {
            method: 'GET',
            headers: { 'Authorization': 'Basic ' + btoa(webdavConfig.username + ':' + webdavConfig.password) }
        });

        if (!res.ok) throw new Error(`下载失败: ${res.status}`);
        const htmlContent = await res.text();
        
        // 返回HTML内容，让popup处理导入
        return { success: true, content: htmlContent, message: `成功加载文件: ${filename}` };
    } catch (error) {
        console.error("加载WebDAV文件失败:", error);
        return { success: false, error: error.message };
    }
}

// ================== Utility Functions ==================

function sendPopupMessage(message) {
    chrome.runtime.sendMessage(message).catch(e => { /* Ignore error if popup is not open */ });
}

// 获取书签
function getBookmarks() {
    chrome.bookmarks.getTree((bookmarkTree) => {
        sendPopupMessage({
            action: "bookmarksData",
            data: bookmarkTree
        });
    });
}

// 删除书签
function deleteBookmarks() {
    chrome.bookmarks.getTree((bookmarkTree) => {
        const deleteRecursively = (nodes) => {
            for (const node of nodes) {
                if (node.children) {
                    deleteRecursively(node.children);
                } else {
                    chrome.bookmarks.remove(node.id);
                }
            }
        };
        
        if (bookmarkTree.length > 0 && bookmarkTree[0].children) {
            deleteRecursively(bookmarkTree[0].children);
        }
        
        sendPopupMessage({
            action: "deleteComplete",
            message: "书签删除完成"
        });
    });
}

// 导出书签
function exportBookmarks(format) {
    chrome.bookmarks.getTree((bookmarkTree) => {
        if (format === 'html') {
            const html = generateBookmarkHTML(bookmarkTree);
            const blob = new Blob([html], { type: 'text/html' });
            const filename = `bookmarks-${getCurrentDateTime()}.html`;
            saveBlobAsLocalFile(blob, filename, 'download');
        }
    });
}

// 获取WebDAV配置
function getWebDAVConfig() {
    chrome.storage.local.get('webdavConfig', (result) => {
        sendPopupMessage({
            action: "webdavConfig",
            config: result.webdavConfig || {}
        });
    });
}

// 保存WebDAV配置
function saveWebDAVConfig(config) {
    chrome.storage.local.set({ webdavConfig: config }, () => {
        sendPopupMessage({
            action: "webdavConfigSaved",
            message: "WebDAV配置已保存"
        });
    });
}

// 测试WebDAV连接
function testWebDAVConnection(config) {
    testWebdav(config, (result) => {
        sendPopupMessage({
            action: "webdavTestResult",
            success: result.success,
            error: result.error
        });
    });
}

function getCurrentDateTime() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}`;
}

function addToHistory(filename, date) {
  chrome.storage.local.get({ history: [] }, (result) => {
    let history = result.history;
    history.unshift({ filename, date });
    if (history.length > 20) history.pop();
    chrome.storage.local.set({ history });
  });
}

function generateBookmarkHTML(bookmarkTree) {
  const traverse = (nodes) => {
    let html = '';
    for (const node of nodes) {
      if (node.children) { // It's a folder
        html += `<DT><H3 ADD_DATE="${Math.floor((node.dateAdded || Date.now()) / 1000)}" LAST_MODIFIED="${Math.floor((node.dateGroupModified || Date.now()) / 1000)}">${escapeHTML(node.title)}</H3>\n`;
        html += '<DL><p>\n';
        html += traverse(node.children);
        html += '</DL><p>\n';
      } else if (node.url) { // It's a bookmark
        html += `<DT><A HREF="${node.url}" ADD_DATE="${Math.floor((node.dateAdded || Date.now()) / 1000)}">${escapeHTML(node.title)}</A>\n`;
      }
    }
    return html;
  };

  let content = '';
  // The bookmark data from chrome.bookmarks.getTree() is an array.
  // The root node itself isn't a real folder, its children are the top-level folders like "书签栏".
  if (bookmarkTree.length > 0 && bookmarkTree[0].children) {
    content = traverse(bookmarkTree[0].children);
  }

  // The entire content is wrapped in a single <DL><p> block.
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
${content}
</DL><p>`;
}

function escapeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>"']/g, function(match) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[match];
    });
}

async function checkWebDAVUpdates() {
  const { webdavConfig, autoCheckEnabled, lastBackupFilename } = await chrome.storage.local.get(['webdavConfig', 'autoCheckEnabled', 'lastBackupFilename']);
  if (!webdavConfig || !webdavConfig.url) return;
  if (autoCheckEnabled === false) return;

  try {
    const files = await getWebDAVFileListForPopup(webdavConfig);
    if (files && files.length > 0) {
      const latestFile = files[0];
      const newTime = extractTimeFromFilename(latestFile.name);
      const oldTime = extractTimeFromFilename(lastBackupFilename);

      if (newTime > (oldTime || 0)) {
        // 下载文件内容
        const result = await loadWebDAVFileForPopup(webdavConfig, latestFile);
        if (result.success) {
          try {
            console.log('开始自动导入书签，HTML内容长度:', result.content.length);
            
            // 先清空现有书签
            const existingBookmarks = await chrome.bookmarks.getTree();
            const bookmarkBar = existingBookmarks[0].children[0];
            const otherBookmarks = existingBookmarks[0].children.find(n => n.id !== bookmarkBar.id);

            console.log('清空现有书签...');
            for (const child of bookmarkBar.children) await chrome.bookmarks.removeTree(child.id);
            if (otherBookmarks) {
                for (const child of otherBookmarks.children) await chrome.bookmarks.removeTree(child.id);
            }

            // 使用幕后文档解析HTML
            console.log('设置幕后文档...');
            await setupOffscreenDocument('offscreen.html');
            
            console.log('发送解析请求到幕后文档...');
            chrome.runtime.sendMessage({
                action: 'parseHtmlForOffscreen',
                htmlString: result.content
            });
            
            // 更新最后备份文件名
            await chrome.storage.local.set({ lastBackupFilename: latestFile.name });
            
            // 显示通知
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: '书签已自动同步',
              message: `已从WebDAV加载最新备份: ${latestFile.name}`
            });
            
          } catch (error) {
            console.error('自动导入书签失败:', error);
          }
        } else {
          console.error("自动同步失败:", result.error);
        }
      }
    }
  } catch (error) {
    console.error("检查WebDAV更新失败:", error);
  }
}

function extractTimeFromFilename(filename) {
  if (!filename) return null;
  const match = filename.match(/bookmarks-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.html/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`).getTime();
}