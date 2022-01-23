/*
    Copyright 2021 Index Zoo Ltd.

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


/**
 * @title 
 * @author  
 * The contract emulates Leverage trading by enabling opening positions
 * Positions are opened via a Quote Token represented by Stable Coin (e.g. USDC) against a Base Token (e.g. WETH)
 * Price of Base Token is tracked in order to ensure exposure is enough to maintain debt.
 */
contract ClearingHouseTrivialMock {

    IERC20 public quote;
    /**
     *  exposure = nav + debt 
     *  leverage = exposure / nav
     */
    struct Position {
        uint256 debt;
        uint256 exposure;
        uint256 nav;   
    }

    struct OpenPositionParams {
        address baseToken;
        bool isBaseToQuote;
        bool isExactInput;
        uint256 amount;
        uint256 oppositeAmountBound;
        uint256 deadline;
        uint160 sqrtPriceLimitX96;
        bytes32 referralCode;
    }

    // Mapping that stores all positions of traders
    mapping(address => Position) public positions;

    // Mapping that stores a price given a baseToken
    // Buy price of baseToken against quote
    mapping(address => uint256) public prices;


    
    /* ============ Constructor ============ */
    
    constructor(IERC20 quote_) public  {
        quote = quote_;
    }

    function openPosition(OpenPositionParams memory params)
        external
        returns (uint256 amountBase, uint256 amountQuote)
    {
        // input requirement checks:
        //   baseToken: in Exchange.settleFunding()
        //   isBaseToQuote & isExactInput: X
        //   amount: in UniswapV3Pool.swap()
        //   oppositeAmountBound: in _checkSlippage()
        //   deadline: here
        //   sqrtPriceLimitX96: X (this is not for slippage protection)
        //   referralCode: X

        address trader = msg.sender;
        // register token if it's the first time
        // TODO: add to current position then rebalance

        (amountBase, amountQuote) = _getAmounts(params.amount, prices[params.baseToken], params.isBaseToQuote, params.isExactInput);

        return (amountBase, amountQuote);
    }

    function _getAmounts(uint256 amount_, uint256 price_, bool isBaseToQuote_, bool isExactInput_) 
      private 
      pure
      returns (uint256 amountBase, uint256 amountQuote) {
          if(isBaseToQuote_ != isExactInput_ ) {
              amountQuote = amount_;
              amountBase = price_ * amountQuote;
          } else {
              amountBase = amount_;
              amountQuote = amountBase / price_;
          }
    } 


}