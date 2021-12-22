# Hardhat Console
- Connect to rinkeby `npx hardhat console --network rinkeby`
- Make sure `.env` is configured according to `.env.default`
## Initiate contract artifacts
```
let {abi: ControllerABI} = require( "./artifacts/contracts/protocol/Controller.sol/Controller.json");
let {abi: SetTokenCreatorABI} = require( "./artifacts/contracts/protocol/SetTokenCreator.sol/SetTokenCreator.json");
let {abi: IntegrationRegistryABI} = require( "./artifacts/contracts/protocol/IntegrationRegistry.sol/IntegrationRegistry.json");
let {abi: BasicIssuanceModuleABI} = require( "./artifacts/contracts/protocol/modules/BasicIssuanceModule.sol/BasicIssuanceModule.json");
let {abi: TradeModuleABI} = require( "./artifacts/contracts/protocol/modules/TradeModule.sol/TradeModule.json");
let {abi: SingleIndexModuleABI} = require( "./artifacts/contracts/protocol/modules/SingleIndexModule.sol/SingleIndexModule.json");
let {abi: StreamingFeeModuleABI} = require("./artifacts/contracts/protocol/modules/StreamingFeeModule.sol/StreamingFeeModule.json");
let {abi: SetTokenABI} = require("./artifacts/contracts/protocol/SetToken.sol/SetToken.json");
let {abi: ERC20ABI} = require("@openzeppelin/contracts/build/contracts/ERC20.json");
 let {abi: UniswapV2ExchangeAdapterABI} = require("./artifacts/contracts/protocol/integration/index-exchange/UniswapV2IndexExchangeAdapter.sol/UniswapV2IndexExchangeAdapter.json");

let {abi: UniswapV2RouterABI} = require("./external/abi/uniswap/v2/UniswapV2Router02.json");
```
## Assign addresses and imports
```
let owner  = await ethers.getSigner()
let {ether} = require("./utils/common/unitsUtils")
let { ADDRESS_ZERO, MAX_UINT_256 } = require( "./utils/constants");
let DEPLOYMENTS = require("./scripts/deployments").default
let controller = await ethers.getContractAt(ControllerABI, DEPLOYMENTS.rinkeby.Controller)
let setTokenCreator = await ethers.getContractAt(SetTokenCreatorABI, DEPLOYMENTS.rinkeby.SetTokenCreator)
let integrationRegistry = await ethers.getContractAt(IntegrationRegistryABI, DEPLOYMENTS.rinkeby.IntegrationRegistry)
let basicIssuanceModule = await ethers.getContractAt(BasicIssuanceModuleABI, DEPLOYMENTS.rinkeby.BasicIssuanceModule)
let tradeModule = await ethers.getContractAt(TradeModuleABI, DEPLOYMENTS.rinkeby.TradeModule)
let streamingFeeModule = await ethers.getContractAt(StreamingFeeModuleABI, DEPLOYMENTS.rinkeby.StreamingFeeModule)
let uniswapV2ExchangeAdapter = await ethers.getContractAt(UniswapV2ExchangeAdapterABI, DEPLOYMENTS.rinkeby.UniswapV2ExchangeAdapter)
```

## Set Contracts
- Initialize `Controller` if not already initialized; i.e. call shall fail if initialized.
```
await controller.initialize([setTokenCreator.address], [basicIssuanceModule.address, tradeModule.address], [integrationRegistry.address], [0]);
```
- If module is not included and controller already initialized, you can add modules to controller like so
```
await controller.addModule(streamingFeeModule.address)
```
- Add modules to `IntegrationRegistry` if not already added.
```
 await integrationRegistry.addIntegration(tradeModule.address, "UNISWAP", uniswapV2ExchangeAdapter.address);
```
- Create a tokenset of your chosed configuration
```
await setTokenCreator.create([DEPLOYMENTS.rinkeby.WETH], [ether(0.02)], [basicIssuanceModule.address, tradeModule.address, streamingFeeModule.address], owner.address, "zk_idx", "Z02")  
```
- Get deployed tokenset address from etherscan and assign it to a variable then get the contract itself
```
await user.sendTransaction({to: DEPLOYMENTS.mainnet.WETH, value: ether(35)})   // purchasing weth
let tokenSetAddress = "6be2bb3414cc268e3eaad97b397e04e065f9a2f2"
let tokenSetAddress = "0e7c2d4d1c85fb12a87096be3953c186c443c8c5"
let deployedSetToken =  await ethers.getContractAt(SetTokenABI, tokenSetAddress);
```
- Approve `BasicIssuanceModules` to transfer tokens
```
let weth = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.rinkeby.WETH)
let uni = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.rinkeby.UNI)
await weth.approve(basicIssuanceModule.address, ether(100))
await uni.approve(basicIssuanceModule.address, ether(100))
```
- Initialize modules 
```
await basicIssuanceModule.initialize(tokenSetAddress, ADDRESS_ZERO); 
await tradeModule.initialize(tokenSetAddress); 
await streamingFeeModule.initialize(tokenSetAddress, {feeRecipient: owner.address, maxStreamingFeePercentage: ether(0.05), streamingFeePercentage: ether(0.01), lastStreamingFeeTimestamp: ether(0)})
```
  - You can check whether module initialized for tokenset or not by typing
```
await deployedSetToken.moduleStates(basicIssuanceModule.address) == 2
```
- Ensure modules are added to `tokenSetAddress` by calling
```
await deployedSetToken.getModules();
```
- Issue tokens as a user (in this example it is the owner but it also can be user) 
```
await basicIssuanceModule.issue(deployedSetToken.address, ether(0.2), owner.address)
await deployedSetToken.balanceOf(owner.address) 
await basicIssuanceModule.redeem(deployedSetToken.address, ether(0.1), owner.address)
await deployedSetToken.balanceOf(owner.address) 
```
- Owner uses collateral to make trades
  - `0.01` units means it will sell half the amount of weth in collateral because each tokenset represents `0.02 weth` of collateral.
- Trading for a uniswap token
```
await tradeModule.trade(deployedSetToken.address, "UNISWAP", weth.address, ether(0.01), uni.address, ether(0.0002), "0x")
(await weth.balanceOf(deployedSetToken.address)).toString()
```

## Redeem collateral
- 
```
await basicIssuanceModule.redeem("0x9DEB7569c89D11167C60A35854e00dA7603df1aE", ether(0.5), owner.address) 
```

## Streaming Fee
- After issuing new tokens for user then added `StreamingFeeModule` to SetToken and Controller.
```
let totalSupplyBeforeAccrue = await deployedSetToken .totalSupply();
let timeBeforeAccrue = (await streamingFeeModule.feeStates(deployedSetToken.address)).lastStreamingFeeTimestamp;
// Wait sometime
await streamingFeeModule.accrueFee(deployedSetToken.address)
let timeDeltaAccrue = (await streamingFeeModule.feeStates(deployedSetToken.address)).lastStreamingFeeTimestamp.sub(timeBeforeAccrue)
let feeConsumed = (await deployedSetToken.totalSupply()).sub(totalSupplyBeforeAccrue)
let feeExpected = totalSupplyBeforeAccrue.mul(ether(0.01)).div(ether(1)).mul(timeDeltaAccrue).div(BigNumber.from(365*60*60*24));
let feeRecipientBalance = await deployedSetToken.balanceOf(owner.address)
```

