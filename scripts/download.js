const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const stat = promisify(fs.stat);
const client = require('./init').client;

function replaceIncompatibleCharsForFiles(folderName) {
  let s = folderName.replace(/\\|\*|\/|\||<|>|:|\?|"\|\./g, '_');
  return s.substr(0, 70);
}

class FolderDownloader {

  constructor() {
    this._UNLOCK_FILE = true;
    this._files = [];
    this._folders = [];
  }

  async prepare(id) {
    const items = await this._getItemList(id);
    for (let item of items) {
      if (item.type == 'folder') {
        this._folders.push(item);
      } else {
        this._files.push(item);
      }
    }
  }

  files() {
    return this._files;
  }

  folders() {
    return this._folders;
  }

  async download(savePath, item) {
    const { id, type } = item;
    if (type == 'folder') {
      if (fs.existsSync(savePath) == false) {
        fs.mkdirSync(savePath);
      }
      await this._downloadFolder(savePath, id);
    } else if (type == 'file') {
      if (path.extname(savePath) == '.boxnote') {
        await this._downloadFile(savePath + '.txt', item, this._downloadBoxNote);
      } else {
        await this._downloadFile(savePath, item, this._downloadNormalFile);
      }
    } else if (type == 'web_link') {
      await this._downloadFile(savePath + '.url', item, this._downloadWebLink);
    } else {
      console.error(item);
      throw new Error("Error: Invalid item type");
    }
  }

  async _downloadFile(savePath, item, downloader) {
    const { id, lock, size } = item;
    const modifiedAt = item.modified_at;
    if (lock != null) {
      if (this._UNLOCK_FILE === true) {
        console.log('Unlocking:', savePath);
        await client.files.unlock(id);
        console.log('Unlocked:', savePath);
      } else {
        console.log(`Skip Locked File: ${id}`);
        return;
      }
    }
    if (fs.existsSync(savePath) == false) {
      console.log(`File does not exists: ${savePath}`);
      await downloader(savePath, item);
    } else if (await this._isFileOld(savePath, modifiedAt, size)) {
      console.log(`File is old: ${savePath}`);
      await downloader(savePath, item);
    } else {
      console.log('Up To Date:', savePath);
      return;
    }
  }

  async _isFileOld(path, modifiedAt, size) {
    const stats = await stat(path);
    const dt = new Date(stats.mtime);
    const mod = new Date(modifiedAt);
    if (path.includes(".boxnote")) {
      return mod > dt;
    }
    return (mod > dt) || (stats.size != size);
  }

  async _downloadNormalFile(savePath, item) {
    const { id } = item;
    console.log('Download Start:', savePath);
    await client.files
      .getReadStream(id, null, function(error, stream) {
        if (error) {
          console.log(error);
          throw new Error(error);
        }
        const output = fs.createWriteStream(savePath);
        stream.pipe(output).on('error', () => {
          const err = `Stream Error: ${savePath}`;
          throw new Error(err);
        });
      });
    console.log('Download Succeed:', savePath);
  }

  _downloadWebLink(savePath, item) {
    const { url } = item;
    const data = `[InternetShortcut]\nURL=${url}\n`;
    fs.writeFileSync(savePath, data);
    console.log('Download Succeed:', savePath);
  }

  async _downloadBoxNote(savePath, item) {
    const { id } = item;
    console.log('Download Start:', savePath);
    await client.files
      .getReadStream(id, null, function(error, stream) {
        if (error) {
          reject(error);
          return;
        }
        let content = '';
        stream.on('error', (error) => {
          console.error(`Stream Error: ${savePath}`);
          reject(error);
        });
        stream.on('data', (buffer) => {
          content += buffer;
        });
        stream.on('end', () => {
          const boxNoteData = JSON.parse(content);
          fs.writeFileSync(savePath, boxNoteData.atext.text);
        });
      });
    console.log('Download Succeed:', savePath);
  }

  async _getItemList(folderId) {
    const items = await client.folders.getItems(folderId, {
      fields: 'name,type,modified_at,size,url,lock',
      limit: 10000,
    });
    const results = [];
    for (let item of items.entries) {
      const { id, name, type, modified_at, size, url, lock } = item;
      results.push({ id, name, type, modified_at, size, url, lock });
    }
    return results;
  }

}

class Downloader {

  constructor() {
    this._MAX_CONCURRENT_DOWNLOAD = 10;
  }

  _doPararell(list, f) {
    return new Promise((resolve) => {
      this._iter(
        (idx) => {
          let prms = [];
          let l = list.slice(
            idx * this._MAX_CONCURRENT_DOWNLOAD,
            (1 + idx) * this._MAX_CONCURRENT_DOWNLOAD,
          );
          for (let item of l) {
            let p = f(item);
            if (p) {
              prms.push(p);
            }
          }
          return Promise.all(prms);
        },
        0,
        Math.floor(list.length / this._MAX_CONCURRENT_DOWNLOAD),
        () => {
          resolve();
        },
      );
    });
  }

  async _doSerial(list, f) {
    for (let item of list) {
      await f(item);
    }
  }

  async _iter(next, idx, max, finish) {
    if (idx > max) {
      finish();
      return;
    }
    await next(idx);
    this._iter(next, idx + 1, max, finish);
  }

  async download(savePath, folderId) {
    const children = await this._downloadFolder(savePath, folderId);
    await this._consumeChildren(children);
  }

  async _consumeChildren(children) {
    while (children.length > 0) {
      const {childPath, childItem} = children.shift();
      const list = await this._downloadFolder(childPath, childItem.id);
      for (let el of list) {
        children.push(el);
      }
    }
  }

  async _downloadFolder(savePath, id) {
    const fd = new FolderDownloader();
    await fd.prepare(id);

    await this._doPararell(fd.files(), async (item) => {
      const { name } = item;
      const safeName = replaceIncompatibleCharsForFiles(name);
      await fd.download(path.join(savePath, safeName), item);
    });

    const children = [];
    for (let childItem of fd.folders()) {
      const { name } = childItem;
      const safeName = replaceIncompatibleCharsForFiles(name);
      const childPath = path.join(savePath, safeName);
      if (fs.existsSync(childPath) == false) {
        fs.mkdirSync(childPath);
      }
      children.push({childPath, childItem});
    }
    return children;
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
  downloader
    .download(downloadDir, targetItemId)
    .then(() => {
      console.log(`All Files completed: ${targetItemId} ${savePath}`);
      process.exit(0);
    })
    .catch((error) => {
      console.log('Error');
      console.error(error);
    });
}

process.on('uncaughtException', function(exception) {
  console.log(exception);
});

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at:', p, 'reason:', reason);
});

main();
