import hre, { ethers } from "hardhat";
import { ADDRESS_ZERO, MAX_UINT_256 } from "../utils/constants";
import { BasicIssuanceModule, 
  Controller, 
  SetTokenCreator, 
  StandardTokenMock, 
  UniswapV2ExchangeAdapter, 
  TradeModule, 
  IntegrationRegistry,
  StreamingFeeModule,
  SingleIndexModule
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
import { StreamingFeeModule__factory } from "@typechain/factories/StreamingFeeModule__factory";
import { SingleIndexModule__factory } from "@typechain/factories/SingleIndexModule__factory";
import { HardhatNetworkConfig  } from "hardhat/types";

interface HreDto extends HardhatNetworkConfig{
  uniswapRouterAddress: string,
  weth: string
}


async function main() {
    const netConfig = hre.network.config as HreDto;
    const deployer: SignerWithAddress = (await ethers.getSigners())[0];
  
    console.log("Deploying contracts with the account:", deployer.address);
  
    console.log("Account balance:", (await deployer.getBalance()).toString());
  
    const ControllerFactory: Controller__factory = await ethers.getContractFactory("Controller");
    const SetTokenCreatorFactory: SetTokenCreator__factory = await ethers.getContractFactory("SetTokenCreator");
    const IntegrationRegistryFactory: IntegrationRegistry__factory = await ethers.getContractFactory("IntegrationRegistry");
    const BasicIssuanceModuleFactory: BasicIssuanceModule__factory = await ethers.getContractFactory("BasicIssuanceModule");
    const TradeModuleFactory: TradeModule__factory = await ethers.getContractFactory("TradeModule");
    const StreamingFeeModuleFactory: StreamingFeeModule__factory  = await ethers.getContractFactory("StreamingFeeModule");
    const SingleIndexModuleFactory: SingleIndexModule__factory = await ethers.getContractFactory("SingleIndexModule");
    const UniswapV2ExchangeAdapterFactory: UniswapV2ExchangeAdapter__factory = await ethers.getContractFactory("UniswapV2ExchangeAdapter") ;

    let controller: Controller = await ControllerFactory.deploy(deployer.address);
    console.log("Controller address: ", controller.address);

    let intergrationRegistry: IntegrationRegistry = await IntegrationRegistryFactory.deploy(controller.address);
    console.log("integrationRegistry address: ", intergrationRegistry.address);

    let setTokenCreator: SetTokenCreator = await SetTokenCreatorFactory.deploy(controller.address);
    console.log("SetTokenCreator address: ", setTokenCreator.address);

    let basicIssuanceModule: BasicIssuanceModule = await BasicIssuanceModuleFactory.deploy(controller.address);
    console.log("BasicIssuanceModule address: ", basicIssuanceModule.address);

    let uniswapV2ExchangeAdapter: UniswapV2ExchangeAdapter = await UniswapV2ExchangeAdapterFactory.deploy(netConfig.uniswapRouterAddress);
    console.log("UniswapV2ExchangeAdapter address: ", uniswapV2ExchangeAdapter.address);

    let tradeModule: TradeModule = await TradeModuleFactory.deploy(controller.address);
    console.log("TradeModule address: ", tradeModule.address);

    let streamingFeeModule: StreamingFeeModule = await StreamingFeeModuleFactory.deploy(controller.address);
    console.log("StreamingFeeModule address: ", streamingFeeModule.address);

    // TODO:   make sure things are well on rinkeby (commit on other branch local/dev-4)
    let singleIndexModule: SingleIndexModule = await SingleIndexModuleFactory.deploy(
      controller.address, 
      netConfig.weth,
      netConfig.uniswapRouterAddress, 
      ADDRESS_ZERO, 
      ADDRESS_ZERO
    );
    console.log("SingleIndexModule address: ", singleIndexModule.address);

    let uniswapRouterV2: any = await ethers.getContractAt(UniswapV2RouterABI, netConfig.uniswapRouterAddress);
    console.log("uniswapRouter V2: ", uniswapRouterV2.address);

}

  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });