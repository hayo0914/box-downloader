const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const stat = promisify(fs.stat);
const client = require('./init').client;

class Downloader {
  constructor() {
    this._MAX_CONCURRENT_DOWNLOAD = 20;
    this._client = require('./init').client;
    this._downloadingNum = 0;
    this._UNLOCK_FILE = false;
  }

  async download(savePath, folderId) {
    const items = await this._getItemList(folderId);
    for (let item of items.entries) {
      await this._download(savePath, item);
    }
  }

  async _doPararell(list, f) {
    const prms = [];
    for (let item of list.entries) {
      const p = f(item);
      if (p != null) {
        prms.push(p);
      }
    }
    if (prms.length > 0) {
      Promise.all(prms);
    }
  }

  async _doSerial(list, f) {
    for (let item of list.entries) {
      const p = f(item);
      if (p != null) {
        await p;
      }
    }
  }

  async _download(parentPath, item) {
    const { id, name, type } = item;
    const safeName = this._replaceIncompatibleCharsForFiles(name);
    const savePath = path.join(parentPath, safeName);
    console.log('Downloading:', savePath);

    if (type == 'folder') {
      if (fs.existsSync(savePath) === false) {
        fs.mkdirSync(savePath);
      }
      const items = await this._getItemList(id);
      await this._doPararell(items, item => {
        if (item.type == 'folder') {
          return null;
        } else {
          return this._download(savePath, item);
        }
      });
      await this._doSerial(items, item => {
        if (item.type == 'folder') {
          return this._download(savePath, item);
        }
      });
      console.log(`Download completed: ${savePath}`);
    } else if (type == 'file') {
      if (path.extname(savePath) == '.boxnote') {
        return this._downloadFile(
          savePath + '.txt',
          item,
          this._downloadBoxNote,
        );
      } else {
        return this._downloadFile(savePath, item, this._downloadNormalFile);
      }
    } else if (type == 'web_link') {
      return this._downloadFile(savePath + '.url', item, this._downloadWebLink);
    } else {
      console.error('Invalid item type');
      console.error(item);
      process.exit(1);
    }
  }

  async _downloadFile(savePath, item, downloader) {
    const { id, lock } = item;
    const modifiedAt = item.modified_at;
    while (this._downloadingNum >= this._MAX_CONCURRENT_DOWNLOAD) {
      await this._sleep(1000);
    }
    if (lock != null) {
      if (this._UNLOCK_FILE === true) {
        await client.files.unlock(id);
      } else {
        console.log(`Skip Locked File: ${id}`);
        return;
      }
    }
    this._downloadingNum++;
    if (fs.existsSync(savePath) == false) {
      console.log(`File does not exists: ${savePath}`);
      await downloader(savePath, item);
      this._downloadingNum--;
    } else if (await this._isFileOld(savePath, modifiedAt)) {
      console.log(`File is old: ${savePath}`);
      await downloader(savePath, item);
      this._downloadingNum--;
    } else {
      console.log('Up To Date:', savePath);
      this._downloadingNum--;
      return;
    }
  }

  async _isFileOld(path, modifiedAt) {
    const stats = await stat(path);
    const dt = new Date(stats.mtime);
    const mod = new Date(modifiedAt);
    return mod > dt;
  }

  _sleep(msec) {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, msec);
    });
  }

  _downloadNormalFile(savePath, item) {
    const { id } = item;
    return new Promise((resolve, reject) => {
      client.files.getReadStream(id, null, function(error, stream) {
        if (error) {
          reject(error);
          return;
        }
        const output = fs.createWriteStream(savePath);
        stream.pipe(output).on('error', () => {
          console.error(`Stream Error: ${savePath}`);
          reject(error);
        });
        stream.pipe(output).on('finish', () => {
          console.log('Download Succeed:', savePath);
          stream.destroy();
          resolve();
        });
      });
    });
  }

  _downloadWebLink(savePath, item) {
    const { url } = item;
    const data = `[InternetShortcut]\nURL=${url}\n`;
    fs.writeFileSync(savePath, data);
    console.log('Download Succeed:', savePath);
  }

  _downloadBoxNote(savePath, item) {
    const { id } = item;
    return new Promise((resolve, reject) => {
      client.files.getReadStream(id, null, function(error, stream) {
        if (error) {
          reject(error);
          return;
        }
        let content = '';
        stream.on('error', error => {
          console.error(`Stream Error: ${savePath}`);
          reject(error);
        });
        stream.on('data', buffer => {
          content += buffer;
        });
        stream.on('end', () => {
          const boxNoteData = JSON.parse(content);
          fs.writeFileSync(savePath, boxNoteData.atext.text);
          console.log('Download Succeed:', savePath);
          stream.destroy();
          resolve();
        });
      });
    });
  }

  async _getItemList(folderId) {
    const items = await this._client.folders.getItems(folderId, {
      fields: 'name,type,modified_at,size,url,lock',
      limit: 10000,
    });
    return items;
  }

  _replaceIncompatibleCharsForFiles(folderName) {
    return folderName.replace(/\\|\*|\/|\||<|>|:|\?|"\|\./g, '_');
  }
}

function main() {
  const args = process.argv.slice(2);
  const targetItemId = args[0];
  const savePath = args[1];

  if (targetItemId == null || savePath == null) {
    console.error('Error');
    console.log('[Example] node scripts/download.js 2861786671 C:\\downloads');
    process.exit(1);
  }
  const downloadDir = path.resolve(savePath);
  const downloader = new Downloader();
  downloader.download(downloadDir, targetItemId);
}

main();
