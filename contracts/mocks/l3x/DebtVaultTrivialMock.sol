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

// TODO: Embed within Controller ecosystem

pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";


/**
 * @title L3xIssuanceModule
 * @author IndexZoo Ltd.
 *
 */
contract  DebtVaultTrivialMock {

    // Mapping that stores all debts of investors 
    mapping (address => uint256) public debts;

    // L3xIssuanceModule , the only allowed caller for specific functions 
    address public module;

    modifier onlyIssuanceModule {
        require(msg.sender == module, "PerpVault: only registered module can call");
        _;
    }
    
    /* ============ Constructor ============ */
   constructor (address module_) public {
      module = module_; 
   }

   function addToDebt(address investor_, uint256 amount_) external onlyIssuanceModule {
       debts[investor_] += amount_;
   }

   function removeFromDebt(address investor_, uint256 amount_) external onlyIssuanceModule {
       debts[investor_] -= amount_;
   }
    
}
