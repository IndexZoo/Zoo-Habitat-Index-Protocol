import "module-alias/register";
import "../ztypes";

import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256, ZERO } from "@utils/constants";
import { 
  IntegrationRegistry,
  StandardTokenMock,
    UniswapV2Router02 
} from "@utils/contracts";
import {
  getAccounts,
    getAaveV2Fixture,
    getUniswapFixture,//for aave
} from "@utils/test/index";
import {
  getWaffleExpect
} from "@utils/test/helpers";
import { ethers } from "hardhat";
import { bitcoin, ether } from "@utils/common/unitsUtils";
import { abi as ZooTokenABI } from "../../artifacts/contracts/protocol/ZooToken.sol/ZooToken.json";
//for aave
import {  AaveV2Fixture } from "@utils/fixtures";

import {BigNumber, Contract} from "ethers";
import { WETH9__factory } from "@typechain/factories/WETH9__factory";
import { L3xIssuanceModule } from "@typechain/L3xIssuanceModule";
import { ZooToken } from "@typechain/ZooToken";
import { ZooTokenCreator } from "@typechain/ZooTokenCreator";
import { ZooStreamingFeeModule } from "@typechain/ZooStreamingFeeModule";
import { Controller } from "@typechain/Controller";
import { UniswapV2Router02Mock } from "@typechain/UniswapV2Router02Mock";
import { L3xRebalanceModule } from "@typechain/L3xRebalanceModule";


const INTEGRATION_REGISTRY_RESOURCE_ID = 0;
const INTEGRATION_REGISTRY_LEND_RESOURCE_ID  = 1;
const AAVE_ADAPTER_NAME = "AAVE";
const UNISWAP_ADAPTER_NAME = "UNISWAP";


const initUniswapRouter = async (owner: Account, weth:  Contract, dai:  StandardTokenMock, btc: StandardTokenMock): Promise<UniswapV2Router02> => {
      let router: UniswapV2Router02;

         let uniswapFixture =  getUniswapFixture(owner.address);
        await uniswapFixture.initialize(
          owner,
          weth.address,
          btc.address,
          dai.address
        );
        router = uniswapFixture.router;
      await  weth.approve(router.address, MAX_UINT_256);
      await dai.approve(router.address, MAX_UINT_256);
      await router.addLiquidity(weth.address, dai.address, ether(4000), ether(4000000), ether(3990), ether(3900000), owner.address, MAX_UINT_256);
      return router;
}

const pMul = (b: BigNumber, x: number) => {
  return b.mul(ether(x)).div(ether(1));
}

const initUniswapMockRouter = async(owner: Account, weth:  Contract, dai:  StandardTokenMock, btc: StandardTokenMock): Promise<UniswapV2Router02Mock> => {
      let router: UniswapV2Router02Mock;
      router = await (await ethers.getContractFactory("UniswapV2Router02Mock")).deploy();
      await  weth.approve(router.address, MAX_UINT_256);
      await dai.approve(router.address, MAX_UINT_256);

      await router.addLiquidity(weth.address, dai.address, ether(500), ether(500000), ether(499), ether(499000), owner.address, MAX_UINT_256);
    
      return router;
}

interface Accounts {
  owner: Account;
  protocolFeeRecipient: Account;
  mockUser: Account;
  mockSubjectModule: Account;
  bob: Account;
  alice: Account;
  oscar: Account;
  others: Account[];
}

interface Tokens {
  weth: Contract;
  mockDai: StandardTokenMock;
  mockBtc: StandardTokenMock;
}

interface Contracts {
  controller: Controller;
  zooToken: ZooToken;
  rebalanceModule: L3xRebalanceModule;
  creator: ZooTokenCreator;
  integrator: IntegrationRegistry;
  streamingFee: ZooStreamingFeeModule;
}


class Context {
  public accounts= <Accounts>{};
  public tokens = <Tokens> {};
  public ct = <Contracts> {};
  public zoos: ZooToken[] = [];

  public aaveFixture: AaveV2Fixture;
  public subjectModule: L3xIssuanceModule;
  public router: UniswapV2Router02;
  public mockRouter: UniswapV2Router02Mock;

  /**
   * @dev creates Zoo Leverage Token via a contract factory
   */
  public async createZooToken(sideIsBull: boolean = true): Promise<void> {
      const tx =  await this.ct.creator.create(
        [this.tokens.mockDai.address, this.tokens.weth.address],
        sideIsBull? [ether(2), ether(1)]: [ether(1), ether(2)],
        [this.subjectModule.address, this.ct.streamingFee.address, this.ct.rebalanceModule.address], 
        this.accounts.owner.address, 
        "eth long", 
        "BULL"
      );
      const receipt = await tx.wait();
      const event = receipt.events?.find(p => p.event == "ZooTokenCreated");
      const tokensetAddress = event? event.args? event.args[0]:"":"";
      let deployedZooToken =  await ethers.getContractAt(ZooTokenABI, tokensetAddress);
      this.zoos.push(deployedZooToken as ZooToken);


      await this.subjectModule.initialize(deployedZooToken.address);
      await this.ct.streamingFee.initialize(
        deployedZooToken.address,
        {
          feeRecipient: this.accounts.protocolFeeRecipient.address,
          maxStreamingFeePercentage: ether(0.25),  // 25%
          streamingFeePercentage: ether(0.01),     // 1%
          lastStreamingFeeTimestamp: ether(0)      // Timestamp is overriden 
        }
      );
      await this.ct.rebalanceModule.initialize(deployedZooToken.address);
  }

  public async redeemLoop(doRedeem: Function, account: Account, zToken: ZooToken  ): Promise<void> {
        let accountZooBalance:BigNumber;
        let wethZooBalance:BigNumber;
        let redeemAmount: BigNumber;
        let c = 0; // general safety to break loops
        do{
          if(c++ > 10) break;
          accountZooBalance = await zToken.balanceOf(account.address);
          wethZooBalance = await this.tokens.weth.balanceOf(zToken.address);
          redeemAmount = accountZooBalance > wethZooBalance.mul(90).div(100)? 
             wethZooBalance.mul(90).div(100): MAX_UINT_256;
          await doRedeem(account, redeemAmount);
        } while(redeemAmount !== MAX_UINT_256)
  }

  public async issueZoos(zoo: ZooToken, amount: BigNumber, price: BigNumber, to: Account): Promise<void> {
       await this.tokens.mockDai.mint(to.address, amount);
       await this.tokens.mockDai.connect(to.wallet).approve(this.subjectModule.address, amount);
       await this.subjectModule.connect(to.wallet).issue(zoo.address, to.address, amount, price,  985);
  }

  public async configureZoo(zoo: ZooToken, amountPerUnitCollateral: BigNumber): Promise<void> {
    await this.subjectModule.setConfigForToken(
      zoo.address, 
      {
        lender: this.aaveFixture.lendingPool.address,
        router: this.router.address,
        addressesProvider: this.aaveFixture.lendingPoolAddressesProvider.address,
        amountPerUnitCollateral
      }
    )
  }

  public async configureRebalancer(zoo: ZooToken, amountPerUnitCollateral: BigNumber): Promise<void> {
    await this.ct.rebalanceModule.setConfigForToken(
      zoo.address, 
      {
        lender: this.aaveFixture.lendingPool.address,
        router: this.router.address,
        addressesProvider: this.aaveFixture.lendingPoolAddressesProvider.address,
        amountPerUnitCollateral
      }
    )
  }

  public async configZooWithMockRouter(
    zoo: ZooToken, 
    amountPerUnitCollateral: BigNumber = ether(0.8)
  ): Promise<void> {
    await this.ct.integrator.removeIntegration(
      this.subjectModule.address, 
      UNISWAP_ADAPTER_NAME
    );
      let mockUniswapProtocolAdapter = await (await ethers.getContractFactory("UniswapV2ExchangeAdapterV3")).deploy(
        this.mockRouter.address 
      );
    await this.ct.integrator.addIntegration(
      this.subjectModule.address,
      UNISWAP_ADAPTER_NAME,
      mockUniswapProtocolAdapter.address
    )
    await this.subjectModule.setConfigForToken(
      zoo.address, 
      {
        lender: this.aaveFixture.lendingPool.address,
        router: this.mockRouter.address,
        addressesProvider: this.aaveFixture.lendingPoolAddressesProvider.address,
        amountPerUnitCollateral
      }
    )
  }


  public async configRebalancerWithMockRouter(
    zoo: ZooToken, 
    amountPerUnitCollateral: BigNumber = ether(0.8)
  ): Promise<void> {
    await this.ct.integrator.removeIntegration(
      this.ct.rebalanceModule.address, 
      UNISWAP_ADAPTER_NAME
    );
      let mockUniswapProtocolAdapter = await (await ethers.getContractFactory("UniswapV2ExchangeAdapterV3")).deploy(
        this.mockRouter.address 
      );
    await this.ct.integrator.addIntegration(
      this.ct.rebalanceModule.address,
      UNISWAP_ADAPTER_NAME,
      mockUniswapProtocolAdapter.address
    )
    await this.ct.rebalanceModule.setConfigForToken(
      zoo.address, 
      {
        lender: this.aaveFixture.lendingPool.address,
        router: this.mockRouter.address,
        addressesProvider: this.aaveFixture.lendingPoolAddressesProvider.address,
        amountPerUnitCollateral
      }
    )
  }


  public async initialize() : Promise<void>  {
    [
      this.accounts.owner,
      this.accounts.protocolFeeRecipient,
      this.accounts.mockUser,
      this.accounts.mockSubjectModule,
      this.accounts.bob,
      this.accounts.alice,
      this.accounts.oscar,
      ...this.accounts.others
    ] = await getAccounts();
     
      /* ================================================== DeFi Fixtures ==================================================*/
      this.aaveFixture = getAaveV2Fixture(this.accounts.owner.address);
      this.tokens.mockDai =  await (await ethers.getContractFactory("StandardTokenMock")).deploy(this.accounts.owner.address, ether(100000000), "MockDai", "MDAI", 18);
      this.tokens.mockBtc = await (await ethers.getContractFactory("StandardTokenMock")).deploy(this.accounts.owner.address, bitcoin(1000000), "MockBtc", "MBTC", 8);
      this.tokens.weth = await new WETH9__factory(this.accounts.owner.wallet).deploy();

      // await this.tokens.weth.connect(this.accounts.bob.wallet).deposit({value: ether(500)});
      await this.tokens.weth.deposit({value: ether(5000)});
      // await this.tokens.mockDai.transfer(this.accounts.bob.address, ether(200000));
      
      this.router = await initUniswapRouter(this.accounts.owner, this.tokens.weth, this.tokens.mockDai, this.tokens.mockBtc);      
      this.mockRouter = await initUniswapMockRouter(this.accounts.owner, this.tokens.weth, this.tokens.mockDai, this.tokens.mockBtc);      

      await  this.aaveFixture.initialize(this.tokens.weth.address, this.tokens.mockDai.address);

      // provide liquidity
      await this.tokens.mockDai.connect(this.accounts.owner.wallet).approve(this.aaveFixture.lendingPool.address, MAX_UINT_256);
      await this.tokens.weth.connect(this.accounts.owner.wallet).approve(this.aaveFixture.lendingPool.address, MAX_UINT_256);
      await this.aaveFixture.lendingPool.connect(this.accounts.owner.wallet).deposit(this.tokens.mockDai.address, ether(1000000), this.accounts.owner.address, ZERO);
      await this.aaveFixture.lendingPool.connect(this.accounts.owner.wallet).deposit(this.tokens.weth.address, ether(50), this.accounts.owner.address, ZERO);

      /* ============================================= Zoo Ecosystem ==============================================================*/
      this.ct.controller =  await (await ethers.getContractFactory("Controller")).deploy(
        this.accounts.protocolFeeRecipient.address
      );
      this.ct.creator =  await (await ethers.getContractFactory("ZooTokenCreator")).deploy(
        this.ct.controller.address
      );
      this.subjectModule = await (await ethers.getContractFactory("L3xIssuanceModule")).deploy(
        this.ct.controller.address
      );

      this.ct.rebalanceModule = await (await ethers.getContractFactory("L3xRebalanceModule")).deploy(
        this.ct.controller.address
      );

      this.ct.streamingFee = await (await ethers.getContractFactory("ZooStreamingFeeModule")).deploy(
        this.ct.controller.address
      );

      this.ct.integrator = await (await ethers.getContractFactory("IntegrationRegistry")).deploy(
        this.ct.controller.address
      );

      await this.ct.controller.initialize(
        [this.ct.creator.address],
        [
          this.subjectModule.address, 
          this.ct.streamingFee.address, 
          this.ct.rebalanceModule.address
        ],
        [this.ct.integrator.address],
        [INTEGRATION_REGISTRY_RESOURCE_ID]
      );

      let lendingProtocolAdapter = await (await ethers.getContractFactory("AaveLendingAdapter")).deploy(
        this.aaveFixture.lendingPool.address
      );
      let uniswapProtocolAdapter = await (await ethers.getContractFactory("UniswapV2ExchangeAdapterV3")).deploy(
        this.router.address 
      );
      await this.ct.integrator.addIntegration(
        this.subjectModule.address,
        AAVE_ADAPTER_NAME,
        lendingProtocolAdapter.address
      );
      await this.ct.integrator.addIntegration(
        this.subjectModule.address,
        UNISWAP_ADAPTER_NAME,
        uniswapProtocolAdapter.address
      );

      await this.ct.integrator.addIntegration(
        this.ct.rebalanceModule.address,
        AAVE_ADAPTER_NAME,
        lendingProtocolAdapter.address
      );
      await this.ct.integrator.addIntegration(
        this.ct.rebalanceModule.address,
        UNISWAP_ADAPTER_NAME,
        uniswapProtocolAdapter.address
      );

      await this.createZooToken();
      await this.createZooToken(false);
  }
}


export {
  Context, 
  initUniswapMockRouter, 
  initUniswapRouter, 
  pMul,
  AAVE_ADAPTER_NAME,
  INTEGRATION_REGISTRY_RESOURCE_ID,
  INTEGRATION_REGISTRY_LEND_RESOURCE_ID,
  UNISWAP_ADAPTER_NAME
};
