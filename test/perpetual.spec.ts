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
import { PerpetualFixture } from "@utils/fixtures/perpetualFixture";
import { BigNumber } from "ethers";

// TODO: write a fixture for perpetual
// TODO: test the fixture 
// TODO: solidity perpetual module
// TODO: test the module

const expect = getWaffleExpect();
const EXCHANGE_ID = {NONE: 0, UNISWAP: 1, SUSHI: 2, BALANCER: 3, LAST: 4};

describe("Perpetual Contracts  ... ", () => {
    let setup: TestSetup;
    let user: Account;
    let tokenset: SetToken;
    beforeEach(async () => {
        setup = new TestSetup();
        await setup.initialize();
        user = setup.accounts.user;
        tokenset = setup.tokensets[0];
    });

    it("Testing Perpetual Fixture ... ", async () => {
      expect (await setup.perpetualFixture.contracts.metaTxGateway.getNonce(user.address)).to.eq(ether(0));

    });
});