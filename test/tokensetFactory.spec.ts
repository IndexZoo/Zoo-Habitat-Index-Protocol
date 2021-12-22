// tokensetFactory.spec.ts
// Owner creates tokenset via factory

import "module-alias/register";

import { BigNumber } from "ethers";

import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, ZERO, ONE } from "@utils/constants";
import { Controller, SetTokenCreator, StandardTokenMock } from "@utils/contracts";
import {
  getWaffleExpect,
  getAccounts,
} from "@utils/test/index";
import { ethers } from "hardhat";
import { Controller__factory } from "@typechain/factories/Controller__factory";
import { SetTokenCreator__factory } from "@typechain/factories/SetTokenCreator__factory";
import { StandardTokenMock__factory } from "@typechain/factories/StandardTokenMock__factory";
import { ether } from "@utils/common/unitsUtils";
const expect = getWaffleExpect();

describe("SetToken Factory", () => {
  let owner: Account;
  let feeRecipient: Account;
  let mockBasicIssuanceModule: Account;
  let mockSetTokenFactory: Account;
  let mockPriceOracle: Account;
  let mockSetToken: Account;
  let mockUser: Account;
  let mockManagerIssuanceHook: Account;
  let controller: Controller;
  let setTokenCreator: SetTokenCreator;
  let tokenMock1: StandardTokenMock;
  let tokenMock2: StandardTokenMock;

  let ControllerContract: Controller__factory;
  let SetTokenCreatorContract: SetTokenCreator__factory;
  let StandardTokenMockContract: StandardTokenMock__factory;


  beforeEach(async () => {
    [
      owner,
      feeRecipient,
      mockBasicIssuanceModule,
      mockSetTokenFactory,
      mockPriceOracle,
      mockSetToken,
      mockUser,
      mockManagerIssuanceHook
    ] = await getAccounts();

  });

  // NOTES:
  // - Despite that any account is allowed to create a new tokenset, owner can remove sets.

  describe("story1 - owner creates new tokenset via factory", async () => {


    beforeEach(async () => {
      ControllerContract = await ethers.getContractFactory("Controller");
      SetTokenCreatorContract = await ethers.getContractFactory("SetTokenCreator");
      StandardTokenMockContract = await ethers.getContractFactory("StandardTokenMock");

      controller = await ControllerContract.deploy(feeRecipient.address);
      setTokenCreator = await SetTokenCreatorContract.deploy(controller.address);

      tokenMock1 = await StandardTokenMockContract.deploy(owner.address, ether(1000000), "Token1", "TOK1", 18);
      tokenMock2 = await StandardTokenMockContract.deploy(owner.address, ether(1000000), "Token2", "TOK2", 18);

      await controller.initialize([setTokenCreator.address], [mockBasicIssuanceModule.address], [], []);
    });

    it("ensure controller is properly deployed", async () => {
      expect(controller.address).to.not.equal(ADDRESS_ZERO) ;
    });
    //  add mock tokens to components in setTokenCreator.create()
    //  get setToken address from events
    //  ensure setToken is abiding by ERC20
    it("construct  a new Tokenset via SetTokenCreator", async () => {
      const setTokenReceipt =  await (await setTokenCreator.create(
        [tokenMock1.address, tokenMock2.address],
        [ether(1), ether(2)],
        [mockBasicIssuanceModule.address], owner.address,
        "indexzoo", "ZOO")).wait();
      const abi = [ "function name() public view returns (string memory)",
        "function symbol() public view returns (string memory)"];
        // Retreive address of newly created tokenset
      const event = setTokenReceipt.events?.find(p => p.event == "SetTokenCreated");
      const tokensetAddress = event? event.args? event.args[0]:"":"";
      const deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);
      // ensuring deployedSetToken has a name and symbol as any proper IERC20
      expect(await deployedSetToken.name()).to.equal("indexzoo") ;
      expect(await deployedSetToken.symbol()).to.equal("ZOO") ;
    });

    it("non owner not allowed to create SetToken", async () => {
      const tx =   setTokenCreator.connect(mockUser.wallet).create(
        [tokenMock1.address, tokenMock2.address],
        [ether(1), ether(2)],
        [mockBasicIssuanceModule.address], owner.address,
        "indexzoo", "ZOO");
      await expect(tx).to.be.revertedWith('Ownable: caller is not the owner') ;
    });
  });
});