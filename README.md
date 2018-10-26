# box-downloader
A trivial script for downloading files from box using box-node-sdk.
I wrote this to transfer files on box to another file storage service.

## Features
It automatically does followings
- Downloading Boxnote as Text File
- Downloading WebLink File as URL Shortcut for Windows
- Converting the File or Folder Name to be compatible for Windows
- Checking modified Dates and then download only updated files on Box

## Requirement
- node.js v8+

## How to use
+ Install node modules by `yarn install`
+ Create a `config.json` on root folder which is downloaded from Box App config page.
+ Run following command for downloading files
```sh
$ node scripts/download.js <Folder Id> <Download Destination Directory>
```
