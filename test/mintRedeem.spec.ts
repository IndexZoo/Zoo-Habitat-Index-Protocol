import "module-alias/register";

import { BigNumber } from "ethers";

import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, ZERO, ONE } from "@utils/constants";
import { BasicIssuanceModule, Controller, SetTokenCreator, StandardTokenMock } from "@utils/contracts";
import {
  getWaffleExpect,
  getAccounts,
} from "@utils/test/index";
import { ethers } from "hardhat";
import { Controller__factory } from "@typechain/factories/Controller__factory";
import { SetTokenCreator__factory } from "@typechain/factories/SetTokenCreator__factory";
import { StandardTokenMock__factory } from "@typechain/factories/StandardTokenMock__factory";
import { ether } from "@utils/common/unitsUtils";
import { BasicIssuanceModule__factory } from "@typechain/factories/BasicIssuanceModule__factory";
const expect = getWaffleExpect();

describe("BasicIssuanceModule", () => {
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
  let basicIssuanceModule: BasicIssuanceModule;

  let ControllerContract: Controller__factory;
  let SetTokenCreatorContract: SetTokenCreator__factory;
  let StandardTokenMockContract: StandardTokenMock__factory;
  let BasicIssuanceModuleContract: BasicIssuanceModule__factory;


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
   
  describe("BasicIssuanceModule - user mints (issues) and redeems via BasicIssuanceModule", async function () {
    let tokensetAddress: string;
    let abi: Array<string>;
    beforeEach(async () => {
      ControllerContract = await ethers.getContractFactory("Controller");
      SetTokenCreatorContract = await ethers.getContractFactory("SetTokenCreator");
      StandardTokenMockContract = await ethers.getContractFactory("StandardTokenMock");
      BasicIssuanceModuleContract = await ethers.getContractFactory("BasicIssuanceModule");

      controller = await ControllerContract.deploy(feeRecipient.address);
      setTokenCreator = await SetTokenCreatorContract.deploy(controller.address);
      basicIssuanceModule = await BasicIssuanceModuleContract.deploy(controller.address);

      tokenMock1 = await StandardTokenMockContract.deploy(owner.address, ether(1000000), "Token1", "TOK1", 18);
      tokenMock2 = await StandardTokenMockContract.deploy(owner.address, ether(1000000), "Token2", "TOK2", 18);

      await tokenMock1.transfer(mockUser.address, ether(100));
      await tokenMock2.transfer(mockUser.address, ether(100));

      await tokenMock1.connect(mockUser.wallet).approve(basicIssuanceModule.address, ether(100));
      await tokenMock2.connect(mockUser.wallet).approve(basicIssuanceModule.address, ether(100));

      await controller.initialize([setTokenCreator.address], [basicIssuanceModule.address], [], []);
      const setTokenReceipt =  await (await setTokenCreator.create(
        [tokenMock1.address, tokenMock2.address],
        [ether(10), ether(20)],
        [basicIssuanceModule.address], owner.address,
        "indexzoo", "ZOO")).wait();
      const event = setTokenReceipt.events?.find(p => p.event == "SetTokenCreated");
      tokensetAddress = event? event.args? event.args[0]:"":"";
      
      abi = [ "function name() public view returns (string memory)",
        "function symbol() public view returns (string memory)",
        "function addModule(address _module) external",
        "function getModules() external view returns (address[] memory)",
        "function initializeModule() external",
        "function balanceOf(address account) public view returns (uint256)"
      ];  
    });

    it("ensure controller is properly deployed", async () => {
      expect(controller.address).to.not.equal(ADDRESS_ZERO) ;
      expect(basicIssuanceModule.address).to.not.equal(ADDRESS_ZERO);
    });
    it("construct  a new Tokenset via SetTokenCreator and issue new tokens by a mockUser", async () => {
      
      const deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);
      await basicIssuanceModule.initialize(deployedSetToken.address, ADDRESS_ZERO);
      expect ((await deployedSetToken.getModules())[0]).to.be.equal(basicIssuanceModule.address);
      
      // TODO: Fathom how the quantities are calculated
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(1), mockUser.address);
      expect(await deployedSetToken.balanceOf(mockUser.address)).to.eq(ether(1)); 
      expect(await tokenMock1.balanceOf(mockUser.address)).to.eq(ether(100).sub(ether(10)));
      expect(await tokenMock2.balanceOf(mockUser.address)).to.eq(ether(100).sub(ether(20)));  
    });
    it("issue new tokens by a mockUser repeatedly until balance is insufficient", async () => {
      
      const deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);
      await basicIssuanceModule.initialize(deployedSetToken.address, ADDRESS_ZERO);
      expect ((await deployedSetToken.getModules())[0]).to.be.equal(basicIssuanceModule.address);
      
      let quantity = 4;
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(quantity), mockUser.address);
      expect(await deployedSetToken.balanceOf(mockUser.address)).to.eq(ether(quantity)); 
      expect(await tokenMock1.balanceOf(mockUser.address)).to.eq(ether(100).sub(ether(quantity*10)));
      expect(await tokenMock2.balanceOf(mockUser.address)).to.eq(ether(100).sub(ether(quantity*20))); 
      quantity = 1;
      // should be insufficient funds in here
      await expect(basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(1).add(1), mockUser.address)).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      
      // this issue (minting) should go successfully as there are sufficient funds
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(quantity), mockUser.address);
      expect(await deployedSetToken.balanceOf(mockUser.address)).to.eq(ether(5)); 
      expect(await tokenMock1.balanceOf(mockUser.address)).to.eq(ether(100-40).sub(ether(quantity*10)));
      expect(await tokenMock2.balanceOf(mockUser.address)).to.eq(ether(0)); 
    });
    //  Test the redeem
    it("issue new tokens by a mockUser then do a redeem of 2 setTokens (= 20token1 + 40token2)", async () => {
      
      const deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);
      await basicIssuanceModule.initialize(deployedSetToken.address, ADDRESS_ZERO);
      
      let quantity = 4;
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(quantity), mockUser.address);
      expect(await deployedSetToken.balanceOf(mockUser.address)).to.eq(ether(quantity)); 
      expect(await tokenMock1.balanceOf(mockUser.address)).to.eq(ether(100).sub(ether(quantity*10)));
      expect(await tokenMock2.balanceOf(mockUser.address)).to.eq(ether(100).sub(ether(quantity*20))); 
      
      // Do a redeem for 2 of the deployed settokens to the mockUser by the mockUser as sender
      await basicIssuanceModule.connect(mockUser.wallet).redeem(deployedSetToken.address, ether(2), mockUser.address);
      expect(await deployedSetToken.balanceOf(mockUser.address)).to.eq(ether(2));  // only 2 setTokens remains
      expect(await tokenMock1.balanceOf(mockUser.address)).to.eq(ether(80));
      expect(await tokenMock2.balanceOf(mockUser.address)).to.eq(ether(60));
    });
  });
});