# Hardhat forked console
## Alchemy
- Spin out an alchemy node and fork mainnet onto local
```
npx hardhat node --fork https://eth-mainnet.alchemyapi.io/v2/h53guKI_UFOJlC1hjGkriV4Ggcz66rYo
```
- Then connect from a new terminal into localhost
```
npx hardhat console --network localhost
```
## Factories for deployment
- First import the `json` artifacts as in section `Initiate Contract Artifacts`
## Initiate some accounts
```
let owner = await ethers.getSigner()
let user = (await ethers.getSigners())[1]
let feeRecipient = (await ethers.getSigners())[2]
let {ether} = require("./utils/common/unitsUtils")
let { ADDRESS_ZERO, MAX_UINT_256 } = require( "./utils/constants");
let DEPLOYMENTS = require("./scripts/deployments").default
```
## Deploy Contracts
- Contract factories and deploy
```
let ControllerContract = await ethers.getContractFactory("Controller");
let IntegrationRegistryContract = await ethers.getContractFactory("IntegrationRegistry");
let  SetTokenCreatorContract = await ethers.getContractFactory("SetTokenCreator");
let BasicIssuanceModuleContract = await ethers.getContractFactory("BasicIssuanceModule");
let SingleIndexModuleContract = await ethers.getContractFactory("SingleIndexModule");
let TradeModuleContract = await ethers.getContractFactory("TradeModule");
let UniswapV2ExchangeAdapter = await ethers.getContractFactory("UniswapV2ExchangeAdapter");

let controller = await ControllerContract.deploy(feeRecipient.address);
let integrationRegistry = await IntegrationRegistryContract.deploy(controller.address);
let setTokenCreator = await SetTokenCreatorContract.deploy(controller.address);
let basicIssuanceModule = await BasicIssuanceModuleContract.deploy(controller.address);
let tradeModule = await TradeModuleContract.deploy(controller.address);

let uniswapV2ExchangeAdapter = await UniswapV2ExchangeAdapter.deploy(DEPLOYMENTS.mainnet.UniswapV2Router)
let sushiswapExchangeAdapter = await UniswapV2ExchangeAdapter.deploy(DEPLOYMENTS.mainnet.SushiswapRouter)
```
## Make sufficient funds for issuers
- Provide user with tokens needed to issue tokensets (WETH, MATIC, USDT)
```
let router = await ethers.getContractAt(UniswapV2RouterABI, DEPLOYMENTS.mainnet.UniswapV2Router)
let sushirouter = await ethers.getContractAt(UniswapV2RouterABI, DEPLOYMENTS.mainnet.SushiswapRouter)
let weth = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.WETH)
let matic = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.MATIC)
let usdt = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.USDT)
let dai = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.DAI)
await owner.sendTransaction({to: DEPLOYMENTS.mainnet.WETH, value: ether(15)})
await user.sendTransaction({to: DEPLOYMENTS.mainnet.WETH, value: ether(15)})
await router.swapETHForExactTokens(ether(20000), [DEPLOYMENTS.mainnet.WETH, DEPLOYMENTS.mainnet.MATIC], user.address, MAX_UINT_256, {value: ether(10)})
await router.swapETHForExactTokens(ether(20000), [DEPLOYMENTS.mainnet.WETH, DEPLOYMENTS.mainnet.DAI], user.address, MAX_UINT_256, {value: ether(10)})
await router.swapETHForExactTokens("1000000000", [DEPLOYMENTS.mainnet.WETH, DEPLOYMENTS.mainnet.USDT], user.address, MAX_UINT_256, {value: ether(1)})  // decimals = 6 // amount 1000 usdt


```
## Initialize contracts of set-protocol
- Deploy `SingleIndexModule` which is responsible for rebalancing
```
let singleIndexModule = await SingleIndexModuleContract.deploy(controller.address, DEPLOYMENTS.mainnet.WETH, router.address, ADDRESS_ZERO, ADDRESS_ZERO)
```
- Initialize controller
```
await controller.initialize([setTokenCreator.address], [basicIssuanceModule.address, tradeModule.address, singleIndexModule.address], [integrationRegistry.address], [0]);
```
- Add modules to integrationRegistry
```
await integrationRegistry.addIntegration(tradeModule.address, "UNISWAP", uniswapV2ExchangeAdapter.address)
await integrationRegistry.addIntegration(tradeModule.address, "SUSHISWAP", sushiswapExchangeAdapter.address)
await integrationRegistry.addIntegration(singleIndexModule.address, "UNISWAP", uniswapV2ExchangeAdapter.address)
```
- Create a Tokenset from Factory 
```
let tx1 = await setTokenCreator.create([DEPLOYMENTS.mainnet.WETH, DEPLOYMENTS.mainnet.MATIC], [ether(1), ether(1000)], [basicIssuanceModule.address, tradeModule.address], owner.address, "zk_idx1", "Z03")  // USDT seems not suited for set-protocol!!
let x = await tx1.wait()
let tokenSetAddress = x.events[1].args[0]
let deployedSetToken = await ethers.getContractAt(SetTokenABI, tokenSetAddress)
```
- Initialize Modules
```
await basicIssuanceModule.initialize(tokenSetAddress, ADDRESS_ZERO); 
await tradeModule.initialize(tokenSetAddress); 
```
## Issuing tokens
```
await weth.connect(user).approve(basicIssuanceModule.address, ether(1000000))
await matic.connect(user).approve(basicIssuanceModule.address, ether(100000000000))
await usdt.connect(user).approve(basicIssuanceModule.address, ether(100000000000))
await dai.connect(user).approve(basicIssuanceModule.address, ether(100000000000))
 await basicIssuanceModule.connect(user).issue(deployedSetToken.address, ether(3), user.address)
 (await deployedSetToken.balanceOf(user.address)).toString()
```
## Trade tokens 
- You can use `SUSHISWAP` instead of `UNISWAP` with same configs.
- This scenario can be tested on forked mainnet by running tests in `test/zokyo/trader.spec.ts`.
  - Firstly, start a new hardhat node forking mainnet
