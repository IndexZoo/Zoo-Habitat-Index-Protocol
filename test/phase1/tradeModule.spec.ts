
import "module-alias/register";


import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import {
  SetToken
} from "@utils/contracts";
import {
  getWaffleExpect,
  getAccounts,
} from "@utils/test/index";
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { TestSetup } from "@utils/test/testSetup";
import { BigNumber } from "ethers";

const expect = getWaffleExpect();
const INTEGRATION_REGISTRY_RESOURCE_ID = 0;

describe("TradeModule", () => {
  let owner: Account;
  let feeRecipient: Account;
  let mockUser: Account;
  beforeEach(async () => {
    [
      owner,
      feeRecipient,
      mockUser,
    ] = await getAccounts();

  });


  describe("Owner trades assets of tokenset on uniswap", async function () {
    let isForked = process.env.FORKED === "true";
    let setup: TestSetup;
    let user: Account;
    let tokenset: SetToken;
    beforeEach(async () => {
        setup = new TestSetup();
        await setup.initialize();
        user = setup.accounts.user;
        tokenset = setup.tokensets[1];
        if(isForked) await setup.getTokensOnMainnet();

        // initiate liquidity pools if testing on local devnet (if forked no need to addLiquidity) 
        if(!isForked) {
            await setup.addLiquidity(setup.mockTokens.mockGenToken, ether(20000));
            await setup.addLiquidity(setup.mockTokens.mockDai, ether(40000000));
        }
    });

    it("ensure controller is properly deployed", async () => {
      expect(setup.contracts.controller.address).to.not.equal(ADDRESS_ZERO) ;
      expect(setup.contracts.basicIssuanceModule.address).to.not.equal(ADDRESS_ZERO);
    });
    it("construct  a new Tokenset  - deposit - trade", async () => {
        await setup.fundAccount(mockUser, 10000000);
      
      expect ((await tokenset.getModules())[0]).to.be.equal(setup.contracts.basicIssuanceModule.address);

      await setup.approveModule(mockUser, setup.contracts.basicIssuanceModule.address);
      let userWethBalanceBeforeIssue: BigNumber = BigNumber.from(0);
      let userDaiBalanceBeforeIssue: BigNumber = BigNumber.from(0);
      if(isForked) {
        userWethBalanceBeforeIssue = await setup.tokens.weth.balanceOf(mockUser.address);
        userDaiBalanceBeforeIssue = await setup.tokens.dai.balanceOf(mockUser.address);
      }
      
      await setup.contracts.basicIssuanceModule.connect(mockUser.wallet).issue(tokenset.address, ether(3), mockUser.address);
      expect(await tokenset.balanceOf(mockUser.address)).to.eq(ether(3)); 
      if(!isForked) {
        expect(await setup.mockTokens.mockWeth.balanceOf(mockUser.address)).to.eq(ether(10000000).sub(ether(30)));
        expect(await setup.mockTokens.mockGenToken.balanceOf(mockUser.address)).to.eq(ether(10000000).sub(ether(60)));  
      } else {
        expect(await setup.tokens.weth. balanceOf(mockUser.address)).to.eq(userWethBalanceBeforeIssue.sub(ether(30)));
        expect(await setup.tokens.dai. balanceOf(mockUser.address)).to.eq(userDaiBalanceBeforeIssue.sub(ether(60)));
      }
      await setup.approveModule(mockUser, setup.contracts.tradeModule.address);

      if(!isForked) {
          await setup.contracts.tradeModule.trade(
            tokenset.address,
            "UNISWAP",
            setup.mockTokens.mockWeth.address,
            ether(3),   // 3/10 * 30 
            setup.mockTokens.mockDai.address,
            ether(35000),   
           "0x" 
          );
      } else {
          await setup.contracts.tradeModule.trade(
            tokenset.address,
            "UNISWAP",
            setup.tokens.weth.address,
            ether(3),   // 3/10 * 30 
            setup.tokens.dai.address,
            ether(0),   
           "0x" 
          );
      }

      if(!isForked) {
        // balance of tokenset decreases by the amount eth participated in trade
        expect(await setup.mockTokens.mockWeth.balanceOf(tokenset.address)).to.eq(ether(30).sub(  ether(9))) ;
        // DAI balance of tokenset increases by more than 18000 units
        expect(await setup.mockTokens.mockDai.balanceOf(setup.tokensets[1].address)).to.gt(ether(35000));   // 3/10 * 30 * 4000 - fee  assuming price of weth ~ 4000
      } else {
        expect(await setup.tokens.weth. balanceOf(tokenset.address)).to.eq(ether(30).sub(ether(9)));
        expect(await setup.tokens.dai.balanceOf(tokenset.address)).to.gt(ether(31500));  // 3/10 * 30 * 3500 - fee  assuming price of weth ~ 3500
      }
    });
  });
});