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
  * config:
  * * Config for each zoo assigned by manager.
  * * It stores the addresses of lender and dex router.
  * * It determines the amount to be borrowed from the deposited collateral for a given zoo 
  * redeem logic aims at:
  * * Transferring the underlying asset to the caller after deducting the amount of debt
  *
  * IntegrationRegistry connected to this module provides calldata for external ecosystems (e.g Aave, Uniswap)
  * Position Multiplier decreases (i.e. inflation increases) when Manager accrues streaming fees
  * Zoo is bear when BaseToken becomes the borrow asset and QuoteToken (stable coin) becomes the deposit asset
  * Zoo is bull when BaseToken becomes the deposit asset and QuoteToken becomes the borrow asset
  
  * FIXME: Last withdrawal edge case, in which you need to do successive withdrawals and repay
  *  - might require multiple step external call instead
  * FIXME: Initialization of ecosystem: suppose 3 users issue tokes and price goes down on bull.
  *  - Users won't be able even to redeem their funds even with loss ! FIX this 
  *  - Depends on liquidation threshold discussion (risk assessment)
  * FIXME: Borrow only on behalf of users in order to determine the debt for each one properly
  * FIXME: relook positionMultiplier , do it on issue and redeem
  * TODO: beforeTokenTransfer
  * TODO: Liquidation Threshold / Test position liquidation directly on Aave
  * TODO: reassure inflationFee always less than 1 ether
  * TODO: Replace token component variable name by asset
  * TODO: TODO: Rebalance price formula
  * TODO: Module viewer
  * TODO: put an argument for minimum quantity of token to receive from Issue (slippage)
  *
  */ 