```
npx hardhat node --fork https://eth-mainnet.alchemyapi.io/v2/h53guKI_UFOJlC1hjGkriV4Ggcz66rYo
```
-
  - Secondly, run the relevant test for trading module
```
FORKED=true npx hardhat test --network localhost test/zokyo/trader.spec.ts
```
## Rebalance on mainnet 
- First assign addresses and imports then deploy contracts
- Make sufficient funds for issuers
- Initialize Controller and add relevant integration
- Deploy a new tokenset, ensure you have enough `MATIC` and `USDT` and initialize SingleIndexModule
```
let tx = await setTokenCreator.create([DEPLOYMENTS.mainnet.MATIC, DEPLOYMENTS.mainnet.USDT], [ether(1), ether(2)], [basicIssuanceModule.address, tradeModule.address, singleIndexModule.address], owner.address, "zk_idx1", "Z03")
let x = await tx.wait()
let tokenSetAddress = x.events[1].args[0]
let deployedSetToken = await ethers.getContractAt(SetTokenABI, tokenSetAddress)
await singleIndexModule.initialize(deployedSetToken.address)
```
- issue tokens 
```
 await basicIssuanceModule.connect(user).issue(deployedSetToken.address, ether(3), user.address)
 ```
- take steps to rebalance
```
await singleIndexModule.updateAnyoneTrade(true);
await singleIndexModule.startRebalance([], [], [ether(1.4), ether(0.9)], ether(1));
await singleIndexModule.setExchanges([DEPLOYMENTS.mainnet.DAI, DEPLOYMENTS.mainnet.MATIC], [1,1])
await singleIndexModule.setTradeMaximums([dai.address, matic.address], [ether(20), ether(20)])
await singleIndexModule.connect(user).trade(dai.address)
```
- ensure trading went successful by checking weth balance
```
(await weth.balanceOf(deployedSetToken.address)).toString()
```
- Now complete the trade on other components and you can see weth balance decreased
```
await singleIndexModule.connect(user).trade(matic.address)
(await weth.balanceOf(deployedSetToken.address)).toString()
```
- Check components balances
```
(await matic.balanceOf(deployedSetToken.address)).toString()
(await dai.balanceOf(deployedSetToken.address)).toString()
```



