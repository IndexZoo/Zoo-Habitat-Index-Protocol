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
  * DONE: Redeem logic
  * TODO: Make calls from  an integration registry
  * TODO: Streaming fees 
  * TODO: Replace token component variable name by asset
  * DONE: Mint and set debt on zooToken
  * TODO: Rebalance formula
  * TODO: Liquidation Threshold
  * TODO: Access control on setting lender and router (each token should have their own config)
  * TODO: Module viewer
  * TODO: Constructor: replace weth_ by underlying asset of LevToken (replacing SetToken)
  * TODO: put an argument for minimum quantity of token to receive from Issue (slippage)
  * TODO: Integration Registry should be the provider of the calldata
  * TODO: _borrowQuoteForBaseCollateral: at the end ensure borrow took place smh
  * TODO: _swapQuoteForBase: at the end ensure swap took place
  * TODO: _borrowAvailableAmount: consider parameterizing the 0.999 factor
  * TODO: _borrowAvailableAmount: at the end ensure borrow took place smh

  *
  */ 
contract L3xIssuanceModule is  ModuleBase, ReentrancyGuard {
    using Position for IZooToken;
    using SafeMath for uint256;

    enum Side {
        Bull,
        Bear
    }
    ILendingPool public lender;
    IUniswapV2Router public router;
    ILendingPoolAddressesProvider public addressesProvider;
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
        uint256 swapFactorx1000_
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
        uint256 userZooBalance = zooToken_.balanceOf(msg.sender);
        uint256 tokenBaseBalance = weth.balanceOf(address(zooToken_));
        if(quantity_  ==  uint256(-1)) {
              quantity_ = userZooBalance;
        }
        require(quantity_ <= userZooBalance, "L3xIssuance: Not enough NAV" );

        require(quantity_ <= tokenBaseBalance.mul(90).div(100), "L3xIssuance: Not enough liquid");

        uint256 userDebtInQuote = zooToken_.getDebt(msg.sender);
        
        address[] memory path = new address[](2);
        path[0] = address(dai); 
        path[1] = address(weth);
        uint256 userDebtInBase = router.getAmountsOut(userDebtInQuote, path)[1];
        
        uint256 debtToRepayInBaseCeil = quantity_.mul(userDebtInBase).div(userZooBalance); 
        debtToRepayInBaseCeil = debtToRepayInBaseCeil.mul(100).div(90);
        uint debtToRepayInQuote = quantity_.mul(userDebtInQuote).div(userZooBalance);

        uint256 [] memory amountsRepaid = _repayDebtForUser(zooToken_, debtToRepayInBaseCeil, debtToRepayInQuote);
        zooToken_.payDebt(msg.sender, amountsRepaid[1]);  // quoteAmountRepaid
        _finalizeRedeem(zooToken_, quantity_, amountsRepaid[0]);  // baseAmountRepaid
        (, uint256 baseAmountToBorrow) = _borrowAvailableAmount(zooToken_);
        uint256 quoteBalanceOfZoo = dai.balanceOf(address(zooToken_));
        _invokeApprove(zooToken_, address(dai), address(router), quoteBalanceOfZoo);
        _invokeSwap(zooToken_, quoteBalanceOfZoo, baseAmountToBorrow.mul(90).div(100), Side.Bull);
    }

    /**
     * Function aims at rebalancing deposits with debt to achieve the aimed leverage
     * TODO: This function can be called by anyone if enabled by Manager
     * -> if not enabled by manager then only allowed callers (also set by manager) can call this
     * 
     * @dev Rebalancing steps:
     * * Show the amount available for borrow from lending protocol (Aave) 
     *
     *
     * @param zooToken_         Zoo Token chosen to be rebalanced 
     */
    function rebalanceIndex(
        IZooToken zooToken_
    )
        external
        nonReentrant
        onlyValidAndInitializedSet(zooToken_)
    {
        _borrowAvailableAmount(zooToken_);
    }

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


    /**
     * Administrative calls: to be called by Manager only
     */
    function setLendingPool( ILendingPool lender_) external 
    // onlySetManager(setToken_, msg.sender) 
    {
        lender = lender_;
    }
    function setRouter( IUniswapV2Router router_) external 
    // onlySetManager(setToken_, msg.sender) 
    {
        router = router_;
    }

    function setAddressesProvider(ILendingPoolAddressesProvider provider) external 
    {
        addressesProvider = provider;
    }

    function removeModule() external override {}


   /**  -------------------------------- Private functions --------------------------------------------------
    */
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
        IZooToken zooToken,
        uint256 depositAmount
    )
    private
    returns (uint256 notionalBorrowAmount)
    {
        _invokeApprove(zooToken, address(weth), address(lender), depositAmount);
        _invokeDeposit(zooToken, address(weth), depositAmount);
        // approve lender to receive swapped baseToken
        (notionalBorrowAmount, ) = _borrowAvailableAmount(zooToken);
    }
    function _swapQuoteForBase(
        IZooToken zooToken_,
        uint256 amountIn_, 
        uint256 minAmountOut_
      ) 
      private 
      returns (uint256 amountOut) 
    {

        _invokeApprove(zooToken_, address(dai), address(router), amountIn_);
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
        _invokeApprove(zooToken_, address(weth), address(router), debtToRepayInBaseCeil);
        // Swap max amount of debtToRepayInBase of baseToken for  exact debtToRepayInQuote amount for quoteToken
        amounts = _invokeSwap(zooToken_, debtToRepayInQuote, debtToRepayInBaseCeil, Side.Bear);
        _invokeApprove(zooToken_, address(dai), address(lender), debtToRepayInQuote);
        _invokeRepay(zooToken_, address(dai), debtToRepayInQuote);
    }

    function _borrowAvailableAmount(
        IZooToken zooToken_
    )
    private
    returns (
        uint256 quoteAmountToBorrow,
        uint256 baseAmountToBorrow
    )
    {
        (,,uint256 availableBorrowsETH,,,) = lender.getUserAccountData(address(zooToken_));
        address oracle = addressesProvider.getPriceOracle();
        
        uint256 quotePriceInETH = IPriceOracleGetter(oracle).getAssetPrice(address(dai));
        // borrow 99.9% of what available (otherwise reverts)
        quoteAmountToBorrow = availableBorrowsETH.mul(0.999 ether).div(quotePriceInETH);
        _invokeBorrow(zooToken_, address(dai), quoteAmountToBorrow);
        baseAmountToBorrow = availableBorrowsETH.mul(0.999 ether).div(1 ether);
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
        string memory callString = side == Side.Bull? 
          "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)":
          "swapTokensForExactTokens(uint256,uint256,address[],address,uint256)";
        // TODO: Investigate might Change all to swapTokensForExactTokens
        bytes memory callData = abi.encodeWithSignature(
            callString,
            amountExact_,
            amountEdge_,
            path,
            address(zooToken_),
            block.timestamp     
        );
        bytes memory data = zooToken_.invoke(address(router), 0, callData);
        amounts = abi.decode(data, (uint256[]));
    }
    /**
     * Instructs the SetToken to set approvals of the ERC20 token to a spender.
     *
     * @param _setToken        SetToken instance to invoke
     * @param _token           ERC20 token to approve
     * @param _spender         The account allowed to spend the SetToken's balance
     * @param _quantity        The quantity of allowance to allow
     */
    function _invokeApprove(
        IZooToken _setToken,
        address _token,
        address _spender,
        uint256 _quantity
    )
       private 
    {
        bytes memory callData = abi.encodeWithSignature("approve(address,uint256)", _spender, _quantity);
        _setToken.invoke(_token, 0, callData);
    }

    function _invokeDeposit(
        IZooToken zooToken,
        address asset,
        uint256 amount 
    )
       private 
    {
        bytes memory callData = abi.encodeWithSignature(
            "deposit(address,uint256,address,uint16)", 
            address(asset),  // asset to deposit
            amount,  // amount
            address(zooToken), // onBehalfOf
            0    // referralCode
        );
        zooToken.invoke(address(lender), 0, callData);
    }

    function _invokeBorrow(
        IZooToken zooToken,
        address asset,
        uint256 amount 
    )
       private 
    {
        bytes memory callData = abi.encodeWithSignature(
            "borrow(address,uint256,uint256,uint16,address)", 
            address(asset),  // asset to deposit
            amount,  // amount
            1, // StableInterestMode
            0,    // referralCode
            address(zooToken) // onBehalfOf
        );
        zooToken.invoke(address(lender), 0, callData);
    }

    function _invokeWithdraw(
        IZooToken zooToken,
        address asset,
        uint256 amount 
    )
       private 
       returns (uint256 amountToWithdraw)
    {

        bytes memory callData = abi.encodeWithSignature(
            "withdraw(address,uint256,address)", 
            address(asset),  // asset to deposit
            amount,  // amount
            address(zooToken) // onBehalfOf
        );
        bytes memory data = zooToken.invoke(address(lender), 0, callData);
        amountToWithdraw = abi.decode(data, (uint256));

    }

    function _invokeRepay(
        IZooToken zooToken,
        address asset,
        uint256 amount 
    )
       private 
    {

        bytes memory callData = abi.encodeWithSignature(
            "repay(address,uint256,uint256,address)", 
            address(asset),  // asset to deposit
            amount,  // amount
            1, // StableInterestMode
            address(zooToken) // onBehalfOf
        );
        zooToken.invoke(address(lender), 0, callData);
    }
}