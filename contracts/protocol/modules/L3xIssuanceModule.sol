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
import { Position } from "../lib/Position.sol";
import { ModuleBase } from "../lib/ZooModuleBase.sol";
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
  * FIXME: Last withdrawal edge case, in which you need to do successive withdrawals and repay
  *  - might require multiple step external call instead
  * FIXME: Initialization of ecosystem: suppose 3 users issue tokes and price goes down on bull.
  *  - Users won't be able even to redeem their funds even with loss ! FIX this 
  *  - Depends on liquidation threshold discussion (risk assessment)
  * FIXME: Borrow only on behalf of users in order to determine the debt for each one properly
  * DONE: Redeem logic
  * TODO: Liquidation Threshold
  * TODO: Go bear
  * DONE: add 0.8 factor to configs
  * TODO: Streaming fees 
  * TODO: Replace token component variable name by asset
  * TODO: Constructor: replace weth_ by underlying asset of LevToken (replacing SetToken)
  * DONE: Mint and set debt on zooToken
  * TODO: Rebalance price formula
  * DONE: Access control on setting lender and router (each token should have their own config)
  * TODO: Module viewer
  * TODO: put an argument for minimum quantity of token to receive from Issue (slippage)
  * TODO: Investigate might Change all to swapTokensForExactTokens
  * DONE: Integration Registry should be the provider of the calldata
  * DONE: _borrowQuoteForBaseCollateral: at the end ensure borrow took place smh
  * DONE: _swapQuoteForBase: at the end ensure swap took place
  * DONE: _borrowAvailableAmount: consider parameterizing the 0.999 factor
  *
  */ 



