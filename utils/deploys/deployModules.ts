import { Signer } from "ethers";

import {
  AaveLeverageModule,
  BasicIssuanceModule,
  GeneralIndexModule,
  SingleIndexModule,
  StreamingFeeModule,
  TradeModule,
  WrapModule,
  WrapModuleV2
} from "../contracts";
import { Address } from "../types";

import { AaveLeverageModule__factory } from "../../typechain/factories/AaveLeverageModule__factory";
import { BasicIssuanceModule__factory } from "../../typechain/factories/BasicIssuanceModule__factory";
import { GeneralIndexModule__factory } from "../../typechain/factories/GeneralIndexModule__factory";
import { SingleIndexModule__factory } from "../../typechain/factories/SingleIndexModule__factory";
import { StreamingFeeModule__factory } from "../../typechain/factories/StreamingFeeModule__factory";
import { TradeModule__factory } from "../../typechain/factories/TradeModule__factory";
import { WrapModule__factory } from "../../typechain/factories/WrapModule__factory";
import { WrapModuleV2__factory } from "../../typechain/factories/WrapModuleV2__factory";

export default class DeployModules {
  private _deployerSigner: Signer;

  constructor(deployerSigner: Signer) {
    this._deployerSigner = deployerSigner;
  }

  public async deployBasicIssuanceModule(controller: Address): Promise<BasicIssuanceModule> {
    return await new BasicIssuanceModule__factory(this._deployerSigner).deploy(controller);
  }

  public async getBasicIssuanceModule(basicIssuanceModule: Address): Promise<BasicIssuanceModule> {
    return await new BasicIssuanceModule__factory(this._deployerSigner).attach(basicIssuanceModule);
  }

  public async deployStreamingFeeModule(controller: Address): Promise<StreamingFeeModule> {
    return await new StreamingFeeModule__factory(this._deployerSigner).deploy(controller);
  }

  public async getStreamingFeeModule(streamingFeeModule: Address): Promise<StreamingFeeModule> {
    return await new StreamingFeeModule__factory(this._deployerSigner).attach(streamingFeeModule);
  }

  public async deployTradeModule(controller: Address): Promise<TradeModule> {
    return await new TradeModule__factory(this._deployerSigner).deploy(controller);
  }

  public async deployWrapModule(controller: Address, weth: Address): Promise<WrapModule> {
    return await new WrapModule__factory(this._deployerSigner).deploy(controller, weth);
  }

  public async deploySingleIndexModule(
    controller: Address,
    weth: Address,
    uniswapRouter: Address,
    sushiswapRouter: Address,
    balancerProxy: Address
  ): Promise<SingleIndexModule> {
    return await new SingleIndexModule__factory(this._deployerSigner).deploy(
      controller,
      weth,
      uniswapRouter,
      sushiswapRouter,
      balancerProxy,
    );
  }

  public async deployGeneralIndexModule(
    controller: Address,
    weth: Address
  ): Promise<GeneralIndexModule> {
    return await new GeneralIndexModule__factory(this._deployerSigner).deploy(
      controller,
      weth
    );
  }

  public async deployAaveLeverageModule(
    controller: Address,
    lendingPoolAddressesProvider: Address,
    libraryName: string,
    libraryAddress: Address
  ): Promise<AaveLeverageModule> {
    return await new AaveLeverageModule__factory(
      // @ts-ignore
      {
        [libraryName]: libraryAddress,
      },
      this._deployerSigner
    ).deploy(
      controller,
      lendingPoolAddressesProvider
    );
  }

  public async deployWrapModuleV2(controller: Address, weth: Address): Promise<WrapModuleV2> {
    return await new WrapModuleV2__factory(this._deployerSigner).deploy(controller, weth);
  }
}