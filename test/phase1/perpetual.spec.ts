import "module-alias/register";

import {ethers} from "hardhat";
import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import {
  getWaffleExpect,
} from "@utils/test/index";
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { TestSetup } from "@utils/test/testSetup";
import { Account } from "@utils/test/types";
import { SetToken } from "@typechain/SetToken";
import { bigNumberCloseTo } from "@utils/test/helpers";
import { Contracts as PerpContracts, PerpetualFixture } from "@utils/fixtures/perpetualFixture";
import { BigNumber } from "ethers";
import { PerpetualProtocolModule } from "@typechain/PerpetualProtocolModule";
import { PerpV2Fixture } from "@utils/fixtures/perpV2Fixture";
import { StandardTokenMock } from "@typechain/StandardTokenMock";
import { PerpV2BaseToken } from "@typechain/PerpV2BaseToken";
import {usdc as usdcUnits} from "@utils/index";

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
const ZERO = BigNumber.from(0);



describe("Perpetual Contracts  ... ", () => {
    let setup: TestSetup;
    let perpV2Fixture: PerpV2Fixture;
    let subjectModule: PerpetualProtocolModule;
    let owner: Account;
    let trader: Account;
    let maker: Account;
    let bob: Account;
    let tokenset: SetToken;
    let perpContracts: PerpContracts;
    let usdc: StandardTokenMock;
    let vETH: PerpV2BaseToken;
    let vBTC: PerpV2BaseToken;
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
        owner = setup.accounts.owner;
        maker = setup.accounts.users[0];
        bob  = setup.accounts.users[1];
        trader = setup.accounts.user;  // trader

        perpV2Fixture = new PerpV2Fixture(ethers.provider, owner.address);
        await perpV2Fixture.initialize(maker, trader); // this call involves trader depositing big amount to vault
        usdc = perpV2Fixture.usdc;
       // initiate perpModule and hook it with controller  and tokenset
        subjectModule =   await (await ethers.getContractFactory("PerpetualProtocolModule")).deploy(
          setup.contracts.controller.address,
          perpV2Fixture.clearingHouse.address,
          perpV2Fixture.exchange.address,
          perpV2Fixture.usdc.address
        );
        await setup.contracts.controller.addModule(subjectModule.address);
        await setup.createSetToken(
          [usdc.address],
          [usdcUnits(1)],
          owner.address,
          "IndexZoo",
          "ZOO"
        );
        tokenset = setup.tokensets[setup.tokensets.length-1];
        await tokenset.addModule(subjectModule.address);
        await subjectModule.initialize(tokenset.address);
        // ------
        await perpV2Fixture.usdc.connect(bob.wallet).approve(setup.contracts.basicIssuanceModule.address, MAX_UINT_256);
        await perpV2Fixture.usdc.mint(bob.address, usdcUnits(1000));

        await setup.issue(tokenset.address, bob, ether(400));

        // ----- set perp configuration ---
        // set funding rate to zero; allows us to avoid calculating small amounts of funding
        // accrued in our test cases
        await perpV2Fixture.clearingHouseConfig.setMaxFundingRate(ZERO);

        vETH = perpV2Fixture.vETH;
        vBTC = perpV2Fixture.vBTC;

        // Create liquidity
        await perpV2Fixture.setBaseTokenOraclePrice(vETH, usdcUnits(10));
        await perpV2Fixture.initializePoolWithLiquidityWide(
          vETH,
          ether(10_000),
          ether(100_000)
        );

        await perpV2Fixture.setBaseTokenOraclePrice(vBTC, usdcUnits(20));
        await perpV2Fixture.initializePoolWithLiquidityWide(
          vBTC,
          ether(10_000),
          ether(200_000)
        );
        await setup.contracts.integrationRegistry.addIntegration(
          subjectModule.address,
          "DefaultIssuanceModule",
          setup.contracts.basicIssuanceModule.address
        );
       // --------------------------------------
 
    };
    beforeEach(async () => {
      await globalBeforeEachHook();
    });

    describe ("Testing setup and perpetual fixture", async () => {
      it ("Check that perpetual module is properly setup with other contracts ", async () =>{
        expect(await tokenset.getModules()).contains(subjectModule.address);   // tokenset contains the subject module
        expect(await tokenset.moduleStates(subjectModule.address)).to.equal(2); // subject module is in Ready state
      });

      it("", async () => {
        const response = await perpV2Fixture.clearingHouse.connect(trader.wallet).callStatic.openPosition({
          baseToken: vETH.address,
          isBaseToQuote: false,    // Direction is buy BaseToken
          isExactInput: true,      // Input determined is for Quote Token
          oppositeAmountBound: 0,
          amount: ether(1),
          sqrtPriceLimitX96: 0,
          deadline: ethers.constants.MaxUint256,
          referralCode: ethers.constants.HashZero,
        });
        expect(response.base).to.be.approx(ether(0.099)); // 0.1 - fee ~ 0.1 - 0.001 
        expect(response.quote).to.eq(ether(1));
      });

      it("increase ? position when exact input", async () => {
        // trader swap 1 USD for ? ETH
        let tx = () => perpV2Fixture.clearingHouse.connect(trader.wallet).openPosition({
            baseToken: vETH.address,
            isBaseToQuote: false,
            isExactInput: true,
            oppositeAmountBound: 0,
            amount: ether(1),
            sqrtPriceLimitX96: 0,
            deadline: ethers.constants.MaxUint256,
            referralCode: ethers.constants.HashZero,
          });
        await expect(tx())
        .to.emit(perpV2Fixture.clearingHouse, "PositionChanged")
        .withArgs(
          trader.address, // trader
          vETH.address, // baseToken,
          "98999019909702893",   // amount eth received --- expected ~ eth(0.1) - eth(0.001)
          ether(-0.99), // exchangedPositionNotional
          ether(0.01), // fee = 1 * 0.01
          ether(-1), // openNotional
          ether(0), // realizedPnl
          "250543928735386844160932504391" 
        );
        const baseBalance = await perpV2Fixture.accountBalance.getTakerPositionSize(
          trader.address,
          vETH.address,
        );
        expect(baseBalance).to.be.eq(
          "98999019909702893"
        );
      });
      it("increase 1 long position when exact output", async () => {
        // taker swap ? USD for 1 ETH -> quote to base -> fee is charged before swapping
        //   exchanged notional = 71.9062751863 * 10884.6906588362 / (71.9062751863 - 1) - 10884.6906588362 = 153.508143394
        //   taker fee = 153.508143394 / 0.99 * 0.01 = 1.550587307
        await expect(
          perpV2Fixture.clearingHouse.connect(trader.wallet).openPosition({
            baseToken: vETH.address,
            isBaseToQuote: false,
            isExactInput: false,   // Amount refers to BaseToken
            oppositeAmountBound: 0,
            amount: ether(1),
            sqrtPriceLimitX96: 0,
            deadline: ethers.constants.MaxUint256,
            referralCode: ethers.constants.HashZero,
          }),
        )
        .to.emit(perpV2Fixture.clearingHouse, "PositionChanged")
        .withArgs(
          trader.address, // trader
          vETH.address, // baseToken
          ether(1), // exchangedPositionSize
          "-10001000100010001001", // exchangedPositionNotional   ~ ether(10)
          "101020203030404051", // fee    ~ ether(0.1)
          "-10102020303040405052", // openNotional    ~ ether(-10)
          ether(0), // realizedPnl
          "250566505025550486235036874161" // sqrtPriceAfterX96
        );
         const baseBalance = await perpV2Fixture.accountBalance.getTakerPositionSize(
          trader.address,
          vETH.address,
        );
        expect(baseBalance).to.be.eq(
          ether(1) 
        );  
      });
      it.only("increase position from 0, exact input", async () => {
        // taker swap 1 ETH for ? USD -> base to quote -> fee is included in exchangedNotional
        //   taker exchangedNotional = 10884.6906588362 - 71.9062751863 * 10884.6906588362 / (71.9062751863 + 1) = 149.2970341856
        //   taker fee = 149.2970341856 * 0.01 = 1.492970341856
        // taker swap 1 ETH for ? USD
        await expect(
          perpV2Fixture.clearingHouse.connect(trader.wallet).openPosition({
            baseToken: vETH.address,
            isBaseToQuote: true,   // Sell base for usdc
            isExactInput: true,     // Amount entered refers to BaseToken (i.e. vETH)
            oppositeAmountBound: 0,
            amount: ether(1),
            sqrtPriceLimitX96: 0,
            deadline: ethers.constants.MaxUint256,
            referralCode: ethers.constants.HashZero,
          }),
        )
        .to.emit(perpV2Fixture.clearingHouse, "PositionChanged")
        .withArgs(
          trader.address, // trader
          vETH.address, // baseToken
          ether(-1), // exchangedPositionSize
          "9999000099990000999", // exchangedPositionNotional  ~ ether(10) - fee
          "99990000999900010", // fee: exchangedPositionNotional * 0.01 = 1.492970341857328777
          "9899010098990100989", // openNotional
          ether(0), // realizedPnl
          "250516396735374393747039528626", // sqrtPriceAfterX96
        );
        // const [baseBalance, quoteBalance] = await clearingHouse.getTokenBalance(
        //             taker.address,
        //             baseToken.address,
        //         )

        //         expect(baseBalance).be.deep.eq(parseEther("-1"))
        //         expect(quoteBalance).be.gt(parseEther("0"))

        //         expect(await getMakerFee()).be.closeTo(parseEther("1.492970341857328777"), 1)
      });

            // it("increase position from 0, exact output", async () => {
            //     // taker swap ? ETH for 1 USD -> base to quote -> fee is included in exchangedNotional
            //     //   taker exchangedNotional = 71.9062751863 - 71.9062751863 * 10884.6906588362 / (10884.6906588362 - 1)
            //     //                           = -0.006606791523
            //     //   taker fee = 1 / (0.99) * 0.01 = 0.0101010101

            //     // taker swap ? ETH for 1 USD
            //     await expect(
            //         clearingHouse.connect(taker).openPosition({
            //             baseToken: baseToken.address,
            //             isBaseToQuote: true,
            //             isExactInput: false,
            //             oppositeAmountBound: 0,
            //             amount: parseEther("1"),
            //             sqrtPriceLimitX96: 0,
            //             deadline: ethers.constants.MaxUint256,
            //             referralCode: ethers.constants.HashZero,
            //         }),
            //     )
            //         .to.emit(clearingHouse, "PositionChanged")
            //         .withArgs(
            //             taker.address, // trader
            //             baseToken.address, // baseToken
            //             parseEther("-0.006673532984759078"), // exchangedPositionSize
            //             parseEther("1.010101010101010102"), // exchangedPositionNotional
            //             parseEther("0.010101010101010102"), // fee
            //             parseEther("1"), // openNotional
            //             parseEther("0"), // realizedPnl
            //             "974684205576916525762591342066", // sqrtPriceAfterX96
            //         )

            //     const [baseBalance, quoteBalance] = await clearingHouse.getTokenBalance(
            //         taker.address,
            //         baseToken.address,
            //     )
            //     expect(baseBalance).be.lt(parseEther("0"))
            //     expect(quoteBalance).be.deep.eq(parseEther("1"))

            //     expect(await getMakerFee()).be.closeTo(parseEther("0.010101010101010102"), 1)
            //     expect(await accountBalance.getTakerPositionSize(taker.address, baseToken.address)).to.be.eq(
            //         parseEther("-0.006673532984759078"),
            //     )
            // })
      it("check perpetual openPosition", async () => {
      //   await perpContracts.quoteCoin.connect(user.wallet).approve(
      //     perpContracts.clearingHouse.address,
      //     ether(60)
      //   );
      //   await perpContracts.clearingHouse.connect(user.wallet).openPosition(
      //     perpContracts.amm.address,
      //     1,
      //     toDecimal(ether(60)),
      //     toDecimal(ether(10)),
      //     toDecimal(ether(150))
      //   );

      //   await perpContracts.priceFeed.setTwapPrice(ether(2.1));
      //         // when the new fundingRate is -50% which means underlyingPrice < snapshotPrice
      //   await gotoNextFundingTime();
      //   await perpContracts.clearingHouse.payFunding(perpContracts.amm.address);
      //   let bn = (await perpContracts.clearingHouse.getLatestCumulativePremiumFraction(
      //     perpContracts.amm.address)
      //   );
      //   expect(bn.d).to.eq(ether(-0.5));
      //   // then alice need to pay 150 * 50% = $75
      //   // {size: -150, margin: 300} => {size: -150, margin: 0}
      //   const userPosition = await perpContracts.clearingHouseViewer.getPersonalPositionWithFundingPayment(
      //     perpContracts.amm.address, user.address
      //   );
      //   expect(userPosition.size.d).to.eq(ether(-150));
      //   expect(userPosition.margin.d) .to.eq(ether(0));
      });
    });
  //  describe("PerpetualProtocolModule - openPosition", () => {
  //     it("getLatesCumulativePrepiumFraction - return 0 margin when position is underwater", async () =>{
  //       await setup.contracts.perpetualProtocolModule.trade(
  //         1, 
  //         ether(60), 
  //         ether(10),
  //         ether(150)
  //     );
  //     await perpContracts.priceFeed.setTwapPrice(ether(2.1));
  //       // when the new fundingRate is -50% which means underlyingPrice < snapshotPrice
  //       await gotoNextFundingTime();
  //       await perpContracts.clearingHouse.payFunding(perpContracts.amm.address);
  //       let bn = (await perpContracts.clearingHouse.getLatestCumulativePremiumFraction(
  //         perpContracts.amm.address)
  //       );
  //       expect(bn.d).to.eq(ether(-0.5));
  //       // then alice need to pay 150 * 50% = $75
  //       // {size: -150, margin: 300} => {size: -150, margin: 0}

  //       const setTokenPosition = await perpContracts.clearingHouseViewer.getPersonalPositionWithFundingPayment(
  //         perpContracts.amm.address, tokenset.address
  //       );
  //       expect(setTokenPosition.size.d).to.eq(ether(-150));
  //       expect(setTokenPosition.margin.d) .to.eq(ether(0));
  //     });
  //  });
  //  describe("PerpetualProtocolModule - openInterestNotional", () => {
  //     beforeEach(async () => {
  //       await perpContracts.amm.setCap(toDecimal(0), toDecimal(ether(600)))
  //     });
 
  //     it("increase when increase position", async () => {
  //       await setup.contracts.perpetualProtocolModule.trade(
  //           Side.BUY, 
  //           ether(600), 
  //           ether(1),
  //           ether(0)
  //       );
  //       expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).to.eq(ether(600))
  //     });
  //       it("reduce when reduce position by executing trade in opposite direction", async () => {
  //           await subjectModule.trade(Side.BUY, ether(600), ether(1), 0);
  //           await subjectModule.trade(Side.SELL, ether(300), ether(1), 0);

  //           expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(300))
  //       });

  //       it("reduce position when trade is closed by Manager", async () => {
  //           await subjectModule.trade(Side.BUY, ether(400), ether(1), 0);

  //           await subjectModule.closeTrade(ether(0));

  //           // expect the result will be almost 0 (with a few rounding error)
  //           const openInterestNotional = await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address);
  //           expect(openInterestNotional.toNumber()).lte(10);
  //       });

  //       it("increase when traders open positions in different direction", async () => {
  //           await subjectModule.trade( Side.BUY, ether(300), ether(1), ether(0));
  //           await subjectModule.trade(Side.SELL, ether(100), ether(1), ether(0) );
  //           expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(200))
  //       });
  //       it("increase when traders open larger position in reverse direction", async () => {
  //           await subjectModule.trade(Side.BUY, ether(250), ether(1), ether(0));
  //           await subjectModule.trade( Side.SELL, ether(450), ether(1), ether(0));
  //           expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(200));
  //       })

  //       it.skip("is 0 when everyone close position", async () => {
  //           // avoid two closing positions from exceeding the fluctuation limit
  //           await perpContracts.amm.setFluctuationLimitRatio(toDecimal(ether(0.8)));

  //           await subjectModule.trade(Side.BUY, ether(250), ether(1), ether(0));
  //           await subjectModule.trade(Side.SELL, ether(250), ether(1), ether(0));

  //           await subjectModule.closeTrade( ether(0));
  //           await subjectModule.closeTrade( ether(0));

  //           // expect the result will be almost 0 (with a few rounding error)
  //           const openInterestNotional = await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)
  //           expect(openInterestNotional.toNumber()).lte(10);
  //       });

  //       it.skip("is 0 when everyone close position, one of them is bankrupt position", async () => {
  //           await subjectModule.trade(Side.SELL, ether(250), ether(1), ether(0));
  //           await   subjectModule.trade(Side.BUY, ether(250), ether(1), ether(0));

  //           // when alice close, it create bad debt (bob's position is bankrupt)
  //           await subjectModule.closeTrade(ether(0));

  //           // bypass the restrict mode
  //           await forwardBlockTimestamp(15);
  //           await subjectModule.closeTrade(ether(0));

  //           // expect the result will be almost 0 (with a few rounding error)
  //           const openInterestNotional = await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)
  //           expect(openInterestNotional.toNumber()).lte(10)
  //       });

  //       it("stop trading if it's over openInterestCap", async () => {
  //           await subjectModule.trade(Side.BUY, ether(600), ether(1), ether(0));
  //           await expect(
  //               subjectModule.trade(Side.BUY, ether(1), ether(1), ether(0))
  //           ).to.be.revertedWith("over limit");
  //       });

  //       it("won't be limited by the open interest cap if the trader is the whitelist", async () => {
  //           await perpContracts.clearingHouse.setWhitelist(tokenset.address);
  //           await subjectModule.trade(Side.BUY, ether(700), ether(1), ether(0));
  //           expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(700))
  //       })

  //       it("won't stop trading if it's reducing position, even it's more than cap", async () => {
  //           await perpContracts.clearingHouse.setWhitelist(tokenset.address);
  //           await subjectModule.trade(Side.BUY, ether(600), ether(1), ether(0));
  //           await perpContracts.amm.setCap(toDecimal(ether(0)), toDecimal(ether(300)));
  //           await subjectModule.trade(Side.SELL, ether(300), ether(1), ether(0));
  //           expect(await perpContracts.clearingHouse.openInterestNotionalMap(perpContracts.amm.address)).eq(ether(300))
  //       });
  //   });

  //  describe("PerpetualProtocolModule - add/remove margin", () => {
  //     let initDeposit = 60;
  //       beforeEach(async () => {
  //           await subjectModule.trade(Side.BUY, ether(initDeposit), ether(10), ether(17.5));
  //       });

  //     it("add margin", async () => {
  //       let addedMargin = 80;
  //           const tx = () =>  subjectModule.addMargin( ether(addedMargin));
  //           await expect(tx())
  //           .to.emit(perpContracts.clearingHouse, "MarginChanged").withArgs( 
  //               tokenset.address,
  //               perpContracts.amm.address,
  //               ether(addedMargin),
  //               "0",
  //           )
  //           .to.emit(perpContracts.quoteCoin, "Transfer").withArgs( 
  //               tokenset.address,
  //               perpContracts.clearingHouse.address,
  //               ether(addedMargin),
  //           );
  //           let tokensetPosition = (await perpContracts.clearingHouse.getPosition(perpContracts.amm.address, tokenset.address)).margin.d;
  //           let  tokensetBalanceWithFundingPayment = (await perpContracts.clearingHouseViewer.getPersonalBalanceWithFundingPayment(perpContracts.quoteCoin.address, tokenset.address)).d;

          
  //           expect(tokensetPosition).to.eq(ether(initDeposit+addedMargin));
  //           expect(tokensetBalanceWithFundingPayment).to.eq(
  //               ether(initDeposit+addedMargin),
  //           );
  //     });
  //    it("remove margin", async () => {
  //           // remove margin 20
  //           let removedMargin = 20;
  //           const tx = () => subjectModule.removeMargin(ether(removedMargin));
  //           await expect(tx())
  //           .to.emit( perpContracts.clearingHouse, "MarginChanged")
  //           .withArgs( 
  //               tokenset.address,
  //               perpContracts.amm.address,
  //               ether(-removedMargin),
  //               "0",
  //           )
  //           .to.emit(perpContracts.quoteCoin, "Transfer")
  //           .withArgs( 
  //               perpContracts.clearingHouse.address,
  //               tokenset.address,
  //               ether(removedMargin),
  //           );
  //           let tokensetPosition = (await perpContracts.clearingHouse.getPosition(perpContracts.amm.address, tokenset.address)).margin.d;
  //           let  tokensetBalanceWithFundingPayment = (await perpContracts.clearingHouseViewer.getPersonalBalanceWithFundingPayment(perpContracts.quoteCoin.address, tokenset.address)).d;

          
  //           expect(tokensetPosition).to.eq(ether(initDeposit - removedMargin));
  //           expect(tokensetBalanceWithFundingPayment).to.eq(
  //               ether(initDeposit - removedMargin),
  //           );
  //       });
  //       it("remove margin after pay funding", async () => {
  //           // given the underlying twap price is 25.5, and current snapShot price is 1600 / 62.5 = 25.6
  //           await perpContracts.priceFeed.setTwapPrice(ether(25.5));

  //           // when the new fundingRate is 10% which means underlyingPrice < snapshotPrice
  //           await gotoNextFundingTime();
  //           await perpContracts.clearingHouse.payFunding(perpContracts.amm.address);
  //           let latestCumulativePremiumFraction = await perpContracts.clearingHouse.getLatestCumulativePremiumFraction(perpContracts.amm.address);
  //           expect(latestCumulativePremiumFraction.d).to.eq(ether(0.1));

  //           // remove margin 20
  //           const tx = () => subjectModule.removeMargin( ether(20));
  //           await expect(tx())
  //           .to.emit(perpContracts.clearingHouse, "MarginChanged")
  //           .withArgs(
  //               tokenset.address,
  //               perpContracts.amm.address,
  //               ether(-20),
  //               ether(3.75),
  //           );
  //       });
  //       it("Force error, remove margin - not enough position margin", async () => {
  //           // margin is 60, try to remove more than 60
  //           const removedMargin = 61;
  //           const tx = () => subjectModule.removeMargin(ether(removedMargin));

  //           await expect(tx())
  //           .to.be.revertedWith("margin is not enough");
  //       });
  //       it ("Force error, remove margin - not enough ratio (4%)", async () => {
  //           const removedMargin = 36;

  //           // remove margin 36
  //           // remain margin -> 60 - 36 = 24
  //           // margin ratio -> 24 / 600 = 4%
  //           await expect(
  //               subjectModule.removeMargin(ether(removedMargin))
  //           ).to.be.revertedWith("Margin ratio not meet criteria");
  //       });
  //     });
  //     describe("PerpetualProtocolModule - add/remove margin", () => {
  //       it("get margin ratio", async () => {
  //           await subjectModule.trade( Side.BUY, ether(25), ether(10), ether(20));

  //           const marginRatio = await perpContracts.clearingHouse.getMarginRatio(perpContracts.amm.address, tokenset.address);
  //           expect(marginRatio.d).to.eq(ether(0.1));
  //       });
  //       it.only("get margin ratio - long", async () => {

  //           // (1000 + x) * (100 + y) = 1000 * 100
  //           //
  //           // Alice goes long with 25 quote and 10x leverage
  //           // open notional: 25 * 10 = 250
  //           // (1000 + 250) * (100 - y) = 1000 * 100
  //           // y = 20
  //           // AMM: 1250, 80
  //           await subjectModule.trade(Side.BUY, ether(25), ether(10), ether(20));

  //           // Bob goes short with 15 quote and 10x leverage
  //           // (1250 - 150) * (80 + y) = 1000 * 100
  //           // y = 10.9090909091
  //           // AMM: 1100, 90.9090909091
  //           await subjectModule.trade(Side.SELL, ether(15), ether(10), ether(0));

  //           // (1100 - x) * (90.9090909091 + 20) = 1000 * 100
  //           // position notional / x : 1100 - 901.6393442622 = 198.3606
  //           // unrealizedPnl: 198.3606 - 250 (open notional) = -51.6394
  //           // margin ratio:  (25 (margin) - 51.6394) / 198.3606 ~= -0.1342978394
  //           const marginRatio = await perpContracts.clearingHouse.getMarginRatio(perpContracts.amm.address, tokenset.address);
  //           expect(marginRatio.d).to.eq("-134297520661157024");
  //       });
  //     });
 
});