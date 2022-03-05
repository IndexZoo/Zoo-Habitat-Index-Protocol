/*
    Copyright 2021 IndexZoo Ltd.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache License, Version 2.0
*/

pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IController } from "../../interfaces/IController.sol";
import { IUniswapV2Router } from "../../interfaces/external/IUniswapV2Router.sol";
import { ILendingPool } from "../../interfaces/external/aave-v2/ILendingPool.sol";
import { ILendingPoolAddressesProvider } from "../../interfaces/external/aave-v2/ILendingPoolAddressesProvider.sol";
import { ILendingAdapter } from "../../interfaces/ILendingAdapter.sol";
import { IExchangeAdapterV3 } from "../../interfaces/IExchangeAdapterV3.sol";
import { IPriceOracleGetter } from "../../interfaces/external/aave-v2/IPriceOracleGetter.sol";
import { Invoke } from "../lib/Invoke.sol";
import { IZooToken } from "../../interfaces/IZooToken.sol";
import { IssuanceValidationUtils } from "../lib/IssuanceValidationUtils.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { Position } from "../lib/Position.sol";
import { ModuleBase } from "../lib/ZooModuleBase.sol";
import { L3xUtils } from "../lib/L3xUtils.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import "hardhat/console.sol";

/**
 * @title L3xIssuanceModule
 * @author IndexZoo Ltd.
 *
 * The L3xIssuanceModule is a module that enables users to issue and redeem Leveraged Tokens that wrap a base token 
 * including debt positions. Module hooks are added to allow for syncing of debt, 
 * to ensure debts are replicated correctly. 
 * 
 * @dev Note that current state of the contract is for testing the feasibility of achieving ~ 3x Leverage
 * @dev Next stage most of that logic will be invoked from the SetToken (or ZooToken)
 * @dev SetToken will be changed as balance of (LevToken) (previously setToken) will be reflected by debt with AAVE 
 * 
 * NOTE: 
 */
 /**
  * @dev Notes
  * issue: 
  * * Entry point of the contract is issue in which the caller mints the zoo token (bear or bull).
  * * Minting a token incurs added debt on the zoken on behalf of caller due to borrowing from Aave.
  * * Debt is stored in a map for each caller.
  * * Caller can issue the tokens to another address while charging the caller the amount in 
  * config:
  * * Config for each zoo assigned by manager.
  * * It stores the addresses of lender and dex router.
  * * It determines the amount to be borrowed from the deposited collateral for a given zoo 
  * redeem logic aims at:
  * * Transferring the underlying asset to the caller after deducting the amount of debt
  * * Lending fees are accounted for by redeeming funds of user proportional to deposits on Aave
  *
  * IntegrationRegistry connected to this module provides calldata for external ecosystems (e.g Aave, Uniswap)
  * Position Multiplier decreases (i.e. inflation increases) when Manager accrues streaming fees
  * Zoo is bear when BaseToken becomes the borrow asset and QuoteToken (stable coin) becomes the deposit asset
  * Zoo is bull when BaseToken becomes the deposit asset and QuoteToken becomes the borrow asset
  *
  * Rebalancing is carried out in separate module
  *
  *
  * FIXME: Last withdrawal edge case, in which you need to do successive withdrawals and repay
  *  - TODO write a require statement to block that
  *  - might require multiple step external call instead
  *  - TODO calculate threshold for which redeems are prohibited
  *  - Might need admin function to default the token (withdraw all colalteral to balance)
  * FIXME: Initialization of ecosystem: suppose 3 users issue tokes and price goes down on bull.
  *  - FIXME: In that case it won't be possible for new users to issue tokens too
  *  - Users won't be able even to redeem their funds even with loss ! FIX this 
  *  - Depends on liquidation threshold discussion (risk assessment)
  * FIXME: relook positionMultiplier , do it on issue and redeem, Document inflation and Ask Andrew
  *  - TODO  Document inflation of set-protocol and its inconsistency / Quantify when inflation reaches danger zone
  *  - impose maximum on fee accrue period
  * TODO: TODO: Reread SetToken | DebtIssuance 
  * TODO: TODO: beforeTokenTransfer
  * TODO: TODO: rebalance bear in win case | rebalance in loss case  NOTE Depends on liquidation
  * TODO: Liquidation Threshold / Test position liquidation directly on Aave
  * TODO: put an argument for minimum quantity of token to receive from Issue (slippage)
  *
  */ 



