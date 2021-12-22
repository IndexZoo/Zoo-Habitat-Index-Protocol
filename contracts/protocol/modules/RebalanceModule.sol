/*
    Copyright 2020 Set Labs Inc.

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

pragma solidity ^0.6.10;
pragma experimental "ABIEncoderV2";

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";

import { IController } from "../../interfaces/IController.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IExchangeAdapter } from "../../interfaces/IExchangeAdapter.sol";
import { IIntegrationRegistry } from "../../interfaces/IIntegrationRegistry.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ISetToken } from "../../interfaces/ISetToken.sol";
import { TradeModule } from "./TradeModule.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { Address } from "@openzeppelin/contracts/utils/Address.sol";
import {IUniswapV2Router} from "../../interfaces/external/IUniswapV2Router.sol";

/**
 * @title RebalanceModule
 * @author IndexZoo 
 *
 * Module that enables SetTokens to perform atomic trades using Decentralized Exchanges
 * such as 1inch or Kyber. Integrations mappings are stored on the IntegrationRegistry contract.
 */
contract RebalanceModule is TradeModule {
    using SafeCast for int256;
    using SafeMath for uint256;

    using Invoke for ISetToken;
    using Position for ISetToken;
    using PreciseUnitMath for uint256;
    using Address for address;


    /* ============ Constants ============ */

    // 0 index stores the fee % charged in the trade function
    uint256 constant internal BALANCE_MODULE_PROTOCOL_FEE_INDEX = 0;
    bool internal constant DIRECTION_OUT = true;
    bool internal constant DIRECTION_IN = false;

    /* ============ Constructor ============ */

    constructor(IController _controller) public TradeModule(_controller) {}

    /* ============ External Functions ============ */
    /**
     * Executes a trade on a supported DEX. Only callable by the SetToken's manager.
     * @dev Although the SetToken units are passed in for the send and receive quantities, the total quantity
     * sent and received is the quantity of SetToken units multiplied by the SetToken totalSupply.
     *
     * @param _setToken                     Instance of the SetToken to trade
     * @param _exchangeName                 Human readable name of the exchange in the integrations registry
     * @param _sendToken                    Address of the token to be sent to the exchange
     * @param _targetSendTokenVolume        Units of token in SetToken sent to the exchange
     * @param _receiveToken                 Address of the token that will be received from the exchange
     * @param _allowedSlipOf10000           To calculate min units of token in SetToken to be received from the exchange
     * @param _data                         Arbitrary bytes to be used to construct trade call data
     */
    function balancePair(
        ISetToken _setToken,
        string memory _exchangeName,
        address _sendToken,
        uint256 _targetSendTokenVolume,
        address _receiveToken,
        uint16 _allowedSlipOf10000,
        bytes memory _data
    )
        external
        nonReentrant
        onlyManagerAndValidSet(_setToken)
    {
        // It is required here to have _targetSendTokenVolume > current sendToken balance of setToken
        uint256 sendQuantity = IERC20(_sendToken).balanceOf(address(_setToken)).sub(_targetSendTokenVolume);
        uint256 targetReceiveTokenVolume = balancingVolume(_setToken, _exchangeName, _sendToken, _targetSendTokenVolume, _receiveToken);
        uint256 receiveQuantity = targetReceiveTokenVolume.sub(IERC20(_sendToken).balanceOf(address(_setToken))); 
        uint256 minReceiveQuantity = receiveQuantity.sub(  receiveQuantity.div(10000).mul(_allowedSlipOf10000));
        _trade(
            _setToken,
            _exchangeName,
            _sendToken,
            sendQuantity,
            _receiveToken,
            minReceiveQuantity,
            _data
        );
    }      


    /**
     * Shows the volume of otherToken which balances the change in token
     *   user changes the volume of token expecting an output from this function showing volume of otherToken
     * @param _setToken      Instance of the SetToken to trade
     * @param _exchangeName  Human readable name of the exchange in the integrations registry
     * @param _token         Address of token input for the swap estimation
     * @param _tokenTargetVolume   Volume of the token input for the swap estimation
     * @param _otherToken    The token to be estimated for the swap
     * @return uint256     Represents balanced volume of _otherToken
     */
    function balancingVolume(
        ISetToken _setToken,
        string memory _exchangeName,
        address _token,
        uint256 _tokenTargetVolume,
        address _otherToken
    )
    public
    view
    returns (uint256)
    {
        uint256 tokenBalance = IERC20(_token).balanceOf(address(_setToken));
        uint256 otherTokenBalance = IERC20(_otherToken).balanceOf(address(_setToken));

        if (_tokenTargetVolume == tokenBalance) {
            return otherTokenBalance;
        }

        bool direction;
        // if desired _tokenTargetVolume is less, it means that the difference is being estimated for a trade -> getAmountsOut
        direction = _tokenTargetVolume < tokenBalance ? DIRECTION_OUT : DIRECTION_IN;
        uint256 amount = _tokenTargetVolume < tokenBalance? tokenBalance - _tokenTargetVolume : _tokenTargetVolume - tokenBalance;
         
        IExchangeAdapter exchangeAdapter = IExchangeAdapter(getAndValidateAdapter(_exchangeName));
        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = 
        exchangeAdapter.getAmountsCalldata(_token, _otherToken, amount, direction);
        bytes memory _returnValue = targetExchange.functionStaticCall(methodData);
        uint[] memory amounts = abi.decode(_returnValue, (uint[]));
        if (_tokenTargetVolume > tokenBalance) require(  otherTokenBalance >= amounts[0], "Not enough balance for swap"); 
        uint256 balancedQuantity = direction == DIRECTION_OUT?  otherTokenBalance + amounts[1] : otherTokenBalance - amounts[0];
        return balancedQuantity; 
    }

    /* ============ Internal Functions ============ */

    /**
     * Executes a trade on a supported DEX. Only callable by the SetToken's manager.
     * @dev Although the SetToken units are passed in for the send and receive quantities, the total quantity
     * sent and received is the quantity of SetToken units multiplied by the SetToken totalSupply.
     *
     * @param _setToken             Instance of the SetToken to trade
     * @param _exchangeName         Human readable name of the exchange in the integrations registry
     * @param _sendToken            Address of the token to be sent to the exchange
     * @param _sendQuantity         Units of token in SetToken sent to the exchange
     * @param _receiveToken         Address of the token that will be received from the exchange
     * @param _minReceiveQuantity   Min units of token in SetToken to be received from the exchange
     * @param _data                 Arbitrary bytes to be used to construct trade call data
     */
    function _trade(
        ISetToken _setToken,
        string memory _exchangeName,
        address _sendToken,
        uint256 _sendQuantity,
        address _receiveToken,
        uint256 _minReceiveQuantity,
        bytes memory _data
    )
        internal 
    {
        uint256 sendUnits = _sendQuantity.mul(10**18).div(_setToken.totalSupply());
        TradeInfo memory tradeInfo = _createTradeInfo(
            _setToken,
            _exchangeName,
            _sendToken,
            _receiveToken,
            sendUnits,
            _minReceiveQuantity
        );

        _validatePreTradeData(tradeInfo, _sendQuantity);

        _executeTrade(tradeInfo, _data);

        uint256 exchangedQuantity = _validatePostTrade(tradeInfo);

        uint256 protocolFee = _accrueProtocolFee(tradeInfo, exchangedQuantity);

        (
            uint256 netSendAmount,
            uint256 netReceiveAmount
        ) = _updateSetTokenPositions(tradeInfo);

        emit ComponentExchanged(
            _setToken,
            _sendToken,
            _receiveToken,
            tradeInfo.exchangeAdapter,
            netSendAmount,
            netReceiveAmount,
            protocolFee
        );
    }
}