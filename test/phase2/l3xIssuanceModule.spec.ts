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
import { ZooStreamingFeeModule } from "@typechain/ZooStreamingFeeModule";
import { Controller } from "@typechain/Controller";
import { UniswapV2Router02Mock } from "@typechain/UniswapV2Router02Mock";
import { IWETH } from "@typechain/IWETH";
import { AaveLendingAdapter } from "@typechain/AaveLendingAdapter";
import { UniswapV2ExchangeAdapterV3 } from "@typechain/UniswapV2ExchangeAdapterV3";
import { L3xRebalanceModule } from "@typechain/L3xRebalanceModule";
import {
  Context,
  AAVE_ADAPTER_NAME,
  UNISWAP_ADAPTER_NAME,
  pMul, 
  initUniswapMockRouter, 
  initUniswapRouter
} from './context';




const expect = getWaffleExpect();


describe("IssuanceModule", () => {
  let ctx: Context;
  let zToken: ZooToken;
  let bearToken: ZooToken;
  let owner: Account;
  let bob: Account;
  let alice: Account;
  let oscar: Account;
  let mockSubjectModule: Account;
  before(async () => {

  });

    beforeEach(async () => {
      ctx = new Context();
      await ctx.initialize();
      zToken = ctx.zoos[0];
      bearToken = ctx.zoos[1];
      owner = ctx.accounts.owner;
      bob = ctx.accounts.bob;
      alice = ctx.accounts.alice;
      oscar = ctx.accounts.oscar;
      mockSubjectModule = ctx.accounts.mockSubjectModule;

      await ctx.configureZoo(zToken, ether(0.8));

      await ctx.configureZoo(bearToken, ether(0.75));
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
          BigNumber.from(2),  // Variable Rate
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
      it("- Borrow from aave against stable collateral and check debt", async ()=>{
          await ctx.tokens.mockDai.mint(bob.address, ether(1000));
          await ctx.tokens.mockDai.connect(bob.wallet).approve(ctx.aaveFixture.lendingPool.address, MAX_UINT_256);

          await ctx.aaveFixture.lendingPool.connect(bob.wallet).deposit(ctx.tokens.mockDai.address, ether(1000), bob.address, ZERO);
          let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bob.address));
          expect(userData.totalCollateralETH).to.be.eq(ether(1));
          await ctx.aaveFixture.lendingPool.connect(bob.wallet).borrow(ctx.tokens.weth.address, ether(0.75), BigNumber.from(1), ZERO, bob.address);
        
          userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bob.address));
          expect(userData.totalDebtETH).to.be.eq(ether(0.75));
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

    describe("SubjectModule Issuing Bear Token", async () => {
      it("Verify Bear token ", async function () {
        expect(await ctx.zoos[1].side()).to.be.equal(1);
      });
      it("Ordinary Issuing - SubjectModule deposits dai and borrows against it on behalf of zooToken", async ()=>{
        let amountIn = ether(1000);
        let wethAmount = ether(1);
        let borrowFactor = 0.75;
        let leverage = 1 + borrowFactor + borrowFactor**2;
        // Dai amount expected after issuing - becomes a zoo bear balance of user
        let expectedDaiOut = amountIn.mul(ether(leverage)).div(ether(1));

        await ctx.tokens.mockDai.approve(ctx.subjectModule.address, amountIn);
        await ctx.subjectModule.issue(bearToken.address, amountIn, ether(1000), 985);
        
        let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address));

        expect(userData.totalCollateralETH).to.be.gt(wethAmount);
        expect(userData.healthFactor).to.gt(ether(1));  // ~ 1.06 ETH 
        expect(await bearToken.balanceOf(owner.address)).to.be.approx(expectedDaiOut);
      });
      /**
       * User issues 1000 DAI worth of zoo bears ~ 2300 bears
       * User then redeems 850 of zoo bears 
       * EXPECT to end up with 366 DAI
       */
      it("SubjectModule deposits dai, borrows and redeem portion of it", async ()=>{
        let amountIn = ether(1000);
        let wethAmount = ether(1);
        let borrowFactor = 0.75;
        let leverage = 1 + borrowFactor + borrowFactor**2;
        let redeemAmount = ether(850);
        let amountOut = amountIn.mul(ether(leverage)).div(ether(1));

        // finalExpectedDebt = amountIn*(leverage-1) - r (leverage-1)/leverage
        let finalExpectedDebt = amountIn.mul(ether(leverage-1)).div(ether(1)).sub(  redeemAmount.mul(ether(leverage -1)).div(ether(leverage)) );
        finalExpectedDebt = finalExpectedDebt.div(BigNumber.from(1000));
        let finalExpectedDaiBalance = redeemAmount.mul(amountIn).div(amountOut);

        await ctx.issueZoos(bearToken, amountIn, ether(1000), bob);
        
        let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address));

        await ctx.subjectModule.connect(bob.wallet).redeem(bearToken.address, redeemAmount);

        expect(await bearToken.getDebt(bob.address)).to.be.approx(finalExpectedDebt);  // ~ 0.826 Weth 
        expect(await ctx.tokens.mockDai.balanceOf(bob.address)).to.be.approx(finalExpectedDaiBalance);   // ~ 366 DAI
      });
      
      it("SubjectModule deposits dai, borrows and redeem", async ()=>{
        let amountIn = ether(1000);
        let wethAmount = ether(1);
        let borrowFactor = 0.75;
        let leverage = 1 + borrowFactor + borrowFactor**2;
        let redeemAmount = ether(1500);
        let amountOut = amountIn.mul(ether(leverage)).div(ether(1));

        // finalExpectedDebt = amountIn*(leverage-1) - r (leverage-1)/leverage
        let finalExpectedDebt = amountIn.mul(ether(leverage-1)).div(ether(1)).sub(  redeemAmount.mul(ether(leverage -1)).div(ether(leverage)) );
        finalExpectedDebt = finalExpectedDebt.div(BigNumber.from(1000));
        let finalExpectedDaiBalance = redeemAmount.mul(amountIn).div(amountOut);

        await ctx.issueZoos(bearToken, amountIn, ether(1000), bob);
        await ctx.issueZoos(bearToken, amountIn.mul(4), ether(1000), oscar);
        
        let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address));

        await ctx.subjectModule.connect(bob.wallet).redeem(bearToken.address, redeemAmount);

        expect(await bearToken.getDebt(bob.address)).to.be.approx(finalExpectedDebt);  // 
        expect(await ctx.tokens.mockDai.balanceOf(bob.address)).to.be.approx(finalExpectedDaiBalance);   // ~ 366 DAI

      });

      /**
       * Users issues zoo bears with enough liquidity for further redeem 
       * One user then redeems all of zoo bears 
       * EXPECT to end up with about same amount he entered with in DAI
       */
      it("SubjectModule deposits dai, borrows and redeem > Bob redeems all his zoo balance", async ()=>{
        let amountIn = ether(1000);
        let wethAmount = ether(1);
        let borrowFactor = 0.75;
        let leverage = 1 + borrowFactor + borrowFactor**2;
        let redeemAmount = MAX_UINT_256;
        let amountOut = amountIn.mul(ether(leverage)).div(ether(1));

        await ctx.issueZoos(bearToken, amountIn, ether(1000), bob);
        await ctx.issueZoos(bearToken, amountIn.mul(4), ether(1000), oscar);

        let bobZooBalance = await bearToken.balanceOf(bob.address);
        
        let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address));

        await ctx.subjectModule.connect(bob.wallet).redeem(bearToken.address, redeemAmount);
        expect(await bearToken.getDebt(bob.address)).to.be.equal(0);  // 
        expect(await ctx.tokens.mockDai.balanceOf(bob.address)).to.be.approx(amountIn);  // ~ 366 DAI
      });

      /**
       * User issues 1000 DAI worth of zoo bears ~ 2300 bears
       * User then redeems 850 of zoo bears 
       * EXPECT to end up with 366 DAI
       * First redeem provided enough liquidity for a second redeem
       * User redeems 250 of zoo bears
       */
      it("SubjectModule deposits dai, borrows then successive redeem", async ()=>{
        let amountIn = ether(1000);
        let wethAmount = ether(1);
        let borrowFactor = 0.75;
        let leverage = 1 + borrowFactor + borrowFactor**2;
        let redeemAmount = ether(850);
        let redeemAmount2 = ether(250);
        let amountOut = amountIn.mul(ether(leverage)).div(ether(1));

        // finalExpectedDebt = amountIn*(leverage-1) - r (leverage-1)/leverage
        let finalExpectedDebt = amountIn.mul(ether(leverage-1)).div(ether(1)).sub(  redeemAmount.mul(ether(leverage -1)).div(ether(leverage)) );
        finalExpectedDebt = finalExpectedDebt.div(BigNumber.from(1000));
        let finalExpectedDaiBalance = redeemAmount.mul(amountIn).div(amountOut);
        let finalExpectedDaiBalance1 = (redeemAmount.add(redeemAmount2)).mul(amountIn).div(amountOut);

        await ctx.issueZoos(bearToken, amountIn, ether(1000), bob);
        let bobZooBalance0 = await bearToken.balanceOf(bob.address);
        

        await ctx.subjectModule.connect(bob.wallet).redeem(bearToken.address, redeemAmount);
        let bobZooBalance1 = await bearToken.balanceOf(bob.address);

        expect(bobZooBalance0.sub(bobZooBalance1)).to.be.eq(redeemAmount);
        expect(await bearToken.getDebt(bob.address)).to.be.approx(finalExpectedDebt);  // ~ 0.826 Weth 
        expect(await ctx.tokens.mockDai.balanceOf(bob.address)).to.be.approx(finalExpectedDaiBalance);   // ~ 366 DAI

        await ctx.subjectModule.connect(bob.wallet).redeem(bearToken.address, redeemAmount2);
        let bobZooBalance2 = await bearToken.balanceOf(bob.address);
        expect(bobZooBalance1.sub(bobZooBalance2)).to.be.eq(redeemAmount2);

        // finalExpectedDebt = redeem2 * (lev -1) / (price * lev)   // debt is in Weth;
        finalExpectedDebt = finalExpectedDebt.sub(redeemAmount2.mul(ether(leverage -1)).div(ether(1000*leverage)));

        expect(await bearToken.getDebt(bob.address)).to.be.approx(finalExpectedDebt);
        expect(await ctx.tokens.mockDai.balanceOf(bob.address)).to.be.approx(finalExpectedDaiBalance1) ; 
      });
      /**
       * 3 users issue zoo tokens with equal amounts
       * One user decided to redeem all of the tokens
       * Price of underlying asset is doubled
       * EXPECT user retrieve expected dai (quoteToken) balance
       * EXPECT user have the redeemed zoo tokens burnt
       * EXPECT debt to decrease by expected amount
       */
      it("Three user issues Zoo against 1000 DAI then Bob redeems all zoo after price change", async ()=>{
        await ctx.configZooWithMockRouter(bearToken, ether(0.75));
        let initDaiBalance = ether(1000);
        let initWethAmount = ether(1);
        let borrowFactor = 0.75;
        let leverage = 1 + borrowFactor + borrowFactor**2;
        await ctx.issueZoos(bearToken, initDaiBalance, ether(1000), bob);
        await ctx.issueZoos(bearToken, initDaiBalance, ether(1000), alice);
        await ctx.issueZoos(bearToken, initDaiBalance, ether(1000), oscar);

        let initZooBalance = await bearToken.balanceOf(bob.address);
        let initUserDebt = await bearToken.getDebt(bob.address);
        let redeemAmount = MAX_UINT_256;
        let zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address));
        let allDebt0 = zooAaveData.totalDebtETH;

        // change price to 1 ETH = 800 DAI
        await ctx.aaveFixture.setAssetPriceInOracle(ctx.tokens.mockDai.address, ether(0.00125));
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(800)
        );

        zooAaveData = (await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address));

        // total debt is expected to be the same because debt is in Weth and calculated w.r.t. Weth 
        let allDebt1 = zooAaveData.totalDebtETH;
        expect(allDebt0).to.be.approx(allDebt1);
        await ctx.subjectModule.connect(bob.wallet).redeem(bearToken.address, redeemAmount);
        
        let finalZooBalance = await zToken.balanceOf(bob.address);
        let finalBobWethBalance = await ctx.tokens.weth.balanceOf(bob.address);
        let finalBobDaiBalance = await ctx.tokens.mockDai.balanceOf(bob.address);

        // profit_in_weth * leverage + initWeth =  0.25 * 2.3  + 1 
        let expectedEquivalentWeth = ether(0.25).mul(ether(leverage)).div(ether(1)).add(initWethAmount);
        expect(finalZooBalance).to.be.eq(ether(0));
        expect(finalBobDaiBalance).to.be.approx(expectedEquivalentWeth.mul(800));
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
      it("Three user issues Zoo against 10000 DAI then Bob redeems all zoo after price change", async ()=>{
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
        // TODO: 
      });
    });

    describe("Testing view external functions and getters", async function () {
      it("Accessibility of GlobalConfig and LocalConfig", async function() {
        let config = {
            lender: ADDRESS_ZERO,
            router: ADDRESS_ZERO,
            addressesProvider: ADDRESS_ZERO,
            amountPerUnitCollateral: ether(0.1)
          };
          let gConfig = {
            lender: bob.address,
            router: alice.address,
            addressesProvider: oscar.address
          };

        await ctx.subjectModule.setConfigForToken(
          zToken.address,
          config
        );
        await ctx.subjectModule.setGlobalConfig(
          gConfig
        );
        expect(await ctx.subjectModule.getLender(zToken.address)).to.be.equal(bob.address);
        expect(await ctx.subjectModule.getRouter(zToken.address)).to.be.equal(alice.address);
        expect(await ctx.subjectModule.getAddressesProvider(zToken.address)).to.be.equal(oscar.address);

        config = {
            lender: alice.address,
            router: oscar.address,
            addressesProvider: bob.address,
            amountPerUnitCollateral: ether(0.1)
        };
        await ctx.subjectModule.setConfigForToken(
          zToken.address,
          config
        );
        expect(await ctx.subjectModule.getLender(zToken.address)).to.be.equal(alice.address);
        expect(await ctx.subjectModule.getRouter(zToken.address)).to.be.equal(oscar.address);
        expect(await ctx.subjectModule.getAddressesProvider(zToken.address)).to.be.equal(bob.address);
      });
    });

    describe("StreamingFeeModule", async function () {
      let feeRecipient: Account;
      beforeEach("", async () => {
        feeRecipient = ctx.accounts.protocolFeeRecipient; 
        await ctx.issueZoos(zToken, ether(3000), ether(1000), bob);
      });
      // TODO: scenario with issuing after acruing fee - this to test inflation
      it ("accrueFee() - fee is calculated as expected/increase totalSupply by correct amount", async () => {
          let totalSupplyBeforeAccrue = await zToken.totalSupply();
          let timeBeforeAccrue = (await ctx.ct.streamingFee.feeStates(zToken.address)).lastStreamingFeeTimestamp;
          await ctx.ct.streamingFee.accrueFee(zToken.address);
          let timeDeltaAccrue = (await ctx.ct.streamingFee.feeStates(zToken.address)).lastStreamingFeeTimestamp.sub(timeBeforeAccrue);

          let feeConsumed =  (await zToken.totalSupply()).sub(  totalSupplyBeforeAccrue);
          // Expecting fee ~ 3 / (365*60*60*24) * timeDelta * 0.01
          let feeExpected = totalSupplyBeforeAccrue.mul(ether(0.01)).div(ether(1)).mul(timeDeltaAccrue).div(BigNumber.from(365*60*60*24));
          expect(feeConsumed).to.be.approx(feeExpected);
          // assert that fee gained by fee recipient is the increase in totalsupply
          let feeRecipientBalance = await zToken.balanceOf(feeRecipient.address);
          expect( feeRecipientBalance).to.eq(feeConsumed);
      });
      it ("accrueFee() - check fee calculation after time advance", async () => {
          let totalSupplyBeforeAccrue = await zToken.totalSupply();
          let feeRecipientBalance = await zToken.balanceOf(feeRecipient.address);
          
          //  Advance timestamp
          await ethers.provider.send('evm_increaseTime', [3600]); // one hour
          await ctx.ct.streamingFee.accrueFee(zToken.address);
          totalSupplyBeforeAccrue = await zToken.totalSupply();
          let feeRecipientBalanceLatest = await zToken.balanceOf(feeRecipient.address);
          let feeExpected =  totalSupplyBeforeAccrue.mul(ether(0.01)).div(ether(1)).mul(3600).div(BigNumber.from(365*60*60*24));
        
          // check fee gained by feeRecipient
          expect(feeRecipientBalanceLatest.sub(feeRecipientBalance)).to.approx(feeExpected)
          
      });
      it ("updateStreamingFee() - update fee, this process mints fee for recipient with old value", async () => {
          let totalSupplyBeforeAccrue = await zToken.totalSupply();
          let feeRecipientBalance = await zToken.balanceOf(feeRecipient.address);
          
          //  Advance timestamp
          await ethers.provider.send('evm_increaseTime', [3600]);  // one hour
          await ctx.ct.streamingFee.updateStreamingFee(zToken.address, ether(0.02));
          totalSupplyBeforeAccrue = await zToken.totalSupply();
          let feeRecipientBalanceLatest = await zToken.balanceOf(feeRecipient.address);
          let feeExpected =  totalSupplyBeforeAccrue.mul(ether(0.01)).div(ether(1)).mul(3600).div(BigNumber.from(365*60*60*24));
        
          // check fee gained by feeRecipient
          expect(feeRecipientBalanceLatest.sub(feeRecipientBalance)).to.approx(feeExpected)
          
          await ethers.provider.send('evm_increaseTime', [3600]);
          await ctx.ct.streamingFee.accrueFee(zToken.address);
          let totalSupplyBeforeAccrue2 = await zToken.totalSupply();
          let feeRecipientBalanceLatest2 = await zToken.balanceOf(feeRecipient.address);
          let feeExpected2 =  totalSupplyBeforeAccrue2.mul(ether(0.02)).div(ether(1)).mul(3600).div(BigNumber.from(365*60*60*24));
        
          // check fee gained by feeRecipient
          expect(feeRecipientBalanceLatest2.sub(feeRecipientBalanceLatest)).to.approx(feeExpected2)
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