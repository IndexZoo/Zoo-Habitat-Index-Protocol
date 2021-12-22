<p align="center">
  <a href="https://circleci.com/gh/SetProtocol/set-protocol-v2/tree/master">
    <img src="https://img.shields.io/circleci/project/github/SetProtocol/set-protocol-v2/master.svg" />
  </a>
  <a href='https://coveralls.io/github/SetProtocol/set-protocol-v2?branch=master'><img src='https://coveralls.io/repos/github/SetProtocol/set-protocol-v2/badge.svg?branch=master&amp;t=4pzROZ' alt='Coverage Status' /></a>
</p>

# IndexZoo 

## Prerun

- Create `.env` file with values for variables taken from `.env.default`
- Use yarn in this project ```yarn install```

## Generate TypeChain Typings
```
npx hardhat clean
npx hardhat typechain
```

## Run

- Run command ```yarn test```
- To test specific file run ```npx hardhat test path_to_file```

## Stories
- Stories for different scenarios are represented with detailed commandset walk-through. Run `npx hardhat console` and refer to `console-walkthrough.md` to find the relevant commands.
### Owner creating tokenset from set protocol factory
- Tokens to be added to set already deployed
- Deploy `Controller` then deploy  `SetTokenCreator`.
- Optionally deploy any module `BasicIssuanceModule`.
- Call initialize `Controller` with deployed `SetTokenCreator` and  deployed `BasicIssuanceModule`
  - If module not deployed, any mock address would serve the purpost of this story.
- Create a tokenset via `SetTokenCreator` with token addresses and amounts as arguments.
- Use events to get the address of deployed tokenset.
- Cast the address into ERC20 abi and ensure ERC20 methods are called properly.  
### User mints and redeams tokensets
- Tokens to be added to set already deployed
- Deploy `Controller` then deploy  `SetTokenCreator`.
- Deploy module `BasicIssuanceModule`.
- Call initialize `Controller` with deployed `SetTokenCreator` and  deployed `BasicIssuanceModule`
  - If module not deployed, any mock address would serve the purpost of this story.
- Create a tokenset via `SetTokenCreator` with token addresses and amounts as arguments.
- Use events to get the address of deployed tokenset.
- Cast the address into ERC20 abi.  
- Initialize `BasicIssuanceModule` which enables users to issue and redeem tokens of tokenset. 
- Ensure module is added by listing modules from the deployed tokenset.
- User approves `BasicIssuanceModule` to use his/her tokens to be pegged.
- User connects to `BasicIssuanceModule` to issue new tokens from the deployed tokenset with specified quantity to him/herself.
- Ensure balance of user of deployed tokenset is increased accordingly and ensure his/her balance of deposit tokens are decreased according to calculated quantities.   
- User connects to `BasicIssuanceModule` to redeem part of the issued tokens.
- Ensure balance of user of deployed tokenset is decreased accordingly and ensure his/her ba;ance of deposit tokens are increased according to calculated quantities.
### Trading
- Deploy Controller, SetTokenCreator, IntegrationRegistry, TradeModule, UniswapV2ExchangeAdapter
- Setup uniswap
- Setup `BasicIssuanceModule`
- Initialize `Controller` with SetTokenCreator, TradeModule, BasicIssuanceModule, IntegrationRegistry, IntegrationRegistryIndex=0.
- Add integration to `IntegrationRegistry` to map deployed `TradeModule` to name `UNISWAP` to the deployed `UniswapV2ExchangeAdapter`.
- Create a new tokenset via factory then initialize `BasicIssuanceModule` to issue tokensets for user.
- Initialize `TradeModule` with address of deployed tokenset.
- Call a trade function in `TradeModule` buy DAI using WETH.
- Ensure balance of tokenset of WETH decrease while balance of DAI increase according to price of trade.  
### Streaming Fees
- Streaming fees are gained by the trader through minting the SetToken according to an agreedupon cut.
- The fee is calculated throughout a period of time in seconds from the current total supply of SetToken.
- In order to run the test on mainnet (forked on localhost)
  - start a hardhat node forking mainnet
  ```
  npx hardhat node --fork https://eth-mainnet.alchemyapi.io/v2/h53guKI_UFOJlC1hjGkriV4Ggcz66rYo
  ```
  - Run the `streamingFee.spec.ts` test while `FORKED=true` as env var, make sure test is connected to localhost.
  ```
  FORKED=true npx hardhat test --network localhost  test/zokyo/streamingFee.spec.ts 
  ```
  - It takes sometime, make sure you set enough timeout in `hardhat.config.ts` 
