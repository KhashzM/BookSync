chrome.runtime.onMessage.addListener((request) => {
  if (request.action === 'parseXmlForOffscreen') {
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(request.xmlString, 'application/xml');
      
      const parseError = xml.getElementsByTagName('parsererror');
      if (parseError.length > 0) {
        throw new Error('XML parsing error: ' + parseError[0].textContent);
      }
      
      const responses = [...xml.getElementsByTagName('d:response')];
      const hrefs = [];
      for (const r of responses) {
        const hrefElement = r.getElementsByTagName('d:href')[0];
        if (hrefElement) {
            hrefs.push(hrefElement.textContent);
        }
      }
      
      chrome.runtime.sendMessage({
        action: 'offscreenParseResult',
        success: true,
        results: hrefs
      });

    } catch (e) {
      chrome.runtime.sendMessage({
        action: 'offscreenParseResult',
        success: false,
        error: e.toString()
      });
    }
  } else if (request.action === 'parseHtmlForOffscreen') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(request.htmlString, 'text/html');
      
      // 获取所有书签文件夹和链接
      const rootDl = doc.querySelector('dl');
      
      if (!rootDl) {
        throw new Error('未找到有效的书签数据');
      }
      
      // 解析书签树结构
      const bookmarksData = parseBookmarkNode(rootDl);
      
      chrome.runtime.sendMessage({
        action: 'offscreenParseResult',
        success: true,
        results: bookmarksData.children
      });

    } catch (e) {
      console.error('HTML解析错误:', e);
      chrome.runtime.sendMessage({
        action: 'offscreenParseResult',
        success: false,
        error: e.toString()
      });
    }
  }
});

// 解析书签节点（递归）
function parseBookmarkNode(dlNode, isRootLevel = true) {
  const node = {
    type: 'folder',
    title: '根目录',
    children: []
  };
  
  // 用于收集"其他收藏栏"的内容（只在根级别时使用）
  const otherBookmarks = [];
  
  // 遍历DL节点的所有子节点
  let currentChild = dlNode.firstElementChild;
  
  while (currentChild) {
    if (currentChild.tagName === 'DT') {
      const folder = currentChild.querySelector('h3');
      const link = currentChild.querySelector('a');
      
      if (folder) {
        const folderTitle = folder.textContent.trim() || '未命名文件夹';
        
        // 如果是"收藏夹栏"或"书签栏"文件夹，解析其子内容但不直接返回
        if ((folderTitle === '收藏夹栏' || folderTitle === '书签栏') && isRootLevel) {
          // 查找DT标签内的DL标签
          let subDl = currentChild.querySelector('dl');
          
          // 如果没有找到，查找DT标签后面的DL标签
          if (!subDl && currentChild.nextElementSibling && currentChild.nextElementSibling.tagName === 'DL') {
            subDl = currentChild.nextElementSibling;
          }
          
          if (subDl) {
            // 解析子文件夹的内容，但不创建"收藏夹栏"节点
            // 递归调用时传入isRootLevel=false，避免执行"其他收藏栏"逻辑
            const subFolder = parseBookmarkNode(subDl, false);
            node.children = subFolder.children;
          }
        } else {
          // 其他文件夹节点
          const folderNode = {
            type: 'folder',
            title: folderTitle,
            children: []
          };
          
          // 查找DT标签内的DL标签
          let subDl = currentChild.querySelector('dl');
          
          // 如果没有找到，查找DT标签后面的DL标签
          if (!subDl && currentChild.nextElementSibling && currentChild.nextElementSibling.tagName === 'DL') {
            subDl = currentChild.nextElementSibling;
          }
          
          if (subDl) {
            // 递归解析子文件夹
            const subFolder = parseBookmarkNode(subDl, false);
            folderNode.children = subFolder.children;
          }
          
          // 只在根级别时收集到"其他收藏栏"
          if (isRootLevel) {
            otherBookmarks.push(folderNode);
          } else {
            node.children.push(folderNode);
          }
        }
      } else if (link) {
        // 书签节点
        const url = link.getAttribute('href');
        if (url && isValidUrl(url)) {
          const bookmarkNode = {
            type: 'bookmark',
            title: link.textContent.trim() || '未命名书签',
            url: url
          };
          
          // 只在根级别时收集到"其他收藏栏"
          if (isRootLevel) {
            otherBookmarks.push(bookmarkNode);
          } else {
            node.children.push(bookmarkNode);
          }
        }
      }
    }
    
    currentChild = currentChild.nextElementSibling;
  }
  
  // 只在根级别时创建"其他收藏栏"文件夹
  if (isRootLevel && otherBookmarks.length > 0) {
    const otherFolder = {
      type: 'folder',
      title: '其他收藏栏',
      children: otherBookmarks
    };
    node.children.push(otherFolder);
  }
  
  return node;
}

// 验证URL格式
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
} 