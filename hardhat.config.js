require('@nomiclabs/hardhat-waffle');
require('hardhat-gas-reporter');
require('solidity-coverage');
require('hardhat-contract-sizer');
require('hardhat-docgen');
require('hardhat-storage-layout');
require('solidity-coverage');
require('dotenv').config({ path: require('find-config')('.env') })

// Need to compile first
task('storage', 'Print storage layout', async (taskArgs, hre) => {
  await hre.storageLayout.export();
});

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: '0.8.4',
    settings: {
      optimizer: {
        enabled: true,
        runs: 10000,
      },
      outputSelection: {
        '*': {
          '*': ['storageLayout'],
        },
      },
    }
  },

  networks: {
    hardhat: {
      initialBaseFeePerGas: 0,
      forking: {
        url: process.env.ARCHIVE_NODE_RPC_URL,
        blockNumber: 13103448, // Doesn't really matter in our case, helps with cache
      },
    },
    goerli: {
      url: "https://eth-goerli.alchemyapi.io/v2/oWLcLNjkt-h-45MzIh7sqNJiBRTwe5y5",
      accounts: ["0x1ac1b43f445fe5ea7b71d6904504fe647f6bc965dfdb1c922f1407e92f4dc342"]
    }
  },

  gasReporter: {
    enabled: true,
  },

  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
  },

  docgen: {
    path: './docs',
    clear: true,
  }
};
