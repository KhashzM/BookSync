document.addEventListener('DOMContentLoaded', function () {
    // =================================================================
    // DOM 元素获取
    // =================================================================
    const lastBackup = document.getElementById('lastBackup');
    const lastFilename = document.getElementById('lastFilename');
    const manualBackupBtn = document.getElementById('manualBackup');
    const viewFolderBtn = document.getElementById('viewFolder');
    const autoBackup = document.getElementById('autoBackup');
    const showNotificationToggle = document.getElementById('showNotification');
    const autoCheckEnabled = document.getElementById('autoCheckEnabled');
    const historyList = document.getElementById('historyList');
    const progressBar = document.getElementById('progressBar');
    const notification = document.getElementById('notification');
    const notificationText = document.getElementById('notificationText');
    const folderCount = document.getElementById('folderCount');
    const bookmarkCount = document.getElementById('bookmarkCount');
    const backupType = document.getElementById('backupType');

    // WebDAV 配置
    const testWebdavBtn = document.getElementById('testWebdav');
    const webdavUrl = document.getElementById('webdavUrl');
    const webdavPath = document.getElementById('webdavPath');
    const webdavUsername = document.getElementById('webdavUsername');
    const webdavPassword = document.getElementById('webdavPassword');
    const saveSettingsBtn = document.getElementById('saveSettings');
    const backupMethodSelect = document.getElementById('backupMethod');

    // 文件回档
    const fileSelect = document.getElementById('fileSelect');
    const refreshBtn = document.getElementById('refreshBtn');
    const loadBtn = document.getElementById('loadBtn');
    const loadLocalBtn = document.getElementById('loadLocalBtn');

    // =================================================================
    // 函数定义
    // =================================================================

    // 统计书签数量
    function calculateStats() {
        chrome.bookmarks.getTree((bookmarkTree) => {
            let folders = 0;
            let bookmarks = 0;

            function count(node) {
                if (node.children) {
                    folders++;
                    node.children.forEach(count);
                } else if (node.url) {
                    bookmarks++;
                }
            }
            bookmarkTree.forEach(count);
            folderCount.textContent = `${folders} 个文件夹`;
            bookmarkCount.textContent = `${bookmarks} 个书签`;
        });
    }

    // 更新备份状态显示
    function updateBackupStatus(filename, dateString, timeString) {
        lastBackup.textContent = `最后备份: ${dateString} ${timeString}`;
        lastFilename.textContent = filename;
    }

    // 更新历史记录列表
    function updateHistory(history) {
        historyList.innerHTML = '';
        if (history.length === 0) {
            historyList.innerHTML = '<div class="empty-history">暂无备份历史记录</div>';
            return;
        }
        history.forEach(item => {
            const date = new Date(item.date);
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.innerHTML = `<span class="history-name">${item.filename}</span><span class="history-date">${dateStr} ${timeStr}</span>`;
            historyList.appendChild(historyItem);
        });
    }

    // 显示通知
    function showNotification(message, isError = false) {
        notificationText.textContent = message;
        notification.className = 'notification show';
        if (isError) {
            notification.classList.add('error');
        }
        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }

    // 填充文件下拉列表
    async function populateFileSelect() {
        fileSelect.innerHTML = '<option disabled selected>加载中...</option>';
        try {
            const webdavConfig = await getWebDAVConfig();
            if (webdavConfig && webdavConfig.url) {
                const files = await getWebDAVFileList(webdavConfig);
                if (files.length === 0) {
                    fileSelect.innerHTML = '<option disabled selected>无云端文件</option>';
                } else {
                    const options = files.map(file => {
                        const dateStr = formatFilenameDate(file.name);
                        // 将整个文件对象JSON序列化后存入value
                        return `<option value='${JSON.stringify(file)}'>${file.name} (${dateStr})</option>`;
                    }).join('');
                    fileSelect.innerHTML = `<option disabled selected>请选择要加载的云端文件</option>${options}`;
                }
            } else {
                fileSelect.innerHTML = '<option disabled selected>WebDAV未配置</option>';
            }
        } catch (error) {
            console.error("加载云端文件列表失败:", error);
            fileSelect.innerHTML = '<option disabled selected>加载失败</option>';
        }
    }
    
    // 刷新文件列表
    async function refreshFileList() {
        const icon = refreshBtn.querySelector('i');
        icon.classList.add('fa-spin');
        refreshBtn.disabled = true;
        await populateFileSelect();
        icon.classList.remove('fa-spin');
        refreshBtn.disabled = false;
    }

    // 从文件名格式化日期
    function formatFilenameDate(filename) {
        const match = filename.match(/bookmarks-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.html/);
        if (!match) return '';
        const [, year, month, day, hour, minute] = match;
        return `${year}-${month}-${day} ${hour}:${minute}`;
    }

    // 获取WebDAV配置
    function getWebDAVConfig() {
        return new Promise(resolve => {
             chrome.storage.local.get('webdavConfig', result => resolve(result.webdavConfig));
        });
    }

    // 获取WebDAV文件列表 (通过background)
    function getWebDAVFileList(webdavConfig) {
        return new Promise((resolve, reject) => {
            console.log('发送getWebDAVFileList请求，配置:', webdavConfig);
            chrome.runtime.sendMessage({ action: "getWebDAVFileList", config: webdavConfig }, (response) => {
                console.log('收到getWebDAVFileList响应:', response);
                if (chrome.runtime.lastError) {
                    console.error('chrome.runtime.lastError:', chrome.runtime.lastError);
                    return reject(chrome.runtime.lastError);
                }
                if (response && response.fileList) {
                    resolve(response.fileList);
                } else {
                    console.error('响应格式错误:', response);
                    reject(new Error('从后台获取文件列表响应格式错误'));
                }
            });
        });
    }

    // 加载WebDAV文件
    async function loadWebDAVFile(filename) {
        loadBtn.disabled = true;
        loadBtn.textContent = '加载中...';
        try {
            const webdavConfig = await getWebDAVConfig();
            if (!webdavConfig || !webdavConfig.url) {
                showNotification("未配置 WebDAV", true);
                return;
            }
            const result = await new Promise((resolve, reject) => {
                chrome.runtime.sendMessage({ action: "loadWebDAVFile", config: webdavConfig, filename: filename }, (response) => {
                    if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                    resolve(response);
                });
            });
            if (result.success) {
                // 使用新的导入逻辑
                chrome.runtime.sendMessage({ 
                    action: "importBookmarks", 
                    htmlContent: result.content 
                });
            } else {
                showNotification('加载失败: ' + result.error, true);
                loadBtn.disabled = false;
                loadBtn.textContent = '加载';
            }
        } catch (error) {
            showNotification('加载失败: ' + error.message, true);
            loadBtn.disabled = false;
            loadBtn.textContent = '加载';
        }
    }

    // 加载本地文件
    function loadLocalFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.html';
        input.onchange = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            
            // 验证文件类型
            if (!file.name.endsWith('.html')) {
                showNotification('请选择有效的书签HTML文件', true);
                return;
            }
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                loadLocalBtn.disabled = true;
                loadLocalBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
                try {
                    chrome.runtime.sendMessage({ 
                        action: "importBookmarks", 
                        htmlContent: e.target.result 
                    });
                } catch(error) {
                    showNotification('加载失败: ' + error.message, true);
                    loadLocalBtn.disabled = false;
                    loadLocalBtn.innerHTML = '<i class="fas fa-folder-open"></i> 加载本地文件';
                }
            };
            reader.readAsText(file);
        };
        input.click();
    }


    // =================================================================
    // 事件监听
    // =================================================================

    // 监听来自后台的消息
    chrome.runtime.onMessage.addListener((message) => {
        if (message.action === "backupComplete") {
            updateBackupStatus(message.filename, message.dateString, message.timeString);
            chrome.storage.local.get(['backupHistory'], (result) => {
                if (result.backupHistory) updateHistory(result.backupHistory);
            });
        } else if (message.action === "importResult") {
            if (message.success) {
                showNotification(message.message || '书签导入成功！');
                calculateStats();
            } else {
                showNotification('导入失败: ' + message.error, true);
            }
            loadLocalBtn.disabled = false;
            loadLocalBtn.innerHTML = '<i class="fas fa-folder-open"></i> 加载本地文件';
            loadBtn.disabled = false;
            loadBtn.textContent = '加载';
        } else if (message.action === "webdavTestResult") {
            if (message.success) {
                showNotification("✅ WebDAV 连接成功！");
            } else {
                showNotification("❌ WebDAV 连接失败：" + message.error, true);
            }
            testWebdavBtn.innerHTML = '<i class="fas fa-plug"></i> 测试WebDAV连接';
            testWebdavBtn.disabled = false;
        } else if (message.action === "webdavUploadFailed") {
            showNotification("❌ WebDAV 上传失败：" + message.error, true);
        }
    });

    // 手动备份
    manualBackupBtn.addEventListener('click', function () {
        const method = backupMethodSelect.value;
        manualBackupBtn.disabled = true;
        let width = 0;
        const interval = setInterval(() => {
            width += 10;
            progressBar.style.width = width + '%';
            if (width >= 100) {
                clearInterval(interval);
                chrome.runtime.sendMessage({
                    action: "manualBackup",
                    method: method,
                    webdavConfig: {
                        url: webdavUrl.value,
                        path: webdavPath.value,
                        username: webdavUsername.value,
                        password: webdavPassword.value
                    }
                }, () => {
                     manualBackupBtn.disabled = false;
                     progressBar.style.width = '0%';
                });
            }
        }, 50);
    });

    // 保存设置
    saveSettingsBtn.addEventListener('click', function () {
        const webdavUrlValue = webdavUrl.value.trim();
        const selectedMethod = backupMethodSelect.value;
        
        if (!webdavUrlValue) {
            // 如果URL为空，直接保存其他设置
            const webdavConfig = {
                url: '',
                path: webdavPath.value,
                username: webdavUsername.value,
                password: webdavPassword.value
            };
            chrome.storage.local.set({
                backupMethod: selectedMethod,
                webdavConfig: webdavConfig,
                autoCheckEnabled: autoCheckEnabled.checked
            }, () => {
                showNotification('设置已保存');
                updateBackupTypeDisplay(selectedMethod);
            });
            return;
        }

        let origin;
        try {
            origin = new URL(webdavUrlValue).origin;
        } catch (error) {
            showNotification('无效的 WebDAV URL', true);
            return;
        }

        chrome.permissions.request({
            origins: [`${origin}/*`]
        }, (granted) => {
            if (granted) {
                const webdavConfig = {
                    url: webdavUrlValue,
                    path: webdavPath.value,
                    username: webdavUsername.value,
                    password: webdavPassword.value
                };
                chrome.storage.local.set({
                    backupMethod: selectedMethod,
                    webdavConfig: webdavConfig,
                    autoCheckEnabled: autoCheckEnabled.checked
                }, () => {
                    showNotification('设置已保存，并已获取主机权限');
                    updateBackupTypeDisplay(selectedMethod);
                    // 权限获取成功后，可以立即刷新文件列表
                    populateFileSelect();
                });
            } else {
                showNotification('需要主机权限才能使用 WebDAV 功能', true);
            }
        });
    });

    // WebDAV 测试
    testWebdavBtn.addEventListener('click', function () {
        if (!webdavUrl.value || !webdavUsername.value || !webdavPassword.value) {
            return showNotification("请填写完整的 WebDAV 配置信息", true);
        }
        testWebdavBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试中...';
        testWebdavBtn.disabled = true;
        chrome.runtime.sendMessage({
            action: "testWebdav",
            config: {
                url: webdavUrl.value,
                username: webdavUsername.value,
                password: webdavPassword.value
            }
        });
    });
    
    // 其他开关和按钮
    viewFolderBtn.addEventListener('click', () => chrome.downloads.showDefaultFolder());
    autoBackup.addEventListener('change', (e) => chrome.storage.local.set({ autoBackupEnabled: e.target.checked }));
    showNotificationToggle.addEventListener('change', (e) => chrome.storage.local.set({ showNotifications: e.target.checked }));
    autoCheckEnabled.addEventListener('change', (e) => chrome.storage.local.set({ autoCheckEnabled: e.target.checked }));
    
    // 备份方式选择变化时更新显示
    backupMethodSelect.addEventListener('change', (e) => {
        updateBackupTypeDisplay(e.target.value);
    });

    // 文件回档按钮
    refreshBtn.addEventListener('click', refreshFileList);
    loadBtn.addEventListener('click', () => {
        const selectedOption = fileSelect.options[fileSelect.selectedIndex];
        if (!selectedOption || selectedOption.disabled) {
            return showNotification("请选择一个云端文件！", true);
        }
        try {
            // 解析存储在value中的文件对象
            const fileInfo = JSON.parse(selectedOption.value);
            loadWebDAVFile(fileInfo);
        } catch(e) {
            showNotification("无效的文件选项", true);
        }
    });
    loadLocalBtn.addEventListener('click', loadLocalFile);

    // =================================================================
    // 初始化
    // =================================================================
    function init() {
        calculateStats();

        chrome.storage.local.get([
            'autoBackupEnabled', 
            'showNotifications', 
            'autoCheckEnabled',
            'backupHistory', 
            'lastBackupFilename', 
            'backupMethod', 
            'webdavConfig'
        ], (result) => {
            autoBackup.checked = result.autoBackupEnabled !== false;
            showNotificationToggle.checked = result.showNotifications !== false;
            autoCheckEnabled.checked = result.autoCheckEnabled !== false;
            
            if (result.backupHistory) updateHistory(result.backupHistory);
            if (result.lastBackupFilename) lastFilename.textContent = result.lastBackupFilename;
            if (result.backupMethod) {
                backupMethodSelect.value = result.backupMethod;
                // 更新备份方式显示
                updateBackupTypeDisplay(result.backupMethod);
            } else {
                // 如果没有保存过备份方式，使用当前选择的值
                updateBackupTypeDisplay(backupMethodSelect.value);
            }
            
            if (result.webdavConfig) {
                webdavUrl.value = result.webdavConfig.url || '';
                webdavPath.value = result.webdavConfig.path || '';
                webdavUsername.value = result.webdavConfig.username || '';
                webdavPassword.value = result.webdavConfig.password || '';
            }

            populateFileSelect();
        });
    }

    // 更新备份方式显示
    function updateBackupTypeDisplay(method) {
        const backupTypeText = method === 'webdav' ? 'WebDAV云端备份' : 
                              method === 'local' ? '本地下载' : '未选择备份方式';
        backupType.textContent = backupTypeText;
    }

    init();
});
