import "module-alias/register";


import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import {
  getWaffleExpect,
} from "@utils/test/index";
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { TestSetup } from "@utils/test/testSetup";
import { SingleIndexModule } from "@typechain/SingleIndexModule";
import { Account } from "@utils/test/types";
import { SetToken } from "@typechain/SetToken";
import { bigNumberCloseTo } from "@utils/test/helpers";


const expect = getWaffleExpect();
const EXCHANGE_ID = {NONE: 0, UNISWAP: 1, SUSHI: 2, BALANCER: 3, LAST: 4};

describe("Rebalancer  ... ", () => {
    let setup: TestSetup;
    let singleIndexModule: SingleIndexModule;
    let user: Account;
    let tokenset: SetToken;
    const initializeSingleIndexModule = async () => {
        await setup.contracts.singleIndexModule.initialize(setup.tokensets[0].address );
    }
    beforeEach(async () => {
        setup = new TestSetup();
        await setup.initialize();
        await initializeSingleIndexModule();
        singleIndexModule = setup.contracts.singleIndexModule;
        user = setup.accounts.user;
        tokenset = setup.tokensets[0];

        // initiate liquidity pools 
        await setup.addLiquidity(setup.mockTokens.mockGenToken, ether(20000));
        await setup.addLiquidity(setup.mockTokens.mockDai, ether(10000));
        await setup.addLiquidity(setup.mockTokens.mockGenToken, ether(2000), setup.mockTokens.mockDai);
    });

    it("Ensure rebalancer is configured properly with other pieces of set-protocol", async () => {
        expect(singleIndexModule.address).to.not.equal(ADDRESS_ZERO);
        expect (await setup.tokensets[0].getModules()).to.contain(singleIndexModule.address);

        let positions = await setup.tokensets[0].getPositions();
        for (let position of positions) {
            expect((await singleIndexModule.assetInfo(position.component)).targetUnit).to.eq(position.unit);
        }

    });
    it("Ensure not anyone can Trade - should revert when user trying to trade", async () => {
        await expect(singleIndexModule.trade(setup.mockTokens.mockDai.address))
          .to.revertedWith("Address not permitted to trade");
    });
    it("User trying to do a rebalance without manager triggering the process", async () => {
        await singleIndexModule.updateAnyoneTrade(true);

        await expect(singleIndexModule.trade(setup.mockTokens.mockDai.address))
          .to.revertedWith("Passed component not included in rebalance");
    });
    it("User trying to trade but set is already rebalanced", async () => {
        let positionMultiplier = ether(1);
        await singleIndexModule.updateAnyoneTrade(true);

        await singleIndexModule.startRebalance([], [], [ether(3), ether(2)], positionMultiplier);
        await singleIndexModule.setExchanges([setup.mockTokens.mockDai.address], [EXCHANGE_ID.UNISWAP]);

        await expect(setup.contracts.singleIndexModule.trade(setup.mockTokens.mockDai.address))
          .to.revertedWith("Target already met");
    });
    // Strategy: Starting from a ratio index set 3:2
    //   initiate a rebalance to endup with ratio 1:3 (PS: 1:2.99 due to fees)
    it("User is invited to do a rebalance", async () => {
        await setup.fundAccount(user);
        await setup.approveModule(user, setup.contracts.basicIssuanceModule.address);
        await setup.issue(setup.tokensets[0].address, user, ether(1));
        let positionMultiplier = ether(1);
        await singleIndexModule.updateAnyoneTrade(true);
        await setup.approveModule(user, singleIndexModule.address);

        // component #1 sells 2e18 / component #2 buys 0.99e18
        //   - if exchange fees did not exist, trade would have been exactly suited for replacing 2e18 of #1 by 1e18 of #2
        await singleIndexModule.startRebalance([], [], [ether(1), ether(2.99)], positionMultiplier);
        let positions = await setup.tokensets[0].getPositions();
        expect((await singleIndexModule.assetInfo(positions[0].component)).targetUnit).to.eq(ether(1));

        await singleIndexModule.setExchanges(
            [setup.mockTokens.mockGenToken.address, setup.mockTokens.mockDai.address], 
            [EXCHANGE_ID.UNISWAP, EXCHANGE_ID.UNISWAP]);


        let tokenOneBalanceBeforeRebalance = await setup.mockTokens.mockGenToken.balanceOf(tokenset.address);
        let tokenTwoBalanceBeforeRebalance = await setup.mockTokens.mockDai.balanceOf(tokenset.address);
        expect(tokenOneBalanceBeforeRebalance).to.eq(ether(3));
        expect(tokenTwoBalanceBeforeRebalance).to.eq(ether(2));
        expect(await setup.mockTokens.mockWeth.balanceOf(tokenset.address)).to.eq(ether(0));


        await singleIndexModule.setTradeMaximums(
            [setup.mockTokens.mockGenToken.address, setup.mockTokens.mockDai.address], 
            [ether(20), ether(20)]);
        await singleIndexModule.connect(user.wallet).trade(setup.mockTokens.mockGenToken.address);
        expect(bigNumberCloseTo(await setup.mockTokens.mockWeth.balanceOf(tokenset.address), ether(0.1), ether(0.005))).to.be.true;
        await singleIndexModule.connect(user.wallet).trade(setup.mockTokens.mockDai.address);
        expect(bigNumberCloseTo(await setup.mockTokens.mockWeth.balanceOf(tokenset.address), ether(0), ether(0.005))).to.be.true;


        let tokenOneBalanceAfterRebalance = await setup.mockTokens.mockGenToken.balanceOf(tokenset.address);
        let tokenTwoBalanceAfterRebalance = await setup.mockTokens.mockDai.balanceOf(tokenset.address);
        expect(bigNumberCloseTo(tokenOneBalanceAfterRebalance, ether(1), ether(0.005))).to.be.true;
        expect(bigNumberCloseTo(tokenTwoBalanceAfterRebalance, ether(2.99), ether(0.005))).to.be.true;
    });

    // Strategy: Starting by index set of ratio 3:2, 
    //   trade portion of token for another in the set via uniswap , 
    //   then rebalance back to ratio 2.95:2
    it("Rebalance back to previous ratios after trade fulfilled", async () => {
        await setup.fundAccount(user);
        // approve user to use tokens owned by user
        await setup.approveModule(user, setup.contracts.basicIssuanceModule.address);
        await setup.issue(setup.tokensets[0].address, user, ether(1));
        let positionMultiplier = ether(1);
        await singleIndexModule.updateAnyoneTrade(true);
        await setup.approveModule(user, singleIndexModule.address);

        // Trade executed to disturb ratio of set
        await setup.contracts.tradeModule.trade(
            tokenset.address,
            "UNISWAP",
            setup.mockTokens.mockGenToken.address,
            ether(2),
            setup.mockTokens.mockDai.address,
           ether(0.9),
           "0x" 
        );
        await singleIndexModule.setExchanges(
            [setup.mockTokens.mockGenToken.address, setup.mockTokens.mockDai.address], 
            [EXCHANGE_ID.UNISWAP, EXCHANGE_ID.UNISWAP]);

        let tokenOneBalanceBeforeRebalance = await setup.mockTokens.mockGenToken.balanceOf(tokenset.address);
        expect(tokenOneBalanceBeforeRebalance).to.eq(ether(1));
        
        
        // Can not come back to (3) because intermediate fees won't produce enough Weth 
         await singleIndexModule.startRebalance([], [], [ether(2.95), ether(2)], positionMultiplier); 
        await singleIndexModule.setTradeMaximums(
            [setup.mockTokens.mockGenToken.address, setup.mockTokens.mockDai.address], 
            [ether(20), ether(20)]);
        await singleIndexModule.connect(user.wallet).trade(setup.mockTokens.mockDai.address);
        expect(bigNumberCloseTo(await setup.mockTokens.mockWeth.balanceOf(tokenset.address), ether(0.1), ether(0.005))).to.be.true;

        await singleIndexModule.connect(user.wallet).trade(setup.mockTokens.mockGenToken.address);

        // Set is back to its original ratio before the trade
        let tokenOneBalanceAfterRebalance = await setup.mockTokens.mockGenToken.balanceOf(tokenset.address);
        let tokenTwoBalanceAfterRebalance = await setup.mockTokens.mockDai.balanceOf(tokenset.address);
        expect(bigNumberCloseTo(tokenOneBalanceAfterRebalance, ether(2.95), ether(0.005))).to.be.true;
        expect(bigNumberCloseTo(tokenTwoBalanceAfterRebalance, ether(2), ether(0.005))).to.be.true;
    });

});