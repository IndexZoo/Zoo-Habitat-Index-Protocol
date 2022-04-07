import "module-alias/register";
import "../ztypes";

import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256, ZERO } from "@utils/constants";

import {
  getWaffleExpect
} from "@utils/test/helpers";
import { ethers } from "hardhat";
import { ether } from "@utils/common/unitsUtils";
import { abi as AaveLendingAdapterABI } 
  from "../../artifacts/contracts/protocol/integration/l3x/AaveLendingAdapter.sol/AaveLendingAdapter.json";
import { abi as UniswapAdapterABI } 
  from "../../artifacts/contracts/protocol/integration/l3x/UniswapV2ExchangeAdapterV3.sol/UniswapV2ExchangeAdapterV3.json";

//for aave

import {BigNumber, Contract} from "ethers";
import { SetToken } from "@typechain/SetToken";
import { AaveLendingAdapter } from "@typechain/AaveLendingAdapter";
import { UniswapV2ExchangeAdapterV3 } from "@typechain/UniswapV2ExchangeAdapterV3";
import {
  Context,
  AAVE_ADAPTER_NAME,
  UNISWAP_ADAPTER_NAME,
  pMul, 
  initUniswapMockRouter, 
  initUniswapRouter
} from './contextV2';


const expect = getWaffleExpect();


describe("IssuanceModule", () => {
  let ctx: Context;
  let zToken: SetToken;
  let bearToken: SetToken;
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
      owner = ctx.accounts.owner;
      bob = ctx.accounts.bob;
      alice = ctx.accounts.alice;
      oscar = ctx.accounts.oscar;
      mockSubjectModule = ctx.accounts.mockSubjectModule;

      // await ctx.configureZoo(zToken, ether(0.8));
    });
    describe("SubjectModule Issuing", async () => {
      it("context verifying", async () => {

      });
      it("SubjectModule  ", async ()=>{
        let wethAmount = 1;
        let maticAmount = ether(1000);
        let iters = 3;    // iterative deposits 
        await ctx.tokens.matic.approve(ctx.subjectModule.address, maticAmount );
        // TODO: Do Issue: Equity = 1000 matic / Debt = 1950 matic / Exposure kept inside hook = 2.95 ETH 
        let fees = await ctx.subjectModule._calculateRequiredComponentIssuanceUnits (
          zToken.address,
          ether(1),
          true
        );
        console.log(fees.map(x => x.toString()));

        // await ctx.subjectModule.issue(zToken.address, maticAmount, owner.address);
        
        // let userData = (await ctx.aaveFixture.lendingPool.getUserAccountData(zToken.address));

        // // leverage represented in thousands (i.e. 2500 leverage ~ 2.5x leverage)
        // let leverage = ether(wethAmount).add(userData.totalDebtETH).mul(1000).div(ether(wethAmount));

        // expect(leverage).to.be.gt(2500);   // leverage ~ 2.935 for minimum healthFactor/maximum risk
        // expect(userData.currentLiquidationThreshold).to.gt(BigNumber.from(8000));
        // expect(userData.totalCollateralETH).to.be.gt(ether(wethAmount).mul(2)).to.be.lt(ether(3));
        // expect(userData.healthFactor).to.gt(ether(1));  // ~ 1.03 ETH 
        // expect(await zToken.balanceOf(owner.address)).to.be.gt(ether(2.5));  // exposure = leverage * input

        // // amount weth expected on the second borrow = 1 * 0.8 **3 - fees
        // expect(await ctx.tokens.weth.balanceOf(zToken.address)).to.be.approx(ether(wethAmount*0.8**iters));
      });
    });
});