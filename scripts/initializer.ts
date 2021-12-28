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
} from "../utils/contracts";

import {abi as UniswapV2RouterABI } from "../artifacts/contracts/interfaces/external/IUniswapV2Router.sol/IUniswapV2Router.json";

import { Controller__factory } from "../typechain/factories/Controller__factory";
import { SetTokenCreator__factory } from "../typechain/factories/SetTokenCreator__factory";
import { BasicIssuanceModule__factory } from "../typechain/factories/BasicIssuanceModule__factory";
import { UniswapV2ExchangeAdapter__factory } from "../typechain/factories/UniswapV2ExchangeAdapter__factory";
import { TradeModule__factory } from "../typechain/factories/TradeModule__factory";
import { IntegrationRegistry__factory } from "../typechain/factories/IntegrationRegistry__factory";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { StreamingFeeModule__factory } from "../typechain/factories/StreamingFeeModule__factory";
import { SingleIndexModule__factory } from "../typechain/factories/SingleIndexModule__factory";
import { HardhatNetworkConfig  } from "hardhat/types";

interface HreDto extends HardhatNetworkConfig{
  uniswapRouterAddress: string,
  weth: string
}

const Chains = {
  rinkeby: {
    controller: "0xA81e0eF7283835CdE87fAbc3b7681aA133a22c11",
    basicIssuanceModule: "0xc1a58CB54265FC43355B415F3eEeBa9b9492fA24",
    setTokenCreator: "0xca1B47e2aC0F6552Ccf9f82EFa6DF45b45B1CC1B",
    integrationRegistry: "0x22451e76C7eC376bedd06aEC3Dc69dE23690b766",
    streamingFeeModule: "0x17623BA980E04A2295C91a5099a0557FD22D4e86",
    tradeModule: "0x013F3e38f2027d6c8A17Db5699c6B76AAC973E68",
    singleIndexModule: "0x64723Ca0Fae4f0f24feb6148a63942e4F79D12E6",
    uniswapV2ExchangeAdapter:  "0x636Fec20fD5148Db54a373f4928e2a7f7aDb0a39",
  },
  polygon: {
    controller: "0x52B6554bF4F57589172dc7aB08957fb52B1b9Bc6",
    basicIssuanceModule: "0x507723DfdD9eE51f06D1E3E74585f80604766875",
    setTokenCreator: "0x20c4F9a8086125cbE8490F7493F3B506d4B7043e",
    integrationRegistry: "0x172492D142C2749A5dA80a50a360cb2224c55Cda",
    streamingFeeModule: "0xD4651d83438d6834248A9154b001A86186DC0EaE",
    tradeModule: "0x01159F31523bF949Ca5b9bfFb493245810059452",
    singleIndexModule: "0x0cBa25d10b6D2B3bF524dd7490bb3943C0b575dA",
    uniswapV2ExchangeAdapter:  "0x9fb8E1A9E38b16E9404CBB82a0B9e36531309484",
  }
}

const Contracts = Chains.polygon;

async function main() {
    const netConfig = hre.network.config as HreDto;
    const deployer: SignerWithAddress = (await ethers.getSigners())[0];
  
    console.log("Deploying contracts with the account:", deployer.address);
  
    console.log("Account balance:", (await deployer.getBalance()).toString());
  
    let controller: Controller = await ethers.getContractAt(Controller__factory.abi, Contracts.controller) as Controller ;
    let setTokenCreator: SetTokenCreator = await ethers.getContractAt(SetTokenCreator__factory.abi, Contracts.setTokenCreator) as SetTokenCreator ;
    let integrationRegistry: IntegrationRegistry = await ethers.getContractAt(IntegrationRegistry__factory.abi, Contracts.integrationRegistry) as IntegrationRegistry;
    let basicIssuanceModule: BasicIssuanceModule = await ethers.getContractAt(BasicIssuanceModule__factory.abi, Contracts.basicIssuanceModule) as BasicIssuanceModule ;
    let tradeModule: TradeModule = await ethers.getContractAt(TradeModule__factory.abi, Contracts.tradeModule) as TradeModule ;
    let streamingFeeModule: StreamingFeeModule = await ethers.getContractAt(StreamingFeeModule__factory.abi, Contracts.streamingFeeModule) as StreamingFeeModule;
    let singleIndexModule: SingleIndexModule = await ethers.getContractAt(SingleIndexModule__factory.abi, Contracts.singleIndexModule) as SingleIndexModule;
    let uniswapV2ExchangeAdapter: UniswapV2ExchangeAdapter = await ethers.getContractAt(UniswapV2ExchangeAdapter__factory.abi, Contracts.uniswapV2ExchangeAdapter) as UniswapV2ExchangeAdapter;

    await controller.initialize(
        [setTokenCreator.address], 
        [basicIssuanceModule.address, tradeModule.address, singleIndexModule.address, streamingFeeModule.address], 
        [integrationRegistry.address], [0]
    );
    await integrationRegistry.addIntegration(tradeModule.address, "UNISWAP_LIKE", uniswapV2ExchangeAdapter.address);
    await integrationRegistry.addIntegration(singleIndexModule.address, "UNISWAP_LIKE", uniswapV2ExchangeAdapter.address)
}


  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });