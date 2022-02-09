import "module-alias/register";
import "../ztypes";

import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256, ZERO } from "@utils/constants";
import { 
  IntegrationRegistry,
  StandardTokenMock,
    UniswapV2Router02,
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
import { abi as AaveLendingAdapterABI } 
  from "../../artifacts/contracts/protocol/integration/l3x/AaveLendingAdapter.sol/AaveLendingAdapter.json";
import { abi as UniswapAdapterABI } 
  from "../../artifacts/contracts/protocol/integration/l3x/UniswapV2ExchangeAdapterV3.sol/UniswapV2ExchangeAdapterV3.json";

//for aave
import {  AaveV2Fixture } from "@utils/fixtures";

import {BigNumber, Contract} from "ethers";
import { WETH9__factory } from "@typechain/factories/WETH9__factory";
import { L3xIssuanceModule } from "@typechain/L3xIssuanceModule";
import { ZooToken } from "@typechain/ZooToken";
import { ZooTokenCreator } from "@typechain/ZooTokenCreator";
import { Controller } from "@typechain/Controller";
import { UniswapV2Router02Mock } from "@typechain/UniswapV2Router02Mock";
import { IWETH } from "@typechain/IWETH";
import { AaveLendingAdapter } from "@typechain/AaveLendingAdapter";
import { UniswapV2ExchangeAdapterV3 } from "@typechain/UniswapV2ExchangeAdapterV3";

// TODO: Tests with prices change (losses, wins) (MORE)
// TODO: deal with trick of depositing at different prices
// TODO: Consider upgradeability test (changing factors in Module - maintaining state of token)

const expect = getWaffleExpect();

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
  creator: ZooTokenCreator;
  integrator: IntegrationRegistry;
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
  public async createZooToken(): Promise<void> {
      const tx =  await this.ct.creator.create(
        [this.tokens.mockDai.address],
        [ether(1000)],
        [this.subjectModule.address], 
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
       await this.subjectModule.connect(to.wallet).issue(zoo.address, amount, price,  985);
  }

  public async configureZoo(zoo: ZooToken): Promise<void> {
    await this.subjectModule.setConfigForToken(
      zoo.address, 
      {
        lender: this.aaveFixture.lendingPool.address,
        router: this.router.address,
        addressesProvider: this.aaveFixture.lendingPoolAddressesProvider.address
      }
    )
  }

  public async configZooWithMockRouter(zoo: ZooToken): Promise<void> {
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
        addressesProvider: this.aaveFixture.lendingPoolAddressesProvider.address
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
      await this.aaveFixture.lendingPool.connect(this.accounts.owner.wallet).deposit(this.tokens.mockDai.address, ether(1000000), this.accounts.owner.address, ZERO);

      /* ============================================= Zoo Ecosystem ==============================================================*/
      this.ct.controller =  await (await ethers.getContractFactory("Controller")).deploy(
        this.accounts.protocolFeeRecipient.address
      );
      this.ct.creator =  await (await ethers.getContractFactory("ZooTokenCreator")).deploy(
        this.ct.controller.address
      );
      this.subjectModule = await (await ethers.getContractFactory("L3xIssuanceModule")).deploy(
        this.ct.controller.address, 
        this.tokens.weth.address, 
        this.tokens.mockDai.address
      );

      this.ct.integrator = await (await ethers.getContractFactory("IntegrationRegistry")).deploy(
        this.ct.controller.address
      );

      await this.ct.controller.initialize(
        [this.ct.creator.address],
        [this.subjectModule.address],
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
      await this.createZooToken();
  }
}

describe("Controller", () => {
  let ctx: Context;
  let zToken: ZooToken;
  let owner: Account;
  let bob: Account;
  let alice: Account;
  let oscar: Account;
  let mockSubjectModule: Account;
  before(async () => {

  });

  describe("Owner needs to deposit and withdraw collateral inside Aave", async function () {
    beforeEach(async () => {
      ctx = new Context();
      await ctx.initialize();
      zToken = ctx.zoos[0];
      owner = ctx.accounts.owner;
      bob = ctx.accounts.bob;
      alice = ctx.accounts.alice;
      oscar = ctx.accounts.oscar;
      mockSubjectModule = ctx.accounts.mockSubjectModule;

      await ctx.configureZoo(zToken);
    });
    describe("Ecosystem checks", async () => {
      it("router mock - swapExactTokensForTokens", async () => {
        await ctx.tokens.mockDai.mint(bob.address, ether(1000));
        let initDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
        let initWethBalance = await ctx.tokens.weth.balanceOf(bob.address);
        await ctx.tokens.mockDai.connect(bob.wallet).approve(ctx.mockRouter.address, MAX_UINT_256);
        await ctx.mockRouter.connect(bob.wallet).swapExactTokensForTokens(
          ether(1000), 
          ether(1), 
          [ctx.tokens.mockDai.address, ctx.tokens.weth.address],
          bob.address,
          MAX_UINT_256
        );
        let finalDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
        let finalWethBalance = await ctx.tokens.weth.balanceOf(bob.address);

        expect(finalWethBalance.sub(initWethBalance)).to.be.eq(ether(1));
        expect(initDaiBalance.sub(finalDaiBalance)).to.be.eq(ether(1000));
      });
      it("router mock - swapTokensForExactTokens", async () => {
        await ctx.tokens.mockDai.mint(bob.address, ether(1000));
        let initDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
        let initWethBalance = await ctx.tokens.weth.balanceOf(bob.address);
        await ctx.tokens.mockDai.connect(bob.wallet).approve(ctx.mockRouter.address, MAX_UINT_256);
        await ctx.mockRouter.connect(bob.wallet).swapTokensForExactTokens(
          ether(1), 
          ether(1000), 
          [ctx.tokens.mockDai.address, ctx.tokens.weth.address],
          bob.address,
          MAX_UINT_256
        );
        let finalDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
        let finalWethBalance = await ctx.tokens.weth.balanceOf(bob.address);

        expect(finalWethBalance.sub(initWethBalance)).to.be.eq(ether(1));
        expect(initDaiBalance.sub(finalDaiBalance)).to.be.eq(ether(1000));
      });
      it("IntegrationRegistry for UNISWAP connected properly / methodData are matched", async () => {
        let adapterAddress = await ctx.ct.integrator.getIntegrationAdapter(
          ctx.subjectModule.address,
          UNISWAP_ADAPTER_NAME 
        );
        let adapter = await ethers.getContractAt(UniswapAdapterABI, adapterAddress) as UniswapV2ExchangeAdapterV3;
        expect(await adapter.getSpender()).to.be.equal(ctx.router.address);

        let [target, callValue, calldata] = await adapter.getTradeCalldata(
          ctx.tokens.mockDai.address,
          ctx.tokens.weth.address,
          ctx.accounts.bob.address,
          ether(1000),
          ether(1),
          true,
          "0x" 
        );
        let abi = ["function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)"]
        let expectedCalldata = new ethers.utils.Interface(abi).encodeFunctionData("swapExactTokensForTokens", [
          ether(1000),
          ether(1), 
          [ctx.tokens.mockDai.address, ctx.tokens.weth.address],
          ctx.accounts.bob.address,
          (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
        ]);

        expect(target).to.be.equal(ctx.router.address);
        expect(callValue).to.be.equal(BigNumber.from(0));
        expect(calldata).to.be.equal(expectedCalldata);
      });
      it("IntegrationRegistry for AAVE connected properly / methodData are matched", async () => {
        let adapterAddress = await ctx.ct.integrator.getIntegrationAdapter(
          ctx.subjectModule.address,
          AAVE_ADAPTER_NAME 
        );
        let adapter = await ethers.getContractAt(AaveLendingAdapterABI, adapterAddress) as AaveLendingAdapter;
        expect(await adapter.getSpender()).to.be.equal(ctx.aaveFixture.lendingPool.address);

        let [target, callValue, calldata] = await adapter.getBorrowCalldata(
          ctx.tokens.mockDai.address,
          ether(1),
          ctx.zoos[0].address
        );

        let abi = ["function borrow(address,uint256,uint256,uint16,address)"]
        let expectedCalldata = new ethers.utils.Interface(abi).encodeFunctionData("borrow", [
          ctx.tokens.mockDai.address,
          ether(1),
          BigNumber.from(1),
          0,
          ctx.zoos[0].address
        ]);


        expect(target).to.be.equal(ctx.aaveFixture.lendingPool.address);
        expect(callValue).to.be.equal(BigNumber.from(0));
        expect(calldata).to.be.equal(expectedCalldata);
      });
    });
    describe("Verify Interaction with Aave fixture directly", async () => {
      it("Verify ZooToken created via ZooTokenCreator", async () => {
        expect(await ctx.zoos[0].modules(0)).to.be.eq(ctx.subjectModule.address);
        expect(await ctx.zoos[0].isInitializedModule(ctx.subjectModule.address)).to.be.true;
        expect(await ctx.zoos[0].name()).to.be.eq("eth long");
        expect(await ctx.zoos[0].symbol()).to.be.eq("BULL");
      });
      it("- Borrow from aave and check debt", async ()=>{
          await mockSubjectModule.wallet.sendTransaction({to: ctx.tokens.weth.address, value: ether(20)});
          await ctx.tokens.weth.connect(bob.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);
          await ctx.tokens.weth.connect(mockSubjectModule.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);
          await ctx.tokens.mockDai.connect(owner.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);

          await ctx.aaveFixture.lendingPool.connect(mockSubjectModule.wallet).deposit(ctx.tokens.weth.address, ether(10), bob.address, ZERO);
          await ctx.aaveFixture.lendingPool.connect(mockSubjectModule.wallet).deposit(ctx.tokens.weth.address, ether(10), mockSubjectModule.address, ZERO);
          await ctx.aaveFixture.lendingPool.connect(mockSubjectModule.wallet).borrow(ctx.tokens.mockDai.address, ether(8000), BigNumber.from(1), ZERO, mockSubjectModule.address);
        
          let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(mockSubjectModule.address));
          expect(userData.healthFactor).to.gt(ether(1));  // ~ 1.03 ETH 
      });
      /**
       * Bob deposits 10 WETH, then borrows corresponding 8000 DAI
       * EXPECT DAI balance of Bob increase by borrowed amount
       * EXPECT debt to be 8000 DAI ~ 8 ETH (calculate via oracle price)
       * Bob repays debt
       * EXPECT DAI balance of Bob to be the same as initial DAI balance
       * EXPECT debt position to be nil
       */
      it("- repay Aave debt", async ()=>{
          let daiPriceInEth = await ctx.aaveFixture.fallbackOracle.getAssetPrice(ctx.tokens.mockDai.address);
          let ethPriceInDai = ether(1).mul(ether(1)).div(daiPriceInEth);
          // Fund bob with weth & dai
          await bob.wallet.sendTransaction({to: ctx.tokens.weth.address, value: ether(10)});
          await ctx.tokens.mockDai.mint(bob.address, ether(100));


          await ctx.tokens.weth.connect(bob.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);
          await ctx.tokens.mockDai.connect(bob.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);
          let initDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);

          await ctx.aaveFixture.lendingPool.connect(bob.wallet).deposit(ctx.tokens.weth.address, ether(10), bob.address, ZERO);
          await ctx.aaveFixture.lendingPool.connect(bob.wallet).borrow(ctx.tokens.mockDai.address, ether(8000), BigNumber.from(1), ZERO, bob.address);
          let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bob.address));
          let borrowedDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
          expect(borrowedDaiBalance).to.approx(initDaiBalance.add(ether(8000)));
          expect(userData.totalDebtETH.mul(ethPriceInDai).div(ether(1))).to.be.approx(ether(8000));
         
          // Repay all the debt on bob to AAVE  (i.e. MAX_UINT_256)
          await ctx.aaveFixture.lendingPool.connect(bob.wallet).repay(ctx.tokens.mockDai.address, MAX_UINT_256, 1, bob.address);
          let finalDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
          expect(finalDaiBalance).to.approx(initDaiBalance);
          userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bob.address));

          // No debt
          expect(userData.totalDebtETH.mul(ethPriceInDai).div(ether(1))).to.be.approx(ether(0));

      });

      /**
       * Purpose of this test is to check borrow allowances with double deposits and partial repays
       * Bob deposits 10 WETH, then borrows corresponding 8000 DAI
       * EXPECT DAI balance of Bob increase by borrowed amount
       * EXPECT debt to be 8000 DAI ~ 8 ETH (calculate via oracle price)
       * Bob deposits the 8000 DAI after swapping them for 8 ETH
       * Bob checks available amount to borrow, should be 6.4 ETH
       * Bob Borrows against that deposited ETH
       * Bob repays debt second debt 6.4 ETH
       * Check userData on AAVE
       * EXPECT DAI balance of Bob to be the same as initial DAI balance
       * EXPECT debt position to be nil
       */
      it("double deposit and repayments", async ()=>{
          await ctx.tokens.weth.connect(bob.wallet).deposit({value: ether(10)});
          let daiPriceInEth = await ctx.aaveFixture.fallbackOracle.getAssetPrice(ctx.tokens.mockDai.address);
          let ethPriceInDai = ether(1).mul(ether(1)).div(daiPriceInEth);
          await ctx.tokens.weth.connect(bob.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);
          await ctx.tokens.mockDai.connect(bob.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);
          await ctx.tokens.mockDai.connect(bob.wallet).approve(ctx.router.address, MAX_UINT_256);
          let initDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);

          // Deposit and Borrow FIRST
          await ctx.aaveFixture.lendingPool.connect(bob.wallet).deposit(ctx.tokens.weth.address, ether(10), bob.address, ZERO);
          await ctx.aaveFixture.lendingPool.connect(bob.wallet).borrow(ctx.tokens.mockDai.address, ether(8000), BigNumber.from(1), ZERO, bob.address);
          let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bob.address));
          let borrowedDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
          expect(borrowedDaiBalance).to.approx(initDaiBalance.add(ether(8000)));
          expect(userData.totalDebtETH.mul(ethPriceInDai).div(ether(1))).to.be.approx(ether(8000));
          expect(borrowedDaiBalance).to.be.eq(ether(8000));

          // Swap 
          await ctx.router.connect(bob.wallet).swapExactTokensForTokens(
            ether(8000), 
            ether(0), 
            [ctx.tokens.mockDai.address, ctx.tokens.weth.address],
            bob.address,
            MAX_UINT_256
          );
          let bobWethSwapped = await ctx.tokens.weth.balanceOf(bob.address);
          await ctx.aaveFixture.lendingPool.connect(bob.wallet).deposit(
            ctx.tokens.weth.address, 
            bobWethSwapped, 
            bob.address, 
            ZERO
          );
          userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bob.address));

          let avBorrow = userData.availableBorrowsETH.mul(ether(1)).div(
            await ctx.aaveFixture.fallbackOracle.getAssetPrice(ctx.tokens.mockDai.address)
          );

          // Expect amount to borrow after second deposit to be 10000*0.8*0.8 DAI 
          expect(avBorrow).to.be.approx(ether(10000*0.8*0.8));
          initDaiBalance =  await ctx.tokens.mockDai.balanceOf(bob.address);
          await ctx.aaveFixture.lendingPool.connect(bob.wallet).borrow(
            ctx.tokens.mockDai.address, 
            avBorrow.mul(999).div(1000),  // borrow 99.9% of available (magic number)
            BigNumber.from(1), 
            ZERO, 
            bob.address
          );
          let finalDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
          expect(finalDaiBalance.sub(initDaiBalance)).to.be.eq(avBorrow.mul(999).div(1000));
          let assetPrice = await ctx.aaveFixture.fallbackOracle.getAssetPrice(ctx.tokens.mockDai.address);

          // Repay
        //  console.log(userData.totalDebtETH.toString()); 
        //   await ctx.aaveFixture.lendingPool.connect(bob.wallet).repay(ctx.tokens.mockDai.address, ether(8000), 1, bob.address);
        //   let finalDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);
        //   expect(finalDaiBalance).to.approx(initDaiBalance);
        //   userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bob.address));
        //   console.log("debt after repay ", userData.totalDebtETH.toString());

        //   // No debt
        //  expect(userData.totalDebtETH.mul(ethPriceInDai).div(ether(1))).to.be.lt(ether(0.0001));

      });
    });
    // TODO: TODO: ensure integration worked 
    describe("SubjectModule Issuing", async () => {
      it("SubjectModule deposits weth and borrows against it on behalf of zooToken", async ()=>{
        let wethAmount = 10;
        await ctx.tokens.mockDai.approve(ctx.subjectModule.address, ether(10000));
        await ctx.subjectModule.issue(zToken.address, ether(10000), ether(1000), 985);
        
        let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));

        // leverage represented in thousands (i.e. 2500 leverage ~ 2.5x leverage)
        let leverage = ether(wethAmount).add(userData.totalDebtETH).mul(1000).div(ether(wethAmount));

        expect(leverage).to.be.gt(2000);   // leverage ~ 2425 for minimum healthFactor/maximum risk
        expect(userData.currentLiquidationThreshold).to.gt(BigNumber.from(8000));
        expect(userData.totalCollateralETH).to.be.gt(ether(wethAmount)).to.be.lt(ether(20));
        expect(userData.healthFactor).to.gt(ether(1));  // ~ 1.03 ETH 
        expect(await zToken.balanceOf(owner.address)).to.be.gt(ether(20));

        // amount weth expected on the second borrow = 10 * 0.8 * 0.8 - fees
        expect(await ctx.tokens.weth.balanceOf(zToken.address)).to.be.gt(ether(wethAmount/2)).to.be.lt(ether(wethAmount*0.64));
      });
    });

    describe("Debt in Zoo Leverage Token ", async () => {
     /**
       * user issue zoo tokens with amount 10000 DAI 
       * EXPECT user debt to increase accordingly 
       */
      it("Investor issues tokens debt is initiated ", async ()=>{
        let initDaiBalance = ether(10000);
        let initWethAmount = ether(10);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);

        let initZooBalance = await zToken.balanceOf(bob.address);
        let initUserDebt = await zToken.getDebt(bob.address);

        // (initWethAmount*0.8 + initWethAmount * 0.8 * 0.8 ) * 1000
        let expectedFinalUserDebt = initWethAmount.mul(ether(0.8)).add(initWethAmount.mul(ether(0.8*0.8))).div(ether(1)).mul(1000);

        // Expect to have no balance available for borrowing before calling the redeem
        // Expect to have avaialable margin to borrow from after the redeem call
        let zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));

        // Expect WETH balance after redeem to be initWethAmount*redeemAmount/initZooBalance
        expect(await zToken.getDebt(bob.address)).to.be.approx(expectedFinalUserDebt)
        expect(await zToken.getDebt(bob.address)).to.be.approx(zooAaveData.totalDebtETH.mul(1000));
        
      });
    });
     describe("Price movement scenarios ", async () =>{
      /**
       * user issue zoo tokens 
       * user decided to redeem part of the tokens
       * Price of underlying asset is doubled
       * Redeem 5 bulls   of zToken weth Balance
       * EXPECT user retrieve expected weth (baseToken) balance
       * EXPECT user have the redeemed zoo tokens burnt (5 Zoos are burnt)
       * EXPECT debt to decrease by expected amount
       */
      it("One user issues Zoo against 10000 DAI then redeems 5 Zoos", async ()=>{
        await ctx.configZooWithMockRouter(zToken);
        let initDaiBalance = ether(10000);
        let initWethAmount = ether(10);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);

        let initZooBalance = await zToken.balanceOf(bob.address);
        let initUserDebt = await zToken.getDebt(bob.address);
        let redeemAmount = ether(5);

        // change price to 1 ETH = 2000 DAI
        await ctx.aaveFixture.setAssetPriceInOracle(ctx.tokens.mockDai.address, ether(0.0005));
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(2000)
        );

        let zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));

        // total debt is expected to be halved because of price change 
        expect(zooAaveData.totalDebtETH).to.be.approx(ether(7.2));
        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, redeemAmount);
        
        let debtToRepay = ether(5).mul(ether(7.2)).div(ether(24.4));
        let finalZooBalance = await zToken.balanceOf(bob.address);
        let finalAccountWethBalance = await ctx.tokens.weth.balanceOf(bob.address);

        // expectedBorrowAllowance = (initCollateral - redeemAmount*initCollateral/zooBalance)* new_price * 0.8
        // alreadyBorrowed = initDaiDebt - redeemAmount * initDaiDebt/24.4
        // expectedAvBorrow = (expectedBorrowAllowance - alreadyBorrowed)
        let expectedAvBorrowInDai =  ether(18).mul(2000*0.8).sub(ether(14.4).mul(1000)).mul( ether(1).sub(redeemAmount.mul(ether(1)).div(initZooBalance) ) );
        expectedAvBorrowInDai  = expectedAvBorrowInDai.div(ether(1));
        zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
        expect(zooAaveData.availableBorrowsETH).to.be.approx(expectedAvBorrowInDai.div(2000));  // [out]:  11447631350717186116800/2000
        
        // Ensure Debt amount is repaid for bob on redeem
        expect(finalAccountWethBalance).to.be.approx(redeemAmount.sub(debtToRepay));    // [out]:  3525128003223199266
        // User remaining balance of zoo Token  
        expect(finalZooBalance).to.be.eq(initZooBalance.sub(redeemAmount));
      });   

      /**
       * 3 users issue zoo tokens with equal amounts
       * One user decided to redeem all of the tokens
       * Price of underlying asset is doubled
       * EXPECT user retrieve expected weth (baseToken) balance
       * EXPECT user have the redeemed zoo tokens burnt
       * EXPECT debt to decrease by expected amount
       */
      it("Three user issues Zoo against 10000 DAI then they redeem zoo after price change", async ()=>{
        let leverage = ether(2.4);
        await ctx.configZooWithMockRouter(zToken);
        let initDaiBalance = ether(10000);
        let initWethAmount = ether(10);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), alice);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), oscar);

        let initZooBalance = await zToken.balanceOf(bob.address);
        let initUserDebt = await zToken.getDebt(bob.address);
        let redeemAmount = MAX_UINT_256;

        // change price to 1 ETH = 2000 DAI
        await ctx.aaveFixture.setAssetPriceInOracle(ctx.tokens.mockDai.address, ether(0.0005));
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(2000)
        );

        let zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));

        // total debt is expected to be halved because of price change 
        expect(zooAaveData.totalDebtETH).to.be.approx(ether(7.2*3));
        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, redeemAmount);
        
        let finalZooBalance = await zToken.balanceOf(bob.address);
        let finalBobWethBalance = await ctx.tokens.weth.balanceOf(bob.address);
        let expectedBobWethBalance = initDaiBalance.mul(leverage.add(ether(1))).div(ether(2000));
          // Ensure Debt amount is repaid for bob on redeem
        expect(finalBobWethBalance).to.be.approx(expectedBobWethBalance);    // [out]:
        // User remaining balance of zoo Token  
        expect(finalZooBalance).to.be.eq(ether(0));
      });   
      /**
       * 3 users issue zoo tokens with equal amounts
       * 2 users decided to redeem all of the tokens
       * NB: not possible to have a withdrawal with not enough liquid
       * Price of underlying asset is doubled
       * EXPECT user retrieve expected weth (baseToken) balance
       * EXPECT user have the redeemed zoo tokens burnt
       * EXPECT debt to decrease by expected amount
       */
      it("Three user issues Zoo against 10000 DAI then they redeem zoo after price change", async ()=>{
        let leverage = ether(2.4);
        await ctx.configZooWithMockRouter(zToken);
        let initDaiBalance = ether(10000);
        let initWethAmount = ether(10);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), alice);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), oscar);

        let initZooBalance = await zToken.balanceOf(bob.address);
        let initUserDebt = await zToken.getDebt(bob.address);
        let redeemAmount = MAX_UINT_256;

        // change price to 1 ETH = 2000 DAI
        await ctx.aaveFixture.setAssetPriceInOracle(ctx.tokens.mockDai.address, ether(0.0005));
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(2000)
        );

        // total debt is expected to be halved because of price change 
        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, redeemAmount);
        await ctx.subjectModule.connect(alice.wallet).redeem(zToken.address, redeemAmount);

        let finalZooBalances = [
          await zToken.balanceOf(bob.address),
          await zToken.balanceOf(alice.address),
        ];
        let finalWethBalances = [
          await ctx.tokens.weth.balanceOf(bob.address),
          await ctx.tokens.weth.balanceOf(alice.address),
        ];
        let expectedWethBalance = initDaiBalance.mul(leverage.add(ether(1))).div(ether(2000));
        
        for (let b of finalWethBalances)
            expect(b).to.be.approx(expectedWethBalance);    // [out]:
        // User remaining balance of zoo Token  
        for (let b of finalZooBalances)
            expect(b).to.be.eq(ether(0));
      }); 

      /**
       * 3 users issue zoo tokens with equal amounts on different points of time (different prices)
       * 2 users decided to redeem all of the tokens , one user wins, one user loses
       * Price of underlying asset moved from 1000 DAI -> 1600 DAI -> 1000 DAI
       * EXPECT users retrieve expected weth (baseToken) balance
       * EXPECT user have the redeemed zoo tokens burnt
       * EXPECT debt to decrease by expected amount on redemption
       */
      it("3 users issues Zoo against 10000 DAI then 2 users redeem zoo, one lose other wins", async ()=>{
        let leverage = ether(2.4);
        await ctx.configZooWithMockRouter(zToken);
        let initDaiBalance = ether(1000);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);
        await ctx.issueZoos(zToken, initDaiBalance.mul(4), ether(1000), alice);  // Provide enough liquidity

        let redeemAmount = MAX_UINT_256;

        // change price to 1 ETH = 1600 DAI
        await ctx.aaveFixture.setAssetPriceInOracle(ctx.tokens.mockDai.address, ether(0.000625));
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(1600)
        );

        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, redeemAmount);

        let finalTraderZooBalance = 
          await zToken.balanceOf(bob.address);
        let finalTraderWethBalance = 
          await ctx.tokens.weth.balanceOf(bob.address);
        let expectedWethBalance = initDaiBalance.mul( ether(1).add( leverage.mul(600).div(1000) ) ).div(ether(1600));
            
        expect(finalTraderWethBalance).to.be.approx(expectedWethBalance);    // [out]:
        expect(finalTraderZooBalance).to.be.eq(ether(0));

        // Scenario in which user loses on trading  ------------------------------------
        await ctx.issueZoos(zToken, initDaiBalance, ether(1600), oscar);
        // change price to 1 ETH = 1350 DAI
        await ctx.aaveFixture.setAssetPriceInOracle(ctx.tokens.mockDai.address, ether(0.00074));
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(1350)
        );

        await ctx.subjectModule.connect(oscar.wallet).redeem(zToken.address, redeemAmount);

        finalTraderZooBalance = 
          await zToken.balanceOf(oscar.address);
        finalTraderWethBalance = 
          await ctx.tokens.weth.balanceOf(oscar.address);
        expectedWethBalance = initDaiBalance.mul( ether(1).sub( leverage.mul(250).div(1600) ) ).div(ether(1350));
            
        expect(finalTraderWethBalance).to.be.approx(expectedWethBalance);    // [out]:
        expect(finalTraderZooBalance).to.be.eq(ether(0));
        // ---------------------------------------------------------------------


      }); 
      // TODO: test with loss scenario for all (no liquidation) - (edge case)

    });
    describe("Redeeming scenarios ", async () =>{
      /**
       * 3 users issue zoo tokens with equal amounts
       * One user decided to redeem part of the tokens (redeemable tokens)
       * Redeem amount is 0.9 of zToken weth Balance
       * EXPECT user retrieve expected weth (baseToken) balance
       * EXPECT user have the redeemed zoo tokens burnt
       * EXPECT debt to decrease by expected amount
       */
      it("Investor issues tokens then redeems a portion of it - verify right amount redeemed", async ()=>{
        let initDaiBalance = ether(1000);
        let initWethAmount = ether(1);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1002), alice); // Price increased due to change in Uniswap pool
        await ctx.issueZoos(zToken, initDaiBalance, ether(1003), oscar);

        let initZooBalance = await zToken.balanceOf(bob.address);
        let initUserDebt = await zToken.getDebt(bob.address);
        let zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
        let redeemAmount = (await ctx.tokens.weth.balanceOf(zToken.address)).mul(90).div(100);


        // initDebt - initDebt*redeemAmount/initZooBalance
        let expectedFinalUserDebt = initUserDebt.sub( redeemAmount.mul(initUserDebt).div(initZooBalance) );

        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, redeemAmount);
        // Expect to have avaialable margin to borrow from after the redeem call
        let finalZooBalance = await zToken.balanceOf(bob.address);
        zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));

        // Expect WETH balance after redeem to be initWethAmount*redeemAmount/initZooBalance
        expect(await ctx.tokens.weth.balanceOf(bob.address)).to.be.approx(initWethAmount.mul(redeemAmount).div(initZooBalance));
        expect(await zToken.getDebt(bob.address)).to.be.approx(expectedFinalUserDebt);
        expect(initZooBalance.sub(finalZooBalance)).to.be.approx(redeemAmount);
        
      });

      /**
       * @dev 3 users issue zoo tokens
       * One user decided to redeem all of the tokens
       * EXPECT user retrieve expected weth (baseToken) balance
       * EXPECT user have all his zoo tokens burnt
       * EXPECT debt is removed on user 
       * @dev Note that much less amount of initDaiBalance is chosen 
       * in order to decrease the significance of price increase on uniswap
       */
      it("Investor issues tokens then redeems all  of it", async ()=>{
        let initDaiBalance = ether(100);
        let initWethAmount = ether(0.1);
        let redeemAmount = MAX_UINT_256;  // implies redeeming all zoo balance

        // There's enough liquidity for bob to redeem all his balance
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);
        await ctx.issueZoos(zToken, initDaiBalance.mul(1), ether(1001), alice); 
        await ctx.issueZoos(zToken, initDaiBalance.mul(2), ether(1002), oscar);

        let initZooBalance = await zToken.balanceOf(bob.address);
        let zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
        let expectedFinalUserDebt = ether(0);

        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, redeemAmount);
        let finalZooBalance = await zToken.balanceOf(bob.address);
        zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
        let finalWethBalance = await ctx.tokens.weth.balanceOf(bob.address);

        // Expect WETH balance after redeem to be initWethAmount*redeemAmount/initZooBalance
        expect(finalWethBalance).to.be.approx(initWethAmount); // [out]:  98889171104461080 
        expect(await zToken.getDebt(bob.address)).to.be.equal(expectedFinalUserDebt);
        expect(finalZooBalance).to.be.equal(ether(0));
        
      });
      /**
       * @dev 3 users issue zoo tokens
       * 
       * EXPECT users retrieve expected weth (baseToken) balance
       * EXPECT users have all his zoo tokens burnt
       * EXPECT debts is removed on users 
       */
      it("Investors issues tokens then they redeem ", async ()=>{

        let initDaiBalance = ether(100);
        let initWethAmount = ether(0.1);

        // There's enough liquidity for bob to redeem all his balance
        await ctx.issueZoos(zToken, initDaiBalance, ether(1000), bob);
        await ctx.issueZoos(zToken, initDaiBalance, ether(1002), oscar);
        await ctx.issueZoos(zToken, initDaiBalance.mul(4), ether(1003), alice); 

        let initZooBalance = await zToken.balanceOf(bob.address);
        let zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
        let expectedFinalUserDebt = ether(0);

        const doRedeem = async (account: Account, redeemAmount: BigNumber) => {
          await ctx.subjectModule.connect(account.wallet).redeem(zToken.address, redeemAmount);
          let finalAccountZooBalance = await zToken.balanceOf(account.address);
          zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
          let finalAccountWethBalance = await ctx.tokens.weth.balanceOf(account.address);

          if (redeemAmount == MAX_UINT_256) {
            expect(finalAccountWethBalance).to.be.approx(initWethAmount);
            expect(await zToken.getDebt(account.address)).to.be.equal(expectedFinalUserDebt);
            expect(finalAccountZooBalance).to.be.equal(ether(0));
          } 
        };

        await doRedeem(bob, MAX_UINT_256);
        await doRedeem(alice, ether(0.25)); 

      });
    });

    describe("Priveleges - ", async () =>  {
      it(" - verify only manager can call setConfigForToken()", async () => {

      });
    });


    /**
     * 
     */
    it.skip("Rebalancing tests - verify ratio between deposit and debt compatible with aimed leverage", async ()=>{
      // @dev at this stage rebalancing takes place after redeem()   
      let wethAmount = 10;
       await ctx.tokens.mockDai.approve(ctx.subjectModule.address, ether(10000));
       await ctx.subjectModule.issue(zToken.address, ether(10000), ether(1000), 985);

       let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
       console.log((await ctx.tokens.weth.balanceOf(zToken.address)).toString());
       await ctx.subjectModule.redeem(zToken.address, ether(5));
       userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));
       console.log(userData.availableBorrowsETH.toString());
       
    });
  });
});