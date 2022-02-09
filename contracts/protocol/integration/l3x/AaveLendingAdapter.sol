/*
    Copyright 2022 Index Zoo Ltd.

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

/**
 * @title AaveLendingAdapter 
 * @author Index Zoo Ltd. 
 *
 *
 */
contract AaveLendingAdapter {

    /* ============ State Variables ============ */

    // Address of  Aave LendingPool contract
    address public immutable lender;
    // Aave lender function string called by user to borrow amount of token
    string internal constant BORROW = "borrow(address,uint256,uint256,uint16,address)";
    string internal constant DEPOSIT = "deposit(address,uint256,address,uint16)"; 
    string internal constant WITHDRAW = "withdraw(address,uint256,address)";
    string internal constant REPAY = "repay(address,uint256,uint256,address)";

    /* ============ Constructor ============ */

    /**
     * Set state variables
     *
     * @param _lender       Address of Aave lending pool 
     */
    constructor(address _lender) public {
        lender = _lender;
    }

    /* ============ External Getter Functions ============ */

    /**
     * Return calldata for Aave V2 Lending Pool.
     * Caller borrows amount of asset against an already deposited collateral
     *
     *
     * @param  _asset       Address of token asset to be borrowed 
     * @param  _amount      Amount of the asset requested to be borrowed 
     * @param _onBehalfOf   Address of entity to be receiving the assets borrowed
     *
     * @return address                   Target contract address
     * @return uint256                   Call value
     * @return bytes                     borrow calldata
     */
    function getBorrowCalldata(
        address _asset,
        uint256 _amount,
        address _onBehalfOf
    )
        external
        view
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature(
            BORROW, 
            _asset,  // asset to deposit
            _amount,  // amount
            1, // StableInterestMode
            0,    // referralCode
            _onBehalfOf // onBehalfOf
        );
        return (lender, 0, callData);
    }

    /**
     * Return calldata for Aave V2 Lending Pool.
     * Caller repays amount of borrowed asset  
     *
     *
     * @param  _asset       Address of token asset to be repaid 
     * @param  _amount      Amount of the asset requested to be repaid 
     * @param _onBehalfOf   Address of entity to be having the asset repaid for
     *
     * @return address                   Target contract address
     * @return uint256                   Call value
     * @return bytes                     repay calldata
     */
    function getRepayCalldata(
        address _asset,
        uint256 _amount,
        address _onBehalfOf
    )
        external
        view
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature(
            REPAY, 
            _asset,  // asset to deposit
            _amount,  // amount
            1, // StableInterestMode
            _onBehalfOf // onBehalfOf
        );
        return (lender, 0, callData);
    }


    /**
     * Return calldata for Aave V2 Lending Pool.
     * Caller deposits amount of asset as collateral 
     *
     *
     * @param  _asset       Address of token asset to be borrowed 
     * @param  _amount      Amount of the asset requested to be borrowed 
     * @param _onBehalfOf   Address of entity to be receiving the assets borrowed
     *
     * @return address                   Target contract address
     * @return uint256                   Call value
     * @return bytes                     deposit calldata
     */
    function getDepositCalldata(
        address _asset,
        uint256 _amount,
        address _onBehalfOf
    )
        external
        view
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature(
            DEPOSIT, 
            _asset,  // asset to deposit
            _amount,  // amount
            _onBehalfOf, // onBehalfOf
            0    // referralCode
        );
        return (lender, 0, callData);
    }

    /**
     * Return calldata for Aave V2 Lending Pool.
     * Caller withdraws amount of asset from deposited collateral 
     *
     *
     * @param  _asset       Address of token asset to be borrowed 
     * @param  _amount      Amount of the asset requested to be borrowed 
     * @param _onBehalfOf   Address of entity to be receiving the assets borrowed
     *
     * @return address                   Target contract address
     * @return uint256                   Call value
     * @return bytes                     withdraw calldata
     */
    function getWithdrawCalldata(
        address _asset,
        uint256 _amount,
        address _onBehalfOf
    )
        external
        view
        returns (address, uint256, bytes memory)
    {
        bytes memory callData = abi.encodeWithSignature(
            WITHDRAW, 
            _asset,  // asset to withdraw 
            _amount,  // amount
            _onBehalfOf // onBehalfOf
        );
        return (lender, 0, callData);
    }


    /**
     * Generate data parameter to be passed to `getTradeCallData`. Returns encoded trade paths and bool to select trade function.
     *
     * @param _sourceToken          Address of the source token to be sold
     * @param _destinationToken     Address of the destination token to buy
     * @param _fixIn                Boolean representing if input tokens amount is fixed
     *
     * @return bytes                Data parameter to be passed to `getTradeCallData`
     */
    function generateDataParam(address _sourceToken, address _destinationToken, bool _fixIn)
        external
        pure
        returns (bytes memory)
    {
        address[] memory path = new address[](2);
        path[0] = _sourceToken;
        path[1] = _destinationToken;
        return abi.encode(path, _fixIn);
    }

    /**
     * Returns the address to approve source tokens to for trading. This is the Uniswap router address
     *
     * @return address             Address of the contract to approve tokens to
     */
    function getSpender() external view returns (address) {
        return lender;
    }
}