contract L3xIssuanceModule is  ModuleBase, ReentrancyGuard {
    using Position for IZooToken;
    using SafeMath for uint256;

    uint256 private constant BORROW_PORTION_FACTOR = 0.999 ether;
    uint256 private constant INTEGRATION_REGISTRY_RESOURCE_ID = 0;
    string private constant AAVE_ADAPTER_NAME = "AAVE";

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
        uint256 amountPerEthCollateral;                 // Amount to be borrowed for each unit of collateral in Eth

    }
    
    /**
     * Config dependent on token / unchangeable
     */
    struct TokenConfig {
        Side side;                                      // Bull or Bear - this config is fixed (non changeable)
        // TODO: BaseToken / QuoteToken
    }

    enum Side {
        Bull,
        Bear
    }
    
    GlobalConfig public globalConfig;
    mapping(address => LocalModuleConfig) public configs;

    IERC20 public weth; // 
    IERC20 public dai;



    /* ============ Constructor ============ */
    /**
     * 
     * @param weth_   Address of WETH, represents baseToken (NOTE will be pointed at in SetToken)      
     * @param dai_    Address of DAI, Represents the quoteToken 
     */
    
    constructor(IController _controller, IERC20 weth_, IERC20 dai_) public ModuleBase (_controller) {
        weth = weth_;
        dai = dai_;
    }

    /* ============ External Functions ============ */

    /**
     * Initializes this module to the SetToken. Only callable by the SetToken's manager.
     *
     * @param zooToken_                 Instance of the SetToken to initialize
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

    function deposit(
    )
    external 
    payable
    {
        payable(address(weth)).call{value: msg.value}("");
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
     * @param basePriceInQuotes_ price of baseToken (i.e. ETH) in quoteToken (i.e. DAI)
     * @param swapFactorx1000_   The accepted portion of quantity_ to get through after deduction from fees. 
     * This is taking place during the processes of swapping & borrowing (i.e. about 985)
     */
    function issue (
        IZooToken zooToken_,
        uint256 quantity_,
        uint256 basePriceInQuotes_,
        uint256 swapFactorx1000_  // TODO: to be replaced by slippage
    )
        external
        nonReentrant
        onlyValidAndInitializedSet(zooToken_)
    {
        dai.transferFrom(msg.sender, address(zooToken_), quantity_);
        // swap dai for baseToken
        uint256 amountOut = _swapQuoteForBase(zooToken_, quantity_, _multiplyByFactorSwap(quantity_, swapFactorx1000_, basePriceInQuotes_)); 
        uint256 borrowAmount;
        uint256 totalAmountOut = amountOut;
        uint256 totalBorrowAmount;
        for (uint8 i = 0; i < 2; i++) {
            borrowAmount = _borrowQuoteForBaseCollateral(zooToken_, amountOut );
            amountOut = _swapQuoteForBase(zooToken_, borrowAmount, _multiplyByFactorSwap(borrowAmount, swapFactorx1000_, basePriceInQuotes_));

            totalAmountOut = totalAmountOut.add(amountOut);
            totalBorrowAmount = totalBorrowAmount.add(borrowAmount);
        }

        // Borrow quoteToken from lending Protocol
        zooToken_.addDebt(msg.sender, totalBorrowAmount);
        zooToken_.mint(msg.sender, totalAmountOut);
        require(totalAmountOut != 0, "L3xIssueMod: Leveraging failed");
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
     * DONE: Might need to do rebalance (investigate) ?
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
        IUniswapV2Router router_ = configs[address(zooToken_)].router;
        uint256 userZooBalance = zooToken_.balanceOf(msg.sender);
        if(quantity_  ==  uint256(-1)) {
              quantity_ = userZooBalance;
        }
        require(quantity_ <= userZooBalance, "L3xIssuance: Not enough NAV" );

        //@dev NB: Important to calculate currentBalancePortion before withdrawing collateralPortion and debtRepay
        uint256 currentBalancePortion = _getUserPortionOfBaseBalance(zooToken_, quantity_);
        uint256[] memory amountsRepaid = _payUserDebtPortion(zooToken_, quantity_);
        // Withdraw 
        uint256 collateralPortion = _withdrawUserPortionOfTotalCollateral(zooToken_, quantity_);
        
        zooToken_.burn(msg.sender, quantity_);
        zooToken_.transferAsset(weth, msg.sender, currentBalancePortion.add(collateralPortion).sub(amountsRepaid[0]));
    }

    /**
     * Administrative calls: to be called by Manager only
     * // TODO: make it accessible by owner only
     */
     function setGlobalConfig(
         address zooToken_,
         GlobalConfig calldata config_
    )
    external
    onlySetManager(IZooToken(zooToken_), msg.sender)
    {
        globalConfig.addressesProvider = config_.addressesProvider;
        globalConfig.lender = config_.lender;
        globalConfig.router = config_.router;
    }


    /**
     * Administrative calls: to be called by Manager only
     */
     function setConfigForToken(
         address zooToken_,
         LocalModuleConfig calldata config_
    )
    external
    onlySetManager(IZooToken(zooToken_), msg.sender)
    {
        uint256 amountPerEthCollateral = config_.amountPerEthCollateral;
        require(amountPerEthCollateral > 0, "Zero amountPerCollateral unallowed");
        configs[zooToken_].addressesProvider = config_.addressesProvider;
        configs[zooToken_].lender = config_.lender;
        configs[zooToken_].router = config_.router;
        configs[zooToken_].amountPerEthCollateral = amountPerEthCollateral;
    }

    function removeModule() external override {}

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


   /**  -------------------------------- Private functions --------------------------------------------------
    */

    function _finalizeRedeem (
        IZooToken zooToken_,
        uint256 quantity_,
        uint256 debtRepaid_
    ) 
    private 
    {
        zooToken_.burn(msg.sender, quantity_);
        zooToken_.transferAsset(weth, msg.sender, quantity_.sub(debtRepaid_));
    }

    function _withdrawUserPortionOfTotalCollateral(
        IZooToken zooToken_,
        uint256 quantity_
    )
    private
    returns(uint256 amountToWithdraw) 
    {
        uint256 zooSupply = zooToken_.totalSupply();
        (uint256 totalCollateralETH,,,,,) = configs[address(zooToken_)].lender.getUserAccountData(address(zooToken_));
        uint256 collateralPortion =  quantity_.mul(totalCollateralETH).div(zooSupply);
        LendingCallInfo memory withdrawCallInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            address(weth), 
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
        uint256 userDebtInQuote = zooToken_.getDebt(msg.sender);
        
        address[] memory path = new address[](2);
        path[0] = address(dai); 
        path[1] = address(weth);
        uint256 userDebtInBase =  getRouter(zooToken_).getAmountsOut(userDebtInQuote, path)[1];
        
        uint256 debtToRepayInBaseCeil = quantity_.mul(userDebtInBase).div(userZooBalance); 
        debtToRepayInBaseCeil = debtToRepayInBaseCeil.mul(100).div(90);

        require(debtToRepayInBaseCeil <= weth.balanceOf(address(zooToken_)) , "L3xIssuance: Not enough liquid");
        uint debtToRepayInQuote = quantity_.mul(userDebtInQuote).div(userZooBalance);

        amountsRepaid = _repayDebtForUser(zooToken_, debtToRepayInBaseCeil, debtToRepayInQuote);
        zooToken_.payDebt(msg.sender, amountsRepaid[1]);  // quoteAmountRepaid
    }

    function _getUserPortionOfBaseBalance(
        IZooToken zooToken_,
        uint256 quantity_
    )
    private
    view
    returns(uint256 currentBalancePortion) 
    {
        uint256 zooSupply = zooToken_.totalSupply();
        // currentBalancePortion = floor(quantity_ * wethBalanceOfZoo / zooTotalSupply)
        currentBalancePortion = quantity_.mul(weth.balanceOf(address(zooToken_))).div(zooSupply);
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
    function _borrowQuoteForBaseCollateral(
        IZooToken zooToken_,
        uint256 depositAmount_
    )
    private
    returns (uint256 notionalBorrowAmount)
    {
        ILendingPool lender_ = getLender(zooToken_);
        _invokeApprove(zooToken_, address(weth), address(lender_) , depositAmount_);

        LendingCallInfo memory depositInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            address(weth), 
            depositAmount_
        );
        _invokeDeposit(depositInfo);
        // approve lender to receive swapped baseToken
        (notionalBorrowAmount, ) = _borrowAvailableAmount(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            depositAmount_, 
            configs[address(zooToken_)].amountPerEthCollateral
        );
        require(notionalBorrowAmount > 0, "L3xIssuanceModule: Borrowing unsuccessful");
    }
    function _swapQuoteForBase(
        IZooToken zooToken_,
        uint256 amountIn_, 
        uint256 minAmountOut_
      ) 
      private 
      returns (uint256 amountOut) 
    {
        IUniswapV2Router router_ = getRouter(zooToken_);
        _invokeApprove(zooToken_, address(dai), address(router_), amountIn_);
        amountOut = _invokeSwap(zooToken_, amountIn_, minAmountOut_, Side.Bull)[1];
        require(amountOut != 0, "L3xIssueMod: Leveraging swapping failed");
    }
    /**
     * Repay debt on Aave by swapping baseToken to quoteToken in order to repay
     */
    function _repayDebtForUser(
        IZooToken zooToken_,
        uint256 debtToRepayInBaseCeil,
        uint256 debtToRepayInQuote
    ) 
    private 
    returns (uint256 [] memory amounts)
    {

        IUniswapV2Router router_ = getRouter(zooToken_); 
        ILendingPool lender_ = getLender(zooToken_);

        _invokeApprove(zooToken_, address(weth), address(router_), debtToRepayInBaseCeil);
        // Swap max amount of debtToRepayInBase of baseToken for  exact debtToRepayInQuote amount for quoteToken

        amounts = _invokeSwap(zooToken_, debtToRepayInQuote, debtToRepayInBaseCeil, Side.Bear);
        _invokeApprove(zooToken_, address(dai), address(lender_), amounts[1]);
        LendingCallInfo memory repayCallInfo = _createLendingCallInfo(
            zooToken_, 
            AAVE_ADAPTER_NAME, 
            address(dai), 
            amounts[1] 
        );
        _invokeRepay(repayCallInfo);
    }

    function _borrowAvailableAmount(
        IZooToken zooToken_,
        string memory lenderName_,
        uint256 collateral,
        uint256 amountPerUnitCollateral
    )
    private
    returns (
        uint256 quoteAmountToBorrow,
        uint256 baseAmountToBorrow
    )
    {

        address oracle =  getAddressesProvider(zooToken_).getPriceOracle();
        uint256 quotePriceInETH = IPriceOracleGetter(oracle).getAssetPrice(address(dai));

        uint256 availableBorrowsETH = collateral.mul(amountPerUnitCollateral).div(1 ether);

        // borrow 99.9% of what available (otherwise reverts)
        quoteAmountToBorrow = availableBorrowsETH.mul(BORROW_PORTION_FACTOR).div(quotePriceInETH);
        LendingCallInfo memory borrowInfo = _createLendingCallInfo(
            zooToken_, 
            lenderName_, 
            address(dai), 
            quoteAmountToBorrow 
        );
        _invokeBorrow(borrowInfo);
        // _invokeBorrow(zooToken_, address(dai), quoteAmountToBorrow);
        baseAmountToBorrow = availableBorrowsETH.mul(BORROW_PORTION_FACTOR).div(1 ether);
    }

    /**
     * Instructs the ZooToken to call swap tokens of the ERC20 token on target Uniswap like dex 
     *
     * @param zooToken_        SetToken instance to invoke
     * @param amountExact_          Exact Amount of token to exchange
     * Considered amountIn if Side.Bull and amountOut if Side.Bear
     * @param amountEdge_          Amount of token to exchange in return for amountExact_
     * Considered amountMax to be in if Side.Bull and amountMin to be out if Side.Bear
     */
    function _invokeSwap(
        IZooToken zooToken_,
        uint256 amountExact_,
        uint256 amountEdge_,
        Side side
    )
    private 
    returns (uint256[] memory amounts)
    {
        address[] memory path = new address[](2);
        path[0] = side == Side.Bull?  address(dai): address(weth); 
        path[1] = side == Side.Bull?  address(weth): address(dai);

        IExchangeAdapterV3 adapter = IExchangeAdapterV3(getAndValidateAdapter("UNISWAP"));
        (
            address target,
            uint256 callValue,
            bytes memory methodData
        ) = adapter.getTradeCalldata(
            path[0], 
            path[1], 
            address(zooToken_), 
            amountExact_, 
            amountEdge_, 
            side == Side.Bull,
            ""
        );
        bytes memory data = zooToken_.invoke(target, callValue, methodData);
        amounts = abi.decode(data, (uint256[]));
    }
    /**
     * Instructs the SetToken to set approvals of the ERC20 token to a spender.
     *
     * @param _zooToken        SetToken instance to invoke
     * @param _token           ERC20 token to approve
     * @param _spender         The account allowed to spend the SetToken's balance
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

}