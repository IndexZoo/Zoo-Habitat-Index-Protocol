require("dotenv").config();

import 'hardhat-gas-reporter';

import chalk from "chalk";
import { HardhatUserConfig } from "hardhat/config";
import { privateKeys } from "./utils/wallets";

import "@nomiclabs/hardhat-waffle";
import "@typechain/hardhat";
import "solidity-coverage";
import "./tasks";


const UNISWAPROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";  // mainnet, rinkbey, kovan
const DAI_ADDRESS = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063";

const forkingConfig = {
  url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_TOKEN}`,
  blockNumber: 12198000,
};

const mochaConfig = {
  grep: "@forked-mainnet",
  invert: (process.env.FORK ) ? false : true,
  timeout: (process.env.FORK || process.env.FORKED) ? 200000 : 40000, // 100000:40000
} as Mocha.MochaOptions;

checkForkedProviderEnvironment();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.6.10",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      forking: (process.env.FORK) ? forkingConfig : undefined,
      accounts: getHardhatPrivateKeys(),
      allowUnlimitedContractSize: true
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      timeout: 200000,
      gas: 12000000,
      blockGasLimit: 12000000,
    },
    kovan: {
      url: "https://eth-kovan.alchemyapi.io/v2/" + process.env.KOVAN_ALCHEMY_TOKEN,
      gas: 12000000,
      // @ts-ignore
      accounts: [`0x${process.env.TEST_PRIVATE_KEY}`],
      // @ts-ignore
      uniswapRouterAddress: UNISWAPROUTER_ADDRESS
    },
    rinkeby: {
      url: "https://eth-rinkeby.alchemyapi.io/v2/" + process.env.ALCHEMY_TOKEN,
      gas: 12000000,
      // url: "https://rinkeby.infura.io/v3/" + process.env.INFURA_TOKEN,
      // @ts-ignore
      accounts: [`0x${process.env.TEST_PRIVATE_KEY}`],
      // @ts-ignore
      uniswapRouterAddress: UNISWAPROUTER_ADDRESS,
      weth: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984"
    },
    polygon: {
      url: "https://polygon-mainnet.g.alchemy.com/v2/" + process.env.POLYGON_ALCHEMY_TOKEN,
      gas: 12000000,
      // @ts-ignore
      accounts: [`0x${process.env.PRODUCTION_LOWFEE_DEPLOY_PRIVATE_KEY}`],
      // @ts-ignore
      uniswapRouterAddress: "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506",  // Sushiswap 
      weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
      dai: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
      wmatic: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"
    },
     // To update coverage network configuration got o .solcover.js and update param in providerOptions field
    coverage: {
      url: "http://127.0.0.1:8555", // Coverage launches its own ganache-cli client
      timeout: 200000,
    },
  },
  // @ts-ignore
  typechain: {
    outDir: "typechain",
    target: "ethers-v5",
    externalArtifacts: ["external/**/*.json"],
  },
  mocha: mochaConfig,

  // These are external artifacts we don't compile but would like to improve
  // test performance for by hardcoding the gas into the abi at runtime
  // @ts-ignore
  externalGasMods: [
  ],
  gasReporter: {
    enabled: false 
  }
};

function getHardhatPrivateKeys() {
  return privateKeys.map(key => {
    const ONE_MILLION_ETH = "1000000000000000000000000";
    return {
      privateKey: key,
      balance: ONE_MILLION_ETH,
    };
  });
}

function checkForkedProviderEnvironment() {
  if (process.env.FORK &&
      (!process.env.ALCHEMY_TOKEN || process.env.ALCHEMY_TOKEN === "fake_alchemy_token")
     ) {
    console.log(chalk.red(
      "You are running forked provider tests with invalid Alchemy credentials.\n" +
      "Update your ALCHEMY_TOKEN settings in the `.env` file."
    ));
    process.exit(1);
  }
}

export default config;
