import "module-alias/register";


import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import {
  getWaffleExpect,
} from "@utils/test/index";
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { TestSetup } from "@utils/test/testSetup";
import { RewardsDistribution } from "@typechain/RewardsDistribution";
import { Account } from "@utils/test/types";
import { SetToken } from "@typechain/SetToken";
import { bigNumberCloseTo } from "@utils/test/helpers";
import { Contracts as PerpContracts, PerpetualFixture } from "@utils/fixtures/perpetualFixture";
import { BigNumber } from "ethers";
import { PerpetualProtocolModule } from "@typechain/PerpetualProtocolModule";

// TODO: get functions from IClearingHouse
// TODO: solidity perpetual module
// TODO: test the module

const expect = getWaffleExpect();
const EXCHANGE_ID = {NONE: 0, UNISWAP: 1, SUSHI: 2, BALANCER: 3, LAST: 4};
const toDecimal = (num: number | BigNumber) => {
  return {d: num};
};
enum Side {
  BUY = 0,
  SELL = 1
};



describe("Perpetual Contracts  ... ", () => {
    let setup: TestSetup;
    let user: Account;
    let bob: Account;
    let tokenset: SetToken;
    let perpContracts: PerpContracts;
    let subjectModule: PerpetualProtocolModule;
    let gotoNextFundingTime = async (): Promise<void> => {
      await perpContracts.amm.mock_setBlockTimestamp(
        await perpContracts.amm.nextFundingTime()
      );
    };
    let forwardBlockTimestamp = async (time: number): Promise<void> => {
        const now = await perpContracts.supplySchedule.mock_getCurrentTimestamp();
        const newTime = now.add(time);  // FIXME: might be addn()
        await perpContracts.rewardsDistribution.mock_setBlockTimestamp(newTime);
        await perpContracts.amm.mock_setBlockTimestamp(newTime);
        await perpContracts.supplySchedule.mock_setBlockTimestamp(newTime);
        await perpContracts.clearingHouse.mock_setBlockTimestamp(newTime);
        const movedBlocks = time / 15 < 1 ? 1 : time / 15

        const blockNumber = BigNumber.from(await perpContracts.amm.mock_getCurrentBlockNumber());
        const newBlockNumber = blockNumber.add(movedBlocks);  //FIXME: same as addn()  
        await perpContracts.rewardsDistribution.mock_setBlockNumber(newBlockNumber);
        await perpContracts.amm.mock_setBlockNumber(newBlockNumber);
        await perpContracts.supplySchedule.mock_setBlockNumber(newBlockNumber);
        await perpContracts.clearingHouse.mock_setBlockNumber(newBlockNumber);
    }
    let globalBeforeEachHook = async () => {
        setup = new TestSetup();
        await setup.initialize();
        tokenset = setup.tokensets[2];
        user = setup.accounts.user;
        bob = setup.accounts.users[0];
        subjectModule = setup.contracts.perpetualProtocolModule;

        perpContracts = setup.perpetualFixture.contracts;
        await setup.approveModule(user, setup.contracts.basicIssuanceModule.address);
        await setup.approveModule(bob, setup.contracts.basicIssuanceModule.address);

        await perpContracts.quoteCoin.mint(user.address, ether(10000));
        await setup.perpetualFixture.contracts.quoteCoin.mint(bob.address, ether(10000));
        await setup.issue(tokenset.address, user, ether(400));
        await setup.issue(tokenset.address, bob, ether(400));
 
    };
    beforeEach(async () => {
      await globalBeforeEachHook();
    });

    describe ("Testing Perpetual Fixture alone", async () => {
      it("Testing Perpetual Fixture deployment ... ", async () => {
        expect (await perpContracts.metaTxGateway.getNonce(user.address)).to.eq(ether(0));

      });
      it("check perpetual openPosition", async () => {
        await perpContracts.quoteCoin.connect(user.wallet).approve(
          perpContracts.clearingHouse.address,
          ether(60)
        );
        await perpContracts.clearingHouse.connect(user.wallet).openPosition(
          perpContracts.amm.address,
          1,
          toDecimal(ether(60)),
          toDecimal(ether(10)),
          toDecimal(ether(150))
        );

        await perpContracts.priceFeed.setTwapPrice(ether(2.1));
              // when the new fundingRate is -50% which means underlyingPrice < snapshotPrice
        await gotoNextFundingTime();
        await perpContracts.clearingHouse.payFunding(perpContracts.amm.address);
        let bn = (await perpContracts.clearingHouse.getLatestCumulativePremiumFraction(
          perpContracts.amm.address)
        );
        expect(bn.d).to.eq(ether(-0.5));
        // then alice need to pay 150 * 50% = $75
        // {size: -150, margin: 300} => {size: -150, margin: 0}
        const userPosition = await perpContracts.clearingHouseViewer.getPersonalPositionWithFundingPayment(
          perpContracts.amm.address, user.address
        );
        expect(userPosition.size.d).to.eq(ether(-150));
        expect(userPosition.margin.d) .to.eq(ether(0));
      });
    });
   describe("PerpetualProtocolModule - openPosition", () => {
      it("getLatesCumulativePrepiumFraction - return 0 margin when position is underwater", async () =>{
        await setup.contracts.perpetualProtocolModule.trade(
          1, 
          ether(60), 
          ether(10),
          ether(150)
      );
      await perpContracts.priceFeed.setTwapPrice(ether(2.1));
        // when the new fundingRate is -50% which means underlyingPrice < snapshotPrice
        await gotoNextFundingTime();
        await perpContracts.clearingHouse.payFunding(perpContracts.amm.address);
        let bn = (await perpContracts.clearingHouse.getLatestCumulativePremiumFraction(
          perpContracts.amm.address)
        );
        expect(bn.d).to.eq(ether(-0.5));
        // then alice need to pay 150 * 50% = $75
        // {size: -150, margin: 300} => {size: -150, margin: 0}

        const setTokenPosition = await perpContracts.clearingHouseViewer.getPersonalPositionWithFundingPayment(
          perpContracts.amm.address, tokenset.address
        );
        expect(setTokenPosition.size.d).to.eq(ether(-150));
        expect(setTokenPosition.margin.d) .to.eq(ether(0));
      });
   });
   describe("PerpetualProtocolModule - openInterestNotional", () => {
      beforeEach(async () => {
        await perpContracts.amm.setCap(toDecimal(0), toDecimal(ether(600)))
      });
 
      it("increase when increase position", async () => {
        await setup.contracts.perpetualProtocolModule.trade(
            Side.BUY, 
            ether(600), 
            ether(1),
            ether(0)
        );
        expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).to.eq(ether(600))
      });
        it("reduce when reduce position by executing trade in opposite direction", async () => {
            await subjectModule.trade(Side.BUY, ether(600), ether(1), 0);
            await subjectModule.trade(Side.SELL, ether(300), ether(1), 0);

            expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(300))
        });

        it("reduce position when trade is closed by Manager", async () => {
            await subjectModule.trade(Side.BUY, ether(400), ether(1), 0);

            await subjectModule.closeTrade(ether(0));

            // expect the result will be almost 0 (with a few rounding error)
            const openInterestNotional = await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address);
            expect(openInterestNotional.toNumber()).lte(10);
        });

        it("increase when traders open positions in different direction", async () => {
            await subjectModule.trade( Side.BUY, ether(300), ether(1), ether(0));
            await subjectModule.trade(Side.SELL, ether(100), ether(1), ether(0) );
            expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(200))
        });
        it("increase when traders open larger position in reverse direction", async () => {
            await subjectModule.trade(Side.BUY, ether(250), ether(1), ether(0));
            await subjectModule.trade( Side.SELL, ether(450), ether(1), ether(0));
            expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(200));
        })

        it.skip("is 0 when everyone close position", async () => {
            // avoid two closing positions from exceeding the fluctuation limit
            await perpContracts.amm.setFluctuationLimitRatio(toDecimal(ether(0.8)));

            await subjectModule.trade(Side.BUY, ether(250), ether(1), ether(0));
            await subjectModule.trade(Side.SELL, ether(250), ether(1), ether(0));

            await subjectModule.closeTrade( ether(0));
            await subjectModule.closeTrade( ether(0));

            // expect the result will be almost 0 (with a few rounding error)
            const openInterestNotional = await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)
            expect(openInterestNotional.toNumber()).lte(10);
        });

        it.skip("is 0 when everyone close position, one of them is bankrupt position", async () => {
            await subjectModule.trade(Side.SELL, ether(250), ether(1), ether(0));
            await   subjectModule.trade(Side.BUY, ether(250), ether(1), ether(0));

            // when alice close, it create bad debt (bob's position is bankrupt)
            await subjectModule.closeTrade(ether(0));

            // bypass the restrict mode
            await forwardBlockTimestamp(15);
            await subjectModule.closeTrade(ether(0));

            // expect the result will be almost 0 (with a few rounding error)
            const openInterestNotional = await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)
            expect(openInterestNotional.toNumber()).lte(10)
        });

        it("stop trading if it's over openInterestCap", async () => {
            await subjectModule.trade(Side.BUY, ether(600), ether(1), ether(0));
            await expect(
                subjectModule.trade(Side.BUY, ether(1), ether(1), ether(0))
            ).to.be.revertedWith("over limit");
        });

        it("won't be limited by the open interest cap if the trader is the whitelist", async () => {
            await perpContracts.clearingHouse.setWhitelist(tokenset.address);
            await subjectModule.trade(Side.BUY, ether(700), ether(1), ether(0));
            expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(700))
        })

        it("won't stop trading if it's reducing position, even it's more than cap", async () => {
            await perpContracts.clearingHouse.setWhitelist(tokenset.address);
            await subjectModule.trade(Side.BUY, ether(600), ether(1), ether(0));
            await perpContracts.amm.setCap(toDecimal(ether(0)), toDecimal(ether(300)));
            await subjectModule.trade(Side.SELL, ether(300), ether(1), ether(0));
            expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(300))
        });
    });

   describe("PerpetualProtocolModule - add/remove margin", () => {
        beforeEach(async () => {
            await subjectModule.trade(Side.BUY, ether(60), ether(10), ether(37.5));
        })
      it("increase when increase position", async () => {
        await setup.contracts.perpetualProtocolModule.trade(
            Side.BUY, 
            ether(600), 
            ether(1),
            ether(0)
        );
        
        expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).to.eq(ether(600))
      });
 

      it("add margin", async () => {
            const tx = () =>  subjectModule.addMargin( ether(80));
            await expect(tx())
            .to.emit(perpContracts.clearingHouse, "MarginChanged").withArgs( 
                tokenset.address,
                perpContracts.amm.address,
                ether(80),
                "0",
            )
            .to.emit(perpContracts.quoteCoin, "Transfer").withArgs( 
                tokenset.address,
                perpContracts.clearingHouse.address,
                ether(80),
            );
            let tokensetPosition = (await perpContracts.clearingHouse.getPosition(perpContracts.amm.address, tokenset.address)).margin.d;
            let  tokensetBalanceWithFundingPayment = (await perpContracts.clearingHouseViewer.getPersonalBalanceWithFundingPayment(perpContracts.quoteCoin.address, tokenset.address)).d;

          
            expect(tokensetPosition).to.eq(ether(140));
            expect(tokensetBalanceWithFundingPayment).to.eq(
                ether(140),
            );
      });
   });

});