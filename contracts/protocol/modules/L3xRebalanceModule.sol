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
import { L3xUtils } from "../lib/L3xUtils.sol";
import "hardhat/console.sol";

/**
 * @title L3xRebalanceModule
 * @author IndexZoo Ltd.
 *
 * The L3xRebalanceModule is a module that enables users to realign their positions by increasing the amount 
 * of borrowed assets if the leveraged token position is winning. Or instead repay parts of the asset load if 
 * the leveraged token position is losing.
 * 
 * NOTE: 
 */
 /**
  * @dev Notes
 *
  */ 

contract L3xRebalanceModule is  ModuleBase, ReentrancyGuard, Ownable {
    using Position for IZooToken;
    using SafeMath for uint256;
    using PreciseUnitMath for uint256;
    using L3xUtils for IZooToken;
    using L3xUtils for L3xUtils.LendingCallInfo;

    /* =================== Enums ==============================*/
    enum Side {
        Bull,
        Bear
    }

    /* ==================== Structs ============================= */
    
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
    }

    /* ============ Events ============ */

    event TokenRebalancedForHolder(
        IZooToken indexed _zooToken,
        address indexed _holder,
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
    uint256 private constant INTEGRATION_REGISTRY_RESOURCE_ID = 0;
    string private constant AAVE_ADAPTER_NAME = "AAVE";
    uint256 private constant STD_SCALER = 1 ether;

    /* ==================== State Variables ========================== */
   
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

 

    function rebalancePosition (
        IZooToken zooToken_
    )
    external
    onlyValidAndInitializedSet(zooToken_)
    {
        // FIXME: TODO consider gains vs losses - bear vs bull 

        uint256 bpd = configs[address(zooToken_)].amountPerUnitCollateral;
        uint256 zoos = zooToken_.balanceOf(msg.sender);
        uint256 debt = zooToken_.getDebt(msg.sender);
        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

        zoos = zooToken_.getEquivalentAmountViaOraclePrice(
            oracle, 
            zoos, 
            [L3xUtils.PPath.DepositAsset, L3xUtils.PPath.BorrowAsset ]
        ); 
        (bool isBorrow, uint256 amount) = _calculateBorrowOrRepayAmount(zoos, debt, bpd);

        require(amount != 0,  "No change in position for Rebalance");

        if (isBorrow) {
            uint256 depositAmount = _addToDepositForRebalance(zooToken_, zoos, debt, bpd);

            uint borrowAmount = _borrowForRebalance(zooToken_, amount);

            zooToken_.mint(msg.sender, borrowAmount);

            emit TokenRebalancedForHolder(
                zooToken_, 
                msg.sender, 
                zooToken_.balanceOf(msg.sender),
                zooToken_.getDebt(msg.sender)
            );
        }  else {
            // FIXME: dependency -> liquidation Module (i.e. it requires healthy token)
            uint256[] memory amountsRepaid = _repayDebtForUser(zooToken_, amount.mul(1000).div(900), amount);
            uint256 withdrawAmount = _withdrawPortion(zooToken_, zoos, debt, bpd);

            // zooToken_.burn(msg.sender, amountsRepaid[0]);

            // emit TokenRebalancedForHolder(
            //     zooToken_, 
            //     msg.sender, 
            //     zooToken_.balanceOf(msg.sender),
            //     zooToken_.getDebt(msg.sender)
            // );
        }
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

    function _borrowForRebalance (
        IZooToken zooToken_,
        uint256 borrowAmount
    )
    private 
    returns (uint256 borrowAmountOut) 
    {
        address bAsset = zooToken_.pair().quote;
        L3xUtils.LendingCallInfo memory borrowInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            bAsset,
            borrowAmount 
        );
        zooToken_.addDebt(msg.sender, borrowAmount);
        borrowInfo.invokeBorrow();
        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

         uint256 minAmountOut_ = zooToken_.getEquivalentAmountViaOraclePrice(
            oracle, 
            borrowAmount, 
            [L3xUtils.PPath.BorrowAsset, L3xUtils.PPath.DepositAsset ]
        );       
        IExchangeAdapterV3 adapter = IExchangeAdapterV3(getAndValidateAdapter("UNISWAP"));
        borrowAmountOut = zooToken_.swapQuoteAndBase(adapter, getRouter(zooToken_), borrowAmount, minAmountOut_.mul(985).div(1000));

    }

    function _withdrawPortion (
        IZooToken zooToken_,
        uint256 exposure_,
        uint256 debt_,
        uint256 bpd_
    )
    private
    returns (uint256 withdrawAmount_)
    {
        address dAsset = zooToken_.pair().base;

        uint256 withdrawAmount = _calculateDepositOrWithdrawAmount(exposure_, debt_, bpd_, false);
        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

        withdrawAmount_ = zooToken_.getEquivalentAmountViaOraclePrice(
            oracle, 
            withdrawAmount, 
            [L3xUtils.PPath.BorrowAsset, L3xUtils.PPath.DepositAsset ]
        );

        L3xUtils.LendingCallInfo memory withdrawInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            dAsset, 
            withdrawAmount_
        );
        // TODO: NOTE: Just do not do if you don't have enough collateral 
        withdrawInfo.invokeWithdraw();
    }

    function _addToDepositForRebalance (
        IZooToken zooToken_,
        uint256 exposure_,
        uint256 debt_,
        uint256 bpd_
    )
    private
    returns (uint256 depositAmount_)
    {
        address dAsset = zooToken_.pair().base;

        uint256 depositAmount = _calculateDepositOrWithdrawAmount(exposure_, debt_, bpd_, true);
        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();

        depositAmount_ = zooToken_.getEquivalentAmountViaOraclePrice(
            oracle, 
            depositAmount, 
            [L3xUtils.PPath.BorrowAsset, L3xUtils.PPath.DepositAsset ]
        );
        address lender = address(getLender(zooToken_));

        zooToken_.invokeApprove( dAsset, lender, depositAmount_);
        
        L3xUtils.LendingCallInfo memory depositInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            dAsset, 
            depositAmount_
        );
        // NOTE: Just do not do if you don't have enough liquidity
        depositInfo.invokeDeposit();
    }


    function _calculateBorrowOrRepayAmount(
        uint256 exposure_,
        uint256 debt_,
        uint256 bpd_ 
    )
    private
    pure
    returns(bool isBorrow, uint256 amount)
    {
        uint256 s1 =  bpd_*bpd_/1 ether *bpd_/1 ether +  bpd_ * bpd_ / 1 ether + bpd_;  // safe !
        uint256 s2 = s1 + 1 ether;
        uint256 x_ = exposure_.preciseDiv(s2);  // final price
        uint256 c1 = x_.preciseMul(s1).preciseMul(s2);
        uint256 c2 =  debt_.preciseMul(s2);

        if (c1 == c2) {
            amount = 0;
        } else if (c1 > c2) {
           isBorrow = true; 
           amount =  c1 - c2;
        } else {
            isBorrow = false;
            amount = c2 - c1;
        }
    }

    function _calculateDepositOrWithdrawAmount(
        uint256 exposure_,
        uint256 debt_,
        uint256 bpd_,
        bool isBorrow
    )
    private
    pure
    returns(uint256 ) 
    {
        uint256 s0 = STD_SCALER + bpd_ + bpd_*bpd_/1 ether;
        uint256 s1 = bpd_ * bpd_ / STD_SCALER + bpd_ + bpd_ * bpd_ / STD_SCALER * bpd_/STD_SCALER;  // safe !
        uint256 s2 = s1 + STD_SCALER;
        
        uint256 x = debt_.preciseDiv(s1);    // initial price
        uint256 x_ = exposure_.preciseDiv(s2);
        
        uint256 priceJump = x_.preciseDiv(x); // TODO:  if less than 1 ether (i.e. loss) do withdraw and repay
        uint256 delta = isBorrow? priceJump.sub(STD_SCALER) : STD_SCALER.sub(priceJump);
        
        uint256 depositAmount = s0.preciseMul(s1); 
        depositAmount = depositAmount.preciseMul(x); 
        depositAmount = depositAmount.preciseMul(delta); 
        return depositAmount;
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
        // FIXME: work on here -- deltaDebt
        address bAsset = zooToken_.zooIsBull() ? zooToken_.pair().quote:zooToken_.pair().base; // borrowToken
        address dAsset = zooToken_.zooIsBull() ? zooToken_.pair().base:zooToken_.pair().quote; // depositToken
        IUniswapV2Router router_ = getRouter(zooToken_); 
        ILendingPool lender_ = getLender(zooToken_);

        zooToken_.invokeApprove(dAsset, address(router_), debtToRepayInDepositTokenCeil);
        // Swap max amount of debtToRepayInBase of baseToken for  exact debtToRepayInQuote amount for quoteToken

        IExchangeAdapterV3 adapter = IExchangeAdapterV3(getAndValidateAdapter("UNISWAP"));
        amounts = zooToken_.invokeSwap(adapter, debtToRepay, debtToRepayInDepositTokenCeil, false);
        zooToken_.invokeApprove( bAsset, address(lender_), amounts[1]);
        L3xUtils.LendingCallInfo memory repayCallInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            bAsset,       
            amounts[1] 
        );
        zooToken_.payDebt(msg.sender, amounts[1]);
        repayCallInfo.invokeRepay();
    }
}