import  {
    bigNumberCloseTo,
    deployContracts,
    deployMockTokens,
    initUniswapRouter,
    loadFactories,
    loadTokens,
} from '../test/helpers';
import { ether, bitcoin } from "@utils/common/unitsUtils";
import { Account } from "@utils/test/types";
import {
  getAccounts,
} from "@utils/test/index";
import { Contract, ContractFactory } from '@ethersproject/contracts';
import { Controller } from '@typechain/Controller';
import { IntegrationRegistry } from '@typechain/IntegrationRegistry';
import { SetTokenCreator } from '@typechain/SetTokenCreator';
import { BasicIssuanceModule } from '@typechain/BasicIssuanceModule';
import { UniswapV2ExchangeAdapter } from '@typechain/UniswapV2ExchangeAdapter';
import { TradeModule } from '@typechain/TradeModule';
import { StandardTokenMock } from '@typechain/StandardTokenMock';
import { SingleIndexModule } from '@typechain/SingleIndexModule';
import {abi as SetTokenABI} from "../../artifacts/contracts/protocol/SetToken.sol/SetToken.json";
import { ethers } from 'hardhat';
import { SetToken } from '@typechain/SetToken';
import { ADDRESS_ZERO, MAX_UINT_256 } from '@utils/constants';
import { Signer } from 'crypto';
import { BigNumber } from '@ethersproject/bignumber';
import { UniswapFixture } from '@utils/fixtures';
import { StreamingFeeModule } from '@typechain/StreamingFeeModule';
import { StreamingFeeModule__factory } from '@typechain/factories/StreamingFeeModule__factory';
import DEPLOYMENTS from '../../scripts/deployments';
import { ERC20 } from '@typechain/ERC20';
import {abi as ERC20ABI} from '@openzeppelin/contracts/build/contracts/ERC20.json';
import { UniswapV2Router02 } from '@typechain/UniswapV2Router02';
import { MetaTxGateway__factory } from '@typechain/factories/MetaTxGateway__factory';
import { MetaTxGateway } from '@typechain/MetaTxGateway';
import { PerpToken } from '@typechain/PerpToken';
import { InflationMonitor } from '@typechain/InflationMonitor';
import { ExchangeWrapperMock } from '@typechain/ExchangeWrapperMock';
import { SupplyScheduleFake } from '@typechain/SupplyScheduleFake';
import { InsuranceFund } from '@typechain/InsuranceFund';
import { ClearingHouseFake } from '@typechain/ClearingHouseFake';
import { ClearingHouseViewer } from '@typechain/ClearingHouseViewer';
import { StakingReserveFake } from '@typechain/StakingReserveFake';
import { AMBBridgeMock } from '@typechain/AMBBridgeMock';
import { TollPool } from '@typechain/TollPool';
import { RewardsDistributionFake } from '@typechain/RewardsDistributionFake';
import { AmmFake } from '@typechain/AmmFake';
import { AmmReader } from '@typechain/AmmReader';
import { ERC20__factory } from '@typechain/factories/ERC20__factory';
import { L2PriceFeedMock__factory } from '@typechain/factories/L2PriceFeedMock__factory';
import { PerpToken__factory } from '@typechain/factories/PerpToken__factory';
import { PerpProtoV2Minter__factory } from '@typechain/factories/PerpProtoV2Minter__factory';
import { InflationMonitor__factory } from '@typechain/factories/InflationMonitor__factory';
import { ExchangeWrapperMock__factory } from '@typechain/factories/ExchangeWrapperMock__factory';
import { SupplyScheduleFake__factory } from '@typechain/factories/SupplyScheduleFake__factory';
import { InsuranceFund__factory } from '@typechain/factories/InsuranceFund__factory';
import { ClearingHouseFake__factory } from '@typechain/factories/ClearingHouseFake__factory';
import { ClearingHouseViewer__factory } from '@typechain/factories/ClearingHouseViewer__factory';
import { StakingReserveFake__factory } from '@typechain/factories/StakingReserveFake__factory';
import { AMBBridgeMock__factory } from '@typechain/factories/AMBBridgeMock__factory';
import { TollPool__factory } from '@typechain/factories/TollPool__factory';
import { RewardsDistributionFake__factory } from '@typechain/factories/RewardsDistributionFake__factory';
import { AmmFake__factory } from '@typechain/factories/AmmFake__factory';
import { AmmReader__factory } from '@typechain/factories/AmmReader__factory';
import { L2PriceFeedMock } from '@typechain/L2PriceFeedMock';
import { PerpProtoV2Minter } from '@typechain/PerpProtoV2Minter';
import { StandardTokenMock__factory } from '@typechain/factories/StandardTokenMock__factory';


