import { BigNumber } from "@ethersproject/bignumber";
import { StandardTokenMock } from "@typechain/StandardTokenMock";
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import { UniswapFixture } from "@utils/fixtures";
import { getUniswapFixture } from "@utils/test";
import { Account } from "@utils/test/types";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import { ethers } from "hardhat";
import DEPLOYMENTS from "../../scripts/deployments";
import {abi as UniswapV2RouterABI}  from "../../external/abi/uniswap/v2/UniswapV2Router02.json";
import { UniswapV2Router02 } from "@typechain/UniswapV2Router02";

chai.use(solidity);

chai.Assertion.addMethod('approx', function (bn: BigNumber, delta = 0.02) {
  var obj = this._obj as BigNumber;
  let deltabn = bn.mul(ether(delta)).div(ether(1));
  
  this.assert(
        bigNumberCloseTo(obj, bn, deltabn)
    , `expected ${obj.toString()} to be in between ${bn.sub(deltabn).toString()} ${bn.add(deltabn).toString()} but got ${obj.toString()}`
    , `expected ${obj.toString()} not in between ${bn.sub(deltabn).toString()} ${bn.add(deltabn).toString()}`
    , bn        // expected
    , obj   // actual
  );
});

// HARDHAT / WAFFLE
const getWaffleExpect = (): Chai.ExpectStatic => {
  return chai.expect ;
};


const bigNumberCloseTo = (a: BigNumber, n: BigNumber, delta = ether(0.1)) => 
         a.gt(n)? a.sub(n).lte(delta) : n.sub(a).lte(delta);


const deployMockTokens = async (factories: any, owner: Account) => {
      let mockWeth: StandardTokenMock;
      let mockDai: StandardTokenMock;
      let mockBtc: StandardTokenMock ; 
      let mockGenToken: StandardTokenMock;
      mockWeth = await factories.StandardTokenMockContract.deploy(owner.address, ether(100000000), "MockWeth", "METH", 18);
      mockBtc = await factories.StandardTokenMockContract.deploy(owner.address, ether(1000000), "MockBtc", "MBTC", 8);
      mockGenToken =  await factories.StandardTokenMockContract.deploy(owner.address, ether(100000000), "MockGen", "GEN", 18); 
      mockDai =  await factories.StandardTokenMockContract.deploy(owner.address, ether(1000000000), "MockDai", "MDAI", 18);       
      return {
            mockWeth,
            mockBtc,
            mockGenToken,
            mockDai,
      }
 
}

const initUniswapRouter = async(owner: Account, weth: string, dai: string, btc: string): Promise<UniswapV2Router02> => {
      let uniswapRouter: UniswapV2Router02;

      if (process.env.FORKED == "true") {
            uniswapRouter =  await ethers.getContractAt(UniswapV2RouterABI, DEPLOYMENTS.mainnet.UniswapV2Router) as UniswapV2Router02;
      } else {
         let uniswapFixture =  getUniswapFixture(owner.address);
        await uniswapFixture.initialize(
          owner,
          weth,
          btc,
          dai
        );
        uniswapRouter = uniswapFixture.router;
      }
      return uniswapRouter;
}

const deployContracts = async (
            factories: any, 
            owner: Account, 
            feeRecipient: Account, 
            wethAddress: string, 
            usdcAddress: string, 
            router: string,
            clearingHouse: string,
            amm: string
      ) => {
      let controller = await factories.ControllerContract.deploy(feeRecipient.address);
      let integrationRegistry = await factories.IntegrationRegistryContract.deploy(controller.address);
      let setTokenCreator = await factories.SetTokenCreatorContract.deploy(controller.address);
      let basicIssuanceModule = await factories.BasicIssuanceModuleContract.deploy(controller.address);
      let uniswapV2ExchangeAdapter = await factories.UniswapV2ExchangeAdapter.deploy(router);
      let tradeModule = await factories.TradeModuleContract.deploy(controller.address);
      let singleIndexModule  = await factories.SingleIndexModuleContract.deploy(controller.address, 
            wethAddress, 
            router, 
            ADDRESS_ZERO,   // Testing only on uniswap
            ADDRESS_ZERO );
      let streamingFeeModule = await factories.StreamingFeeModuleContract.deploy(controller.address);
      let perpetualProtocolModule = await factories.PerpetualProtocolModuleContract.deploy(
            controller.address,
            clearingHouse,
            amm,
            usdcAddress 
      )

      return {
            controller,
            integrationRegistry,
            setTokenCreator,
            basicIssuanceModule,
            uniswapV2ExchangeAdapter,
            tradeModule,
            singleIndexModule,
            streamingFeeModule,
            perpetualProtocolModule
      }
}

