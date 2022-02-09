
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


interface IExchangeAdapterV3 {

    function getTradeCalldata(
        address _sourceToken,
        address _destinationToken,
        address _destinationAddress,
        uint256 _exactQuantity,
        uint256 _edgedQuantity,
        bool _shouldSwapExactTokensForTokens,
        bytes memory _data
    )
        external
        returns (address, uint256, bytes memory);
    function getSpender()
        external
        returns (address);
}  