const INTEGRATION_REGISTRY_RESOURCE_ID = 0;


interface Accounts {
    owner: Account ;
    feeRecipient: Account;
    user: Account;
    users: Account[];        
}

interface Factories {
    metaTxGateway: MetaTxGateway__factory;
    quoteCoin: StandardTokenMock__factory;
    priceFeed: L2PriceFeedMock__factory;
    pToken: PerpToken__factory;
    minter: PerpProtoV2Minter__factory;
    inflationMonitor: InflationMonitor__factory;
    exchangeWrapper: ExchangeWrapperMock__factory;
    supplySchedule: SupplyScheduleFake__factory;
    insuranceFund: InsuranceFund__factory;
    clearingHouse: ClearingHouseFake__factory;
    clearingHouseViewer: ClearingHouseViewer__factory;
    stakingReserve: StakingReserveFake__factory;
    ambBridgeMock: AMBBridgeMock__factory;
    tollPool: TollPool__factory;
    rewardDistribution: RewardsDistributionFake__factory;
    amm: AmmFake__factory;
    ammReader: AmmReader__factory;
}

interface Contracts {
    metaTxGateway: MetaTxGateway;
    quoteCoin: StandardTokenMock;
    priceFeed: L2PriceFeedMock;
    pToken: PerpToken;
    minter: PerpProtoV2Minter;
    inflationMonitor: InflationMonitor;
    exchangeWrapper: ExchangeWrapperMock;
    supplySchedule: SupplyScheduleFake;
    insuranceFund: InsuranceFund;
    clearingHouse: ClearingHouseFake;
    clearingHouseViewer: ClearingHouseViewer;
    stakingReserve: StakingReserveFake;
    ambBridgeMock: AMBBridgeMock;
    tollPool: TollPool;
    rewardDistribution: RewardsDistributionFake;
    amm: AmmFake;
    ammReader: AmmReader;
}

interface ERC20s {
  weth: ERC20;
  dai: ERC20;
  matic: ERC20;
  usdt: ERC20;
}

interface MockERC20s {
  mockWeth: StandardTokenMock;
  mockDai: StandardTokenMock;
  mockBtc: StandardTokenMock;
  mockGenToken: StandardTokenMock;
}
 
class PerpetualFixture {
    public perpetualFixture: PerpetualFixture;
    public accounts= <Accounts> {} ;
    public factories: Factories; 
    public contracts: Contracts; 
    public tokensets: SetToken[] = [];
    public tokens: ERC20s = <ERC20s>{};
    public mockTokens: MockERC20s = <MockERC20s>{};
    public uniswapRouter: UniswapV2Router02;
    private forked: boolean;

    public async fundAccount(user: Account, amount: number = 1000): Promise<void> {
      if(this.forked) {
        await user.wallet.sendTransaction({to: DEPLOYMENTS.mainnet.WETH, value: ether(90)});  // Get 90 WETH
        await this.uniswapRouter.swapETHForExactTokens(ether(20000), [DEPLOYMENTS.mainnet.WETH, DEPLOYMENTS.mainnet.MATIC], user.address, MAX_UINT_256, {value: ether(25)})
        await this.uniswapRouter.swapETHForExactTokens(ether(20000), [DEPLOYMENTS.mainnet.WETH, DEPLOYMENTS.mainnet.DAI], user.address, MAX_UINT_256, {value: ether(10)})
        await this.uniswapRouter.swapETHForExactTokens("1000000000", [DEPLOYMENTS.mainnet.WETH, DEPLOYMENTS.mainnet.USDT], user.address, MAX_UINT_256, {value: ether(1)})
      } else {
        await this.mockTokens.mockBtc.transfer(user.address, bitcoin(amount)) ;
        await this.mockTokens.mockDai.transfer(user.address, ether(amount));
        await this.mockTokens.mockWeth.transfer(user.address, ether(amount));
        await this.mockTokens.mockGenToken.transfer(user.address, ether(amount));
      }
    }

