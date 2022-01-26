import "module-alias/register";


import { Account } from "@utils/test/types";
import { ADDRESS_ZERO } from "@utils/constants";
import { BasicIssuanceModule, 
  Controller, 
  SetTokenCreator, 
  StandardTokenMock,
  IntegrationRegistry,
    AaveWrapAdapter,// for aave
    WrapModule,
} from "@utils/contracts";
import {
  getWaffleExpect,
  getAccounts,
    getAaveFixture,//for aave
} from "@utils/test/index";
import { ethers } from "hardhat";
import { Controller__factory } from "@typechain/factories/Controller__factory";
import { SetTokenCreator__factory } from "@typechain/factories/SetTokenCreator__factory";
import { StandardTokenMock__factory } from "@typechain/factories/StandardTokenMock__factory";
import { ether } from "@utils/common/unitsUtils";
import { BasicIssuanceModule__factory } from "@typechain/factories/BasicIssuanceModule__factory";

//for aave
import { AaveWrapAdapter__factory } from "@typechain/factories/AaveWrapAdapter__factory";
import { AaveFixture } from "@utils/fixtures";

import { WrapModule__factory } from "@typechain/factories/WrapModule__factory";
import { IntegrationRegistry__factory } from "@typechain/factories/IntegrationRegistry__factory";
import {Contract} from "ethers";
import { WETH9__factory } from "@typechain/factories/WETH9__factory";

const expect = getWaffleExpect();
const INTEGRATION_REGISTRY_RESOURCE_ID = 0;

describe("Controller", () => {
  let owner: Account;
  let protocolFeeRecipient: Account;
  let mockUser: Account;

  let aEth: Contract ;
  let weth: Contract;
  let mockDai: StandardTokenMock;
  let amockDai: Contract ;

  let controller: Controller;
  let setTokenCreator: SetTokenCreator;
  let basicIssuanceModule: BasicIssuanceModule;
  let intergrationRegistry: IntegrationRegistry;
  let wrapModule: WrapModule;
  let aaveWrapAdapter: AaveWrapAdapter;
  let aaveFixture: AaveFixture;

  let ControllerContract: Controller__factory;
  let IntegrationRegistryContract: IntegrationRegistry__factory;
  let SetTokenCreatorContract: SetTokenCreator__factory;
  let StandardTokenMockContract: StandardTokenMock__factory;
  let BasicIssuanceModuleContract: BasicIssuanceModule__factory;
  let AaveWrapAdapterContract: AaveWrapAdapter__factory;
  let WrapModuleContract: WrapModule__factory;

  beforeEach(async () => {
    [
      owner,
      protocolFeeRecipient,
      mockUser,
    ] = await getAccounts();

  });


  describe("Owner needs to deposit and withdraw collateral inside Aave", async function () {
    let tokensetAddress: string;
    let abi: Array<string>;
    beforeEach(async () => {
        aaveFixture = getAaveFixture(owner.address);
      ControllerContract = await ethers.getContractFactory("Controller");
      IntegrationRegistryContract = await ethers.getContractFactory("IntegrationRegistry");
      SetTokenCreatorContract = await ethers.getContractFactory("SetTokenCreator");
      StandardTokenMockContract = await ethers.getContractFactory("StandardTokenMock");
      BasicIssuanceModuleContract = await ethers.getContractFactory("BasicIssuanceModule");

      AaveWrapAdapterContract = await ethers.getContractFactory("AaveWrapAdapter");
      WrapModuleContract = await ethers.getContractFactory("WrapModule");

      mockDai =  await StandardTokenMockContract.deploy(owner.address, ether(10000000), "MockDai", "MDAI", 18);
      weth = await new WETH9__factory(owner.wallet).deploy()
      await weth.connect(mockUser.wallet).deposit({value: ether(5000)});

      await  aaveFixture.initialize();

      amockDai = await aaveFixture.deployAToken(mockDai.address, 18)
      aEth = await aaveFixture.deployETHAToken();


      controller = await ControllerContract.deploy(protocolFeeRecipient.address);
      intergrationRegistry = await IntegrationRegistryContract.deploy(controller.address);
      setTokenCreator = await SetTokenCreatorContract.deploy(controller.address);
      basicIssuanceModule = await BasicIssuanceModuleContract.deploy(controller.address);

      aaveWrapAdapter = await AaveWrapAdapterContract.deploy(aaveFixture.lendingPool.address);
      wrapModule = await  WrapModuleContract.deploy(controller.address, weth.address);

      await mockDai.transfer(mockUser.address, ether(100));

      await mockDai.connect(mockUser.wallet).approve(basicIssuanceModule.address, ether(10));
      await weth.connect(mockUser.wallet).approve(basicIssuanceModule.address, ether(5000))

      await controller.initialize([setTokenCreator.address],
        [basicIssuanceModule.address, wrapModule.address],
        [intergrationRegistry.address], 
        [INTEGRATION_REGISTRY_RESOURCE_ID]);
      await intergrationRegistry.addIntegration(wrapModule.address, "AaveWrapAdapter", aaveWrapAdapter.address);

      const setTokenReceipt =  await (await setTokenCreator.create(
        [mockDai.address, weth.address],
        [ ether(10), ether(10)],
        [basicIssuanceModule.address, wrapModule.address],
          owner.address,
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
    });

    it("should not permit  aave deposits and aave withdrawals from a normal user", async () => {

      const deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);

      await basicIssuanceModule.initialize(deployedSetToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(deployedSetToken.address);

      //modules are correct
      expect ((await deployedSetToken.getModules())[0]).to.be.equal(basicIssuanceModule.address);
      expect ((await deployedSetToken.getModules())[1]).to.be.equal(wrapModule.address);

      // user needs to be issued
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(1), mockUser.address);


      // try deposits from  normal user
      await expect( wrapModule.connect(mockUser.wallet).wrap(deployedSetToken.address,mockDai.address, amockDai.address, ether(1), "AaveWrapAdapter")
      ).to.be.revertedWith("Must be the SetToken manager");

      // perform deposits so withdrawal can be attempted
      await wrapModule.connect(owner.wallet).wrap(deployedSetToken.address,mockDai.address, amockDai.address, ether(1), "AaveWrapAdapter");

      // try withdrawals from normal user
      await  expect(wrapModule.connect(mockUser.wallet).unwrap(deployedSetToken.address,mockDai.address, amockDai.address, ether(1), "AaveWrapAdapter")
      ).to.be.revertedWith("Must be the SetToken manager");

    });



    it("should allow aave deposits and aave withdrawals using erc20 tokens", async () => {

      const deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);


      await basicIssuanceModule.initialize(deployedSetToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(deployedSetToken.address);

      //modules are correct
      expect ((await deployedSetToken.getModules())[0]).to.be.equal(basicIssuanceModule.address);
      expect ((await deployedSetToken.getModules())[1]).to.be.equal(wrapModule.address);

      // user needs to be issued
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(1), mockUser.address);

      const initialUnderlyingBalance = await mockDai.balanceOf(deployedSetToken.address);
      const initialWrappedBalance = await amockDai.balanceOf(deployedSetToken.address);



      // deposit to aave
      await wrapModule.connect(owner.wallet).wrap(deployedSetToken.address,mockDai.address, amockDai.address, ether(1), "AaveWrapAdapter")

      const underlyingBalanceAfterDeposit = await mockDai.balanceOf(deployedSetToken.address);
      const wrappedBalanceAfterDeposit = await amockDai.balanceOf(deployedSetToken.address);
      expect(underlyingBalanceAfterDeposit).to.eq(initialUnderlyingBalance.sub(ether(1)));
      expect(wrappedBalanceAfterDeposit).to.eq(initialWrappedBalance.add(ether(1)));


      // withdraw from aave
      await wrapModule.connect(owner.wallet).unwrap(deployedSetToken.address,mockDai.address, amockDai.address, ether(1), "AaveWrapAdapter")

      const underlyingBalanceAfterWithdrawal = await mockDai.balanceOf(deployedSetToken.address);
      expect(underlyingBalanceAfterWithdrawal).to.eq(initialUnderlyingBalance, "The deposited token was not returned in the right amount")
      const wrappedBalanceAfterWithdrawal = await  amockDai.balanceOf(deployedSetToken.address);
      expect(wrappedBalanceAfterWithdrawal).to.eq(initialWrappedBalance)
    });




    it("should allow aave deposits and aave withdrawals using eth ", async () => {

      const deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);


      await basicIssuanceModule.initialize(deployedSetToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(deployedSetToken.address);

      //modules are correct
      expect ((await deployedSetToken.getModules())[0]).to.be.equal(basicIssuanceModule.address);
      expect ((await deployedSetToken.getModules())[1]).to.be.equal(wrapModule.address);

      // user needs to be issued
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(1), mockUser.address);

      const initialUnderlyingBalance = await weth.balanceOf(deployedSetToken.address);
      const initialWrappedBalance = await aEth.balanceOf(deployedSetToken.address);



      // deposit to aave
      await wrapModule.connect(owner.wallet).wrapWithEther(deployedSetToken.address, aEth.address, ether(1), "AaveWrapAdapter")

      const underlyingBalanceAfterDeposit = await weth.balanceOf(deployedSetToken.address);
      const wrappedBalanceAfterDeposit = await aEth.balanceOf(deployedSetToken.address);

      expect(underlyingBalanceAfterDeposit).to.eq(initialUnderlyingBalance.sub(ether(1)));
      expect(wrappedBalanceAfterDeposit).to.eq(initialWrappedBalance.add(ether(1)));


      // withdraw from aave
      await wrapModule.connect(owner.wallet).unwrapWithEther(deployedSetToken.address, aEth.address, ether(1), "AaveWrapAdapter")

      const underlyingBalanceAfterWithdrawal = await weth.balanceOf(deployedSetToken.address);
      const wrappedBalanceAfterWithdrawal = await  aEth.balanceOf(deployedSetToken.address);

      expect(underlyingBalanceAfterWithdrawal).to.eq(initialUnderlyingBalance, "The deposited token was not returned in the right amount")

      expect(wrappedBalanceAfterWithdrawal).to.eq(initialWrappedBalance)
    });
  });
});