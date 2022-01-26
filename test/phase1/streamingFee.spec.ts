import "module-alias/register";
import "../ztypes";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import {
  SetToken, StreamingFeeModule
} from "@utils/contracts";
import { getWaffleExpect } from "@utils/test/helpers";
import {
  getAccounts,
  cacheBeforeEach,
} from "@utils/test/index";
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { TestSetup } from "@utils/test/testSetup";
import { BigNumber } from "ethers";
import {ethers} from 'hardhat';

const expect = getWaffleExpect();


describe("StreamingFeeModule", () => {
  let owner: Account;
  let feeRecipient: Account;
  let user: Account;
  beforeEach(async () => {
    [
      owner,
      feeRecipient,
      user,
    ] = await getAccounts();

  });


  describe("Streaming fees -- ", async function () {
    let isForked = process.env.FORKED === "true";
    let setup: TestSetup;
    let user: Account;
    let feeRecipient: Account;
    let tokenset: SetToken;
    let streamingFeeModule: StreamingFeeModule;
    let fundAmount = 1000000;
    cacheBeforeEach (async () => {
        setup = new TestSetup();
        await setup.initialize();
        user = setup.accounts.user;
        feeRecipient = setup.accounts.feeRecipient;
        tokenset = setup.tokensets[0];
        streamingFeeModule =  setup.contracts.streamingFeeModule;
        if(isForked) await setup.getTokensOnMainnet();
        await setup.fundAccount(user, fundAmount);
 
    })
    beforeEach(async () => {
               // initiate liquidity pools 
        if(!isForked) {
            await setup.addLiquidity(setup.mockTokens.mockGenToken, ether(2000000));
            await setup.addLiquidity(setup.mockTokens.mockDai, ether(4000000));
        }

        await setup.initStreamingFeeModule(0.01, 0.05, tokenset.address);
        await setup.approveModule(user, setup.contracts.basicIssuanceModule.address);
      
        await setup.contracts.basicIssuanceModule.connect(user.wallet).issue(tokenset.address, ether(3), user.address);
        expect(await tokenset.balanceOf(user.address)).to.eq(ether(3)); 
    });

    it("ensure controller is properly deployed and so are modules", async () => {
      expect(setup.contracts.controller.address).to.not.equal(ADDRESS_ZERO) ;
      expect(setup.contracts.basicIssuanceModule.address).to.not.equal(ADDRESS_ZERO);
      expect ((await tokenset.getModules())[0]).to.be.equal(setup.contracts.basicIssuanceModule.address);
    });
    it ("accrueFee() - fee is calculated as expected/increase totalSupply by correct amount", async () => {
        let totalSupplyBeforeAccrue = await tokenset.totalSupply();
        let timeBeforeAccrue = (await streamingFeeModule.feeStates(tokenset.address)).lastStreamingFeeTimestamp;
        await setup.contracts.streamingFeeModule.accrueFee(tokenset.address);
        let timeDeltaAccrue = (await streamingFeeModule.feeStates(tokenset.address)).lastStreamingFeeTimestamp.sub(timeBeforeAccrue);

        let feeConsumed =  (await tokenset.totalSupply()).sub(  totalSupplyBeforeAccrue);
        // Expecting fee ~ 3 / (365*60*60*24) * timeDelta * 0.01
        let feeExpected = totalSupplyBeforeAccrue.mul(ether(0.01)).div(ether(1)).mul(timeDeltaAccrue).div(BigNumber.from(365*60*60*24));
        expect(feeConsumed).to.be.approx(feeExpected);
        // assert that fee gained by fee recipient is the increase in totalsupply
        let feeRecipientBalance = await tokenset.balanceOf(feeRecipient.address);
        expect( feeRecipientBalance).to.eq(feeConsumed);
    });
    it ("accrueFee() - check fee calculation after time advance", async () => {
        let totalSupplyBeforeAccrue = await tokenset.totalSupply();
        let feeRecipientBalance = await tokenset.balanceOf(feeRecipient.address);
        
        //  Advance timestamp
        await ethers.provider.send('evm_increaseTime', [3600]); // one hour
        await streamingFeeModule.accrueFee(tokenset.address);
        totalSupplyBeforeAccrue = await tokenset.totalSupply();
        let feeRecipientBalanceLatest = await tokenset.balanceOf(feeRecipient.address);
        let feeExpected =  totalSupplyBeforeAccrue.mul(ether(0.01)).div(ether(1)).mul(3600).div(BigNumber.from(365*60*60*24));
       
        // check fee gained by feeRecipient
        expect(feeRecipientBalanceLatest.sub(feeRecipientBalance)).to.approx(feeExpected)
        
    });
    it ("updateStreamingFee() - update fee, this process mints fee for recipient with old value", async () => {
        let totalSupplyBeforeAccrue = await tokenset.totalSupply();
        let feeRecipientBalance = await tokenset.balanceOf(feeRecipient.address);
        
        //  Advance timestamp
        await ethers.provider.send('evm_increaseTime', [3600]);  // one hour
        await streamingFeeModule.updateStreamingFee(tokenset.address, ether(0.02));
        totalSupplyBeforeAccrue = await tokenset.totalSupply();
        let feeRecipientBalanceLatest = await tokenset.balanceOf(feeRecipient.address);
        let feeExpected =  totalSupplyBeforeAccrue.mul(ether(0.01)).div(ether(1)).mul(3600).div(BigNumber.from(365*60*60*24));
       
        // check fee gained by feeRecipient
        expect(feeRecipientBalanceLatest.sub(feeRecipientBalance)).to.approx(feeExpected)
        
        await ethers.provider.send('evm_increaseTime', [3600]);
        await streamingFeeModule.accrueFee(tokenset.address);
        let totalSupplyBeforeAccrue2 = await tokenset.totalSupply();
        let feeRecipientBalanceLatest2 = await tokenset.balanceOf(feeRecipient.address);
        let feeExpected2 =  totalSupplyBeforeAccrue2.mul(ether(0.02)).div(ether(1)).mul(3600).div(BigNumber.from(365*60*60*24));
       
        // check fee gained by feeRecipient
        expect(feeRecipientBalanceLatest2.sub(feeRecipientBalanceLatest)).to.approx(feeExpected2)
    });
  });
});