const loadFactories = async () => {
      let StandardTokenMockContract = await ethers.getContractFactory("StandardTokenMock");
      let ControllerContract = await ethers.getContractFactory("Controller");
      let IntegrationRegistryContract = await ethers.getContractFactory("IntegrationRegistry");
      let SetTokenCreatorContract = await ethers.getContractFactory("SetTokenCreator");
      let BasicIssuanceModuleContract = await ethers.getContractFactory("BasicIssuanceModule");
      let UniswapV2ExchangeAdapterForRebalancing = await ethers.getContractFactory("UniswapV2ExchangeAdapterForRebalancing");
      let UniswapV2ExchangeAdapter = await ethers.getContractFactory("UniswapV2ExchangeAdapter");
      let TradeModuleContract = await ethers.getContractFactory("TradeModule");
      let RebalanceModuleContract = await ethers.getContractFactory("RebalanceModule");
      let SingleIndexModuleContract = await ethers.getContractFactory("SingleIndexModule");
      let StreamingFeeModuleContract = await ethers.getContractFactory("StreamingFeeModule");
      let PerpetualProtocolModuleContract = await ethers.getContractFactory("PerpetualProtocolModule");

      return {
        StandardTokenMockContract, 
          ControllerContract, 
        IntegrationRegistryContract, 
        SetTokenCreatorContract, 
        BasicIssuanceModuleContract,
        UniswapV2ExchangeAdapterForRebalancing,
        UniswapV2ExchangeAdapter,
        TradeModuleContract, 
        RebalanceModuleContract,
        SingleIndexModuleContract,
        StreamingFeeModuleContract,
        PerpetualProtocolModuleContract
    }
}

const initUniswap = async (uniswapFixture: UniswapFixture, ERC20s: any, owner: Account) => {
      await uniswapFixture.initialize(
        owner,
        ERC20s.mockWeth.address,
        ERC20s.mockBtc.address,
        ERC20s.mockGenToken.address
      );

      await ERC20s.mockWeth.connect(owner.wallet).approve(uniswapFixture.router.address, ether(1000));
      await ERC20s.mockDai.connect(owner.wallet).approve(uniswapFixture.router.address, ether(4000000));
      await uniswapFixture.router.addLiquidity(
            ERC20s.mockWeth.address,
            ERC20s.mockDai.address,
            ether(1000),
            ether(4000000),
            ether(995),
            ether(3995000),
            owner.address,
            MAX_UINT_256
      );
}

const loadTokens = async (ownerAddress: string) => {
      let StandardTokenMockContract = await ethers.getContractFactory("StandardTokenMock");

      let mockWeth = await StandardTokenMockContract.deploy(ownerAddress, ether(1000000), "MockWeth", "METH", 18);
      let mockBtc = await StandardTokenMockContract.deploy(ownerAddress, ether(1000000), "MockBtc", "MBTC", 8);
      let mockGenToken =  await StandardTokenMockContract.deploy(ownerAddress, ether(1000000), "MockGen", "GEN", 18); 
      let mockDai =  await StandardTokenMockContract.deploy(ownerAddress, ether(10000000), "MockDai", "MDAI", 18);
      return {mockWeth, mockBtc, mockGenToken, mockDai};
}

export {
    bigNumberCloseTo,
    loadFactories,
    loadTokens,
    initUniswap,
    initUniswapRouter,
    deployMockTokens,
    deployContracts,
    getWaffleExpect
};