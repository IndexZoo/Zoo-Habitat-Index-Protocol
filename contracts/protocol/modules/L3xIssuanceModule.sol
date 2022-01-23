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

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IController } from "../../interfaces/IController.sol";
import { IDebtVault } from "../../interfaces/IDebtVault.sol";
import { Invoke } from "../lib/Invoke.sol";
import { ISetToken } from "../../interfaces/ISetToken.sol";
import { IssuanceValidationUtils } from "../lib/IssuanceValidationUtils.sol";
import { Position } from "../lib/Position.sol";
import { ModuleBase } from "../lib/ModuleBase.sol";

// TODO: Change comments

/**
 * @title L3xIssuanceModule
 * @author IndexZoo Ltd.
 *
 * The L3xIssuanceModule is a module that enables users to issue and redeem Leveraged Tokens that wrap a base token 
 * including debt positions. Module hooks are added to allow for syncing of debt, 
 * to ensure debts are replicated correctly. 
 * 
 * NOTE: 
 */
contract L3xIssuanceModule is ModuleBase, ReentrancyGuard {
    /// @notice Reference to debt vault 
    /// @dev Acts as a storage for debt positions  
    IDebtVault public vault;



    /* ============ Constructor ============ */
    
    constructor(IController _controller) public ModuleBase (_controller) {}

    /* ============ External Functions ============ */

    /**
     * Mints Leverage token for investor
     * Opens a position via perpetual protocol to provide leverage
     * Update debt position for investor
     *
     * @param _setToken         Instance of the SetToken to issue
     * @param _quantity         Quantity of SetToken to issue
     * @param _to               Address to mint SetToken to
     */
    function issue(
        ISetToken _setToken,
        uint256 _quantity,
        address _to
    )
        external
        nonReentrant
        onlyValidAndInitializedSet(_setToken)
    {
        // TODO: openPosition with perpMock
        uint256 debtAmount = _quantity * 2;   // Leverage 3x -> debt is 2x
        vault.addToDebt(_to, debtAmount);
    }

    function registerVault(ISetToken setToken_,  IDebtVault vault_) external onlySetManager(setToken_, msg.sender) {
        vault = vault_;
    }

    function removeModule() external override {}
}