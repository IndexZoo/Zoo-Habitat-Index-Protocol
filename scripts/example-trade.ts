import hre, { ethers } from "hardhat";
import { ADDRESS_ZERO, MAX_UINT_256 } from "../utils/constants";
import { BasicIssuanceModule, 
  Controller, 
  SetTokenCreator, 
  UniswapV2ExchangeAdapter, 
  TradeModule, 
  IntegrationRegistry,
  SetToken,
} from "@utils/contracts";

import {abi as UniswapV2RouterABI } from "../artifacts/contracts/interfaces/external/IUniswapV2Router.sol/IUniswapV2Router.json";
import {abi as ERC20ABI} from "../artifacts/@openzeppelin/contracts/token/ERC20/IERC20.sol/IERC20.json";
import {abi as CONTROLLERABI} from "../artifacts/contracts/protocol/Controller.sol/Controller.json";
import {abi as SETTOKENABI} from "../artifacts/contracts/protocol/SetToken.sol/SetToken.json";
import {abi as BASICISSUANCEMODULEABI} from "../artifacts/contracts/protocol/modules/BasicIssuanceModule.sol/BasicIssuanceModule.json";
import {abi as TRADEMODULEABI} from "../artifacts/contracts/protocol/modules/TradeModule.sol/TradeModule.json";


import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { HardhatNetworkConfig  } from "hardhat/types";
import { ERC20 } from "@typechain/ERC20";
import { ether } from "../utils/common/unitsUtils";
import DEPLOYMENTS from "./deployments";

interface HreDto extends HardhatNetworkConfig{
  uniswapRouterAddress: string,
  weth: string,
  wmatic: string,
  dai: string
}



async function tradeScenario() {
    const netConfig = hre.network.config as HreDto;
    const deployer: SignerWithAddress = (await ethers.getSigners())[0];

    let setToken = await ethers.getContractAt(SETTOKENABI, DEPLOYMENTS.mainnet2.DAIMTC) as SetToken;
    let wmaticToken = await ethers.getContractAt(ERC20ABI, netConfig.wmatic) as ERC20;
    let daiToken = await ethers.getContractAt(ERC20ABI, netConfig.dai) as ERC20;
    let basicIssuanceModule = await ethers.getContractAt(BASICISSUANCEMODULEABI, DEPLOYMENTS.mainnet2.BasicIssuanceModule) as BasicIssuanceModule;
    let tradeModule = await ethers.getContractAt(TRADEMODULEABI, DEPLOYMENTS.mainnet2.TradeModule) as TradeModule;

    await wmaticToken.approve(basicIssuanceModule.address, ether(0.1));
    await daiToken.approve(basicIssuanceModule.address, ether(0.1));

    // await basicIssuanceModule.issue(setToken.address, ether(1), deployer.address);  // paid ether(0.001)

    await tradeModule.trade(
      setToken.address,
      "SUSHI",
      wmaticToken.address,
      ether(5).div(10000),   // 0.0005 
      daiToken.address,
      ether(1).div(10000),   //  0.0001
      "0x"
    );
    console.log("setToken Balance of issuer: ", (await setToken.balanceOf(deployer.address)).toString());
}

async function main() {
   await tradeScenario();

}

  
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });