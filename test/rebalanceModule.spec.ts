// TODO: Testnet with portfolio of three tokens
import "module-alias/register";


import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256 } from "@utils/constants";
import { BasicIssuanceModule, 
  Controller, 
  SetTokenCreator, 
  TradeModule, 
  IntegrationRegistry,
  RebalanceModule
} from "@utils/contracts";
import {
  getWaffleExpect,
  getAccounts,
  getUniswapFixture,
} from "@utils/test/index";
import { ethers } from "hardhat";
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { UniswapFixture } from "@utils/fixtures";
import { UniswapV2ExchangeAdapterForRebalancing } from "@typechain/UniswapV2ExchangeAdapterForRebalancing";
import {bigNumberCloseTo, initUniswap, loadFactories, loadTokens} from "@utils/test/helpers";

const expect = getWaffleExpect();
const INTEGRATION_REGISTRY_RESOURCE_ID = 0;

describe("RebalancePair", () => {
  let owner: Account;
  let feeRecipient: Account;
  let mockUser: Account;
  let controller: Controller;
  let setTokenCreator: SetTokenCreator;
  let basicIssuanceModule: BasicIssuanceModule;
  let integrationRegistry: IntegrationRegistry;
  let tradeModule: TradeModule;
  let rebalanceModule: RebalanceModule;
  let uniswapV2ExchangeAdapter: UniswapV2ExchangeAdapterForRebalancing;
  let uniswapFixture: UniswapFixture;
  let Factories: any;
  let ERC20s: any;

  
  beforeEach(async () => {
    [
      owner,
      feeRecipient,
      mockUser,
    ] = await getAccounts();

  });


  describe("story 4 - Owner trades assets of tokenset on uniswap", async function () {
    let tokensetAddress: string;
    let abi: Array<string>;
    let deployedSetToken: any;
    beforeEach(async () => {
        uniswapFixture = getUniswapFixture(owner.address);
      
      Factories = await loadFactories();
      ERC20s = await loadTokens(owner.address);
      
      await initUniswap(uniswapFixture, ERC20s, owner);

      controller = await Factories.ControllerContract.deploy(feeRecipient.address);
      integrationRegistry = await Factories.IntegrationRegistryContract.deploy(controller.address);
      setTokenCreator = await Factories.SetTokenCreatorContract.deploy(controller.address);
      basicIssuanceModule = await Factories.BasicIssuanceModuleContract.deploy(controller.address);
      uniswapV2ExchangeAdapter = await Factories.UniswapV2ExchangeAdapterForRebalancing .deploy(uniswapFixture.router.address);
      tradeModule = await Factories.TradeModuleContract.deploy(controller.address);
      rebalanceModule = await Factories.RebalanceModuleContract.deploy(controller.address);


      await ERC20s.mockWeth.transfer(mockUser.address, ether(100));
      await ERC20s.mockBtc.transfer(mockUser.address, bitcoin(100));
      await ERC20s.mockGenToken.transfer(mockUser.address, ether(100));
      await ERC20s.mockDai.transfer(mockUser.address, ether(1000));

      await ERC20s.mockWeth.connect(mockUser.wallet).approve(basicIssuanceModule.address, ether(100));
      await ERC20s.mockBtc.connect(mockUser.wallet).approve(basicIssuanceModule.address, bitcoin(100));
      await ERC20s.mockGenToken.connect(mockUser.wallet).approve(basicIssuanceModule.address, ether(1000));
      await ERC20s.mockDai.connect(mockUser.wallet).approve(basicIssuanceModule.address, ether(1000));

      await controller.initialize([setTokenCreator.address], 
        [basicIssuanceModule.address, tradeModule.address, rebalanceModule.address], 
        [integrationRegistry.address], 
        [INTEGRATION_REGISTRY_RESOURCE_ID]);
      await integrationRegistry.addIntegration(rebalanceModule.address, "UNISWAP", uniswapV2ExchangeAdapter.address);
      
      const setTokenReceipt =  await (await setTokenCreator.create(
        [ERC20s.mockWeth.address, ERC20s.mockDai.address],
        [ether(1), ether(200)],
        [basicIssuanceModule.address, tradeModule.address, rebalanceModule.address], owner.address,
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

      deployedSetToken =  await ethers.getContractAt(abi, tokensetAddress);
      await basicIssuanceModule.initialize(deployedSetToken.address, ADDRESS_ZERO);
      await tradeModule.initialize(deployedSetToken.address);
      

      await rebalanceModule.initialize(deployedSetToken.address);
      
      await basicIssuanceModule.connect(mockUser.wallet).issue(deployedSetToken.address, ether(2), mockUser.address);


    });

    it("ensure controller is properly deployed", async () => {
      expect(controller.address).to.not.equal(ADDRESS_ZERO) ;
      expect(basicIssuanceModule.address).to.not.equal(ADDRESS_ZERO);
      expect ((await deployedSetToken.getModules()).length).to.be.equal(3);
    });
    it("Ensure user ", async () => {
      expect(await deployedSetToken.balanceOf(mockUser.address)).to.eq(ether(2)); 
      expect(await ERC20s.mockWeth.balanceOf(mockUser.address)).to.eq(ether(100).sub(ether(2)));
      expect(await ERC20s.mockDai.balanceOf(mockUser.address)).to.eq(ether(1000).sub(ether(400))); 
    });
    it("construct  a new Tokenset  - deposit - trade", async () => {
      let r1 = await rebalanceModule.balancingVolume(deployedSetToken.address, "UNISWAP", ERC20s.mockWeth.address, ether(1.5), ERC20s.mockDai.address);

      expect(bigNumberCloseTo(r1, ether(400).add(ether(2000)), ether(10))).to.be.true;
    });
    it("construct  a new Tokenset  - deposit - trade", async () => {
      let r2 = await rebalanceModule.balancingVolume(deployedSetToken.address, "UNISWAP", ERC20s.mockWeth.address, ether(2.01), ERC20s.mockDai.address);

      expect(bigNumberCloseTo(r2, ether(400).sub(ether(40)), ether(0.2))).to.be.true;
    });
    it("construct  a new Tokenset  - deposit - trade", async () => {
      let tx =  rebalanceModule.balancingVolume(deployedSetToken.address, "UNISWAP", ERC20s.mockWeth.address, ether(3), ERC20s.mockDai.address);

      expect(tx).to.be.revertedWith("Not enough balance for swap");
    });
    it("construct  a new Tokenset  - deposit - trade", async () => {
      let r1 = await rebalanceModule.balancingVolume(deployedSetToken.address, "UNISWAP", ERC20s.mockWeth.address, ether(1.5), ERC20s.mockDai.address);
      await rebalanceModule.balancePair(deployedSetToken.address, "UNISWAP", ERC20s.mockWeth.address, ether(1.5), ERC20s.mockDai.address, 10000, "0x"); 
      expect((await ERC20s.mockWeth.balanceOf(deployedSetToken.address))).to.be.eq(ether(1.5));
      expect(bigNumberCloseTo(await ERC20s.mockDai.balanceOf(deployedSetToken.address), ether(400).add(ether(2000)), ether(10))).to.be.true;
    });
  });
});

