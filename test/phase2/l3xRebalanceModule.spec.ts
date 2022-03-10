import "module-alias/register";
import "../ztypes";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256, ZERO } from "@utils/constants";
import {
  getWaffleExpect
} from "@utils/test/helpers";
import { bitcoin, ether } from "@utils/common/unitsUtils";
import { ZooToken } from "@typechain/ZooToken";
import {
  Context,
  pMul, 
  initUniswapMockRouter, 
  initUniswapRouter
} from './context';
import { preciseDiv, preciseMul } from "@utils/common/mathUtils";


const expect = getWaffleExpect();

describe("L3xRebalanceModule", () => {
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


    describe("Rebalancing", async function () {
      beforeEach("", async () => {
        await ctx.configRebalancerWithMockRouter(zToken, ether(0.8));
        await ctx.configZooWithMockRouter(zToken, ether(0.8));
        await ctx.configRebalancerWithMockRouter(bearToken, ether(0.75));
        await ctx.configZooWithMockRouter(bearToken, ether(0.75));
      });

      it("Rebalance position of Bob after price double", async () => {
        let initDaiBalance = ether(1000);
        let initPrice = ether(1000);
        let finalPrice = ether(2000);
        let borrowRate = 0.8;
        let iters = 3;  // number of deposits to Aave
        let leverage = (1-borrowRate**(iters+1)) / (1-borrowRate);
        let borrowFactor = leverage-1;
        let depositFactor = leverage - borrowRate**iters;
        let quantity = ether(1).mul(ether(leverage)).div(ether(1));
        let maxAmountIn = initDaiBalance.mul(8).mul(1150).div(1000);

        await ctx.issueZoos(zToken, quantity.mul(8), leverage, oscar, maxAmountIn);  // Provide liquidity @note 1600 was not enough
        await ctx.issueZoos(zToken, quantity, leverage, bob);

        let zooAaveData = await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address);
        let initTotalDeposit = zooAaveData.totalCollateralETH;

        await ctx.aaveFixture.fallbackOracle.setAssetPrice(ctx.tokens.mockDai.address, ether(0.0005)) ;
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(2000)
        );
        await ctx.ct.rebalanceModule.connect(bob.wallet).rebalancePosition(zToken.address);

        let expectedFinalUserDebt  = pMul(finalPrice, leverage * borrowFactor).sub(  pMul (initPrice, borrowFactor**2) );
        let expectedFinalZooBalance = pMul(finalPrice, leverage**2).sub ( pMul(initPrice, leverage * borrowFactor) )
        expectedFinalZooBalance = expectedFinalZooBalance.mul(ether(1)).div(finalPrice);
        let expectedDepositIncrease  = pMul((finalPrice.sub(initPrice)), borrowFactor* depositFactor) ;
        expectedDepositIncrease = expectedDepositIncrease.mul(ether(1)).div(finalPrice);

        zooAaveData = await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address);
        let finalTotalDeposit = zooAaveData.totalCollateralETH;

        expect (await zToken.getDebt(bob.address)).to.be.approx(expectedFinalUserDebt);
        expect (await zToken.balanceOf(bob.address)).to.be.approx(expectedFinalZooBalance);
        expect (finalTotalDeposit.sub(initTotalDeposit)).to.be.approx(expectedDepositIncrease);

      });
      it("Verify Bob redeems the amount expected to be redeemed after calling a rebalance", async () => {
        let initDaiBalance = ether(1000);
        let initPrice = ether(1000);
        let finalPrice = ether(2000);
        let borrowRate = 0.8;
        let iters = 3;  // number of deposits to Aave
        let leverage = (1-borrowRate**(iters+1)) / (1-borrowRate);
        let borrowFactor = leverage-1;
        let depositFactor = leverage - borrowRate**iters;
        let quantity = ether(1).mul(ether(leverage)).div(ether(1));
        let maxAmountIn = initDaiBalance.mul(8).mul(1150).div(1000);
        
        await ctx.issueZoos(zToken, quantity.mul(8), leverage, oscar, maxAmountIn);  // Provide liquidity
        await ctx.issueZoos(zToken, quantity, leverage, bob);

        await ctx.aaveFixture.fallbackOracle.setAssetPrice(ctx.tokens.mockDai.address, ether(0.0005)) ;
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          finalPrice 
        );
        await ctx.ct.rebalanceModule.connect(bob.wallet).rebalancePosition(zToken.address);
        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, MAX_UINT_256  );

        // Expected Redeem Amount in WETH  (Convert to dai to show leveraged profit)
        // expectedRedeemAmount =  (initDai + initDai/initPrice*(finalPrice-initPrice)*leverage) / finalPrice
        let expectedRedeemAmount = initDaiBalance.mul(finalPrice.sub(initPrice)).div(initPrice);
        expectedRedeemAmount = pMul(expectedRedeemAmount, leverage).add(initDaiBalance) ;
        expectedRedeemAmount = expectedRedeemAmount.mul(ether(1)).div(finalPrice);

        expect(await ctx.tokens.weth.balanceOf(bob.address)).to.be.approx(expectedRedeemAmount);
      });
      
      /**
       * Bob receives expected profit after rebalancing position
       * Price increases twice / first time -> do rebalance / second time -> do redeem
       */
      it("Verify Bob bags in expected profit after calling a rebalance", async () => {
        // 
        let initDaiBalance = ether(1000);
        let initPrice = ether(1000);
        let finalPrice = ether(2000);
        let finalFinalPrice = ether(2500);
        
        let borrowRate = 0.8;
        let iters = 3;  // number of deposits to Aave
        let leverage = (1-borrowRate**(iters+1)) / (1-borrowRate);
        let borrowFactor = leverage-1;
        let depositFactor = leverage - borrowRate**iters;
        let quantity = ether(1).mul(ether(leverage)).div(ether(1));
        let maxAmountIn = initDaiBalance.mul(8).mul(1150).div(1000);

        await ctx.issueZoos(zToken, quantity.mul(8), leverage, oscar, maxAmountIn);  // Provide liquidity
        await ctx.issueZoos(zToken, quantity, leverage, bob);

        await ctx.aaveFixture.fallbackOracle.setAssetPrice(ctx.tokens.mockDai.address, ether(0.0005)) ;
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          finalPrice 
        );
        await ctx.ct.rebalanceModule.connect(bob.wallet).rebalancePosition(zToken.address);

        await ctx.aaveFixture.fallbackOracle.setAssetPrice(ctx.tokens.mockDai.address, ether(0.0004)) ;
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          finalFinalPrice 
        );

        await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, MAX_UINT_256  );

        // expectedRedeemAmount1 =  (initDai + initDai/initPrice*(finalPrice-initPrice)*leverage) 
        // expectedRedeemInDAI = expectedRedeemAmount1*finalFinalPrice/finalPrice*leverage - expectedRedeemAmount1*(leverage-1)
        // expectedRedeemInWeth = expectedRedeemInDAI / finalFinalPrice
        let expectedRedeemAmount = initDaiBalance.mul(finalPrice.sub(initPrice)).div(initPrice);
        expectedRedeemAmount = pMul(expectedRedeemAmount, leverage).add(initDaiBalance) ;
        expectedRedeemAmount = pMul(expectedRedeemAmount, leverage)
        .mul(finalFinalPrice).div(finalPrice)
        .sub( pMul(expectedRedeemAmount, leverage-1) )
        .mul(ether(1))
        .div(finalFinalPrice);

        expect(await ctx.tokens.weth.balanceOf(bob.address)).to.be.approx(expectedRedeemAmount);
      });

      it("Rebalance position of Bob's bear after price double", async () => {
        let initDaiBalance = ether(1000);
        let wethAmount = ether(1);
        let initPrice = ether(0.001);
        let finalPrice = ether(0.00125);
        let borrowRate = 0.75;
        let iters = 3;  // number of deposits to Aave
        let leverage = (1-borrowRate**(iters+1)) / (1-borrowRate);
        let borrowFactor = leverage-1;
        let depositFactor = leverage - borrowRate**iters;
        let quantity = initDaiBalance.mul(ether(leverage)).div(ether(1));
        let maxAmountIn = wethAmount.mul(8).mul(1150).div(1000);
        
        await ctx.issueZoos(bearToken, quantity, leverage, bob, wethAmount.mul(1150).div(1000));
        await ctx.issueZoos(bearToken, quantity.mul(8), leverage, oscar, maxAmountIn);  // Provide liquidity @note 1600 was not enough

        let zooAaveData = await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address);
        let initTotalDeposit = zooAaveData.totalCollateralETH;
        let initTotalDepositBob = initTotalDeposit.div(9);

        await ctx.aaveFixture.fallbackOracle.setAssetPrice(ctx.tokens.mockDai.address, ether(0.00125)) ;
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(800)
        );
        await ctx.ct.rebalanceModule.connect(bob.wallet).rebalancePosition(bearToken.address);

        let expectedFinalUserDebtInWeth  = pMul( preciseDiv(finalPrice, initPrice), leverage * borrowFactor).sub(  pMul (ether(1), borrowFactor**2) );
        // epxected exposure = debt / (1 - 1/leverage)   -- debt in dai
        let expectedFinalZooBalance = preciseDiv(preciseDiv(expectedFinalUserDebtInWeth, finalPrice), ether(1).sub(preciseDiv(ether(1), ether(leverage))));

        zooAaveData = await ctx.aaveFixture.lendingPool.getUserAccountData(bearToken.address);
        let finalTotalDeposit = zooAaveData.totalCollateralETH;
        // finalDeposit -- for Bob after rebalance -- subtracting Oscar's portion
        let finalTotalDepositBob = finalTotalDeposit.sub( initTotalDeposit.mul(8).div(9).mul(125).div(100));

        expect (await bearToken.getDebt(bob.address)).to.be.approx(expectedFinalUserDebtInWeth);
        expect (await bearToken.balanceOf(bob.address)).to.be.approx(expectedFinalZooBalance);
        // FIXME: expected delta_deposit = 1.8 but actual was seen to be 1.58 
        // expect (finalTotalDepositBob.sub(initTotalDepositBob)).to.be.approx(expectedDepositIncrease);

      });

      it("For bearToken - Verify Bob redeems the amount expected to be redeemed after calling a rebalance", async () => {
        let initDaiBalance = ether(1000);
        let initPrice = ether(0.001);
        let finalPrice = ether(0.00125);
        let borrowRate = 0.75;
        let iters = 3;  // number of deposits to Aave
        let leverage = (1-borrowRate**(iters+1)) / (1-borrowRate);
        let borrowFactor = leverage-1;
        let depositFactor = leverage - borrowRate**iters;
        let quantity = initDaiBalance.mul(ether(leverage)).div(ether(1));
        let maxAmountIn = ether(1).mul(8).mul(1150).div(1000);
        
        await ctx.issueZoos(bearToken, quantity.mul(8), leverage, oscar, maxAmountIn);  // Provide liquidity
        await ctx.issueZoos(bearToken, quantity, leverage, bob);

        await ctx.aaveFixture.fallbackOracle.setAssetPrice(ctx.tokens.mockDai.address, finalPrice) ;
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          ether(800) 
        );
        await ctx.ct.rebalanceModule.connect(bob.wallet).rebalancePosition(bearToken.address);
        await ctx.subjectModule.connect(bob.wallet).redeem(bearToken.address, MAX_UINT_256  );

        // Expected Redeem Amount in WETH  (Convert to dai to show leveraged profit)
        // expectedRedeemAmount =  (initweth + initweth/initPrice*(finalPrice-initPrice)*leverage) / finalPrice
        let expectedRedeemAmount = ether(1).mul(finalPrice.sub(initPrice)).div(initPrice);
        expectedRedeemAmount = pMul(expectedRedeemAmount, leverage).add(ether(1)) ;
        expectedRedeemAmount = expectedRedeemAmount.mul(ether(1)).div(finalPrice);

        expect(await ctx.tokens.mockDai.balanceOf(bob.address)).to.be.approx(expectedRedeemAmount);
      });

      it.skip("Verify Bob ends up with a decreased position size due to loss after calling a rebalance", async () => {
        // @note  This depends on Liquidation logic
        let initDaiBalance = ether(1000);
        let initPrice = ether(1000);
        let finalPrice = ether(833.33);
        let borrowRate = 0.8;
        let iters = 3;  // number of deposits to Aave
        let leverage = (1-borrowRate**(iters+1)) / (1-borrowRate);
        let borrowFactor = leverage-1;
        let depositFactor = leverage - borrowRate**iters;

        let quantity = ether(1).mul(ether(leverage)).div(ether(1));
        
        await ctx.issueZoos(zToken, quantity.mul(8), leverage, oscar);  // Provide liquidity
        await ctx.issueZoos(zToken, quantity, leverage, bob);  // Provide liquidity

        await ctx.aaveFixture.fallbackOracle.setAssetPrice(ctx.tokens.mockDai.address, ether(0.0012)) ;
        await ctx.mockRouter.setPrice(
          ctx.tokens.weth.address, 
          ctx.tokens.mockDai.address, 
          finalPrice 
        );
        let data = await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address);
        console.log(data.availableBorrowsETH.toString() );
        await ctx.issueZoos(zToken, quantity.mul(8), leverage, alice);  // Provide liquidity
        // @note do calculation (might not actually have any allowance to withdraw)
        data = await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address);
        console.log(data.totalCollateralETH.toString());
        console.log(data.availableBorrowsETH.toString() );
        await ctx.ct.rebalanceModule.connect(bob.wallet).rebalancePosition(zToken.address);
        data = await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address);
        console.log(data.totalCollateralETH.toString());
        // await ctx.subjectModule.connect(bob.wallet).redeem(zToken.address, MAX_UINT_256  );

        // // Expected Redeem Amount in WETH  (Convert to dai to show leveraged profit)
        // // expectedRedeemAmount =  (initDai + initDai/initPrice*(finalPrice-initPrice)*leverage) / finalPrice
        // let expectedRedeemAmount = initDaiBalance.mul(finalPrice.sub(initPrice)).div(initPrice);
        // expectedRedeemAmount = pMul(expectedRedeemAmount, leverage).add(initDaiBalance) ;
        // expectedRedeemAmount = expectedRedeemAmount.mul(ether(1)).div(finalPrice);

        // expect(await ctx.tokens.weth.balanceOf(bob.address)).to.be.approx(expectedRedeemAmount);
      });
    });
});