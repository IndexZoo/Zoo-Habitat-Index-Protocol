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

 // Dev Notes
 // TODO: Make calls from  an integration registry
 // TODO: SafeMath
 // TODO: Redeem logic
 // TODO: Streaming fees
 // DONE: Mint and set debt on zooToken
 // TODO: Rebalance formula
 // TODO: Liquidation Threshold
 // TODO: Module viewer
contract L3xIssuanceModule is  ModuleBase, ReentrancyGuard {
    using Position for IZooToken;
    using SafeMath for uint256;
    ILendingPool public lender;
    IUniswapV2Router public router;
    IERC20 public weth; // 
    IERC20 public dai;



    /* ============ Constructor ============ */
    /**
     * 
     * FIXME: removed controller and moduleBase temporarily
     * TODO: replace weth_ by underlying asset of LevToken (replacing SetToken)
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
     * If setToken is bullish
     * Deposits the base asset of that token on AAVE (i.e. WETH)
     * Borrows quoteToken (i.e. DAI)
     *
     * TODO: put an argument for minimum quantity of token to receive from Issue (slippage)
     * TODO: Integration Registry should be the provider of the calldata
     * DONE: Leverage token is meant to be the object invoking the function trading calls
     *
     * @param _quantity         Quantity of quote token input to go long 
     * @param _amountPerBase    amount of quote allowed to be borrowed per baseToken
     */
    function issue (
        IZooToken _zooToken,
        uint256 _quantity,
        uint256 _amountPerBase
        // address _to
    )
        external
        nonReentrant
        onlyValidAndInitializedSet(_zooToken)
    {
        // TODO: For loop
        dai.transferFrom(msg.sender, address(_zooToken), _quantity);
        // swap dai for baseToken
        uint256 price = 1000;  
        uint256 amountOut1 = _swapQuoteForBase(_zooToken, _quantity, _quantity * 99/100/price);
        // Borrow quoteToken from lending Protocol
        uint256 borrowAmount1 = _borrowQuoteForBaseCollateral(_zooToken, amountOut1, _amountPerBase);
        uint256 amountOut2 = _swapQuoteForBase(_zooToken, borrowAmount1, borrowAmount1 * 99/100/price);
        uint256 borrowAmount2 = _borrowQuoteForBaseCollateral(_zooToken, amountOut2, _amountPerBase);
        uint256 amountOut3 = _swapQuoteForBase(_zooToken, borrowAmount2, borrowAmount2 * 98/100/price);
        // TODO: mint tokens with amount proportional to the total deposits and baseToken output
        uint256 totalAmountOut = amountOut1.add(amountOut2).add(amountOut3);
        _zooToken.addDebt(msg.sender, borrowAmount1.add(borrowAmount2));
        _zooToken.mint(msg.sender, totalAmountOut);
        require(totalAmountOut != 0, "L3xIssueMod: Leveraging failed");
    }

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

    function removeModule() external override {}


   /**  -------------------------------- Private functions --------------------------------------------------
    */
    function _borrowQuoteForBaseCollateral(
        IZooToken zooToken,
        uint256 depositAmount,
        uint256 borrowAmountPerBase
    )
    private
    returns (uint256 notionalBorrowAmount)
    {
        _invokeApprove(zooToken, address(weth), address(lender), depositAmount);
        _invokeDeposit(zooToken, address(weth), depositAmount);
        // approve lender to receive swapped baseToken
        notionalBorrowAmount = borrowAmountPerBase * depositAmount / (1 ether);
        _invokeBorrow(zooToken, address(dai), notionalBorrowAmount);
        // TODO: ensure borrow took place ?
    }
    function _swapQuoteForBase(
        IZooToken zooToken,
        uint256 amountIn, 
        uint256 minAmountOut
      ) 
      private 
      returns (uint256 amountOut) 
    {

        _invokeApprove(zooToken, address(dai), address(router), amountIn);
        // dai.approve(address(router),  amountIn);
        address[] memory path = new address[](2);
        path[0] = address(dai); 
        path[1] = address(weth);
        bytes memory callData = abi.encodeWithSignature(
            "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
            amountIn,
            minAmountOut,
            path,
            address(zooToken),
            block.timestamp     
        );
        bytes memory data = zooToken.invoke(address(router), 0, callData);
        amountOut = abi.decode(data, (uint256[]))[1];
        // TODO: ensure swap took place ?
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
}