contract L3xIssuanceModule is  ModuleBase, ReentrancyGuard, Ownable {
    using Position for IZooToken;
    using L3xUtils for IZooToken;
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    using L3xUtils for L3xUtils.LendingCallInfo;

    /* =================== Enums ==============================*/
 
    enum Side {
        Bull,
        Bear
    }

    /* ==================== Struct ============================= */
    struct GlobalConfig {
        ILendingPool lender;
        IUniswapV2Router router;
        ILendingPoolAddressesProvider addressesProvider;
    }
    struct LocalModuleConfig {
        ILendingPool lender;
        IUniswapV2Router router;
        ILendingPoolAddressesProvider addressesProvider;
        uint256 amountPerUnitCollateral;                 // Amount to be borrowed for each unit of collateral in Eth

    }
    
    /**
     * Config dependent on token / unchangeable
     */
    struct TokenConfig {
        Side side;                                      // Bull or Bear - this config is fixed (non changeable)
    }

    /* ============ Events ============ */
    
    event Issued(
        IZooToken indexed _zooToken,
        address indexed _holder,
        address indexed _assetSent,
        uint256 _amount,
        uint256 _balance,
        uint256 _debt
    );

    event Redeemed(
        IZooToken indexed _zooToken,
        address indexed _holder,
        address indexed _assetReceived,
        uint256 _amount,
        uint256 _balance,
        uint256 _debt
    );

    event ConfigSetForToken(
        IZooToken indexed _zooToken,
        LocalModuleConfig _config
    );

    event ConfigSetForGlobal(
        GlobalConfig _config
    );


    /* ==================== Constants ================================ */

    uint256 private constant BORROW_PORTION_FACTOR = 0.999 ether;

    // IntegrationRegistry providing calldata for this module
    uint256 private constant INTEGRATION_REGISTRY_RESOURCE_ID = 0;

    string private constant AAVE_ADAPTER_NAME = "AAVE";
    uint256 private constant STD_SCALER = 1 ether;
   
    /* ==================== State Variables ========================== */

    /**
     * Global configuration for module
     * configuration for all tokens attached to the module (if not having a LocalModuleConfig)
     * lender i.e. Aave / router i.e. Uniswap
     */
    GlobalConfig public globalConfig;

    /**
     * LocalModuleConfig configuration for module
     * configuration for a selected token 
     * GlobalConfig makes up for the unconfigured token 
     * lender i.e. Aave / router i.e. Uniswap
     */
    mapping(address => LocalModuleConfig) public configs;

    /* ============ Constructor ============ */
    /**
     * 
     * @param controller_  Address of controller meant to be managing the module 
     */
    
    constructor(IController controller_) public ModuleBase (controller_) {
    }

    /* ============ External Functions ============ */

    /**
     * Initializes this module to the ZooToken. Only callable by the ZooToken's manager.
     *
     * @param zooToken_                 Instance of the ZooToken to initialize
     */
    function initialize(
        IZooToken zooToken_
    )
        external
        onlyValidAndPendingSet(zooToken_)
        onlySetManager(zooToken_, msg.sender)
    {
        zooToken_.initializeModule();
    }

    /**
     * Mints Leverage token for investor
     * @dev If setToken is bullish
     * Deposits the base asset of that token on AAVE (i.e. WETH)
     * Borrows quoteToken (i.e. DAI)
     * Amount borrowed is derived from getUserAccountData() call provided by LendingPool
     * Module does not directly invoke methods as these calls are being invoked by the Zoo Token
     * Tokens minted for user (caller) are proportion to the amount deposited and borrowed
     *

     * @param zooToken_     Instance of the ZooToken to configure
     * @param to_               Address of beneficiary receiver of token
     * @param quantity_         Quantity of quote token input to go long 
     * @param price_            price of baseToken (i.e. ETH) in quoteToken (i.e. DAI)
     * @param swapFactorx1000_  The accepted portion of quantity_ to get through after deduction from fees. 
     * This is taking place during the processes of swapping & borrowing (i.e. about 985)
     */
    function issue (
        IZooToken zooToken_,
        address to_,
        uint256 quantity_,
        uint256 price_,
        uint256 swapFactorx1000_  // TODO: to be replaced by slippage
    )
        external
        nonReentrant
        onlyValidAndInitializedSet(zooToken_)
    {
        uint256 depositAmount  = _prepareAmountInForIssue (zooToken_, msg.sender, quantity_, price_, swapFactorx1000_);
        
        // @note Borrow quoteToken from lending Protocol
        // @note totalAmountOut represents exposure
        (
            uint256 totalAmountOut, 
            uint256 totalAmountDebt
        )  =  _iterativeBorrow(zooToken_, depositAmount, swapFactorx1000_, price_);
        _mintZoos(zooToken_, to_, totalAmountOut, totalAmountDebt);

        emit  Issued(
            zooToken_, 
            to_, 
            zooToken_.pair().quote, 
            quantity_, 
            zooToken_.balanceOf(msg.sender), 
            zooToken_.getDebt(msg.sender)
        );
    }

    /**
     * Function aims at sending the investor amount of DAI corresponding to the state of his/her position.
     * 
     * @dev redemption steps:
     * * Get the rate of uniswap of quoteToken to baseToken.
     * * Swap the debt of investor from the amount of tokens he possess (inflated).
     * * Check if there is enough tokens to be redeemed from balance.
     * * If there are not enough tokens then withdraw needed amount from Aave.
     * * Convert amount to quoteToken(i.e. DAI)
     * * Repay corresponding amount of debt which corresponds to closing position.
     * * Relieve investor from debt
     * * Transfer remain (quantity_ - baseAmountRepaid) int baseToken and burn zoos
     * * Do a rebalance for leverage by borrowing Available eth from Aave
     *
     * TODO: Check and liquidate all balance if debt is greater than balance of user      
     *

     * @param zooToken_     Instance of the ZooToken to configure
     * @param quantity_         Quantity of token to be redeemed 
     */
    function redeem(
        IZooToken zooToken_,
        uint256 quantity_
    )
        external
        nonReentrant
        onlyValidAndInitializedSet(zooToken_)
    {
        uint256 userZooBalance = zooToken_.balanceOf(msg.sender);
        if(quantity_  ==  uint256(-1)) {
              quantity_ = userZooBalance;
        }
        require(quantity_ <= userZooBalance, "L3xIssuance: Not enough NAV" );

        // Deposit Asset (e.g. WETH)
        address dAsset = zooToken_.zooIsBull()? zooToken_.pair().base : zooToken_.pair().quote;

        // @note NB: Important to calculate currentBalancePortion before withdrawing collateralPortion and debtRepay
        uint256 currentBalancePortion = _getUserPortionOfCollateralBalance(zooToken_, quantity_);
        uint256[] memory amountsRepaid = _payUserDebtPortion(zooToken_, quantity_);
        // Withdraw 
        uint256 collateralPortion = _withdrawUserPortionOfTotalCollateral(zooToken_, quantity_);

        uint256 exposure = currentBalancePortion.add(collateralPortion);

        uint256 nav = _finalizeRedeem(zooToken_, quantity_, exposure, amountsRepaid[0], dAsset);

        emit  Redeemed(
            zooToken_, 
            msg.sender, 
            dAsset, 
            nav, 
            zooToken_.balanceOf(msg.sender), 
            zooToken_.getDebt(msg.sender)
        );
    }

    /**
     * Administrative calls: to be called by Manager only
     * @param config_       Configuration data
     */
     function setGlobalConfig(
         GlobalConfig calldata config_
    )
    external
    onlyOwner
    {
        globalConfig.addressesProvider = config_.addressesProvider;
        globalConfig.lender = config_.lender;
        globalConfig.router = config_.router;

        emit ConfigSetForGlobal(config_);
    }


    /**
     * Administrative calls: to be called by Manager only
     * @param zooToken_     Instance of the ZooToken to configure
     * @param config_       Configuration data 
     */
     function setConfigForToken(
         address zooToken_,
         LocalModuleConfig calldata config_
    )
    external
    onlySetManager(IZooToken(zooToken_), msg.sender)
    {
        // TODO: do not allow to change lender
        uint256 amountPerUnitCollateral = config_.amountPerUnitCollateral;
        require(amountPerUnitCollateral > 0, "Zero amountPerCollateral unallowed");
        configs[zooToken_].addressesProvider = config_.addressesProvider;
        configs[zooToken_].lender = config_.lender;
        configs[zooToken_].router = config_.router;
        configs[zooToken_].amountPerUnitCollateral = amountPerUnitCollateral;

        emit ConfigSetForToken(IZooToken(zooToken_), config_);
    }

    function removeModule() external override {}

    /* ============== View Functions ===================*/
    /**
     * Get address of LendingPool 
     * Get configuration stored in GlobalConfig if no LocalModuleConfig for this token is stored

     * @param zooToken_      Instance of the ZooToken to configure
     * @return ILendingPool  address of lending pool to borrow from and deposit to
     */
    function getLender(IZooToken zooToken_) public view returns (ILendingPool ) 
    {
        ILendingPool local = configs[address(zooToken_)].lender;
        return address(local) != address(0)?
           local: globalConfig.lender; 
    }

    /**
     * Get address of uniswap-like router 
     * Get configuration stored in GlobalConfig if no LocalModuleConfig for this token is stored

     * @param zooToken_          Instance of the ZooToken to configure
     * @return IUniswapV2Router  address of uniswap-like router for swaps 
     */
    function getRouter(IZooToken zooToken_) public view returns (IUniswapV2Router ) 
    {
        IUniswapV2Router local = configs[address(zooToken_)].router;
        return address(local) != address(0)?
           local: globalConfig.router; 
    }

    /**
     * Get address of addresses provider for LendingPool 
     * Get configuration stored in GlobalConfig if no LocalModuleConfig for this token is stored

     * @param zooToken_                         Instance of the ZooToken to configure
     * @return ILendingPoolAddressesProvider    address of  AddressesProvider
     */
    function getAddressesProvider(IZooToken zooToken_) public view returns (ILendingPoolAddressesProvider ) 
    {
        ILendingPoolAddressesProvider local = configs[address(zooToken_)].addressesProvider;
        return address(local) != address(0)?
           local: globalConfig.addressesProvider; 
    }

    function getNAV(IZooToken zooToken_, address account_) public view returns(uint256 ) 
    {
        return getExposure(zooToken_, account_).sub(zooToken_.getDebt(account_));
    }

    function getExposure(IZooToken zooToken_, address account_) public view returns (uint256 ) 
    {
        uint zoos = zooToken_.balanceOf(account_);
        if (!zooToken_.zooIsBull()) {
            // is bearish token
            return zoos;
        }

         address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

        // getting price of borrowToken against depositToken 
        uint256 exposure = zooToken_.getEquivalentAmountViaOraclePrice(
            oracle, 
            zoos,
            [L3xUtils.PPath.DepositAsset, L3xUtils.PPath.BorrowAsset]
        );    
        return exposure;       
    }

    /* ============ Internal Functions ============ */

    /**
     * Create and return TradeInfo struct
     *
     * @param zooToken_             Instance of the ZooToken to trade
     * @param lenderName_           Human readable name of the lender in the integrations registry
     * @param asset_                Address of the underlying token to be borrowed 
     * @param amount_               Amount of underlying token to be borrowed 
     *
     * @return LendingCallInfo             Struct containing data for trade
     */
    function _createLendingCallInfo(
        IZooToken zooToken_,
        string memory lenderName_,
        address asset_,
        uint256 amount_
    )
        internal
        view
        returns (L3xUtils.LendingCallInfo memory)
    {
        L3xUtils.LendingCallInfo memory borrowInfo;
        borrowInfo.zooToken = zooToken_;
        borrowInfo.lendingAdapter = ILendingAdapter(getAndValidateAdapter(lenderName_));
        borrowInfo.asset = asset_;
        borrowInfo.amount = amount_;
        return borrowInfo;
    }


    /* ==================================== Private functions ===================================== */

    /**
     * Prepare input amount by investor before issuing zoo tokens
     * Swap input token if zoo token is bullish
     * @param zooToken_                         Instance of the ZooToken to trade
     * @param creditor_                         Payer of input amount
     * @param depositAmountInStableC_           Amount in by creditor
     * @param depositAssetPrice_                Price of base asset against quote asset
     * @param swapFactorx1000_                  Account for swapping fees by dex
     * @return amountOut                        Amount to be initially deposited in LendingPool 
     */
    function _prepareAmountInForIssue(
        IZooToken zooToken_,
        address creditor_,
        uint256 depositAmountInStableC_,
        uint256 depositAssetPrice_,
        uint256 swapFactorx1000_
    )
    private
    returns (uint256 amountOut) 
    {
        IERC20(zooToken_.pair().quote).transferFrom(creditor_, address(zooToken_), depositAmountInStableC_);
        if(zooToken_.zooIsBull()){
           IExchangeAdapterV3 adapter = IExchangeAdapterV3(getAndValidateAdapter("UNISWAP"));
           amountOut = zooToken_.swapQuoteAndBase(adapter, getRouter(zooToken_), depositAmountInStableC_, _multiplyByFactorSwap(depositAmountInStableC_, swapFactorx1000_, depositAssetPrice_)); 
        }
        else {
            amountOut = depositAmountInStableC_;
        }
    }

    /** 
     * Deposit asset in LendingPool and borrow the other asset against the deposited one.
     * Process is iterative till achieving required leverage

     * @param zooToken_                         Instance of the ZooToken to trade
     * @param depositAmount_                    Initial amount to be deposited 
     * @param swapFactorx1000_                  Account for swapping fees by dex
     * @param price_                            Price of base asset against quote asset
     * @return totalAmountOut                   Amount of zoo to be minted for investor 
     * @return totalAmountDebt                  Amount of debt to be recorded on investor
     */
    function _iterativeBorrow(
        IZooToken zooToken_,
        uint256 depositAmount_,
        uint256 swapFactorx1000_,
        uint256 price_
    )
    private
    returns (
        uint256 totalAmountOut,
        uint256 totalAmountDebt
    )
    {
        uint256 borrowAmount;
        totalAmountOut = depositAmount_;

        IExchangeAdapterV3 adapter = IExchangeAdapterV3(getAndValidateAdapter("UNISWAP"));
        for (uint8 i = 0; i < 3; i++) {
            borrowAmount = _borrowAgainstCollateral(zooToken_, depositAmount_ );
            depositAmount_ = zooToken_.swapQuoteAndBase(adapter, getRouter(zooToken_), borrowAmount, _multiplyByFactorSwap(borrowAmount, swapFactorx1000_, price_));

            totalAmountOut = totalAmountOut.add(depositAmount_);
            totalAmountDebt = totalAmountDebt.add(borrowAmount);
        }

    }

    /**
     * Mint zoo token
     * @param zooToken_                         Instance of the ZooToken to trade
     * @param to_                               Address of investor to_ to receive zoo token
     * @param exposure_                         Amount to be minted (before inflating)
     * @param debt_                             Debt to be incurred on to_
     */
    function _mintZoos(
        IZooToken zooToken_,
        address to_,
        uint256 exposure_,
        uint256 debt_
    )
    private 
    {
        zooToken_.addDebt(to_, debt_);
        uint256 positionMultiplier = uint256(zooToken_.positionMultiplier());
        uint256 mints = exposure_.mul(PreciseUnitMath.preciseUnit()).div(positionMultiplier);
        zooToken_.mint(to_, mints);
        require(mints !=  0, "L3xIssueMod: Leveraging failed");
    }

    /**
     * 
     * @param zooToken_                         Instance of the ZooToken to trade
     * @param quantity_                         Amount of zoo to be burnt 
     * @param exposure_                         ..  
     * @param debt_                             ..
     * @param dAsset_                           Address of deposited Asset
     * @return nav
     */
    function _finalizeRedeem (
        IZooToken zooToken_,
        uint256 quantity_,
        uint256 exposure_,
        uint256 debt_, 
        address dAsset_
    ) 
    private 
    returns (uint256 nav)
    {
        uint256 positionMultiplier = uint256(zooToken_.positionMultiplier());
        // console.log(exposure_);
        exposure_ = exposure_.mul(positionMultiplier).div(PreciseUnitMath.preciseUnit());
        nav = exposure_.sub(debt_);
        // console.log(nav);

        zooToken_.burn(msg.sender, quantity_);
        zooToken_.transferAsset(IERC20(dAsset_), msg.sender, nav);
    }

    /**
     * Withdraw a portion of the collateral of zoo token in lender (e.g. Aave) 
     * Withdrawal amout is proportional to the quantity_ desired to redeem
     * @param zooToken_                      Instance of ZooToken
     * @param quantity_                      Amout to be redeemed
     */

    function _withdrawUserPortionOfTotalCollateral(
        IZooToken zooToken_,
        uint256 quantity_
    )
    private
    returns(uint256 amountToWithdraw) 
    {
        address dAsset = zooToken_.zooIsBull() ? zooToken_.pair().base : zooToken_.pair().quote;   // Deposit Token
        uint256 zooSupply = zooToken_.totalSupply();
        (uint256 totalCollateralETH,,,,,) = configs[address(zooToken_)].lender.getUserAccountData(address(zooToken_));
        uint256 collateralPortion =  quantity_.mul(totalCollateralETH).div(zooSupply);
        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

        // getting price of borrowToken against depositToken 
        collateralPortion = zooToken_.getEquivalentAmountViaOraclePrice(
            oracle, 
            collateralPortion,
            [L3xUtils.PPath.Ether, L3xUtils.PPath.DepositAsset]
        );
        // convert amount 
        L3xUtils.LendingCallInfo memory withdrawCallInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            dAsset,
            collateralPortion 
        );
        amountToWithdraw = _invokeWithdraw(withdrawCallInfo);
    }

    function _payUserDebtPortion(
        IZooToken zooToken_,
        uint256 quantity_
    )
    private
    returns (uint256[] memory amountsRepaid)
    {
        uint256 userZooBalance = zooToken_.balanceOf(msg.sender);
        uint256 userDebtInBorrowAsset = zooToken_.getDebt(msg.sender);
        
        address[] memory path = new address[](2);
        path[0] = zooToken_.zooIsBull() ? zooToken_.pair().quote : zooToken_.pair().base; 
        path[1] = zooToken_.zooIsBull() ? zooToken_.pair().base : zooToken_.pair().quote; 
        uint256 userDebtInDepositAsset =  getRouter(zooToken_).getAmountsOut(userDebtInBorrowAsset, path)[1];
        
        uint256 debtToRepayInDepositAssetCeil = quantity_.mul(userDebtInDepositAsset).div(userZooBalance); 
        debtToRepayInDepositAssetCeil = debtToRepayInDepositAssetCeil.mul(100).div(90);
        
        // The amount of DepositToken currently held by ZooToken 
        uint256 runningBalanceOfDepositAsset = IERC20(path[1]).balanceOf(address(zooToken_));

        require(debtToRepayInDepositAssetCeil <=  runningBalanceOfDepositAsset, "L3xIssuance: Not enough liquid");
        uint debtToRepay = quantity_.mul(userDebtInBorrowAsset).div(userZooBalance);

        amountsRepaid = _repayDebtForUser(zooToken_, debtToRepayInDepositAssetCeil, debtToRepay);
        // amountRepaid should be equal debtToRepay
        // TODO: Is it necessay to make sure amountsRepaid == debtToRepay or else revert ?
        zooToken_.payDebt(msg.sender, amountsRepaid[1]);  
    }
    
    /**
     * Called by redeem, calculates how much of the zoo balance corresponding to the quantity to be redeemed
     * currentBalancePortion = floor(quantity_ * dTokenBalanceOfZoo / zooTotalSupply)
     */
    function _getUserPortionOfCollateralBalance(
        IZooToken zooToken_,
        uint256 quantity_
    )
    private
    view
    returns(uint256 currentBalancePortion) 
    {
        // Deposit Token
        address dAsset = zooToken_.zooIsBull() ? zooToken_.pair().base:zooToken_.pair().quote;
        uint256 zooSupply = zooToken_.totalSupply();

        currentBalancePortion = quantity_.mul(IERC20(dAsset).balanceOf(address(zooToken_))).div(zooSupply);
    }

    function _multiplyByFactorSwap(
        uint256 amount_,
        uint256 factorx1000_,
        uint256 price_
    )
    private
    pure
    returns (uint256)
    {
        return amount_.mul(factorx1000_).div(1000).preciseDiv(price_);
    }

    /**
     * Borrow token (i.e. quote stable coin) in case of going long.  
     * Borrow the base token (e.g. Weth) in case of going short 
     * @param zooToken_             Instance of the ZooToken to trade
     * @param depositAmount_        Amount to be initally deposited
     */
    function _borrowAgainstCollateral(
        IZooToken zooToken_,
        uint256 depositAmount_
    )
    private
    returns (uint256 notionalBorrowAmount)
    {
        address dAsset = zooToken_.zooIsBull() ? zooToken_.pair().base:zooToken_.pair().quote;
        ILendingPool lender_ = getLender(zooToken_);
        zooToken_.invokeApprove( dAsset, address(lender_) , depositAmount_);

        L3xUtils.LendingCallInfo memory depositInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            dAsset, 
            depositAmount_
        );
        depositInfo.invokeDeposit();
        // approve lender to receive swapped baseToken
        notionalBorrowAmount = _borrowAvailableAmount(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            depositAmount_, 
            configs[address(zooToken_)].amountPerUnitCollateral
        );
        require(notionalBorrowAmount > 0, "L3xIssuanceModule: Borrowing unsuccessful");
    }



    /**
     * Instigates ZooToken to borrow amount of token from Lender based on deposited collateral
     */ 
    function _borrowAvailableAmount(
        IZooToken zooToken_,
        string memory lenderName_,
        uint256 addedCollateral,
        uint256 amountPerUnitCollateral
    )
    private
    returns (
        uint256 amountToBorrow
    )
    {
        address bAsset = zooToken_.zooIsBull()? zooToken_.pair().quote:zooToken_.pair().base; // borrowToken

        uint256 availableBorrows = addedCollateral.preciseMul(BORROW_PORTION_FACTOR);
        availableBorrows = availableBorrows.preciseMul(amountPerUnitCollateral);
        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

        // borrow 99.9% of what available (otherwise reverts)
        amountToBorrow =  zooToken_.getEquivalentAmountViaOraclePrice(
            oracle, 
            availableBorrows,
            [L3xUtils.PPath.DepositAsset, L3xUtils.PPath.BorrowAsset]
        );
        // amountToBorrow = availableBorrows.mul(dTokenPriceInETH).div(bTokenPriceInETH);
        L3xUtils.LendingCallInfo memory borrowInfo = _createLendingCallInfo(
            zooToken_, 
            lenderName_, 
            bAsset,
            amountToBorrow 
        );
        borrowInfo.invokeBorrow();
    }

    /**
     * Instigates ZooToken to Withdraw amount of deposited asset from lender
     */
    function _invokeWithdraw(
        L3xUtils.LendingCallInfo memory withdrawCallInfo_
    )
       private 
       returns (uint256 amountToWithdraw)
    {
        (
            address targetLendingPool,
            uint256 callValue,
            bytes memory methodData
        ) = withdrawCallInfo_.lendingAdapter.getWithdrawCalldata(
            withdrawCallInfo_.asset, 
            withdrawCallInfo_.amount, 
            address(withdrawCallInfo_.zooToken)
        );

        bytes memory data = withdrawCallInfo_.zooToken.invoke(targetLendingPool, callValue, methodData);
        amountToWithdraw = abi.decode(data, (uint256));

    }


    /**
     * Repay debt on Aave by swapping baseToken to quoteToken in order to repay
     */
    function _repayDebtForUser(
        IZooToken zooToken_,
        uint256 debtToRepayInDepositAssetCeil,
        uint256 debtToRepay
    ) 
    private 
    returns (uint256 [] memory amounts)
    {
        address bAsset = zooToken_.zooIsBull() ? zooToken_.pair().quote:zooToken_.pair().base; // borrowToken
        address dAsset = zooToken_.zooIsBull() ? zooToken_.pair().base:zooToken_.pair().quote; // depositToken
        IUniswapV2Router router_ = getRouter(zooToken_); 
        ILendingPool lender_ = getLender(zooToken_);

        zooToken_.invokeApprove(dAsset, address(router_), debtToRepayInDepositAssetCeil);
        // Swap max amount of debtToRepayInBase of baseToken for  exact debtToRepayInQuote amount for quoteAsset
        IExchangeAdapterV3 adapter = IExchangeAdapterV3(getAndValidateAdapter("UNISWAP"));

        amounts = zooToken_.invokeSwap(adapter, debtToRepay, debtToRepayInDepositAssetCeil, false);
        zooToken_.invokeApprove(bAsset, address(lender_), amounts[1]);
        L3xUtils.LendingCallInfo memory repayCallInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            bAsset,       
            amounts[1] 
        );
        repayCallInfo.invokeRepay();
    }

    /**
     * Instigates ZooToken to repay amount of debt to Lender
     */
    function _invokeRepay(
        L3xUtils.LendingCallInfo memory repayCallInfo_
    )
       private 
    {
        (
            address targetLendingPool,
            uint256 callValue,
            bytes memory methodData
        ) = repayCallInfo_.lendingAdapter.getRepayCalldata(
            repayCallInfo_.asset, 
            repayCallInfo_.amount, 
            address(repayCallInfo_.zooToken)
        );

        repayCallInfo_.zooToken.invoke(targetLendingPool, callValue, methodData);
    }
}