contract L3xIssuanceModule is  ModuleBase, ReentrancyGuard, Ownable {
    using Position for IZooToken;
    using SafeMath for uint256;

    /* =================== Enums ==============================*/
 
    enum PPath {
        Ether,
        BorrowToken,
        DepositToken
    } 


    enum Side {
        Bull,
        Bear
    }

    /* ==================== Struct ============================= */

    struct LendingCallInfo {
        IZooToken zooToken;                             // Instance of ZooToken
        ILendingAdapter lendingAdapter;                 // Instance of exchange adapter contract
        address asset;                                  // Address of token being borrowed 
        uint256 amount;                                 // Amount of token to be borrowed
    }
    
    /**
     * Global configuration for module
     */
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
        // TODO: BaseToken / QuoteToken
    }

    uint256 private constant BORROW_PORTION_FACTOR = 0.999 ether;
    uint256 private constant INTEGRATION_REGISTRY_RESOURCE_ID = 0;
    string private constant AAVE_ADAPTER_NAME = "AAVE";
   
    GlobalConfig public globalConfig;
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

     *
     * @param quantity_         Quantity of quote token input to go long 
     * @param price_            price of baseToken (i.e. ETH) in quoteToken (i.e. DAI)
     * @param swapFactorx1000_  The accepted portion of quantity_ to get through after deduction from fees. 
     * This is taking place during the processes of swapping & borrowing (i.e. about 985)
     */
    function issue (
        IZooToken zooToken_,
        uint256 quantity_,
        uint256 price_,
        uint256 swapFactorx1000_  // TODO: to be replaced by slippage
    )
        external
        nonReentrant
        onlyValidAndInitializedSet(zooToken_)
    {
        uint256 depositAmount  = _prepareAmountInForIssue (zooToken_, quantity_, price_, swapFactorx1000_);

        uint256 borrowAmount;
        uint256 totalAmount = depositAmount;
        uint256 totalBorrowAmount;
        for (uint8 i = 0; i < 2; i++) {
            borrowAmount = _borrowAgainstCollateral(zooToken_, depositAmount );
            depositAmount = _swapQuoteAndBase(zooToken_, borrowAmount, _multiplyByFactorSwap(borrowAmount, swapFactorx1000_, price_));

            totalAmount = totalAmount.add(depositAmount);
            totalBorrowAmount = totalBorrowAmount.add(borrowAmount);
        }

        // Borrow quoteToken from lending Protocol
        zooToken_.addDebt(msg.sender, totalBorrowAmount);
        zooToken_.mint(msg.sender, totalAmount);
        require(totalAmount != 0, "L3xIssueMod: Leveraging failed");
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

        // Deposit Token (e.g. WETH)
        address dToken = _zooIsBull(zooToken_)? zooToken_.pair().base : zooToken_.pair().quote;

        //@dev NB: Important to calculate currentBalancePortion before withdrawing collateralPortion and debtRepay
        uint256 currentBalancePortion = _getUserPortionOfCollateralBalance(zooToken_, quantity_);
        uint256[] memory amountsRepaid = _payUserDebtPortion(zooToken_, quantity_);
        // Withdraw 
        uint256 collateralPortion = _withdrawUserPortionOfTotalCollateral(zooToken_, quantity_);

        uint256 redeemAmount = currentBalancePortion.add(collateralPortion).sub(amountsRepaid[0]);
        uint256 positionMultiplier = uint256(zooToken_.positionMultiplier());
        redeemAmount = redeemAmount.mul(positionMultiplier).div(uint256(PreciseUnitMath.preciseUnitInt()));
        
        zooToken_.burn(msg.sender, quantity_);
        zooToken_.transferAsset(IERC20(dToken), msg.sender, redeemAmount);
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
    }

    function removeModule() external override {}

    /* ============== View Functions ===================*/

    function getLender(IZooToken zooToken_) public view returns (ILendingPool ) 
    {
        ILendingPool local = configs[address(zooToken_)].lender;
        return address(local) != address(0)?
           local: globalConfig.lender; 
    }

    function getRouter(IZooToken zooToken_) public view returns (IUniswapV2Router ) 
    {
        IUniswapV2Router local = configs[address(zooToken_)].router;
        return address(local) != address(0)?
           local: globalConfig.router; 
    }

    function getAddressesProvider(IZooToken zooToken_) public view returns (ILendingPoolAddressesProvider ) 
    {
        ILendingPoolAddressesProvider local = configs[address(zooToken_)].addressesProvider;
        return address(local) != address(0)?
           local: globalConfig.addressesProvider; 
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
     * return LendingCallInfo             Struct containing data for trade
     */
    function _createLendingCallInfo(
        IZooToken zooToken_,
        string memory lenderName_,
        address asset_,
        uint256 amount_
    )
        internal
        view
        returns (LendingCallInfo memory)
    {
        LendingCallInfo memory borrowInfo;
        borrowInfo.zooToken = zooToken_;
        borrowInfo.lendingAdapter = ILendingAdapter(getAndValidateAdapter(lenderName_));
        borrowInfo.asset = asset_;
        borrowInfo.amount = amount_;
        return borrowInfo;
    }


    /* ==================================== Private functions ===================================== */

    function _prepareAmountInForIssue(
        IZooToken zooToken_,
        uint256 depositAmountInStableC_,
        uint256 depositTokenPrice_,
        uint256 swapFactorx1000_
    )
    private
    returns (uint256 amountOut) 
    {
        IERC20(zooToken_.pair().quote).transferFrom(msg.sender, address(zooToken_), depositAmountInStableC_);
        if(_zooIsBull(zooToken_)){
           amountOut = _swapQuoteAndBase(zooToken_, depositAmountInStableC_, _multiplyByFactorSwap(depositAmountInStableC_, swapFactorx1000_, depositTokenPrice_)); 
        }
        else {
            amountOut = depositAmountInStableC_;
        }
    }

    // FIXME:
    // function _finalizeRedeem (
    //     IZooToken zooToken_,
    //     uint256 quantity_,
    //     uint256 debtRepaid_
    // ) 
    // private 
    // {
    //     zooToken_.burn(msg.sender, quantity_);
    //     zooToken_.transferAsset(weth, msg.sender, quantity_.sub(debtRepaid_));
    // }

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
        address dToken = _zooIsBull(zooToken_) ? zooToken_.pair().base : zooToken_.pair().quote;   // Deposit Token
        uint256 zooSupply = zooToken_.totalSupply();
        (uint256 totalCollateralETH,,,,,) = configs[address(zooToken_)].lender.getUserAccountData(address(zooToken_));
        uint256 collateralPortion =  quantity_.mul(totalCollateralETH).div(zooSupply);

        // getting price of borrowToken against depositToken 
        collateralPortion = _getEquivalentAmountViaOraclePrice(
            zooToken_, 
            collateralPortion,
            [PPath.Ether, PPath.DepositToken]
        );
        // convert amount 
        LendingCallInfo memory withdrawCallInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            dToken,
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
        uint256 userDebtInBorrowToken = zooToken_.getDebt(msg.sender);
        
        address[] memory path = new address[](2);
        path[0] = _zooIsBull(zooToken_) ? zooToken_.pair().quote : zooToken_.pair().base; 
        path[1] = _zooIsBull(zooToken_) ? zooToken_.pair().base : zooToken_.pair().quote; 
        uint256 userDebtInDepositToken =  getRouter(zooToken_).getAmountsOut(userDebtInBorrowToken, path)[1];
        
        uint256 debtToRepayInDepositTokenCeil = quantity_.mul(userDebtInDepositToken).div(userZooBalance); 
        debtToRepayInDepositTokenCeil = debtToRepayInDepositTokenCeil.mul(100).div(90);
        
        // The amount of DepositToken currently held by ZooToken 
        uint256 runningBalanceOfDepositToken = IERC20(path[1]).balanceOf(address(zooToken_));

        require(debtToRepayInDepositTokenCeil <=  runningBalanceOfDepositToken, "L3xIssuance: Not enough liquid");
        uint debtToRepay = quantity_.mul(userDebtInBorrowToken).div(userZooBalance);

        amountsRepaid = _repayDebtForUser(zooToken_, debtToRepayInDepositTokenCeil, debtToRepay);
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
        address dToken = _zooIsBull(zooToken_) ? zooToken_.pair().base:zooToken_.pair().quote;
        uint256 zooSupply = zooToken_.totalSupply();

        currentBalancePortion = quantity_.mul(IERC20(dToken).balanceOf(address(zooToken_))).div(zooSupply);
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
        return amount_.mul(factorx1000_).div(1000).mul(1 ether).div(price_);
    }

    /**
     * Get equivalent amount in value of token w.r.t the other token based on oracle price provided by Aave.
     */
    function _getEquivalentAmountViaOraclePrice(
        IZooToken zooToken_,
        uint256 amount,
        PPath[2] memory path
    )
    private
    view
    returns (uint256 equivalentAmount)
    {
        address bToken = _zooIsBull(zooToken_) ? zooToken_.pair().quote : zooToken_.pair().base;   // borrow Token
        address dToken = _zooIsBull(zooToken_) ? zooToken_.pair().base : zooToken_.pair().quote;   // Deposit Token
        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

        // getting price of borrowToken against depositToken
        uint256 bTokenPriceInETH = IPriceOracleGetter(oracle).getAssetPrice(bToken); 
        uint256 dTokenPriceInETH = IPriceOracleGetter(oracle).getAssetPrice(dToken);
        uint256[3] memory options = [1 ether, dTokenPriceInETH, bTokenPriceInETH];

        // borrow 99.9% of what available (otherwise reverts)
        equivalentAmount = amount.mul(_choices(path[0], options)).div(_choices(path[1], options));       
    }

    /**
     * Options are ordered : [Ether, DepositToken, BorrowToken]
     */
    function _choices (
        PPath pricePath, 
        uint256[3] memory options
    )
    private
    pure
    returns (uint256 )
    {
        if (pricePath == PPath.Ether)  return options[0];
        if (pricePath == PPath.DepositToken)  return options[1];
        if (pricePath == PPath.BorrowToken)  return options[2];
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
        address dToken = _zooIsBull(zooToken_) ? zooToken_.pair().base:zooToken_.pair().quote;
        ILendingPool lender_ = getLender(zooToken_);
        _invokeApprove(zooToken_, dToken, address(lender_) , depositAmount_);

        LendingCallInfo memory depositInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            dToken, 
            depositAmount_
        );
        _invokeDeposit(depositInfo);
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
     * Swap base token and quote token according to trade direction and  user call (i.e. issue or redeem)
     * @param zooToken_             Instance of the ZooToken to trade
     * @param amountIn_            Amount to be traded
     * @param minAmountOut_         Minimum amount demanded to be the output of the swap given exact amountIn_
     */
    function _swapQuoteAndBase(
        IZooToken zooToken_,
        uint256 amountIn_, 
        uint256 minAmountOut_
      ) 
      private 
      returns (uint256 amountOut) 
    {
        address borrowToken = _zooIsBull(zooToken_) ? zooToken_.pair().quote:zooToken_.pair().base;

        IUniswapV2Router router_ = getRouter(zooToken_);
        _invokeApprove(zooToken_, borrowToken, address(router_), amountIn_);
        amountOut = _invokeSwap(zooToken_, amountIn_, minAmountOut_, true)[1]; 
        require(amountOut != 0, "L3xIssueMod: Leveraging swapping failed");
    }
    /**
     * Repay debt on Aave by swapping baseToken to quoteToken in order to repay
     */
    function _repayDebtForUser(
        IZooToken zooToken_,
        uint256 debtToRepayInDepositTokenCeil,
        uint256 debtToRepay
    ) 
    private 
    returns (uint256 [] memory amounts)
    {
        address bToken = _zooIsBull(zooToken_) ? zooToken_.pair().quote:zooToken_.pair().base; // borrowToken
        address dToken = _zooIsBull(zooToken_) ? zooToken_.pair().base:zooToken_.pair().quote; // depositToken
        IUniswapV2Router router_ = getRouter(zooToken_); 
        ILendingPool lender_ = getLender(zooToken_);

        _invokeApprove(zooToken_, dToken, address(router_), debtToRepayInDepositTokenCeil);
        // Swap max amount of debtToRepayInBase of baseToken for  exact debtToRepayInQuote amount for quoteToken

        amounts = _invokeSwap(zooToken_, debtToRepay, debtToRepayInDepositTokenCeil, false);
        _invokeApprove(zooToken_, bToken, address(lender_), amounts[1]);
        LendingCallInfo memory repayCallInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            bToken,       
            amounts[1] 
        );
        _invokeRepay(repayCallInfo);
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
        address bToken = _zooIsBull(zooToken_)? zooToken_.pair().quote:zooToken_.pair().base; // borrowToken

        uint256 availableBorrows = addedCollateral.mul(BORROW_PORTION_FACTOR).div(1 ether);
        availableBorrows = availableBorrows.mul(amountPerUnitCollateral).div(1 ether);

        // borrow 99.9% of what available (otherwise reverts)
        amountToBorrow =  _getEquivalentAmountViaOraclePrice(
            zooToken_, 
            availableBorrows,
            [PPath.DepositToken, PPath.BorrowToken]
        );
        // amountToBorrow = availableBorrows.mul(dTokenPriceInETH).div(bTokenPriceInETH);
        LendingCallInfo memory borrowInfo = _createLendingCallInfo(
            zooToken_, 
            lenderName_, 
            bToken,
            amountToBorrow 
        );
        _invokeBorrow(borrowInfo);
    }

    /**
     * Instructs the ZooToken to call swap tokens of the ERC20 token on target Uniswap like dex 
     *
     * @param zooToken_        ZooToken instance to invoke
     * @param amountExact_          Exact Amount of token to exchange
     * Considered amountIn if shouldSwapExactTokensForTokens is true and amountOut otherwise
     * @param amountEdge_          Amount of token to exchange in return for amountExact_
     * Considered amountMax if shouldSwapExactTokensForTokens is true and amountMin otherwise
     */
    function _invokeSwap(
        IZooToken zooToken_,
        uint256 amountExact_,
        uint256 amountEdge_,
        bool shouldSwapExactTokensForTokens_ 
    )
    private 
    returns (uint256[] memory amounts)
    {
        address bToken = _xnor(shouldSwapExactTokensForTokens_, _zooIsBull(zooToken_))? 
             zooToken_.pair().quote:zooToken_.pair().base;
        address dToken = _xnor(shouldSwapExactTokensForTokens_, _zooIsBull(zooToken_))? 
             zooToken_.pair().base:zooToken_.pair().quote;

        IExchangeAdapterV3 adapter = IExchangeAdapterV3(getAndValidateAdapter("UNISWAP"));
        (
            address target,
            uint256 callValue,
            bytes memory methodData
        ) = adapter.getTradeCalldata(
            bToken, 
            dToken, 
            address(zooToken_), 
            amountExact_, 
            amountEdge_, 
            shouldSwapExactTokensForTokens_,
            ""
        );
        bytes memory data = zooToken_.invoke(target, callValue, methodData);
        amounts = abi.decode(data, (uint256[]));
    }
    /**
     * Instructs the ZooToken to set approvals of the ERC20 token to a spender.
     *
     * @param _zooToken        ZooToken instance to invoke
     * @param _token           ERC20 token to approve
     * @param _spender         The account allowed to spend the ZooToken's balance
     * @param _quantity        The quantity of allowance to allow
     */
    function _invokeApprove(
        IZooToken _zooToken,
        address _token,
        address _spender,
        uint256 _quantity
    )
       private 
    {
        bytes memory callData = abi.encodeWithSignature("approve(address,uint256)", _spender, _quantity);
        _zooToken.invoke(_token, 0, callData);
    }

    /**
     *  Instigates the ZooToken to deposit asset in Lender
     */
    function _invokeDeposit(
        LendingCallInfo memory depositInfo_
    )
       private 
    {
        (
            address targetLendingPool,
            uint256 callValue,
            bytes memory methodData
        ) = depositInfo_.lendingAdapter.getDepositCalldata(
            depositInfo_.asset, 
            depositInfo_.amount, 
            address(depositInfo_.zooToken)
        );
        depositInfo_.zooToken.invoke(targetLendingPool, callValue, methodData);
    }

    /**
     * Instigates ZooToken to borrow amound of asset against deposited collateral in lender
     */
    function _invokeBorrow(
        LendingCallInfo memory borrowInfo_
    )
       private 
    {
        (
            address targetLendingPool,
            uint256 callValue,
            bytes memory methodData
        ) = borrowInfo_.lendingAdapter.getBorrowCalldata(
            borrowInfo_.asset, 
            borrowInfo_.amount, 
            address(borrowInfo_.zooToken)
        );
        borrowInfo_.zooToken.invoke(targetLendingPool, callValue, methodData);
    }

    /**
     * Instigates ZooToken to Withdraw amount of deposited asset from lender
     */
    function _invokeWithdraw(
        LendingCallInfo memory withdrawCallInfo_
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
     * Instigates ZooToken to repay amount of debt to Lender
     */
    function _invokeRepay(
        LendingCallInfo memory repayCallInfo_
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

    function _zooIsBull(IZooToken zooToken_) private view returns (bool)
    {
       return (zooToken_.side() == IZooToken.Side.Bull);
    }

    function _xnor (bool x, bool y) private pure returns (bool z) {
        z = (x || !y ) && (!x || y);
    }
}