    public async approveModule(account: Account, module: string): Promise<void> {
      if(this.forked){
        await this.tokens.usdt.connect(account.wallet).approve(module, bitcoin(999999)) ;
        await this.tokens.dai.connect(account.wallet).approve(module, MAX_UINT_256);
        await this.tokens.weth.connect(account.wallet).approve(module, MAX_UINT_256);
        await this.tokens.matic.connect(account.wallet).approve(module, MAX_UINT_256);   
      } else {
        await this.mockTokens.mockBtc.connect(account.wallet).approve(module, bitcoin(999999)) ;
        await this.mockTokens.mockDai.connect(account.wallet).approve(module, MAX_UINT_256);
        await this.mockTokens.mockWeth.connect(account.wallet).approve(module, MAX_UINT_256);
        await this.mockTokens.mockGenToken.connect(account.wallet).approve(module, MAX_UINT_256);   
      }
   }

  
   public async initialize(): Promise<void> {
       this.factories = <Factories> {};
       this.contracts = <Contracts> {};
      this.forked = process.env.FORKED=== "true";
       this.accounts ;
       [ 
          this.accounts.owner, 
          this.accounts.feeRecipient, 
          this.accounts.user, 
          ...this.accounts.users
        ]  = await getAccounts();
        this.factories.metaTxGateway = await ethers.getContractFactory("MetaTxGateway");
        this.factories.quoteCoin = await ethers.getContractFactory("StandardTokenMock");
        this.factories.priceFeed = await ethers.getContractFactory("L2PriceFeedMock");
        this.factories.pToken = await ethers.getContractFactory("PerpToken");
        this.factories.minter = await ethers.getContractFactory("PerpProtoV2Minter") as PerpProtoV2Minter__factory;
        this.factories.inflationMonitor = await ethers.getContractFactory("InflationMonitor");
        this.factories.exchangeWrapper = await ethers.getContractFactory("ExchangeWrapperMock");
        this.factories.supplySchedule = await ethers.getContractFactory("SupplyScheduleFake");
        this.factories.insuranceFund = await ethers.getContractFactory("InsuranceFund");
        this.factories.clearingHouse = <ClearingHouseFake__factory> await ethers.getContractFactory("ClearingHouseFake");
        this.factories.clearingHouseViewer = await ethers.getContractFactory("ClearingHouseViewer");
        this.factories.stakingReserve = <StakingReserveFake__factory> await ethers.getContractFactory("StakingReserveFake");
        this.factories.ambBridgeMock = <AMBBridgeMock__factory>  (await ethers.getContractFactory("AMBBridgeMock")) ;
        this.factories.tollPool = await ethers.getContractFactory("TollPool") as TollPool__factory;
        this.factories.rewardDistribution = await ethers.getContractFactory("RewardsDistributionFake");
        this.factories.amm = await ethers.getContractFactory("AmmFake") as AmmFake__factory;
        this.factories.ammReader = await ethers.getContractFactory("AmmReader");


        this.contracts.metaTxGateway = await this.factories.metaTxGateway.deploy();
        this.contracts.quoteCoin = await this.factories.quoteCoin.deploy(this.accounts.owner.address, ether(10000), "USD Coin", "USDC", 18);
        this.contracts.priceFeed = await this.factories.priceFeed.deploy(ether(100));

        this.contracts.pToken = await this.factories.pToken.deploy(ether(1000000));
        this.contracts.minter = await this.factories.minter.deploy();
        this.contracts.inflationMonitor = await this.factories.inflationMonitor.deploy();
        this.contracts.exchangeWrapper = await this.factories.exchangeWrapper.deploy();
        this.contracts.supplySchedule = await this.factories.supplySchedule.deploy();
        this.contracts.insuranceFund = await this.factories.insuranceFund.deploy();
        this.contracts.clearingHouse = await this.factories.clearingHouse.deploy();
        this.contracts.clearingHouseViewer = await this.factories.clearingHouseViewer.deploy(
          this.contracts.clearingHouse.address
        );
        this.contracts.stakingReserve = await this.factories.stakingReserve.deploy();

        
        await this.contracts.metaTxGateway.initialize("Perp", "1", 1234);  // name, version, chainId
        await this.contracts.minter.initialize(this.contracts.pToken.address);
        await this.contracts.inflationMonitor.initialize(this.contracts.minter.address);
        await this.contracts.supplySchedule.initialize(
          this.contracts.minter.address,
          ether(0.01), // inflationRate
          BigNumber.from(0),
          BigNumber.from(7*24*60*60)
        );
        await this.contracts.insuranceFund.initialize();
        await this.contracts.insuranceFund.setExchange(this.contracts.exchangeWrapper.address);
        await this.contracts.insuranceFund.setMinter(this.contracts.minter.address);
        await this.contracts.clearingHouse.initialize(
          ether(0.05),
          ether(0.05),
          ether(0.05),
          this.contracts.insuranceFund.address,
          this.contracts.metaTxGateway.address
        );
        await this.contracts.metaTxGateway.addToWhitelists(this.contracts.clearingHouse.address);
        await this.contracts.stakingReserve.initialize(
          this.contracts.pToken.address,
          this.contracts.supplySchedule.address,
          this.contracts.clearingHouse.address,
          BigNumber.from(0)
        );


        // TODO: fill fixture
       // ----------------------------------------
    }
}

export {PerpetualFixture};