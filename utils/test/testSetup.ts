import  {
    bigNumberCloseTo,
    deployContracts,
    deployMockTokens,
    initUniswapRouter,
    loadFactories,
    loadTokens,
} from './helpers';
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


const INTEGRATION_REGISTRY_RESOURCE_ID = 0;


interface Accounts {
    owner: Account ;
    feeRecipient: Account;
    user: Account;
    users: Account[];        
}

interface Factories {
    ControllerContract: ContractFactory;
    IntegrationRegistryContract: ContractFactory
    SetTokenCreatorContract: ContractFactory;
    BasicIssuanceModuleContract: ContractFactory;
    UniswapV2ExchangeAdapterForRebalancing: ContractFactory;
    TradeModuleContract: ContractFactory; 
    RebalanceModuleContract: ContractFactory;
    StandardTokenMockContract: ContractFactory;
    UniswapV2ExchangeAdapter: ContractFactory;
    SingleIndexModuleContract: ContractFactory;
    StreamingFeeModule: StreamingFeeModule__factory;
}

interface Contracts {
    controller: Controller;
    integrationRegistry: IntegrationRegistry;
    setTokenCreator: SetTokenCreator;
    basicIssuanceModule: BasicIssuanceModule;
    uniswapV2ExchangeAdapter: UniswapV2ExchangeAdapter;
    tradeModule: TradeModule;
    singleIndexModule: SingleIndexModule;
    streamingFeeModule: StreamingFeeModule;
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
 
class TestSetup {
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

    public async issue(setToken: string, account: Account, amount: BigNumber): Promise<void> {
        await this.contracts.basicIssuanceModule.connect(account.wallet).issue(setToken, amount, account.address);
    }

    public async addLiquidity(token: StandardTokenMock, 
      amountx1000: BigNumber, 
      token1?: StandardTokenMock,
    ): Promise<void> {
      if (token1 === undefined) token1 = this.mockTokens.mockWeth;
      await token1.approve(this.uniswapRouter.address, ether(1000));
      await token.approve(this.uniswapRouter.address, amountx1000);
      await this.uniswapRouter.addLiquidity(
            token1.address,
            token.address,
            ether(1000),
            amountx1000,
            ether(995),
            amountx1000.mul(995).div(1000),
            this.accounts.owner.address,
            MAX_UINT_256
      );
    }

    public async initStreamingFeeModule(fee: number, maxFee: number, token: string = this.tokensets[1].address) {
      await this.contracts.streamingFeeModule.initialize(token, {
        feeRecipient: this.accounts.feeRecipient.address,
        maxStreamingFeePercentage: ether(maxFee),  // 5%
        streamingFeePercentage: ether(fee),     // 1%
        lastStreamingFeeTimestamp: ether(0)      // Timestamp is overriden 
      })
    }

    public async getTokensOnMainnet(): Promise<void> {
      this.tokens.weth = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.WETH) as ERC20;
      this.tokens.dai = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.DAI) as ERC20;
      this.tokens.matic = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.MATIC) as ERC20;
      this.tokens.usdt = await ethers.getContractAt(ERC20ABI, DEPLOYMENTS.mainnet.USDT) as ERC20;
    }
   
   public async initialize(): Promise<void> {
      this.forked = process.env.FORKED=== "true";
       this.accounts ;
       [ 
          this.accounts.owner, 
          this.accounts.feeRecipient, 
          this.accounts.user, 
          ...this.accounts.users
        ]  = await getAccounts();
        let factories = await loadFactories();
        if(!this.forked) {
          this.mockTokens = await deployMockTokens(factories, this.accounts.owner);
        }
        this.uniswapRouter = await initUniswapRouter(
          this.accounts.owner, 
          this.forked? "":this.mockTokens.mockWeth.address, 
          this.forked? "":this.mockTokens.mockDai.address, 
          this.forked? "":this.mockTokens.mockBtc.address
        );
        let wethAddress = this.forked? DEPLOYMENTS.mainnet.WETH:this.mockTokens.mockWeth.address;
        this.contracts = await deployContracts(factories, this.accounts.owner, this.accounts.feeRecipient, wethAddress, this.uniswapRouter.address);


      await this.contracts.controller.initialize([this.contracts.setTokenCreator.address], 
        [this.contracts.basicIssuanceModule.address, 
          this.contracts.tradeModule.address, 
          this.contracts.singleIndexModule.address, 
          this.contracts.streamingFeeModule.address
        ], 
        [this.contracts.integrationRegistry.address], 
        [INTEGRATION_REGISTRY_RESOURCE_ID]);
      await this.contracts.integrationRegistry.addIntegration(this.contracts.tradeModule.address, 
        "UNISWAP", 
        this.contracts.uniswapV2ExchangeAdapter.address);
     await this.contracts.integrationRegistry.addIntegration(this.contracts.singleIndexModule.address, 
        "UNISWAP", 
        this.contracts.uniswapV2ExchangeAdapter.address);
        
     
        // --- Create a tokenset through factory // TODO: separate function
      const setTokenReceipt =  await (await this.contracts.setTokenCreator.create(
        [
          this.forked? DEPLOYMENTS.mainnet.MATIC:  this.mockTokens.mockGenToken.address, 
          this.forked? DEPLOYMENTS.mainnet.DAI: this.mockTokens.mockDai.address
        ],
        [ether(3), ether(2)],
        [
          this.contracts.basicIssuanceModule.address, 
          this.contracts.tradeModule.address, 
          this.contracts.singleIndexModule.address,
          this.contracts.streamingFeeModule.address 
        ], 
        this.accounts.owner.address,
        "indexzoo", "ZOO")).wait();
      const event = setTokenReceipt.events?.find(p => p.event == "SetTokenCreated");
      const tokensetAddress = event? event.args? event.args[0]:"":"";
      let deployedSetToken =  await ethers.getContractAt(SetTokenABI, tokensetAddress);
        this.tokensets.push(deployedSetToken as SetToken);
        await this.contracts.basicIssuanceModule.initialize(this.tokensets[0].address, ADDRESS_ZERO);
        await this.contracts.tradeModule.initialize(this.tokensets[0].address);
        // ----------------------------------------
      // --- Create a tokenset2 through factory 
      const setTokenReceipt2 =  await (await this.contracts.setTokenCreator.create(
        [
          this.forked? DEPLOYMENTS.mainnet.WETH:this.mockTokens.mockWeth.address, 
          this.forked? DEPLOYMENTS.mainnet.DAI:this.mockTokens.mockGenToken.address
        ],
        [ether(10), ether(20)],
        [
          this.contracts.basicIssuanceModule.address, 
          this.contracts.tradeModule.address, 
          this.contracts.singleIndexModule.address,
          this.contracts.streamingFeeModule.address 
        ], 
        this.accounts.owner.address,
        "indexzoo", "ZOO")).wait();
      const event2 = setTokenReceipt2.events?.find(p => p.event == "SetTokenCreated");
      const tokensetAddress2 = event2? event2.args? event2.args[0]:"":"";
      let deployedSetToken2 =  await ethers.getContractAt(SetTokenABI, tokensetAddress2);
        this.tokensets.push(deployedSetToken2 as SetToken);
        await this.contracts.basicIssuanceModule.initialize(this.tokensets[1].address, ADDRESS_ZERO);
        await this.contracts.tradeModule.initialize(this.tokensets[1].address);
        // ----------------------------------------
    }
}

export {TestSetup};