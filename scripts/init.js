const boxSDK = require('box-node-sdk'); // Box SDK
const fs = require('fs'); // File system for config

// Fetch config file for instantiating SDK instance
const configJSON = JSON.parse(fs.readFileSync('config.json'));

// Instantiate instance of SDK using generated JSON config
const sdk = boxSDK.getPreconfiguredInstance(configJSON);

// Create new basic client with developer token
// email: AutomationUser_665641_5NsjuLDnYY@boxdevedition.com
const client = sdk.getAppAuthClient('enterprise');

module.exports = {
  client,
};
