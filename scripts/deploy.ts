import { ethers } from "hardhat";
import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import { BasicIssuanceModule, 
  Controller, 
  SetTokenCreator, 
  StandardTokenMock, 
  UniswapV2ExchangeAdapter, 
  TradeModule, 
  IntegrationRegistry
} from "@utils/contracts";

import {abi as UniswapV2RouterABI } from "../artifacts/contracts/interfaces/external/IUniswapV2Router.sol/IUniswapV2Router.json";

import { Controller__factory } from "@typechain/factories/Controller__factory";
import { SetTokenCreator__factory } from "@typechain/factories/SetTokenCreator__factory";
import { StandardTokenMock__factory } from "@typechain/factories/StandardTokenMock__factory";
import { BasicIssuanceModule__factory } from "@typechain/factories/BasicIssuanceModule__factory";
import { UniswapV2ExchangeAdapter__factory } from "@typechain/factories/UniswapV2ExchangeAdapter__factory";
import { UniswapFixture } from "@utils/fixtures";
import { TradeModule__factory } from "@typechain/factories/TradeModule__factory";
import { IntegrationRegistry__factory } from "@typechain/factories/IntegrationRegistry__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { UniswapV2Router02, UniswapV2Router02Interface } from "@typechain/UniswapV2Router02";

const UNISWAPROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

async function main() {
    const deployer: SignerWithAddress = (await ethers.getSigners())[0];
  
    console.log("Deploying contracts with the account:", deployer.address);
  
    console.log("Account balance:", (await deployer.getBalance()).toString());
  
const ControllerFactory: Controller__factory = await ethers.getContractFactory("Controller");
const SetTokenCreatorFactory: SetTokenCreator__factory = await ethers.getContractFactory("SetTokenCreator");
const IntegrationRegistryFactory: IntegrationRegistry__factory = await ethers.getContractFactory("IntegrationRegistry");
const BasicIssuanceModuleFactory: BasicIssuanceModule__factory = await ethers.getContractFactory("BasicIssuanceModule");
const TradeModuleFactory: TradeModule__factory = await ethers.getContractFactory("TradeModule");
const UniswapV2ExchangeAdapterFactory: UniswapV2ExchangeAdapter__factory = await ethers.getContractFactory("UniswapV2ExchangeAdapter") ;

let controller: Controller = await ControllerFactory.deploy(deployer.address);
let intergrationRegistry: IntegrationRegistry = await IntegrationRegistryFactory.deploy(controller.address);
let setTokenCreator: SetTokenCreator = await SetTokenCreatorFactory.deploy(controller.address);
let basicIssuanceModule: BasicIssuanceModule = await BasicIssuanceModuleFactory.deploy(controller.address);
let uniswapV2ExchangeAdapter: UniswapV2ExchangeAdapter = await UniswapV2ExchangeAdapterFactory.deploy(UNISWAPROUTER_ADDRESS);
let tradeModule: TradeModule = await TradeModuleFactory.deploy(controller.address);

let uniswapRouterV2: any = await ethers.getContractAt(UniswapV2RouterABI, UNISWAPROUTER_ADDRESS);
  
console.log("Controller address:", controller.address);
console.log("integrationRegistry address:", intergrationRegistry.address);
console.log("SetTokenCreator address:", setTokenCreator.address);
console.log("BasicIssuanceModule address:", basicIssuanceModule.address);
console.log("UniswapV2ExchangeAdapter address:", uniswapV2ExchangeAdapter.address);
console.log("TradeModule address:", tradeModule.address);
console.log("uniswapRouter V2:\n", uniswapRouterV2)

}
  
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });