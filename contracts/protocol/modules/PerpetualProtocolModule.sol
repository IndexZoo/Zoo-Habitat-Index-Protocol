/*
    Copyright 2021 IndexTech Ltd.

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
import { Math } from "@openzeppelin/contracts/math/Math.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { SafeCast } from "@openzeppelin/contracts/utils/SafeCast.sol";
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";

import { AddressArrayUtils } from "../../lib/AddressArrayUtils.sol";
import { IController } from "../../interfaces/IController.sol";
import { IClearingHouse } from "../../interfaces/IClearingHouse.sol";
import { IAmm } from "../../interfaces/IAmm.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ISetToken } from "../../interfaces/ISetToken.sol";
import { IWETH } from "../../interfaces/external/IWETH.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";
import { Position } from "../lib/Position.sol";
import { PreciseUnitMath } from "../../lib/PreciseUnitMath.sol";
import { Uint256ArrayUtils } from "../../lib/Uint256ArrayUtils.sol";


/**
 * @title PerpetualProtocolModule
 * @author IndexTech Ltd.
 *
 * Smart contract that facilitates trading via PerpetualProtocol.  
 * SECURITY ASSUMPTION:
 */
contract PerpetualProtocolModule is ModuleBase, ReentrancyGuard {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using Position for uint256;
    using Math for uint256;
    using Position for ISetToken;
    using Invoke for ISetToken;
    using AddressArrayUtils for address[];
    using Uint256ArrayUtils for uint256[];

    /* ============ Structs ============ */

    struct AssetTradeInfo {
        uint256 targetUnit;              // Target unit for the asset during current rebalance period
        uint256 maxSize;                 // Max trade size in precise units
        uint256 coolOffPeriod;           // Required time between trades for the asset
        uint256 lastTradeTimestamp;      // Timestamp of last trade
        uint256 exchange;                // Integer representing ID of exchange to use
    }

    /* ============ Enums ============ */
    enum Side {
        BUY,
        SELL
    }

    enum MarginSide {
        ADD,
        SUB
    }

    // Enum of exchange Ids
    enum ExchangeId {
        None,
        Uniswap,
        Sushiswap,
        Balancer,
        Last
    }

    /* ============ Events ============ */
    // TODO: hook these events
    event TargetUnitsUpdated(address indexed _component, uint256 _newUnit, uint256 _positionMultiplier);
    event TradeMaximumUpdated(address indexed _component, uint256 _newMaximum);
    event AssetExchangeUpdated(address indexed _component, uint256 _newExchange);
    event CoolOffPeriodUpdated(address indexed _component, uint256 _newCoolOffPeriod);
    event TraderStatusUpdated(address indexed _trader, bool _status);
    event AnyoneTradeUpdated(bool indexed _status);
    event TradeExecuted(
        address indexed _executor,
        address indexed _sellComponent,
        address indexed _buyComponent,
        uint256 _amountSold,
        uint256 _amountBought
    );

    /* ============ Constants ============ */
    string private constant OPEN_POSITION = "openPosition(address,uint8,(uint256),(uint256),(uint256))";
    string private constant CLOSE_POSITION = "closePosition(address,(uint256))";
    string private constant ADD_MARGIN = "addMargin(address,(uint256))";
    string private constant REMOVE_MARGIN = "removeMargin(address,(uint256))";



    /* ============ State Variables ============ */

    mapping(address => AssetTradeInfo) public assetInfo;    // Mapping of component to component restrictions
    mapping(address => bool) public tradeAllowList;         // Mapping of addresses allowed to call trade()
    bool public anyoneTrade;                                // Toggles on or off skipping the tradeAllowList
    ISetToken public index;                                 // Index being managed with contract
    IClearingHouse public clearingHouse;                    // ClearingHouse contract address
    IAmm public amm;                                        // Amm contract address
    IERC20 public usdc;                                     // Usdc contract address

    /* ============ Modifiers ============ */

    modifier onlyEOA() {
        require(msg.sender == tx.origin, "Caller must be EOA Address");
        _;
    }

    /* ============ Constructor ============ */

    constructor(
        IController _controller,
        IClearingHouse _clearingHouse,
        IAmm _amm,
        IERC20 _usdc
    )
        public
        ModuleBase(_controller)
    {
        clearingHouse = _clearingHouse;
        amm = _amm;
        usdc = _usdc;
    }
 
    /**
     * MANAGER ONLY: Set target units to current units and last trade to zero. Initialize module.
     *
     * @param _index            Address of index being used for this Set
     */
    function initialize(ISetToken _index)
        external
        onlySetManager(_index, msg.sender)
        onlyValidAndPendingSet(_index)
    {
        require(address(index) == address(0), "Module already in use");
        index = _index;
        _index.initializeModule();
    }



    /* ============ External Functions ============ */

    function trade(
        Side _side,
        uint256 _quoteAssetAmount,
        uint256 _leverage,
        uint256 _baseAssetAmountLimit
    ) 
    external
    onlyManagerAndValidSet(index)
    {
        // validate pretrade data
        // TODO: call hooks
        _executeTradePosition(_side, _quoteAssetAmount, _leverage, _baseAssetAmountLimit);
    }

    function closeTrade(
        uint256 _quoteAssetAmount
    ) 
    external
    onlyManagerAndValidSet(index)
    {
        _executeClosePosition(_quoteAssetAmount);
    }

    function addMargin(
        uint256 _addedMargin 
    ) 
    external
    onlyManagerAndValidSet(index)
    {
        _executeEditMargin(MarginSide.ADD, _addedMargin);
    }

    function removeMargin(
        uint256 _decreasedMargin 
    ) 
    external
    onlyManagerAndValidSet(index)
    {
        _executeEditMargin(MarginSide.SUB, _decreasedMargin);
    }

    function removeModule() external override {
        // TODO: check ongoing positions to settle them before removing module
    }

    /**
     * MANAGER ONLY: Set new target units, zeroing out any units for components being removed from index. Log position multiplier to
     * adjust target units in case fees are accrued. Validate that weth is not a part of the new allocation and that all components
     * in current allocation are in _components array.
     *
     * @param _side                    Buy or Sell 
     * @param _quoteAssetAmount        Amount to deposit by trader 
     * @param _leverage                Leverage 
     * @param _baseAssetAmountLimit    Limit
     */

    function _executeTradePosition(
        Side _side,
        uint256 _quoteAssetAmount,
        uint256 _leverage,
        uint256 _baseAssetAmountLimit
    )
        internal
        virtual
    {
        
        bytes memory perpPositionCalldata
         =  _getPerpPositionCalldata(_side, _quoteAssetAmount, _leverage, _baseAssetAmountLimit);

        index.invokeApprove(address(usdc), address(clearingHouse), _quoteAssetAmount);
        index.invoke(address(clearingHouse), 0, perpPositionCalldata);
    }
    /**
     * MANAGER ONLY: Set new target units, zeroing out any units for components being removed from index. Log position multiplier to
     * adjust target units in case fees are accrued. Validate that weth is not a part of the new allocation and that all components
     * in current allocation are in _components array.
     *
     * @param _quoteAssetAmount        Amount to close by trader 
     */
    function _executeClosePosition(
        uint256 _quoteAssetAmount
    )
        internal
        virtual
    {
        
        bytes memory perpClosePositionCalldata
         =  _getPerpClosePositionCalldata(_quoteAssetAmount);

        index.invokeApprove(address(usdc), address(clearingHouse), _quoteAssetAmount);
        index.invoke(address(clearingHouse), 0, perpClosePositionCalldata);
    }

    /**
     * MANAGER ONLY: Set new target units, zeroing out any units for components being removed from index. Log position multiplier to
     * adjust target units in case fees are accrued. Validate that weth is not a part of the new allocation and that all components
     * in current allocation are in _components array.
     *
     * @param _amount        Margin amount added to or removed from position by trader 
     */
    function _executeEditMargin(
        MarginSide _side,
        uint256 _amount
    )
        internal
        virtual
    {
        
        bytes memory perpAddMarginCalldata
         =  _getPerpEditMarginCalldata(_side, _amount);

        index.invokeApprove(address(usdc), address(clearingHouse), _amount);
        index.invoke(address(clearingHouse), 0, perpAddMarginCalldata);
    }
 
    
    function _getPerpPositionCalldata(
        Side _side,
        uint256 _quoteAssetAmount,
        uint256 _leverage,
        uint256 _baseAssetAmountLimit
    )
        internal
        view
        returns (bytes memory _tradeCalldata)
    {
        string memory functionSignature = OPEN_POSITION;
       
        _tradeCalldata = abi.encodeWithSignature(
            functionSignature,
            amm,
            _side,
            _quoteAssetAmount,
            _leverage,
            _baseAssetAmountLimit
        );
    }

    function _getPerpClosePositionCalldata(
        uint256 _quoteAssetAmount
    )
        internal
        view
        returns (bytes memory _closeTradeCalldata)
    {
        string memory functionSignature = CLOSE_POSITION;
       
        _closeTradeCalldata = abi.encodeWithSignature(
            functionSignature,
            amm,
            _quoteAssetAmount
        );
    }

    function _getPerpEditMarginCalldata(
        MarginSide _side,
        uint256 _amount
    )
        internal
        view
        returns (bytes memory _editMarginCalldata)
    {
        string memory functionSignature = _side == MarginSide.ADD?  ADD_MARGIN:REMOVE_MARGIN;
       
        _editMarginCalldata = abi.encodeWithSignature(
            functionSignature,
            amm,
            _amount
        );
    }
}