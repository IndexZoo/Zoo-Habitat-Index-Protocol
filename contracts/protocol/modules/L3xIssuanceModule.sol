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
contract L3xIssuanceModule is  ModuleBase, ReentrancyGuard {

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
     * @param _zooToken                 Instance of the SetToken to initialize
     */
    function initialize(
        IZooToken _zooToken
    )
        external
        onlyValidAndPendingSet(_zooToken)
        onlySetManager(_zooToken, msg.sender)
    {
        _zooToken.initializeModule();
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
     * TODO: Leverage token is meant to be the object invoking the function trading calls
     *
     * @param _quantity         Quantity of quote token input to go long 
     * @param _amountPerBase    amount of quote allowed to be borrowed per baseToken
     */
    function issue(
        // ISetToken _setToken,
        uint256 _quantity,
        uint256 _amountPerBase
        // address _to
    )
        external
        nonReentrant
        // onlyValidAndInitializedSet(_setToken)
    {
        dai.transferFrom(msg.sender, address(this), _quantity);
        // swap dai for baseToken
        uint256 price = 1000;  
        uint256 amountOut = _swapQuoteForBase(_quantity, _quantity * 99/100/price);
        // Borrow quoteToken from lending Protocol
        uint256 borrowAmount = _borrowQuoteForBaseCollateral(amountOut, _amountPerBase);
        amountOut = _swapQuoteForBase(borrowAmount, borrowAmount * 99/100/price);
        borrowAmount = _borrowQuoteForBaseCollateral(amountOut, _amountPerBase);
        amountOut = _swapQuoteForBase(borrowAmount, borrowAmount * 98/100/price);
        require(amountOut != 0, "L3xIssueMod: Leveraging failed");
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
        uint256 depositAmount,
        uint256 borrowAmountPerBase
    )
    private
    returns (uint256 notionalBorrowAmount)
    {
        // approve lender to receive swapped baseToken
        weth.approve(address(lender), depositAmount);
        lender.deposit(address(weth), depositAmount, address(this), 0);
        notionalBorrowAmount = borrowAmountPerBase * depositAmount / (1 ether);
        lender.borrow(address(dai), notionalBorrowAmount , 1, 0, address(this));
        // TODO: ensure borrow took place ?
    }
    function _swapQuoteForBase(
        uint256 amountIn, 
        uint256 minAmountOut
      ) 
      private 
      returns (uint256 amountOut) 
    {
        dai.approve(address(router),  amountIn);
        address[] memory path = new address[](2);
        path[0] = address(dai); 
        path[1] = address(weth);
        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn, 
            minAmountOut, 
            path, 
            address(this), 
           block.timestamp 
        );
        amountOut = amounts[1];
        // TODO: ensure swap took place ?
    }
}