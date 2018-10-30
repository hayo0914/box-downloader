const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const stat = promisify(fs.stat);
const client = require('./init').client;

class Downloader {
  constructor() {
    this._MAX_CONCURRENT_DOWNLOAD = 20;
    this._client = require('./init').client;
    this._UNLOCK_FILE = true;
  }

  _doPararell(list, f) {
    return new Promise((resolve, reject) => {
      this._iter(idx => {
          let prms = [];
          let l = list.slice(idx * this._MAX_CONCURRENT_DOWNLOAD, (1 + idx) * this._MAX_CONCURRENT_DOWNLOAD - 1);
          for (let item of l) {
            let p = f(item);
            if (p) {
              prms.push(p);
            }
          }
          return Promise.all(prms);
        }, 0, Math.floor(list.length / this._MAX_CONCURRENT_DOWNLOAD),
        () => {
          console.log("_doPararell done");
          resolve();
        });
    });
  }

  _doSerial(list, f) {
    return new Promise((resolve, _) => {
      this._iter(idx => {
          return f(list[idx]);
        }, 0, list.length - 1,
        () => {
          console.log("_doSerial done");
          resolve();
        }
      );
    });
  }

  _iter(next, idx, max, finish) {
    if (idx > max) {
       finish();
       return;
    }
    next(idx).then(() => {
        this._iter(next, idx + 1, max, finish);
      });
  }

  download(savePath, folderId) {
    return new Promise((resolve, _) => {
      this._getItemList(folderId).then(items => {
        this._doSerial(items, item => {
          return this._download(savePath, item, 0);
        }).then(() => {
          console.log("Root resolve:", savePath);
          resolve();
        });
      });
    });
  }

  _download(parentPath, item) {
    return new Promise((resolve, reject) => {
      const { id, name, type } = item;
      const safeName = this._replaceIncompatibleCharsForFiles(name);
      const savePath = path.join(parentPath, safeName);

      if (type == 'folder') {
        if (fs.existsSync(savePath) == false) {
          fs.mkdirSync(savePath);
        }
        this._downloadFolder(savePath, id)
          .then(() => {
            console.log('resolve:', savePath);
            resolve();
          });
      } else if (type == 'file') {
        if (path.extname(savePath) == '.boxnote') {
          this._downloadFile(
            savePath + '.txt',
            item,
            this._downloadBoxNote,
          ).then(() => {
            console.log('resolve:', savePath);
            resolve();
          });
        } else {
          this._downloadFile(
            savePath,
            item,
            this._downloadNormalFile,
          ).then(() => {
            console.log('resolve:', savePath);
            resolve();
          });
        }
      } else if (type == 'web_link') {
        this._downloadFile(
          savePath + '.url',
          item,
          this._downloadWebLink,
        ).then(() => {
          console.log('resolve:', savePath);
          resolve();
        });
      } else {
        console.error(item);
        reject('Error: Invalid item type');
      }
    });
  }

  _downloadFolder(savePath, id) {
    return new Promise((resolve, _) => {
      console.log('Downloading Folder:', savePath);
      this._getItemList(id).then(items => {
        const files = [];
        const folders = [];
        for (let item of items) {
          if (item.type == 'folder') {
            folders.push(item);
          } else {
            files.push(item);
          }
        }
        this._doPararell(files, item => {
          return this._download(savePath, item);
        }).then(() => {
          this._doSerial(folders, item => {
            return this._download(savePath, item);
          }).then(() => {
            console.log(`Download completed: ${savePath}`);
            resolve();
          });
        });
      });
    });
  }

  async _downloadFile(savePath, item, downloader) {
    const { id, lock } = item;
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
      return downloader(savePath, item);
    } else if (await this._isFileOld(savePath, modifiedAt)) {
      console.log(`File is old: ${savePath}`);
      return downloader(savePath, item);
    } else {
      console.log('Up To Date:', savePath);
      return;
    }
  }

  async _isFileOld(path, modifiedAt) {
    const stats = await stat(path);
    const dt = new Date(stats.mtime);
    const mod = new Date(modifiedAt);
    return mod > dt;
  }

  _downloadNormalFile(savePath, item) {
    return new Promise((resolve, reject) => {
      const { id } = item;
      console.log("Download Start:", savePath);
      client.files.getReadStream(id, null, function(error, stream) {
        console.log("Stream Created:", savePath);
        if (error) {
          console.log("Read Stream Error:", savePath);
          console.log(error);
          reject(error);
          return;
        }
        const output = fs.createWriteStream(savePath);
        stream.pipe(output).on('error', () => {
          console.log(`Stream Error: ${savePath}`);
          reject(error);
        });
      }).then(() => {
        console.log('Download Succeed:', savePath);
        resolve();
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
      console.log("Download Start:", savePath);
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
        });
      }).then(() => {
        console.log('Download Succeed:', savePath);
        resolve();
      });
    });
  }

  async _getItemList(folderId) {
    const items = await this._client.folders.getItems(folderId, {
      fields: 'name,type,modified_at,size,url,lock',
      limit: 10000,
    });
    const results = [];
    console.log(`folderId: ${folderId}`);
    for (let item of items.entries) {
      const { id, name, type, modified_at, size, url, lock } = item;
      console.log(`id: ${id}, type: ${type}, name: ${name}`);
      results.push({ id, name, type, modified_at, size, url, lock });
    }
    return results;
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
  downloader.download(downloadDir, targetItemId)
    .then(() => {
      console.log(`All Files completed: ${targetItemId} ${savePath}`);
    })
    .catch(error => {
      console.log("Error");
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
